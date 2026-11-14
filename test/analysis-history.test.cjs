'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractHistory, prepareIncremental, commitCheckpoint } = require('../src/analysis-history.cjs');
const versions = { prompt: '1', schema: '1', ledger: '1' };
const make = turns => extractHistory({ hostId: 'local', threadId: 'thread', turns });
const turn = (id, items, status = 'completed') => ({ id, status, items });
const user = (id, text) => ({ id, type: 'userMessage', content: [{ type: 'text', text }] });
const answer = (id, text, phase = 'final_answer') => ({ id, type: 'agentMessage', text, phase });

test('only whitelisted content is emitted and each event resolves to its source', () => {
  const history = make([turn('t1', [user('u1', '要求'), { id: 'r1', type: 'reasoning', content: ['秘密思考'] },
    { id: 'c1', type: 'commandExecution', command: '秘密命令', aggregatedOutput: '秘密输出' },
    { id: 'b1', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'inProgress', prompt: '秘密提示', receiverThreadIds: ['agent'], agentsStates: { agent: { status: 'running', message: '秘密结果' } } },
    answer('a1', '说明', 'commentary'), answer('a2', '最终回答')])]);
  assert.deepEqual(history.events.map(e => e.type), ['user', 'answer']);
  assert.doesNotMatch(JSON.stringify(history.events), /秘密|说明/);
  assert.equal(history.sources[history.events[1].ref].itemId, 'a2');
  assert.equal(history.sources[history.events[0].ref].threadId, 'thread');
  assert.equal(history.stats.filteredItems, 4);
});

test('incremental analysis rereads changes and never advances through an unstable or partial boundary', () => {
  const first = make([turn('t1', [user('u1', '开始'), answer('a1', '完成')])]);
  const checkpoint = commitCheckpoint(first, { tasks: ['one'] }, versions);
  const next = make([turn('t1', [user('u1', '开始'), answer('a1', '完成')]), turn('t2', [user('u2', '继续')], 'inProgress')]);
  const incremental = prepareIncremental(next, checkpoint);
  assert.equal(incremental.reason, 'incremental');
  assert.equal(incremental.events.length, 1);
  assert.deepEqual(incremental.ledger, { tasks: ['one'] });
  assert.equal(prepareIncremental(next, checkpoint, { ...versions, prompt: '2' }).reason, 'versions_changed');
  assert.throws(() => commitCheckpoint(next, {}, versions), /未完成/);
  const changed = make([turn('t1', [user('u1', '修改'), answer('a1', '完成')])]);
  assert.equal(prepareIncremental(changed, checkpoint).reason, 'history_changed');
  assert.deepEqual(prepareIncremental(changed, checkpoint).ledger, checkpoint.ledger);
  const partial = make([{ ...turn('t1', [user('u1', '开始')]), itemsView: 'partial' }]);
  assert.throws(() => prepareIncremental(partial, checkpoint), /不连续/);
});

test('unknown finality is marked and interrupted turns do not acquire an invented answer', () => {
  const result = make([turn('one', [answer('a1', '旧版答复', null)]), turn('two', [user('u2', '继续执行任务'), answer('a2', '中断片段', null)], 'interrupted')]);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].finality, 'unknown');
  assert.ok(result.gaps.includes('回合interrupted'));
  assert.deepEqual(result.limitations, []);
  assert.equal(commitCheckpoint(result, { tasks: [] }, versions).turnHashes.length, 2);
});

test('pagination requests complete turns in order and rejects cursor loops and duplicates', async () => {
  const { readTurns } = require('../src/analysis-source.cjs');
  const calls = [];
  const request = async (method, params) => {
    calls.push({ method, ...params });
    return params.cursor ? { data: [turn('two', [])], nextCursor: null } : { data: [turn('one', [])], nextCursor: 'next' };
  };
  assert.deepEqual((await readTurns(request, 'thread')).map(t => t.id), ['one', 'two']);
  assert.equal(calls[0].itemsView, 'full');
  assert.equal(calls[0].sortDirection, 'asc');
  await assert.rejects(readTurns(async () => ({ data: [turn('one', [])], nextCursor: 'same' }), 'thread'), /重复/);
  await assert.rejects(readTurns(async () => ({ data: [], nextCursor: 'same' }), 'thread'), /未连续/);
});

