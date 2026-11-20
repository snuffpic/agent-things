'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDshSessionEvents,
  buildItemCoordinateIndex,
  readDshSessionSnapshot,
  DshTranscriptServer,
} = require('../src/harnesses/deepseek/dsh-source.cjs');
const {
  resolveDshModelRoute,
  resolveAnalysisRouteDetail,
  discoverModelCatalog,
  readAnalysisConfig,
  writeAnalysisConfig,
  assembleTextFromChunks,
  stripJsonFence,
  runDshAnalysis,
} = require('../src/harnesses/deepseek/dsh-runner.cjs');
const {
  DshStatusStore,
  DshService,
  resolveDefaultDshStateFile,
} = require('../src/harnesses/deepseek/dsh-service.cjs');

function makeSampleEvents() {
  return [
    {
      type: 'turn/start',
      seq: 1,
      time: 1000,
      data: { turn: 0 },
    },
    {
      type: 'request/header',
      seq: 2,
      time: 1010,
      data: {
        header: {
          config: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'medium' },
        },
      },
    },
    {
      type: 'user/message',
      seq: 3,
      time: 1020,
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: '帮我实现 DeepSeek Harness 的进度圆环与待办提取' }],
      },
    },
    {
      type: 'user/message',
      seq: 4,
      time: 1025,
      data: {
        source: { kind: 'compaction-summary' },
        content: [{ type: 'text', text: '内部压缩摘要，不应作为用户发言' }],
      },
    },
    {
      type: 'assistant/message',
      seq: 5,
      time: 1030,
      data: {
        turn: 0,
        interrupted: false,
        message: {
          content: [
            { type: 'reasoning', text: '正在思考架构' },
            { type: 'text', text: '第一步已经搭好后端通道，接下来完成客户端 UI Slot。' },
          ],
        },
      },
    },
    {
      type: 'turn/end',
      seq: 6,
      time: 1040,
      data: { turn: 0, reason: { kind: 'completed' } },
    },
  ];
}

