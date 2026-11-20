'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { ManualStatusStore } = require('../../manual-status-store.cjs');
const { AnalysisService } = require('../../analysis-service.cjs');
const { sessionView } = require('../../session-view.cjs');
const { callProgressTool } = require('../../progress-tools.cjs');
const { createAnalysisLog } = require('../../analysis-log.cjs');
const { inspectGit, requireGitRemote } = require('../../analysis-git.cjs');
const { normalizeProjectPath } = require('../../project-path.cjs');
const { progressError, errorDetails } = require('../../progress-error.cjs');
const { readConfiguredLang, normalizeLang, formatSessionMarkdownSummary, getUi } = require('../../i18n.cjs');
const { FULL_PASS_MAX_BYTES, FULL_PASS_TOKEN_BUDGET } = require('../../analysis-budget.cjs');
const { readDshSessionSnapshot, buildItemCoordinateIndex, DshTranscriptServer } = require('./dsh-source.cjs');
const {
  runDshAnalysis,
  resolveDefaultAnalysisConfigFile,
  readAnalysisConfig,
  writeAnalysisConfig,
  discoverModelCatalog,
} = require('./dsh-runner.cjs');

const API_PREFIX = '/api/agent-things';
const EXTERNAL_IMPORT_PREFIX_RE = /^\s*(?:\[external_agent_tool_|<EXTERNAL SESSION IMPORTED>)/;
const MAX_SESSION_CACHE_ENTRIES = 200;

function setBoundedMapEntry(map, key, value, limit = MAX_SESSION_CACHE_ENTRIES) {
  if (!(map instanceof Map) || key == null) return value;
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  return value;
}

const PKG_VERSION = (() => {
  for (const rel of ['../../../package.json', '../../package.json']) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, rel), 'utf8'));
      if (pkg?.version) return String(pkg.version);
    } catch { /* try next candidate */ }
  }
  return '';
})();

function resolveDefaultDshHome({ env = process.env } = {}) {
  if (env?.DSH_HOME && env.DSH_HOME.trim()) {
    return path.resolve(env.DSH_HOME.trim());
  }
  return path.join(env?.HOME || os.homedir(), '.dsh');
}

function resolveDefaultDshStateFile({ dshHome, platform = process.platform, env = process.env } = {}) {
  if (env?.AGENT_THINGS_DSH_STATE && env.AGENT_THINGS_DSH_STATE.trim()) {
    return path.resolve(env.AGENT_THINGS_DSH_STATE.trim());
  }
  if (platform === 'darwin') {
    return path.join(env?.HOME || os.homedir(), 'Library', 'Application Support', 'AgentThings', 'deepseek', 'manual-state.json');
  }
  return path.join(dshHome || resolveDefaultDshHome({ env }), 'agent-things', 'manual-state.json');
}

function normalizeMessageText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function turnItemText(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.type === 'userMessage') {
    const text = (item.content || []).filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
    return EXTERNAL_IMPORT_PREFIX_RE.test(text) ? '' : text;
  }
  if (item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase == null)) {
    const text = typeof item.text === 'string' ? item.text : '';
    return EXTERNAL_IMPORT_PREFIX_RE.test(text) ? '' : text;
  }
  return '';
}

class DshStatusStore extends ManualStatusStore {
  constructor(file, { lang, onCommitted } = {}) {
    super(file, { lang });
    this._onCommitted = onCommitted || null;
  }

  _hasKeyData(key) {
    const data = this.data || {};
    return Object.hasOwn(data.records || {}, key)
      || Object.hasOwn(data.analysis || {}, key)
      || (Array.isArray(data.timeline) && data.timeline.some(item => item?.key === key));
  }

  resolveKey(convId) {
    this.reloadIfModified();
    const en = (typeof this.lang === 'function' ? this.lang() : this._lang) === 'en';
    if (typeof convId !== 'string' || !convId.trim()) {
      throw progressError('INVALID_ARGUMENT', en ? 'Please provide a session identifier' : '请指定会话标识', false, en ? 'en' : 'zh');
    }
    const raw = convId.trim();
    if (this.validKey(raw)) {
      const [host] = JSON.parse(raw);
      if (host !== 'local') {
        throw progressError('INVALID_ARGUMENT', en ? 'Only local DeepSeek sessions are supported right now' : '当前只支持本机 DeepSeek 会话', false, en ? 'en' : 'zh');
      }
      return raw;
    }
    const cleanId = raw.replace(/^local:/, '');
    if (!cleanId) {
      throw progressError('INVALID_ARGUMENT', en ? 'Please provide a session identifier' : '请指定会话标识', false, en ? 'en' : 'zh');
    }
    const direct = JSON.stringify(['local', cleanId]);
    if (this._hasKeyData(direct)) return direct;
    const prefixed = JSON.stringify(['local', `local:${cleanId}`]);
    if (this._hasKeyData(prefixed)) return prefixed;
    return direct;
  }

  write(next) {
    const wasWriting = Boolean(this.writing);
    const snapshot = super.write(next);
    if (wasWriting && this._onCommitted) {
      queueMicrotask(() => {
        try { this._onCommitted(); } catch { /* listener errors stay isolated */ }
      });
    }
    return snapshot;
  }
}

