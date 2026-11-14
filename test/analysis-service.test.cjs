'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { AnalysisService } = require('../src/analysis-service.cjs');

test('isolated analysis integrates paging, cleanup, model result, checkpoint and incremental update', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-service-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:thread']);
  const turn = id => ({ id, status: 'completed', items: [{ id: `u${id}`, type: 'userMessage', content: [{ type: 'text', text: `要求${id}` }] }, { id: `secret${id}`, type: 'reasoning', content: ['不得上传'] }] });
  let turns = [turn('1')], calls = 0, firstId;
  const makeServer = () => ({ async initialize() {}, close() {}, async request(method, params) {
    assert.equal(params.threadId, 'thread');
    return { data: params.sortDirection === 'desc' ? [turns.at(-1)] : turns, nextCursor: null };
  } });
  const run = async ({ input }) => {
    calls++;
    assert.doesNotMatch(JSON.stringify(input), /不得上传|local:thread|secret/);
    assert.equal(Object.hasOwn(input, 'limitations'), false);
    if (calls === 2) { assert.equal(input.events.filter(item => item.type === 'user').length, 1); firstId = input.previousLedger.tasks[0].id; }
    return { summary: '进展', tasks: [{ knownTaskId: calls === 1 ? null : firstId, title: '任务', status: 'in_progress', evidenceRefs: [input.events.find(item => item.type === 'user').ref] }], removedTaskIds: [] };
  };
  const service = new AnalysisService({ store, makeServer, run });
  await service.analyze(key);
  assert.equal(store.snapshot().records[key].source, 'analysis');
  assert.equal(store.snapshot().records[key].progress, 0);
  turns = [...turns, turn('2')];
  await service.analyze(key);
  assert.equal(calls, 2);
  assert.equal(store.analysisState(key).analysis.ledger.tasks[0].id, firstId);
  assert.equal(store.analysisState(key).analysis.checkpoint.turnHashes.length, 2);
});

test('installed runtime contains the service and its templates without the checkout', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-runtime-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  require('../src/manual-status-startup.cjs').installRuntime(path.resolve(__dirname, '..'), directory);
  const installed = require(path.join(directory, 'src/analysis-service.cjs'));
  assert.equal(typeof installed.AnalysisService, 'function');
  assert.ok(fs.readFileSync(path.join(directory, 'src/analysis-assets/prompt.zh-CN.txt'), 'utf8').length > 100);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'src/analysis-assets/output.schema.json'))).type, 'object');
});

test('stopping analysis aborts the model and persists the interruption', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-stop-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:test']);
  let closed = false, started;
  const modelStarted = new Promise(resolve => { started = resolve; });
  const turn = { id: 't1', status: 'completed', items: [] };
  const service = new AnalysisService({ store, makeServer: () => ({ initialize: async () => {}, close: async () => { closed = true; }, request: async () => ({ data: [turn], nextCursor: null }) }),
    run: ({ signal }) => new Promise((resolve, reject) => { started(); signal.addEventListener('abort', () => reject(new Error('已中断')), { once: true }); }) });
  const job = service.start(key).promise;
  job.catch(() => {});
  await modelStarted;
  await service.stop();
  assert.equal(closed, true);
  assert.equal(store.analysisState(key).timeline.at(-1).errorCode, 'SERVICE_STOPPING');
  assert.throws(() => service.start(key), { code: 'SERVICE_STOPPING' });
  assert.equal(store.analysisState(key).timeline.at(-1).status, 'failed');
});

