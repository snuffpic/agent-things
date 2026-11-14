'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { locateClaudeMessage } = require('../src/harnesses/claude/claude-navigation.cjs');

function fixture({ mounted = false, earlier = false, wrongSession = false } = {}) {
  const moves = [], pages = [], rows = new Map();
  const target = { scrollIntoView: value => moves.push(value), animate() {} };
  if (mounted) rows.set('message-uuid', target);
  const props = { sessionId: 'session', entries: earlier ? [] : [{ id: 'entry-id', sourceUuid: 'message-uuid' }] };
  const api = { scrollToEntry(id) { assert.equal(id, 'entry-id'); rows.set(id, target); } };
  props.historyPager = { hasEarlier: earlier, isLoadingEarlier: false, loadEarlier: async () => {
    pages.push(1); props.entries = [{ id: 'entry-id', sourceUuid: 'message-uuid' }]; props.historyPager = { hasEarlier: false };
  } };
  const scroller = { __reactFiber$fixture: { memoizedProps: props, ref: { current: api }, return: null } };
  const root = { closest() { return root; }, querySelector(selector) {
    if (selector === '[data-autoscroll-container]') return scroller;
    return [...rows].find(([id]) => selector.includes(`="${id}"`))?.[1] || null;
  } };
  const document = { querySelector: selector => !wrongSession && selector === '[data-session-id="session"]' ? root : null };
  const context = vm.createContext({ document, CSS: { escape: value => value }, Date, setTimeout });
  return { moves, pages, props, run: () => vm.runInContext(`(${locateClaudeMessage.toString()})({threadId:'session',itemId:'message-uuid'})`, context) };
}
test('navigation reveals the actual Claude entry attribute when already mounted', async () => {
  const f = fixture({ mounted: true }); assert.equal((await f.run()).located, true); assert.equal(f.moves.length, 1);
});
test('navigation uses the native transcript ref to reveal an unmounted source UUID', async () => {
  const f = fixture({}); assert.equal((await f.run()).located, true); assert.equal(f.moves.length, 1); assert.equal(f.pages.length, 0);
});
test('navigation loads earlier native history before revealing its source', async () => {
  const f = fixture({ earlier: true }); assert.equal((await f.run()).located, true); assert.equal(f.pages.length, 1);
});
test('navigation never scrolls another session when the requested session is absent', async () => {
  const f = fixture({ wrongSession: true }); assert.equal((await f.run()).reason, 'session_not_visible'); assert.equal(f.moves.length, 0);
});
test('exhausted native history reports a missing source rather than success', async () => {
  const f = fixture({}); f.props.entries = []; assert.equal((await f.run()).reason, 'message_not_in_history');
});

test('navigation supports the desktop older-source context and merged assistant UUIDs', async () => {
  const f = fixture({ earlier: true });
  delete f.props.historyPager;
  f.props.value = { olderSource: { hasOlder: true, isLoadingOlder: false, loadOlder: async options => {
    assert.equal(options.trigger, 'anchor-restore');
    assert.equal(options.chain(), true);
    f.pages.push(1); f.props.entries = [{ id: 'entry-id', lastAssistantUuid: 'message-uuid' }];
    f.props.value = { olderSource: { hasOlder: false } };
  } } };
  assert.equal((await f.run()).located, true); assert.equal(f.pages.length, 1);
});
