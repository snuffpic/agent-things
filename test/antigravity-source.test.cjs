'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { AnalysisService } = require('../src/analysis-service.cjs');
const {
  convertStepsToTurns,
  AntigravityTranscriptServer
} = require('../src/harnesses/antigravity/transcript-source.cjs');

test('convertStepsToTurns converts Antigravity JSONL steps into turns', () => {
  const sampleSteps = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-11-04T00:00:00Z',
      content: '<USER_REQUEST>\n请帮我实现会话进展分析\n</USER_REQUEST>'
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-04T00:01:00Z',
      content: '好的，我已经分析了需求并开始规划。'
    },
    {
      step_index: 2,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-11-04T00:02:00Z',
      content: '继续执行下一步'
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-04T00:03:00Z',
      content: '任务已全部完成！'
    }
  ];

  const turns = convertStepsToTurns(sampleSteps);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].items.length, 2);
  assert.equal(turns[0].items[0].type, 'userMessage');
  assert.equal(turns[0].items[0].content[0].text, '请帮我实现会话进展分析');
  assert.equal(turns[0].items[1].type, 'agentMessage');
  assert.equal(turns[0].items[1].text, '好的，我已经分析了需求并开始规划。');

  assert.equal(turns[1].items.length, 2);
  assert.equal(turns[1].items[0].type, 'userMessage');
  assert.equal(turns[1].items[0].content[0].text, '继续执行下一步');
  assert.equal(turns[1].items[1].type, 'agentMessage');
  assert.equal(turns[1].items[1].text, '任务已全部完成！');
});

test('AntigravityTranscriptServer integrates with AnalysisService', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-service-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const threadId = 'cascade-test-123';
  const brainDir = path.join(tempDir, 'brain');
  const logDir = path.join(brainDir, threadId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, 'transcript.jsonl');
  const steps = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: '2026-11-04T00:00:00Z',
      content: '修复某个Bug'
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-04T00:01:00Z',
      content: '已经修复了该Bug'
    }
  ];
  fs.writeFileSync(logFile, steps.map(s => JSON.stringify(s)).join('\n') + '\n');

  const store = new ManualStatusStore(path.join(tempDir, 'state.json'));
  const key = JSON.stringify(['local', threadId]);
  const server = new AntigravityTranscriptServer({ brainDir, cwd: tempDir });

  let runCalled = false;
  const run = async ({ input }) => {
    runCalled = true;
    assert.equal(input.events.length >= 1, true);
    return {
      summary: 'Bug修复进展',
      tasks: [
        {
          knownTaskId: null,
          title: '修复某个Bug',
          status: 'done',
          evidenceRefs: [input.events[0].ref]
        }
      ],
      removedTaskIds: []
    };
  };

  const service = new AnalysisService({
    store,
    makeServer: () => server,
    run
  });

  await service.analyze(key);
  assert.equal(runCalled, true);

  const snapshot = store.snapshot();
  assert.equal(snapshot.records[key].source, 'analysis');
  assert.equal(snapshot.records[key].state, 'completed');
  assert.equal(snapshot.records[key].progress, 100);
});

test('convertStepsToTurns discards tool outputs and intermediate calls like Codex', () => {
  const steps = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '<USER_REQUEST> 请运行测试并修复 </USER_REQUEST> <ADDITIONAL_METADATA>一些元数据</ADDITIONAL_METADATA>'
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [{ name: 'run_command', args: { command: 'npm test' } }],
      content: ''
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      content: 'Created At: 2026-11-04... 50000 bytes long terminal log output...'
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [],
      content: '测试已经全部通过，修复完成！'
    }
  ];

  const turns = convertStepsToTurns(steps);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].items.length, 2);
  assert.equal(turns[0].items[0].type, 'userMessage');
  assert.equal(turns[0].items[0].content[0].text, '请运行测试并修复');
  assert.equal(turns[0].items[1].type, 'agentMessage');
  assert.equal(turns[0].items[1].text, '测试已经全部通过，修复完成！');
});

test('AntigravityTranscriptServer supports cursor pagination across large sessions (>100 turns)', async t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-pagination-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const threadId = 'cascade-long-session-456';
  const brainDir = path.join(tempDir, 'brain');
  const logDir = path.join(brainDir, threadId, '.system_generated', 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const logFile = path.join(logDir, 'transcript.jsonl');
  const steps = [];
  // 生成 250 个回合 (500 steps)
  for (let i = 1; i <= 250; i++) {
    steps.push({
      step_index: (i - 1) * 2,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: new Date(1700000000000 + i * 1000).toISOString(),
      content: `<USER_REQUEST>任务 ${i}</USER_REQUEST>`
    });
    steps.push({
      step_index: (i - 1) * 2 + 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: new Date(1700000000000 + i * 1000 + 500).toISOString(),
      content: `完成任务 ${i}`
    });
  }
  fs.writeFileSync(logFile, steps.map(s => JSON.stringify(s)).join('\n') + '\n');

  const server = new AntigravityTranscriptServer({ brainDir, cwd: tempDir });

  // 1. 验证 desc 能够正确取到最后一条 (turn 250)
  const descPage = await server.request('thread/turns/list', { threadId, sortDirection: 'desc', limit: 1 });
  assert.equal(descPage.data.length, 1);
  assert.equal(descPage.data[0].id, '250');

  // 2. 验证多页拉取
  const page1 = await server.request('thread/turns/list', { threadId, sortDirection: 'asc', limit: 100 });
  assert.equal(page1.data.length, 100);
  assert.equal(page1.data[0].id, '1');
  assert.equal(page1.data.at(-1).id, '100');
  assert.equal(page1.nextCursor, '100');

  const page2 = await server.request('thread/turns/list', { threadId, sortDirection: 'asc', limit: 100, cursor: page1.nextCursor });
  assert.equal(page2.data.length, 100);
  assert.equal(page2.data[0].id, '101');
  assert.equal(page2.data.at(-1).id, '200');
  assert.equal(page2.nextCursor, '200');

  const page3 = await server.request('thread/turns/list', { threadId, sortDirection: 'asc', limit: 100, cursor: page2.nextCursor });
  assert.equal(page3.data.length, 50);
  assert.equal(page3.data[0].id, '201');
  assert.equal(page3.data.at(-1).id, '250');
  assert.equal(page3.nextCursor, null);

  // 3. 验证配合 captureExtracted 与 readTurns 无缝跑通，绝不抛出边界不存在异常
  const { captureExtracted } = require('../src/analysis-source.cjs');
  const captured = await captureExtracted(server.request.bind(server), 'local', threadId);
  assert.equal(captured.boundary.turnId, '250');
  assert.equal(captured.boundary.turnCount, 250);
  assert.equal(captured.extracted.turnHashes.length, 250);
});
