'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeLocalSource } = require('../src/harnesses/claude/claude-local-source.cjs');
const { ClaudeService } = require('../src/harnesses/claude/claude-service.cjs');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'things-inline-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, 'Library/Application Support/Claude/claude-code-sessions/account/org');
  fs.mkdirSync(directory, { recursive: true });
  const session = { sessionId: 'local_desktop', cliSessionId: 'c46bc9f2-0866-487b-a2e9-afef9c5af105', priorCliSessionIds: ['previous-cli'], cwd: home, title: '当前会话' };
  fs.writeFileSync(path.join(directory, 'local_desktop.json'), JSON.stringify(session));
  return { home, session, source: new ClaudeLocalSource({ home }) };
}
test('CLI identity and prior IDs resolve to the same Desktop ledger without debugger jobs', async t => {
  const { home, session, source } = fixture(t);
  assert.equal(source.resolve(session.cliSessionId).sessionId, session.sessionId);
  assert.equal(source.resolve('previous-cli').sessionId, session.sessionId);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), port: 0, localSource: source });
  const key = JSON.stringify(['local', session.sessionId]);
  service.store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 58, note: '已有记录' }, projectPath: home });
  const progress = await service.tools('get_session_progress', { conversation_id: session.cliSessionId });
  assert.equal(progress.progress, 58); assert.equal(progress.key, key); assert.equal(service.jobs.size, 0);
  service.store.update({ key, expectedRevision: progress.revision, record: null });
  assert.equal((await service.tools('get_session_progress', { conversation_id: session.cliSessionId })).cleared, true);
});
test('inline HTTP reads, writes and clears the existing ledger with revision conflicts preserved', async t => {
  const { home, session, source } = fixture(t);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), port: 0, localSource: source });
  await service.start(); t.after(() => service.stop());
  const url = `http://127.0.0.1:${service.http.credentials.port}/inline`;
  const headers = { Authorization: `Bearer ${service.http.credentials.token}`, 'Content-Type': 'application/json' };
  const call = async fields => { const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ sessionId: session.cliSessionId, requestId: 'inline-test', ...fields }) }); return { status: response.status, body: await response.json() }; };
  const first = await call({ action: 'read' }); assert.equal(first.body.record, null);
  const saved = await call({ action: 'save', expectedRevision: 0, record: { state: 'unfinished', progress: 75, note: '保存草稿' } });
  assert.equal(saved.body.record.progress, 75);
  const conflict = await call({ action: 'clear', expectedRevision: 0 }); assert.equal(conflict.status, 409);
  assert.equal(conflict.body.errorInfo.code, 'REVISION_CONFLICT');
  assert.match(conflict.body.error, /其他窗口/);
  const cleared = await call({ action: 'clear', expectedRevision: saved.body.record.revision });
  assert.equal(cleared.body.record.state, null); assert.equal(service.jobs.size, 0);
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
});
test('source excerpt is read by stable item ID from the local file without retaining tools', async t => {
  const { home, session, source } = fixture(t);
  const directory = path.join(home, '.claude/projects/project'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, session.cliSessionId + '.jsonl'), [
    { uuid: 'tool', type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(2000000) }] } },
    { uuid: 'u1', type: 'user', timestamp: '2026-11-07T01:00:00Z', message: { content: '来源的完整原文在这里' } },
  ].map(entry => JSON.stringify(entry)).join('\n'));
  assert.equal((await source.message(session, 'u1')).text, '来源的完整原文在这里');
  assert.equal(await source.message(session, 'tool'), null);
});
test('local analysis snapshots retain earlier messages across parent-chain gaps and ignore a partial trailing write', async t => {
  const { home, session, source } = fixture(t);
  const directory = path.join(home, '.claude/projects/project'); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, session.cliSessionId + '.jsonl');
  const entries = [
    { uuid: 'u1', type: 'user', parentUuid: null, message: { content: '早先确认的任务' } },
    { uuid: 'a1', type: 'assistant', parentUuid: 'u1', message: { stop_reason: 'end_turn', content: '早先任务已经完成' } },
    { uuid: 'u2', type: 'user', parentUuid: 'trimmed-parent', message: { content: '继续当前任务' } },
    { uuid: 'tool', type: 'user', parentUuid: 'u2', message: { content: [{ type: 'tool_result', content: 'x'.repeat(2000000) }] } },
    { uuid: 'side', type: 'user', isSidechain: true, message: { content: '其他分支' } },
    { uuid: 'a2', type: 'assistant', parentUuid: 'tool', message: { stop_reason: 'end_turn', content: '当前任务完成' } },
  ];
  fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n{"type":');
  const server = source.server();
  const latest = await server.request('thread/turns/list', { threadId: session.sessionId, sortDirection: 'desc', limit: 1 });
  assert.equal(latest.data[0].id, 'u2');
  fs.appendFileSync(file, '"user"}\n' + JSON.stringify({ uuid: 'new', type: 'user', message: { content: '后来新增' } }));
  const all = await server.request('thread/turns/list', { threadId: session.sessionId, limit: 100 });
  assert.deepEqual(all.data.map(turn => turn.id), ['u1', 'u2']);
  assert.deepEqual(all.data[1].items.map(item => item.id), ['u2', 'a2']);
  assert.ok(Buffer.byteLength(JSON.stringify(all)) < 2000);
  await server.close();
});
test('inline automatic analysis finishes through local history with no debugger connection', async t => {
  const { home, session, source } = fixture(t);
  const directory = path.join(home, '.claude/projects/project'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, session.cliSessionId + '.jsonl'), [
    { uuid: 'u1', type: 'user', message: { content: '完成当前会话的测试任务' } },
    { uuid: 'a1', type: 'assistant', message: { stop_reason: 'end_turn', content: '测试任务已经完成并验证' } },
  ].map(entry => JSON.stringify(entry)).join('\n'));
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), localSource: source,
    run: async ({ input }) => ({ summary: '测试任务完成', tasks: [{ knownTaskId: null, title: '完成测试任务', summary: '完成测试任务', status: 'done', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] }) });
  t.after(() => service.stop());
  await service.inline({ action: 'analyze', sessionId: session.cliSessionId, requestId: 'analysis' });
  await [...service.analysis.active.values()][0].promise;
  const result = await service.tools('get_session_progress', { conversation_id: session.cliSessionId });
  assert.equal(result.progress, 100); assert.equal(result.totalTasks, 1); assert.equal(service.jobs.size, 0);
});

