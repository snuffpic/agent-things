'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { cleanTranscriptMessage, appendCleanMessage, pageClaudeTurns } = require('./claude-source.cjs');

async function* entries(file) {
  const size = fs.statSync(file).size;
  if (!size) return;
  let pending = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', end: size - 1 })) {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (pending.trim()) {
    let entry;
    try { entry = JSON.parse(pending); } catch { return; } // Incomplete trailing write lies outside this snapshot.
    yield entry;
  }
}

class ClaudeLocalSource {
  constructor({ home = os.homedir() } = {}) { this.home = home; this.loadedAt = 0; this.sessions = []; this.fileCache = new Map(); }
  loadSessions() {
    if (Date.now() - this.loadedAt < 2000) return this.sessions;
    const root = path.join(this.home, 'Library/Application Support/Claude/claude-code-sessions');
    const sessions = [], seen = new Set();
    if (fs.existsSync(root)) for (const account of fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())) {
      const accountDir = path.join(root, account.name);
      for (const org of fs.readdirSync(accountDir, { withFileTypes: true }).filter(item => item.isDirectory())) {
        const directory = path.join(accountDir, org.name);
        for (const file of fs.readdirSync(directory)) {
          if (!/^local_[\w-]+\.json$/.test(file)) continue;
          const filePath = path.join(directory, file);
          seen.add(filePath);
          const stat = fs.statSync(filePath);
          const cached = this.fileCache.get(filePath);
          let session;
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            session = cached.session;
          } else {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            session = data.sessionId && data.cliSessionId ? data : null;
            this.fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, session });
          }
          if (session) sessions.push(session);
        }
      }
    }
    for (const filePath of this.fileCache.keys()) {
      if (!seen.has(filePath)) this.fileCache.delete(filePath);
    }
    this.sessions = sessions; this.loadedAt = Date.now(); return sessions;
  }
  resolve(id, cwd) {
    if (typeof id !== 'string' || !/^[\w-]{1,256}$/.test(id)) throw new Error('Claude 会话身份无效');
    const matches = this.loadSessions().filter(item => item.sessionId === id || item.cliSessionId === id || item.priorCliSessionIds?.includes(id));
    const exact = matches.length > 1 && cwd ? matches.filter(item => item.cwd === cwd || item.originCwd === cwd) : matches;
    if (exact.length > 1) throw new Error('Claude 会话身份匹配不唯一');
    return exact[0] || null;
  }
  transcriptFile(session) {
    const projects = path.join(this.home, '.claude/projects');
    if (!fs.existsSync(projects)) throw new Error('Claude 本地会话目录不存在');
    const names = fs.readdirSync(projects, { withFileTypes: true }).filter(item => item.isDirectory());
    const files = names.map(item => path.join(projects, item.name, `${session.cliSessionId}.jsonl`)).filter(file => fs.existsSync(file));
    if (files.length !== 1) throw new Error(files.length ? 'Claude 会话文件匹配不唯一' : '未找到此会话的本地历史文件');
    return files[0];
  }
  async message(session, itemId) {
    for await (const entry of entries(this.transcriptFile(session))) if (entry.uuid === itemId) return cleanTranscriptMessage(entry);
    return null;
  }
  async turns(session) {
    const messages = new Map();
    for await (const entry of entries(this.transcriptFile(session))) {
      if (!['user', 'assistant'].includes(entry.type) || !entry.uuid) continue;
      const clean = cleanTranscriptMessage(entry);
      if (clean) messages.set(clean.id, clean);
    }
    const turns = [];
    for (const message of messages.values()) appendCleanMessage(turns, message);
    return turns;
  }
  server(fallback) {
    const source = this;
    let session = null, turns = null;
    return {
      async initialize() {}, async close() { turns = null; await fallback?.close(); },
      async request(method, params) {
        session ||= source.resolve(params.threadId);
        if (!session && fallback) return fallback.request(method, params);
        if (!session) throw new Error('未找到 Claude 本地会话身份');
        if (method === 'thread/read') return { thread: { id: params.threadId, cwd: session.cwd } };
        if (method !== 'thread/turns/list') throw new Error('Claude 数据源不支持此方法');
        turns ||= await source.turns(session);
        return pageClaudeTurns(turns, params);
      },
    };
  }
}
module.exports = { ClaudeLocalSource };
