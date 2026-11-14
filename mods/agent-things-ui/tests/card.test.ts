import { expect, mock, test } from 'claude-code/testing';

const CARD = { plugin: 'agent-things-ui', component: 'CommandOutput', surface: 'desktop', requestId: 'card',
  props: { command: 'things', text: 'agent-things-ui: Agent Things · 会话任务进度' }, viewport: { columns: 100, rows: 60 } } as const;
function setup(on, failSave = false, located = false) {
  const calls = [], saved = new Map();
  const value = { revision: 7, key: '["local","desktop"]', title: '真实任务', record: { revision: 7, state: 'unfinished', progress: 33, source: 'analysis', note: '备注原文', updatedAt: 1 },
    analysis: { ledger: { tasks: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, summary: `任务${i}`, title: `完整任务${i}`, status: i < 2 ? 'done' : 'todo', source: { itemId: `m${i}`, locator: '来源原文' } })) } }, timeline: [], projectGit: { hasRemote: true } };
  const clock = mock.clock(on);
  const holder: { calls: any[]; value: any; saved: Map<string, any>; clock: any; wake?: (result?: object) => void; watchFails?: number; staleRead?: object } = { calls, value, saved, clock };
  on('env.get', () => ({ value: '/home/test' }));
  on('fs.read', () => ({ value: JSON.stringify({ port: 29889, token: 'test-only' }) }));
  on('session.id', () => ({ value: 'cli-current' }));
  on('session.cwd', () => ({ value: '/project' }));
  on('store.get', ($, e) => ({ value: saved.get(e.key) }));
  on('store.set', ($, e) => { saved.set(e.key, e.value); return { value: undefined }; });
  on('command.register', ($, e) => { expect(e.name).toBe('things'); return { value: undefined }; });
  on('session.start', () => ({ cwd: '/project' }));
  on('http.fetch', ($, e) => {
    const body = JSON.parse(e.init.body); calls.push(body);
    if (body.action === 'save') {
      if (failSave) return { value: { ok: false, status: 400, headers: {}, text: JSON.stringify({ error: '记录已被其他窗口修改', errorInfo: { code: 'REVISION_CONFLICT', message: '记录已被其他窗口修改', retryable: false } }) } };
      value.revision++; value.record = { ...value.record, ...body.record, revision: value.revision, source: 'manual' };
    }
    if (body.action === 'clear') { value.revision++; value.record = { state: null, revision: value.revision }; value.analysis.ledger.tasks = []; }
    if (body.action === 'analyze') value.timeline.push({ status: 'pending', source: 'analysis', stage: 'reading' });
    if (body.action === 'watch') {
      if (holder.watchFails) { holder.watchFails--; return { value: { ok: false, status: 503, headers: {}, text: JSON.stringify({ error: '后台已断开' }) } }; }
      return new Promise(resolve => { holder.wake = (result = {}) => { holder.wake = undefined;
        resolve({ value: { ok: true, status: 200, headers: {}, text: JSON.stringify({ changed: false, paneRequested: false, ...result }) } }); }; });
    }
    if (body.action === 'read' && holder.staleRead) { const stale = holder.staleRead; holder.staleRead = undefined; return { value: { ok: true, status: 200, headers: {}, text: JSON.stringify(stale) } }; }
    return { value: { ok: true, status: 200, headers: {}, text: JSON.stringify({ ...value,
      ...(body.action === 'locate' ? { navigation: { located, reason: located ? undefined : 'message_not_in_history' } } : {}),
      ...(body.action === 'source' ? { source: { itemId: 'm2', title: '任务来源', text: '真实来源的完整文本' } } : {}),
    }) } };
  });
  return holder;
}
async function open($) {
  await $.session.start({ surface: 'desktop', cwd: '/project', isInteractive: true });
  await $.command.run({ command: 'things', args: '' });
  return $.ui.mount(CARD);
}
test('card shows three remaining tasks and opens completed tasks on their own page', async ($, on) => {
  setup(on); const ui = await open($);
  expect(await ui.find({ type: 'Text', text: '剩余任务 4' })).toBeDefined();
  expect(await ui.find({ key: 'task-t5' })).toBeUndefined();
  expect(await ui.find({ key: 'task-t0' })).toBeUndefined();
  await ui.press({ key: 'expand-remaining' });
  expect(await ui.find({ key: 'task-t5' })).toBeDefined();
  await ui.press({ key: 'completed' });
  expect(await ui.find({ key: 'task-t0' })).toBeDefined();
  await ui.press({ key: 'completed-back' });
  expect(await ui.find({ type: 'Text', text: '剩余任务 4' })).toBeDefined();
  await ui.unmount();
});
test('manual editing preserves its draft and submits the captured record revision', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.press({ key: 'edit' });
  await ui.input({ key: 'note-input', text: '一大段未保存备注', kind: 'change' });
  await ui.key({ key: 'enter', in: 'progress-slider' });
  await ui.key({ key: '7', in: 'progress-slider' });
  await ui.key({ key: '5', in: 'progress-slider' });
  await ui.key({ key: 'enter', in: 'progress-slider' });
  expect(state.saved.get('view:cli-current').draft.note).toBe('一大段未保存备注');
  await ui.post({ action: 'save' }, { in: 'save' });
  const submitted = state.calls.find(call => call.action === 'save');
  expect(submitted.expectedRevision).toBe(7);
  expect(submitted.record.progress).toBe(75);
  expect(submitted.record.note).toBe('一大段未保存备注');
  expect(await ui.find({ key: 'edit' })).toBeDefined();
  await ui.unmount();
});
test('save conflict keeps the editing input and draft intact', async ($, on) => {
  const state = setup(on, true); const ui = await open($);
  await ui.press({ key: 'edit' });
  await ui.input({ key: 'note-input', text: '必须保留', kind: 'change' });
  await ui.post({ action: 'save' }, { in: 'save' });
  expect(await ui.find({ key: 'note-input' })).toBeDefined();
  expect(state.saved.get('view:cli-current').draft.note).toBe('必须保留');
  expect(await ui.find({ type: 'Text', text: '记录已被其他窗口修改' })).toBeDefined();
  expect(await ui.find({ key: 'resolve-conflict' })).toBeDefined();
  state.value.record = { ...state.value.record, revision: 9, progress: 70 }; state.value.revision = 9;
  await ui.press({ key: 'resolve-conflict' });
  expect(state.saved.get('view:cli-current').baseRevision).toBe(9);
  expect(state.saved.get('view:cli-current').draft.note).toBe('必须保留');
  await ui.unmount();
});
test('analysis starts once and closing the drawing sends no cancel operation', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.post({ action: 'analyze' }, { in: 'analyze' });
  await ui.post({ action: 'analyze' }, { in: 'analyze' });
  expect(state.calls.filter(call => call.action === 'analyze').length).toBe(1);
  await ui.unmount();
  expect(state.calls.some(call => call.action === 'cancel')).toBe(false);
});
test('clear removes the displayed task collection using the latest revision', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.key({ key: 'enter', in: 'clear' });
  expect(state.calls.find(call => call.action === 'clear').expectedRevision).toBe(7);
  expect(await ui.find({ type: 'Text', text: '剩余任务 0' })).toBeDefined();
  await ui.unmount();
});
test('other command outputs are passed back to the host', async ($, on) => {
  setup(on); on('ui.render', () => ({ type: 'Text', props: {}, children: ['host'] }));
  const ui = await $.ui.mount({ ...CARD, props: { command: 'other', text: CARD.props.text } });
  expect(await ui.find({ type: 'Text', text: 'host' })).toBeDefined();
  await ui.unmount();
});
test('primary button handles a real pointer press and the slider accepts dragging', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.resize({ columns: 10, rows: 3, in: 'analyze' });
  await ui.pointer({ type: 'down', x: 2, y: 1, button: 'left', in: 'analyze' });
  await ui.pointer({ type: 'up', x: 2, y: 1, button: 'left', in: 'analyze' });
  expect(state.calls.filter(call => call.action === 'analyze').length).toBe(1);
  await ui.press({ key: 'edit' });
  await ui.resize({ columns: 38, rows: 6, in: 'progress-slider' });
  await ui.pointer({ type: 'down', x: 9, y: 4, button: 'left', in: 'progress-slider' });
  await ui.pointer({ type: 'move', x: 28, y: 4, button: 'left', in: 'progress-slider' });
  await ui.pointer({ type: 'up', x: 28, y: 4, button: 'left', in: 'progress-slider' });
  await state.clock.advance(150);
  expect(state.saved.get('view:cli-current').draft.progress).toBe(75);
  await ui.unmount();
});
test('source keeps its original text available when the host cannot locate it', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.press({ key: 'source-t2' });
  expect(state.calls.find(call => call.action === 'source').taskId).toBe('t2');
  expect(await ui.find({ type: 'Text', text: '真实来源的完整文本' })).toBeDefined();
  await ui.press({ key: 'source-back' });
  expect(await ui.find({ type: 'Text', text: '剩余任务 4' })).toBeDefined();
  await ui.unmount();
});
test('a local project without a remote does not offer the pushed state', async ($, on) => {
  const state = setup(on); state.value.projectGit.hasRemote = false;
  const ui = await open($); await ui.press({ key: 'edit' });
  expect(await ui.find({ key: 'state-completed' })).toBeDefined();
  expect(await ui.find({ key: 'state-pushed' })).toBeUndefined();
  await ui.unmount();
});
test('keyboard adjustment does not leave the slider dragging when the pointer later hovers', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.press({ key: 'edit' });
  await ui.resize({ columns: 38, rows: 6, in: 'progress-slider' });
  await ui.key({ key: 'right', in: 'progress-slider' });
  await state.clock.advance(150);
  expect(state.saved.get('view:cli-current').draft.progress).toBe(34);
  await ui.pointer({ type: 'move', x: 28, y: 1, in: 'progress-slider' });
  await state.clock.advance(150);
  expect(state.saved.get('view:cli-current').draft.progress).toBe(34);
  await ui.unmount();
});

