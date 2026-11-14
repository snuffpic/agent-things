'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { PassThrough } = require('node:stream');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { AntigravityTranscriptServer } = require('../src/harnesses/antigravity/transcript-source.cjs');
const { captureExtracted } = require('../src/analysis-source.cjs');
const { requestProgressHttp, MAX_BODY_BYTES } = require('../src/local-progress-http.cjs');
const { callProgressTool } = require('../src/progress-tools.cjs');
const { serveMcp } = require('../src/mcp-stdio.cjs');
const { filterSessionStatuses } = require('../src/session-status-filter.cjs');
const root = path.resolve(__dirname, '..');
const key = name => JSON.stringify(['local', 'local:' + name]);
const record = { state: 'unfinished', progress: 50, note: 'fixture' };
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-regression-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function exit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`child exited ${code}/${signal}`)));
  });
}

test('stale analysis writes preserve other-process manual updates and their action order', t => {
  const file = path.join(temporary(t), 'state.json');
  const a = new ManualStatusStore(file);
  const sequence = a.beginAnalysis(key('analysis'), null);
  const b = new ManualStatusStore(file);
  b.update({ key: key('manual'), expectedRevision: 0, record });
  a.updateAnalysis(key('analysis'), sequence, { stage: 'reading' });
  const saved = new ManualStatusStore(file).data;
  assert.equal(saved.records[key('manual')].progress, 50);
  assert.equal(saved.actionSequence, 2);
  assert.equal(saved.revision, 3);
});

test('competing processes serialize complete transactions without losing records', async t => {
  const file = path.join(temporary(t), 'state.json');
  const code = `const {ManualStatusStore}=require(process.argv[1]);const store=new ManualStatusStore(process.argv[2]);for(let i=0;i<15;i++)store.update({key:JSON.stringify(['local',process.argv[3]+i]),expectedRevision:0,record:{state:'unfinished',progress:50,note:''}});`;
  const children = ['a', 'b', 'c'].map(prefix => spawn(process.execPath, ['-e', code, path.join(root, 'src/manual-status-store.cjs'), file, prefix], { stdio: ['ignore', 'ignore', 'inherit'] }));
  await Promise.all(children.map(exit));
  const saved = new ManualStatusStore(file).data;
  assert.equal(Object.keys(saved.records).length, 45);
  assert.equal(saved.revision, 45);
  assert.equal(saved.actionSequence, 45);
});

