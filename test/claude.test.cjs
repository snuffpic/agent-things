'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transcriptTurns, pageClaudeTurns, ClaudeTranscriptServer } = require('../src/harnesses/claude/claude-source.cjs');
const { ClaudeService } = require('../src/harnesses/claude/claude-service.cjs');
const { inspectorOwner, ClaudeInjector } = require('../src/harnesses/claude/claude-injector.cjs');
const { installClaudeMcp, disableClaudeMcp } = require('../src/claude-mcp-config.cjs');
const { runClaudeAnalysis } = require('../src/harnesses/claude/claude-runner.cjs');

const transcript = [
  { uuid: 'u1', type: 'user', timestamp: '2026-11-06T01:00:00Z', message: { content: '实现侧栏圆环' } },
  { uuid: 'thinking', type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private reasoning' }] } },
  { uuid: 'tool', type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: '检查中' }, { type: 'tool_use', name: 'Read' }] } },
  { uuid: 'result', type: 'user', message: { content: [{ type: 'tool_result', content: 'large result' }] } },
  { uuid: 'a1', type: 'assistant', timestamp: '2026-11-06T01:00:01Z', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '圆环实现完成' }] } },
  { uuid: 'side', type: 'user', isSidechain: true, message: { content: '子任务' } },
  { uuid: 'u2', type: 'user', message: { content: [{ type: 'image', source: {} }, { type: 'text', text: '继续验收' }] } },
];

test('Claude cleaning retains stable user/final-answer identities and timestamps', () => {
  const turns = transcriptTurns({ messages: transcript });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0].items.map(item => item.id), ['u1', 'a1']);
  assert.equal(turns[0].completedAt, '2026-11-06T01:00:01Z');
  assert.equal(turns[1].items[0].content[0].text, '继续验收');
  assert.throws(() => transcriptTurns({ unsupported: [] }), /格式/);
  assert.throws(() => transcriptTurns([{ type: 'user', message: { content: '任务' } }]), /稳定身份/);
});

test('Claude source uses the same host snapshot across pages', async () => {
  const snapshots = [];
  const source = new ClaudeTranscriptServer(async (method, id, options) => {
    assert.equal(method, 'turns'); assert.equal(id, 'local_1'); snapshots.push(options.snapshotId);
    return pageClaudeTurns(transcriptTurns(transcript), options);
  });
  const first = await source.request('thread/turns/list', { threadId: 'local_1', limit: 1 });
  const second = await source.request('thread/turns/list', { threadId: 'local_1', limit: 1, cursor: first.nextCursor });
  assert.equal(first.data[0].id, 'u1'); assert.equal(second.data[0].id, 'u2'); assert.equal(snapshots[0], snapshots[1]);
  await assert.rejects(source.request('thread/turns/list', { threadId: 'local_1', cursor: 'missing' }), /分页/);
});

test('Claude cleans large tool results before transport and bounds transcript pages by bytes', () => {
  const raw = [...transcript, { uuid: 'big-tool', type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(2000000) }] } }];
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) > 1000000);
  assert.ok(Buffer.byteLength(JSON.stringify(pageClaudeTurns(transcriptTurns(raw)))) < 10000);
  const messages = Array.from({ length: 20 }, (_, i) => ({ uuid: `u${i}`, type: 'user', message: { content: '文'.repeat(30000) } }));
  const turns = transcriptTurns(messages);
  let cursor = null, count = 0;
  do {
    const page = pageClaudeTurns(turns, { cursor });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 500000);
    count += page.data.length; cursor = page.nextCursor;
  } while (cursor);
  assert.equal(count, 20);
});

test('Claude service keeps Desktop identity, revisions and clear semantics through HTTP/MCP', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-service-test-'));
  const service = new ClaudeService({ port: 0, stateFile: path.join(directory, 'state.json'), host: async (method, id) => {
    if (method === 'identity') return id === 'cli-1' ? { id: 'local_desktop-1' } : null;
    return { cwd: null };
  } });
  await service.start();
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const key = JSON.stringify(['local', 'local_desktop-1']);
  const result = await service.rpc({ type: 'update', requestId: '1', key, expectedRevision: 0, record: { state: 'unfinished', progress: 50, note: '剩余验收' } });
  assert.equal(result.error, null);
  const progress = await service.tools('get_session_progress', { conversation_id: 'cli-1' });
  assert.equal(progress.key, key); assert.equal(progress.progress, 50);
  await assert.rejects(service.tools('get_session_progress', { conversation_id: 'unmapped-cli' }), /无法匹配/);
  const conflict = await service.rpc({ type: 'update', requestId: '2', key, expectedRevision: 0, record: null });
  assert.match(conflict.error, /其他窗口/);
  const pushed = await service.rpc({ type: 'update', requestId: '3', key, expectedRevision: progress.revision, record: { state: 'pushed', progress: 100, note: '' } });
  assert.match(pushed.error, /Git 远端/);
  const cleared = await service.tools('clear_session_progress', { conversation_id: key, expected_revision: progress.revision });
  assert.equal(cleared.cleared, true);
  assert.equal((await service.tools('get_session_progress', { conversation_id: key })).cleared, true);
  const url = `http://127.0.0.1:${service.http.credentials.port}`;
  assert.equal((await fetch(`${url}/snapshot`)).status, 401);
});

