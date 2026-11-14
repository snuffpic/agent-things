'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { callProgressTool, tools } = require('../src/progress-tools.cjs');

test('clear removes all tasks and history, rejects stale writes, and fences in-flight analysis', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-progress-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(dir, 'state.json'));
  const key = store.resolveKey('clear-test');
  const otherKey = store.resolveKey('other-test');
  store.update({ key: otherKey, expectedRevision: 0, record: { state: 'unfinished', progress: 25, note: 'keep' } });
  store.applyTaskDelta({ key, expectedRevision: 0, delta: { summary: 'tasks', tasks: [
    { knownTaskId: null, title: 'done', status: 'done' },
    { knownTaskId: null, title: 'todo', status: 'todo' },
  ], removedTaskIds: [] } });
  const sequence = store.beginAnalysis(key, null);
  const revision = store.getProgress(key).revision;
  await assert.rejects(callProgressTool(store, 'clear_session_progress', { conversation_id: key, expected_revision: 0 }), /更新/);
  assert.equal(store.getProgress(key).tasks.length, 2);
  const result = await callProgressTool(store, 'clear_session_progress', { conversation_id: key, expected_revision: revision });
  assert.equal(result.cleared, true);
  assert.equal(store.getProgress(key), null);
  assert.equal(store.analysisState(key).analysis, null);
  assert.ok(store.projectedTimeline(key).every(event => !event.ledger && !event.sources));
  assert.deepEqual(store.snapshot().analyzingKeys, []);
  store.finishAnalysis(key, sequence, { ledger: { summary: 'late', tasks: [] } });
  assert.equal(store.getProgress(key), null);
  store.update({ key, expectedRevision: result.revision, record: { state: 'unfinished', progress: 10, note: 'new' } });
  store.finishAnalysis(key, sequence, { ledger: { summary: 'late', tasks: [] } });
  assert.equal(store.analysisState(key).analysis, null);
  assert.equal(store.getProgress(key).progress, 10);
  assert.equal(store.getProgress(otherKey).note, 'keep');
  assert.ok(tools.some(tool => tool.name === 'clear_session_progress'));
});

test('a fresh MCP reader can recreate a cleared checklist using its retained revision', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-recreate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(dir, 'state.json'));
  const key = store.resolveKey('clear-recreate');
  store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 50, note: 'old' } });
  await callProgressTool(store, 'clear_session_progress', { conversation_id: key, expected_revision: store.getProgress(key).revision });
  const empty = await callProgressTool(store, 'get_session_progress', { conversation_id: key });
  assert.equal(empty.cleared, true);
  const created = await callProgressTool(store, 'update_session_tasks', { conversation_id: key, expected_revision: empty.revision, summary: 'new', tasks: [{ knownTaskId: null, title: 'new task', status: 'todo' }], removedTaskIds: [] });
  assert.equal(created.tasks.length, 1);
});
