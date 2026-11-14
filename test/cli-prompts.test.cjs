'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
function prompts(tty = true) {
  const stdin = new PassThrough(), stdout = new PassThrough(); let output = '';
  stdin.isTTY = tty; stdin.isRaw = false; stdin.setRawMode = raw => { stdin.isRaw = raw; };
  stdout.on('data', chunk => { output += chunk; });
  const mod = { exports: {} };
  const file = path.join(__dirname, '../src/cli/prompt-tui.cjs');
  const req = id => id === '../../package.json' ? { version: 'test' } : id === './environment-probe.cjs' ? { formatProbeText: item => item?.installed ? 'Installed' : 'Missing' } : require(id);
  vm.runInThisContext('(function(require,module,exports,process){' + fs.readFileSync(file, 'utf8') + '\n})')(req, mod, mod.exports, { stdin, stdout });
  return { ...mod.exports, stdin, output: () => output, key: name => stdin.emit('keypress', name === 'space' ? ' ' : '', { name }) };
}
const env = { codex: { installed: true }, antigravity: { installed: true } };
test('application selection restores saved choices and blocks missing applications', async () => {
  const ui = prompts();
  let pending = ui.selectApps(env, 'en', ['antigravity']); ui.key('return');
  assert.deepEqual(await pending, ['antigravity']);
  pending = ui.selectApps({ ...env, codex: { installed: false } }, 'en', []);
  ui.key('space'); ui.key('return'); assert.deepEqual(await pending, []);
  assert.equal(ui.output().includes('Claude Desktop'), true);
  assert.equal(ui.output().includes('未安装'), false);
  assert.equal(ui.stdin.isRaw, false);
});
test('Claude selection restores saved choice and includes the third installed host', async () => {
  const ui = prompts();
  const pending = ui.selectApps({ ...env, claude: { installed: true } }, 'en', ['claude']);
  ui.key('return'); assert.deepEqual(await pending, ['claude']);
});
test('escape returns, EOF cancels and a non-terminal produces no ANSI menu', async () => {
  const ui = prompts(); let pending = ui.selectMenu('menu', [{ label: 'exit', value: 'exit' }]);
  ui.key('escape'); assert.equal(await pending, null); assert.equal(ui.stdin.isRaw, false);
  pending = ui.askConfirm('confirm'); ui.stdin.emit('end'); await assert.rejects(pending, error => error.code === 'CLI_CANCELLED');
  const piped = prompts(false); await assert.rejects(piped.selectApps(env), /终端/); assert.equal(piped.output(), '');
});