function makeMockLlm({ responseText = '{"summary":"ok","tasks":[],"removedTaskIds":[]}', providers = [{ id: 'deepseek', name: 'DeepSeek' }], models = { deepseek: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }, onStream = null } = {}) {
  return {
    listProviders: () => providers,
    listModels: async providerId => models[providerId] || [],
    prepareCall: async (config, signal) => {
      if (signal?.aborted) throw new Error('aborted');
      return {
        config: { ...config },
        stream: async function* (options) {
          onStream?.(options);
          yield { type: 'block-start', index: 0, blockType: 'reasoning' };
          yield { type: 'reasoning-delta', index: 0, text: '{"fake":"thinking must be ignored"}' };
          yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '{"fake":"thinking"}' } };
          yield { type: 'block-start', index: 1, blockType: 'text' };
          const mid = Math.floor(responseText.length / 2);
          yield { type: 'text-delta', index: 1, text: responseText.slice(0, mid) };
          yield { type: 'text-delta', index: 1, text: responseText.slice(mid) };
          yield { type: 'block-end', index: 1, block: { type: 'text', text: responseText } };
          yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 45 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
}

test('dsh-source parses turns, filters synthetic messages, preserves seq coordinates and pages cleanly', async () => {
  const events = makeSampleEvents();
  const parsed = parseDshSessionEvents(events, { header: { id: 'sess-1', cwd: '/tmp/repo' } });
  assert.equal(parsed.turns.length, 1);
  assert.deepEqual(parsed.latestRoute, {
    provider: 'deepseek',
    model: 'deepseek-reasoner',
    reasoningEffort: 'medium',
  });

  const turn = parsed.turns[0];
  assert.equal(turn.id, 'turn-0');
  assert.equal(turn.turn, 0);
  assert.equal(turn.status, 'completed');
  assert.equal(turn.items.length, 2);
  assert.equal(turn.items[0].id, 'seq-3');
  assert.equal(turn.items[0].type, 'userMessage');
  assert.equal(turn.items[1].id, 'seq-5');
  assert.equal(turn.items[1].phase, 'final_answer');

  const coords = buildItemCoordinateIndex(parsed.turns);
  assert.deepEqual(coords.get('seq-3'), {
    itemId: 'seq-3',
    turnId: 'turn-0',
    turn: 0,
    seq: 3,
    role: 'user',
  });

  const server = new DshTranscriptServer(async () => ({ cwd: '/tmp/repo', ...parsed }));
  const readRes = await server.request('thread/read', { threadId: 'sess-1' });
  assert.equal(readRes.thread.cwd, '/tmp/repo');
  const page = await server.request('thread/turns/list', { threadId: 'sess-1', limit: 10 });
  assert.equal(page.data.length, 1);
  assert.equal(page.nextCursor, null);
});

test('dsh-source reads live sessions first and falls back to cold persistence', async () => {
  const events = makeSampleEvents();
  const liveCtx = {
    sessions: {
      get: id => (id === 'live-1' ? { header: { cwd: '/tmp/live' }, snapshotEvents: () => events } : undefined),
    },
    sessionPersistence: {
      open: async () => {
        throw new Error('should not touch persistence for live session');
      },
    },
  };
  const liveSnap = await readDshSessionSnapshot(liveCtx, 'live-1');
  assert.equal(liveSnap.cwd, '/tmp/live');
  assert.equal(liveSnap.turns.length, 1);

  let closed = false;
  const coldCtx = {
    sessions: { get: () => undefined },
    sessionPersistence: {
      open: async () => ({
        header: { cwd: '/tmp/cold' },
        read: async () => ({ events }),
        close: async () => { closed = true; },
      }),
    },
  };
  const coldSnap = await readDshSessionSnapshot(coldCtx, 'cold-1');
  assert.equal(coldSnap.cwd, '/tmp/cold');
  assert.equal(closed, true);
});

test('dsh-runner prioritizes routes, ignores reasoning blocks, strips fences and validates schema', async () => {
  const ctx = {
    llm: makeMockLlm(),
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'default-model' }) },
  };
  assert.deepEqual(
    await resolveDshModelRoute(ctx, { sessionRoute: { provider: 'deepseek', model: 'sess-model' } }),
    { provider: 'deepseek', model: 'sess-model' },
  );
  assert.deepEqual(
    await resolveDshModelRoute(ctx, { sessionRoute: { provider: 'missing', model: 'x' } }),
    { provider: 'deepseek', model: 'default-model' },
  );

  assert.equal(stripJsonFence('Here is JSON:\n```json\n{"a":1}\n```'), '{"a":1}');

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/analysis-assets/output.schema.json'), 'utf8'));
  const llm = makeMockLlm({
    responseText: '```json\n{"summary":"阶段进度良好","gitPush":{"status":"unknown","evidenceRefs":[]},"tasks":[{"knownTaskId":null,"title":"接入侧边栏任务圆环","summary":"接入任务圆环","status":"in_progress","evidenceRefs":["u1"]}],"removedTaskIds":[]}\n```',
  });
  const result = await runDshAnalysis({
    ctx: { llm },
    input: { events: [] },
    prompt: 'Analyze tasks',
    schema,
    sessionRoute: { provider: 'deepseek', model: 'deepseek-chat' },
    lang: 'zh',
  });
  assert.equal(result.summary, '阶段进度良好');
  assert.equal(result.tasks.length, 1);
});

