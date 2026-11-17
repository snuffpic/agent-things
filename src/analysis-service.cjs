'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createAnalysisLog, diagnosticFields } = require('./analysis-log.cjs');
const { captureExtracted } = require('./analysis-source.cjs');
const { prepareIncremental, commitCheckpoint } = require('./analysis-history.cjs');
const { mergeAnalysis } = require('./analysis-ledger.cjs');
const { readProjectGit } = require('./analysis-git.cjs');
const { assertUpdateIdle } = require('./npm-updates.cjs');

const { nextBatch, measureRequest, splitAdaptiveBatches, FULL_PASS_MAX_BYTES, FULL_PASS_TOKEN_BUDGET, getAnalysisInstructions } = require('./analysis-budget.cjs');
const { errorDetails, progressError } = require('./progress-error.cjs');
const { readConfiguredLang } = require('./i18n.cjs');
const versions = { prompt: '5', schema: '5', ledger: '3' };
class AnalysisService {
  constructor({ store, onChange = () => {}, makeServer, run,
    resources = path.join(__dirname, 'analysis-assets'), logFile = path.join(path.dirname(store.file), 'analysis.jsonl'),
    maxBytes = FULL_PASS_MAX_BYTES, tokenBudget = FULL_PASS_TOKEN_BUDGET, lang = null }) {
    if (typeof makeServer !== 'function' || typeof run !== 'function') throw new TypeError('分析服务需要会话源和模型执行器');
    Object.assign(this, { store, onChange, makeServer, run, resources, maxBytes, tokenBudget, lang });
    this.log = createAnalysisLog(logFile);
    this.active = new Map();
    this.stopped = false;
  }
  activeLang() {
    return this.lang || readConfiguredLang({ dataDir: path.dirname(this.store.file) });
  }
  analyze(key) { return this.start(key).promise; }

  start(key, { requestId } = {}) {
    if (this.stopped) throw progressError('SERVICE_STOPPING');
    const existing = [...this.active.values()].find(job => job.key === key);
    if (existing && this.store.analysisState(key).timeline.some(event => event.actionSequence === existing.sequence && event.status === 'pending')) return { promise: existing.promise, runId: existing.runId, actionSequence: existing.sequence };
    assertUpdateIdle();
    const [hostId, sidebarId] = JSON.parse(key);
    const threadId = sidebarId.startsWith('local:') ? sidebarId.slice(6) : sidebarId;
    if (hostId !== 'local') throw new Error('当前仅支持本机会话');
    const runId = crypto.randomUUID();
    let sequence;
    try { sequence = this.store.beginAnalysis(key, null); }
    catch (error) { this.log('analysis.rejected', { runId, requestId, threadId, ...diagnosticFields(error) }); throw error; }
    this.onChange(key, { status: 'pending', stage: 'starting' });
    const controller = new AbortController();
    const startedAt = Date.now(), startedMono = performance.now();
    const log = (event, fields = {}) => this.log(event, { runId, requestId, threadId, hostId, actionSequence: sequence,
      jobElapsedMs: Math.round(performance.now() - startedMono), jobWallElapsedMs: Date.now() - startedAt, ...fields });
    const job = { key, runId, sequence, controller, server: null, promise: null, log };
    log('analysis.start', { promptVersion: versions.prompt, schemaVersion: versions.schema, ledgerVersion: versions.ledger });
    this.active.set(sequence, job);
    job.promise = this.runAnalysis(key, sequence, hostId, threadId, job).finally(() => this.active.delete(sequence));
    return { promise: job.promise, runId, actionSequence: sequence };
  }

