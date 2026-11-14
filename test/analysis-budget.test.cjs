'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { measureRequest, nextBatch } = require('../src/analysis-budget.cjs');
const prompt = '规则', schema = { type: 'object' };
const events = Array.from({ length: 4 }, (_, i) => ({ ref: 'u' + i, text: 'x'.repeat(45000) }));
const sources = Object.fromEntries(events.map((e, i) => [e.ref, { turnId: 't' + Math.floor(i / 2) }]));
const base = { previousLedger: null, events, manualContext: [] };
test('complete requests include ledger, manual context, prompt and schema, and retain whole turns', () => {
  const first = nextBatch({ input: base, sources, prompt, schema });
  assert.deepEqual(first.map(e => e.ref), ['u0', 'u1']);
  assert.ok(measureRequest({ input: { ...base, events: first }, prompt, schema }).fits);
  assert.equal(measureRequest({ input: base, prompt, schema }).fits, false);
  assert.equal(nextBatch({ input: { ...base, previousLedger: { text: 'x'.repeat(70000) }, events: [events[0], events[2]] }, sources, prompt, schema }).length, 1);
  assert.throws(() => nextBatch({ input: { ...base, events: [{ ref: 'u0', text: 'x'.repeat(170000) }] }, sources, prompt, schema }), /单轮/);
  assert.throws(() => nextBatch({ input: { ...base, previousLedger: { text: 'x'.repeat(170000) } }, sources, prompt, schema }), /账本/);
  assert.equal(measureRequest({ input: { events: [] }, prompt: 'x'.repeat(170000), schema }).fits, false);
});
test('a cleaned 129KB history fits one full request', () => {
  const input = { ...base, events: [{ ref: 'u0', text: 'x'.repeat(129000) }] };
  assert.equal(nextBatch({ input, sources, prompt, schema }).length, 1);
});

test('whole-turn budget rejects an oversized turn and counts the previous ledger', () => {
  assert.throws(() => nextBatch({ input: { ...base, events: [events[0]], previousLedger: { text: 'x'.repeat(150000) } }, sources, prompt, schema }), /单轮/);
  assert.equal(measureRequest({ input: { text: 'x'.repeat(250000) }, prompt, schema, maxBytes: 4000000 }).fits, false);
});