test('slider paints locally during dragging and commits only on release', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.press({ key: 'edit' });
  await ui.resize({ columns: 38, rows: 6, in: 'progress-slider' });
  expect(await ui.find({ type: 'Svg', in: 'progress-slider' })).toBeDefined();
  await ui.pointer({ type: 'down', x: 9, y: 4, button: 'left', in: 'progress-slider' });
  await ui.pointer({ type: 'move', x: 28, y: 4, button: 'left', in: 'progress-slider' });
  expect(state.saved.get('view:cli-current').draft.progress).toBe(33);
  const drawing = await ui.find({ type: 'Svg', in: 'progress-slider' });
  expect(drawing.props.alt).toBe('进度 75%');
  await state.clock.advance(2000);
  expect((await ui.find({ type: 'Svg', in: 'progress-slider' })).props.alt).toBe('进度 75%');
  await ui.pointer({ type: 'up', x: 28, y: 4, button: 'left', in: 'progress-slider' });
  expect(state.saved.get('view:cli-current').draft.progress).toBe(75);
  expect(state.calls.some(call => call.action === 'save')).toBe(false);
  await ui.unmount();
});

test('slider clamps captured drags beyond its edges and number editing remains available', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.press({ key: 'edit' });
  await ui.resize({ columns: 38, rows: 6, in: 'progress-slider' });
  await ui.pointer({ type: 'down', x: 8, y: 4, button: 'left', in: 'progress-slider' });
  await ui.pointer({ type: 'move', x: 50, y: 4, button: 'left', in: 'progress-slider' });
  expect((await ui.find({ type: 'Svg', in: 'progress-slider' })).props.alt).toBe('进度 100%');
  await ui.pointer({ type: 'up', x: -5, y: 4, button: 'left', in: 'progress-slider' });
  expect(state.saved.get('view:cli-current').draft.progress).toBe(0);
  await ui.pointer({ type: 'down', x: 33, y: 1, button: 'left', in: 'progress-slider' });
  await ui.pointer({ type: 'up', x: 33, y: 1, button: 'left', in: 'progress-slider' });
  expect(await ui.find({ key: 'progress-number' })).toBeUndefined();
  await ui.key({ key: '8', in: 'progress-slider' });
  await ui.key({ key: '6', in: 'progress-slider' });
  expect(state.saved.get('view:cli-current').draft.progress).toBe(86);
  await ui.unmount();
});
test('keyboard steps retain one-percent precision near a snap node', async ($, on) => {
  const state = setup(on); state.value.record.progress = 24;
  const ui = await open($); await ui.press({ key: 'edit' });
  await ui.key({ key: 'right', in: 'progress-slider' });
  await ui.key({ key: 'right', in: 'progress-slider' });
  expect(state.saved.get('view:cli-current').draft.progress).toBe(26);
  await ui.unmount();
});