test('sidebar and inline navigation share a verified source and never rewrite the ledger', async t => {
  const { home, session, source } = fixture(t);
  const directory = path.join(home, '.claude/projects/project'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, session.cliSessionId + '.jsonl'), JSON.stringify({ uuid: 'u1', type: 'user', message: { content: '消息来源原文' } })+'\n');
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), localSource: source });
  const calls = [];
  service.requestHost = async (...args) => { calls.push(args); return { located: true }; };
  service.store.getProgress = () => ({ tasks: [{ id: 'task1', source: { itemId: 'u1' } }] });
  const key = JSON.stringify(['local', session.sessionId]), before = service.store.snapshot().revision;
  const sidebar = await service.rpc({ type: 'locate-source', key, source: { itemId: 'u1' }, requestId: 'sidebar-test' });
  const inline = await service.inline({ action: 'locate', sessionId: session.cliSessionId, taskId: 'task1', requestId: 'inline-test' });
  assert.equal(sidebar.navigation.located, true); assert.equal(inline.navigation.located, true);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], ['locate', session.sessionId, { itemId: 'u1' }]);
  assert.equal(service.store.snapshot().revision, before);
  const invalid = await service.rpc({ type: 'locate-source', key, source: { itemId: 'absent' }, requestId: 'invalid' });
  assert.match(invalid.error, /未找到来源/); assert.equal(calls.length, 2);
});

