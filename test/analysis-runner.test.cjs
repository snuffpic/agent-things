'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { runAnalysis: run } = require('../src/analysis-runner.cjs');
const path = require('node:path');
const os = require('node:os');
// Tests never resolve the installed ChatGPT CLI: CI machines don't have ChatGPT.app.
const runAnalysis = options => run({ binary: '/nonexistent/codex', catalogHome: path.join(os.tmpdir(), `missing-codex-catalog-${process.pid}`), ...options });

function fake(events = [], code = 0, stderr = '') {
  return (binary, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { child.killed = true; };
    child.stdin.resume();
    process.nextTick(() => {
      assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-luna');
      assert.ok(args.includes('--ephemeral') && args.includes('--ignore-user-config'));
      assert.equal(args[args.indexOf('analytics.enabled=false') - 1], '-c');
      for (const value of ['skills.include_instructions=false', 'include_collaboration_mode_instructions=false',
        'include_environment_context=false', 'agents.enabled=false', 'tools.experimental_request_user_input.enabled=false']) {
        assert.ok(args.includes(value));
      }
      const instructions = args.find(value => value.startsWith('model_instructions_file='));
      const instructionFile = JSON.parse(instructions.slice('model_instructions_file='.length));
      assert.match(fs.readFileSync(instructionFile, 'utf8'), /会话任务状态分析器/);
      assert.equal(fs.statSync(instructionFile).mode & 0o777, 0o600);
      assert.ok(args.includes('shell_tool') && args.includes('unified_exec'));
      for (const event of events) child.stdout.write(JSON.stringify(event) + '\n');
      if (stderr) child.stderr.write(stderr);
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], '{"ok":true}');
      child.emit('close', code);
    });
    return child;
  };
}
test('model runner parses isolated structured result using fake child', async () => {
  assert.deepEqual(await runAnalysis({ input: { events: [] }, prompt: '规则', schema: {}, spawnProcess: fake([{ type: 'item.completed', item: { type: 'agent_message' } }, { type: 'turn.completed' }]) }), { ok: true });
});
test('model runner rejects tool events and oversized input', async () => {
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake([{ type: 'item.started', item: { type: 'command_execution' } }]) }), /不允许的工具/);
  await assert.rejects(runAnalysis({ input: { text: 'x'.repeat(192001) }, prompt: '', schema: {}, spawnProcess: fake() }), /预算/);
});

test('aborting waits for child close before removing its temporary directory', async () => {
  const controller = new AbortController();
  let directory, exited = false;
  const spawnProcess = (binary, args, options) => {
    directory = options.cwd;
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.stdin.resume();
    child.kill = () => { assert.equal(fs.existsSync(directory), true); setTimeout(() => { exited = true; child.emit('close', null); }, 20); };
    process.nextTick(() => controller.abort());
    return child;
  };
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess, signal: controller.signal }), /中断/);
  assert.equal(exited, true);
  assert.equal(fs.existsSync(directory), false);
});

