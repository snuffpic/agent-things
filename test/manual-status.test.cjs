'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualStatusStore, normalizeRecord } = require('../src/manual-status-store.cjs');

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-manual-status-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  return { file, store: new ManualStatusStore(file) };
}
const key = JSON.stringify(['local', 'local:test-thread']);
const record = { state: 'unfinished', progress: null, note: '浏览器验收\n推送 main' };

test('unknown progress survives reload; 100 completes and pushed is explicitly manual', t => {
  const { file, store } = setup(t);
  store.update({ key, expectedRevision: 0, record });
  assert.equal(new ManualStatusStore(file).snapshot().records[key].progress, null);
  store.update({ key, expectedRevision: 1, record: { ...record, progress: 100 } });
  assert.equal(store.snapshot().records[key].state, 'completed');
  store.update({ key, expectedRevision: 2, record: { ...record, state: 'pushed' } });
  assert.equal(store.snapshot().records[key].progress, 100);
  assert.equal(store.snapshot().records[key].source, 'manual');
});

test('clearing a mark persists its revision and rejects stale multi-window writes', t => {
  const { file, store } = setup(t);
  store.update({ key, expectedRevision: 0, record });
  assert.throws(() => store.update({ key, expectedRevision: 0, record }), /其他窗口/);
  store.update({ key, expectedRevision: 1, record: null });
  const reloaded = new ManualStatusStore(file);
  assert.equal(reloaded.snapshot().records[key].state, null);
  assert.throws(() => reloaded.update({ key, expectedRevision: 0, record }), /其他窗口/);
  reloaded.update({ key, expectedRevision: 2, record });
  assert.equal(reloaded.snapshot().revision, 3);
});

test('host identity isolates identical thread IDs; invalid inputs never replace saved state', t => {
  const { store } = setup(t);
  store.update({ key, expectedRevision: 0, record });
  const remote = JSON.stringify(['ssh:work', 'local:test-thread']);
  store.update({ key: remote, expectedRevision: 0, record: { ...record, progress: 60 } });
  assert.equal(store.snapshot().records[key].progress, null);
  assert.equal(store.snapshot().records[remote].progress, 60);
  assert.throws(() => store.update({ key, expectedRevision: 1, record: { ...record, progress: 101 } }));
  assert.equal(store.snapshot().revision, 2);
  assert.throws(() => normalizeRecord({ ...record, progress: 1.5 }));
  assert.throws(() => store.update({ key: '__proto__', expectedRevision: 0, record }));
});

