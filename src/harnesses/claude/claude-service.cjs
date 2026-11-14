'use strict';
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { ManualStatusStore } = require('../../manual-status-store.cjs');
const { startProgressHttp } = require('../../local-progress-http.cjs');
const { callProgressTool } = require('../../progress-tools.cjs');
const { AnalysisService } = require('../../analysis-service.cjs');
const { inspectGit, requireGitRemote } = require('../../analysis-git.cjs');
const { createAnalysisLog } = require('../../analysis-log.cjs');
const { resolveTaskSources } = require('../../task-provenance.cjs');
const updates = require('../../npm-updates.cjs');
const { ClaudeTranscriptServer } = require('./claude-source.cjs');
const { runClaudeAnalysis } = require('./claude-runner.cjs');
const { navigationResult } = require('./claude-navigation.cjs');
const { ClaudeLocalSource } = require('./claude-local-source.cjs');

const { sessionView, PROTOCOL_VERSION } = require('../../session-view.cjs');
const { errorDetails } = require('../../progress-error.cjs');

const DEFAULT_PORT = 29889;
const DEFAULT_STATE_FILE = path.join(os.homedir(), 'Library/Application Support/AgentThings/claude/manual-state.json');

class ClaudeStatusStore extends ManualStatusStore {
  resolveKey(id) {
    if (this.validKey(id)) {
      if (JSON.parse(id)[0] !== 'local') throw new Error('当前只支持本地 Claude Code 会话');
      return id;
    }
    if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new Error('请提供 Claude Desktop 会话标识');
    return JSON.stringify(['local', id.trim()]);
  }
}