test('Claude host jobs correlate replies and reject outstanding work on service stop', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-host-jobs-'));
  const service = new ClaudeService({ port: 0, stateFile: path.join(directory, 'state.json') });
  await service.start();
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const url = `http://127.0.0.1:${service.http.credentials.port}`;
  const headers = { Authorization: `Bearer ${service.http.credentials.token}`, 'Content-Type': 'application/json' };
  const reply = service.requestHost('session', 'local_1');
  const jobs = await (await fetch(`${url}/host-jobs`, { headers })).json();
  assert.equal(jobs.length, 1); assert.equal(jobs[0].threadId, 'local_1');
  await fetch(`${url}/host-reply`, { method: 'POST', headers, body: JSON.stringify({ id: jobs[0].id, result: { cwd: '/tmp/project' } }) });
  assert.deepEqual(await reply, { cwd: '/tmp/project' });
  const pending = service.requestHost('transcript', 'local_2');
  const rejected = assert.rejects(pending, /已停止/);
  await service.stop(); await rejected;
});

test('Claude MCP registration preserves unrelated settings and refuses an occupied name', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-mcp-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'other' } } }));
  installClaudeMcp({ file, scriptPath: '/test/bin/claude-session-status.cjs' });
  assert.equal(JSON.parse(fs.readFileSync(file)).theme, 'dark');
  disableClaudeMcp({ file });
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).mcpServers, { other: { command: 'other' } });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { session_status: { command: 'foreign' } } }));
  assert.throws(() => installClaudeMcp({ file, scriptPath: '/test/bin/claude-session-status.cjs' }), /已存在其他/);
  assert.equal(disableClaudeMcp({ file }).removed, false);
  assert.equal(JSON.parse(fs.readFileSync(file)).mcpServers.session_status.command, 'foreign');
});

test('Inspector ownership rejects a foreign listener before contacting its endpoint', async () => {
  let signatureChecked = false;
  await assert.rejects(inspectorOwner({ execute: async (command) => {
    if (command.endsWith('lsof')) return { stdout: '123\n' };
    if (command.endsWith('/ps')) return { stdout: `${process.getuid()} /Applications/Other.app/Contents/MacOS/Other\n` };
    signatureChecked = true; return { stdout: '' };
  } }), /其他进程/);
  assert.equal(signatureChecked, false);
});

test('attached Claude uses its heartbeat without repeatedly spawning native processes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-heartbeat-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'attachment-host.json'), JSON.stringify({ pid: 123, checkedAt: Date.now(), views: [{ mounted: 4 }], error: null }));
  const injector = new ClaudeInjector({ stateFile: path.join(directory, 'state.json'), run: async () => { throw new Error('Unexpected subprocess'); } });
  injector.attachedPid = 123;
  assert.deepEqual(await injector.scan(), { state: 'attached', pid: 123, mounted: 4 });
});

test('a replacement daemon adopts the live Claude host without reopening the debugger', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-adopt-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'attachment-host.json'), JSON.stringify({ pid: 123, checkedAt: Date.now(), views: [{ mounted: 9 }] }));
  const calls = [];
  const injector = new ClaudeInjector({ stateFile: path.join(directory, 'state.json'), run: async command => {
    calls.push(command);
    if (command.endsWith('/ps')) return { stdout: `${process.getuid()} /Applications/Claude.app/Contents/MacOS/Claude\n` };
    if (command.endsWith('/codesign')) return { stdout: '' };
    throw new Error('Unexpected debugger or menu access');
  } });
  assert.deepEqual(await injector.scan(), { state: 'attached', pid: 123, mounted: 9 });
  await injector.scan(); assert.equal(calls.length, 2);
});

