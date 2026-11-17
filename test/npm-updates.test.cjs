'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { CHECK_INTERVAL_MS, newerVersion, checkForUpdate, downloadRelease } = require('../src/npm-updates.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-update-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function archive(t, { version = '1.1.0', link = false } = {}) {
  const directory = temporary(t), root = path.join(directory, 'package');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'agent-things', version }));
  fs.writeFileSync(path.join(root, 'bin/codex-session-status.cjs'), 'console.log("help");');
  if (link) fs.symlinkSync('/tmp', path.join(root, 'escape'));
  const file = path.join(directory, 'fixture.tgz');
  execFileSync('/usr/bin/tar', ['-czf', file, '-C', directory, 'package']);
  const bytes = fs.readFileSync(file);
  const release = { name: 'agent-things', version: '1.1.0', dist: { tarball: 'https://registry.npmjs.org/agent-things/-/agent-things-1.1.0.tgz',
    integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` } };
  return { bytes, release };
}

test('stable versions compare numerically and never downgrade', () => {
  assert.equal(newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(newerVersion('1.0.0', '2.0.0'), false);
  assert.equal(newerVersion('1.0.0+build.2', '1.0.0'), false);
  for (const invalid of ['1.01.0', '1.2', '1.2.3-beta.1', 'latest', null]) assert.throws(() => newerVersion(invalid, '1.0.0'));
});

test('version check uses only npm and reports current, available, unpublished and network failures', async () => {
  for (const [version, available] of [['1.1.0', true], ['1.0.0', false], ['0.9.0', false]]) {
    const result = await checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/agent-things/latest');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ name: 'agent-things', version }) };
    } });
    assert.equal(result.available, available);
    assert.equal(result.command, 'npx agent-things@latest');
  }
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => ({ status: 404 }) }), /尚未发布/);
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => ({ status: 503 }) }), /503/);
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => { throw Error('offline'); } }), /offline/);
  await assert.rejects(checkForUpdate({ currentVersion: '1.0.0', fetchImpl: async () => ({ ok: true, json: async () => ({ name: 'other', version: '2.0.0' }) }) }), /名称不匹配/);
});

test('download verifies npm integrity and package identity before executable preflight', async t => {
  const { release, bytes } = archive(t);
  const directory = temporary(t);
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => bytes });
  const root = await downloadRelease(release, directory, { fetchImpl });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '1.1.0');
  await assert.rejects(downloadRelease({ ...release, dist: { ...release.dist, tarball: 'https://example.com/package.tgz' } }, directory, { fetchImpl }), /官方仓库/);
  await assert.rejects(downloadRelease(release, directory, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('corrupt') }) }), /完整性/);
  const mismatch = archive(t, { version: '1.2.0' });
  await assert.rejects(downloadRelease(mismatch.release, temporary(t), { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => mismatch.bytes }) }), /版本与 npm/);
  const linked = archive(t, { link: true });
  await assert.rejects(downloadRelease(linked.release, temporary(t), { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => linked.bytes }) }), /链接或特殊文件/);
});

function worker(t, fixture, { fail = false, pending = false, installed = true, enabledApps = ['antigravity'] } = {}) {
  const home = temporary(t), data = path.join(home, 'Library/Application Support/CodexSessionStatus');
  fs.mkdirSync(path.join(data, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(data, 'runtime/package.json'), JSON.stringify({ name: 'agent-things', version: '1.0.0' }));
  const ledger = path.join(data, 'manual-state.json');
  const original = JSON.stringify({ records: { example: { progress: 50, note: 'keep me' } }, timeline: pending ? [{ status: 'pending' }] : [] });
  fs.writeFileSync(ledger, original);
  const calls = [], states = [], jobs = new Map();
  const fakeProcess = { pid: process.pid, platform: 'darwin', execPath: process.execPath, kill: process.kill, argv: [], exitCode: 0 };
  const launchd = {
    UPDATE_LABEL: 'com.codexsessionstatus.update',
    printJob: label => jobs.get(label) || null,
    bootout: async label => { calls.push(['bootout', label]); jobs.delete(label); },
    writePlist: (value, file) => { calls.push(['plist', value]); assert.ok(file.startsWith(data)); assert.ok(!file.includes('LaunchAgents')); },
    bootstrap: () => { jobs.set('com.codexsessionstatus.update', `pid = ${process.pid}`); },
  };
  const mocks = {
    'node:os': { homedir: () => home }, './launchd.cjs': launchd,
    './lifecycle-lock.cjs': require('../src/lifecycle-lock.cjs'),
    './cli/setup-orchestrator.cjs': { readConfig: () => installed ? { installed: true, lang: 'en' , enabledApps } : { installed: false } },
    './resolve.cjs': { resolveNode: () => process.execPath },
    './local-progress-http.cjs': { requestProgressHttp: async () => ({}) },
  };
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/npm-updates.cjs'), 'utf8');
  const network = { checks: 0, offline: false };
  const fetchImpl = async url => {
    if (url.endsWith('/latest')) {
      network.checks++;
      if (network.offline) throw Error('offline');
      return { ok: true, json: async () => fixture.release };
    }
    return { ok: true, arrayBuffer: async () => fixture.bytes };
  };
  const load = id => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id === './i18n.cjs') return require('../src/i18n.cjs');
    if (id.startsWith(data) && id.endsWith('/src/cli/setup-orchestrator.cjs')) return { executeSetup: async options => {
      calls.push(['setup', options]);
      if (fail) throw Error('simulated setup rollback');
      for (const app of options.enabledApps) jobs.set({ codex: 'com.codexsessionstatus.agent', antigravity: 'com.antigravity.session-status', claude: 'com.agentthings.claude' }[app], `pid = ${process.pid}`);
      fs.writeFileSync(path.join(data, 'runtime/package.json'), JSON.stringify({ name: 'agent-things', version: '1.1.0' }));
      await options.verify({ enabledApps: options.enabledApps, runtime: path.join(data, 'runtime') });
    } };
    return require(id);
  };
  vm.runInThisContext('(function(require,module,exports,__dirname,__filename,process,fetch,setTimeout){' + source + '\n})')(
    load, mod, mod.exports, path.resolve(__dirname, '../src'), path.resolve(__dirname, '../src/npm-updates.cjs'), fakeProcess, fetchImpl,
    callback => { const status = JSON.parse(fs.readFileSync(path.join(data, 'npm-update.json'))); states.push(status.stage);
      if (pending) { assert.throws(() => mod.exports.assertUpdateIdle(), /正在升级/); fs.writeFileSync(ledger, original.replace('"pending"', '"completed"')); }
      return setTimeout(callback, 1); });
  return { api: mod.exports, data, ledger, original, calls, states, fakeProcess, jobs, network, launchd };
}

test('independent worker waits for analysis, preserves selections and records, and persists success', async t => {
  const fixture = worker(t, archive(t), { pending: true });
  await fixture.api.runUpdate();
  assert.deepEqual(fixture.states, ['waiting']);
  const setup = fixture.calls.find(call => call[0] === 'setup')[1];
  assert.equal(setup.lang, 'en');
  assert.deepEqual(setup.enabledApps, ['antigravity']);
  assert.equal(setup.autoRestartCodex, false);
  assert.equal(fixture.api.readUpdateStatus().stage, 'completed');
  assert.equal(fixture.api.readUpdateStatus().currentVersion, '1.1.0');
  assert.equal(JSON.parse(fs.readFileSync(fixture.ledger)).records.example.note, 'keep me');
  assert.equal(fs.readdirSync(fixture.data).filter(name => name.startsWith('npm-update-')).length, 0);
});

test('failure is durable, does not touch ledgers, and clears the analysis gate', async t => {
  const fixture = worker(t, archive(t), { fail: true });
  await fixture.api.runUpdate();
  assert.equal(fixture.fakeProcess.exitCode, 1);
  assert.equal(fixture.api.readUpdateStatus().stage, 'failed');
  assert.match(fixture.api.readUpdateStatus().error, /simulated setup rollback/);
  assert.equal(fs.readFileSync(fixture.ledger, 'utf8'), fixture.original);
  assert.doesNotThrow(() => fixture.api.assertUpdateIdle());
});

test('uninstall during downloading cancels upgrade and never reinstalls components', async t => {
  const fixture = worker(t, archive(t), { installed: false });
  await fixture.api.runUpdate();
  assert.match(fixture.api.readUpdateStatus().error, /已卸载/);
  assert.equal(fixture.calls.length, 0);
});

test('already-current releases finish without downloading or restarting services', async t => {
  const release = archive(t);
  release.release.version = '1.0.0';
  const fixture = worker(t, release);
  await fixture.api.runUpdate();
  assert.equal(fixture.api.readUpdateStatus().stage, 'current');
  assert.equal(fixture.calls.length, 0);
  assert.equal(fs.readFileSync(fixture.ledger, 'utf8'), fixture.original);
});

test('interrupted workers release the analysis gate and live foreign workers block setup', t => {
  const fixture = worker(t, archive(t));
  const status = path.join(fixture.data, 'npm-update.json');
  fs.writeFileSync(status, JSON.stringify({ stage: 'installing', pid: 12345 }));
  fixture.fakeProcess.kill = () => { throw Object.assign(Error('no process'), { code: 'ESRCH' }); };
  assert.equal(fixture.api.readUpdateStatus().stage, 'failed');
  assert.doesNotThrow(() => fixture.api.assertUpdateIdle());
  fixture.fakeProcess.kill = () => {};
  assert.throws(() => fixture.api.assertSetupIdle(), /修改安装配置/);
  assert.throws(() => fixture.api.assertUpdateIdle(), /再分析/);
  fs.writeFileSync(status, JSON.stringify({ stage: 'installing', pid: process.pid }));
  assert.doesNotThrow(() => fixture.api.assertSetupIdle());
});

test('launchd update job is independent of host services and duplicate starts are rejected', async t => {
  const fixture = worker(t, archive(t));
  await fixture.api.startUpdate();
  const plist = fixture.calls.find(call => call[0] === 'plist')[1];
  assert.equal(plist.Label, 'com.codexsessionstatus.update');
  assert.equal(plist.ProgramArguments.at(-2), '--worker');
  assert.equal(fixture.api.readUpdateStatus().stage, 'queued');
  assert.equal(plist.ProgramArguments.at(-1), fixture.api.readUpdateStatus().id);
  assert.equal(plist.KeepAlive, undefined);
  await assert.rejects(fixture.api.startUpdate(), /正在进行/);
});

test('automatic checks persist an hourly cache and concurrent checks share one request', async t => {
  assert.equal(CHECK_INTERVAL_MS, 3600000);
  const fixture = worker(t, archive(t));
  const [a, b] = await Promise.all([fixture.api.getUpdateInfo(), fixture.api.getUpdateInfo()]);
  assert.equal(a.latestVersion, '1.1.0');
  assert.equal(b.available, true);
  assert.equal(a.release, undefined);
  assert.equal(fixture.network.checks, 1);
  await fixture.api.getUpdateInfo();
  assert.equal(fixture.network.checks, 1);
  const cache = path.join(fixture.data, 'npm-version-check.json');
  const data = JSON.parse(fs.readFileSync(cache));
  // 30 minutes ago still hits hourly cache
  data.attemptedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  fs.writeFileSync(cache, JSON.stringify(data));
  await fixture.api.getUpdateInfo();
  assert.equal(fixture.network.checks, 1);
  await fixture.api.getUpdateInfo({ force: true });
  assert.equal(fixture.network.checks, 2);
  // 61 minutes ago expires hourly cache automatically
  const expired = JSON.parse(fs.readFileSync(cache));
  expired.attemptedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  fs.writeFileSync(cache, JSON.stringify(expired));
  await fixture.api.getUpdateInfo();
  assert.equal(fixture.network.checks, 3);
});

test('offline checks preserve known updates and throttle retries until explicit check', async t => {
  const fixture = worker(t, archive(t));
  await fixture.api.getUpdateInfo();
  fixture.network.offline = true;
  const info = await fixture.api.getUpdateInfo({ force: true });
  assert.equal(info.available, true);
  assert.equal(info.checkError, 'offline');
  await fixture.api.getUpdateInfo();
  assert.equal(fixture.network.checks, 2);
});

test('pending update status is immediately readable and a missing worker times out', async t => {
  const fixture = worker(t, archive(t));
  await fixture.api.startUpdate();
  const info = await fixture.api.getUpdateInfo();
  assert.equal(info.update.stage, 'queued');
  assert.equal(fixture.network.checks, 0);
  const status = path.join(fixture.data, 'npm-update.json');
  const queued = JSON.parse(fs.readFileSync(status));
  queued.startedAt = '2020-01-01T00:00:00.000Z';
  fs.writeFileSync(status, JSON.stringify(queued));
  fixture.jobs.clear();
  assert.equal(fixture.api.readUpdateStatus().stage, 'failed');
});

test('launching failure persists the actual reason and allows retry', async t => {
  const fixture = worker(t, archive(t));
  fixture.launchd.bootstrap = () => { throw Error('bootstrap rejected'); };
  await assert.rejects(fixture.api.startUpdate(), /bootstrap rejected/);
  assert.equal(fixture.api.readUpdateStatus().stage, 'failed');
  assert.equal(fixture.api.readUpdateStatus().error, 'bootstrap rejected');
  assert.doesNotThrow(() => fixture.api.assertSetupIdle());
});
