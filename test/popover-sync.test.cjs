'use strict';
// 左侧弹窗补读：按单会话数据版本触发；忙碌时记下待刷新，空闲后补读一次。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/session-status.js'), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const code = [slice('  async function save(', '  function closePanel('), slice('  function receive(', '  function onOutside(')].join('\n');

function fixture() {
  const key = '["local","a"]';
  const target = { entry: { key }, busy: false, dirty: false, revision: 0, controls: [], draft: { state: 'unfinished', progress: 10, note: '' },
    progress: { value: '10' }, note: { value: '' }, error: { textContent: '' }, resolveConflict: { hidden: true }, analyze: {}, polls: 0 };
  target.pollHistory = () => { target.polls += 1; };
  let release;
  target.request = () => new Promise(resolve => { release = resolve; });
  const context = { panel: target, embedded: null, snapshot: { revision: 0, records: {} }, mounted: new Map(),
    paint() {}, refreshPanel() {}, rememberPanel() {}, panelVersion: null };
  vm.createContext(context);
  vm.runInContext(code, context);
  const snap = (revision, versions, records = {}) => ({ revision, records, keyVersionBase: 1, keyVersions: versions });
  return { key, target, context, snap, receive: next => context.receive(next), release: value => release(value) };
}

test('only-task-source change (record unchanged) re-reads the open popover', () => {
  const f = fixture();
  const record = { [f.key]: { revision: 5, progress: 10 } };
  f.receive(f.snap(5, { [f.key]: 5 }, record));
  assert.equal(f.target.polls, 0, 'first snapshot only sets the baseline');
  f.receive(f.snap(6, { [f.key]: 6 }, record));
  assert.equal(f.target.polls, 1, 'per-session version bump triggers a re-read');
  f.receive(f.snap(7, { [f.key]: 6, other: 7 }, record));
  assert.equal(f.target.polls, 1, 'another session changing does not re-read');
});

test('update arriving while busy is re-read once after the save finishes', async () => {
  const f = fixture();
  f.receive(f.snap(5, { [f.key]: 5 }));
  const saving = f.context.save();
  assert.equal(f.target.busy, true);
  f.receive(f.snap(6, { [f.key]: 6 }));
  assert.equal(f.target.polls, 0, 'no re-read while busy');
  f.target.request = async () => { throw new Error('此会话已在其他窗口更新，请重新确认'); };
  f.release(Promise.reject(new Error('此会话已在其他窗口更新，请重新确认')));
  assert.equal(await saving, false);
  assert.equal(f.target.busy, false);
  assert.equal(f.target.polls, 1, 'pending version is re-read once when idle');
  f.receive(f.snap(6, { [f.key]: 6 }));
  assert.equal(f.target.polls, 1, 'no duplicate re-read for the same version');
});

test('falls back to record signature when the snapshot has no per-session versions', () => {
  const f = fixture();
  f.receive({ revision: 1, records: { [f.key]: { revision: 1, progress: 10 } } });
  f.receive({ revision: 2, records: { [f.key]: { revision: 2, progress: 20 } } });
  assert.equal(f.target.polls, 1);
});

test('save success with an update arriving mid-save re-reads exactly once', async () => {
  const f = fixture();
  f.receive(f.snap(5, { [f.key]: 5 }));
  const saving = f.context.save();
  f.receive(f.snap(6, { [f.key]: 6 }));
  assert.equal(f.target.polls, 0);
  f.release(null);
  assert.equal(await saving, true);
  assert.equal(f.target.polls, 1, 'success path and pending refresh are merged');
  f.receive(f.snap(6, { [f.key]: 6 }));
  assert.equal(f.target.polls, 1);
});

test('opening the popover takes the current snapshot as baseline before the first history read', () => {
  const open = source.slice(source.indexOf('  function openPanel('), source.indexOf('  function receive('));
  const baseline = open.indexOf('target.syncVersion = panelVersion(entry.key)');
  const firstRead = open.indexOf('if (embedded?.analysisState) showHistory(embedded.analysisState); else pollHistory();');
  assert.ok(baseline > 0 && baseline < firstRead, 'baseline set before the first history read');
  const f = fixture();
  f.context.snapshot = f.snap(5, { [f.key]: 5 });
  f.target.syncVersion = f.context.panelVersion(f.key); // 打开时的基线
  f.receive(f.snap(6, { [f.key]: 6 })); // 首次读取期间到达的新版快照
  assert.equal(f.target.polls, 1, 'newer snapshot after open triggers a re-read');
});

test('a dirty draft only changes its base revision after explicit re-read', async () => {
  const f = fixture();
  f.target.dirty = true;
  f.target.progress.value = '80';
  f.receive(f.snap(7, { [f.key]: 7 }, { [f.key]: { revision: 7, progress: 70 } }));
  const attempts = [];
  f.target.request = async (type, _timeout, fields) => {
    if (type === 'analysis-state') return;
    attempts.push(fields.expectedRevision);
    if (fields.expectedRevision !== 7) throw new Error('此会话已在其他窗口更新，请重新确认');
  };
  assert.equal(await f.context.save(), false);
  assert.equal(f.target.resolveConflict.hidden, false);
  assert.equal(await f.context.save(), false);
  assert.deepEqual(attempts, [0, 0]);
  await f.context.rebaseDraft(f.target);
  assert.equal(f.target.progress.value, '80');
  assert.equal(f.target.resolveConflict.hidden, true);
  assert.equal(await f.context.save(), true);
  assert.deepEqual(attempts, [0, 0, 7]);
});
