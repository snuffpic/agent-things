'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readRendererResource } = require('../../renderer-resource.cjs');
const { createAnalysisLog, diagnosticFields } = require('../../analysis-log.cjs');
const { CdpSession, listTargets, isMainWindow, CDP_PORT } = require('../../cdp.cjs');
const npmUpdates = require('../../npm-updates.cjs');
const { requireGitRemote } = require('../../analysis-git.cjs');
const { startProgressHttp } = require('../../local-progress-http.cjs');
const { callProgressTool } = require('../../progress-tools.cjs');
const { createCodexProgressContext } = require('./codex-progress-context.cjs');

const { sessionView, PROTOCOL_VERSION } = require('../../session-view.cjs');
const { progressError, errorDetails } = require('../../progress-error.cjs');
const { readConfiguredLang, getUi } = require('../../i18n.cjs');

const BINDING = '__codexSessionStatusSend';
const HARNESS_FILE = path.join(__dirname, 'codex-harness.js');
const RENDERER_FILE = path.join(__dirname, '..', '..', 'session-status.js');

class CodexService {
  constructor({
    store,
    port = CDP_PORT,
    onError = console.error,
    rendererFile = RENDERER_FILE,
    harnessFile = HARNESS_FILE,
    logFile = path.join(path.dirname(store.file), 'analysis.jsonl'),
    updates = npmUpdates,
  }) {
    this.store = store;
    this.port = port;
    this.onError = onError;
    this.rendererFile = rendererFile;
    this.harnessFile = harnessFile;
    this.sessions = new Map();
    this.stopped = false;
    this.scanning = false;
    this.analysisService = null;
    this.logFile = logFile;
    this.log = createAnalysisLog(logFile);
    this.updates = updates;
    this.progressContext = createCodexProgressContext({ store });
    this.control = null;
    this.uiReads = new Map();
    this.stateWatcher = null;
    this.stateWatchTimer = null;
    this.snapshotLang = null;
    this.watchStateFile();
  }

  currentLang() {
    if (typeof this.store?.lang === 'function') return this.store.lang();
    return readConfiguredLang({ dataDir: this.store?.file ? path.dirname(this.store.file) : undefined });
  }