test('Claude analysis subprocess sends input on stdin with tool isolation and parses structured output', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-runner-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'fake-claude');
  fs.writeFileSync(binary, `#!${process.execPath}\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.stringify({structured_output:{args:process.argv.slice(2),input:JSON.parse(input),nested:process.env.CLAUDECODE}})));`, { mode: 0o700 });
  const result = await runClaudeAnalysis({ binary, input: { events: ['任务'] }, prompt: '分析', schema: { type: 'object' } });
  assert.deepEqual(result.input.events, ['任务']);
  assert.equal(result.args[result.args.indexOf('--tools') + 1], '');
  assert.ok(result.args.includes('--strict-mcp-config'));
  assert.ok(result.args.includes('--no-session-persistence'));
  assert.equal(result.nested, '');
});

test('Claude analysis timeout terminates its own subprocess', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-timeout-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'fake-claude');
  fs.writeFileSync(binary, `#!${process.execPath}\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);`, { mode: 0o700 });
  await assert.rejects(runClaudeAnalysis({ binary, input: {}, prompt: '', schema: {}, timeoutMs: 150 }), /超时/);
});

test('closing a Claude panel does not cancel analysis and later manual marks remain current', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-analysis-test-'));
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const service = new ClaudeService({ port: 0, stateFile: path.join(directory, 'state.json'),
    host: async (method, id, options) => method === 'turns' ? pageClaudeTurns(transcriptTurns(transcript), options) : { cwd: null },
    run: async ({ input }) => {
      started(); await new Promise(resolve => { release = resolve; });
      return { summary: '已实现，剩余验收', tasks: [{ knownTaskId: null, title: '实现侧栏圆环', summary: '实现侧栏圆环', status: 'done', evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] };
    } });
  await service.start();
  t.after(async () => { release?.(); await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const key = JSON.stringify(['local', 'local_desktop-1']);
  const reply = await service.rpc({ type: 'analyze', key, requestId: 'analysis' });
  assert.equal(reply.error, null); await began;
  await service.rpc({ type: 'panel-event', action: 'close', key, requestId: 'closed' });
  const manual = await service.rpc({ type: 'update', key, requestId: 'manual', expectedRevision: 0, record: { state: 'unfinished', progress: 50, note: '用户手动记录' } });
  assert.equal(manual.error, null);
  const active = [...service.analysis.active.values()][0];
  release(); await active.promise;
  assert.equal(service.store.snapshot().records[key].progress, 50);
  assert.equal(service.store.snapshot().records[key].source, 'manual');
  assert.equal(service.store.analysisState(key).analysis.ledger.tasks.length, 1);
});

test('Claude transcript sanitization drops isMeta, strips multi-part reminders, cleans compact summaries, and avoids phantom turns', () => {
  const mixed = [
    {
      uuid: 'compact-1',
      type: 'user',
      isCompactSummary: true,
      message: {
        content: 'This session is being continued from a previous conversation that ran out of context.\n\n<system-reminder>\n<tools-used-before-summary>Read, Bash</tools-used-before-summary>\n</system-reminder>\nSummary:\n1. Primary Request: 实现干净任务标题。\n\nIf you need specific details from before compaction, read the full transcript at: /tmp/secret.jsonl\nContinue the conversation from where it left off without asking the user.',
      },
    },
    { uuid: 'meta-1', type: 'user', isMeta: true, message: { content: '<system-reminder>hidden meta reminder</system-reminder>' } },
    { uuid: 'cmd-1', type: 'user', message: { content: '<command-name>/reload-plugins</command-name>' } },
    { uuid: 'notif-1', type: 'user', message: { content: '<task-notification><task-id>t1</task-id></task-notification>' } },
    {
      uuid: 'real-u1',
      type: 'user',
      message: {
        content: [
          { type: 'text', text: '<system-reminder>\nThe session "子任务" finished.\n</system-reminder>' },
          { type: 'text', text: '按新方案修复标题和清洗逻辑' },
        ],
      },
    },
    { uuid: 'real-a1', type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '已完成修复' }] } },
  ];
  const turns = transcriptTurns(mixed);
  assert.equal(turns.length, 2);
  const summaryText = turns[0].items[0].content[0].text;
  assert.match(summaryText, /^\[前情摘要\]\nSummary:/);
  assert.doesNotMatch(summaryText, /tools-used-before-summary|secret\.jsonl|Continue the conversation/);
  assert.equal(turns[1].items[0].content[0].text, '按新方案修复标题和清洗逻辑');
  assert.equal(turns[1].items[1].text, '已完成修复');
});