  async runAnalysis(key, sequence, hostId, threadId, job) {
    let server;
    try {
      server = job.server = this.makeServer({ log: job.log }); await server.initialize();
      job.controller.signal.throwIfAborted();
      let attempt = 1;
      const capture = () => captureExtracted(server.request.bind(server), hostId, threadId, info => {
        this.store.updateAnalysis(key, sequence, { boundary: info.boundary, boundaryAttempt: attempt, stats: { turnCount: info.turnCount, rawBytes: info.rawBytes, compactBytes: info.compactBytes } });
        job.log('source.page', { attempt, turnCount: info.turnCount, rawBytes: info.rawBytes, compactBytes: info.compactBytes,
          throughTurnId: info.boundary?.turnId });
        this.onChange(key, { status: 'pending', stage: 'reading' });
      });
      this.store.updateAnalysis(key, sequence, { stage: 'reading' }); this.onChange(key, { status: 'pending', stage: 'reading' });
      job.log('analysis.stage', { stage: 'reading', attempt });
      let captured;
      try { captured = await capture(); }
      catch (error) {
        if (error.code !== 'APP_SERVER_TIMEOUT' || job.controller.signal.aborted) throw error;
        job.log('source.retry', { attempt: 2, ...diagnosticFields(error) });
        this.store.updateAnalysis(key, sequence, { stage: 'retrying' }); this.onChange(key, { status: 'pending', stage: 'retrying' });
        await server.close();
        job.controller.signal.throwIfAborted();
        server = job.server = this.makeServer({ log: job.log });
        await server.initialize();
        job.controller.signal.throwIfAborted();
        attempt = 2;
        this.store.updateAnalysis(key, sequence, { stage: 'reading', stats: { turnCount: 0, rawBytes: 0, compactBytes: 0 }, attempt: 2 }); this.onChange(key, { status: 'pending', stage: 'reading' });
        captured = await capture();
      }
      this.store.updateAnalysis(key, sequence, { boundary: captured.boundary, boundaryAttempt: attempt, stats: { turnCount: captured.boundary?.turnCount ?? 0, rawBytes: captured.extracted.stats.rawBytes, compactBytes: captured.extracted.stats.compactBytes } }); this.onChange(key, { status: 'pending', stage: 'reading' });
      const extracted = captured.extracted;
      const projectGit = await readProjectGit(server.request.bind(server), threadId);
      job.log('project.git', { reason: projectGit.status, hasRemote: projectGit.hasRemote });
      const lang = this.activeLang();
      const activeVersions = lang === 'en'
        ? { ...versions, prompt: `${versions.prompt}-en`, schema: `${versions.schema}-en` }
        : versions;
      const instructions = getAnalysisInstructions(lang);
      const previous = this.store.analysisState(key).analysis;
      const delta = prepareIncremental(extracted, previous?.checkpoint, activeVersions);
      job.log('source.complete', { reason: delta.reason, turnCount: extracted.turnHashes.length,
        rawBytes: extracted.stats.rawBytes, compactBytes: extracted.stats.compactBytes, eventCount: delta.events.length,
        changedTurn: delta.changedTurn, previousTaskCount: previous?.ledger?.tasks?.length || 0, lang });
      let ledger = previous?.ledger || delta.ledger;
      const allSources = { ...extracted.sources };
      if (ledger) {
        ledger = structuredClone(ledger);
        // Replayed history may assign an old short ref to a different message.
        const sourceRefs = new Map();
        const retainedRefs = new Set(ledger.tasks.flatMap(task => task.evidenceRefs || []));
        for (const ref of ledger.gitPush?.evidenceRefs || []) retainedRefs.add(ref);
        for (const [ref, source] of Object.entries(previous?.sources || {})) {
          if (!retainedRefs.has(ref)) continue;
          const nextRef = delta.reason === 'incremental' ? ref : `p${sequence}_${ref}`;
          sourceRefs.set(ref, nextRef);
          allSources[nextRef] = source;
        }
        const remap = refs => (refs || []).map(ref => sourceRefs.get(ref) || ref);
        for (const task of ledger.tasks) task.evidenceRefs = remap(task.evidenceRefs);
        if (ledger.gitPush) ledger.gitPush.evidenceRefs = remap(ledger.gitPush.evidenceRefs);
      }
      const manualEvents = this.store.analysisState(key).timeline.filter(item => item.source === 'manual' && item.actionSequence < sequence &&
        item.actionSequence > (delta.reason === 'incremental' ? previous?.checkpoint?.actionSequence || 0 : 0)).map(item => {
          const ref = `m${item.actionSequence}`;
          allSources[ref] = { hostId, threadId, actionSequence: item.actionSequence, requestedAt: item.requestedAt };
          return { ref, type: 'manual', effectiveAtMs: item.requestedAt, state: item.record.state, progress: item.record.progress ?? null, note: item.record.note ?? '' };
        });
      const promptFile = lang === 'en' && fs.existsSync(path.join(this.resources, 'prompt.en.txt')) ? 'prompt.en.txt' : 'prompt.zh-CN.txt';
      const schemaFile = lang === 'en' && fs.existsSync(path.join(this.resources, 'output.en.schema.json')) ? 'output.en.schema.json' : 'output.schema.json';
      const prompt = fs.readFileSync(path.join(this.resources, promptFile), 'utf8');
      const schema = JSON.parse(fs.readFileSync(path.join(this.resources, schemaFile), 'utf8'));
      if (manualEvents.length && delta.events.some(event => event.turnStartedAt == null)) {
        extracted.gaps.push(lang === 'en' ? 'Some turn timestamps are unknown; ordering with manual records could not be verified' : '部分对话时间未知，无法确定与手动记录的先后');
      }
      this.store.updateAnalysis(key, sequence, { stage: 'analyzing', batch: { current: 1, total: 1 } }); this.onChange(key, { status: 'pending', stage: 'analyzing' });
      job.log('analysis.stage', { stage: 'analyzing' });
      const allowedRefs = new Set((ledger?.tasks || []).flatMap(task => task.evidenceRefs));
      for (const ref of ledger?.gitPush?.evidenceRefs || []) allowedRefs.add(ref);

      // 优先单次全量打完；若超出预算则自适应 1/2 对半折叠（Binary Split）拆分成批次
      const manualContext = manualEvents;
      const batches = splitAdaptiveBatches({
        events: delta.events,
        baseInput: { manualContext, gaps: extracted.gaps, projectGit },
        prompt,
        schema,
        maxBytes: this.maxBytes,
        tokenBudget: this.tokenBudget,
        sources: allSources,
        lang,
        instructions,
      });
      const totalBatches = batches.length;
      if (totalBatches > 1) {
        job.log('model.batch.split', { totalBatches, totalEvents: delta.events.length, reason: 'budget_exceeded_adaptive_split' });
      }

      for (let b = 0; b < totalBatches; b++) {
        const currentBatch = b + 1;
        const events = batches[b];
        const input = { previousLedger: ledger, events, manualContext, gaps: extracted.gaps, projectGit };
        for (const event of events) allowedRefs.add(event.ref);
        for (const event of manualContext) allowedRefs.add(event.ref);

        this.store.updateAnalysis(key, sequence, { stage: 'analyzing', batch: { current: currentBatch, total: totalBatches } });
        this.onChange(key, { status: 'pending', stage: 'analyzing', batch: { current: currentBatch, total: totalBatches } });

        const log = (event, fields) => job.log(event, { batch: currentBatch, totalBatches, ...fields });
        const budget = measureRequest({ input, prompt, schema, maxBytes: this.maxBytes, tokenBudget: this.tokenBudget, lang, instructions });
        log('model.batch.start', { eventCount: events.length, inputBytes: budget.inputBytes, bytes: budget.bytes, estimatedTokens: budget.estimatedTokens });
        const result = await this.run({ prompt, schema, log, signal: job.controller.signal, input, maxBytes: this.maxBytes, tokenBudget: this.tokenBudget, lang, instructions });
        job.controller.signal.throwIfAborted();
        ledger = mergeAnalysis(ledger, result, allowedRefs, { lang });
        log('model.batch.complete', { totalTasks: ledger.totalTasks, completedTasks: ledger.completedTasks, percent: ledger.percent });
      }
      job.controller.signal.throwIfAborted();
      const checkpoint = commitCheckpoint(extracted, ledger, activeVersions);
      checkpoint.actionSequence = sequence;
      this.store.finishAnalysis(key, sequence, { ledger, checkpoint, sources: allSources, boundary: captured.boundary, projectGit });
      job.log('analysis.complete', { totalTasks: ledger.totalTasks, completedTasks: ledger.completedTasks, percent: ledger.percent });
      this.onChange(key, { status: 'completed' });
      return this.store.analysisState(key);
    } catch (error) {
      if (job.controller.signal.aborted) error = job.controller.signal.reason;
      job.log('analysis.failed', diagnosticFields(error));
      this.store.finishAnalysis(key, sequence, { error: error.message, errorCode: errorDetails(error, 'ANALYSIS_FAILED').code });
      this.onChange(key, { status: 'failed', error: error.message });
      throw error;
    } finally {
      job.log('analysis.cleanup.start');
      await server?.close();
      job.log('analysis.cleanup.complete');
    }
  }

  async stop() {
    this.stopped = true;
    const jobs = [...this.active.values()];
    for (const job of jobs) { job.log('analysis.cancel'); job.controller.abort(progressError('SERVICE_STOPPING')); job.server?.close(); }
    await Promise.allSettled(jobs.map(job => job.promise));
  }
}
module.exports = { AnalysisService };
