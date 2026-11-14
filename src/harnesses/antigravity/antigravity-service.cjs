'use strict';
const { startProgressHttp } = require('../../local-progress-http.cjs');
const { callProgressTool } = require('../../progress-tools.cjs');
const path = require('node:path');
const os = require('node:os');
const { ManualStatusStore } = require('../../manual-status-store.cjs');
const { AnalysisService } = require('../../analysis-service.cjs');
const { createAnalysisLog, diagnosticFields } = require('../../analysis-log.cjs');
const { AntigravityTranscriptServer } = require('./transcript-source.cjs');
const { runGeminiAnalysis } = require('./gemini-runner.cjs');
const { detectAntigravityGit } = require('./antigravity-git.cjs');
const npmUpdates = require('../../npm-updates.cjs');
const { executeMigration } = require('./antigravity-migration.cjs');
const { resolveAntigravityTitle } = require('./antigravity-title.cjs');

const DEFAULT_PORT = 29888;
const DEFAULT_STATE_FILE = path.join(os.homedir(), '.gemini', 'antigravity', 'session-status', 'manual-state.json');

class AntigravityService {
  constructor({
    port = DEFAULT_PORT,
    stateFile = DEFAULT_STATE_FILE,
    logFile = path.join(path.dirname(stateFile), 'analysis.jsonl'),
    run = runGeminiAnalysis,
    brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain'),
    dbPath = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db'),
    makeServer = options => new AntigravityTranscriptServer({ brainDir, ...options }),
    apiKey = process.env.GEMINI_API_KEY,
    updates = npmUpdates,
  } = {}) {
    this.port = port;
    this.stateFile = stateFile;
    this.brainDir = brainDir;
    this.dbPath = dbPath;
    this.store = new ManualStatusStore(stateFile);
    this.logFile = logFile;
    this.log = createAnalysisLog(logFile);
    this.run = (options) => run({ apiKey, ...options });
    this.makeServer = makeServer;
    this.server = null;
    this.updates = updates;
    this.analysisService = new AnalysisService({
      store: this.store,
      logFile: this.logFile,
      makeServer: this.makeServer,
      run: this.run,
      onChange: (changedKey, statusInfo) => {
        this.log('service.store.change', { revision: this.store.snapshot()?.revision, changedKey, status: statusInfo?.status });
        this.broadcastState(changedKey, statusInfo);
      },
    });
  }

  canonicalKey(convIdOrKey) {
    if (!convIdOrKey) return convIdOrKey;
    try {
      const parsed = JSON.parse(convIdOrKey);
      if (Array.isArray(parsed) && parsed.length === 2 && parsed[0] === 'local') {
        const cleanId = String(parsed[1]).replace(/^local:/, '');
        return JSON.stringify(['local', cleanId]);
      }
    } catch (_) {}
    const clean = String(convIdOrKey).trim().replace(/^local:/, '');
    return JSON.stringify(['local', clean]);
  }

  getSessionSnapshot(cleanId, transientStatus = null) {
    const key = this.canonicalKey(cleanId);
    const progress = this.store.getProgress(key);
    const analysis = this.store.analysisState(key);
    const record = this.store.snapshot()?.records?.[key];
    const analyzing = this.store.snapshot()?.analyzingKeys?.includes(key) || false;

    let analysisStatus = transientStatus;
    if (!analysisStatus) {
      if (analyzing) {
        analysisStatus = { status: 'pending', stage: 'analyzing' };
      } else {
        const lastEvent = (this.store.data.timeline || [])
          .filter(e => e.key === key && e.source === 'analysis')
          .slice(-1)[0];
        if (lastEvent) {
          analysisStatus = {
            status: lastEvent.status,
            stage: lastEvent.stage,
            error: lastEvent.error || null,
            finishedAt: lastEvent.finishedAt || null,
          };
        } else {
          analysisStatus = { status: 'idle' };
        }
      }
    }

    return {
      key,
      conversationId: cleanId,
      title: resolveAntigravityTitle(cleanId, { dbPath: this.dbPath, brainDir: this.brainDir }),
      progress,
      recordRevision: record?.revision ?? 0,
      savedAnalysis: analysis?.analysis || null,
      analysis: analysis?.analysis || null,
      analysisStatus,
      analyzing: Boolean(analyzing || analysisStatus?.status === 'pending'),
      revision: this.store.snapshot()?.revision || 0,
    };
  }