test('dsh-service handles save, conflict, push git gate, incremental analyze, locate, /things commands and SSE', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-service-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  let events = makeSampleEvents();
  let streamCalls = 0;
  let capturedRef = null;
  let gitRemote = false;

  const ctx = {
    llm: makeMockLlm({
      onStream: options => {
        streamCalls++;
        const userMsg = options.messages[0].content[0].text;
        const jsonText = userMsg.slice(userMsg.indexOf('{\n') !== -1 ? userMsg.indexOf('{\n') : userMsg.lastIndexOf('{'));
        void jsonText;
      },
    }),
    sessions: {
      get: id => (id === 'sess-1' ? { id: 'sess-1', header: { cwd: '/tmp/project' }, snapshotEvents: () => events } : undefined),
    },
    sessionPersistence: {
      open: async () => { throw Object.assign(new Error('not found'), { code: 'SESSION_PERSISTENCE_NOT_FOUND' }); },
    },
  };

  const service = new DshService({
    ctx,
    stateFile: path.join(dir, 'manual-state.json'),
    inspectGitFn: async () => ({ status: 'checked', hasRepository: true, hasRemote: gitRemote }),
    runAnalysis: async ({ input }) => {
      streamCalls++;
      const firstUser = input.events.find(e => e.type === 'user');
      if (firstUser) capturedRef = firstUser.ref;
      if (streamCalls === 1) {
        return {
          summary: '已开始前端适配',
          gitPush: { status: 'not_pushed', evidenceRefs: [] },
          tasks: [{ knownTaskId: null, title: '完成 DSH 客户端 Slot 对接', summary: '对接客户端 Slot', status: 'in_progress', evidenceRefs: [firstUser.ref] }],
          removedTaskIds: [],
        };
      }
      const existingId = input.previousLedger.tasks[0].id;
      return {
        summary: 'DSH 客户端已完成',
        gitPush: { status: 'not_pushed', evidenceRefs: [] },
        tasks: [{ knownTaskId: existingId, title: '完成 DSH 客户端 Slot 对接', summary: '对接客户端 Slot', status: 'done', evidenceRefs: [firstUser.ref] }],
        removedTaskIds: [],
      };
    },
  });
  await service.start();
  t.after(() => service.stop());

  // 1. Open SSE stream and collect events
  const abortController = new AbortController();
  const sseRes = await service.handleFetch(new Request('http://localhost/api/agent-things/events?lang=zh', { signal: abortController.signal }));
  assert.equal(sseRes.status, 200);
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  const readChunk = async () => decoder.decode((await reader.read()).value);
  const firstFrame = await readChunk();
  assert.match(firstFrame, /event: snapshot/);

  // 2. Save manual state & test optimistic concurrency conflict
  const saved = await service.saveSession('sess-1', {
    expectedRevision: 0,
    record: { state: 'unfinished', progress: 50, note: '半程进度' },
    lang: 'zh',
  });
  assert.equal(saved.record.progress, 50);
  assert.equal(saved.record.projectPath, '/tmp/project');

  const updateFrame = await readChunk();
  assert.match(updateFrame, /event: update/);
  assert.match(updateFrame, /"sess-1"/);
  abortController.abort();

  // Conflict HTTP 409 check
  const conflictRes = await service.handleFetch(new Request('http://localhost/api/agent-things/save', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'sess-1', expectedRevision: 0, record: { state: 'completed', progress: 100, note: '' } }),
  }));
  assert.equal(conflictRes.status, 409);

  // Git remote gate for pushed
  await assert.rejects(
    () => service.saveSession('sess-1', { expectedRevision: saved.revision, record: { state: 'pushed', progress: 100, note: '' }, lang: 'zh' }),
    /Git 远端/,
  );

  // 3. First analysis run
  const analyzed1 = await service.analyzeAndWait('sess-1', { lang: 'zh' });
  assert.equal(streamCalls, 1);
  assert.equal(analyzed1.analysis.ledger.tasks.length, 1);
  assert.equal(analyzed1.analysis.ledger.tasks[0].source.seq, 3);
  assert.equal(analyzed1.analysis.ledger.tasks[0].source.turn, 0);

  // 4. Task provenance locate
  const taskId = analyzed1.analysis.ledger.tasks[0].id;
  const located = await service.locateTask('sess-1', { taskId, lang: 'zh' });
  assert.equal(located.located, true);
  assert.equal(located.seq, 3);
  assert.equal(located.turn, 0);

  // 5. Incremental second turn analysis
  events = [
    ...events,
    { type: 'turn/start', seq: 7, time: 2000, data: { turn: 1 } },
    { type: 'user/message', seq: 8, time: 2010, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续收尾上线并完成全部验收测试验证' }] } },
    { type: 'assistant/message', seq: 9, time: 2020, data: { turn: 1, message: { content: [{ type: 'text', text: '已完成全部测试' }] } } },
    { type: 'turn/end', seq: 10, time: 2030, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  gitRemote = true;
  const analyzed2 = await service.analyzeAndWait('sess-1', { lang: 'zh' });
  assert.equal(streamCalls, 2);
  assert.equal(analyzed2.analysis.ledger.tasks[0].status, 'done');
  assert.equal(analyzed2.record.progress, 100);
  assert.equal(analyzed2.analysis.ledger.tasks[0].source.seq, 8);
  assert.equal(analyzed2.analysis.ledger.tasks[0].source.turn, 1);

  // 6. Slash command & MCP tools
  const cmdShow = await service.handleCommand('sess-1', '', { lang: 'zh' });
  assert.equal(cmdShow.kind, 'success');
  assert.match(cmdShow.text, /100%|已完成/);

  const cmdPct = await service.handleCommand('sess-1', '75', { lang: 'zh' });
  assert.equal(cmdPct.kind, 'success');
  assert.match(cmdPct.text, /75%/);

  const toolRead = await service.tools('get_session_progress', { conversation_id: 'sess-1' });
  assert.equal(toolRead.progress, 75);

  const toolUpdated = await service.tools('update_session_tasks', {
    conversation_id: 'sess-1',
    expected_revision: toolRead.revision,
    summary: '补充验收项',
    tasks: [{
      knownTaskId: null,
      title: '验证 DSH MCP 来源绑定',
      summary: '验证 MCP 来源',
      status: 'todo',
      source: { locator: '继续收尾上线并完成全部验收测试验证' },
    }],
    removedTaskIds: [],
  });
  const mcpTask = toolUpdated.tasks.find(task => task.source?.itemId === 'seq-8' && task.source?.turnId === 'turn-1');
  assert.ok(mcpTask);
  const locatedMcp = await service.locateTask('sess-1', { taskId: mcpTask.id, lang: 'zh' });
  assert.equal(locatedMcp.located, true);
  assert.equal(locatedMcp.seq, 8);
  assert.equal(locatedMcp.turn, 1);

  const clearedRes = await service.handleFetch(new Request('http://localhost/api/agent-things/clear', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'sess-1', expectedRevision: toolUpdated.revision, lang: 'zh' }),
  }));
  assert.equal(clearedRes.status, 200);
  const summaryAfter = service.summaryPayload({ lang: 'zh' });
  assert.equal(Object.hasOwn(summaryAfter.items, 'sess-1'), false);

  assert.match(resolveDefaultDshStateFile({ platform: 'linux', env: { DSH_HOME: '/tmp/dsh-home' } }), /dsh-home.*manual-state\.json/);
  assert.ok(capturedRef);
});