test('corrupt state is preserved and startup fails visibly', t => {
  const { file } = setup(t);
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new ManualStatusStore(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('analysis completion respects later manual operation and preserves v1 records across reload', t => {
  const { file, store } = setup(t);
  store.update({ key, expectedRevision: 0, record });
  const sequence = store.beginAnalysis(key, { turnId: 't1' });
  assert.throws(() => store.beginAnalysis(key, {}), /进行中/);
  store.update({ key, expectedRevision: 1, record: { ...record, note: '较新的手动记录' } });
  store.finishAnalysis(key, sequence, { ledger: { summary: '分析结果', needsReview: false, tasks: [{ status: 'done' }] }, checkpoint: { id: 1 }, sources: {}, boundary: { turnId: 't1' } });
  const reloaded = new ManualStatusStore(file);
  assert.equal(reloaded.snapshot().records[key].note, '较新的手动记录');
  assert.equal(reloaded.analysisState(key).analysis.ledger.summary, '分析结果');
  assert.equal(reloaded.analysisState(key).timeline.length, 3);
  assert.equal(reloaded.snapshot().timeline, undefined);
});

test('interrupted analyses recover and completed tasks produce progress', t => {
  const { file, store } = setup(t);
  store.beginAnalysis(key, null);
  const restarted = new ManualStatusStore(file);
  restarted.recoverPending();
  assert.equal(restarted.analysisState(key).timeline[0].status, 'failed');
  const sequence = restarted.beginAnalysis(key, null);
  restarted.finishAnalysis(key, sequence, { ledger: { summary: '完成', tasks: [{ status: 'done' }] }, checkpoint: {}, sources: {}, boundary: null });
  assert.equal(restarted.snapshot().records[key].state, 'completed');
  assert.equal(restarted.snapshot().records[key].progress, 100);
});

test('analysis percentages describe completed tasks', t => {
  const { store } = setup(t);
  const finish = tasks => {
    const sequence = store.beginAnalysis(key, null);
    store.finishAnalysis(key, sequence, { ledger: { summary: '分析', tasks: tasks.map(status => ({ status })) }, checkpoint: {}, sources: {}, boundary: null });
    return store.snapshot().records[key];
  };
  assert.equal(finish(['done', 'done']).progress, 100);
  assert.equal(finish(['done', 'in_progress']).progress, 50);
  assert.equal(finish([...Array(7).fill('done'), 'todo', 'needs_verification']).progress, 78);
});

test('legacy analysis is projected from the matching ledger without changing saved data or manual actions', t => {
  const { file, store } = setup(t);
  const sequence = store.beginAnalysis(key, null);
  store.finishAnalysis(key, sequence, { ledger: { summary: '目标', tasks: [...Array(7).fill({ status: 'done' }), { status: 'todo' }, { status: 'needs_verification' }] }, checkpoint: {}, sources: {}, boundary: null });
  const old = structuredClone(store.data);
  old.records[key].progress = null; old.records[key].needsReview = true;
  old.timeline[0].ledger.scopeComplete = false; old.timeline[0].ledger.needsReview = true; old.timeline[0].progress = null;
  old.analysis[key].ledger.scopeComplete = false; old.analysis[key].ledger.needsReview = true;
  store.write(old);
  const contents = fs.readFileSync(file, 'utf8');
  const reloaded = new ManualStatusStore(file);
  assert.equal(reloaded.snapshot().records[key].progress, 78);
  assert.equal(reloaded.analysisState(key).timeline[0].progress, 78);
  assert.equal(reloaded.analysisState(key).analysis.ledger.percent, 78);
  assert.equal(fs.readFileSync(file, 'utf8'), contents);
  reloaded.update({ key, expectedRevision: reloaded.snapshot().records[key].revision, record: { ...record, progress: 50 } });
  assert.equal(reloaded.snapshot().records[key].progress, 50);
  assert.equal(reloaded.snapshot().records[key].source, 'manual');
});

test('sidebar snapshot exposes pending keys for both empty and recorded chats and clears them on failure', t => {
  const { store } = setup(t);
  const other = JSON.stringify(['local', 'local:other']);
  store.update({ key, expectedRevision: 0, record });
  const first = store.beginAnalysis(key, null);
  const second = store.beginAnalysis(other, null);
  assert.deepEqual(store.snapshot().analyzingKeys, [key, other]);
  assert.equal(store.snapshot().records[key].state, record.state);
  assert.equal(store.snapshot().records[other], undefined);
  store.finishAnalysis(key, first, { error: '测试失败' });
  assert.deepEqual(store.snapshot().analyzingKeys, [other]);
  store.finishAnalysis(other, second, { error: '测试失败' });
  assert.deepEqual(store.snapshot().analyzingKeys, []);
});

test('store reloads automatically when external process modifies manual-state.json', t => {
  const { file, store } = setup(t);
  store.update({ key, expectedRevision: 0, record: { ...record, progress: 100 } });
  assert.equal(store.snapshot().records[key].progress, 100);
  assert.equal(store.snapshot().revision, 1);

  // 模拟外部独立子进程（如 MCP 进程）直接修改磁盘文件
  const diskData = JSON.parse(fs.readFileSync(file, 'utf8'));
  diskData.revision = 42;
  diskData.records[key].progress = 80;
  diskData.records[key].revision = 42;
  fs.writeFileSync(file, JSON.stringify(diskData, null, 2) + '\n');

  // 原进程的 store.snapshot() 必须自适应感知识别最新 revision
  const refreshed = store.snapshot();
  assert.equal(refreshed.revision, 42);
  assert.equal(refreshed.records[key].progress, 80);
});
