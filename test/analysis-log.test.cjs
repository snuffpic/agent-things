'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAnalysisLog, diagnosticFields } = require('../src/analysis-log.cjs');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { AnalysisService } = require('../src/analysis-service.cjs');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-log-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('diagnostic log retains correlated metadata and omits arbitrary text and credentials', t => {
  const file = path.join(directory(t), 'analysis.jsonl');
  const log = createAnalysisLog(file);
  log('model.event', { runId: 'run-1', threadId: 'thread-1', actionSequence: 3, eventType: 'turn.completed',
    inputTokens: 25, profile: 'task_analysis_v1', promptBytes: 32, instructionBytes: 245, stdinBytes: 100, schemaBytes: 55,
    text: 'PRIVATE_TRANSCRIPT', stderr: 'Bearer PRIVATE_CREDENTIAL', prompt: 'PRIVATE_PROMPT',
    diagnostic: 'message with spaces and PRIVATE_CONTENT' });
  const raw = fs.readFileSync(file, 'utf8'), record = JSON.parse(raw);
  assert.equal(record.runId, 'run-1');
  assert.equal(record.inputTokens, 25);
  assert.equal(record.profile, 'task_analysis_v1');
  assert.equal(record.promptBytes, 32);
  assert.equal(record.instructionBytes, 245);
  assert.equal(record.stdinBytes, 100);
  assert.equal(record.schemaBytes, 55);
  assert.ok(Number.isFinite(Date.parse(record.time)));
  assert.doesNotMatch(raw, /PRIVATE_|Bearer/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(diagnosticFields('HTTP status 503 PRIVATE_CREDENTIAL'), { diagnostic: 'other', httpStatus: 503 });
  assert.equal(diagnosticFields('codex_models_manager request timed out').component, 'model_catalog');
  assert.equal(diagnosticFields('DNS ENOTFOUND PRIVATE_HOST').diagnostic, 'dns');
});

test('rotation bounds retained files and preserves valid JSON lines', t => {
  const dir = directory(t), file = path.join(dir, 'analysis.jsonl');
  const log = createAnalysisLog(file, { maxBytes: 350, backups: 2 });
  for (let i = 0; i < 12; i++) log('model.wait', { runId: 'test', elapsedMs: i });
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 3);
  for (const name of files) {
    const target = path.join(dir, name);
    assert.ok(fs.statSync(target).size <= 350);
    for (const line of fs.readFileSync(target, 'utf8').trim().split('\n')) assert.equal(JSON.parse(line).event, 'model.wait');
  }
  const latest = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(latest.at(-1).elapsedMs, 11);
});

test('a logging failure reports once and leaves the caller operational', t => {
  const parent = path.join(directory(t), 'not-a-directory');
  fs.writeFileSync(parent, 'occupied');
  const messages = [], original = console.error;
  console.error = message => messages.push(message);
  t.after(() => { console.error = original; });
  const log = createAnalysisLog(path.join(parent, 'analysis.jsonl'));
  assert.doesNotThrow(() => { log('analysis.start'); log('analysis.complete'); });
  assert.equal(messages.length, 1);
});

test('an analysis writes a complete correlated lifecycle without storing conversation text', async t => {
  const dir = directory(t), store = new ManualStatusStore(path.join(dir, 'state.json'));
  const turn = { id: 'turn-1', status: 'completed', items: [{ id: 'user-1', type: 'userMessage',
    content: [{ type: 'text', text: 'PRIVATE_TRANSCRIPT' }] }] };
  const service = new AnalysisService({ store,
    makeServer: () => ({ initialize: async () => {}, close: async () => {}, request: async () => ({ data: [turn], nextCursor: null }) }),
    run: async ({ log, input }) => {
      log('model.event', { eventType: 'turn.completed' });
      return { summary: 'PRIVATE_SUMMARY', tasks: [{ knownTaskId: null, title: 'PRIVATE_TASK', status: 'done',
        evidenceRefs: [input.events[0].ref] }], removedTaskIds: [] };
    } });
  await service.start(JSON.stringify(['local', 'local:thread-1']), { requestId: 'request-1' }).promise;
  const raw = fs.readFileSync(path.join(dir, 'analysis.jsonl'), 'utf8');
  assert.doesNotMatch(raw, /PRIVATE_/);
  const events = raw.trim().split('\n').map(JSON.parse);
  assert.equal(new Set(events.map(event => event.runId)).size, 1);
  assert.ok(events.every(event => event.requestId === 'request-1'));
  assert.equal(events[0].event, 'analysis.start');
  assert.equal(events.at(-1).event, 'analysis.cleanup.complete');
  assert.ok(events.some(event => event.event === 'source.complete' && event.compactBytes > 0));
  assert.ok(events.some(event => event.event === 'model.event'));
  assert.ok(events.some(event => event.event === 'analysis.complete' && event.percent === 100));
});