test('corrupt reload blocks mutations and preserves the original file bytes', t => {
  const file = path.join(temporary(t), 'state.json');
  const store = new ManualStatusStore(file);
  store.update({ key: key('one'), expectedRevision: 0, record });
  fs.writeFileSync(file, '{broken');
  assert.throws(() => store.update({ key: key('two'), expectedRevision: 0, record }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('MCP task deltas retain milestones, update counts, and reject stale versions', async t => {
  const store = new ManualStatusStore(path.join(temporary(t), 'state.json'));
  const options = { projectGit: async () => ({ hasRemote: false }) };
  let result = await callProgressTool(store, 'update_session_tasks', { conversation_id: 'one', expected_revision: 0, summary: '两个任务', tasks: [
    { knownTaskId: null, title: '完成项', status: 'done' },
    { knownTaskId: null, title: '剩余项', status: 'todo' },
  ], removedTaskIds: [] }, options);
  assert.equal(result.progress, 50);
  const revision = result.revision;
  result = await callProgressTool(store, 'update_session_tasks', { conversation_id: 'one', expected_revision: revision, summary: '全部完成', tasks: [
    { knownTaskId: result.tasks[1].id, title: '剩余项', status: 'done' },
  ], removedTaskIds: [] }, options);
  assert.equal(result.progress, 100);
  assert.equal(result.remainingTasks, 0);
  assert.equal(result.tasks.length, 2);
  await assert.rejects(callProgressTool(store, 'update_session_tasks', { conversation_id: 'one', expected_revision: revision, summary: '', tasks: [], removedTaskIds: [] }, options), /其他窗口/);
  await assert.rejects(callProgressTool(store, 'update_session_progress', { conversation_id: 'one', state: 'pushed', progress: 100 }, options), /远端/);
});

test('authenticated HTTP rejects foreign origins, missing credentials and oversized requests', async t => {
  const file = path.join(temporary(t), 'state.json');
  const service = new AntigravityService({ port: 0, stateFile: file });
  await service.start();
  t.after(() => service.stop());
  const origin = `http://127.0.0.1:${service.port}`;
  assert.equal((await fetch(origin + '/snapshot')).status, 401);
  const headers = { Authorization: `Bearer ${service.http.credentials.token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(origin + '/snapshot', { headers: { ...headers, Origin: 'https://example.invalid' } })).status, 403);
  const hostOrigin = 'https://127.0.0.1:54321';
  assert.equal((await fetch(origin + '/snapshot', { headers: { ...headers, Origin: hostOrigin } })).status, 403);
  service.http.allowOrigin(hostOrigin);
  assert.equal((await fetch(origin + '/snapshot', { headers: { ...headers, Origin: hostOrigin } })).status, 200);
  assert.equal((await fetch(origin + '/rpc', { method: 'POST', headers, body: 'x'.repeat(MAX_BODY_BYTES + 1) })).status, 413);
  await assert.rejects(requestProgressHttp(file, '/rpc', { requestId: 'pushed', type: 'update', key: key('one'), expectedRevision: 0, record: { ...record, state: 'pushed', progress: 100 } }), /远端/);
});

test('an MCP client reuses the verified HTTP owner and never writes a local replacement', async t => {
  const file = path.join(temporary(t), 'state.json');
  const service = new AntigravityService({ port: 0, stateFile: file });
  await service.start(); t.after(() => service.stop());
  let calls = 0;
  const original = service.store.update.bind(service.store);
  service.store.update = args => { calls++; return original(args); };
  const child = spawn(process.execPath, [path.join(root, 'bin/antigravity-session-status.cjs'), '--no-ui'], { env: { ...process.env, SESSION_STATUS_PORT: String(service.port), SESSION_STATUS_STATE_FILE: file }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  const response = new Promise(resolve => child.stdout.once('data', data => resolve(JSON.parse(data.toString().trim()))));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'update_session_progress', arguments: { conversation_id: 'one', state: 'unfinished', progress: 40 } } }) + '\n');
  const value = await response;
  assert.equal(JSON.parse(value.result.content[0].text).progress, 40);
  assert.equal(calls, 1);
  const ended = exit(child); child.stdin.end(); await ended;
  assert.equal((await requestProgressHttp(file, '/health')).service, 'agent-things');
});

test('malformed MCP input stays recoverable and zero/string request ids retain identity', async () => {
  const input = new PassThrough(), output = new PassThrough();
  let text = ''; output.on('data', data => text += data);
  serveMcp({ name: 'fixture', input, output, callTool: async () => null });
  for (const line of ['null', '{broken', JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' }), JSON.stringify({ jsonrpc: '2.0', id: '', method: 'ping' })]) input.write(line + '\n');
  await new Promise(resolve => setImmediate(resolve));
  const replies = text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(replies.map(reply => reply.id), [null, null, 0, '']);
  assert.equal(replies[0].error.code, -32600);
  input.end();
});

test('transcript pagination freezes one parse and exposes stable seconds', async t => {
  const brain = temporary(t);
  const logs = path.join(brain, 'one/.system_generated/logs'); fs.mkdirSync(logs, { recursive: true });
  const file = path.join(logs, 'transcript.jsonl');
  const steps = Array.from({ length: 201 }, (_, i) => ({ type: 'USER_INPUT', content: 'task ' + i, created_at: '2026-11-05T01:00:00Z', step_index: i }));
  fs.writeFileSync(file, steps.map(JSON.stringify).join('\n') + '\n');
  const server = new AntigravityTranscriptServer({ brainDir: brain });
  let reads = 0;
  const read = fs.readFileSync;
  fs.readFileSync = function (name, ...args) { if (name === file) reads++; return read.call(fs, name, ...args); };
  try {
    const result = await captureExtracted(server.request.bind(server), 'local', 'one');
    assert.equal(result.extracted.turnHashes.length, 201);
    assert.equal(reads, 1);
    assert.equal(result.extracted.events[0].turnStartedAt, Date.parse(steps[0].created_at) / 1000);
  } finally { fs.readFileSync = read; await server.close(); }
});

test('project filtering compares actual metadata and excludes cleared sessions', () => {
  const records = { [key('one')]: { ...record, projectPath: '/one' }, [key('two')]: { ...record, projectPath: '/two' }, [key('cleared')]: { state: null } };
  const result = filterSessionStatuses({ records, projectPath: '/one' });
  assert.deepEqual(result.sessions.map(item => item.threadId), ['one']);
  assert.equal(filterSessionStatuses({ records, scope: 'recent_25' }).returnedCount, 2);
});

test('invalid task deltas leave no pending operation or partial state', async t => {
  const file = path.join(temporary(t), 'state.json');
  const store = new ManualStatusStore(file);
  store.update({ key: key('one'), expectedRevision: 0, record });
  const before = fs.readFileSync(file);
  await assert.rejects(callProgressTool(store, 'update_session_tasks', { conversation_id: 'one', expected_revision: 1, summary: 'invalid', tasks: [{ knownTaskId: 'unknown', title: 'task', status: 'done' }], removedTaskIds: [] }), /标识/);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('the native transaction lock recovers a dead owner', t => {
  const file = path.join(temporary(t), 'state.json');
  fs.writeFileSync(file + '.write-lock', '2147483000\n');
  const store = new ManualStatusStore(file);
  store.update({ key: key('one'), expectedRevision: 0, record });
  assert.equal(store.getProgress('one').progress, 50);
  assert.equal(fs.existsSync(file + '.write-lock'), false);
});