test('ledger merges known tasks, retains unresolved tasks, and rejects untrusted identities and evidence', () => {
  const { mergeAnalysis } = require('../src/analysis-ledger.cjs');
  const previous = { tasks: [{ id: 'one', title: '旧任务', status: 'todo', evidenceRefs: ['u1'] }, { id: 'two', title: '保留', status: 'todo', evidenceRefs: ['u1'] }] };
  const output = { summary: '更新', tasks: [{ knownTaskId: 'one', title: '旧任务', status: 'done', evidenceRefs: ['a2'] }], removedTaskIds: [] };
  const merged = mergeAnalysis(previous, output, ['u1', 'a2']);
  assert.deepEqual(merged.tasks.map(task => task.status), ['done', 'todo']);
  assert.throws(() => mergeAnalysis(previous, { ...output, tasks: [{ ...output.tasks[0], evidenceRefs: ['invented'] }] }, ['a2']), /证据/);
  assert.throws(() => mergeAnalysis(previous, { ...output, removedTaskIds: ['one'] }, ['a2']), /冲突/);
});

test('captured boundary excludes later turns and freezes the captured tail', async () => {
  const { captureTurns } = require('../src/analysis-source.cjs');
  const old = turn('t2', [user('u2', '点击时')]);
  const request = async (method, params) => params.sortDirection === 'desc'
    ? { data: [old] }
    : { data: [turn('t1', [user('u1', '先前')]), turn('t2', [user('u2', '点击后修改')]), turn('t3', [user('u3', '新增')])] };
  const result = await captureTurns(request, 'thread');
  assert.deepEqual(result.turns.map(t => t.id), ['t1', 't2']);
  assert.equal(result.turns[1].items[0].content[0].text, '点击时');
  assert.deepEqual(result.boundary, { turnId: 't2', itemId: 'u2', turnCount: 2, occurredAt: null });
  await assert.rejects(captureTurns(async (m, p) => p.sortDirection === 'desc' ? { data: [old] } : { data: [] }, 'thread'), /边界/);
});

test('multi-page long history is cleaned per turn and only later turns enter the incremental package', async () => {
  const { captureExtracted } = require('../src/analysis-source.cjs');
  let count = 1000;
  const makeTurn = n => turn(`t${n}`, [user(`u${n}`, `任务${n}`), { id: `c${n}`, type: 'commandExecution', aggregatedOutput: '工具正文'.repeat(3000) }, answer(`a${n}`, `答复${n}`)]);
  const request = async (method, params) => {
    if (params.sortDirection === 'desc') return { data: [makeTurn(count)] };
    const start = params.cursor ? Number(params.cursor) : 1;
    const end = Math.min(start + 99, count);
    return { data: Array.from({ length: end - start + 1 }, (_, i) => makeTurn(start + i)), nextCursor: end < count ? String(end + 1) : null };
  };
  const first = await captureExtracted(request, 'local', 'thread');
  const checkpoint = commitCheckpoint(first.extracted, { tasks: [] }, versions);
  count = 2000;
  const second = await captureExtracted(request, 'local', 'thread');
  const delta = prepareIncremental(second.extracted, checkpoint, versions);
  assert.equal(delta.startTurn, 1000);
  assert.equal(delta.events.length, 2000);
  assert.equal(new Set(second.extracted.events.map(event => event.ref)).size, 4000);
  assert.doesNotMatch(JSON.stringify(second.extracted.events), /工具正文/);
  assert.equal(second.boundary.turnCount, 2000);
});

test('whole-goal counts retain completed milestones through additions, completion, and explicit cancellation', () => {
  const { mergeAnalysis } = require('../src/analysis-ledger.cjs');
  const task = (title, status, knownTaskId = null) => ({ knownTaskId, title, status, evidenceRefs: ['u1'] });
  const delta = (tasks, removedTaskIds = []) => ({ summary: '当前目标', tasks, removedTaskIds });
  let ledger = mergeAnalysis(null, delta(['热加载', '会话分析', '启动器'].map(title => task(title, 'done')).concat([task('验收', 'todo'), task('交付', 'in_progress')])), ['u1']);
  assert.deepEqual([ledger.totalTasks, ledger.completedTasks, ledger.remainingTasks, ledger.percent, ledger.remainingPercent], [5, 3, 2, 60, 40]);
  ledger = mergeAnalysis(ledger, delta([task('新增需求', 'todo')]), ['u1']);
  assert.deepEqual([ledger.totalTasks, ledger.completedTasks, ledger.remainingTasks, ledger.percent], [6, 3, 3, 50]);
  const cancelled = ledger.tasks.find(t => t.title === '新增需求').id;
  ledger = mergeAnalysis(ledger, delta(ledger.tasks.filter(t => t.status !== 'done' && t.id !== cancelled).map(t => task(t.title, 'done', t.id)), [cancelled]), ['u1']);
  assert.deepEqual([ledger.totalTasks, ledger.completedTasks, ledger.remainingTasks, ledger.percent, ledger.remainingPercent], [5, 5, 0, 100, 0]);
});

