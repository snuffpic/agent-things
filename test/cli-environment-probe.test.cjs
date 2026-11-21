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
  assert.ok(env.deepseek, 'env.deepseek should exist');

  assert.equal(typeof env.codex.installed, 'boolean');
  assert.equal(typeof env.antigravity.installed, 'boolean');
  assert.equal(typeof env.agy.installed, 'boolean');
  assert.equal(typeof env.claude.installed, 'boolean');
  assert.equal(typeof env.deepseek.installed, 'boolean');
  assert.ok(Array.isArray(env.deepseek.profileLinks));
  assert.equal(typeof env.deepseek.markedSessions, 'number');
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

  const fakeAgyInstalled = { id: 'antigravity', name: 'Antigravity', installed: true, running: false, port: null, path: '/Applications/Antigravity.app' };
  assert.match(formatProbeText(fakeAgyInstalled, 'zh'), /已安装/);
  assert.match(formatProbeText(fakeAgyInstalled, 'en'), /Installed/);

  const fakeAgyNoPort = { id: 'antigravity', name: 'Antigravity', installed: true, running: true, port: null };
  assert.match(formatProbeText(fakeAgyNoPort, 'zh'), /无调试端口，需重启/);
  assert.match(formatProbeText(fakeAgyNoPort, 'en'), /No debug port, restart needed/);

  const fakeAgyWithPort = { id: 'antigravity', name: 'Antigravity', installed: true, running: true, port: 29222 };
  assert.match(formatProbeText(fakeAgyWithPort, 'zh'), /29222/);
  assert.match(formatProbeText(fakeAgyWithPort, 'en'), /29222/);

  const dshBadNode = { id: 'deepseek', name: 'DeepSeek Harness', installed: true, nodeVersion: 'v22.14.0', nodeCompatible: false };
  assert.match(formatProbeText(dshBadNode, 'zh'), /Node >= 24\.9.*v22\.14\.0/);
  assert.match(formatProbeText(dshBadNode, 'en'), /Needs Node >= 24\.9.*v22\.14\.0/);

  const dshBrokenLink = { id: 'deepseek', name: 'DeepSeek Harness', installed: true, nodeCompatible: true, brokenPluginProfiles: ['web'], healthyPluginProfiles: [] };
  assert.match(formatProbeText(dshBrokenLink, 'zh'), /插件链接异常.*web/);
  assert.match(formatProbeText(dshBrokenLink, 'en'), /Broken plugin link.*web/);

  const dshLive = { id: 'deepseek', name: 'DeepSeek Harness', installed: true, nodeCompatible: true, profiles: ['web'], bridge: { reachable: true, port: 61234 } };
  assert.match(formatProbeText(dshLive, 'zh'), /运行中.*web.*:61234/);
  assert.match(formatProbeText(dshLive, 'en'), /Running.*web.*:61234/);
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
