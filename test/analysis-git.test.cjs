'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspectGit, readProjectGit } = require('../src/analysis-git.cjs');
const { mergeAnalysis } = require('../src/analysis-ledger.cjs');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');

test('Git eligibility detects local folders, repositories, remote addition/removal, and worktrees', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'status-git-test-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.equal((await inspectGit(cwd)).hasRemote, false);
  const git = args => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
  git(['init']); assert.equal((await inspectGit(cwd)).hasRepository, true);
  assert.equal((await inspectGit(cwd)).hasRemote, false);
  git(['remote', 'add', 'origin', 'https://example.invalid/repo.git']);
  assert.equal((await inspectGit(cwd)).hasRemote, true);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'test']);
  const worktree = path.join(cwd, 'linked worktree'); git(['worktree', 'add', '--detach', worktree]);
  assert.equal((await inspectGit(worktree)).hasRemote, true);
  git(['remote', 'remove', 'origin']);
  assert.equal((await inspectGit(worktree)).hasRemote, false);
  assert.equal((await readProjectGit(async () => { throw new Error('unavailable'); }, 'thread')).status, 'unknown');
});

test('push evidence survives increments, validates source references, and can be superseded', () => {
  const output = { summary: '完成并推送', tasks: [{ knownTaskId: null, title: '交付', status: 'done', evidenceRefs: ['a1'] }],
    removedTaskIds: [], gitPush: { status: 'pushed', evidenceRefs: ['a1'] } };
  const ledger = mergeAnalysis(null, output, ['a1']);
  assert.equal(ledger.gitPush.status, 'pushed');
  const changed = mergeAnalysis(ledger, { summary: '新增改动', tasks: [], removedTaskIds: [],
    gitPush: { status: 'not_pushed', evidenceRefs: ['a2'] } }, ['a1', 'a2']);
  assert.equal(changed.gitPush.status, 'not_pushed');
  assert.throws(() => mergeAnalysis(null, { ...output, gitPush: { status: 'pushed', evidenceRefs: [] } }, ['a1']), /证据/);
  assert.throws(() => mergeAnalysis(null, { ...output, gitPush: { status: 'pushed', evidenceRefs: ['invented'] } }, ['a1']), /证据/);
});

test('automatic purple requires all tasks done, push evidence, and a configured remote; manual changes retain priority', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-color-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(dir, 'state.json'));
  const key = JSON.stringify(['local', 'local:thread']);
  const ledger = { summary: '已完成并推送', tasks: [{ id: 'task', title: '交付', status: 'done', evidenceRefs: ['a1'] }],
    gitPush: { status: 'pushed', evidenceRefs: ['a1'] } };
  for (const [hasRemote, push, state] of [[true, 'pushed', 'pushed'], [false, 'pushed', 'completed'], [true, 'unknown', 'completed'], [true, 'not_pushed', 'completed']]) {
    const sequence = store.beginAnalysis(key, null);
    store.finishAnalysis(key, sequence, { ledger: { ...ledger, gitPush: { status: push, evidenceRefs: ['a1'] } }, projectGit: { hasRemote } });
    assert.equal(store.snapshot().records[key].state, state);
  }
  const sequence = store.beginAnalysis(key, null);
  store.update({ key, expectedRevision: store.snapshot().records[key].revision, record: { state: 'unfinished', progress: 40, note: '还有任务' } });
  store.finishAnalysis(key, sequence, { ledger, projectGit: { hasRemote: true } });
  assert.equal(store.snapshot().records[key].progress, 40);
});