test('P0 regressions: resolveKey alignment, inProgress turn boundary, relative cwd git safety, inspectGitFn push auto-purple, analyze-cancel RPC', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // 1. DshStatusStore.resolveKey aligns with keyForSession (no local: split-brain) & handles legacy dual-key
  const stateFile = path.join(dir, 'manual-state.json');
  const store = new DshStatusStore(stateFile, { lang: 'zh' });
  const k1 = store.resolveKey('sess-clean');
  assert.equal(k1, JSON.stringify(['local', 'sess-clean']));
  store.update({
    key: JSON.stringify(['local', 'local:legacy-mixed']),
    expectedRevision: 0,
    record: { state: 'unfinished', progress: 40, note: 'old' },
  });
  store.update({
    key: JSON.stringify(['local', 'legacy-mixed']),
    expectedRevision: 0,
    record: { state: 'completed', progress: 100, note: 'new' },
  });
  assert.equal(store.resolveKey('legacy-mixed'), JSON.stringify(['local', 'legacy-mixed']));

  // 2. dsh-source + DshTranscriptServer: incomplete inProgress turns are safely excluded/settled so commitCheckpoint succeeds
  const eventsWithStreaming = [
    ...makeSampleEvents(),
    // Turn 1 lacks turn/end, superseded by Turn 2 -> Turn 1 converges to interrupted
    { type: 'turn/start', seq: 7, time: 2000, data: { turn: 1 } },
    { type: 'user/message', seq: 8, time: 2010, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '准备部署脚本并核查工作区状态' }] } },
    // Trailing active streaming Turn 2 without turn/end -> stays inProgress in parsed, filtered out of DshTranscriptServer
    { type: 'turn/start', seq: 9, time: 2020, data: { turn: 2 } },
    { type: 'user/message', seq: 10, time: 2030, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '正在流式生成的问题...' }] } },
  ];
  const parsedStreaming = parseDshSessionEvents(eventsWithStreaming);
  assert.equal(parsedStreaming.turns[1].status, 'interrupted');
  assert.equal(parsedStreaming.turns[2].status, 'inProgress');

  let abortDeferred;
  const service = new DshService({
    ctx: {
      sessions: {
        get: id => {
          if (id === 'rel-cwd') return { id, header: { cwd: 'relative/not-abs' }, snapshotEvents: () => eventsWithStreaming };
          if (id === 'abs-cwd') return { id, header: { cwd: '/tmp/real-repo' }, snapshotEvents: () => eventsWithStreaming };
          return undefined;
        },
      },
    },
    stateFile: path.join(dir, 'service-state.json'),
    inspectGitFn: async cwd => {
      assert.equal(cwd, '/tmp/real-repo');
      return { status: 'checked', hasRepository: true, hasRemote: true };
    },
    runAnalysis: async ({ input, signal }) => {
      if (signal && !abortDeferred && input.events.some(e => e.type === 'user')) {
        // Auto-pushed on real run when input indicates remote + gitPush pushed
        const userRef = input.events.find(e => e.type === 'user').ref;
        return {
          summary: '已推送远端仓库',
          gitPush: { status: 'pushed', evidenceRefs: [userRef] },
          tasks: [{ knownTaskId: null, title: '部署并推送代码', summary: '部署推送', status: 'done', evidenceRefs: [userRef] }],
          removedTaskIds: [],
        };
      }
      await new Promise((_resolve, reject) => {
        abortDeferred = () => reject(signal?.reason || new Error('aborted'));
        signal?.addEventListener('abort', abortDeferred, { once: true });
      });
    },
  });
  await service.start();
  t.after(() => service.stop());

  assert.equal(service.keyForSession('fresh-1'), service.store.resolveKey('fresh-1'));

  // 3. Relative cwd must not crash inspectSessionGit or saveSession
  const relGit = await service.inspectSessionGit('rel-cwd');
  assert.equal(relGit.hasRepository, false);
  assert.equal(relGit.hasRemote, false);
  assert.equal(relGit.projectPath, null);
  const relSaved = await service.saveSession('rel-cwd', {
    expectedRevision: 0,
    record: { state: 'unfinished', progress: 25, note: 'safe' },
  });
  assert.equal(relSaved.record.projectPath ?? null, null);

  // 4. Streaming inProgress tail + inspectGitFn auto-purple pushed end-to-end
  const pushedRes = await service.analyzeAndWait('abs-cwd', { lang: 'zh' });
  assert.equal(pushedRes.record.state, 'pushed');
  assert.equal(pushedRes.record.progress, 100);

  // 5. handleRpc analyze-cancel & app-update-info
  const updateRpc = await service.handleRpc({ type: 'app-update-info', requestId: 'u1' });
  assert.equal(updateRpc.updateInfo.unsupported, true);
  assert.equal(updateRpc.updateInfo.available, false);

  const slowService = new DshService({
    ctx: { sessions: { get: () => ({ id: 'cancel-1', header: { cwd: '/tmp/real-repo' }, snapshotEvents: () => makeSampleEvents() }) } },
    stateFile: path.join(dir, 'cancel-state.json'),
    inspectGitFn: async () => ({ status: 'checked', hasRepository: false, hasRemote: false }),
    runAnalysis: ({ signal }) => new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason || new Error('cancelled'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason || new Error('cancelled')), { once: true });
    }),
  });
  await slowService.start();
  t.after(() => slowService.stop());

  const started = await slowService.analyzeSession('cancel-1');
  assert.ok(started.session.snapshot.analyzingKeys.includes(slowService.keyForSession('cancel-1')));
  const cancelRpc = await slowService.handleRpc({ type: 'analyze-cancel', key: slowService.keyForSession('cancel-1'), requestId: 'c1' });
  assert.equal(cancelRpc.cancelled, true);
  await assert.rejects(() => started.job.promise);
});

