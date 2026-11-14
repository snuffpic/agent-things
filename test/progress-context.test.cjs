'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { callProgressTool } = require('../src/progress-tools.cjs');
const { resolveTaskSources } = require('../src/task-provenance.cjs');
const { CodexService } = require('../src/harnesses/codex/codex-service.cjs');
const key = JSON.stringify(['local', 'local:thread']);
const quote = '已经完成任务实现并通过全部自动测试';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new ManualStatusStore(path.join(dir, 'state.json')) };
}
const task = { knownTaskId: null, title: '任务实现', summary: '完成任务实现', status: 'done', source: { locator: quote } };
const request = async () => ({ data: [{ id: 'turn-1', items: [{ id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: quote }], startedAt: 1 }] });

test('task creation persists project identity and verified sources, and status-only updates retain them', async t => {
  const { store, dir } = setup(t);
  const options = { projectGit: async () => ({ hasRemote: false }), resolveSources: (key, tasks) => resolveTaskSources(request, key, tasks) };
  const first = await callProgressTool(store, 'update_session_tasks', { conversation_id: 'thread', expected_revision: 0, project_path: dir, summary: '完成', tasks: [task], removedTaskIds: [] }, options);
  assert.equal(first.projectPath, fs.realpathSync(dir));
  assert.equal(first.tasks[0].source.itemId, 'answer-1');
  assert.equal(first.tasks[0].source.locator, quote);
  const next = await callProgressTool(store, 'update_session_tasks', { conversation_id: 'thread', expected_revision: first.revision, summary: '继续', tasks: [{ knownTaskId: first.tasks[0].id, title: task.title, status: 'in_progress' }], removedTaskIds: [] }, options);
  assert.equal(next.tasks[0].source.itemId, 'answer-1');
  assert.equal(next.projectPath, fs.realpathSync(dir));
});

test('legacy project metadata is filled without replacing progress, notes or record versions', async t => {
  const { store, dir } = setup(t);
  store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 30, note: 'keep' } });
  const before = store.getProgress(key);
  let lookups = 0;
  const options = { resolveProjects: async keys => { lookups++; assert.deepEqual(keys, [key]); return { [key]: dir }; } };
  const list = await callProgressTool(store, 'list_all_session_statuses', { scope: 'current_project', project_path: dir }, options);
  assert.equal(list.returnedCount, 1);
  const after = store.getProgress(key);
  assert.deepEqual([after.progress, after.note, after.revision], [before.progress, before.note, before.revision]);
  await callProgressTool(store, 'list_all_session_statuses', { scope: 'current_project', project_path: dir }, options);
  assert.equal(lookups, 1);
});

test('source validation rejects fabricated or ambiguous quotes before writing', async t => {
  const { store } = setup(t);
  const options = { projectGit: async () => ({ hasRemote: false }), resolveSources: (key, tasks) => resolveTaskSources(request, key, tasks) };
  await assert.rejects(callProgressTool(store, 'update_session_tasks', { conversation_id: 'thread', expected_revision: 0, summary: '', tasks: [{ ...task, source: { locator: '这段原始内容并不存在于当前会话' } }], removedTaskIds: [] }, options), /未在本会话中找到/);
  assert.equal(store.snapshot().revision, 0);
  const duplicate = async () => ({ data: [{ id: 'turn-1', items: ['a1', 'a2'].map(id => ({ id, type: 'agentMessage', text: quote, phase: 'final_answer' })) }] });
  await assert.rejects(resolveTaskSources(duplicate, key, [task]), /匹配多条/);
  const pointer = await resolveTaskSources(duplicate, key, [{ ...task, source: { locator: quote, itemId: 'a2', turnId: 'turn-1' } }]);
  assert.equal(pointer[0].itemId, 'a2');
});

test('source enrichment preserves task status, count, record revision and latest checkpoint', async t => {
  const { store } = setup(t);
  const service = new CodexService({ store });
  t.after(() => service.stop());
  const other = store.resolveKey('other');
  store.update({ key: other, expectedRevision: 0, record: { state: 'unfinished', progress: 10, note: '' } });
  const created = await callProgressTool(store, 'update_session_tasks', { conversation_id: 'thread', expected_revision: 0, summary: '完成', tasks: [{ knownTaskId: null, title: task.title, status: 'done' }], removedTaskIds: [] });
  const before = service.snapshot();
  const [pointer] = await resolveTaskSources(request, key, [task]);
  const external = new ManualStatusStore(store.file);
  assert.equal(external.enrichTaskSources(key, created.revision, [pointer]), true);
  const after = service.snapshot();
  assert.deepEqual(after.records, before.records);
  assert.notEqual(after.keyVersions[key], before.keyVersions[key]);
  assert.equal(after.keyVersions[other], before.keyVersions[other]);
  assert.equal(service.snapshot(), after);
  const current = store.getProgress(key);
  assert.equal(current.revision, created.revision);
  assert.equal(current.tasks[0].id, created.tasks[0].id);
  assert.equal(current.progress, 100);
  assert.equal(current.tasks[0].source.itemId, 'answer-1');
});
