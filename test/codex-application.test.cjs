'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { CodexService } = require('../src/harnesses/codex/codex-service.cjs');
const { createCodexCard } = require('../src/harnesses/codex/codex-card.cjs');
const { AnalysisService } = require('../src/analysis-service.cjs');
const { createCodexProgressContext } = require('../src/harnesses/codex/codex-progress-context.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-app-'));
  const store = new ManualStatusStore(path.join(dir, 'manual-state.json'));
  const service = new CodexService({ store });
  t.after(async () => { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, service };
}

test('a card analysis belongs to the backend and survives a real MCP client disconnect and reconnect', async t => {
  const { dir, store, service } = fixture(t);
  await service.startControl();
  fs.writeFileSync(path.join(dir, 'agent.lock'), String(process.pid));
  let resolveModel, notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const turn = { id: 'turn-one', status: 'completed', items: [{ id: 'user-one', type: 'userMessage', content: [{ type: 'text', text: '完成验证任务' }] }] };
  service.analysisService = new AnalysisService({ store,
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async () => ({ data: [turn], nextCursor: null }) }),
    run: ({ input }) => new Promise(resolve => {
      resolveModel = () => resolve({ summary: '验证完成', tasks: [{ knownTaskId: null, title: '验证任务', status: 'done', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] });
      notifyStarted();
    }),
  });
  const id = '11111111-2222-4333-8444-555555555555';
  for (let i = 0; i < 2; i++) {
    const child = spawn(process.execPath, [path.join(__dirname, '../bin/codex-session-status.cjs'), 'mcp', '--data-dir', dir, '--port', '39998'], { stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
    let buffer = '', serial = 0;
    const pending = new Map();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        pending.get(reply.id)?.(reply.result); pending.delete(reply.id);
      }
    });
    const call = (name, args) => new Promise(resolve => {
      const requestId = ++serial; pending.set(requestId, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } }) + '\n');
    });
    const opened = await call('open_session_card', { conversation_id: id });
    if (i === 0) {
      const reply = await call('change_session_card', { conversation_id: id, card_token: opened._meta.cardToken, action: 'analyze' });
      assert.equal(reply.isError, undefined);
      await started;
    } else {
      assert.equal(opened.structuredContent.analysisState.timeline.at(-1).status, 'pending');
    }
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.stdin.end(); await exited;
    assert.equal(service.analysisService.active.size, 1);
    assert.equal(store.analysisState(store.resolveKey(id)).timeline.at(-1).status, 'pending');
  }
  const finished = [...service.analysisService.active.values()][0].promise;
  resolveModel(); await finished;
  assert.equal(store.getProgress(id).progress, 100);
  assert.equal(store.getProgress(id).completedTasks, 1);
});

test('card navigation retains message identity and is restricted to saved evidence in its own session', async t => {
  const { store, service } = fixture(t);
  await service.startControl();
  const id = '11111111-2222-4333-8444-555555555555', key = store.resolveKey(id);
  const seq = store.beginAnalysis(key, null);
  store.finishAnalysis(key, seq, { ledger: { summary: '任务', tasks: [{ id: 'task', title: '验证来源', status: 'done', evidenceRefs: ['a1'] }] },
    sources: { a1: { threadId: 'untrusted-other-thread', turnId: 'turn-one', itemId: 'answer-one', locator: '已经完成任务实现与相关验证' } } });
  const card = createCodexCard({ store });
  t.after(() => card.stopEvents());
  const opened = await card.call('open_session_card', { conversation_id: id });
  assert.equal(opened.structuredContent.analysisState.analysis.sources.a1.itemId, 'answer-one');
  const session = { close() {} }; service.sessions.set('test', session);
  service.evaluate = async () => ({ result: { value: true } });
  let located;
  service.locateSource = async (_session, source) => { located = source; return { status: 'located', message: '已定位来源' }; };
  const args = { conversation_id: id, card_token: opened._meta.cardToken, action: 'locate-source' };
  await assert.rejects(card.call('change_session_card', { ...args, source: { turnId: 'other', itemId: 'other' } }), /不属于当前会话/);
  assert.equal(located, undefined);
  const reply = await card.call('change_session_card', { ...args, source: { turnId: 'turn-one', itemId: 'answer-one' } });
  assert.equal(reply.structuredContent.navigation.status, 'located');
  assert.equal(located.threadId, id);
});