test('P1 regressions: source truncation/paging, model downgrade, abort race, locate ambiguity, sidebar title/updatedAt, RPC protocolVersion', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p1-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // 1. /things command stripping, 24k head+tail truncation, and 480KB page limit
  const hugeBody = `${'A'.repeat(15000)}MIDDLE_SECRET_TEXT${'Z'.repeat(15000)}`;
  const sourceEvents = [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 0 } },
    { type: 'user/message', seq: 2, time: 1010, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '/things analyze' }] } },
    { type: 'user/message', seq: 3, time: 1020, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `/things\n${hugeBody}` }] } },
    { type: 'assistant/message', seq: 4, time: 1030, data: { turn: 0, message: { content: [{ type: 'text', text: 'Done first turn' }] } } },
    { type: 'turn/end', seq: 5, time: 1040, data: { turn: 0, reason: { kind: 'completed' } } },
  ];
  const parsedSource = parseDshSessionEvents(sourceEvents);
  assert.equal(parsedSource.turns[0].items.length, 2, 'bare /things command message must be stripped');
  const userText = parsedSource.turns[0].items[0].content[0].text;
  assert.ok(userText.length <= 24000, 'single message text must be truncated within 24k chars');
  assert.ok(userText.startsWith('A'.repeat(50)) && userText.endsWith('Z'.repeat(50)), 'head and tail must be preserved');

  const bigStr = 'X'.repeat(300000);
  const twoBigTurns = {
    cwd: '/tmp/big-proj',
    turns: [
      { id: 'turn-0', turn: 0, status: 'completed', items: [{ id: 'seq-1', seq: 1, type: 'userMessage', content: [{ type: 'text', text: bigStr }] }] },
      { id: 'turn-1', turn: 1, status: 'completed', items: [{ id: 'seq-2', seq: 2, type: 'userMessage', content: [{ type: 'text', text: bigStr }] }] },
    ],
  };
  const pagedServer = new DshTranscriptServer(async () => twoBigTurns);
  const page1 = await pagedServer.request('thread/turns/list', { threadId: 'big-1', limit: 100 });
  assert.equal(page1.data.length, 1);
  assert.equal(page1.nextCursor, 'turn-0');
  const page2 = await pagedServer.request('thread/turns/list', { threadId: 'big-1', limit: 100, cursor: page1.nextCursor });
  assert.equal(page2.data.length, 1);
  assert.equal(page2.nextCursor, null);

  // 2. Heavy reasoning model downgrade + explicit route preserved + non-responsive stream abort race
  const routeCtx = {
    llm: {
      listProviders: () => [{ id: 'deepseek' }],
      listModels: async () => [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }],
      prepareCall: async () => { throw new Error('unused'); },
    },
  };
  assert.deepEqual(
    await resolveDshModelRoute(routeCtx, { sessionRoute: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' } }),
    { provider: 'deepseek', model: 'deepseek-chat' },
  );
  assert.deepEqual(
    await resolveDshModelRoute(routeCtx, { route: { provider: 'deepseek', model: 'deepseek-reasoner' } }),
    { provider: 'deepseek', model: 'deepseek-reasoner' },
  );

  const abortCtrl = new AbortController();
  const hungIterable = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
        return: () => Promise.resolve({ done: true }),
      };
    },
  };
  setTimeout(() => abortCtrl.abort(new Error('forced cancel')), 20);
  await assert.rejects(
    () => assembleTextFromChunks(hungIterable, 'zh', { signal: abortCtrl.signal }),
    /forced cancel/,
  );

  // 3. locateTask backfill & ambiguity, external import prefix filtering, sidebarSession.title & stable updatedAt, RPC protocolVersion
  const locateEvents = [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 0 } },
    { type: 'user/message', seq: 2, time: 1010, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '准备环境并执行重构任务' }] } },
    { type: 'assistant/message', seq: 3, time: 1020, data: { turn: 0, message: { content: [{ type: 'text', text: '<EXTERNAL SESSION IMPORTED>\n重复锚点文本需要精确定位' }] } } },
    { type: 'assistant/message', seq: 4, time: 1025, data: { turn: 0, message: { content: [{ type: 'text', text: '重复锚点文本需要精确定位' }] } } },
    { type: 'turn/end', seq: 5, time: 1030, data: { turn: 0, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 6, time: 2000, data: { turn: 1 } },
    { type: 'assistant/message', seq: 7, time: 2010, data: { turn: 1, message: { content: [{ type: 'text', text: '重复锚点文本需要精确定位，第二轮确认' }] } } },
    { type: 'turn/end', seq: 8, time: 2020, data: { turn: 1, reason: { kind: 'completed' } } },
  ];
  const service = new DshService({
    ctx: {
      sessions: {
        get: () => ({ id: 'p1-sess', header: { cwd: '/tmp/p1-proj', title: 'DSH P1 验收标题' }, snapshotEvents: () => locateEvents }),
      },
    },
    stateFile: path.join(dir, 'p1-state.json'),
    inspectGitFn: async () => ({ status: 'checked', hasRepository: false, hasRemote: false }),
    runAnalysis: async () => ({
      summary: '进行中',
      gitPush: { status: 'unknown', evidenceRefs: [] },
      tasks: [{ knownTaskId: null, title: '重构任务', summary: '执行重构', status: 'in_progress', evidenceRefs: ['u1'] }],
      removedTaskIds: [],
    }),
  });
  await service.start();
  t.after(() => service.stop());

  const byItemOnly = await service.locateTask('p1-sess', { itemId: 'seq-2', lang: 'zh' });
  assert.equal(byItemOnly.located, true);
  assert.equal(byItemOnly.locator, '准备环境并执行重构任务');

  const ambig = await service.locateTask('p1-sess', { locator: '重复锚点文本需要精确定位', lang: 'zh' });
  assert.equal(ambig.located, false);
  assert.equal(ambig.reason, 'ambiguous_source');

  const importedBlocked = await service.locateTask('p1-sess', { locator: '<EXTERNAL SESSION IMPORTED>', lang: 'zh' });
  assert.equal(importedBlocked.located, false);

  await service.analyzeAndWait('p1-sess', { lang: 'zh' });
  const payload1 = await service.sessionPayload('p1-sess', { lang: 'zh', includeGit: false });
  const payload2 = await service.sessionPayload('p1-sess', { lang: 'zh', includeGit: false });
  assert.equal(payload1.sidebarSession.title, 'DSH P1 验收标题');
  assert.equal(payload1.sidebarSession.updatedAt, payload2.sidebarSession.updatedAt);

  const okRpc = await service.handleRpc({ type: 'list', requestId: 'r-ok' });
  assert.equal(okRpc.protocolVersion, 1);
  const errRpc = await service.handleRpc({ type: 'unknown-op', requestId: 'r-err' });
  assert.equal(errRpc.protocolVersion, 1);
  assert.ok(errRpc.error);
});

