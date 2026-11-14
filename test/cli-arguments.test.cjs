'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArguments } = require('../src/cli/arguments.cjs');
test('setup aliases agree and flags cannot turn read-only commands into installation', () => {
  for (const flag of ['--yes', '-y', '--all']) assert.equal(parseArguments([flag]).yes, true);
  assert.equal(parseArguments(['setup', '--yes', '--lang', 'en']).lang, 'en');
  for (const args of [['status', '--all'], ['--help', '-y'], ['mcp', '--yes'], ['unknown'], ['setup', '--lang', 'xx'], ['run', '--data-dir'], ['status', '--watch-startup']]) assert.throws(() => parseArguments(args));
  assert.equal(parseArguments(['setup', '--help', '-y']).command, 'help');
  assert.equal(parseArguments(['run', '--port', '40000', '--watch-startup']).port, 40000);
});
