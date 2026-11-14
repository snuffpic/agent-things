'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { CodexService } = require('../src/harnesses/codex/codex-service.cjs');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');

test('both hosts expose identical update replies without changing session records', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-rpc-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const info = { currentVersion: '1.0.0', latestVersion: '1.1.0', available: true };
  for (const host of ['codex', 'antigravity']) {
    const calls = [];
    const updates = { getUpdateInfo: async options => { calls.push(options || {}); return info; }, startUpdate: async () => { calls.push('start'); } };
    const stateFile = path.join(directory, host + '.json');
    const service = host === 'codex' ? new CodexService({ store: new ManualStatusStore(stateFile), updates }) : new AntigravityService({ port: 0, stateFile, updates });
    t.after(() => service.stop());
    let reply;
    service.evaluate = async (_, expression) => { reply = JSON.parse(expression.slice('window.__codexSessionStatus.reply('.length, -1)); };
    service.broadcast = async () => { throw Error('Update polling must not broadcast task snapshots'); };
    const dispatch = async message => host === 'codex' ? (await service.handleMessage({}, JSON.stringify(message)), reply) : service.handleRpc(message);
    const original = JSON.stringify(service.store.snapshot());
    const checked = await dispatch({ type: 'app-update-info', requestId: 'check', force: true });
    assert.deepEqual(checked.updateInfo, info);
    assert.equal(checked.error, null);
    assert.deepEqual(calls, [{ force: true }]);
    const started = await dispatch({ type: 'app-update-start', requestId: 'start' });
    assert.deepEqual(started.updateInfo, info);
    assert.deepEqual(calls, [{ force: true }, 'start', {}]);
    updates.startUpdate = async () => { throw require('../src/progress-error.cjs').progressError('SERVICE_STOPPING', 'already running'); };
    const failed = await dispatch({ type: 'app-update-start', requestId: 'failure' });
    assert.match(failed.error, /already running/);
    assert.equal(JSON.stringify(service.store.snapshot()), original);
  }
});

test('Antigravity update execution requires an authenticated local request', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-http-'));
  let starts = 0;
  const updates = { startUpdate: async () => { starts++; }, getUpdateInfo: async () => ({ available: true, update: { stage: 'queued' } }) };
  const service = new AntigravityService({ port: 0, stateFile: path.join(directory, 'state.json'), updates });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const port = await service.start();
  const request = token => fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ type: 'app-update-start', requestId: 'upgrade' }) });
  assert.equal((await request()).status, 401);
  assert.equal(starts, 0);
  assert.equal((await request(service.http.credentials.token)).status, 200);
  assert.equal(starts, 1);
});
