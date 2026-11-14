'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { executeMigration, migrateAntigravityKeys } = require('../src/harnesses/antigravity/antigravity-migration.cjs');
const { requestProgressHttp } = require('../src/local-progress-http.cjs');
const { processHookInput } = require('../src/antigravity-hook.cjs');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('service startup migrates legacy records, bumps versions and does no work on a second start', async t => {
  const dir = temporary(t), stateFile = path.join(dir, 'state.json');
  const store = new ManualStatusStore(stateFile);
  const legacy = JSON.stringify(['local', 'local:old-session']);
  store.update({ key: legacy, expectedRevision: 0, record: { state: 'unfinished', progress: 60, note: '历史备注' } });
  const before = fs.readFileSync(stateFile, 'utf8');
  const service = new AntigravityService({ port: 0, stateFile, brainDir: dir });
  t.after(() => service.stop());
  await service.start();
  const result = service.getSessionSnapshot('old-session');
  assert.equal(result.progress.progress, 60);
  assert.equal(result.progress.note, '历史备注');
  assert.ok(result.recordRevision > JSON.parse(before).revision);
  assert.ok(!Object.hasOwn(service.store.data.records, legacy));
  const backups = fs.readdirSync(dir).filter(n => n.includes('.bak_migrate_'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), before);
  const after = fs.readFileSync(stateFile, 'utf8');
  assert.equal(executeMigration(stateFile).migrated, false);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), after);
  assert.equal(fs.readdirSync(dir).filter(n => n.includes('.bak_migrate_')).length, 1);
});

test('migration handles analysis-only keys and preserves an invalid ledger byte-for-byte', t => {
  const dir = temporary(t), file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, revision: 8, records: {}, analysis: {
    '["local","local:analysis-only"]': { ledger: { summary: '历史任务', tasks: [] } },
  } }));
  assert.equal(executeMigration(file).migrated, true);
  const data = JSON.parse(fs.readFileSync(file));
  assert.ok(data.analysis['["local","analysis-only"]']);
  const invalid = '{"version": 99, "revision":9,"records":{}}';
  fs.writeFileSync(file, invalid);
  assert.throws(() => executeMigration(file), /格式不受支持/);
  assert.equal(fs.readFileSync(file, 'utf8'), invalid);
});

test('records from before actionSequence existed retain the newer canonical value and ledger', () => {
  const old = '["local","local:old"]', canonical = '["local","old"]';
  const { data } = migrateAntigravityKeys({ records: {
    [old]: { state: 'unfinished', progress: 20, note: '旧备注', revision: 1, updatedAt: 10 },
    [canonical]: { state: 'completed', progress: 100, note: '新备注', revision: 4, updatedAt: 20 },
  }, analysis: {
    [old]: { ledger: { summary: '旧任务', tasks: [] } },
    [canonical]: { ledger: { summary: '新任务', tasks: [] } },
  }, timeline: [] });
  assert.equal(data.records[canonical].progress, 100);
  assert.equal(data.analysis[canonical].ledger.summary, '新任务');
});

test('MCP and hook cards preserve explicit zero and unknown progress with notes', async t => {
  const dir = temporary(t), stateFile = path.join(dir, '.gemini/antigravity/session-status/manual-state.json');
  t.mock.method(os, 'homedir', () => dir);
  const service = new AntigravityService({ port: 0, stateFile, brainDir: path.join(dir, 'brain') });
  t.after(() => service.stop());
  await service.start();
  for (const [id, state, progress] of [['zero', 'unstarted', 0], ['unknown', 'unfinished', null]]) {
    const key = service.canonicalKey(id);
    service.store.update({ key, expectedRevision: 0, record: { state, progress, note: '保留已有备注' } });
    const reply = await requestProgressHttp(stateFile, '/tools', { name: 'render_things_card', args: { conversation_id: id, artifact_dir: path.join(dir, id) } });
    const card = JSON.parse(reply.result.content[0].text);
    assert.equal(card.progress, progress);
    assert.ok(fs.readFileSync(card.artifact_path, 'utf8').includes('保留已有备注'));
    const hookDir = path.join(dir, 'hook', id);
    processHookInput(JSON.stringify({ lastUserInput: '/things', conversationId: id, artifactDirectoryPath: hookDir }));
    assert.ok(fs.readFileSync(path.join(hookDir, 'things-card.html'), 'utf8').includes('保留已有备注'));
  }
});

const source = fs.readFileSync(path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'), 'utf8');
function harness(t, verify, { fastTimeout = false } = {}) {
  const brain = '/test/brain', id = 'test-session';
  const win = {
    location: { href: `https://127.0.0.1/c/${id}?tab=${encodeURIComponent(`artifact__file://${brain}/${id}/things-card.html`)}` },
    crypto: require('node:crypto').webcrypto,
    __agentThingsConnection: { origin: 'http://127.0.0.1:1234', token: 'test', brainDir: brain },
    addEventListener() {}, removeEventListener() {},
  };
  const fetchImpl = (url, options) => url.endsWith('/snapshot') ? Promise.resolve({ ok: false }) : verify(url, options);
  const security = new Function('window', 'document', 'fetch', 'setTimeout', source + '\nreturn window.__antigravityHarnessSecurity;')(
    win, {}, fetchImpl, (fn, ms) => setTimeout(fn, fastTimeout && ms === 5000 ? 15 : ms));
  t.after(() => win.__antigravityHarnessDispose());
  const iframe = { contentWindow: {}, isConnected: true, closest: () => true, getAttribute: () => null, addEventListener() {} };
  const writes = [];
  return { security, iframe, writes, set: value => security.handleSrcdocSetter(iframe, value, function(html) { writes.push(html); }) };
}
const doc = '<!DOCTYPE html><html><head></head><body id="agentThingsCard">verified</body></html>';
const validResponse = { ok: true, json: async () => ({ valid: true, expectedDigest: 'a'.repeat(64) }) };

test('artifact verification yields to the event loop and only renders verified content', async t => {
  let release;
  const h = harness(t, () => new Promise(resolve => { release = resolve; }));
  h.iframe.contentWindow.location = { href: 'about:blank' };
  assert.equal(h.security.registerCardIframe(h.iframe, 'test-session', { loadToken: 'unverified' }), false);
  const pending = h.set(doc);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.writes, []);
  assert.equal(h.security.registeredCards.size, 0);
  release(validResponse);
  await pending;
  assert.equal(h.writes.length, 1);
  assert.ok(h.writes[0].includes('window.__agentThingsLoadToken'));
  assert.equal(h.security.registeredCards.size, 1);
});

test('replaced and detached frames cannot receive a late verified document', async t => {
  let release;
  const h = harness(t, () => new Promise(resolve => { release = resolve; }));
  const pending = h.set(doc);
  h.set('<html>new page</html>');
  release(validResponse);
  await pending;
  assert.deepEqual(h.writes, ['<html>new page</html>']);
  const pending2 = h.set(doc);
  h.iframe.isConnected = false;
  release(validResponse);
  await pending2;
  assert.equal(h.writes.length, 1);
});

test('failed or timed-out artifact verification never issues a load token', async t => {
  const h = harness(t, async () => ({ ok: true, json: async () => ({ valid: false }) }));
  await h.set(doc.replace('<head>', '<head><script>evil()</script>'));
  assert.equal(h.security.registeredCards.size, 0);
  assert.ok(!h.writes[0].includes('__agentThingsLoadToken'));
  const timeout = harness(t, (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }), { fastTimeout: true });
  await timeout.set(doc);
  assert.equal(timeout.security.registeredCards.size, 0);
  assert.deepEqual(timeout.writes, [doc]);
});
