'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { probeEnvironment, formatProbeText } = require('../src/cli/environment-probe.cjs');

test('probeEnvironment returns structured targets with expected properties', async () => {
  const env = await probeEnvironment();
  assert.ok(env.codex, 'env.codex should exist');
  assert.ok(env.antigravity, 'env.antigravity should exist');
  assert.ok(env.agy, 'env.agy should exist');
  assert.ok(env.claude, 'env.claude should exist');

  assert.equal(typeof env.codex.installed, 'boolean');
  assert.equal(typeof env.antigravity.installed, 'boolean');
  assert.equal(typeof env.agy.installed, 'boolean');
  assert.equal(typeof env.claude.installed, 'boolean');
});

test('formatProbeText handles zh and en languages gracefully', () => {
  const fakeInstalled = { id: 'claude', name: 'Claude Desktop', installed: true, path: '/Applications/Claude.app' };
  const fakeMissing = { id: 'claude', name: 'Claude Desktop', installed: false, path: null };

  assert.match(formatProbeText(fakeInstalled, 'zh'), /已安装/);
  assert.match(formatProbeText(fakeInstalled, 'en'), /Installed/);

  assert.match(formatProbeText(fakeMissing, 'zh'), /未检测到应用/);
  assert.match(formatProbeText(fakeMissing, 'en'), /Not detected/);

  const fakeCodexRunningNoPort = { id: 'codex', name: 'Codex', installed: true, running: true, portActive: false };
  assert.match(formatProbeText(fakeCodexRunningNoPort, 'zh'), /需重启/);
  assert.match(formatProbeText(fakeCodexRunningNoPort, 'en'), /restart needed/);
});

test('running host detection reads executable images rather than full process arguments', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const mod = { exports: {} };
  const file = path.join(__dirname, '../src/cli/environment-probe.cjs');
  const request = id => id === 'node:child_process' ? { execFileSync: (_, args) => {
    assert.deepEqual(args, ['-axo', 'comm=']);
    return '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n/Applications/Other.app/ChatGPT\n';
  } } : require(id.startsWith('.') ? path.resolve(path.dirname(file), id) : id);
  vm.runInThisContext('(function(require,module,exports){' + fs.readFileSync(file, 'utf8') + '\n})')(request, mod, mod.exports);
  assert.equal(mod.exports.isAppRunning('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'), true);
  assert.equal(mod.exports.isAppRunning('/Applications/Antigravity.app/Contents/MacOS/Antigravity'), false);
});
