'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { verifyBridgeBundle } = require('../src/native-bridge.cjs');
const { prepareStartup } = require('../src/runtime-install.cjs');
const root = path.resolve(__dirname, '..');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-bridge-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('distributed bridge contains both architectures and valid code signatures', () => {
  const binary = verifyBridgeBundle(root);
  execFileSync('/usr/bin/lipo', [binary, '-verify_arch', 'arm64', 'x86_64'], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', binary], { stdio: 'pipe' });
});

for (const architecture of ['arm64', 'x86_64']) {
  test(`bridge ${architecture} slice runs its protocol and read-only AppKit snapshot`, t => {
    if (process.arch === 'x64' && architecture === 'arm64') return t.skip('ARM64 execution requires Apple Silicon');
    if (process.arch === 'arm64' && architecture === 'x86_64' && spawnSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']).status !== 0) return t.skip('Rosetta is not available');
    const binary = verifyBridgeBundle(root);
    const options = { encoding: 'utf8', timeout: 10000, env: { ...process.env, DEVELOPER_DIR: '/agent-things-no-developer-tools' } };
    const version = JSON.parse(execFileSync('/usr/bin/arch', [`-${architecture}`, binary, 'version'], options));
    assert.equal(version.protocol, 1);
    const snapshot = JSON.parse(execFileSync('/usr/bin/arch', [`-${architecture}`, binary, 'snapshot', '/Applications/ChatGPT.app'], options));
    assert.ok(Array.isArray(snapshot.apps));
    assert.equal(typeof snapshot.inputIdleMs, 'number');
    assert.equal(typeof snapshot.inputStamp, 'number');
    assert.ok(version.capabilities.includes('window-ready'));
    for (const app of snapshot.apps) assert.ok(Number.isInteger(app.windows) && app.windows >= 0);
    // A quit aimed at a process that is not running never reaches terminate().
    const quit = JSON.parse(execFileSync('/usr/bin/arch', [`-${architecture}`, binary, 'quit', '/Applications/ChatGPT.app', '999999', '999999:0', String(snapshot.inputStamp)], options));
    assert.equal(quit.accepted, false);
    assert.ok(['process-changed', 'input-changed'].includes(quit.reason));
  });
}

test('installation copies the executable and preserves existing startup preferences', t => {
  const directory = temporary(t);
  const settings = path.join(directory, 'autostart.json');
  const original = JSON.stringify({ app: '/Applications/ChatGPT.app', allowClientRestart: false });
  fs.writeFileSync(settings, original);
  prepareStartup(root, directory);
  assert.ok(fs.readFileSync(path.join(directory, 'bridge')).equals(fs.readFileSync(verifyBridgeBundle(root))));
  assert.equal(fs.statSync(path.join(directory, 'bridge')).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(settings, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(directory, 'bridge.building')), false);
});

test('missing, stale or corrupted artifacts fail before replacing an installed bridge', t => {
  const source = temporary(t), directory = temporary(t);
  const installed = path.join(directory, 'bridge');
  fs.writeFileSync(installed, 'old bridge');
  assert.throws(() => prepareStartup(source, directory), /缺少预编译/);
  fs.cpSync(path.join(root, 'native'), path.join(source, 'native'), { recursive: true });
  fs.appendFileSync(path.join(source, 'native/session-status-bridge.swift'), '\n// changed source\n');
  assert.throws(() => prepareStartup(source, directory), /源码不一致/);
  fs.copyFileSync(path.join(root, 'native/session-status-bridge.swift'), path.join(source, 'native/session-status-bridge.swift'));
  fs.appendFileSync(path.join(source, 'native/bin/bridge'), 'corrupt');
  assert.throws(() => prepareStartup(source, directory), /校验失败/);
  assert.equal(fs.readFileSync(installed, 'utf8'), 'old bridge');
  assert.equal(fs.existsSync(path.join(directory, 'bridge.building')), false);
  assert.equal(fs.existsSync(path.join(directory, 'autostart.json')), false);
});