  watchStateFile() {
    if (this.stateWatcher || !this.store?.file) return;
    const dir = path.dirname(this.store.file);
    const basename = path.basename(this.store.file);
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      this.stateWatcher = fs.watch(dir, (eventType, filename) => {
        if (!filename || filename === basename || filename.startsWith(basename) || filename === 'config.json') {
          if (this.stateWatchTimer) clearTimeout(this.stateWatchTimer);
          this.stateWatchTimer = setTimeout(async () => {
            if (this.stopped) return;
            const modified = this.store.reloadIfModified();
            const langChanged = this.currentLang() !== this.snapshotLang;
            if (modified || langChanged) {
              await this.broadcast().catch(() => {});
            }
          }, 60);
        }
      });
    } catch { /* 忽略监听环境异常，依赖常规扫描轮询保底 */ }
  }

  evaluate(session, expression, timeoutMs = 5000) {
    return session.request('Runtime.evaluate', {
      expression,
      contextId: session.contextId,
      returnByValue: true,
      awaitPromise: true,
    }, timeoutMs);
  }

  resource() {
    return readRendererResource({ harnessFile: this.harnessFile, rendererFile: this.rendererFile, lang: this.currentLang() });
  }

  snapshot() {
    this.store.reloadIfModified();
    const lang = this.currentLang();
    if (this.snapshotData === this.store.data && this.snapshotLang === lang) return this.snapshotCache;
    const snapshot = this.store.snapshot();
    const data = this.store.data;
    const timelines = new Map();
    for (const event of data.timeline || []) {
      if (!timelines.has(event.key)) timelines.set(event.key, []);
      timelines.get(event.key).push(event);
    }
    const keys = new Set([...Object.keys(snapshot.records), ...Object.keys(data.analysis || {}), ...timelines.keys()]);
    const keyVersions = Object.fromEntries([...keys].map(key => [
      key, createHash('sha256').update(JSON.stringify([snapshot.records[key], data.analysis?.[key], timelines.get(key)])).digest('hex'),
    ]));
    this.snapshotData = data;
    this.snapshotLang = lang;
    return this.snapshotCache = { ...snapshot, lang, keyVersions };
  }

  async updateRenderer(session, resource = this.resource()) {
    if (session.failedVersion === resource.version) return 'failed';
    const previous = session.lastRenderer;
    const snapshot = this.snapshot();
    const { result } = await this.evaluate(session, `(() => {
      const old = window.__codexSessionStatus;
      if (old?.status()?.version === ${JSON.stringify(resource.version)}) {
        const synced = old.status().revision !== ${snapshot.revision};
        if (synced) old.receive(${JSON.stringify(snapshot)});
        return { state: 'current', synced };
      }
      if (old && !old.exportForReload && old.status()?.panelOpen) return { state: 'deferred' };
      const saved = old?.exportForReload?.() ?? window.__codexSessionStatusReloadDraft;
      if (saved?.busy) return { state: 'deferred' };
      let load;
      try { load = new Function(${JSON.stringify(resource.source)} + '\\nreturn installCodexSessionStatus;'); }
      catch (error) { return { state: 'failed', permanent: true, error: String(error) }; }

      const oldVersion = old?.status()?.version;
      if (saved) window.__codexSessionStatusReloadDraft = saved;
      old?.destroy();
      try {
        load()(${JSON.stringify(resource.version)}, saved);
        window.__codexSessionStatus.receive(${JSON.stringify(snapshot)});
        delete window.__codexSessionStatusReloadDraft;
        return { state: 'updated' };
      } catch (error) {
        try {
          window.__codexSessionStatus?.destroy();
          const rollback = ${previous ? `new Function(${JSON.stringify(previous.source)} + '\\nreturn installCodexSessionStatus;')()` : 'window.installCodexSessionStatus'};
          if (rollback) {
            rollback(oldVersion, saved);
            window.__codexSessionStatus.receive(${JSON.stringify(snapshot)});
            delete window.__codexSessionStatusReloadDraft;
          }
          return { state: 'failed', error: String(error) };
        } catch (rollbackError) {
          const rollbackPrefix = this.currentLang() === 'en' ? 'rollback failed: ' : '恢复失败：';
          return { state: 'failed', error: String(error) + '; ' + rollbackPrefix + String(rollbackError) };
        }
      }
    })()`);
    const outcome = result.value;
    if (outcome.synced || outcome.state === 'updated') {
      this.log('ui.snapshot_sync', { revision: snapshot.revision, resourceVersion: resource.version });
    }
    if (outcome.state === 'failed') {
      session.failedVersion = outcome.permanent ? resource.version : null;
      const errMsg = this.currentLang() === 'en'
        ? `Renderer ${resource.version} update failed: ${outcome.error}`
        : `渲染资源 ${resource.version} 更新失败：${outcome.error}`;
      this.onError(new Error(errMsg));
    } else if (outcome.state === 'updated' || outcome.state === 'current') {
      session.lastRenderer = resource;
      session.failedVersion = null;
    }
    return outcome.state;
  }

  async attach(target) {
    const session = new CdpSession(target, this.port);
    try {
      await session.connect();
      const { frameTree } = await session.request('Page.getFrameTree');
      const { executionContextId } = await session.request('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id,
        worldName: 'agent-things-codex',
      });
      session.contextId = executionContextId;
      session.onBinding = params => {
        if (params.name === BINDING && params.executionContextId === session.contextId) {
          this.handleMessage(session, params.payload).catch(this.onError);
        }
      };
      await session.request('Runtime.addBinding', { name: BINDING, executionContextId });
      await this.updateRenderer(session);
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  async handleMessage(session, payload) {
    let message;
    try { message = JSON.parse(payload); } catch { return; }
    if (typeof message.requestId !== 'string') return;
    let identity;
    try { identity = JSON.parse(message.key); } catch { identity = []; }
    const context = {
      requestId: message.requestId,
      requestType: message.type,
      hostId: identity?.[0],
      threadId: typeof identity?.[1] === 'string' ? identity[1].replace(/^local:/, '') : undefined,
    };
    if (message.type === 'panel-event') {
      if (this.store.validKey(message.key) && ['open', 'close', 'dispose'].includes(message.action)) {
        this.log(`panel.${message.action}`, context);
      }
      return;
    }
    if (message.type === 'cancel-request') {
      this.uiReads.get(session)?.get(message.cancelRequestId)?.abort(progressError('REQUEST_CANCELLED', undefined, undefined, this.currentLang()));
      return;
    }
    this.log('ui.request', context);
    const controller = new AbortController();
    if (!this.uiReads.has(session)) this.uiReads.set(session, new Map());
    const reads = this.uiReads.get(session);
    if (['project-git', 'analysis-state', 'app-update-info'].includes(message.type)) reads.set(message.requestId, controller);
    try {
      const reply = await this.request(message, session, { signal: controller.signal });
      await this.evaluate(session, `window.__codexSessionStatus.reply(${JSON.stringify(reply)})`);
      this.log('ui.reply', { ...context, ok: !reply.error, ...(reply.error ? diagnosticFields(reply.error) : {}) });
    } finally { reads.delete(message.requestId); if (!reads.size) this.uiReads.delete(session); }
  }

  async startControl() {
    if (this.control) return;
    this.control = await startProgressHttp({ port: 0, stateFile: this.store.file, handle: async (method, route, body, options) => {
      const lang = this.currentLang();
      if (this.stopped) throw progressError('SERVICE_STOPPING', undefined, undefined, lang);
      if (body?.protocolVersion != null && body.protocolVersion !== PROTOCOL_VERSION) throw progressError('PROTOCOL_MISMATCH', undefined, undefined, lang);
      if (method === 'GET' && route === '/snapshot') return { snapshot: this.snapshot() };
      if (method === 'GET' && route === '/session/snapshot') {
        const cleanId = (body?.conversationId || '').replace(/^local:/, '');
        const key = this.store.resolveKey(cleanId);
        return {
          session: sessionView(this.store, key, { capabilities: { locate: this.sessions.size > 0 }, lang }),
          snapshotRevision: this.snapshot()?.revision,
        };
      }
      if (method === 'POST' && route === '/rpc') return this.request(body, null, options);
      if (method === 'POST' && route === '/tools') {
        const value = await callProgressTool(this.store, body.name, body.args, {
          ...this.progressContext, projectGit: key => this.projectGit(key, options),
          resolveSources: (key, tasks) => this.progressContext.resolveSources(key, tasks, options), onChange: () => { void this.broadcast().catch(this.onError); },
          lang,
        });
        return { value };
      }
      throw new Error(lang === 'en' ? 'Unknown Codex background request' : '未知 Codex 后台请求');
    } });
  }

  async request(message, session, options = {}) {
    const lang = this.currentLang();
    const { t } = getUi(lang);
    let errorInfo = null, error = null, analysisState = null, projectGit = null, updateInfo = null, navigation = null;
    try {
      if (this.stopped) throw progressError('SERVICE_STOPPING', undefined, undefined, lang);
      if (message.type === 'panel-event') {
        if (this.store.validKey(message.key) && ['open', 'close', 'dispose'].includes(message.action)) {
          this.log(`panel.${message.action}`, { requestId: message.requestId, action: message.action });
        }
        return { protocolVersion: PROTOCOL_VERSION, requestId: message.requestId, ok: true, error: null };
      }
      if (!this.store.validKey(message.key) && !message.type?.startsWith('app-update-')) throw progressError('INVALID_ARGUMENT', undefined, undefined, lang);
      if (message.type === 'app-update-info') {
        updateInfo = await this.updates.getUpdateInfo({ force: message.force === true });
      } else if (message.type === 'app-update-start') {
        await this.updates.startUpdate();
        updateInfo = await this.updates.getUpdateInfo();
      } else if (message.type === 'update') {
        if (message.record?.state === 'pushed') requireGitRemote(await this.projectGit(message.key, options), lang);
        this.store.update(message);
      } else if (message.type === 'clear') {
        this.store.update({ key: message.key, expectedRevision: message.expectedRevision, record: null });
      } else if (message.type === 'project-git') {
        projectGit = await this.projectGit(message.key, options);
      } else if (message.type === 'analysis-state') {
        if (!this.store.validKey(message.key)) throw progressError('INVALID_ARGUMENT', undefined, undefined, lang);
        analysisState = this.store.analysisState(message.key);
      } else if (message.type === 'locate-source') {
        navigation = await this.navigateSource(message.key, message.source, session);
      } else if (message.type === 'analyze') {
        if (!this.analysisService) {
          const { createCodexAnalysis } = require('./codex-analysis.cjs');
          this.analysisService = createCodexAnalysis({
            store: this.store,
            logFile: this.logFile,
            onChange: () => this.broadcast().catch(this.onError),
          });
        }
        const { promise, runId, actionSequence } = this.analysisService.start(message.key, { requestId: message.requestId });
        this.log('analysis.request', { requestId: message.requestId, runId, actionSequence });
        promise.catch(this.onError);
        analysisState = this.store.analysisState(message.key);
      } else {
        throw progressError('CAPABILITY_UNAVAILABLE', undefined, undefined, lang);
      }
    } catch (e) { errorInfo = errorDetails(e, undefined, lang); error = errorInfo.message; }
    if (!error && ['update', 'analyze', 'clear'].includes(message.type)) void this.broadcast().catch(this.onError);
    return { protocolVersion: PROTOCOL_VERSION, requestId: message.requestId, error, errorInfo,
      ...(this.store.validKey(message.key) ? { session: sessionView(this.store, message.key, { projectGit, capabilities: { locate: this.sessions.size > 0 }, lang }) } : {}), snapshot: this.snapshot(), analysisState, projectGit, updateInfo, navigation };
  }

  async navigateSource(key, pointer, session) {
    const lang = this.currentLang();
    const { t } = getUi(lang);
    const deadline = performance.now() + 10000;
    const saved = Object.values(this.store.analysisState(key).analysis?.sources || {}).find(source =>
      typeof pointer?.turnId === 'string' && typeof pointer?.itemId === 'string' && source.turnId === pointer.turnId && source.itemId === pointer.itemId);
    if (!saved) throw progressError('SOURCE_NOT_FOUND', lang === 'en' ? 'This source does not belong to the current session task record' : '此来源不属于当前会话的任务记录', undefined, lang);
    const source = { ...saved, threadId: JSON.parse(key)[1].replace(/^local:/, '') };
    if (!session) {
      for (const candidate of this.sessions.values()) {
        const { result } = await this.evaluate(candidate, `Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-selected="true"]')).some(row => row.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^local:/, '') === ${JSON.stringify(source.threadId)})`, Math.max(1, deadline - performance.now()));
        if (result.value) { session = candidate; break; }
      }
      session ||= this.sessions.values().next().value;
    }
    if (!session) {
      throw progressError('HOST_UNAVAILABLE', lang === 'en' ? 'No Codex window available for locating; please open the thread first' : '当前没有可定位的 Codex 窗口，请先打开对应会话', undefined, lang);
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw progressError('REQUEST_TIMEOUT', t('locateTimeout'), undefined, lang);
    return this.locateSource(session, source, remaining);
  }

  async projectGit(key, options) {
    const lang = this.currentLang();
    if (!this.store.validKey(key)) throw progressError('INVALID_ARGUMENT', undefined, undefined, lang);
    const [hostId] = JSON.parse(key);
    if (hostId !== 'local') return { status: 'unknown', hasRemote: false };
    try { return await this.progressContext.projectGit(key, options); }
    catch (error) { if (options?.signal?.aborted) throw options.signal.reason; return { status: 'unknown', hasRemote: false }; }
  }

  async locateSource(session, source, timeoutMs = 10000) {
    const lang = this.currentLang();
    const { t } = getUi(lang);
    const locatedLabel = t('locatedMessage');
    const notFoundLabel = t('locateNotFound');
    const missingTextMsg = lang === 'en' ? 'Source lacks searchable text' : '来源缺少可搜索的文本';
    if (!source || typeof source.turnId !== 'string' || typeof source.itemId !== 'string' ||
        typeof source.threadId !== 'string' || typeof source.locator !== 'string' || source.locator.length < 10) {
      throw new Error(missingTextMsg);
    }
    const expression = `(async () => {
      const source = ${JSON.stringify(source)};
      const harness = window.__sessionStatusHarness;
      if (harness?.locate) {
        const dummyMsg = { textContent: '', status: '' };
        await harness.locate({ entry: { threadId: 'local:' + source.threadId, row: Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]')).find(row => row.getAttribute('data-app-action-sidebar-thread-id')?.replace(/^local:/, '') === source.threadId) || document.body }, source, analysisMessage: dummyMsg });
        if (dummyMsg.status !== 'located' && dummyMsg.textContent !== ${JSON.stringify(locatedLabel)}) return { status: 'not_found', message: dummyMsg.textContent || ${JSON.stringify(notFoundLabel)} };
        return { status: 'located', message: dummyMsg.textContent || ${JSON.stringify(locatedLabel)} };
      }
      const unitKey = CSS.escape(source.turnId + ':' + source.itemId);
      const node = document.querySelector('[data-content-search-unit-key="' + unitKey + '"]') ||
                   document.querySelector('[data-turn-key="history-content:turn:' + CSS.escape(source.turnId) + '"]');
      if (node) {
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const bubble = node.querySelector('[data-user-message-bubble]') || node;
        bubble.style.outline = '2px solid #548eea';
        setTimeout(() => { if (bubble.style.outline === '2px solid rgb(84, 142, 234)') bubble.style.outline = ''; }, 3000);
        return { status: 'located', message: ${JSON.stringify(locatedLabel)} };
      }
      return { status: 'not_found', message: ${JSON.stringify(notFoundLabel)} };
    })()`;
    const { result } = await this.evaluate(session, expression, timeoutMs);
    if (result.value?.status !== 'located') throw progressError('SOURCE_NOT_FOUND', result.value?.message || notFoundLabel, undefined, lang);
    return result.value;
  }

  async broadcast() {
    const expression = `window.__codexSessionStatus.receive(${JSON.stringify(this.snapshot())})`;
    await Promise.all([...this.sessions].map(async ([id, session]) => {
      try {
        await this.evaluate(session, expression);
      } catch {
        session.close();
        this.sessions.delete(id);
      }
    }));
    if (this.control?.broadcast) {
      const snap = this.snapshot();
      const targetKeys = new Set(Object.keys(snap?.records || {}));
      for (const recordKey of targetKeys) {
        try {
          const [, id] = JSON.parse(recordKey);
          const cleanId = String(id).replace(/^local:/, '');
          const key = this.store.resolveKey(cleanId);
          this.control.broadcast(cleanId, {
            type: 'session_update',
            session: sessionView(this.store, key, { capabilities: { locate: this.sessions.size > 0 }, lang: this.currentLang() }),
            snapshotRevision: snap?.revision,
          });
        } catch (_) {}
      }
    }
  }

  async scan() {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      const targets = (await listTargets(this.port)).filter(isMainWindow);
      const live = new Set(targets.map(t => t.id));
      for (const [id, session] of this.sessions) {
        if (!live.has(id)) {
          session.close();
          this.sessions.delete(id);
        }
      }
      for (const target of targets) {
        if (this.stopped) break;
        const existing = this.sessions.get(target.id);
        if (existing) {
          try {
            await this.updateRenderer(existing);
            continue;
          } catch { /* Navigation can replace context */ }
          existing.close();
          this.sessions.delete(target.id);
        }
        try {
          const session = await this.attach(target);
          if (this.stopped) {
            await this.evaluate(session, 'window.__codexSessionStatus?.destroy()').catch(() => {});
            session.close();
          } else {
            this.sessions.set(target.id, session);
          }
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  async stop() {
    this.stopped = true;
    for (const reads of this.uiReads.values()) for (const controller of reads.values()) controller.abort(progressError('SERVICE_STOPPING'));
    this.uiReads.clear();
    if (this.stateWatchTimer) clearTimeout(this.stateWatchTimer);
    if (this.stateWatcher) {
      try { this.stateWatcher.close(); } catch {}
      this.stateWatcher = null;
    }
    this.log('agent.stop');
    await this.analysisService?.stop();
    await this.control?.close();
    this.control = null;
    await Promise.all([...this.sessions.values()].map(async session => {
      await this.evaluate(session, 'window.__codexSessionStatus?.destroy()').catch(() => {});
      session.close();
    }));
    this.sessions.clear();
  }
}

async function attachmentStatus(port = CDP_PORT) {
  let targets;
  try {
    targets = (await listTargets(port, 1000)).filter(isMainWindow);
  } catch {
    return { portOpen: false, windows: [], mountedConversations: 0 };
  }
  const windows = await Promise.all(targets.map(async target => {
    const session = new CdpSession(target, port);
    try {
      await session.connect();
      const { frameTree } = await session.request('Page.getFrameTree');
      const { executionContextId } = await session.request('Page.createIsolatedWorld', {
        frameId: frameTree.frame.id,
        worldName: 'agent-things-codex',
      });
      const { result } = await session.request('Runtime.evaluate', {
        expression: 'window.__codexSessionStatus?.status() ?? null',
        contextId: executionContextId,
        returnByValue: true,
      });
      return { id: target.id, ...(result.value || { mounted: 0, panelOpen: false }) };
    } catch (error) {
      return { id: target.id, mounted: 0, error: error.message };
    } finally {
      session.close();
    }
  }));
  return {
    portOpen: true,
    windows,
    mountedConversations: windows.reduce((sum, window) => sum + window.mounted, 0),
  };
}

module.exports = { CodexService, BINDING, attachmentStatus };