  broadcastState(key, transientStatus = null) {
    if (!this.http) return;
    if (key) {
      try {
        const [, id] = JSON.parse(this.canonicalKey(key));
        const cleanId = String(id).replace(/^local:/, '');
        this.http.broadcast(cleanId, {
          type: 'session_update',
          session: this.getSessionSnapshot(cleanId, transientStatus),
          snapshotRevision: this.store.snapshot()?.revision,
        });
      } catch (_) {}
    } else {
      const targetKeys = new Set(Object.keys(this.store.snapshot()?.records || {}));
      for (const k of this.store.snapshot()?.analyzingKeys || []) targetKeys.add(k);
      for (const recordKey of targetKeys) {
        try {
          const [, id] = JSON.parse(this.canonicalKey(recordKey));
          const cleanId = String(id).replace(/^local:/, '');
          this.http.broadcast(cleanId, {
            type: 'session_update',
            session: this.getSessionSnapshot(cleanId),
            snapshotRevision: this.store.snapshot()?.revision,
          });
        } catch (_) {}
      }
    }
  }

  async handleRpc(message) {
    if (!message || typeof message.requestId !== 'string') throw new Error('无效的请求');
    if (message.key) message.key = this.canonicalKey(message.key);
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
      return { ok: true };
    }

    this.log('ui.request', context);
    let error = null, analysisState = null, projectGit = null, updateInfo = null;

    try {
      if (message.type === 'app-update-info') {
        updateInfo = await this.updates.getUpdateInfo({ force: message.force === true });
      } else if (message.type === 'app-update-start') {
        await this.updates.startUpdate();
        updateInfo = await this.updates.getUpdateInfo();
      } else if (message.type === 'update') {
        if (message.record?.state === 'pushed' && !(await this.projectGit(message.key)).hasRemote) throw new Error('此项目尚未配置 Git 远端');
        this.store.update(message);
        this.broadcastState(message.key);
      } else if (message.type === 'clear') {
        this.store.update({ key: message.key, expectedRevision: message.expectedRevision, record: null });
        this.broadcastState(message.key);
      } else if (message.type === 'project-git') {
        const threadId = context.threadId;
        projectGit = threadId ? await detectAntigravityGit(threadId, { brainDir: this.brainDir, dbPath: this.dbPath }) : { status: 'checked', hasRepository: false, hasRemote: false };
      } else if (message.type === 'analysis-state') {
        if (!this.store.validKey(message.key)) throw new Error('无效会话标识');
        analysisState = this.store.analysisState(message.key);
      } else if (message.type === 'analyze') {
        const { promise, runId, actionSequence } = this.analysisService.start(message.key, { requestId: message.requestId });
        Object.assign(context, { runId, actionSequence });
        promise.catch(err => this.log('analysis.error', { ...context, ...diagnosticFields(err) }));
        analysisState = this.store.analysisState(message.key);
        this.broadcastState(message.key);
      } else {
        throw new Error(`未知操作：${message.type}`);
      }
    } catch (e) {
      error = e.message;
    }

