'use strict';
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');

const { errorDetails, progressError } = require('./progress-error.cjs');
const { readConfiguredLang } = require('./i18n.cjs');

const MAX_BODY_BYTES = 1024 * 1024;
const nativeOrigin = origin => !origin || origin === 'null' || origin === 'vscode-file://vscode-app' || /^vscode-webview:\/\/[a-z0-9-]+$/.test(origin) || /^plugin:\/\/[a-z0-9_-]+$/.test(origin);

async function startProgressHttp({ port, stateFile, handle, brainDir }) {
  const token = crypto.randomBytes(32).toString('hex');
  const stateId = crypto.createHash('sha256').update(path.resolve(stateFile)).digest('hex');
  const credentialFile = `${stateFile}.http.json`;
  const defaultBrain = brainDir || path.resolve(path.dirname(stateFile), '../brain');
  const allowedOrigins = new Set();
  const subscribeTickets = new Map();
  const sseClients = new Set();
  const activeLang = () => readConfiguredLang({ dataDir: stateFile ? path.dirname(stateFile) : undefined });
  const msg = (zh, en) => (activeLang() === 'en' ? en : zh);

  function pruneTickets() {
    const now = Date.now();
    for (const [ticket, info] of subscribeTickets) {
      if (info.expiresAt <= now) subscribeTickets.delete(ticket);
    }
  }

  function issueTicket(conversationId) {
    pruneTickets();
    if (!conversationId || typeof conversationId !== 'string') throw new Error(msg('请指定会话标识', 'Please specify a conversation ID'));
    const ticket = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 60000;
    subscribeTickets.set(ticket, { conversationId, expiresAt });
    return { ticket, expiresAt };
  }

  function broadcast(conversationId, eventData) {
    const payload = `event: change\ndata: ${JSON.stringify(eventData)}\n\n`;
    for (const client of sseClients) {
      if (!conversationId || client.conversationId === conversationId) {
        try { client.res.write(payload); }
        catch (_) { sseClients.delete(client); }
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const origin = req.headers.origin;
    if (!nativeOrigin(origin) && !allowedOrigins.has(origin)) {
      send(403, { error: msg('请求来源未授权', 'Unauthorized request origin') });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      send(204, {});
      return;
    }

    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch { send(400, { error: msg('请求路径无效', 'Invalid request URL') }); return; }

    // 1. SSE 订阅通道：专属于单会话的短期只读票据验证
    if (req.method === 'GET' && url.pathname === '/session/events') {
      pruneTickets();
      const ticket = url.searchParams.get('ticket');
      const convId = url.searchParams.get('id');
      const ticketInfo = ticket ? subscribeTickets.get(ticket) : null;
      if (!ticketInfo || ticketInfo.expiresAt <= Date.now() || ticketInfo.conversationId !== convId) {
        send(403, { error: msg('订阅票据无效、已过期或会话不匹配', 'Subscription ticket is invalid, expired, or does not match the session') });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': origin || '*',
      });
      res.flushHeaders?.();

      const client = { res, conversationId: convId, since: Number(url.searchParams.get('since') || 0) };
      sseClients.add(client);

      // 建立连接后立即补发当前会话完整最新快照
      try {
        const snapshot = await handle('GET', '/session/snapshot', { conversationId: convId });
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch (e) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
      }

      req.on('close', () => { sseClients.delete(client); });
      return;
    }

    // 2. 主服务需要 Master Token
    if (req.headers.authorization !== `Bearer ${token}`) {
      send(401, { error: msg('请求凭据无效', 'Invalid authorization token') });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      send(200, { service: 'agent-things', version: 1, stateId });
      return;
    }

    // 3. 签发单会话短期订阅票据（仅供持 Master Token 的可信宿主使用）
    if (req.method === 'POST' && url.pathname === '/session/ticket') {
      let chunks = [], bytes = 0;
      req.on('data', chunk => { bytes += chunk.length; if (bytes <= MAX_BODY_BYTES) chunks.push(chunk); });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const result = issueTicket(body.conversationId);
          send(200, { ok: true, ...result });
        } catch (e) {
          send(400, { error: e.message });
        }
      });
      return;
    }

    // 4. 校验工件真实性与内容摘要（仅供持 Master Token 的可信宿主使用）
    if (req.method === 'POST' && url.pathname === '/session/verify-artifact') {
      let chunks = [], bytes = 0;
      req.on('data', chunk => { bytes += chunk.length; if (bytes <= MAX_BODY_BYTES) chunks.push(chunk); });
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const { conversationId, digest, content: reqContent, brainDir: reqBrain } = body;
          if (!conversationId || typeof conversationId !== 'string' || (!digest && typeof reqContent !== 'string')) {
            send(400, { error: msg('参数无效', 'Invalid arguments'), valid: false });
            return;
          }
          const targetBrain = (reqBrain && fs.existsSync(reqBrain)) ? path.resolve(reqBrain) : defaultBrain;
          const artifactPath = path.join(targetBrain, conversationId, 'things-card.html');
          if (!fs.existsSync(artifactPath)) {
            send(404, { error: msg('会话工件不存在', 'Session artifact not found'), artifactPath, valid: false });
            return;
          }
          const diskContent = fs.readFileSync(artifactPath, 'utf8');
          const expectedDigest = crypto.createHash('sha256').update(diskContent).digest('hex');
          let valid = false;
          if (digest) {
            valid = (digest === expectedDigest);
          } else if (typeof reqContent === 'string') {
            valid = (reqContent === diskContent);
          }
          send(200, { ok: true, valid, conversationId, expectedDigest });
        } catch (e) {
          send(400, { error: e.message, valid: false });
        }
      });
      return;
    }

    // 5. 获取法定工件内容摘要（仅供持 Master Token 的可信宿主使用）
    if (req.method === 'GET' && url.pathname === '/session/artifact-digest') {
      const convId = url.searchParams.get('conversationId');
      const reqBrain = url.searchParams.get('brainDir');
      if (!convId) { send(400, { error: msg('请指定会话标识', 'Please specify a conversation ID') }); return; }
      const targetBrain = (reqBrain && fs.existsSync(reqBrain)) ? path.resolve(reqBrain) : defaultBrain;
      const artifactPath = path.join(targetBrain, convId, 'things-card.html');
      if (!fs.existsSync(artifactPath)) {
        send(404, { error: msg('会话工件不存在', 'Session artifact not found'), artifactPath });
        return;
      }
      try {
        const content = fs.readFileSync(artifactPath, 'utf8');
        const digest = crypto.createHash('sha256').update(content).digest('hex');
        send(200, { ok: true, digest, conversationId: convId });
      } catch (e) {
        send(500, { error: e.message });
      }
      return;
    }

    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(progressError('REQUEST_CANCELLED', undefined, undefined, activeLang())); };
    res.once('close', disconnected);
    const dispatch = async body => {
      try { const reply = await handle(req.method, url.pathname, body, { signal: controller.signal }); if (!res.destroyed) send(200, reply); }
      catch (error) { const errorInfo = errorDetails(error, 'HOST_UNAVAILABLE', activeLang()); send(errorInfo.code === 'REVISION_CONFLICT' ? 409 : 400, { error: error.message, errorInfo }); }
      finally { res.removeListener('close', disconnected); }
    };

    if (req.method === 'GET') { void dispatch(null); return; }
    if (req.method !== 'POST') { send(405, { error: msg('请求方法无效', 'Method not allowed') }); return; }

    let bytes = 0, chunks = [], oversized = false;
    req.on('data', chunk => {
      if (oversized) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { oversized = true; chunks = []; send(413, { error: msg('请求内容超过限制', 'Request payload exceeds limit') }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(400, { error: msg('JSON 格式无效', 'Invalid JSON body') }); return; }
      void dispatch(body);
    });
    req.on('error', () => res.destroy());
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const address = server.address();
  const credentials = { service: 'agent-things', version: 1, stateId, port: address.port, token, pid: process.pid };
  fs.mkdirSync(path.dirname(credentialFile), { recursive: true, mode: 0o700 });
  try {
    const temporary = `${credentialFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
    fs.renameSync(temporary, credentialFile);
  } catch (error) { await new Promise(resolve => server.close(resolve)); throw error; }

  return {
    server, credentials, issueTicket, broadcast,
    allowOrigin(origin) {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error(msg('宿主来源无效', 'Invalid host origin'));
      allowedOrigins.add(parsed.origin);
    },
    async close() {
      for (const client of sseClients) {
        try { client.res.end(); } catch (_) {}
      }
      sseClients.clear();
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await new Promise(resolve => server.close(resolve));
      if (fs.existsSync(credentialFile) && JSON.parse(fs.readFileSync(credentialFile)).token === token) fs.unlinkSync(credentialFile);
    },
  };
}

async function requestProgressHttp(stateFile, route, body, port, { signal, timeoutMs = 15000 } = {}) {
  const lang = readConfiguredLang({ dataDir: stateFile ? path.dirname(stateFile) : undefined });
  const msg = (zh, en) => (lang === 'en' ? en : zh);
  const credentials = JSON.parse(fs.readFileSync(`${stateFile}.http.json`, 'utf8'));
  if (credentials.service !== 'agent-things' || credentials.version !== 1 || port && credentials.port !== port) throw new Error(msg('端口已由其他服务占用', 'Port is occupied by another service'));
  const expectedId = crypto.createHash('sha256').update(path.resolve(stateFile)).digest('hex');
  if (credentials.stateId !== expectedId) throw new Error(msg('账本服务身份不匹配', 'Ledger service identity mismatch'));
  const response = await fetch(`http://127.0.0.1:${credentials.port}${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const value = await response.json();
  if (!response.ok || value.error) throw Object.assign(new Error(value.error || (lang === 'en' ? `Local service returned HTTP ${response.status}` : `本地服务返回 ${response.status}`)), value.errorInfo || {});
  if (route === '/health' && (value.service !== 'agent-things' || value.version !== 1 || value.stateId !== expectedId)) throw new Error(msg('本地服务身份不匹配', 'Local service identity mismatch'));
  return value;
}

module.exports = { startProgressHttp, requestProgressHttp, MAX_BODY_BYTES };