test('sidebar open-in-pane request reaches the session mod once and other actions do not consume it', async t => {
  const { home, session, source } = fixture(t);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), localSource: source });
  t.after(() => service.stop());
  const key = JSON.stringify(['local', session.sessionId]);
  assert.equal((await service.inline({ action: 'pane-poll', sessionId: session.cliSessionId })).paneRequested, false);
  const pending = service.rpc({ type: 'open-pane', key, requestId: 'open-pane' });
  await service.inline({ action: 'update-info', sessionId: session.cliSessionId, requestId: 'u' }).catch(() => {});
  assert.equal((await service.inline({ action: 'pane-poll', sessionId: session.cliSessionId })).paneRequested, true);
  const reply = await pending;
  assert.equal(reply.error, null); assert.deepEqual(reply.pane, { delivered: true });
  assert.equal((await service.inline({ action: 'pane-poll', sessionId: session.cliSessionId })).paneRequested, false);
  const second = service.rpc({ type: 'open-pane', key, requestId: 'open-pane-2' });
  assert.equal((await service.inline({ action: 'read', sessionId: session.cliSessionId })).paneRequested, true);
  assert.deepEqual((await second).pane, { delivered: true });
  const unanswered = await service.deliverPane(key, 30);
  assert.equal(unanswered, false);
  assert.equal(service.takePaneRequest(key), true, 'an undelivered request stays available for a session that starts later');
  const invalid = await service.rpc({ type: 'open-pane', key: JSON.stringify(['remote', 'x']), requestId: 'bad' });
  assert.match(invalid.error, /无效/);
});

test('a waiting session mod is woken at once by the sidebar request and times out quietly otherwise', async t => {
  const { home, session, source } = fixture(t);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), localSource: source });
  t.after(() => service.stop());
  const key = JSON.stringify(['local', session.sessionId]);
  const started = Date.now();
  const waiting = service.inline({ action: 'pane-wait', sessionId: session.cliSessionId, waitMs: 5000 });
  await new Promise(resolve => setTimeout(resolve, 20));
  const woke = await service.rpc({ type: 'open-pane', key, requestId: 'wake' });
  assert.deepEqual(woke.pane, { delivered: true });
  assert.equal((await waiting).paneRequested, true);
  assert.ok(Date.now() - started < 1000);
  assert.equal(service.paneRequests.size, 0);
  assert.equal((await service.inline({ action: 'pane-wait', sessionId: session.cliSessionId, waitMs: 30 })).paneRequested, false);
  assert.equal(service.paneWaiters.size, 0);
});

function twoSessions(t) {
  const base = fixture(t);
  const directory = path.join(base.home, 'Library/Application Support/Claude/claude-code-sessions/account/org');
  const other = { sessionId: 'local_other', cliSessionId: '0b5f6a1e-0000-4000-8000-000000000002', cwd: base.home, title: '另一会话' };
  fs.writeFileSync(path.join(directory, 'local_other.json'), JSON.stringify(other));
  return { ...base, other, source: new ClaudeLocalSource({ home: base.home }) };
}

test('watch wakes only the changed session over real HTTP and stays quiet for another session', async t => {
  const { home, session, other, source } = twoSessions(t);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), port: 0, localSource: source });
  await service.start(); t.after(() => service.stop());
  const url = `http://127.0.0.1:${service.http.credentials.port}/inline`;
  const headers = { Authorization: `Bearer ${service.http.credentials.token}`, 'Content-Type': 'application/json' };
  const call = async (sessionId, fields) => (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ sessionId, requestId: 'w', ...fields }) })).json();
  const since = (await call(session.cliSessionId, { action: 'read' })).revision;
  const mine = call(session.cliSessionId, { action: 'watch', since, waitMs: 5000 });
  const theirs = call(other.cliSessionId, { action: 'watch', since, waitMs: 400 });
  await new Promise(resolve => setTimeout(resolve, 30));
  const started = Date.now();
  await call(session.cliSessionId, { action: 'save', expectedRevision: 0, record: { state: 'unfinished', progress: 40, note: '甲入口保存' } });
  const woke = await mine;
  assert.equal(woke.changed, true); assert.ok(Date.now() - started < 500, `woke after ${Date.now() - started}ms`);
  assert.deepEqual(await theirs, { changed: false, paneRequested: false, revision: woke.revision });
  const after = await call(session.cliSessionId, { action: 'read' });
  assert.equal(after.record.note, '甲入口保存');
  // 已读到最新后再等：不应立即返回。
  assert.equal((await call(session.cliSessionId, { action: 'watch', since: after.revision, waitMs: 50 })).changed, false);
});

