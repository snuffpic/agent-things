'use strict';
const { createHash } = require('node:crypto');
const { errorDetails } = require('./progress-error.cjs');
const PROTOCOL_VERSION = 1;
function sessionView(store, key, { projectGit, capabilities = {}, projection = null } = {}) {
  let saved, analysisObj, event, tasks, git, versionInput;
  if (projection || typeof store.readSessionProjection === 'function') {
    const view = projection || store.readSessionProjection(key);
    saved = view.record;
    analysisObj = view.analysis;
    event = view.latestAnalysisEvent;
    tasks = (saved && saved.state !== null ? view.activeTasks : null) || analysisObj?.ledger?.tasks || [];
    git = projectGit || analysisObj?.projectGit || null;
    versionInput = view.timelineVersionInput;
  } else {
    const snapshot = store.snapshot(), state = store.analysisState(key);
    saved = snapshot.records[key];
    analysisObj = state.analysis;
    event = state.timeline.findLast(item => item.source === 'analysis');
    tasks = store.getProgress(key)?.tasks || analysisObj?.ledger?.tasks || [];
    git = projectGit || analysisObj?.projectGit || null;
    versionInput = JSON.stringify([saved, analysisObj, state.timeline]);
  }
  const record = saved?.state ? saved : null;
  const analysis = { status: event?.status || 'idle', stage: event?.stage || null, runId: event?.actionSequence ?? null,
    error: event?.status === 'failed' ? errorDetails({ code: event.errorCode }, 'ANALYSIS_FAILED') : null };
  const sessionVersion = createHash('sha256').update(versionInput).digest('hex');
  return { schemaVersion: PROTOCOL_VERSION, key, sessionVersion, recordRevision: saved?.revision ?? 0, record, tasks, analysis,
    projectGit: git, capabilities: { read: true, save: true, clear: true, analyze: JSON.parse(key)[0] === 'local', watch: true, locate: false, update: true, ...capabilities } };
}
module.exports = { sessionView, PROTOCOL_VERSION };