test('Analysis model settings: 4.1 Flash + Low default, custom API models, reasoning efforts, persistence and Option A fallback', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-model-cfg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const flashReasoning = {
    efforts: [
      { id: 'off', name: 'Off', description: 'No thinking' },
      { id: 'low', name: 'Low', description: 'Balanced low latency' },
      { id: 'high', name: 'High', description: 'Deep thinking' },
      { id: 'max', name: 'Max', description: 'Max thinking' },
    ],
    defaultEffort: 'high',
  };

  let includeCustomProvider = true;
  let capturedCalls = [];
  const llm = {
    listProviders: () => [
      ...(includeCustomProvider ? [{ id: 'custom-openrouter', name: 'OpenRouter API' }] : []),
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'broken-provider', name: 'Broken Provider' },
      { id: 'deepseek-account', name: 'DeepSeek Account' },
    ],
    listModels: async providerId => {
      if (providerId === 'broken-provider') throw new Error('network error');
      if (providerId === 'deepseek-account') {
        return [
          { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
          { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
        ];
      }
      if (providerId === 'deepseek-official') {
        return [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }];
      }
      if (providerId === 'custom-openrouter' && includeCustomProvider) {
        return [
          { id: 'anthropic/claude-haiku', name: 'Claude Haiku (API)' },
          { id: 'openai/o4-mini', name: 'o4-mini (API)' },
        ];
      }
      return [];
    },
    resolveModelInfo: async (providerId, modelId) => {
      if (providerId === 'deepseek-account' || providerId === 'deepseek-official') {
        return { provider: providerId, id: modelId, name: modelId, reasoning: flashReasoning };
      }
      if (providerId === 'custom-openrouter' && modelId === 'openai/o4-mini') {
        return {
          provider: providerId,
          id: modelId,
          name: 'o4-mini (API)',
          reasoning: {
            efforts: [{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }],
            defaultEffort: 'medium',
          },
        };
      }
      // Custom non-reasoning model
      return { provider: providerId, id: modelId, name: 'Claude Haiku (API)' };
    },
    prepareCall: async (config, signal) => {
      if (signal?.aborted) throw new Error('aborted');
      capturedCalls.push({ ...config });
      return {
        config: { ...config },
        stream: async function* () {
          const text = JSON.stringify({
            summary: '完成模型验证',
            gitPush: { status: 'unknown', evidenceRefs: [] },
            tasks: [{ knownTaskId: null, title: '配置解析模型', summary: '配置验证', status: 'done', evidenceRefs: ['u1'] }],
            removedTaskIds: [],
          });
          yield { type: 'block-start', index: 0, blockType: 'text' };
          yield { type: 'text-delta', index: 0, text };
          yield { type: 'block-end', index: 0, block: { type: 'text', text } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };

  // 1. Discover catalog preserves DSH order, isolates broken provider, picks 4.1 flash + low as default
  const catalog = await discoverModelCatalog({ llm }, { lang: 'zh' });
  assert.deepEqual(catalog.groups.map(g => g.id), ['deepseek-account', 'deepseek-official', 'custom-openrouter']);
  assert.equal(catalog.groups[0].name, 'DeepSeek 账号');
  assert.equal(catalog.failures.length, 1);
  assert.equal(catalog.failures[0].id, 'broken-provider');
  assert.equal(catalog.defaultRoute.provider, 'deepseek-account');
  assert.equal(catalog.defaultRoute.model, 'deepseek-flash');
  assert.equal(catalog.defaultRoute.reasoningEffort, 'low');
  assert.equal(catalog.defaultRoute.isFlash, true);

  // 2. Default mode picks 4.1 Flash + Low even when active chat uses V4-Pro or reasoner
  const defaultRoute = await resolveDshModelRoute(
    { llm },
    { sessionRoute: { provider: 'deepseek-account', model: 'deepseek-v4-pro', reasoningEffort: 'max' } },
  );
  assert.deepEqual(defaultRoute, {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'low',
  });

  // 3. Default mode with custom effort override keeps 4.1 flash
  const defaultHighRoute = await resolveDshModelRoute(
    { llm },
    { analysisConfig: { mode: 'default', reasoningEffort: 'high' } },
  );
  assert.deepEqual(defaultHighRoute, {
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
  });

  // 4. Custom non-reasoning API model omits reasoningEffort cleanly
  const noThinkRoute = await resolveDshModelRoute(
    { llm },
    { analysisConfig: { mode: 'custom', provider: 'custom-openrouter', model: 'anthropic/claude-haiku', reasoningEffort: 'high' } },
  );
  assert.deepEqual(noThinkRoute, {
    provider: 'custom-openrouter',
    model: 'anthropic/claude-haiku',
  });

  // 5. DshService endpoints GET/POST + RPC + persistence + Option A fallback when saved model disappears
  const events = makeSampleEvents();
  const service = new DshService({
    ctx: {
      llm,
      sessions: {
        get: () => ({ id: 'cfg-sess', header: { cwd: '/tmp/cfg-proj' }, snapshotEvents: () => events }),
      },
    },
    stateFile: path.join(dir, 'state.json'),
    inspectGitFn: async () => ({ status: 'checked', hasRepository: false, hasRemote: false }),
  });
  await service.start();
  t.after(() => service.stop());

  const getInitial = await service.handleFetch(new Request('http://localhost/api/agent-things/analysis-config'));
  assert.equal(getInitial.status, 200);
  const initialJson = await getInitial.json();
  assert.equal(initialJson.config.mode, 'default');
  assert.equal(initialJson.availability.savedAvailable, true);
  assert.equal(initialJson.catalog.defaultRoute.model, 'deepseek-flash');
  assert.equal(initialJson.catalog.defaultRoute.reasoningEffort, 'low');

  // Invalid reasoning effort rejected cleanly
  const badSave = await service.handleFetch(new Request('http://localhost/api/agent-things/analysis-config', {
    method: 'POST',
    body: JSON.stringify({ mode: 'custom', provider: 'custom-openrouter', model: 'openai/o4-mini', reasoningEffort: 'max' }),
  }));
  assert.equal(badSave.status, 400);

  // Save valid custom third-party API model + medium reasoning effort
  const goodSave = await service.handleFetch(new Request('http://localhost/api/agent-things/analysis-config', {
    method: 'POST',
    body: JSON.stringify({ mode: 'custom', provider: 'custom-openrouter', model: 'openai/o4-mini', reasoningEffort: 'medium' }),
  }));
  assert.equal(goodSave.status, 200);
  const savedJson = await goodSave.json();
  assert.equal(savedJson.config.mode, 'custom');
  assert.equal(savedJson.config.provider, 'custom-openrouter');
  assert.equal(savedJson.config.model, 'openai/o4-mini');
  assert.equal(savedJson.config.reasoningEffort, 'medium');
  assert.equal(readAnalysisConfig(service.analysisConfigFile).model, 'openai/o4-mini');

  await service.analyzeAndWait('cfg-sess', { lang: 'zh' });
  assert.deepEqual(capturedCalls.at(-1), { provider: 'custom-openrouter', model: 'openai/o4-mini', reasoningEffort: 'medium' });

  // Remove custom provider -> UI reports unavailable + fallbackRoute, analysis falls back gracefully to 4.1 flash + low!
  includeCustomProvider = false;
  const getAfterRemoval = await service.handleFetch(new Request('http://localhost/api/agent-things/analysis-config'));
  const removedJson = await getAfterRemoval.json();
  assert.equal(removedJson.availability.savedAvailable, false);
  assert.equal(removedJson.availability.fallbackRoute.model, 'deepseek-flash');
  assert.equal(removedJson.availability.fallbackRoute.reasoningEffort, 'low');

  const fbDetail = await resolveAnalysisRouteDetail(
    { llm },
    { analysisConfig: readAnalysisConfig(service.analysisConfigFile) },
  );
  assert.equal(fbDetail.source, 'default-flash');
  assert.deepEqual(fbDetail.fallbackFrom, { provider: 'custom-openrouter', model: 'openai/o4-mini', reason: 'model_unavailable' });
  assert.deepEqual(fbDetail.route, { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'low' });

  // Reset to default via RPC
  const resetRpc = await service.handleRpc({ type: 'analysis-config-save', config: { mode: 'default', reasoningEffort: null }, requestId: 'ac-1' });
  assert.equal(resetRpc.config.mode, 'default');
  assert.equal(resetRpc.config.reasoningEffort, null);
  writeAnalysisConfig(service.analysisConfigFile, { mode: 'default', reasoningEffort: 'off' });
  const rpcGet = await service.handleRpc({ type: 'analysis-config-get', requestId: 'ac-2' });
  assert.equal(rpcGet.config.reasoningEffort, 'off');
});