test('primary hover uses accent colors and clear has a single locally drawn background', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.resize({ columns: 9, rows: 2, in: 'analyze' });
  const picture = async key => (await ui.find({ type: 'Svg', in: key })).props.source;
  expect(await picture('analyze')).toContain('#0169CC');
  await ui.pointer({ type: 'enter', x: 3, y: 1, in: 'analyze' });
  expect(await picture('analyze')).toContain('#005bb3');
  await ui.pointer({ type: 'leave', x: 3, y: 1, in: 'analyze' });
  expect(await picture('analyze')).toContain('#0169CC');
  await ui.resize({ columns: 7, rows: 2, in: 'clear' });
  await ui.pointer({ type: 'enter', x: 3, y: 1, in: 'clear' });
  expect(await picture('clear')).toContain('light-dark(#bf2f3a,#ef7777)');
  expect(state.calls.some(call => call.action === 'clear')).toBe(false);
  await ui.pointer({ type: 'down', x: 3, y: 1, button: 'left', in: 'clear' });
  await ui.pointer({ type: 'up', x: 3, y: 1, button: 'left', in: 'clear' });
  expect(state.calls.filter(call => call.action === 'clear').length).toBe(1);
  await ui.unmount();
});

test('source requests host navigation and stays on the task card after successful location', async ($, on) => {
  const state = setup(on, false, true);
  const ui = await open($); await ui.press({ key: 'source-t2' });
  expect(state.calls.find(call => call.action === 'locate').taskId).toBe('t2');
  expect(await ui.find({ key: 'source-back' })).toBeUndefined();
  await ui.unmount();
});
test('card copy follows the sidebar popover wording', async ($, on) => {
  const state = setup(on);
  state.value.record = { revision: 7, state: 'unfinished', progress: 33, source: 'manual', note: '', updatedAt: 1 };
  state.value.analysis.ledger.tasks = [];
  const ui = await open($);
  expect(await ui.find({ type: 'Text', text: '暂无任务统计' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '手动调整' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: '点击更新进度，整理这次会话的任务' })).toBeDefined();
  expect((await ui.find({ key: 'edit-note' })).props.label).toBe('添加');
  await ui.unmount();
});
test('open-in-sidebar opens a pinned pane that reopens on the next session', async ($, on) => {
  const state = setup(on); const opened = [];
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } }; });
  const ui = await open($);
  await ui.post({ action: 'open-pane' }, { in: 'open-pane' });
  expect(opened).toEqual(['agent-things']);
  expect(state.saved.get('pane:pinned')).toBe(true);
  const pane = await $.ui.mount({ plugin: 'agent-things-ui', component: 'Pane', surface: 'desktop', requestId: 'agent-things',
    props: { title: 'Agent Things', isFocused: false, bodyColumns: 35, placement: 'dock', scroll: { offset: 0, bodyRows: 40, contentRows: 0 }, view: {} }, viewport: { columns: 35, rows: 60 } });
  expect(await pane.find({ type: 'Text', text: '剩余任务 4' })).toBeDefined();
  expect(await pane.find({ key: 'open-pane' })).toBeUndefined();
  expect(await ui.find({ key: 'dismiss-sidebar-hint' })).toBeDefined();
  expect(await pane.find({ key: 'dismiss-sidebar-hint' })).toBeDefined();
  await pane.press({ key: 'dismiss-sidebar-hint' });
  expect(await pane.find({ key: 'dismiss-sidebar-hint' })).toBeUndefined();
  expect(await ui.find({ key: 'dismiss-sidebar-hint' })).toBeUndefined();
  await $.session.start({ surface: 'desktop', cwd: '/project', isInteractive: true });
  expect(opened.length).toBe(2);
  expect(await pane.find({ key: 'dismiss-sidebar-hint' })).toBeUndefined();
  await pane.unmount(); await ui.unmount();
});
test('a sidebar popover request wakes the waiting mod and opens the pane without opening the card', async ($, on) => {
  const state = setup(on); const opened = [];
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } }; });
  await $.session.start({ surface: 'desktop', cwd: '/project', isInteractive: true });
  await state.clock.settle();
  expect(state.calls.some(call => call.action === 'watch')).toBe(true);
  expect(opened).toEqual([]);
  state.wake({ paneRequested: true });
  await state.clock.settle();
  expect(opened).toEqual(['agent-things']);
});
test('card copy uses an icon for open-in-sidebar, not text', async ($, on) => {
  setup(on); const ui = await open($);
  expect((await ui.find({ key: 'open-pane' })).type).toBe('Client');
  expect(await ui.find({ type: 'Button', text: '在侧栏打开' })).toBeUndefined();
  await ui.unmount();
});