    const reply = {
      requestId: message.requestId,
      error,
      snapshot: this.store.snapshot(),
      analysisState,
      projectGit,
      updateInfo,
    };
    this.log('ui.reply', { ...context, ok: !error, ...(error ? diagnosticFields(error) : {}) });
    return reply;
  }

  async projectGit(key) {
    const [, id] = JSON.parse(key);
    return detectAntigravityGit(id.replace(/^local:/, ''), { brainDir: this.brainDir, dbPath: this.dbPath });
  }

  async start() {
    this.http = await startProgressHttp({ port: this.port, stateFile: this.stateFile,
      handle: async (method, route, body) => {
        if (method === 'GET' && route === '/snapshot') return { snapshot: this.store.snapshot() };
        if (method === 'GET' && route === '/session/snapshot') {
          const cleanId = (body?.conversationId || '').replace(/^local:/, '');
          return this.getSessionSnapshot(cleanId);
        }
        if (method === 'POST' && route === '/rpc') return this.handleRpc(body);
        if (method === 'POST' && route === '/tools') {
          const rawArgs = body?.args || body?.arguments || {};
          const normalizedArgs = { ...rawArgs };
          let targetCleanId = null;
          if (typeof rawArgs.conversation_id === 'string' && rawArgs.conversation_id.trim()) {
            let id = rawArgs.conversation_id.trim();
            try {
              const parsed = JSON.parse(id);
              if (Array.isArray(parsed) && parsed[0] === 'local') id = String(parsed[1]);
            } catch (_) {}
            targetCleanId = id.replace(/^local:/, '');
            normalizedArgs.conversation_id = JSON.stringify(['local', targetCleanId]);
          }
          if (typeof rawArgs.current_session_id === 'string') {
            normalizedArgs.current_session_id = rawArgs.current_session_id.trim().replace(/^local:/, '');
          }

          if (body.name === 'render_things_card') {
            const key = this.store.resolveKey(normalizedArgs.conversation_id || targetCleanId);
            const progressData = this.store.getProgress(key);
            const isEmptySession = progressData == null;
            const stateText = isEmptySession
              ? '尚未记录进展'
              : (progressData?.state === 'completed' || progressData?.progress === 100
                ? '全部完成 (100%)'
                : (progressData?.progress != null ? `${progressData.progress}%` : '未开始'));
            const total = progressData?.totalTasks || 0;
            const done = progressData?.completedTasks || 0;
            const tasksText = total > 0 ? `已完成 ${done} / ${total} 项任务` : '暂无任务清单';
            const noteText = progressData?.note ? `\n- **会话备注**：${progressData.note}` : '';
            const summaryText = isEmptySession ? '尚未记录进展' : (progressData?.summary || '');

            const { generateCardArtifact } = require('../../antigravity-card.cjs');
            const artifactDir = rawArgs.artifact_dir || path.join(os.homedir(), '.gemini/antigravity/brain', targetCleanId || 'default');
            const sessionTitle = resolveAntigravityTitle(targetCleanId, {
              dbPath: this.dbPath,
              brainDir: this.brainDir,
              fallback: '当前会话',
            });

            const cardResult = generateCardArtifact({
              conversationId: targetCleanId || 'default',
              brainDir: artifactDir,
              artifactDir,
              record: isEmptySession ? null : {
                state: progressData.state,
                progress: progressData.progress,
                note: progressData.note,
                source: progressData.source,
                updatedAt: progressData.updatedAt,
              },
              tasks: isEmptySession ? [] : (progressData?.tasks || []),
              summary: summaryText,
              revision: progressData?.revision || 0,
              stateFile: this.stateFile,
              connection: this.http?.credentials || null,
              title: sessionTitle,
            });

            const userMarkdown = `${cardResult.embedTag}\n\n**当前会话任务进度：${stateText}**\n- **任务总览**：${tasksText}${noteText}\n- **快捷交互**：可在卡片中点击“手动调整”滑动调整进度或修改备注，或点击“更新进度”开始自动分析。`;

            const cardPayload = {
              artifact_path: cardResult.path,
              embed_tag: cardResult.embedTag,
              summary: summaryText,
              progress: isEmptySession ? null : progressData?.progress,
              state: isEmptySession ? 'unstarted' : progressData?.state,
              user_markdown: userMarkdown,
            };
            return {
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(cardPayload, null, 2),
                  },
                ],
              },
            };
          }

          const result = await callProgressTool(this.store, body.name, normalizedArgs, { projectGit: key => this.projectGit(key), resolveProjects: async keys => {
            const projects = {};
            for (const key of keys) { const git = await this.projectGit(key); if (git.projectPath || git.projectKnown) projects[key] = git.projectPath || null; }
            return projects;
          }, resolveSources: async (key, tasks) => {
            const server = this.makeServer();
            try { await server.initialize(); return await require('../../task-provenance.cjs').resolveTaskSources(server.request.bind(server), key, tasks); }
            finally { await server.close(); }
          } });
          this.broadcastState(targetCleanId);
          return { result };
        }
        throw new Error('未知服务路径');
      },
    });
    this.server = this.http.server;
    try {
      const migration = executeMigration(this.stateFile);
      if (migration.migrated) {
        this.store.reloadIfModified(true);
        this.log('service.migration', migration.report);
      }
      this.store.recoverPending();
    }
    catch (error) { await this.http.close(); this.server = null; throw error; }
    this.port = this.http.credentials.port;
    return this.port;
  }

  async stop() {
    if (this.analysisService) {
      await this.analysisService.stop?.();
    }
    if (this.server) {
      await this.http.close();
      this.server = null;
    }
  }
}

module.exports = { AntigravityService, DEFAULT_PORT, DEFAULT_STATE_FILE };
