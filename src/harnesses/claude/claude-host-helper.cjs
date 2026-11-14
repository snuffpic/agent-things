'use strict';

// Serialized into the verified Claude main process. Dependencies are explicit.
function installClaudeHost({ root, credentialFile }) {
  const req = process.getBuiltinModule('module').createRequire(process.execPath);
  const fs = req('node:fs'), path = req('node:path'), crypto = req('node:crypto');
  const { webContents, app } = req('electron');
  const { transcriptTurns, pageClaudeTurns } = req(path.join(root, 'src/harnesses/claude/claude-source.cjs'));
  const { locateClaudeMessage } = req(path.join(root, 'src/harnesses/claude/claude-navigation.cjs'));
  const snapshots = new Map();
  const globalName = '__agentThingsClaudeHost';
  if (globalThis[globalName]) {
    if (globalThis[globalName].credentialFile !== credentialFile) throw new Error('当前 Claude 已连接其他账本实例，请先停止该实例');
    return { installed: true, pid: process.pid, reused: true };
  }
  const pages = new Map();
  let stopped = false, refreshing = false, lastVersion = null, source = '', resourceStamp = '';
  const handledJobs = new Set();
  const heartbeat = path.join(path.dirname(credentialFile), 'attachment-host.json');
  const binding = '__agentThingsClaudeSend';
  const eligible = w => { try { return !w.isDestroyed() && new URL(w.getURL()).origin === 'https://claude.ai'; } catch { return false; } };
  const request = async (route, body) => {
    const auth = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
    if (auth.service !== 'agent-things' || !Number.isInteger(auth.port) || auth.port < 1 || auth.port > 65535 || typeof auth.token !== 'string') throw new Error('Claude 插件服务凭据无效');
    const response = await fetch(`http://127.0.0.1:${auth.port}${route}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || '后台服务不可用'); return value;
  };
  const evaluate = (entry, expression) => entry.w.debugger.sendCommand('Runtime.evaluate', { expression, contextId: entry.contextId, returnByValue: true, awaitPromise: true });
  const unwatch = async entry => {
    if (entry.w.isDestroyed()) return;
    if (entry.contextId && entry.w.debugger.isAttached()) {
      try { await evaluate(entry, 'window.__codexSessionStatus?.destroy()'); } catch { /* A navigated document has no old world. */ }
    }
    entry.w.debugger.removeListener('message', entry.onMessage);
    entry.w.debugger.removeListener('detach', entry.onDetach);
    entry.w.removeListener('did-finish-load', entry.onLoad);
    entry.w.removeListener('destroyed', entry.onGone);
    if (entry.ownsDebugger && entry.w.debugger.isAttached()) entry.w.debugger.detach();
  };
  const install = async entry => {
    if (entry.installing || !eligible(entry.w) || entry.w.isDevToolsOpened()) return;
    entry.installing = true;
    try {
      if (!entry.w.debugger.isAttached()) { entry.w.debugger.attach('1.3'); entry.ownsDebugger = true; }
      else if (!entry.ownsDebugger) throw new Error('Claude 页面正在被其他调试器使用');
      await entry.w.debugger.sendCommand('Runtime.enable');
      const { frameTree } = await entry.w.debugger.sendCommand('Page.getFrameTree');
      const { executionContextId } = await entry.w.debugger.sendCommand('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'agent-things-claude' });
      entry.contextId = executionContextId;
      await entry.w.debugger.sendCommand('Runtime.addBinding', { name: binding, executionContextId });
      const expression = `(() => {
        const old=window.__codexSessionStatus;
        if(old?.status().version===${JSON.stringify(lastVersion)})return true;
        const saved=old?.exportForReload?.();if(saved?.busy)return false;
        const install=new Function(${JSON.stringify(source)}+'\\nreturn installCodexSessionStatus;');
        old?.destroy();install()(${JSON.stringify(lastVersion)},saved);return true;
      })()`;
      const result = await evaluate(entry, expression);
      if (result.exceptionDetails) throw new Error('Claude 界面加载失败');
      if (result.result.value) entry.version = lastVersion;
    } finally { entry.installing = false; }
  };
  const watch = w => {
    if (pages.has(w.id)) return;
    const entry = { w, contextId: null, ownsDebugger: false, installing: false };
    entry.onMessage = async (_event, method, params) => {
      if (method !== 'Runtime.bindingCalled' || params.name !== binding || params.executionContextId !== entry.contextId || !eligible(w)) return;
      if (typeof params.payload !== 'string' || Buffer.byteLength(params.payload) > 1024 * 1024) return;
      let message;
      try {
        message = JSON.parse(params.payload);
        const reply = await request('/rpc', message);
        if (!w.isDestroyed()) await evaluate(entry, `window.__codexSessionStatus?.reply(${JSON.stringify(reply)})`);
      } catch (error) {
        if (message?.requestId && !w.isDestroyed()) await evaluate(entry, `window.__codexSessionStatus?.reply(${JSON.stringify({ requestId: message.requestId, error: error.message })})`).catch(() => {});
      }
    };
    entry.onDetach = () => { entry.contextId = null; entry.version = null; entry.ownsDebugger = false; };
    entry.onLoad = () => { entry.version = null; };
    entry.onGone = () => { pages.delete(w.id); };
    w.debugger.on('message', entry.onMessage); w.debugger.on('detach', entry.onDetach);
    w.on('did-finish-load', entry.onLoad); w.once('destroyed', entry.onGone);
    pages.set(w.id, entry);
  };
  const serveJob = async job => {
    if (handledJobs.has(job.id)) return;
    handledJobs.add(job.id);
    try {
      if (job.method === 'detach') { await status.stop(); await request('/host-reply', { id: job.id, result: { detached: true } }); return; }
      if (!['session', 'turns', 'identity', 'locate'].includes(job.method) || typeof job.threadId !== 'string' || job.threadId.length > 256) throw new Error('无效宿主查询');
      const target = [...pages.values()].find(entry => eligible(entry.w));
      if (!target) throw new Error('Claude 页面尚未就绪');
      if (job.method === 'turns') {
        const options = job.options || {};
        if (typeof options.snapshotId !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(options.snapshotId)) throw new Error('Claude 分析快照身份无效');
        for (const [key, value] of snapshots) if (Date.now() - value.at > 120000) snapshots.delete(key);
        let snapshot = snapshots.get(options.snapshotId);
        if (snapshot && snapshot.threadId !== job.threadId) throw new Error('Claude 分析快照会话不匹配');
        if (!snapshot) {
          if (snapshots.size >= 8) throw new Error('同时读取的 Claude 会话过多，请稍后重试');
          const raw = await target.w.executeJavaScript(`window['claude.web'].LocalSessions.getTranscript(${JSON.stringify(job.threadId)})`);
          snapshot = { threadId: job.threadId, turns: transcriptTurns(raw), at: Date.now() };
          snapshots.set(options.snapshotId, snapshot);
        }
        snapshot.at = Date.now();
        await request('/host-reply', { id: job.id, result: pageClaudeTurns(snapshot.turns, options) });
        return;
      }
      if (job.method === 'locate') {
        if (typeof job.options?.itemId !== 'string' || !/^[\w-]{1,256}$/.test(job.options.itemId)) throw new Error('无效来源消息标识');
        const result = await target.w.executeJavaScript(`(${locateClaudeMessage.toString()})(${JSON.stringify({ threadId: job.threadId, itemId: job.options.itemId })})`);
        await request('/host-reply', { id: job.id, result });
        return;
      }
      const result = await target.w.executeJavaScript(`(async () => {
        const api=window['claude.web']?.LocalSessions;
        if(!api)throw new Error('当前 Claude 未提供会话读取接口');
        const id=${JSON.stringify(job.threadId)};
        const listed=await api.getSessionList();
        const session=(Array.isArray(listed)?listed:listed.sessions)?.find(item=>item.sessionId===id||item.id===id||item.cliSessionId===id||item.priorCliSessionIds?.includes(id));
        return session?{id:session.sessionId||session.id,cwd:session.cwd||null}:null;
      })()`);
      await request('/host-reply', { id: job.id, result });
    } catch (error) { await request('/host-reply', { id: job.id, error: error.message }).catch(() => {}); }
    finally { handledJobs.delete(job.id); }
  };
  const refresh = async () => {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const resources = [path.join(root, 'src/harnesses/claude/claude-harness.js'), path.join(root, 'src/session-status.js')];
      const stamp = resources.map(file => { const stat = fs.statSync(file); return `${stat.mtimeMs}:${stat.size}`; }).join('|');
      if (stamp !== resourceStamp) {
        source = resources.map(file => fs.readFileSync(file, 'utf8')).join('\n');
        lastVersion = crypto.createHash('sha256').update(source).digest('hex'); resourceStamp = stamp;
      }
      for (const w of webContents.getAllWebContents()) if (eligible(w)) watch(w);
      for (const entry of pages.values()) {
        if (!eligible(entry.w)) continue;
        if (entry.version !== lastVersion) await install(entry);
      }
      const snapshot = await request('/snapshot');
      const serialized = JSON.stringify(snapshot.snapshot);
      const views = [];
      for (const entry of pages.values()) if (entry.contextId) {
        const response = await evaluate(entry, `(() => {window.__codexSessionStatus?.receive(${serialized});return window.__codexSessionStatus?.status()})()`);
        if (response.exceptionDetails) throw new Error('Claude 界面状态同步失败');
        views.push({ id: entry.w.id, ...response.result.value });
      }
      status.views = views; status.lastError = null;
      const jobs = await request('/host-jobs');
      for (const job of jobs) void serveJob(job);
    } catch (error) { status.lastError = error.message; }
    finally {
      refreshing = false;
      try {
        const temporary = `${heartbeat}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ pid: process.pid, checkedAt: Date.now(), stopped, views: status.views || [], error: status.lastError }), { mode: 0o600 });
        fs.renameSync(temporary, heartbeat);
      } catch (error) { status.lastError = error.message; }
    }
  };
  const status = { pid: process.pid, credentialFile, lastError: null, stop: async () => {
    stopped = true; clearInterval(timer); app.removeListener('web-contents-created', onCreated);
    await Promise.all([...pages.values()].map(unwatch)); pages.clear(); delete globalThis[globalName];
  } };
  const onCreated = (_event, w) => { if (eligible(w)) watch(w); };
  app.on('web-contents-created', onCreated);
  const timer = setInterval(refresh, 1000);
  globalThis[globalName] = status;
  void refresh();
  return { installed: true, pid: process.pid };
}
module.exports = { installClaudeHost };
