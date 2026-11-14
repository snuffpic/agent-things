'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runGeminiAnalysis } = require('../src/harnesses/antigravity/gemini-runner.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncAnalysisProfile, content: profileContent } = require('../src/harnesses/antigravity/analysis-profile.cjs');

test('CLI analysis selects a tool-free profile and session-only strict permissions', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-runner-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => dir);
  const fake = path.join(dir, 'agy');
  const captured = path.join(dir, 'invocation.json');
  fs.writeFileSync(fake, `#!${process.execPath}
const fs=require('node:fs');let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{
fs.writeFileSync(${JSON.stringify(captured)},JSON.stringify({args:process.argv.slice(2),input}));
process.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:{summary:'ok',gitPush:{status:'unknown',evidenceRefs:[]},tasks:[],removedTaskIds:[]}}})+'\\n');});
process.stdout.write(JSON.stringify({event:'init',init:{agent:'agent-things-analysis',permission_mode:'strict',tools:[]}})+'\\n');
`, { mode: 0o700 });
  const result = await runGeminiAnalysis({ agyBin: fake, input: { events: [{ text: '历史任务资料' }] }, prompt: '仅分析', schema: fakeSchema });
  assert.deepEqual(result, { summary: 'ok', gitPush: { status: 'unknown', evidenceRefs: [] }, tasks: [], removedTaskIds: [] });
  const call = JSON.parse(fs.readFileSync(captured));
  assert.equal(call.args[call.args.indexOf('--agent') + 1], 'agent-things-analysis');
  assert.ok(!call.args.includes('--dangerously-skip-permissions'));
  assert.deepEqual(JSON.parse(call.args[call.args.indexOf('--settings') + 1]), { toolPermission: 'strict', agentMode: '' });
  const input = JSON.parse(call.input);
  assert.equal(input.event, 'user');
  assert.ok(input.message.content.includes('历史任务资料'));
  assert.ok(input.message.content.includes(JSON.stringify(fakeSchema)));
  assert.equal(call.args[call.args.indexOf('--input-format') + 1], 'stream-json');
  assert.ok(!call.args.includes('--json-schema'));
  assert.ok(input.message.content.includes(JSON.stringify(fakeSchema)));
  const profile = path.join(dir, '.gemini/config/agents/agent-things-analysis/agent.md');
  assert.equal(fs.readFileSync(profile, 'utf8'), profileContent);
  assert.match(profileContent, /excludeDefaultComponents: true\ntools: \[\]\ninheritMcp: false/);
  syncAnalysisProfile(false, { home: dir });
  assert.equal(fs.existsSync(profile), false);
  fs.writeFileSync(profile, '用户的同名配置');
  assert.throws(() => syncAnalysisProfile(true, { home: dir }), /同名分析配置/);
  syncAnalysisProfile(false, { home: dir });
  assert.equal(fs.readFileSync(profile, 'utf8'), '用户的同名配置');
});

const fakeSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    gitPush: {
      type: 'object',
      properties: { status: { type: 'string' }, evidenceRefs: { type: 'array', items: { type: 'string' } } },
      required: ['status', 'evidenceRefs'],
    },
    tasks: { type: 'array', items: { type: 'object' } },
    removedTaskIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'gitPush', 'tasks', 'removedTaskIds'],
};

test('runGeminiAnalysis rejects missing API key when agy not found', async () => {
  await assert.rejects(
    runGeminiAnalysis({
      input: { events: [] },
      prompt: 'test prompt',
      schema: fakeSchema,
      apiKey: '',
      agyBin: null,
    }),
    /未检测到 agy 命令行/
  );
});

test('CLI rejects an unsafe permission mode before sending history and interrupts tool requests', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-runner-deny-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => dir);
  for (const mode of ['always-proceed', 'strict']) {
    const fake = path.join(dir, mode), inputFile = path.join(dir, `${mode}.input`);
    fs.writeFileSync(fake, `#!${process.execPath}
const fs=require('node:fs');
process.stdout.write(JSON.stringify({event:'init',init:{agent:'agent-things-analysis',permission_mode:${JSON.stringify(mode)},tools:['run_command']}})+'\\n');
process.stdin.on('data',b=>{fs.writeFileSync(${JSON.stringify(inputFile)},b);process.stdout.write(JSON.stringify({event:'step_update',step_update:{step_type:'tool',tool_name:'run_command'}})+'\\n')});
`, { mode: 0o700 });
    await assert.rejects(runGeminiAnalysis({ agyBin: fake, input: { events: [{ text: 'private history' }] }, prompt: '仅分析', schema: fakeSchema }), mode === 'strict' ? /请求了工具操作/ : /只读分析配置/);
    assert.equal(fs.existsSync(inputFile), mode === 'strict');
  }
});

test('runGeminiAnalysis parses valid structured JSON output via REST fallback', async () => {
  const expectedResult = {
    summary: '已完成会话分析',
    gitPush: { status: 'pushed', evidenceRefs: ['ev1'] },
    tasks: [{ knownTaskId: null, title: '测试任务', summary: '测试任务摘要', status: 'done', evidenceRefs: ['ev1'] }],
    removedTaskIds: [],
  };

  let capturedBody = null;
  const mockFetch = async (url, options) => {
    assert.match(url, /generateContent\?key=test-key/);
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(expectedResult) }],
            },
          },
        ],
      }),
    };
  };

  const logs = [];
  const result = await runGeminiAnalysis({
    input: { events: [{ ref: 'ev1' }] },
    prompt: '分析提示词',
    schema: fakeSchema,
    apiKey: 'test-key',
    agyBin: null,
    fetchImpl: mockFetch,
    log: (event, fields) => logs.push({ event, fields }),
  });

  assert.deepEqual(result, expectedResult);
  assert.equal(capturedBody.generationConfig.responseMimeType, 'application/json');
  assert.equal(logs.some(l => l.event === 'model.spawn'), true);
  assert.equal(logs.some(l => l.event === 'model.output.valid'), true);
  assert.equal(logs.some(l => l.event === 'model.settled' && l.fields.ok === true), true);
});

test('runGeminiAnalysis handles upstream HTTP errors with diagnostic hints', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    text: async () => 'API_KEY_INVALID: User key is not valid',
  });

  await assert.rejects(
    runGeminiAnalysis({
      input: { events: [] },
      prompt: 'test',
      schema: fakeSchema,
      apiKey: 'bad-key',
      agyBin: null,
      fetchImpl: mockFetch,
    }),
    /请检查 Antigravity 登录状态/
  );
});

test('runGeminiAnalysis aborts when signal triggered', async () => {
  const controller = new AbortController();
  const mockFetch = async (_url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };

  const promise = runGeminiAnalysis({
    input: { events: [] },
    prompt: 'test',
    schema: fakeSchema,
    apiKey: 'test-key',
    agyBin: null,
    signal: controller.signal,
    fetchImpl: mockFetch,
  });

  controller.abort();
  await assert.rejects(promise, /分析已中断|aborted/);
});