test('outdated checkpoint versions cause complete cleaned-history reanalysis', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-version-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:thread']);
  const turns = ['one', 'two'].map(id => ({ id, status: 'completed', items: [
    { id: `u${id}`, type: 'userMessage', content: [{ type: 'text', text: `任务 ${id}` }] },
    { id: `a${id}`, type: 'agentMessage', phase: 'final_answer', text: '已完成' },
  ] }));
  let calls = 0;
  const service = new AnalysisService({ store, makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async (method, params) => ({ data: params.sortDirection === 'desc' ? [turns.at(-1)] : turns }) }),
    run: async ({ input }) => {
      calls++;
      if (calls === 1) assert.equal(input.previousLedger, null);
      else assert.equal(input.previousLedger.tasks.length, 1);
      assert.equal(input.events.filter(event => event.type === 'user').length, 2);
      return { summary: '完成', tasks: [{ knownTaskId: input.previousLedger?.tasks[0]?.id || null, title: '目标', status: 'done', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] };
    } });
  await service.analyze(key);
  const next = structuredClone(store.data);
  next.analysis[key].checkpoint.versions = { prompt: '1', schema: '1', ledger: '1' };
  store.write(next);
  await service.analyze(key);
  assert.equal(calls, 2);
  assert.deepEqual(store.analysisState(key).analysis.checkpoint.versions, { prompt: '4', schema: '4', ledger: '3' });
});

test('reading publishes boundary and page statistics, retaining them on failure', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-reading-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:thread']);
  const turn = id => ({ id, status: 'completed', items: [{ id: `u${id}`, type: 'userMessage', content: [{ type: 'text', text: '任务内容' }] }, { id: `a${id}`, type: 'agentMessage', phase: 'final_answer', text: '答复' }] });
  const snapshots = [];
  const service = new AnalysisService({ store, run: async () => assert.fail('读取失败时不得调用模型'), onChange: () => snapshots.push(store.analysisState(key).timeline.at(-1)),
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async (method, params) => {
      if (params.sortDirection === 'desc') return { data: [turn('two')] };
      if (!params.cursor) return { data: [turn('one')], nextCursor: 'next' };
      throw new Error('模拟读取失败');
    } }) });
  await assert.rejects(service.analyze(key), /模拟读取失败/);
  assert.ok(snapshots.some(event => event.stage === 'reading' && event.boundary?.turnId === 'two' && event.stats.turnCount === 0));
  const failed = store.analysisState(key).timeline.at(-1);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.boundary.turnId, 'two');
  assert.equal(failed.stats.turnCount, 1);
  assert.ok(failed.stats.rawBytes > 0 && failed.stats.compactBytes > 0);
  assert.ok(failed.stageDurations.reading >= 0);
  assert.equal(store.analysisState(key).analysis, null);
});

test('App Server timeout identifies method and elapsed time without exposing request content', async () => {
  const { AnalysisAppServer } = require('../src/analysis-app-server.cjs');
  const { PassThrough } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const spawnProcess = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stdin.resume();
    child.kill = () => process.nextTick(() => child.emit('close'));
    return child;
  };
  const server = new AnalysisAppServer({ spawnProcess, timeoutMs: 10 });
  await assert.rejects(server.request('thread/turns/list', { text: 'secret' }), error => {
    assert.match(error.message, /thread\/turns\/list.*\d+ 毫秒/);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
  await server.close();
});

test('a source timeout reconnects once and does not retry the model', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-retry-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:retry']);
  const turn = { id: 'one', status: 'completed', items: [{ id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '目标' }] }, { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: '已完成' }] };
  let connections = 0, closed = 0, modelCalls = 0;
  const states = [];
  const service = new AnalysisService({ store, onChange: () => states.push(store.analysisState(key).timeline.at(-1)),
    makeServer: () => {
      const number = ++connections;
      return { initialize: async () => {}, close: async () => { closed++; }, request: async () => {
        if (number === 1) { const error = new Error('读取超时'); error.code = 'APP_SERVER_TIMEOUT'; throw error; }
        return { data: [turn], nextCursor: null };
      } };
    },
    run: async ({ input }) => { modelCalls++; return { summary: '完成', tasks: [{ knownTaskId: null, title: '目标', status: 'done', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] }; } });
  await service.analyze(key);
  assert.equal(connections, 2); assert.equal(closed, 2); assert.equal(modelCalls, 1);
  assert.ok(states.some(event => event.stage === 'retrying'));
  assert.ok(states.some(event => event.stage === 'reading' && event.attempt === 2));
  assert.equal(store.snapshot().records[key].progress, 100);
});

