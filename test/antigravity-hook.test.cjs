'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isThingsCommand, extractUserInput, processHookInput } = require('../src/antigravity-hook.cjs');

test('antigravity-hook: isThingsCommand matching rules', () => {
  assert.equal(isThingsCommand('/things'), true);
  assert.equal(isThingsCommand('/things '), true);
  assert.equal(isThingsCommand('/THINGS'), true);
  assert.equal(isThingsCommand('  /things  '), true);
  assert.equal(isThingsCommand('/things 进度'), true);
  assert.equal(isThingsCommand('<USER_REQUEST>\n/things \n</USER_REQUEST>'), true);
  assert.equal(isThingsCommand('<USER_REQUEST>\n/things\n</USER_REQUEST>\n<ADDITIONAL_METADATA>...'), true);
  assert.equal(isThingsCommand('/something'), false);
  assert.equal(isThingsCommand('hello /things'), false);
  assert.equal(isThingsCommand('<USER_REQUEST>\nhello /things\n</USER_REQUEST>'), false);
  assert.equal(isThingsCommand(''), false);
  assert.equal(isThingsCommand(null), false);
  assert.equal(isThingsCommand(undefined), false);
});

test('antigravity-hook: extractUserInput strips wrapping tags', () => {
  assert.equal(extractUserInput('/things'), '/things');
  assert.equal(extractUserInput('<USER_REQUEST>\n/things \n</USER_REQUEST>'), '/things');
  assert.equal(extractUserInput('<user_request>  /things  </user_request>'), '/things');
});

test('antigravity-hook: processHookInput ignores non-/things input', () => {
  const result = processHookInput(JSON.stringify({
    lastUserInput: '你好，帮我写个函数',
    conversationId: 'conv-123',
  }));
  assert.deepEqual(result, {});

  const invalidJson = processHookInput('{ bad json');
  assert.deepEqual(invalidJson, {});
});

test('antigravity-hook: processHookInput intercepts /things and outputs termination contract', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hook-test-'));
  try {
    const rawInput = JSON.stringify({
      lastUserInput: '/things',
      conversationId: 'test-hook-conv',
      artifactDirectoryPath: tempDir,
    });

    const output = processHookInput(rawInput);
    assert.equal(output.terminationBehavior, 'terminate');
    assert.ok(Array.isArray(output.injectSteps));
    assert.equal(output.injectSteps.length, 1);

    const step = output.injectSteps[0];
    assert.ok(step.systemMessage);
    assert.ok(step.systemMessage.metadata);
    const md = step.systemMessage.metadata.user_markdown;
    assert.ok(typeof md === 'string');
    assert.ok(md.includes('<agent-embed src="file://'));
    assert.ok(md.includes('things-card.html'));
    assert.ok(md.includes('当前会话任务进度'));

    const expectedFile = path.join(tempDir, 'things-card.html');
    assert.ok(fs.existsSync(expectedFile), 'things-card.html should be created');
    const content = fs.readFileSync(expectedFile, 'utf8');
    assert.ok(content.includes('当前会话'));
    assert.ok(!content.includes('Agent Things 会话任务进度'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('antigravity-hook: CLI stdin/stdout child_process pipeline', async () => {
  const { spawn } = require('node:child_process');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hook-cli-'));
  try {
    const hookScript = path.resolve(__dirname, '../src/antigravity-hook.cjs');
    const child = spawn(process.execPath, [hookScript], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });

    const payload = JSON.stringify({
      lastUserInput: '/things',
      conversationId: 'cli-test-conv',
      artifactDirectoryPath: tempDir,
    });

    child.stdin.write(payload);
    child.stdin.end();

    const exitCode = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(exitCode, 0);

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.terminationBehavior, 'terminate');
    assert.ok(parsed.injectSteps[0].systemMessage.metadata.user_markdown.includes('things-card.html'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('antigravity-hook: processHookInput handles empty session without writing ledger or tasks', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hook-empty-'));
  try {
    const rawInput = JSON.stringify({
      lastUserInput: '<USER_REQUEST>\n/things\n</USER_REQUEST>',
      conversationId: 'completely-fresh-empty-session-' + Date.now(),
      artifactDirectoryPath: tempDir,
    });

    const output = processHookInput(rawInput);
    assert.equal(output.terminationBehavior, 'terminate');
    const md = output.injectSteps[0].systemMessage.metadata.user_markdown;
    assert.ok(md.includes('当前会话任务进度：尚未记录进展'), 'should display 尚未记录进展 for empty session');
    assert.ok(md.includes('暂无任务清单'), 'should display 暂无任务清单');
    assert.ok(fs.existsSync(path.join(tempDir, 'things-card.html')), 'card file created');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