test('metadata operations have one total deadline across initialization and the business RPC', async () => {
  let closed = false;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const context = createCodexProgressContext({ timeoutMs: 60, makeServer: () => ({
    initialize: () => delay(40), request: async () => { await delay(40); return {}; }, close: async () => { closed = true; },
  }) });
  const at = performance.now();
  await assert.rejects(context.projectGit('["local","local:thread"]'), { code: 'REQUEST_TIMEOUT' });
  assert.ok(performance.now() - at < 150);
  assert.equal(closed, true);
});


test('shared analysis requires explicit host adapters', () => {
  const store = { file: '/unused/state.json' };
  assert.throws(() => new AnalysisService({ store }), /需要会话源和模型执行器/);
  assert.throws(() => new AnalysisService({ store, makeServer: () => ({}) }), /需要会话源和模型执行器/);
});

test('an existing card uses rotated backend credentials after restart and sees interrupted analysis', async t => {
  const { store, service } = fixture(t);
  await service.startControl();
  const card = createCodexCard({ store });
  t.after(() => card.stopEvents());
  const id = '11111111-2222-4333-8444-555555555555';
  const opened = await card.call('open_session_card', { conversation_id: id });
  const args = { conversation_id: id, card_token: opened._meta.cardToken, action: 'update', expectedRevision: 0,
    record: { state: 'unfinished', progress: 30, note: '重启前' } };
  await card.call('change_session_card', args);
  const oldToken = service.control.credentials.token;
  store.beginAnalysis(store.resolveKey(id), null);
  await service.stop();
  const recovered = new ManualStatusStore(store.file);
  recovered.recoverPending();
  const next = new CodexService({ store: recovered });
  t.after(() => next.stop());
  await next.startControl();
  assert.notEqual(next.control.credentials.token, oldToken);
  const read = await card.call('read_session_card', { ...args, action: 'analysis-state' });
  assert.equal(read.structuredContent.analysisState.timeline.at(-1).status, 'failed');
  const reply = await card.call('change_session_card', { ...args, expectedRevision: read.structuredContent.snapshot.records[opened.structuredContent.key].revision,
    record: { state: 'unfinished', progress: 60, note: '重启后' } });
  assert.equal(reply.isError, undefined);
  assert.equal(recovered.getProgress(id).progress, 60);
});

test('closing a native popover cancels its read without touching analysis execution', async t => {
  const { store, service } = fixture(t), key = store.resolveKey('thread'), session = {};
  let reading;
  const started = new Promise(resolve => { reading = resolve; });
  service.progressContext.projectGit = (_key, { signal }) => new Promise((_, reject) => {
    reading(); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  service.evaluate = async () => ({ result: { value: null } });
  const request = service.handleMessage(session, JSON.stringify({ type: 'project-git', requestId: 'read', key }));
  await started;
  assert.equal(service.uiReads.get(session).size, 1);
  await service.handleMessage(session, JSON.stringify({ type: 'cancel-request', requestId: 'cancel', cancelRequestId: 'read' }));
  await request;
  assert.equal(service.uiReads.size, 0);
  assert.equal(store.analysisState(key).timeline.length, 0);
});

test('duplicate submissions share one analysis while another session can finish independently', async t => {
  const { store } = fixture(t), key = store.resolveKey('one'), other = store.resolveKey('two');
  const releases = [];
  let bothStarted;
  const started = new Promise(resolve => { bothStarted = resolve; });
  const service = new AnalysisService({ store,
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async () => ({ data: [{ id: 'turn', status: 'completed', items: [{ id: 'question', type: 'userMessage', content: [{ type: 'text', text: '完成当前任务' }] }] }], nextCursor: null }) }),
    run: ({ input }) => new Promise(resolve => {
      releases.push(() => resolve({ summary: '已完成', tasks: [{ knownTaskId: null, title: '当前任务', status: 'done', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] }));
      if (releases.length === 2) bothStarted();
    }),
  });
  const a = service.start(key), duplicate = service.start(key), b = service.start(other);
  assert.equal(duplicate.promise, a.promise); assert.equal(duplicate.actionSequence, a.actionSequence);
  await started;
  store.update({ key: other, expectedRevision: 0, record: { state: 'unfinished', progress: 40, note: '人工记录' } });
  releases.forEach(release => release()); await Promise.all([a.promise, b.promise]);
  assert.equal(store.getProgress(key).progress, 100);
  assert.equal(store.getProgress(other).progress, 40);
  assert.equal(store.getProgress(key).tasks.length, 1);
  assert.equal(store.getProgress(other).tasks.length, 1);
  assert.equal(service.active.size, 0);
});