test('non-text attachments are omitted while text and answer remain available', () => {
  const history = make([turn('t1', [{ id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '请处理' }, { type: 'image', url: 'private' }] }, answer('a1', '任务已完成')])]);
  assert.deepEqual(history.events.map(e => e.type), ['user', 'answer']);
  assert.doesNotMatch(JSON.stringify(history), /private|非文本/);
});

test('machine envelopes disappear while human question replies and trailing requests retain sources', () => {
  const reply = '<send_user_message_question_reply>\n' + JSON.stringify([{ question: '是否完成？', answer: '已完成，请继续交付', questionItemId: 'private-id' }]) + '\n</send_user_message_question_reply>';
  const history = make([turn('t1', [
    user('heartbeat', '<heartbeat><instructions>机器指令</instructions></heartbeat>'),
    answer('machine-answer', '<heartbeat>机器状态</heartbeat>'),
    { id: 'plan', type: 'plan', text: '历史计划' },
    { id: 'background', type: 'subAgentActivity', kind: 'completed', agentThreadId: 'private-id' },
    user('reply', reply),
    user('browser', '<in-app-browser-context source="ambient-ui-state">机器浏览器</in-app-browser-context>\n请完成验收'),
    user('quoted', '解释下面的格式：\n<heartbeat>示例</heartbeat>'),
    answer('final', '任务已完成并推送'),
  ])]);
  assert.deepEqual(history.events.map(e => e.text), ['提问：是否完成？\n用户回答：已完成，请继续交付', '请完成验收', '解释下面的格式：\n<heartbeat>示例</heartbeat>', '任务已完成并推送']);
  assert.equal(history.sources[history.events[0].ref].itemId, 'reply');
  assert.doesNotMatch(JSON.stringify(history.events), /机器|历史计划|private-id/);
  assert.equal(history.turnHashes.length, 1);
});

test('short summaries merge without losing full titles, completed tasks or legacy compatibility', () => {
  const { mergeAnalysis } = require('../src/analysis-ledger.cjs');
  const previous = { tasks: [{ id: 'one', title: '完整的原始任务标题', summary: '验收界面', status: 'todo', evidenceRefs: ['u1'] }, { id: 'done', title: '历史完成', status: 'done', evidenceRefs: ['u1'] }] };
  const change = { knownTaskId: 'one', title: '完整的原始任务标题', summary: '完成界面验收', status: 'done', evidenceRefs: ['a2'] };
  const result = mergeAnalysis(previous, { summary: '完成', tasks: [change], removedTaskIds: [] }, ['u1', 'a2']);
  assert.equal(result.percent, 100);
  assert.equal(result.tasks[0].summary, '完成界面验收');
  assert.equal(result.tasks[0].title, previous.tasks[0].title);
  assert.equal(result.tasks[1].id, 'done');
  assert.throws(() => mergeAnalysis(previous, { summary: '', tasks: [{ ...change, summary: '字'.repeat(21) }], removedTaskIds: [] }, ['a2']), /短总结/);
  const { summary, ...legacy } = change;
  assert.equal(mergeAnalysis(previous, { summary: '', tasks: [legacy], removedTaskIds: [] }, ['a2']).tasks[0].summary, '验收界面');
});

test('summary validation identifies the task and reports the character count and limit', () => {
  const { mergeAnalysis } = require('../src/analysis-ledger.cjs');
  const task = { knownTaskId: null, title: '第一项', summary: '短总结', status: 'todo', evidenceRefs: ['u1'] };
  assert.throws(() => mergeAnalysis(null, { summary: '目标', tasks: [task, { ...task, title: '第二项', summary: '字'.repeat(21) }], removedTaskIds: [] }, ['u1']), error => {
    assert.match(error.message, /第 2 项任务“第二项”/);
    assert.match(error.message, /当前 21 个字符/);
    assert.match(error.message, /1至20个字符/);
    return true;
  });
});