test('watch wakes on clear, analysis start and failure, and on a sidebar pane request', async t => {
  const { home, session, source } = fixture(t);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), localSource: source,
    run: async () => { await new Promise(resolve => setTimeout(resolve, 60)); throw new Error('模型暂不可用'); } });
  service.startWatching(); t.after(() => service.stop());
  const key = JSON.stringify(['local', session.sessionId]);
  const read = () => service.inline({ action: 'read', sessionId: session.cliSessionId });
  const watch = since => service.inline({ action: 'watch', sessionId: session.cliSessionId, since, waitMs: 3000 });
  service.store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 20, note: '' } });
  let since = (await read()).revision;
  let pending = watch(since);
  await service.inline({ action: 'clear', sessionId: session.cliSessionId, expectedRevision: since, requestId: 'c' });
  assert.equal((await pending).changed, true);
  since = (await read()).revision;
  pending = watch(since);
  await service.inline({ action: 'analyze', sessionId: session.cliSessionId, requestId: 'a' });
  assert.equal((await pending).changed, true, 'analysis start');
  since = (await read()).revision;
  pending = watch(since);
  await [...service.analysis.active.values()][0]?.promise.catch(() => {});
  assert.equal((await pending).changed, true, 'analysis failure');
  const failed = await read();
  assert.equal(failed.timeline.at(-1).status, 'failed');
  pending = watch(failed.revision);
  assert.deepEqual(await service.rpc({ type: 'open-pane', key, requestId: 'p' }).then(reply => reply.pane), { delivered: true });
  assert.equal((await pending).paneRequested, true);
});

test('after a background restart a reconnecting entry is told to re-read once', async t => {
  const { home, session, source } = fixture(t);
  const stateFile = path.join(home, 'state.json');
  const first = new ClaudeService({ stateFile, localSource: source }); first.startWatching();
  const key = JSON.stringify(['local', session.sessionId]);
  const before = (await first.inline({ action: 'read', sessionId: session.cliSessionId })).revision;
  await first.stop();
  first.store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 64, note: '重启期间写入' } });
  const second = new ClaudeService({ stateFile, localSource: source }); second.startWatching(); t.after(() => second.stop());
  assert.equal((await second.inline({ action: 'watch', sessionId: session.cliSessionId, since: before, waitMs: 2000 })).changed, true);
  const latest = await second.inline({ action: 'read', sessionId: session.cliSessionId });
  assert.equal(latest.record.progress, 64);
  assert.equal((await second.inline({ action: 'watch', sessionId: session.cliSessionId, since: latest.revision, waitMs: 50 })).changed, false);
});

test('snapshot carries per-session versions so the sidebar popover can re-read task-only changes', async t => {
  const { home, session, other, source } = twoSessions(t);
  const service = new ClaudeService({ stateFile: path.join(home, 'state.json'), localSource: source });
  service.startWatching(); t.after(() => service.stop());
  const key = JSON.stringify(['local', session.sessionId]), otherKey = JSON.stringify(['local', other.sessionId]);
  const base = service.syncSnapshot();
  assert.equal(base.keyVersionBase, base.revision); assert.deepEqual(base.keyVersions, {});
  service.store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 30, note: '' } });
  const after = service.syncSnapshot();
  assert.equal(after.keyVersions[key], after.revision);
  assert.equal(after.keyVersions[otherKey], undefined, 'the other session keeps its version');
});
