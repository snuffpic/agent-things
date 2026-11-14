'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { normalizeProjectPath } = require('./project-path.cjs');
const { withStateFileLock } = require('./state-file-lock.cjs');
const { mergeAnalysis, summarizeTasks } = require('./analysis-ledger.cjs');
const { readConfiguredLang } = require('./i18n.cjs');

const { progressError } = require('./progress-error.cjs');

const STATES = new Set(['unstarted', 'unfinished', 'completed', 'pushed']);

function normalizeRecord(input, { lang = readConfiguredLang() } = {}) {
  const en = lang === 'en';
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw progressError('INVALID_ARGUMENT', undefined, undefined, lang);
  if (!STATES.has(input.state)) throw progressError('INVALID_ARGUMENT', en ? 'Please choose a valid status' : '请选择有效状态', undefined, lang);
  let progress = input.progress;
  if (progress !== null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
    throw progressError('INVALID_ARGUMENT', en ? 'Progress must be an integer between 0 and 100, or empty' : '进度应为 0–100 的整数，或留空', undefined, lang);
  }
  if (typeof input.note !== 'string' || input.note.length > 4000) throw progressError('INVALID_ARGUMENT', en ? 'Note cannot exceed 4000 characters' : '事项记录最多 4000 字', undefined, lang);
  let state = input.state;
  if (state === 'unstarted') progress = 0;
  else if (state === 'completed' || state === 'pushed') progress = 100;
  else if (progress === 100) state = 'completed';
  return { state, progress, note: input.note, source: 'manual' };
}