class ClaudeService {
  constructor({ stateFile = DEFAULT_STATE_FILE, port = DEFAULT_PORT, run = runClaudeAnalysis, host = null, localSource = new ClaudeLocalSource() } = {}) {
    this.stateFile = stateFile; this.port = port;
    this.store = new ClaudeStatusStore(stateFile);
    this.log = createAnalysisLog(path.join(path.dirname(stateFile), 'analysis.jsonl'));
    this.jobs = new Map();
    // 侧栏弹窗请求在右侧侧栏打开卡片：按会话键暂存，由该会话的 mod 下次轮询取走。
    this.paneRequests = new Map();
    // mod 的长轮询：按会话键挂起，弹窗请求一到立即回复，免去轮询间隔。
    this.paneWaiters = new Map();
    // 同会话多入口同步：每个会话记录最后一次变化时的账本修订号，按会话唤醒长等待（不同会话互不唤醒）。
    this.keyChanges = new Map(); this.keySignatures = new Map(); this.watchers = new Map(); this.loggedReads = new Map();
    this.watchStartRevision = 0;
    // 所有写入都经最外层 transaction（write 自身也会进入 transaction）：在其结束后比对各会话的变化。
    const transaction = this.store.transaction.bind(this.store);
    this.store.transaction = operation => {
      const outermost = !this.store.writing;
      try { return transaction(operation); } finally { if (outermost) this.detectChanges(); }
    };
    this.localSource = localSource;
    this.host = host || ((method, threadId, options) => {
      if (['session', 'identity'].includes(method)) {
        const session = this.localSource.resolve(threadId);
        if (session) return Promise.resolve({ id: session.sessionId, cwd: session.cwd });
      }
      return this.requestHost(method, threadId, options);
    });
    this.makeServer = () => host ? new ClaudeTranscriptServer(this.host) : this.localSource.server(new ClaudeTranscriptServer(this.host));
    this.analysis = new AnalysisService({ store: this.store, logFile: path.join(path.dirname(stateFile), 'analysis.jsonl'), makeServer: this.makeServer, run });
  }
  requestHost(method, threadId, options) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.jobs.delete(id); reject(new Error('Claude 界面连接不可用，请检查插件挂载状态')); }, 20000);
      this.jobs.set(id, { id, method, threadId, options, resolve, reject, timer });
    });
  }
  async projectGit(key) {
    if (!this.store.validKey(key)) throw new Error('无效会话标识');
    const session = await this.host('session', JSON.parse(key)[1]);
    if (!session?.cwd) return { status: 'checked', hasRepository: false, hasRemote: false, projectKnown: true, projectPath: null };
    return { ...await inspectGit(session.cwd), projectKnown: true, projectPath: session.cwd };
  }
  async tools(name, args) {
    if (args?.conversation_id && !this.store.validKey(args.conversation_id)) {
      const identity = await this.host('identity', args.conversation_id);
      if (!identity?.id) throw new Error('无法匹配 Claude Desktop 会话身份，请使用宿主的会话标识');
      args = { ...args, conversation_id: JSON.stringify(['local', identity.id]) };
    }
    return callProgressTool(this.store, name, args, { projectGit: key => this.projectGit(key), resolveProjects: async keys => {
      const result = {};
      for (const key of keys) { const session = await this.host('session', JSON.parse(key)[1]); if (session) result[key] = session.cwd || null; }
      return result;
    }, resolveSources: async (key, tasks) => {
      const server = this.makeServer();
      try { return await resolveTaskSources(server.request.bind(server), key, tasks); }
      finally { await server.close(); }
    } });
  }
  async locateSource(session, itemId) {
    if (!session || typeof itemId !== 'string' || !/^[\w-]{1,256}$/.test(itemId) || !await this.localSource.message(session, itemId)) throw new Error('未找到来源消息');
    return navigationResult(await this.requestHost('locate', session.sessionId, { itemId }));
  }
  async rpc(message) {
    if (!message || typeof message.requestId !== 'string') throw new Error('无效请求');
    let errorInfo = null, error = null, projectGit = null, analysisState = null, updateInfo = null, pane = null;
    try {
      if (message.type === 'list') { /* Return the current snapshot. */ }
      else if (message.type === 'panel-event') this.log(`panel.${message.action}`, { key: message.key });
      else if (message.type === 'open-pane') {
        if (!this.store.validKey(message.key) || JSON.parse(message.key)[0] !== 'local') throw new Error('无效 Claude 会话标识');
        pane = { delivered: await this.deliverPane(message.key, 4000) };
      }
      else if (message.type === 'app-update-info') updateInfo = await updates.getUpdateInfo({ force: message.force === true });
      else if (message.type === 'app-update-start') { await updates.startUpdate(); updateInfo = await updates.getUpdateInfo(); }
      else {
        if (!this.store.validKey(message.key) || JSON.parse(message.key)[0] !== 'local') throw new Error('无效 Claude 会话标识');
        if (message.type === 'update') {
          if (message.record?.state === 'pushed') requireGitRemote(await this.projectGit(message.key));
          this.store.update(message);
        } else if (message.type === 'project-git') projectGit = await this.projectGit(message.key);
        else if (message.type === 'locate-source') {
          const session = this.localSource.resolve(JSON.parse(message.key)[1]);
          const result = await this.locateSource(session, message.source?.itemId);
          return { requestId: message.requestId, navigation: result };
        }
        else if (message.type === 'analysis-state') { analysisState = this.store.analysisState(message.key); this.log('sync.panel_read', { key: message.key, revision: analysisState.revision }); }
        else if (message.type === 'analyze') {
          const job = this.analysis.start(message.key, { requestId: message.requestId });
          job.promise.catch(failure => this.log('analysis.error', { error: failure.message }));
          analysisState = this.store.analysisState(message.key);
        } else throw new Error('未知操作');
      }
    } catch (failure) { errorInfo = errorDetails(failure); error = failure.message; }
    return { protocolVersion: PROTOCOL_VERSION, requestId: message.requestId, error, errorInfo,
      ...(this.store.validKey(message.key) && JSON.parse(message.key)[0] === 'local' ? { session: sessionView(this.store, message.key, { projectGit, capabilities: { locate: true } }) } : {}), snapshot: this.syncSnapshot(), projectGit, analysisState, updateInfo, ...(pane ? { pane } : {}) };
  }
  async inline(message) {
    const session = this.localSource.resolve(message.sessionId, message.cwd);
    if (!session) throw new Error('未找到当前 Claude Code 会话的本地身份');
    const key = JSON.stringify(['local', session.sessionId]);
    if (message.action === 'pane-poll') return { paneRequested: this.takePaneRequest(key) };
    if (message.action === 'pane-wait') return { paneRequested: await this.waitPaneRequest(key, message.waitMs) };
    if (message.action === 'watch') {
      const started = Date.now(), result = await this.watch(key, message.since, message.waitMs);
      if (result.changed || result.paneRequested) this.log('watch.wake', { revision: this.store.data.revision, elapsedMs: Date.now() - started, ok: result.changed });
      return { ...result, revision: this.store.data.revision };
    }
    let source = null;
    if (message.action === 'source' || message.action === 'locate') {
      const task = this.store.getProgress(key)?.tasks.find(task => task.id === message.taskId);
      if (!task?.source) throw new Error('此任务没有来源记录');
      source = { ...task.source, title: task.title };
      if (message.action === 'locate') return { navigation: await this.locateSource(session, source.itemId) };
      const original = await this.localSource.message(session, source.itemId);
      source.text = original?.text || source.locator || '';
      source.occurredAt = original?.occurredAt || null;
    } else if (message.action === 'save' || message.action === 'clear') {
      const reply = await this.rpc({ type: 'update', key, requestId: message.requestId,
        expectedRevision: message.expectedRevision, record: message.action === 'clear' ? null : message.record });
      if (reply.error) throw Object.assign(new Error(reply.error), reply.errorInfo || {});
    } else if (message.action === 'analyze') {
      const reply = await this.rpc({ type: 'analyze', key, requestId: message.requestId });
      if (reply.error) throw Object.assign(new Error(reply.error), reply.errorInfo || {});
    } else if (message.action === 'update-info' || message.action === 'upgrade') {
      const reply = await this.rpc({ type: message.action === 'upgrade' ? 'app-update-start' : 'app-update-info', requestId: message.requestId });
      if (reply.error) throw Object.assign(new Error(reply.error), reply.errorInfo || {});
      return { updateInfo: reply.updateInfo };
    } else if (message.action !== 'read') throw new Error('未知卡片操作');
    const projection = this.store.readSessionProjection(key);
    // 只记每个会话读到新修订号的那一次：旧版插件每 2 秒轮询，逐次记录会刷满日志并冲掉验收记录。
    if (message.action === 'read' && this.loggedReads.get(key) !== projection.revision) { this.loggedReads.set(key, projection.revision); this.log('sync.inline_read', { revision: projection.revision }); }
    return { session: sessionView(this.store, key, { capabilities: { locate: true }, projection }), key, title: session.title || '会话进度', record: projection.record,
      revision: projection.revision, paneRequested: this.takePaneRequest(key), analysis: projection.analysis ? { ledger: { ...projection.analysis.ledger, tasks: projection.activeTasks } } : null, timeline: projection.timelineSummary, source,
      ...(message.action === 'read' && message.includeGit ? { projectGit: await this.projectGit(key) } : {}) };
  }
  waitPaneRequest(key, waitMs) {
    if (this.takePaneRequest(key)) return Promise.resolve(true);
    const limit = Math.min(Math.max(Number(waitMs) || 20000, 0), 25000);
    return new Promise(resolve => {
      const waiters = this.paneWaiters.get(key) || new Set();
      const wake = value => { clearTimeout(timer); waiters.delete(wake); if (!waiters.size && this.paneWaiters.get(key) === waiters) this.paneWaiters.delete(key); resolve(value); };
      const timer = setTimeout(() => wake(false), limit);
      waiters.add(wake); this.paneWaiters.set(key, waiters);
    });
  }
  keySignature(data, key) {
    const timeline = (data.timeline || []).filter(item => item.key === key)
      .map(item => [item.actionSequence, item.status, item.stage, item.error || null, item.finishedAt || null]);
    return crypto.createHash('sha1').update(JSON.stringify([data.records?.[key] || null, data.analysis?.[key] || null, timeline])).digest('base64');
  }
  detectChanges() {
    const data = this.store.data, keys = new Set([...Object.keys(data.records || {}), ...Object.keys(data.analysis || {}),
      ...(data.timeline || []).map(item => item.key), ...this.keySignatures.keys()]);
    for (const key of keys) {
      const signature = this.keySignature(data, key);
      if (this.keySignatures.get(key) === signature) continue;
      const known = this.keySignatures.has(key);
      this.keySignatures.set(key, signature);
      if (!known && !this.watchStarted) continue;
      this.keyChanges.set(key, data.revision);
      this.log('sync.change', { revision: data.revision, sent: this.watchers.get(key)?.size || 0 });
      this.wakeWatchers(key, { changed: true });
    }
  }
  // 快照附带单会话数据版本：弹窗据此补读任务列表（任务来源等记录之外的变化也算）。未变过的会话取启动时修订号。
  syncSnapshot() {
    return { ...this.store.snapshot(), keyVersionBase: this.watchStartRevision, keyVersions: Object.fromEntries(this.keyChanges) };
  }
  // 某会话自 since 之后是否变过：启动前的变化以启动时修订号计，令重连的客户端补读一次。
  changedSince(key, since) {
    const at = this.keyChanges.get(key) ?? this.watchStartRevision;
    return Number.isInteger(since) ? at > since : true;
  }
  wakeWatchers(key, result) {
    const set = this.watchers.get(key);
    if (!set?.size) return false;
    this.watchers.delete(key);
    for (const wake of [...set]) wake(result);
    return true;
  }
  watch(key, since, waitMs) {
    if (this.takePaneRequest(key)) return Promise.resolve({ changed: this.changedSince(key, since), paneRequested: true });
    if (this.changedSince(key, since)) return Promise.resolve({ changed: true, paneRequested: false });
    const limit = Math.min(Math.max(Number(waitMs) || 20000, 0), 25000);
    return new Promise(resolve => {
      const set = this.watchers.get(key) || new Set();
      const wake = (result = {}) => { clearTimeout(timer); set.delete(wake); if (!set.size && this.watchers.get(key) === set) this.watchers.delete(key);
        resolve({ changed: Boolean(result.changed), paneRequested: Boolean(result.paneRequested) }); };
      const timer = setTimeout(() => wake({}), limit);
      set.add(wake); this.watchers.set(key, set);
    });
  }
  // 交给该会话的 mod：有长轮询在等就立即送达；否则暂存 60 秒，并最多等 graceMs 看 mod 是否上线取走。
  deliverPane(key, graceMs) {
    if (this.wakeWatchers(key, { paneRequested: true })) return Promise.resolve(true);
    const waiters = this.paneWaiters.get(key);
    if (waiters?.size) { this.paneWaiters.delete(key); for (const wake of [...waiters]) wake(true); return Promise.resolve(true); }
    this.paneRequests.get(key)?.settle(false);
    return new Promise(resolve => {
      const entry = { at: Date.now(), settle: value => { clearTimeout(timer); entry.settle = () => {}; resolve(value); } };
      const timer = setTimeout(() => entry.settle(false), graceMs);
      this.paneRequests.set(key, entry);
    });
  }
  takePaneRequest(key) {
    const entry = this.paneRequests.get(key);
    if (!entry) return false;
    this.paneRequests.delete(key);
    const fresh = Date.now() - entry.at < 60000;
    entry.settle(fresh);
    return fresh;
  }
  startWatching() {
    this.detectChanges();
    this.watchStarted = true; this.watchStartRevision = this.store.data.revision;
    // 兜底：其他进程直接写账本文件时也能发现（仅 stat，未变化时不读文件）。
    this.changeTimer = setInterval(() => { try { if (this.store.reloadIfModified()) this.detectChanges(); } catch { /* Next tick retries. */ } }, 300);
    this.changeTimer.unref?.();
  }
  async start() {
    this.http = await startProgressHttp({ port: this.port, stateFile: this.stateFile, handle: async (method, route, body) => {
      if (method === 'GET' && route === '/snapshot') return { snapshot: this.syncSnapshot() };
      if (method === 'GET' && route === '/host-jobs') return [...this.jobs.values()].map(({ id, method, threadId, options }) => ({ id, method, threadId, options }));
      if (method === 'POST' && route === '/host-reply') {
        const job = this.jobs.get(body.id);
        if (job) { this.jobs.delete(body.id); clearTimeout(job.timer); body.error ? job.reject(new Error(body.error)) : job.resolve(body.result); }
        return { ok: true };
      }
      if (method === 'POST' && route === '/rpc') return this.rpc(body);
      if (method === 'POST' && route === '/inline') return this.inline(body);
      if (method === 'POST' && route === '/tools') return { result: await this.tools(body.name, body.args) };
      throw new Error('未知服务路径');
    } });
    this.store.recoverPending();
    this.startWatching();
    return this.http.credentials.port;
  }
  async stop() {
    for (const job of this.jobs.values()) { clearTimeout(job.timer); job.reject(new Error('Claude 后台服务已停止')); }
    for (const waiters of [...this.paneWaiters.values()]) for (const wake of [...waiters]) wake(false);
    for (const entry of this.paneRequests.values()) entry.settle(false);
    clearInterval(this.changeTimer);
    for (const set of [...this.watchers.values()]) for (const wake of [...set]) wake({});
    this.jobs.clear(); await this.analysis.stop(); await this.http?.close();
  }
}
module.exports = { ClaudeService, ClaudeStatusStore, DEFAULT_PORT, DEFAULT_STATE_FILE };
