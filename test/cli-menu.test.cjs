'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
async function simulate(actions, { first = false, select = ['antigravity'], confirm = false, tty = true, updateInfo = { currentVersion: '1.0.0', available: false }, updateError = null, initial = null, codexRunning = false, codexHealthy = codexRunning } = {}) {
  let config = first ? null : initial || { lang: 'en', enabledApps: ['codex'] };
  const calls = [], output = [], initialSelections = [], menus = [];
  const env = { codex: { id: 'codex', name: 'Codex', installed: true, running: codexRunning }, antigravity: { id: 'antigravity', name: 'Antigravity', installed: true }, claude: { id: 'claude', name: 'Claude', installed: true } };
  const queue = [...actions];
  const mocks = {
    'node:fs': { existsSync: () => !first, readFileSync: () => { throw Error('missing config'); } },
    './environment-probe.cjs': { probeEnvironment: async () => env, formatProbeText: () => 'installed' },
    './prompt-tui.cjs': { selectLanguageWithProbe: async () => 'en', selectApps: async (_, __, previous) => { initialSelections.push(previous); return select; }, askConfirm: async () => confirm, selectMenu: async (_, items) => { menus.push(items); assert.ok(queue.length, 'menu must eventually return/exit'); return queue.shift(); } },
    './setup-orchestrator.cjs': { DATA_DIR: '/fixture', readConfig: () => config, executeSetup: async options => { calls.push(options); config = { lang: options.lang, enabledApps: options.enabledApps }; }, uninstallAll: async () => calls.push('uninstall') },
    '../launchd.cjs': { printJob: () => codexRunning ? 'pid = 123' : null },
    '../cdp.cjs': { listTargets: async () => [] },
    '../manual-status-agent.cjs': { attachmentStatus: async () => ({ mountedConversations: 0 }) },
    '../manual-status-startup.cjs': { startupStatus: () => ({ event: 'skipped-cooldown', lastAttemptAt: Date.now() }) },
    '../startup/watch.cjs': { portInUse: async () => false },
    '../startup/controller.cjs': { COOLDOWN_MS: 120000 },
    '../local-progress-http.cjs': { requestProgressHttp: async file => { if (codexHealthy && file === '/fixture/manual-state.json') return {}; throw Error('stopped'); } },
    '../harnesses/claude/claude-service.cjs': { DEFAULT_STATE_FILE: '/fixture/claude-state.json' },
    '../npm-updates.cjs': { getUpdateInfo: async options => { assert.equal(options.force, true); if (updateError) throw Error(updateError); return updateInfo; }, startUpdate: async () => { calls.push('upgrade'); } },
  };
  const mod = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,process,console){' + fs.readFileSync(path.join(__dirname, '../src/cli/interactive-cli.cjs'), 'utf8') + '\n})')(
    id => Object.hasOwn(mocks, id) ? mocks[id] : id === '../i18n.cjs' ? require('../src/i18n.cjs') : require(id), mod, mod.exports, { stdin: { isTTY: tty } }, { log: (...args) => output.push(args.join(' ')) });
  await mod.exports.runInteractiveCli();
  return { calls, output, initialSelections };
}
test('management actions return to menu and sync uses the entire setup pipeline', async () => {
  const result = await simulate(['apps', 'sync', 'health', 'uninstall', 'exit']);
  assert.deepEqual(result.initialSelections, [['codex']]);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls.map(call => call.enabledApps), [['antigravity'], ['antigravity']]);
  assert.ok(result.output.some(line => line.includes('mounted badges: 0')));
});
test('back from app selection and declined uninstall produce no mutation', async () => {
  assert.deepEqual((await simulate(['apps', 'uninstall', 'exit'], { select: null })).calls, []);
  assert.deepEqual((await simulate(['uninstall'], { confirm: true })).calls, ['uninstall']);
});
test('first setup cancel and non-terminal handling leave configuration untouched', async () => {
  assert.deepEqual((await simulate([], { first: true, select: null })).calls, []);
  await assert.rejects(simulate([], { first: true, tty: false }), /终端/);
});
test('upgrade confirmation starts a background job and declining returns to menu', async () => {
  const updateInfo = { currentVersion: '1.0.0', latestVersion: '1.1.0', available: true };
  assert.deepEqual((await simulate(['upgrade', 'exit'], { updateInfo })).calls, []);
  const confirmed = await simulate(['upgrade', 'exit'], { updateInfo, confirm: true });
  assert.deepEqual(confirmed.calls, ['upgrade']);
  assert.ok(confirmed.output.some(line => line.includes('You may close the terminal')));
});
test('update check failures, current releases and in-flight updates return to management', async () => {
  for (const options of [{}, { updateError: 'offline' }, { updateInfo: { checkError: 'not published' } }, { updateInfo: { update: { stage: 'waiting' } } }]) {
    assert.deepEqual((await simulate(['upgrade', 'exit'], options)).calls, []);
  }
});

test('Claude setup explains the manual sidebar entry point', async () => {
  const result = await simulate([], { first: true, select: ['claude'] });
  assert.deepEqual(result.calls[0].enabledApps, ['claude']);
  assert.ok(result.output.some(line => line.includes('Enable Main Process Debugger')));
});
test('opening the installed CLI shows why Codex has not attached before presenting the menu', async () => {
  const { output } = await simulate(['exit'], { codexRunning: true });
  assert.ok(output.some(line => line.includes('Launch fell within the cooldown')));
  assert.ok(output.some(line => line.includes('no debugger on port 39222') && line.includes('Reopen after')));
});

test('a live process with failed authentication is diagnosed before debugger availability', async () => {
  const { output } = await simulate(['exit'], { codexRunning: true, codexHealthy: false });
  assert.ok(output.some(line => line.includes('authenticated health check failed')));
});