class DshService {
  constructor({
    ctx = null,
    stateFile = resolveDefaultDshStateFile(),
    logFile = null,
    bridgeFile = null,
    analysisConfigFile = null,
    loadSnapshot = null,
    runAnalysis = null,
    inspectGitFn = inspectGit,
    maxBytes = FULL_PASS_MAX_BYTES,
    tokenBudget = FULL_PASS_TOKEN_BUDGET,
    getLang = null,
  } = {}) {
    this.ctx = ctx;
    this.stateFile = path.resolve(stateFile);
    this.logFile = path.resolve(logFile || path.join(path.dirname(this.stateFile), 'analysis.log.jsonl'));
    this.bridgeFile = path.resolve(bridgeFile || path.join(path.dirname(this.stateFile), 'bridge.json'));
    this.analysisConfigFile = path.resolve(analysisConfigFile || resolveDefaultAnalysisConfigFile(this.stateFile));
    this.getLang = typeof getLang === 'function' ? getLang : null;
    this.inspectGitFn = inspectGitFn;
    this.stopped = false;

    this.subscribers = new Set();
    this.sseCleanups = new Set();
    this.keySignatures = new Map();
    this.keyChanges = new Map();
    this.keyVersionSeq = 0;
    this.watchStartRevision = 0;
    this.watchStarted = false;
    this.lastLang = null;
    this.changeTimer = null;

    this.latestRoutes = new Map();
    this.sessionCwds = new Map();
    this.latestSnapshots = new Map();
    this.analysisLog = createAnalysisLog(this.logFile);
    this.bridgeServer = null;
    this.bridgeCredentials = null;

    this.store = new DshStatusStore(this.stateFile, {
      onCommitted: () => this.detectChanges(),
    });
    this.store._lang = null;
    this.store.lang = () => this.currentLang();

    this.loadSnapshot = loadSnapshot || (sessionId => readDshSessionSnapshot(this.ctx, sessionId));
    const customRunner = runAnalysis;

    this.analysis = new AnalysisService({
      store: this.store,
      logFile: this.logFile,
      inspectGitFn: this.inspectGitFn,
      maxBytes,
      tokenBudget,
      lang: () => this.currentLang(),
      onChange: () => this.detectChanges(),
      makeServer: () => new DshTranscriptServer(async sessionId => {
        const snap = await this.loadSnapshot(sessionId);
        if (snap?.latestRoute) setBoundedMapEntry(this.latestRoutes, sessionId, snap.latestRoute);
        if (typeof snap?.cwd === 'string' && path.isAbsolute(snap.cwd)) {
          setBoundedMapEntry(this.sessionCwds, sessionId, snap.cwd);
        }
        if (snap) setBoundedMapEntry(this.latestSnapshots, sessionId, snap);
        return snap;
      }),
      run: async params => {
        const activeJob = [...(this.analysis?.active?.values() || [])]
          .find(job => job?.controller?.signal === params.signal);
        const sessionId = activeJob?.key ? this.sessionIdFromKey(activeJob.key) : null;
        const sessionRoute = sessionId ? this.latestRoutes.get(sessionId) || null : null;
        const analysisConfig = readAnalysisConfig(this.analysisConfigFile);
        if (customRunner) {
          return customRunner({ ...params, ctx: this.ctx, sessionId, sessionRoute, analysisConfig });
        }
        return runDshAnalysis({
          ...params,
          ctx: this.ctx,
          sessionId,
          sessionRoute,
          analysisConfig,
          analysisConfigFile: this.analysisConfigFile,
        });
      },
    });
  }

  findActiveJob(key) {
    if (!key) return null;
    for (const job of this.analysis?.active?.values() || []) {
      if (job?.key === key) return job;
    }
    return null;
  }

  activeKeys() {
    const keys = [];
    const seen = new Set();
    for (const job of this.analysis?.active?.values() || []) {
      if (job?.key && !seen.has(job.key)) {
        seen.add(job.key);
        keys.push(job.key);
      }
    }
    return keys;
  }

  currentLang(override) {
    const explicit = normalizeLang(override);
    if (explicit) return explicit;
    if (this.getLang) {
      const fromHost = normalizeLang(this.getLang());
      if (fromHost) return fromHost;
    }
    return readConfiguredLang({ dataDir: path.dirname(this.stateFile) });
  }

  resolveSessionId(rawId) {
    const value = String(rawId || '').trim();
    if (!value) {
      const en = this.currentLang() === 'en';
      throw progressError('INVALID_ARGUMENT', en ? 'Session ID is required' : '请提供有效的会话标识', false, this.currentLang());
    }
    if (this.store.validKey(value)) {
      const parsed = JSON.parse(value);
      return String(parsed[1]).replace(/^local:/, '');
    }
    return value.replace(/^local:/, '');
  }

  sessionIdFromKey(key) {
    if (!this.store.validKey(key)) return String(key || '').replace(/^local:/, '');
    const parsed = JSON.parse(key);
    return String(parsed[1]).replace(/^local:/, '');
  }

  keyForSession(rawId) {
    if (typeof rawId === 'string' && this.store.validKey(rawId)) return rawId;
    const sessionId = this.resolveSessionId(rawId);
    return this.store.resolveKey(sessionId);
  }

  handleSessionEvent(session, event) {
    if (!session?.id || !event || typeof event !== 'object') return;
    const rawCwd = session.header?.cwd;
    if (typeof rawCwd === 'string' && path.isAbsolute(rawCwd)) {
      setBoundedMapEntry(this.sessionCwds, session.id, rawCwd);
    }
    if (event.type === 'request/header') {
      const cfg = event.data?.header?.config;
      if (cfg && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
        setBoundedMapEntry(this.latestRoutes, session.id, {
          provider: cfg.provider,
          model: cfg.model,
          ...(typeof cfg.reasoningEffort === 'string' ? { reasoningEffort: cfg.reasoningEffort } : {}),
        });
      }
    }
  }

  async resolveCwdForSession(sessionId) {
    if (this.sessionCwds.has(sessionId)) return this.sessionCwds.get(sessionId);
    const live = this.ctx?.get?.('sessions')?.get?.(sessionId) ?? this.ctx?.sessions?.get?.(sessionId);
    if (typeof live?.header?.cwd === 'string' && path.isAbsolute(live.header.cwd)) {
      setBoundedMapEntry(this.sessionCwds, sessionId, live.header.cwd);
      return live.header.cwd;
    }
    try {
      const snap = await this.loadSnapshot(sessionId);
      if (snap?.latestRoute) setBoundedMapEntry(this.latestRoutes, sessionId, snap.latestRoute);
      if (snap) setBoundedMapEntry(this.latestSnapshots, sessionId, snap);
      if (typeof snap?.cwd === 'string' && path.isAbsolute(snap.cwd)) {
        setBoundedMapEntry(this.sessionCwds, sessionId, snap.cwd);
        return snap.cwd;
      }
    } catch { /* cold session may not exist yet */ }
    return null;
  }

  deriveSessionTitle(sessionId, cachedSnap = null) {
    const live = this.ctx?.get?.('sessions')?.get?.(sessionId) ?? this.ctx?.sessions?.get?.(sessionId);
    const headerTitle = [
      live?.title,
      live?.header?.title,
      live?.header?.name,
      cachedSnap?.header?.title,
      cachedSnap?.header?.name,
    ].find(value => typeof value === 'string' && value.trim());
    if (headerTitle) return headerTitle.trim().slice(0, 120);
    const firstUser = (cachedSnap?.turns || [])
      .flatMap(turn => turn?.items || [])
      .find(item => item?.type === 'userMessage' && turnItemText(item).trim());
    if (firstUser) {
      const normalized = normalizeMessageText(turnItemText(firstUser));
      if (normalized) return normalized.slice(0, 80);
    }
    return '';
  }