test('repeated source timeout and model failure never trigger extra attempts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-retry-limit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const modelFailure of [false, true]) {
    const store = new ManualStatusStore(path.join(directory, `${modelFailure}.json`));
    const key = JSON.stringify(['local', 'local:retry']);
    let connections = 0, modelCalls = 0;
    const turn = { id: 'one', status: 'completed', items: [] };
    const service = new AnalysisService({ store, makeServer: () => { connections++; return { initialize: async () => {}, close: async () => {}, request: async () => {
      if (!modelFailure) { const error = new Error('读取超时'); error.code = 'APP_SERVER_TIMEOUT'; throw error; }
      return { data: [turn], nextCursor: null };
    } }; }, run: async () => { modelCalls++; const error = new Error('模型失败'); error.code = 'APP_SERVER_TIMEOUT'; throw error; } });
    await assert.rejects(service.analyze(key), modelFailure ? /模型失败/ : /读取超时/);
    assert.equal(connections, modelFailure ? 1 : 2);
    assert.equal(modelCalls, modelFailure ? 1 : 0);
    assert.equal(store.analysisState(key).timeline.at(-1).status, 'failed');
  }
});

test('long cleaned history fits one call and subsequent clicks send only new human messages', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-compact-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:compact']);
  const turn = (id, text, reply = '完成当前步骤') => ({ id, status: 'completed', items: [
    { id: 'u' + id, type: 'userMessage', content: [{ type: 'text', text }] },
    { id: 'a' + id, type: 'agentMessage', phase: 'final_answer', text: reply },
    { id: 'b' + id, type: 'subAgentActivity', kind: 'completed' },
  ] });
  let turns = [turn('1', '任务正文'.repeat(10000))], calls = 0;
  const service = new AnalysisService({ store,
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async (method, params) => ({ data: params.sortDirection === 'desc' ? [turns.at(-1)] : turns }) }),
    run: async ({ input }) => {
      calls++;
      if (calls === 1) {
        assert.ok(Buffer.byteLength(JSON.stringify(input)) > 60000);
        assert.deepEqual(input.events.map(e => e.type), ['user', 'answer']);
        return { summary: '初始任务完成', tasks: [{ knownTaskId: null, title: '最初任务', summary: '完成最初任务', status: 'done', evidenceRefs: [input.events[1].ref] }], removedTaskIds: [] };
      }
      assert.equal(input.previousLedger.tasks.length, 1);
      assert.deepEqual(input.events.map(e => e.text), ['新增交付任务', '尚未开始交付']);
      return { summary: '剩余交付任务', tasks: [{ knownTaskId: null, title: '交付任务', summary: '完成交付', status: 'todo', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] };
    } });
  await service.analyze(key);
  turns.push(turn('machine', '<heartbeat>自动任务指令</heartbeat>', '<heartbeat>机器状态</heartbeat>'));
  turns.push(turn('2', '新增交付任务', '尚未开始交付'));
  await service.analyze(key);
  const state = store.analysisState(key).analysis;
  assert.equal(calls, 2);
  assert.equal(state.ledger.totalTasks, 2);
  assert.equal(state.ledger.completedTasks, 1);
  assert.equal(state.ledger.percent, 50);
  assert.equal(state.checkpoint.turnHashes.length, 3);
  for (const task of state.ledger.tasks) assert.ok(state.sources[task.evidenceRefs[0]].itemId);
});