class ManualStatusStore {
  constructor(file, { lang } = {}) {
    this.file = file;
    this._lang = lang || null;
    this.lastMtimeMs = 0;
    this.data = { version: 1, revision: 0, records: {} };
    const en = this.lang() === 'en';
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Number.isInteger(data.revision) || !data.records || Array.isArray(data.records)) {
        throw new Error(en ? 'Unsupported status file format; preserve the file and check it' : '状态文件格式不受支持，请保留原文件后检查');
      }
      for (const record of Object.values(data.records)) {
        if (record.state !== null) normalizeRecord(record, { lang: this.lang() });
        if (!Number.isInteger(record.revision)) throw new Error(en ? 'Status record is missing revision number' : '状态记录缺少修订号');
      }
      this.data = data;
      this.lastMtimeMs = stat.mtimeMs;
    }
  }

  lang() {
    return this._lang || readConfiguredLang({ dataDir: this.file ? path.dirname(this.file) : undefined });
  }

  reloadIfModified(force = false) {
    let stat;
    try { stat = fs.statSync(this.file); }
    catch (error) {
      if (error.code === 'ENOENT' && !this.lastMtimeMs) return false;
      throw error;
    }
    if (!force && stat.mtimeMs === this.lastMtimeMs) return false;
    const loaded = new ManualStatusStore(this.file, { lang: this._lang });
    const changed = this.data.revision !== loaded.data.revision || stat.mtimeMs !== this.lastMtimeMs;
    this.data = loaded.data;
    this.lastMtimeMs = loaded.lastMtimeMs;
    return changed;
  }

  transaction(operation) {
    if (this.writing) return operation();
    return withStateFileLock(this.file, () => {
      this.reloadIfModified(true);
      this.writing = true;
      try { return operation(); }
      catch (error) { this.reloadIfModified(true); throw error; }
      finally { this.writing = false; }
    });
  }

  _normalizeAnalysis(rawAnalysis, lang = this.lang()) {
    const analysis = structuredClone(rawAnalysis || null);
    if (analysis?.ledger?.tasks) {
      const { scopeComplete, needsReview, ...ledger } = analysis.ledger;
      analysis.ledger = { ...ledger, ...summarizeTasks(ledger, { lang }) };
    }
    return analysis;
  }

  _projectTimelineItem(item, lang = this.lang()) {
    const event = structuredClone(item);
    if (event.source === 'analysis' && event.status === 'completed' && Array.isArray(event.ledger?.tasks)) {
      const { scopeComplete, needsReview, ...ledger } = event.ledger;
      event.ledger = { ...ledger, ...summarizeTasks(ledger, { lang }) };
      event.progress = event.ledger.percent;
      event.progressBasis = event.ledger.basis;
    }
    return event;
  }

  _summarizeTimelineItem(item, lang = this.lang()) {
    const progress = item.source === 'analysis' && item.status === 'completed' && Array.isArray(item.ledger?.tasks)
      ? (typeof item.progress === 'number' ? item.progress : summarizeTasks(item.ledger, { lang }).percent)
      : (item.progress ?? item.record?.progress ?? null);
    return {
      actionSequence: item.actionSequence,
      source: item.source,
      status: item.status,
      requestedAt: item.requestedAt,
      stage: item.stage,
      error: item.error,
      progress,
      summary: (item.summary || item.ledger?.summary || item.record?.note || '').slice(0, 200),
    };
  }

  _attachTaskSources(analysis) {
    const ledger = analysis?.ledger;
    return (ledger?.tasks || []).map(task => {
      const ref = task.evidenceRefs?.find(id => analysis.sources?.[id]?.turnId);
      const pointer = ref && analysis.sources[ref];
      return { ...task, ...(pointer ? { source: { turnId: pointer.turnId, itemId: pointer.itemId, locator: pointer.locator } } : {}) };
    });
  }

  projectedTimeline(key) {
    this.reloadIfModified();
    return (this.data.timeline || []).filter(item => item.key === key).map(item => this._projectTimelineItem(item));
  }

  snapshot() {
    this.reloadIfModified();
    const { version, revision } = this.data;
    const lang = this.lang();
    const records = structuredClone(this.data.records);
    for (const [key, record] of Object.entries(records)) {
      if (record.source !== 'analysis') continue;
      if (record.progress == null) {
        const event = (this.data.timeline || []).find(item => item.key === key && item.source === 'analysis' && item.actionSequence === record.actionSequence && item.status === 'completed');
        if (event?.ledger?.tasks?.length) {
          const totals = summarizeTasks(event.ledger, { lang });
          record.progress = totals.percent;
          record.state = totals.completedTasks === totals.totalTasks ? 'completed' : 'unfinished';
        }
      }
      delete record.needsReview;
    }
    const analyzingKeys = [...new Set((this.data.timeline || []).filter(item => item.source === 'analysis' && item.status === 'pending').map(item => item.key))];
    return { version, revision, records, analyzingKeys };
  }

  analysisState(key) {
    this.reloadIfModified();
    const lang = this.lang();
    const analysis = this._normalizeAnalysis(this.data.analysis?.[key], lang);
    const timeline = (this.data.timeline || []).filter(item => item.key === key).map(item => this._projectTimelineItem(item, lang));
    return { revision: this.data.revision, analysis, timeline };
  }

  // 只读单会话投影：避免在高频 read/watch 中全量克隆所有会话记录与历史任务台账大对象。
  readSessionProjection(key) {
    this.reloadIfModified();
    const lang = this.lang();
    const revision = this.data.revision;
    const rawRecord = this.data.records?.[key];
    const record = rawRecord ? structuredClone(rawRecord) : null;
    const analysis = this._normalizeAnalysis(this.data.analysis?.[key], lang);
    const rawTimeline = (this.data.timeline || []).filter(item => item.key === key);
    const timelineSummary = rawTimeline.map(item => this._summarizeTimelineItem(item, lang));
    let latestAnalysisEvent = null;
    for (let i = rawTimeline.length - 1; i >= 0; i--) {
      if (rawTimeline[i].source === 'analysis') {
        const item = rawTimeline[i];
        latestAnalysisEvent = { status: item.status, stage: item.stage, actionSequence: item.actionSequence, errorCode: item.errorCode };
        break;
      }
    }
    const activeTasks = record && record.state !== null && analysis?.ledger?.tasks ? this._attachTaskSources(analysis) : [];
    const timelineVersionInput = JSON.stringify([record, analysis, rawTimeline]);
    return { revision, record, analysis, activeTasks, latestAnalysisEvent, timelineSummary, timelineVersionInput };
  }

  write(next) {
    if (!this.writing) {
      const baseRevision = this.data.revision;
      const lang = this.lang();
      return this.transaction(() => {
        if (this.data.revision !== baseRevision) {
          throw progressError('REVISION_CONFLICT', lang === 'en' ? 'Ledger was updated in another process; please read again' : '账本已在其他进程更新，请重新读取', undefined, lang);
        }
        return this.write(next);
      });
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    this.data = next;
    this.lastMtimeMs = fs.statSync(this.file).mtimeMs;
    return this.snapshot();
  }

  recoverPending() {
    const lang = this.lang();
    return this.transaction(() => {
      const next = structuredClone(this.data);
      let changed = false;
      for (const event of next.timeline || []) {
        if (event.source === 'analysis' && event.status === 'pending') {
          event.status = 'failed';
          event.errorCode = 'SERVICE_STOPPING';
          event.error = lang === 'en' ? 'Background service interrupted' : '后台进程中断';
          event.finishedAt = Date.now();
          changed = true;
        }
      }
      if (changed) { next.revision++; this.write(next); }
    });
  }

  beginAnalysis(key, boundary) {
    const lang = this.lang();
    const en = lang === 'en';
    return this.transaction(() => {
      if (!this.validKey(key)) throw progressError('INVALID_ARGUMENT', en ? 'Invalid session identifier' : '无效会话标识', undefined, lang);
      const next = structuredClone(this.data);
      if (next.timeline?.some(item => item.key === key && item.source === 'analysis' && item.status === 'pending')) {
        throw new Error(en ? 'Analysis is already running for this session' : '此会话已有分析进行中');
      }
      const sequence = next.actionSequence = (next.actionSequence || 0) + 1;
      next.revision++;
      (next.timeline ||= []).push({ key, actionSequence: sequence, source: 'analysis', status: 'pending', requestedAt: Date.now(), stage: 'starting', stageStartedAt: Date.now(), stageDurations: {}, boundary });
      this.write(next);
      return sequence;
    });
  }

  updateAnalysis(key, sequence, progress) {
    return this.transaction(() => {
      const next = structuredClone(this.data);
      const event = next.timeline?.find(item => item.key === key && item.actionSequence === sequence && item.source === 'analysis');
      if (!event || event.status !== 'pending') return;
      const now = Date.now();
      if (progress.stage && progress.stage !== event.stage) {
        if (event.stage) (event.stageDurations ||= {})[event.stage] = (event.stageDurations[event.stage] || 0) + now - event.stageStartedAt;
        event.stage = progress.stage; event.stageStartedAt = now;
      }
      if (progress.boundary !== undefined) event.boundary = progress.boundary;
      if (progress.boundaryAttempt !== undefined) event.boundaryAttempt = progress.boundaryAttempt;
      if (progress.stats !== undefined) event.stats = progress.stats;
      if (progress.batch !== undefined) event.batch = progress.batch;
      if (progress.attempt !== undefined) event.attempt = progress.attempt;
      next.revision++;
      this.write(next);
    });
  }

  finishAnalysis(key, sequence, result) {
    const lang = this.lang();
    const en = lang === 'en';
    return this.transaction(() => {
      const current = this.data.records[key];
      if (current?.clearedAtSequence >= sequence) return this.snapshot();
      const next = structuredClone(this.data);
      const event = next.timeline?.find(item => item.key === key && item.actionSequence === sequence && item.source === 'analysis');
      if (!event || event.status !== 'pending') throw new Error(en ? 'Analysis job not found or already finished' : '分析操作不存在或已结束');
      event.finishedAt = Date.now();
      if (event.stage && event.stageStartedAt) (event.stageDurations ||= {})[event.stage] = (event.stageDurations[event.stage] || 0) + event.finishedAt - event.stageStartedAt;
      if (result.error) { event.status = 'failed'; event.error = result.error; event.errorCode = result.errorCode || 'ANALYSIS_FAILED'; }
      else {
        if (typeof result.ledger?.summary !== 'string' || result.ledger.summary.length > 4000 || !Array.isArray(result.ledger.tasks)) {
          throw new Error(en ? 'Invalid analysis result' : '分析结果无效');
        }
        const { scopeComplete, needsReview, ...resultLedger } = result.ledger;
        const totals = summarizeTasks(resultLedger, { lang });
        const ledger = { ...resultLedger, ...totals };
        event.status = 'completed'; event.summary = ledger.summary; event.ledger = ledger; event.boundary = result.boundary; event.sources = result.sources; event.projectGit = result.projectGit;
        event.progress = totals.percent;
        event.progressBasis = totals.basis;
        (next.analysis ||= {})[key] = { checkpoint: result.checkpoint ? { ...result.checkpoint, ledger } : null, sources: result.sources, ledger, projectGit: result.projectGit };
        if ((next.records[key]?.actionSequence || 0) < sequence) {
          const tasks = result.ledger.tasks;
          const progress = totals.percent;
          const complete = tasks.length && tasks.every(task => task.status === 'done');
          next.records[key] = { state: complete ? (result.projectGit?.hasRemote && ledger.gitPush?.status === 'pushed' ? 'pushed' : 'completed') : 'unfinished',
            projectPath: result.projectGit?.projectKnown ? result.projectGit.projectPath || null : result.projectGit?.projectPath || next.records[key]?.projectPath || null,
            projectResolved: Boolean(result.projectGit?.projectKnown || result.projectGit?.projectPath || next.records[key]?.projectResolved),
            ...(result.projectGit?.projectKnown || next.records[key]?.projectSource === 'host' ? { projectSource: 'host' } : {}),
          ...(next.records[key]?.clearedAtSequence ? { clearedAtSequence: next.records[key].clearedAtSequence } : {}),
          progress, note: result.ledger.summary, source: 'analysis', actionSequence: sequence, revision: next.revision + 1, updatedAt: event.finishedAt };
        }
      }
      next.revision++;
      return this.write(next);
    });
  }

  validKey(key) {
    let identity;
    try { identity = JSON.parse(key); } catch { return false; }
    return Array.isArray(identity) && identity.length === 2 && identity.every(v => typeof v === 'string' && v && v.length <= 512);
  }

  resolveKey(convId) {
    this.reloadIfModified();
    const en = this.lang() === 'en';
    if (typeof convId !== 'string' || !convId.trim()) throw new Error(en ? 'Please provide a session identifier' : '请指定会话标识');
    if (this.validKey(convId)) return convId;

    const raw = String(convId).trim();
    const cleanId = raw.replace(/^local:/, '');

    const matches = Object.keys(this.data.records || {}).filter(key => {
      const [host, id] = JSON.parse(key);
      return host === 'local' && id.replace(/^local:/, '') === cleanId;
    });
    if (matches.length > 1) throw new Error(en ? 'Multiple sessions match this identifier; please provide the full key' : '会话标识有多个匹配，请提供完整标识');
    return matches[0] || JSON.stringify(['local', `local:${cleanId}`]);
  }

  getProgress(convId) {
    this.reloadIfModified();
    const lang = this.lang();
    const key = this.resolveKey(convId);
    const rawRecord = this.data.records?.[key];
    const record = rawRecord ? structuredClone(rawRecord) : null;
    if (!record || record.state === null) return null;

    const analysis = this._normalizeAnalysis(this.data.analysis?.[key], lang);
    const ledger = analysis?.ledger;

    return {
      key,
      state: record.state,
      progress: record.progress,
      note: record.note,
      source: record.source,
      revision: record.revision,
      updatedAt: record.updatedAt,
      projectPath: record.projectPath || null,
      projectResolved: Boolean(record.projectResolved || record.projectPath),
      tasks: this._attachTaskSources(analysis),
      totalTasks: ledger?.totalTasks ?? (ledger?.tasks?.length || 0),
      completedTasks: ledger?.completedTasks ?? (ledger?.tasks?.filter(t => t.status === 'done').length || 0),
      remainingTasks: ledger?.remainingTasks ?? (ledger?.tasks?.filter(t => t.status !== 'done').length || 0),
      summary: record.note || '',
      taskProgress: ledger ? summarizeTasks(ledger, { lang }).percent : null,
      tasksSource: ledger ? 'analysis' : null,
    };
  }

  enrichProjects(projects) {
    return this.transaction(() => {
      const next = structuredClone(this.data);
      let changed = false;
      for (const [key, value] of Object.entries(projects)) {
        const projectPath = normalizeProjectPath(value);
        if (next.records[key]?.state && (next.records[key].projectSource !== 'host' || !next.records[key].projectResolved || next.records[key].projectPath !== projectPath)) {
          next.records[key].projectPath = projectPath;
          next.records[key].projectResolved = true;
          next.records[key].projectSource = 'host';
          changed = true;
        }
      }
      if (changed) { next.revision++; this.write(next); }
      return changed;
    });
  }

  enrichTaskSources(key, expectedRevision, pointers) {
    const lang = this.lang();
    const en = lang === 'en';
    return this.transaction(() => {
      const record = this.data.records[key];
      if (!record || record.revision !== expectedRevision) {
        throw progressError('REVISION_CONFLICT', en ? 'Task ledger has changed; please read again' : '任务记录已变化，请重新读取', undefined, lang);
      }
      const next = structuredClone(this.data);
      const analysis = next.analysis?.[key];
      if (!analysis) return false;
      let changed = false;
      for (const [index, task] of analysis.ledger.tasks.entries()) {
        if (!pointers[index]) continue;
        const existing = task.evidenceRefs.map(ref => analysis.sources?.[ref]).find(source => source?.turnId);
        if (existing?.turnId === pointers[index].turnId && existing?.itemId === pointers[index].itemId && existing?.locator === pointers[index].locator) continue;
        const ref = `q${record.actionSequence}_${index + 1}`;
        (analysis.sources ||= {})[ref] = pointers[index];
        task.evidenceRefs = [ref]; changed = true;
      }
      if (!changed) return false;
      if (analysis.checkpoint) analysis.checkpoint.ledger = structuredClone(analysis.ledger);
      const latest = (next.timeline || []).findLast(item => item.key === key && item.source === 'analysis' && item.status === 'completed');
      if (latest) { latest.ledger = structuredClone(analysis.ledger); latest.sources = structuredClone(analysis.sources); }
      next.revision++; this.write(next);
      return true;
    });
  }

  applyTaskDelta({ key, expectedRevision, delta, projectGit, taskSources = [] }) {
    const lang = this.lang();
    const en = lang === 'en';
    return this.transaction(() => {
      if (!this.validKey(key)) throw progressError('INVALID_ARGUMENT', en ? 'Invalid session identifier' : '无效会话标识', undefined, lang);
      const previous = this.data.records[key];
      if ((previous?.revision ?? 0) !== expectedRevision) throw progressError('REVISION_CONFLICT', undefined, undefined, lang);
      const analysis = this.data.analysis?.[key];
      if (typeof delta?.summary !== 'string' || delta.summary.length > 4000 || !Array.isArray(delta.tasks)) {
        throw progressError('INVALID_ARGUMENT', en ? 'Invalid task delta' : '任务增量无效', undefined, lang);
      }
      const sequence = (this.data.actionSequence || 0) + 1;
      const ref = `m${sequence}`;
      const sources = { ...(analysis?.sources || {}), [ref]: { actionSequence: sequence, requestedAt: Date.now() } };
      const tasks = delta.tasks.map((task, index) => {
        const { source, ...change } = task;
        const pointer = taskSources[index];
        const prior = analysis?.ledger?.tasks.find(item => item.id === task.knownTaskId);
        let evidenceRefs = task.evidenceRefs?.length ? task.evidenceRefs : prior?.evidenceRefs?.length ? prior.evidenceRefs : [ref];
        if (pointer) {
          const sourceRef = `q${sequence}_${index + 1}`;
          sources[sourceRef] = pointer;
          evidenceRefs = [sourceRef];
        }
        return { ...change, evidenceRefs };
      });
      const ledger = mergeAnalysis(analysis?.ledger, { ...delta, tasks }, Object.keys(sources), { lang });
      this.beginAnalysis(key, null);
      return this.finishAnalysis(key, sequence, { ledger, sources, checkpoint: analysis?.checkpoint,
        boundary: null, projectGit: projectGit || analysis?.projectGit });
    });
  }

  update({ key, expectedRevision, record, projectPath }) {
    const lang = this.lang();
    const en = lang === 'en';
    return this.transaction(() => {
      this.reloadIfModified();
      if (!this.validKey(key)) throw progressError('INVALID_ARGUMENT', en ? 'Invalid session identifier' : '无效会话标识', undefined, lang);
      const previous = this.data.records[key];
      if ((previous?.revision ?? 0) !== expectedRevision) throw progressError('REVISION_CONFLICT', undefined, undefined, lang);
      const next = structuredClone(this.data);
      next.revision++;
      const actionSequence = next.actionSequence = (next.actionSequence || 0) + 1;
      // Keep a revisioned empty record so a stale window cannot resurrect a cleared mark.
      next.records[key] = record === null
        ? { state: null, actionSequence, revision: next.revision, updatedAt: Date.now() }
        : { ...normalizeRecord(record, { lang }), actionSequence, revision: next.revision, updatedAt: Date.now() };
      if (previous?.clearedAtSequence) next.records[key].clearedAtSequence = previous.clearedAtSequence;
      if (record === null) {
        next.records[key].clearedAtSequence = actionSequence;
        delete next.analysis?.[key];
        next.timeline = (next.timeline || []).filter(event => event.key !== key);
      }
      if (record !== null && (projectPath || previous?.projectPath)) {
        next.records[key].projectPath = normalizeProjectPath(previous?.projectSource === 'host' ? previous.projectPath : projectPath || previous.projectPath);
        next.records[key].projectResolved = true;
        if (previous?.projectSource === 'host') next.records[key].projectSource = 'host';
      }
      (next.timeline ||= []).push({ key, actionSequence, source: 'manual', status: 'completed', requestedAt: Date.now(), boundary: { status: 'unknown' }, record: next.records[key] });
      return this.write(next);
    });
  }
}

module.exports = { ManualStatusStore, normalizeRecord };
