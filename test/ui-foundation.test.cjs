'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createPresentation, browserSource } = require('../src/ui-foundation.cjs');

test('browser and Mods use the same generated presentation and progress rules', () => {
  const expected = createPresentation();
  const browser = vm.runInNewContext(browserSource + '\nglobalThis.__agentThingsPresentation;');
  const file = fs.readFileSync(path.join(__dirname, '../mods/agent-things-ui/hooks/foundation.js'), 'utf8');
  const mods = vm.runInNewContext(file.replace('export const {', 'const {') + '\npresentation;');
  for (const target of [browser, mods]) {
    for (const field of ['colors', 'labels', 'taskLabels', 'layout', 'accent']) assert.deepEqual(JSON.parse(JSON.stringify(target[field])), expected[field]);
    for (const [value, dragging, result] of [[24, true, 25], [27, true, 25], [62, true, 62], [24, false, 24], [101, false, 100]]) assert.equal(target.progressValue(value, dragging), result);
    assert.equal(target.progressState('pushed', 100), 'pushed');
    assert.equal(target.progressState('unfinished', 100), 'completed');
    assert.equal(target.progressState('unstarted', 0), 'unstarted');
    assert.equal(target.progressState('completed', null), 'unfinished');
    const draft = target.draftTransition({}, { type: 'begin', record: { state: 'unfinished', progress: 80, note: '草稿', revision: 10 } });
    assert.equal(target.draftTransition(draft, { type: 'external', revision: 11 }).baseRevision, 10);
    const conflict = target.draftTransition(draft, { type: 'conflict' });
    assert.equal(conflict.conflict, true);
    const rebased = target.draftTransition(conflict, { type: 'rebase', revision: 11 });
    assert.equal(rebased.baseRevision, 11); assert.equal(rebased.draft.progress, 80);
    assert.equal(target.draftTransition(rebased, { type: 'saved', revision: 12 }).draft, null);
    assert.equal(target.analysisDisabled(false, true, null), true);
    assert.equal(target.analysisDisabled(false, false, 'installing'), true);
    assert.equal(target.analysisDisabled(false, false, null), false);
  }
  assert.ok(file.includes(createPresentation.toString()), 'Generated Mods module must match the shared source');
});
