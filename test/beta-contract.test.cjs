'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { createCodexProgressContext } = require('../src/harnesses/codex/codex-progress-context.cjs');
const { sessionView } = require('../src/session-view.cjs');
const { inspectGit } = require('../src/analysis-git.cjs');
const { requestBudget } = require('../src/request-budget.cjs');
const { errorDetails, progressError } = require('../src/progress-error.cjs');
const { withLifecycleLock } = require('../src/lifecycle-lock.cjs');
const { createCardEvents } = require('../src/harnesses/codex/codex-card-events.cjs');
const { startProgressHttp, requestProgressHttp } = require('../src/local-progress-http.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'things-contract-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(dir, 'state.json')), key = store.resolveKey('thread');
  store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 30, note: '保留记录' }, projectPath: dir });
  return { dir, store, key };
}
test('only host-confirmed project identity enables the fast path; overlapping Git checks coalesce and later checks refresh', async t => {
  const { dir, store, key } = fixture(t);
  let spawned = 0, probes = 0;
  const context = createCodexProgressContext({ store, makeServer: () => {
    spawned++; return { initialize: async () => {}, close: async () => {}, request: async () => ({ thread: { cwd: dir } }) };
  }, probe: async () => { probes++; await new Promise(r => setTimeout(r, 5)); return { status: 'checked', hasRepository: true, hasRemote: probes > 1 }; } });
  await context.projectGit(key);
  assert.equal(spawned, 1, 'an unverified user-supplied path needs host confirmation');
  assert.equal(store.snapshot().records[key].projectSource, 'host');
  await Promise.all([context.projectGit(key), context.projectGit(key)]);
  assert.equal(spawned, 1); assert.equal(probes, 2);
  const newest = await context.projectGit(key);
  assert.equal(probes, 3); assert.equal(newest.hasRemote, true);
  store.update({ key, expectedRevision: store.getProgress(key).revision, record: { state: 'unfinished', progress: 40, note: '' }, projectPath: '/unverified/other' });
  assert.equal(store.getProgress(key).projectPath, fs.realpathSync(dir));
});
test('Git commands share a total deadline and release a cancelled operation', async () => {
  const calls = [];
  const value = await inspectGit('/unused', { timeoutMs: 35, executeFile: async (_bin, args, options) => {
    calls.push(options.timeout);
    if (calls.length === 1) { await new Promise(r => setTimeout(r, 20)); return { stdout: '' }; }
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  assert.equal(value.status, 'unknown'); assert.equal(calls.length, 2); assert.ok(calls[1] < calls[0]);
});
test('session projection is scoped, changes with analysis stages, and preserves clear revision', t => {
  const { store, key } = fixture(t);
  store.update({ key: store.resolveKey('private'), expectedRevision: 0, record: { state: 'completed', progress: 100, note: 'PRIVATE_OTHER_SESSION' } });
  const first = sessionView(store, key), sequence = store.beginAnalysis(key, null);
  const pending = sessionView(store, key);
  assert.notEqual(first.sessionVersion, pending.sessionVersion);
  assert.equal(first.recordRevision, pending.recordRevision);
  assert.equal(pending.analysis.status, 'pending');
  store.updateAnalysis(key, sequence, { stage: 'reading' });
  assert.notEqual(sessionView(store, key).sessionVersion, pending.sessionVersion);
  assert.ok(!JSON.stringify(pending).includes('PRIVATE_OTHER_SESSION'));
  store.update({ key, expectedRevision: pending.recordRevision, record: null });
  const cleared = sessionView(store, key);
  assert.equal(cleared.record, null); assert.deepEqual(cleared.tasks, []);
  assert.ok(cleared.recordRevision > pending.recordRevision);
  store.finishAnalysis(key, sequence, { error: 'late' });
  assert.deepEqual(sessionView(store, key), cleared);
});
test('conflicts use stable codes and public unclassified errors discard arbitrary text', t => {
  const { store, key } = fixture(t);
  assert.throws(() => store.update({ key, expectedRevision: 0, record: null }), { code: 'REVISION_CONFLICT' });
  assert.equal(errorDetails(progressError('REVISION_CONFLICT', '不同语言提示')).code, 'REVISION_CONFLICT');
  assert.ok(!JSON.stringify(errorDetails(new Error('token=PRIVATE_SECRET'))).includes('PRIVATE_SECRET'));
});
test('request budget propagates cancellation and cancelled event waiters are removed', async t => {
  const { store, key } = fixture(t), controller = new AbortController();
  const budget = requestBudget({ signal: controller.signal });
  const waiting = budget.run(() => new Promise(() => {}));
  controller.abort(progressError('REQUEST_CANCELLED'));
  await assert.rejects(waiting, { code: 'REQUEST_CANCELLED' }); budget.dispose();
  const events = createCardEvents({ store, read: k => ({ snapshot: { records: { [k]: store.snapshot().records[k] } }, analysisState: store.analysisState(k) }) });
  t.after(() => events.close());
  const first = await events.wait(key), cancel = new AbortController();
  const next = events.wait(key, first.cursor, cancel.signal); cancel.abort();
  await assert.rejects(next, { code: 'REQUEST_CANCELLED' });
});
test('install operations hold an exclusive lock until asynchronous work finishes, including rejection', async t => {
  const { dir } = fixture(t);
  let release;
  const held = withLifecycleLock(dir, () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(withLifecycleLock(dir, async () => {}), /正在执行/);
  release(); await held;
  await assert.rejects(withLifecycleLock(dir, async () => { throw new Error('fixture'); }), /fixture/);
  await withLifecycleLock(dir, async () => {});
  assert.equal(fs.existsSync(path.join(dir, 'installation.lock')), false);
});
test('HTTP disconnect cancels a read and a conflict retains its code through the client', async t => {
  const { store } = fixture(t);
  let ready, cancelled;
  const started = new Promise(r => { ready = r; }), stopped = new Promise(r => { cancelled = r; });
  const service = await startProgressHttp({ port: 0, stateFile: store.file, handle: async (_method, route, _body, { signal }) => {
    if (route === '/conflict') throw progressError('REVISION_CONFLICT', 'Localized conflict');
    ready(); return new Promise(resolve => signal.addEventListener('abort', () => { cancelled(); resolve({}); }, { once: true }));
  } });
  t.after(() => service.close());
  await assert.rejects(requestProgressHttp(store.file, '/conflict', {}), { code: 'REVISION_CONFLICT' });
  const controller = new AbortController();
  const call = requestProgressHttp(store.file, '/read', {}, undefined, { signal: controller.signal });
  await started; controller.abort(); await assert.rejects(call); await stopped;
});

test('runtime installation filters working copies and a failed preflight preserves the installed tree', async t => {
  const { dir } = fixture(t), source = path.join(dir, 'source'), runtime = path.join(dir, 'runtime');
  for (const name of ['src', 'bin', 'skills', 'native', 'mods', 'scripts']) fs.mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['LICENSE', 'NOTICE', 'package.json']) fs.writeFileSync(path.join(source, name), name === 'package.json' ? '{}' : 'fixture');
  for (const name of ['setup-antigravity-service.cjs', 'setup-claude-service.cjs', 'build-codex-bundle.cjs', 'build-antigravity-bundle.cjs', 'build-shared-ui.cjs']) fs.writeFileSync(path.join(source, 'scripts', name), '');
  fs.writeFileSync(path.join(source, 'bin/codex-session-status.cjs'), 'console.log("help");');
  fs.writeFileSync(path.join(source, 'src/keep.cjs'), 'module.exports = 1;');
  for (const name of ['x.cjs.bak', 'x.cjs.bak_20261112', 'private.log']) fs.writeFileSync(path.join(source, 'src', name), 'PRIVATE');
  const { installRuntime, commitInstallation } = require('../src/runtime-install.cjs');
  installRuntime(source, runtime);
  commitInstallation(path.dirname(runtime), [runtime]);
  assert.deepEqual(fs.readdirSync(path.join(runtime, 'src')), ['keep.cjs']);
  fs.writeFileSync(path.join(source, 'bin/codex-session-status.cjs'), 'process.exit(1);');
  assert.throws(() => installRuntime(source, runtime));
  assert.equal(fs.readFileSync(path.join(runtime, 'src/keep.cjs'), 'utf8'), 'module.exports = 1;');
  assert.equal(fs.existsSync(`${runtime}.stage.${process.pid}`), false);
});

test('two callers can share a Git read while one cancels independently', async t => {
  const { store, key, dir } = fixture(t); store.enrichProjects({ [key]: dir });
  let finish, probes = 0;
  const context = createCodexProgressContext({ store, makeServer: () => assert.fail('trusted project needs no server'), probe: () => { probes++; return new Promise(resolve => { finish = resolve; }); } });
  const controller = new AbortController();
  const a = context.projectGit(key, { signal: controller.signal }), b = context.projectGit(key);
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(progressError('REQUEST_CANCELLED'));
  await assert.rejects(a, { code: 'REQUEST_CANCELLED' });
  finish({ status: 'checked', hasRepository: true, hasRemote: true });
  assert.equal((await b).hasRemote, true); assert.equal(probes, 1);
});

test('simultaneous backend starters elect exactly one owner and recover a dead owner atomically', async t => {
  const { dir } = fixture(t), lock = path.join(dir, 'agent.lock');
  const { spawn } = require('node:child_process');
  const { once } = require('node:events');
  const file = path.resolve(__dirname, '../src/state-file-lock.cjs');
  const start = () => {
    const child = spawn(process.execPath, ['-e', 'const {tryAcquirePidLock}=require(process.argv[1]);console.log(tryAcquirePidLock(process.argv[2]));setInterval(()=>{},1000);', file, lock], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    return { child, result: new Promise(resolve => child.stdout.once('data', chunk => resolve(chunk.toString().trim() === 'true'))) };
  };
  const a = start(), b = start();
  const results = await Promise.all([a.result, b.result]);
  assert.equal(results.filter(Boolean).length, 1);
  const owner = results[0] ? a.child : b.child;
  const exited = once(owner, 'exit'); owner.kill('SIGTERM'); await exited;
  assert.equal(require('../src/state-file-lock.cjs').tryAcquirePidLock(lock), true);
  fs.unlinkSync(lock);
});