test('non-fatal error item can recover and complete', async () => {
  const events = [
    { type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`.' } },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: '{"ok":true}' } },
    { type: 'turn.completed' },
  ];
  assert.deepEqual(await runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake(events) }), { ok: true });
});
test('terminal errors report safe diagnostics even with a zero exit code', async () => {
  for (const event of [
    { type: 'turn.failed', error: { message: 'rate limit 429 secret session text' } },
    { type: 'error', message: 'rate limit 429 secret session text' },
  ]) {
    await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake([event]) }), error => {
      assert.match(error.message, /模型请求达到限制/);
      assert.match(error.message, new RegExp(event.type));
      assert.doesNotMatch(error.message, /secret session text/);
      return true;
    });
  }
});
test('missing terminal outcome uses error item or stderr for safe diagnosis', async () => {
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake([
    { type: 'item.completed', item: { type: 'error', message: 'stream disconnected secret session text' } },
  ], 1) }), /未收到 turn.completed.*模型响应连接中断/);
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake([], 1, 'HTTP status 503') }), /HTTP 503/);
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake() }), /未收到 turn.completed/);
});

test('terminal failure cannot be cleared by later completion and nonzero exit fails', async () => {
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake([
    { type: 'error', message: 'authentication failed' }, { type: 'turn.completed' },
  ]) }), /error.*登录状态/);
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess: fake([
    { type: 'turn.completed' },
  ], 1) }), /退出码 1/);
});

test('real process exit settles even when a descendant keeps stdout and stderr open', async () => {
  const { spawn } = require('node:child_process');
  let directory;
  const script = `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: ['ignore', 1, 2] });
    child.unref();
    fs.writeFileSync(process.argv[1], '{"ok":true}');
    process.stdout.write(JSON.stringify({type:'turn.completed'}) + '\\n');
  `;
  const spawnProcess = (binary, args, options) => {
    directory = options.cwd;
    return spawn(process.execPath, ['-e', script, args[args.indexOf('--output-last-message') + 1]], options);
  };
  const start = Date.now();
  assert.deepEqual(await runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess }), { ok: true });
  assert.ok(Date.now() - start < 2500);
  assert.equal(fs.existsSync(directory), false);
});

test('spawn failure settles promptly and timeout waits for actual process exit', async () => {
  const { spawn } = require('node:child_process');
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, binary: '/path/does-not-exist', timeoutMs: 200 }), /ENOENT/);
  let directory, exited = false;
  const spawnProcess = (binary, args, options) => {
    directory = options.cwd;
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
    child.on('exit', () => { exited = true; assert.equal(fs.existsSync(directory), true); });
    return child;
  };
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess, timeoutMs: 100 }), /分析超时/);
  assert.equal(exited, true);
  assert.equal(fs.existsSync(directory), false);
});

test('timeout settles after the killed CLI exits while its descendant keeps pipes open', async () => {
  const { spawn } = require('node:child_process');
  const script = `
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)'], { stdio: ['ignore', 1, 2] });
    child.unref();
    setInterval(() => {}, 1000);
  `;
  const spawnProcess = (binary, args, options) => spawn(process.execPath, ['-e', script], options);
  const start = Date.now();
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess, timeoutMs: 150 }), /分析超时/);
  assert.ok(Date.now() - start < 2500);
});

test('a passed wall-clock deadline terminates the request after a clock discontinuity', async t => {
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  t.after(() => { Date.now = realNow; });
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.stdin.resume();
    child.kill = () => setImmediate(() => { child.emit('exit', null, 'SIGTERM'); child.emit('close', null, 'SIGTERM'); });
    setTimeout(() => { offset = 60000; }, 20);
    return child;
  };
  const started = performance.now();
  await assert.rejects(runAnalysis({ input: {}, prompt: '', schema: {}, spawnProcess, timeoutMs: 5000 }), /分析超时/);
  assert.ok(performance.now() - started < 4000);
});

test('diagnostics record waiting, timeout signals and process cleanup without event text', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let child;
  const records = [];
  const spawnProcess = () => {
    child = new EventEmitter(); child.pid = 123;
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.stdin.resume();
    child.kill = signal => { queueMicrotask(() => { child.emit('exit', null, signal); child.emit('close', null, signal); }); return true; };
    return child;
  };
  const promise = runAnalysis({ input: { secret: 'PRIVATE_INPUT' }, prompt: 'PRIVATE_PROMPT', schema: {}, spawnProcess,
    log: (event, fields) => records.push({ event, ...fields }) });
  child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'PRIVATE_OUTPUT' } }) + '\n');
  child.stderr.write('HTTP status 503 PRIVATE_CREDENTIAL');
  t.mock.timers.tick(15000);
  assert.ok(records.some(record => record.event === 'model.wait'));
  t.mock.timers.tick(105000);
  await assert.rejects(promise, /分析超时/);
  assert.ok(records.some(record => record.event === 'model.stop' && record.timeoutMs === 120000));
  assert.ok(records.some(record => record.event === 'model.signal' && record.signal === 'SIGTERM'));
  assert.ok(records.some(record => record.event === 'model.exit'));
  assert.equal(records.at(-1).event, 'model.cleanup.complete');
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_/);
});