test('analysis measures each complete request against the latest merged ledger', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-split-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:split']);
  // 构造 4 个回合，每个文本约 600 字节，总文本约 2400 字节；maxBytes 设为 2000
  const turn = (id, text) => ({ id, status: 'completed', items: [
    { id: 'u' + id, type: 'userMessage', content: [{ type: 'text', text }] },
    { id: 'a' + id, type: 'agentMessage', phase: 'final_answer', text: '完成：' + id },
  ] });
  const turns = [
    turn('1', '阶段一'.repeat(10)),
    turn('2', '阶段二'.repeat(10)),
    turn('3', '阶段三'.repeat(10)),
    turn('4', '阶段四'.repeat(10)),
  ];

  let batchCalls = 0;
  const recordedBatches = [];
  const service = new AnalysisService({
    store,
    maxBytes: 5600,
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async (method, params) => ({ data: params.sortDirection === 'desc' ? [turns.at(-1)] : turns }) }),
    run: async ({ input, log }) => {
      batchCalls++;
      recordedBatches.push(input.events.map(e => e.ref));
      return {
        summary: `批次${batchCalls}完成`,
        tasks: [{ knownTaskId: null, title: `任务${batchCalls}`, summary: '概要', status: 'done', evidenceRefs: [input.events[0].ref] }],
        removedTaskIds: [],
      };
    },
  });

  await service.analyze(key);
  // 应当由于超限自动触发对半切分，分为 2 批依次运行
  assert.ok(batchCalls > 1);
  assert.equal(recordedBatches.length, batchCalls);
  const state = store.analysisState(key).analysis;
  assert.equal(state.ledger.tasks.length, batchCalls);
  assert.equal(state.ledger.completedTasks, batchCalls);
  assert.equal(state.ledger.percent, 100);
});

test('history replay retains all twelve tasks and source identities through the next incremental update', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-replay-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const key = JSON.stringify(['local', 'local:thread']);
  const turn = (id, text) => ({ id, status: 'completed', items: [{ id: `u${id}`, type: 'userMessage', content: [{ type: 'text', text }] }] });
  let turns = [turn('old', '原始任务来源')], calls = 0;
  const service = new AnalysisService({ store,
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async (_, params) => ({ data: params.sortDirection === 'desc' ? [turns.at(-1)] : turns }) }),
    run: async ({ input }) => {
      calls++;
      if (calls === 1) return { summary: '十二项', tasks: Array.from({ length: 12 }, (_, i) => ({ knownTaskId: null, title: `历史任务${i}`, status: i < 9 ? 'done' : 'todo', evidenceRefs: ['u1'] })), removedTaskIds: [] };
      assert.equal(input.previousLedger.tasks.length, calls === 2 ? 12 : 13);
      return { summary: '新增验收', tasks: calls === 2 ? [{ knownTaskId: null, title: '新增验收任务', status: 'todo', evidenceRefs: [input.events[0].ref] }] : [], removedTaskIds: [] };
    }
  });
  await service.analyze(key);
  const oldIds = store.getProgress(key).tasks.map(task => task.id);
  // The new first event receives u1, which was the old task's source ref.
  turns = [turn('inserted', '新增的任务要求'), ...turns];
  await service.analyze(key);
  let progress = store.getProgress(key);
  assert.equal(progress.tasks.length, 13);
  assert.equal(progress.progress, 69);
  assert.deepEqual(progress.tasks.slice(0, 12).map(task => task.id), oldIds);
  let analysis = store.analysisState(key).analysis;
  assert.equal(analysis.sources[analysis.ledger.tasks[0].evidenceRefs[0]].itemId, 'uold');
  assert.equal(analysis.sources[analysis.ledger.tasks[12].evidenceRefs[0]].itemId, 'uinserted');
  turns.push(turn('later', '继续验收'));
  await service.analyze(key);
  progress = store.getProgress(key);
  assert.equal(progress.tasks.length, 13);
  assert.equal(progress.tasks.filter(task => task.status === 'done').length, 9);
  assert.equal(progress.progress, 69);
});
