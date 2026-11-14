'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeTruncateText,
  cleanUserRequestText,
  isFinalAgentResponse,
  convertStepsToTurns,
} = require('../src/harnesses/antigravity/transcript-cleaner.cjs');

test('transcript-cleaner cleans user request and strips metadata envelopes', () => {
  const raw = '<USER_REQUEST>\n请优化算法性能\n</USER_REQUEST>\n<ADDITIONAL_METADATA>{"timestamp": 123}</ADDITIONAL_METADATA>';
  const cleaned = cleanUserRequestText(raw);
  assert.equal(cleaned, '请优化算法性能');
});

test('transcript-cleaner safely truncates excessively long text', () => {
  const longText = 'A'.repeat(30000);
  const truncated = safeTruncateText(longText, 20000);
  assert.equal(truncated.length < 21000, true);
  assert.match(truncated, /\[\.\.\.内容过长已截断\.\.\.\]/);
  assert.equal(truncated.startsWith('A'.repeat(100)), true);
  assert.equal(truncated.endsWith('A'.repeat(100)), true);
});

test('transcript-cleaner identifies final agent response and rejects tools/intermediates', () => {
  // 1. 普通工具调用（带 tool_calls） -> 拒绝
  assert.equal(isFinalAgentResponse({
    type: 'PLANNER_RESPONSE',
    tool_calls: [{ name: 'run_command' }],
    content: ''
  }), false);

  // 2. 工具原始输出（GENERIC） -> 拒绝
  assert.equal(isFinalAgentResponse({
    type: 'GENERIC',
    content: 'Terminal output from bash'
  }), false);

  // 3. 系统消息 -> 拒绝
  assert.equal(isFinalAgentResponse({
    type: 'SYSTEM_MESSAGE',
    content: 'Task completed'
  }), false);

  // 4. 空内容的 PLANNER_RESPONSE -> 拒绝
  assert.equal(isFinalAgentResponse({
    type: 'PLANNER_RESPONSE',
    content: '   '
  }), false);

  // 5. 真正的面向用户正式回复 -> 接受
  assert.equal(isFinalAgentResponse({
    type: 'PLANNER_RESPONSE',
    tool_calls: [],
    content: '任务已经顺利完成，请验收。'
  }), true);
});

test('transcript-cleaner converts complete steps into clean turns without log pollution', () => {
  const steps = [
    {
      step_index: 0,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      content: '<USER_REQUEST>帮我做个性能优化</USER_REQUEST>'
    },
    {
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      tool_calls: [{ name: 'probe' }],
      content: ''
    },
    {
      step_index: 2,
      source: 'MODEL',
      type: 'GENERIC',
      content: '10000 lines of profiling dumps...'
    },
    {
      step_index: 3,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      content: '优化方案已制定完毕。'
    }
  ];

  const turns = convertStepsToTurns(steps);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].items.length, 2);
  assert.equal(turns[0].items[0].type, 'userMessage');
  assert.equal(turns[0].items[0].content[0].text, '帮我做个性能优化');
  assert.equal(turns[0].items[1].type, 'agentMessage');
  assert.equal(turns[0].items[1].text, '优化方案已制定完毕。');
});