  async inspectSessionGit(sessionId) {
    const cwd = await this.resolveCwdForSession(sessionId);
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      return {
        status: 'checked',
        hasRepository: false,
        hasRemote: false,
        projectPath: null,
        projectKnown: false,
        checkedAt: Date.now(),
      };
    }
    const git = await this.inspectGitFn(cwd);
    return {
      ...git,
      projectPath: normalizeProjectPath(cwd),
      projectKnown: true,
      checkedAt: Date.now(),
    };
  }

  async resolveProjects(keys) {
    const updates = {};
    for (const key of keys) {
      try {
        const sessionId = this.sessionIdFromKey(key);
        const cwd = await this.resolveCwdForSession(sessionId);
        if (cwd) updates[key] = cwd;
      } catch { /* skip unreadable session */ }
    }
    return updates;
  }

  async resolveSources(key, tasks) {
    const lang = this.currentLang();
    const en = lang === 'en';
    if (!tasks.some(task => task.source)) return tasks.map(() => null);
    const sessionId = this.sessionIdFromKey(key);
    const pending = tasks.map(task => {
      const ref = task.source || null;
      if (ref && (typeof ref.locator !== 'string' || normalizeMessageText(ref.locator).length < 10 || ref.locator.length > 240)) {
        throw progressError('INVALID_ARGUMENT', en ? 'Task source locator must be 10-240 characters' : '任务来源原文应为 10 至 240 个字符', false, lang);
      }
      return ref;
    });
    const snap = await this.loadSnapshot(sessionId);
    const matches = tasks.map(() => []);
    for (const turn of snap?.turns || []) {
      for (const item of turn.items || []) {
        const text = turnItemText(item);
        if (!text) continue;
        const clean = normalizeMessageText(text);
        pending.forEach((ref, index) => {
          if (!ref || (ref.turnId && ref.turnId !== turn.id) || (ref.itemId && ref.itemId !== item.id)) return;
          if (clean.includes(normalizeMessageText(ref.locator))) {
            matches[index].push({
              hostId: 'local',
              threadId: sessionId,
              turnId: turn.id,
              turn: turn.turn ?? null,
              seq: item.seq ?? null,
              itemId: item.id,
              locator: ref.locator.trim(),
              turnStartedAt: turn.startedAt ?? null,
              turnCompletedAt: turn.completedAt ?? null,
            });
          }
        });
      }
    }
    return matches.map((candidates, index) => {
      if (candidates.length === 1) return candidates[0];
      if (!tasks[index].source) return null;
      throw progressError(
        'SOURCE_NOT_FOUND',
        candidates.length
          ? (en ? `Task ${index + 1} matched multiple messages; provide turnId and itemId` : `第 ${index + 1} 项任务来源匹配多条消息，请补充 turnId 和 itemId`)
          : (en ? `Task ${index + 1} source was not found in this session` : `第 ${index + 1} 项任务来源未在本会话中找到，请核对原文`),
        false,
        lang,
      );
    });
  }

  keySignature(data, key) {
    const timeline = (data.timeline || [])
      .filter(item => item.key === key)
      .map(item => [item.actionSequence, item.status, item.stage, item.error || null, item.finishedAt || null, item.batch || null, item.stats || null]);
    return crypto.createHash('sha1')
      .update(JSON.stringify([data.records?.[key] || null, data.analysis?.[key] || null, timeline]))
      .digest('base64');
  }

  detectChanges() {
    const data = this.store.data;
    const keys = new Set([
      ...Object.keys(data.records || {}),
      ...Object.keys(data.analysis || {}),
      ...(data.timeline || []).map(item => item.key),
      ...this.keySignatures.keys(),
    ]);
    const changedKeys = [];
    for (const key of keys) {
      const sig = this.keySignature(data, key);
      if (this.keySignatures.get(key) === sig) continue;
      const known = this.keySignatures.has(key);
      this.keySignatures.set(key, sig);
      this.keyVersionSeq += 1;
      this.keyChanges.set(key, this.keyVersionSeq);
      if (!known && !this.watchStarted) continue;
      changedKeys.push(key);
    }
    if (changedKeys.length) {
      const lang = this.currentLang();
      const changedSessionIds = [];
      const deltaItems = {};
      for (const key of changedKeys) {
        const sid = this.sessionIdFromKey(key);
        changedSessionIds.push(sid);
        deltaItems[sid] = this.buildSessionSummaryItem(key, sid, lang);
      }
      this.emitEvent('update', {
        revision: data.revision,
        lang,
        changedSessionIds,
        items: deltaItems,
        snapshot: this.buildUiSnapshot({ lang, preloaded: true }),
      });
    }
    return changedKeys;
  }

  buildSessionSummaryItem(key, sessionId, lang = this.currentLang()) {
    const projection = this.store.readSessionProjection(key);
    const rec = projection.record;
    if (!rec && !projection.timelineSummary?.pending && projection.timelineSummary?.latestStatus !== 'failed') {
      return null;
    }
    const ledger = projection.analysis?.ledger || null;
    const analyzing = Boolean(projection.timelineSummary?.pending || this.findActiveJob(key));
    if (!rec?.state && !analyzing && projection.timelineSummary?.latestStatus !== 'failed') {
      return null;
    }
    return {
      key,
      sessionId,
      revision: projection.revision || 0,
      state: rec?.state ?? null,
      progress: typeof rec?.progress === 'number' ? rec.progress : null,
      note: rec?.note ? String(rec.note).slice(0, 240) : '',
      source: rec?.source || 'manual',
      updatedAt: rec?.updatedAt || null,
      projectPath: rec?.projectPath || null,
      tasksSummary: ledger ? {
        total: ledger.totalTasks ?? ledger.tasks?.length ?? 0,
        done: ledger.completedTasks ?? (ledger.tasks?.filter(t => t.status === 'done').length || 0),
        percent: ledger.percent ?? 0,
        basis: ledger.basis || 'count',
      } : null,
      analyzing,
      analysisStatus: analyzing ? 'pending' : (projection.timelineSummary?.latestStatus || null),
      analysisStage: projection.timelineSummary?.stage || null,
      analysisError: projection.timelineSummary?.latestError || null,
    };
  }

  buildUiSnapshot({ lang, preloaded = false } = {}) {
    if (!preloaded) this.store.reloadIfModified();
    const activeLang = this.currentLang(lang);
    const snap = this.store.snapshot();
    return {
      version: 1,
      revision: snap.revision,
      lang: activeLang,
      records: snap.records,
      analyzingKeys: this.activeKeys(),
      keyVersionBase: 0,
      keyVersions: Object.fromEntries(this.keyChanges),
    };
  }

  buildAnalysisState(key) {
    const sessionId = this.sessionIdFromKey(key);
    const state = this.store.analysisState(key);
    const cachedSnap = this.latestSnapshots.get(sessionId);
    if (state.analysis?.sources && cachedSnap?.turns) {
      const coords = buildItemCoordinateIndex(cachedSnap.turns);
      const enrichedSources = {};
      for (const [ref, src] of Object.entries(state.analysis.sources)) {
        const coord = src?.itemId ? coords.get(src.itemId) : null;
        enrichedSources[ref] = coord
          ? { ...src, turn: src.turn ?? coord.turn, seq: src.seq ?? coord.seq, role: src.role ?? coord.role }
          : src;
      }
      return {
        ...state,
        analysis: {
          ...state.analysis,
          sources: enrichedSources,
        },
      };
    }
    return state;
  }

  summaryPayload({ lang } = {}) {
    this.store.reloadIfModified();
    const activeLang = this.currentLang(lang);
    const items = {};
    const seenKeys = new Set([
      ...Object.keys(this.store.data.records || {}),
      ...Object.keys(this.store.data.analysis || {}),
      ...(this.store.data.timeline || []).map(item => item.key),
    ]);
    for (const key of seenKeys) {
      if (!this.store.validKey(key)) continue;
      const sid = this.sessionIdFromKey(key);
      const item = this.buildSessionSummaryItem(key, sid, activeLang);
      if (item) items[sid] = item;
    }
    return {
      version: 1,
      revision: this.store.data.revision || 0,
      lang: activeLang,
      items,
      snapshot: this.buildUiSnapshot({ lang: activeLang, preloaded: true }),
    };
  }

  async sessionPayload(rawId, { lang, includeGit = true } = {}) {
    this.store.reloadIfModified();
    const activeLang = this.currentLang(lang);
    const sessionId = this.resolveSessionId(rawId);
    const key = this.keyForSession(sessionId);
    const projection = this.store.readSessionProjection(key);
    let projectGit = projection.analysis?.projectGit || null;
    if (includeGit) {
      projectGit = await this.inspectSessionGit(sessionId);
    }
    const analysis = projection.analysis ? {
      ledger: {
        ...projection.analysis.ledger,
        tasks: projection.activeTasks || [],
      },
      projectGit: projection.analysis.projectGit || projectGit || null,
    } : null;

    const cachedSnap = this.latestSnapshots.get(sessionId);
    const analysisState = this.buildAnalysisState(key);
    const sources = analysisState?.analysis?.sources || {};
    if (analysis?.ledger?.tasks?.length && cachedSnap?.turns) {
      const coords = buildItemCoordinateIndex(cachedSnap.turns);
      analysis.ledger.tasks = analysis.ledger.tasks.map(task => {
        if (!task?.source?.itemId) return task;
        const coord = coords.get(task.source.itemId);
        if (!coord) return task;
        return {
          ...task,
          source: {
            ...task.source,
            turn: task.source.turn ?? coord.turn,
            seq: task.source.seq ?? coord.seq,
          },
        };
      });
    }

    const view = sessionView(this.store, key, {
      projectGit,
      capabilities: {
        read: true,
        save: true,
        clear: true,
        analyze: true,
        watch: true,
        locate: true,
        update: false,
      },
      projection,
      lang: activeLang,
    });

    const resolvedTasks = (view.tasks || []).map(task => {
      if (task?.source?.locator) return task;
      const ref = task?.evidenceRefs?.find(r => sources[r]?.turnId || sources[r]?.locator);
      return ref ? { ...task, source: sources[ref] } : task;
    });
    const progress = typeof projection.record?.progress === 'number'
      ? projection.record.progress
      : (typeof analysis?.ledger?.percent === 'number' ? analysis.ledger.percent : null);
    const analyzingNow = Boolean(projection.timelineSummary?.pending || this.findActiveJob(key));
    const sessionTitle = this.deriveSessionTitle(sessionId, cachedSnap);
    const sidebarUpdatedAt = projection.record?.updatedAt
      || projection.analysis?.completedAt
      || projection.timelineSummary?.requestedAt
      || null;
    const sidebarSession = (projection.record?.state || projection.analysis || analyzingNow || projection.timelineSummary?.latestStatus === 'failed')
      ? {
          conversationId: sessionId,
          key,
          ...(sessionTitle ? { title: sessionTitle } : {}),
          lang: activeLang,
          state: projection.record?.state || (progress === 100 ? 'completed' : (progress > 0 ? 'unfinished' : 'unstarted')),
          progress,
          note: projection.record?.note ?? '',
          summary: analysis?.ledger?.summary || projection.record?.note || '',
          tasks: resolvedTasks,
          totalTasks: resolvedTasks.length,
          completedTasks: resolvedTasks.filter(t => t.status === 'done').length,
          recordRevision: view.recordRevision ?? 0,
          revision: projection.revision || 0,
          updatedAt: sidebarUpdatedAt,
          analyzing: analyzingNow,
          analysisStatus: view.analysis,
          projectGit,
          capabilities: view.capabilities,
        }
      : {
          conversationId: sessionId,
          key,
          ...(sessionTitle ? { title: sessionTitle } : {}),
          lang: activeLang,
          state: 'unstarted',
          progress: null,
          note: '',
          summary: '',
          tasks: [],
          totalTasks: 0,
          completedTasks: 0,
          recordRevision: view.recordRevision ?? 0,
          revision: projection.revision || 0,
          updatedAt: null,
          analyzing: false,
          analysisStatus: view.analysis,
          projectGit,
          capabilities: view.capabilities,
        };

    return {
      session: view,
      sidebarSession,
      snapshot: this.buildUiSnapshot({ lang: activeLang, preloaded: true }),
      analysisState,
      key,
      sessionId,
      lang: activeLang,
      revision: projection.revision || 0,
      record: projection.record,
      projectGit,
      analysis,
      timeline: projection.timelineSummary,
      analyzing: analyzingNow,
      logs: this.readRecentLogs(sessionId, 20),
    };
  }

  readRecentLogs(sessionId, limit = 25) {
    if (!fs.existsSync(this.logFile)) return [];
    try {
      const raw = fs.readFileSync(this.logFile, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      const entries = [];
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (sessionId && parsed.threadId && parsed.threadId !== sessionId) continue;
          entries.push(parsed);
        } catch { /* ignore malformed tail line */ }
      }
      return entries.reverse();
    } catch {
      return [];
    }
  }

  async saveSession(rawId, { expectedRevision, record, lang } = {}) {
    const activeLang = this.currentLang(lang);
    const sessionId = this.resolveSessionId(rawId);
    const key = this.keyForSession(sessionId);
    this.store.reloadIfModified();
    const current = this.store.data.records?.[key];
    const baseRevision = expectedRevision ?? current?.revision ?? 0;

    if (record === null) {
      return this.clearSession(sessionId, { expectedRevision: baseRevision, lang: activeLang });
    }

    let git = null;
    if (record?.state === 'pushed') {
      git = await this.inspectSessionGit(sessionId);
      requireGitRemote(git, activeLang);
    }
    const projectPath = git?.projectPath || await this.resolveCwdForSession(sessionId);
    this.store.update({
      key,
      expectedRevision: baseRevision,
      record,
      projectPath,
    });
    this.detectChanges();
    return this.sessionPayload(sessionId, { lang: activeLang, includeGit: true });
  }

  async clearSession(rawId, { expectedRevision, lang } = {}) {
    const activeLang = this.currentLang(lang);
    const sessionId = this.resolveSessionId(rawId);
    const key = this.keyForSession(sessionId);
    this.store.reloadIfModified();
    const current = this.store.data.records?.[key];
    const baseRevision = expectedRevision ?? current?.revision ?? 0;
    this.store.update({
      key,
      expectedRevision: baseRevision,
      record: null,
    });
    this.detectChanges();
    return this.sessionPayload(sessionId, { lang: activeLang, includeGit: false });
  }

  async analyzeSession(rawId, { lang } = {}) {
    const activeLang = this.currentLang(lang);
    const sessionId = this.resolveSessionId(rawId);
    const key = this.keyForSession(sessionId);
    if (this.stopped) {
      throw progressError('SERVICE_STOPPING', undefined, true, activeLang);
    }
    const job = this.analysis.start(key);
    job?.promise?.catch?.(() => {});
    this.detectChanges();
    const payload = await this.sessionPayload(sessionId, { lang: activeLang, includeGit: false });
    return {
      started: true,
      job,
      session: payload,
    };
  }

  async analyzeAndWait(rawId, { lang } = {}) {
    const { job } = await this.analyzeSession(rawId, { lang });
    await job.promise;
    return this.sessionPayload(rawId, { lang, includeGit: true });
  }

  cancelAnalysis(rawId, { lang } = {}) {
    const activeLang = this.currentLang(lang);
    const sessionId = this.resolveSessionId(rawId);
    const key = this.keyForSession(sessionId);
    const job = this.findActiveJob(key);
    if (!job) return { cancelled: false };
    job.log('analysis.cancel');
    job.controller.abort(progressError('REQUEST_CANCELLED', undefined, false, activeLang));
    return { cancelled: true };
  }

  async locateTask(rawId, { taskId, itemId, turnId, locator, lang } = {}) {
    const activeLang = this.currentLang(lang);
    const en = activeLang === 'en';
    const sessionId = this.resolveSessionId(rawId);
    const key = this.keyForSession(sessionId);

    let targetItemId = itemId || null;
    let targetTurnId = turnId || null;
    let targetLocator = locator || null;

    if (taskId) {
      const progress = this.store.getProgress(key);
      const task = progress?.tasks?.find(item => item.id === taskId);
      if (!task?.source && !targetItemId) {
        return {
          located: false,
          reason: 'no_source',
          message: en ? 'This task does not have a source reference' : '该任务暂无来源坐标记录',
        };
      }
      targetItemId ||= task?.source?.itemId || null;
      targetTurnId ||= task?.source?.turnId || null;
      targetLocator ||= task?.source?.locator || null;
    }

    const snap = await this.loadSnapshot(sessionId);
    if (snap) setBoundedMapEntry(this.latestSnapshots, sessionId, snap);
    const coords = buildItemCoordinateIndex(snap?.turns || []);

    if (targetItemId && coords.has(targetItemId)) {
      const hit = coords.get(targetItemId);
      let resolvedLocator = targetLocator ? String(targetLocator).trim() : '';
      if (!resolvedLocator) {
        outer: for (const turn of snap?.turns || []) {
          if (hit.turnId && turn.id !== hit.turnId) continue;
          for (const item of turn.items || []) {
            if (item?.id !== hit.itemId) continue;
            const clean = normalizeMessageText(turnItemText(item));
            if (clean) resolvedLocator = clean.slice(0, 120);
            break outer;
          }
        }
      }
      return {
        located: true,
        sessionId,
        itemId: hit.itemId,
        turnId: hit.turnId,
        turn: hit.turn,
        seq: hit.seq,
        role: hit.role,
        locator: resolvedLocator || null,
      };
    }

    if (targetLocator) {
      const cleanLocator = normalizeMessageText(targetLocator);
      const candidates = [];
      for (const turn of snap?.turns || []) {
        if (targetTurnId && turn.id !== targetTurnId) continue;
        for (const item of turn.items || []) {
          const clean = normalizeMessageText(turnItemText(item));
          if (clean && cleanLocator && clean.includes(cleanLocator)) {
            candidates.push({
              itemId: item.id,
              turnId: turn.id,
              turn: turn.turn ?? null,
              seq: item.seq ?? null,
              role: item.type === 'userMessage' ? 'user' : 'assistant',
            });
          }
        }
      }
      if (candidates.length === 1) {
        const hit = candidates[0];
        return {
          located: true,
          sessionId,
          ...hit,
          locator: targetLocator,
        };
      }
      if (candidates.length > 1) {
        return {
          located: false,
          sessionId,
          reason: 'ambiguous_source',
          message: en
            ? 'Multiple messages matched this source snippet; provide turnId and itemId'
            : '多条消息匹配该来源片段，请补充 turnId 和 itemId 精确定位',
        };
      }
    }

    return {
      located: false,
      sessionId,
      reason: 'source_not_found',
      message: en ? 'Unable to find the referenced message in session history' : '未在当前会话历史中定位到该来源消息',
    };
  }

  async tools(name, args = {}) {
    const lang = this.currentLang(args?.lang);
    return callProgressTool(this.store, name, args, {
      lang,
      onChange: () => {
        this.detectChanges();
      },
      projectGit: async key => {
        const sessionId = this.sessionIdFromKey(key);
        return this.inspectSessionGit(sessionId);
      },
      resolveProjects: keys => this.resolveProjects(keys),
      resolveSources: (key, tasks) => this.resolveSources(key, tasks),
    });
  }

  async handleCommand(rawSessionId, rawInput = '', { lang } = {}) {
    const activeLang = this.currentLang(lang);
    const en = activeLang === 'en';
    const sessionId = this.resolveSessionId(rawSessionId);
    const key = this.keyForSession(sessionId);
    const trimmed = String(rawInput || '').trim();
    const lower = trimmed.toLowerCase();

    try {
      if (lower === 'analyze' || lower === 'analyse' || trimmed === '分析') {
        await this.analyzeSession(sessionId, { lang: activeLang });
        return {
          kind: 'success',
          text: en
            ? 'Agent Things analysis started. Track extracted tasks and progress rings live in this card or the Things sidebar tab.'
            : '已启动 Agent Things 会话任务分析，可在当前卡片或右侧边栏 Things 面板查看提取出的待办清单与进度圆环。',
        };
      }

      if (lower === 'clear' || lower === 'reset' || trimmed === '清除' || trimmed === '清空') {
        const current = this.store.getProgress(key);
        await this.clearSession(sessionId, { expectedRevision: current?.revision, lang: activeLang });
        return {
          kind: 'success',
          text: en ? 'Cleared Agent Things progress and extracted tasks for this session.' : '已清除当前会话的 Agent Things 进度与任务记录。',
        };
      }

      const percentMatch = trimmed.match(/^(\d{1,3})%?$/);
      if (percentMatch || ['done', 'completed', 'pushed', 'unfinished', 'unstarted'].includes(lower)) {
        const current = this.store.getProgress(key);
        let state = 'unfinished';
        let progress = current?.progress ?? 50;
        if (percentMatch) {
          const pct = Math.max(0, Math.min(100, Number(percentMatch[1])));
          progress = pct;
          state = pct === 0 ? 'unstarted' : (pct === 100 ? 'completed' : 'unfinished');
        } else {
          state = lower === 'done' ? 'completed' : lower;
          progress = state === 'unstarted' ? 0 : (state === 'completed' || state === 'pushed' ? 100 : (current?.progress || 50));
        }
        await this.saveSession(sessionId, {
          expectedRevision: current?.revision ?? (this.store.data.records?.[key]?.revision ?? 0),
          record: {
            state,
            progress,
            note: current?.note || '',
          },
          lang: activeLang,
        });
      } else if (trimmed && !['show', 'status', '查看', '状态'].includes(lower)) {
        const current = this.store.getProgress(key);
        const noteText = trimmed.replace(/^(?:note|备注)\s+/i, '').slice(0, 4000);
        const nextState = current?.state || 'unfinished';
        const nextProgress = nextState === 'unstarted' ? 50 : (current?.progress ?? 50);
        await this.saveSession(sessionId, {
          expectedRevision: current?.revision ?? (this.store.data.records?.[key]?.revision ?? 0),
          record: {
            state: current?.state && current.state !== 'unstarted' ? current.state : 'unfinished',
            progress: nextProgress,
            note: noteText,
          },
          lang: activeLang,
        });
      }

      const progress = this.store.getProgress(key);
      const { userMarkdown } = formatSessionMarkdownSummary({
        lang: activeLang,
        progressData: progress,
        embedTag: '',
      });
      return {
        kind: 'success',
        text: userMarkdown.trim(),
      };
    } catch (error) {
      return {
        kind: 'error',
        text: error?.message || (en ? 'Things command failed' : '执行 /things 命令失败'),
      };
    }
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  emitEvent(type, data) {
    for (const listener of [...this.subscribers]) {
      try {
        listener({ type, data });
      } catch { /* isolate failing subscriber */ }
    }
  }

  createSseResponse(request, { lang } = {}) {
    const encoder = new TextEncoder();
    const initial = this.summaryPayload({ lang });
    let closed = false;
    let heartbeat = null;
    let unsubscribe = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
      this.sseCleanups.delete(closeController);
      request?.signal?.removeEventListener?.('abort', closeController);
    };

    let controllerRef = null;
    const closeController = () => {
      cleanup();
      try { controllerRef?.close(); } catch { /* already closed */ }
    };

    const stream = new ReadableStream({
      start: controller => {
        controllerRef = controller;
        this.sseCleanups.add(closeController);
        const pushFrame = (event, payload) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
          } catch {
            closeController();
          }
        };
        pushFrame('snapshot', initial);
        unsubscribe = this.subscribe(msg => {
          pushFrame(msg.type || 'update', msg.data);
        });
        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            closeController();
          }
        }, 20000);
        heartbeat.unref?.();
        if (request?.signal?.aborted) {
          closeController();
        } else {
          request?.signal?.addEventListener?.('abort', closeController, { once: true });
        }
      },
      cancel: () => {
        cleanup();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  }

  async getAnalysisConfigPayload({ lang } = {}) {
    const activeLang = this.currentLang(lang);
    const config = readAnalysisConfig(this.analysisConfigFile);
    const catalog = await discoverModelCatalog(this.ctx, { lang: activeLang });

    let savedAvailable = true;
    let savedModelInfo = null;
    if (config.mode === 'custom' && config.provider && config.model) {
      const group = catalog.groups.find(g => g.id === config.provider);
      savedModelInfo = group?.models.find(m => m.id === config.model) || null;
      savedAvailable = Boolean(savedModelInfo);
    }

    return {
      version: 1,
      lang: activeLang,
      config,
      catalog,
      availability: {
        savedAvailable,
        savedModelInfo,
        fallbackRoute: !savedAvailable ? catalog.defaultRoute : null,
      },
    };
  }

  async saveAnalysisConfig(input = {}, { lang } = {}) {
    const activeLang = this.currentLang(lang);
    const en = activeLang === 'en';
    if (!input || typeof input !== 'object') {
      throw progressError('INVALID_ARGUMENT', en ? 'Analysis configuration payload is required' : '请提供有效的解析模型配置', false, activeLang);
    }
    const mode = input.mode === 'custom' ? 'custom' : 'default';
    if (mode === 'custom') {
      const provider = typeof input.provider === 'string' ? input.provider.trim() : '';
      const model = typeof input.model === 'string' ? input.model.trim() : '';
      if (!provider || !model) {
        throw progressError('INVALID_ARGUMENT', en ? 'Provider and model are required' : '请选择模型提供方与具体模型', false, activeLang);
      }
      const catalog = await discoverModelCatalog(this.ctx, { lang: activeLang });
      const group = catalog.groups.find(g => g.id === provider);
      const modelEntry = group?.models.find(m => m.id === model);
      if (!modelEntry) {
        throw progressError(
          'INVALID_ARGUMENT',
          en ? 'Selected model is unavailable; refresh the model list and choose again' : '所选模型当前不可用，请刷新模型列表后重试',
          false,
          activeLang,
        );
      }
      const reasoningEffort = typeof input.reasoningEffort === 'string' && input.reasoningEffort.trim()
        ? input.reasoningEffort.trim()
        : null;
      if (reasoningEffort) {
        const supported = modelEntry.reasoning?.efforts?.some(e => e.id === reasoningEffort);
        if (!supported) {
          throw progressError(
            'INVALID_ARGUMENT',
            en ? `Model "${modelEntry.name}" does not support reasoning effort "${reasoningEffort}"` : `模型「${modelEntry.name}」不支持思考程度「${reasoningEffort}」`,
            false,
            activeLang,
          );
        }
      }
      writeAnalysisConfig(this.analysisConfigFile, {
        mode: 'custom',
        provider,
        model,
        reasoningEffort,
      });
    } else {
      const reasoningEffort = typeof input.reasoningEffort === 'string' && input.reasoningEffort.trim()
        ? input.reasoningEffort.trim()
        : null;
      if (reasoningEffort) {
        const catalog = await discoverModelCatalog(this.ctx, { lang: activeLang });
        const flashReasoning = catalog.defaultRoute?.reasoning;
        if (flashReasoning && !flashReasoning.efforts.some(e => e.id === reasoningEffort)) {
          throw progressError(
            'INVALID_ARGUMENT',
            en ? `Default model does not support reasoning effort "${reasoningEffort}"` : `默认模型不支持思考程度「${reasoningEffort}」`,
            false,
            activeLang,
          );
        }
      }
      writeAnalysisConfig(this.analysisConfigFile, {
        mode: 'default',
        provider: null,
        model: null,
        reasoningEffort,
      });
    }
    return this.getAnalysisConfigPayload({ lang: activeLang });
  }

  async handleFetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const langParam = url.searchParams.get('lang');
    const activeLang = this.currentLang(langParam);

    if (request.method === 'GET' && pathname === `${API_PREFIX}/events`) {
      return this.createSseResponse(request, { lang: activeLang });
    }

    const json = (status, data) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

    try {
      if (request.method === 'GET' && pathname === `${API_PREFIX}/summary`) {
        return json(200, this.summaryPayload({ lang: activeLang }));
      }
      if (request.method === 'GET' && pathname === `${API_PREFIX}/session`) {
        const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('id');
        const includeGit = url.searchParams.get('includeGit') !== '0';
        return json(200, await this.sessionPayload(sessionId, { lang: activeLang, includeGit }));
      }
      if (request.method === 'GET' && pathname === `${API_PREFIX}/log`) {
        const sessionId = url.searchParams.get('sessionId') || null;
        return json(200, { logs: this.readRecentLogs(sessionId, 30), lang: activeLang });
      }
      if (request.method === 'GET' && pathname === `${API_PREFIX}/analysis-config`) {
        return json(200, await this.getAnalysisConfigPayload({ lang: activeLang }));
      }
      if (request.method === 'POST') {
        let body = {};
        const rawText = await request.text();
        if (rawText.trim()) {
          try { body = JSON.parse(rawText); }
          catch { return json(400, { error: activeLang === 'en' ? 'Invalid JSON body' : 'JSON 请求体格式无效' }); }
        }
        const reqLang = this.currentLang(body?.lang || langParam);
        if (pathname === `${API_PREFIX}/analysis-config`) {
          return json(200, await this.saveAnalysisConfig(body, { lang: reqLang }));
        }
        if (pathname === `${API_PREFIX}/save`) {
          return json(200, await this.saveSession(body.sessionId, {
            expectedRevision: body.expectedRevision,
            record: body.record,
            lang: reqLang,
          }));
        }
        if (pathname === `${API_PREFIX}/clear`) {
          return json(200, await this.clearSession(body.sessionId, {
            expectedRevision: body.expectedRevision,
            lang: reqLang,
          }));
        }
        if (pathname === `${API_PREFIX}/analyze`) {
          const result = await this.analyzeSession(body.sessionId, { lang: reqLang });
          return json(200, { started: result.started, session: result.session });
        }
        if (pathname === `${API_PREFIX}/analyze-cancel`) {
          return json(200, this.cancelAnalysis(body.sessionId, { lang: reqLang }));
        }
        if (pathname === `${API_PREFIX}/locate`) {
          return json(200, await this.locateTask(body.sessionId, {
            taskId: body.taskId,
            itemId: body.itemId,
            turnId: body.turnId,
            locator: body.locator,
            lang: reqLang,
          }));
        }
        if (pathname === `${API_PREFIX}/tools`) {
          return json(200, { result: await this.tools(body.name, body.args || {}) });
        }
        if (pathname === `${API_PREFIX}/rpc`) {
          return json(200, await this.handleRpc({ ...body, lang: reqLang }));
        }
      }
      return json(404, { error: activeLang === 'en' ? 'Unknown endpoint' : '未知服务接口' });
    } catch (error) {
      const errorInfo = errorDetails(error, 'HOST_UNAVAILABLE', activeLang);
      const status = errorInfo.code === 'REVISION_CONFLICT' ? 409
        : errorInfo.code === 'INVALID_ARGUMENT' ? 400
          : errorInfo.code === 'SOURCE_NOT_FOUND' ? 404 : 400;
      return json(status, { error: error?.message || errorInfo.message, errorInfo });
    }
  }

  async handleRpc(message = {}) {
    const res = await this._handleRpc(message);
    return { protocolVersion: 1, ...res };
  }

  async _handleRpc(message = {}) {
    const activeLang = this.currentLang(message?.lang);
    const requestId = typeof message?.requestId === 'string' ? message.requestId : '';
    try {
      const type = message?.type;
      if (type === 'list' || type === 'panel-event' || type === 'cancel-request' || type === 'open-pane') {
        return {
          requestId,
          ok: true,
          snapshot: this.buildUiSnapshot({ lang: activeLang }),
          lang: activeLang,
        };
      }
      if (type === 'app-update-info' || type === 'app-update-start') {
        return {
          requestId,
          updateInfo: {
            available: false,
            unsupported: true,
            currentVersion: PKG_VERSION,
            command: 'npx agent-things@latest',
          },
          snapshot: this.buildUiSnapshot({ lang: activeLang }),
          lang: activeLang,
        };
      }
      if (type === 'analysis-config-get') {
        const payload = await this.getAnalysisConfigPayload({ lang: activeLang });
        return { requestId, ...payload };
      }
      if (type === 'analysis-config-save') {
        const payload = await this.saveAnalysisConfig(message.config || message, { lang: activeLang });
        return { requestId, ...payload };
      }
      const sessionId = this.resolveSessionId(message?.key || message?.sessionId);
      if (type === 'analysis-state') {
        const payload = await this.sessionPayload(sessionId, { lang: activeLang, includeGit: false });
        return {
          requestId,
          session: payload.session,
          analysisState: payload.analysisState,
          sidebarSession: payload.sidebarSession,
          snapshot: payload.snapshot,
          lang: activeLang,
        };
      }
      if (type === 'project-git') {
        const projectGit = await this.inspectSessionGit(sessionId);
        return {
          requestId,
          projectGit,
          snapshot: this.buildUiSnapshot({ lang: activeLang }),
          lang: activeLang,
        };
      }
      if (type === 'update') {
        const payload = await this.saveSession(sessionId, {
          expectedRevision: message.expectedRevision,
          record: message.record,
          lang: activeLang,
        });
        return {
          requestId,
          session: payload.session,
          analysisState: payload.analysisState,
          sidebarSession: payload.sidebarSession,
          snapshot: payload.snapshot,
          lang: activeLang,
        };
      }
      if (type === 'clear') {
        const payload = await this.clearSession(sessionId, {
          expectedRevision: message.expectedRevision,
          lang: activeLang,
        });
        return {
          requestId,
          session: payload.session,
          analysisState: payload.analysisState,
          sidebarSession: payload.sidebarSession,
          snapshot: payload.snapshot,
          lang: activeLang,
        };
      }
      if (type === 'analyze') {
        const res = await this.analyzeSession(sessionId, { lang: activeLang });
        res.job?.promise?.catch?.(() => {});
        return {
          requestId,
          started: res.started,
          session: res.session.session,
          analysisState: res.session.analysisState,
          sidebarSession: res.session.sidebarSession,
          snapshot: res.session.snapshot,
          lang: activeLang,
        };
      }
      if (type === 'analyze-cancel') {
        const cancelled = this.cancelAnalysis(sessionId, { lang: activeLang });
        const payload = await this.sessionPayload(sessionId, { lang: activeLang, includeGit: false });
        return {
          requestId,
          ...cancelled,
          session: payload.session,
          analysisState: payload.analysisState,
          sidebarSession: payload.sidebarSession,
          snapshot: payload.snapshot,
          lang: activeLang,
        };
      }
      if (type === 'locate-source') {
        const nav = await this.locateTask(sessionId, {
          itemId: message.source?.itemId,
          turnId: message.source?.turnId,
          locator: message.source?.locator,
          lang: activeLang,
        });
        return {
          requestId,
          navigation: nav,
          snapshot: this.buildUiSnapshot({ lang: activeLang }),
          lang: activeLang,
        };
      }
      throw progressError('INVALID_ARGUMENT', activeLang === 'en' ? 'Unknown RPC action' : '未知 RPC 操作', false, activeLang);
    } catch (error) {
      const errorInfo = errorDetails(error, 'HOST_UNAVAILABLE', activeLang);
      return {
        requestId,
        error: error?.message || errorInfo.message,
        errorInfo,
        snapshot: this.buildUiSnapshot({ lang: activeLang }),
        lang: activeLang,
      };
    }
  }

  startWatching() {
    this.detectChanges();
    this.watchStarted = true;
    this.watchStartRevision = this.store.data.revision || 0;
    this.lastLang = this.currentLang();
    this.changeTimer = setInterval(() => {
      try {
        if (this.store.reloadIfModified()) this.detectChanges();
        const nextLang = this.currentLang();
        if (nextLang !== this.lastLang) {
          this.lastLang = nextLang;
          this.emitEvent('snapshot', this.summaryPayload({ lang: nextLang }));
        }
      } catch { /* ignore transient stat/read issue */ }
    }, 500);
    this.changeTimer.unref?.();
  }

  async startBridgeServer() {
    if (this.bridgeServer) return this.bridgeCredentials;
    const token = crypto.randomBytes(24).toString('hex');
    const stateId = crypto.createHash('sha256').update(this.stateFile).digest('hex');
    const server = http.createServer(async (req, res) => {
      const lang = this.currentLang();
      const send = (status, body) => {
        if (res.writableEnded) return;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      };
      if (req.headers.authorization !== `Bearer ${token}`) {
        send(401, { error: lang === 'en' ? 'Unauthorized' : '未授权访问' });
        return;
      }
      if (req.method === 'GET' && req.url === '/health') {
        send(200, { ok: true, service: 'agent-things-dsh', version: 1, stateId, pid: process.pid });
        return;
      }
      if (req.method !== 'POST') {
        send(405, { error: lang === 'en' ? 'Method not allowed' : '方法不允许' });
        return;
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          send(413, { error: lang === 'en' ? 'Request payload too large' : '请求体过大' });
          return;
        }
        chunks.push(chunk);
      }
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch { send(400, { error: lang === 'en' ? 'Invalid JSON body' : 'JSON 格式无效' }); return; }
      try {
        if (req.url === '/tools') {
          send(200, { result: await this.tools(body.name, body.args || {}) });
          return;
        }
        if (req.url === '/analyze') {
          const result = await this.analyzeSession(body.sessionId, { lang });
          send(200, { started: result.started });
          return;
        }
        send(404, { error: lang === 'en' ? 'Unknown route' : '未知路由' });
      } catch (error) {
        const errorInfo = errorDetails(error, 'HOST_UNAVAILABLE', lang);
        send(errorInfo.code === 'REVISION_CONFLICT' ? 409 : 400, { error: error?.message || errorInfo.message, errorInfo });
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const addr = server.address();
    this.bridgeServer = server;
    this.bridgeCredentials = {
      service: 'agent-things-dsh',
      version: 1,
      stateId,
      stateFile: this.stateFile,
      port: addr.port,
      token,
      pid: process.pid,
    };
    fs.mkdirSync(path.dirname(this.bridgeFile), { recursive: true, mode: 0o700 });
    const tmp = `${this.bridgeFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.bridgeCredentials), { mode: 0o600 });
    fs.renameSync(tmp, this.bridgeFile);
    return this.bridgeCredentials;
  }

  async stopBridgeServer() {
    if (!this.bridgeServer) return;
    const server = this.bridgeServer;
    const creds = this.bridgeCredentials;
    this.bridgeServer = null;
    this.bridgeCredentials = null;
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    try {
      if (fs.existsSync(this.bridgeFile) && JSON.parse(fs.readFileSync(this.bridgeFile, 'utf8')).token === creds?.token) {
        fs.unlinkSync(this.bridgeFile);
      }
    } catch { /* ignore cleanup error */ }
  }

  async start({ enableBridge = false } = {}) {
    this.stopped = false;
    this.store.recoverPending();
    this.startWatching();
    if (enableBridge) {
      await this.startBridgeServer();
    }
    return this;
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.changeTimer);
    this.changeTimer = null;
    for (const close of [...this.sseCleanups]) {
      try { close(); } catch { /* ignore */ }
    }
    this.sseCleanups.clear();
    this.subscribers.clear();
    await this.analysis.stop();
    await this.stopBridgeServer();
  }
}

function listApiRouteSpecs(service) {
  const routes = [
    { path: `${API_PREFIX}/summary`, methods: ['GET'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/events`, methods: ['GET'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/session`, methods: ['GET'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/log`, methods: ['GET'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/save`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/clear`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/analyze`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/analyze-cancel`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/locate`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/tools`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/rpc`, methods: ['POST'], requestBody: 'buffered' },
    { path: `${API_PREFIX}/analysis-config`, methods: ['GET', 'POST'], requestBody: 'buffered' },
  ];
  return routes.map(spec => ({
    ...spec,
    fetch: request => service.handleFetch(request),
  }));
}

module.exports = {
  API_PREFIX,
  DshStatusStore,
  DshService,
  resolveDefaultDshHome,
  resolveDefaultDshStateFile,
  listApiRouteSpecs,
};