test('another entry saving updates this card at once and keeps an unsaved draft, whose save then reports the conflict', async ($, on) => {
  const state = setup(on); const ui = await open($);
  await ui.press({ key: 'edit' });
  await ui.input({ key: 'note-input', text: '本入口未保存的草稿', kind: 'change' });
  // 另一入口保存：后台修订号前进，watch 被唤醒，本卡补读。
  state.value.revision = 9; state.value.record = { ...state.value.record, revision: 9, progress: 80, note: '另一入口已保存', source: 'manual' };
  const reads = state.calls.filter(call => call.action === 'read').length;
  state.wake({ changed: true });
  await state.clock.settle();
  expect(state.calls.filter(call => call.action === 'read').length).toBe(reads + 1);
  expect((await ui.find({ key: 'note-input' })).props.value).toBe('本入口未保存的草稿');
  expect(state.calls.findLast(call => call.action === 'watch').since).toBe(9);
  await ui.post({ action: 'save' }, { in: 'save' });
  expect(state.calls.find(call => call.action === 'save').expectedRevision).toBe(7);
  await ui.unmount();
});
test('a late reply carrying an older revision does not roll the card back', async ($, on) => {
  const state = setup(on); const ui = await open($);
  state.value.revision = 12; state.value.record = { ...state.value.record, revision: 12, progress: 90 };
  state.wake({ changed: true }); await state.clock.settle();
  expect(JSON.stringify(await ui.drawn())).toContain('"alt":"90%"');
  state.staleRead = { ...state.value, revision: 8, record: { ...state.value.record, revision: 8, progress: 10 } };
  state.wake({ changed: true }); await state.clock.settle();
  expect(JSON.stringify(await ui.drawn())).toContain('"alt":"90%"');
  expect(JSON.stringify(await ui.drawn())).not.toContain('"alt":"10%"');
  await ui.unmount();
});
test('after the background drops the wait, the card re-reads once on reconnect and resumes waiting', async ($, on) => {
  const state = setup(on); const ui = await open($);
  state.watchFails = 1;
  state.value.revision = 15; state.value.record = { ...state.value.record, revision: 15, progress: 55 };
  state.wake({ changed: false });
  await state.clock.settle();
  await state.clock.advance(1000);
  await state.clock.settle();
  expect(JSON.stringify(await ui.drawn())).toContain('"alt":"55%"');
  expect(state.calls.findLast(call => call.action === 'watch').since).toBe(15);
  await ui.unmount();
});
