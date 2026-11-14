'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { ClaudeLocalSource } = require('../src/harnesses/claude/claude-local-source.cjs');
const { ClaudeStatusStore } = require('../src/harnesses/claude/claude-service.cjs');
const { sessionView } = require('../src/session-view.cjs');

test('ClaudeLocalSource skips unchanged session files and tracks edits/deletions incrementally', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'things-perf-source-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, 'Library/Application Support/Claude/claude-code-sessions/acc/org');
  fs.mkdirSync(dir, { recursive: true });
  const fileA = path.join(dir, 'local_a.json');
  const fileB = path.join(dir, 'local_b.json');
  fs.writeFileSync(fileA, JSON.stringify({ sessionId: 'local_a', cliSessionId: 'cli-a', title: '会话A' }));
  fs.writeFileSync(fileB, JSON.stringify({ sessionId: 'local_b', cliSessionId: 'cli-b', title: '会话B' }));

  const origReadFileSync = fs.readFileSync;
  const reads = [];
  t.after(() => { fs.readFileSync = origReadFileSync; });
  fs.readFileSync = function (filePath, ...rest) {
    if (String(filePath).startsWith(dir)) reads.push(path.basename(String(filePath)));
    return origReadFileSync.call(fs, filePath, ...rest);
  };

  const source = new ClaudeLocalSource({ home });
  const initial = source.loadSessions();
  assert.equal(initial.length, 2);
  assert.deepEqual(reads.sort(), ['local_a.json', 'local_b.json']);

  reads.length = 0;
  source.loadedAt = 0;
  const cached = source.loadSessions();
  assert.equal(cached.length, 2);
  assert.deepEqual(reads, []);

  // Touch fileA with updated title and remove fileB
  const futureTime = Date.now() / 1000 + 5;
  fs.writeFileSync(fileA, JSON.stringify({ sessionId: 'local_a', cliSessionId: 'cli-a', title: '会话A已更新' }));
  fs.utimesSync(fileA, futureTime, futureTime);
  fs.unlinkSync(fileB);

  reads.length = 0;
  source.loadedAt = 0;
  const updated = source.loadSessions();
  assert.equal(updated.length, 1);
  assert.equal(updated[0].title, '会话A已更新');
  assert.deepEqual(reads, ['local_a.json']);
  assert.equal(source.fileCache.has(fileB), false);
});

test('readSessionProjection matches getProgress/analysisState/sessionView parity cleanly', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'things-perf-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ClaudeStatusStore(path.join(dir, 'state.json'));

  const otherKey = store.resolveKey('local_other');
  store.update({ key: otherKey, expectedRevision: 0, record: { state: 'completed', progress: 100, note: '其他会话超大备注'.repeat(50) } });

  const key = store.resolveKey('local_target');
  const seq1 = store.beginAnalysis(key, { status: 'ready' });
  const longSummary = '长摘要内容'.repeat(60);
  store.finishAnalysis(key, seq1, {
    ledger: {
      summary: longSummary,
      tasks: [
        { id: 't1', title: '任务1', summary: '任务1', status: 'done', evidenceRefs: ['r1'] },
        { id: 't2', title: '任务2', summary: '任务2', status: 'todo', evidenceRefs: ['r2'] },
      ],
    },
    sources: {
      r1: { turnId: 'turn-1', itemId: 'item-1', locator: '定位1' },
      r2: { turnId: 'turn-2', itemId: 'item-2', locator: '定位2' },
    },
    projectGit: { projectKnown: true, projectPath: '/tmp/proj', hasRemote: true },
  });

  const legacyState = store.analysisState(key);
  const legacyProgress = store.getProgress(key);
  const projection = store.readSessionProjection(key);

  assert.equal(projection.revision, legacyState.revision);
  assert.deepEqual(projection.record, legacyState.timeline.length ? store.snapshot().records[key] : null);
  assert.deepEqual(projection.activeTasks, legacyProgress.tasks);
  assert.equal(projection.timelineSummary.length, 1);
  assert.equal(projection.timelineSummary[0].summary, longSummary.slice(0, 200));
  assert.equal(projection.timelineSummary[0].progress, 50);

  const viewFromProjection = sessionView(store, key, { capabilities: { locate: true }, projection });
  const viewStandalone = sessionView(store, key, { capabilities: { locate: true } });
  assert.deepEqual(viewFromProjection, viewStandalone);
});

async function loadRegisterHarness(t, fetchImpl) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'things-perf-ui-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
  const hooksDir = path.join(__dirname, '../mods/agent-things-ui/hooks');
  for (const name of fs.readdirSync(hooksDir)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(hooksDir, name), path.join(tempDir, name));
  }

  const handlers = new Map();
  const timers = [];
  const storeMap = new Map();
  const registered = [];
  let invalidations = 0;

  const uiNodes = {
    Box: props => ({ type: 'Box', props, children: props.children || [] }),
    Text: props => ({ type: 'Text', props, children: props.children || [] }),
    Button: props => ({ type: 'Button', props, children: [props.label] }),
    Input: props => ({ type: 'Input', props, children: [] }),
    Svg: props => ({ type: 'Svg', props, children: [] }),
    Client: props => ({ type: 'Client', props, children: [] }),
  };

  const $ = {
    env: { get: async () => '/home/test' },
    fs: { read: async () => JSON.stringify({ port: 29889, token: 'test-token' }) },
    session: { id: async () => 'cli-session-1', cwd: async () => '/tmp/project' },
    store: {
      get: async k => storeMap.get(k),
      set: async (k, v) => { storeMap.set(k, v); },
    },
    command: {
      register: async spec => { registered.push(spec.name); },
    },
    clock: {
      sleep: ms => new Promise(resolve => timers.push({ ms, fn: resolve })),
      after: (ms, fn) => { timers.push({ ms, fn }); },
      every: () => {},
    },
    ui: {
      resolve: () => uiNodes,
      open: async () => {},
      invalidate: () => { invalidations++; },
    },
    http: { fetch: fetchImpl },
  };

  const on = (event, matcherOrFn, maybeFn) => {
    const fn = typeof matcherOrFn === 'function' ? matcherOrFn : maybeFn;
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  };

  const mod = await import(`${pathToFileURL(path.join(tempDir, 'register.js')).href}?v=${Math.random()}`);
  mod.register(on);

  const flushMicrotasks = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const fireTimers = async maxMs => {
    const due = timers.splice(0).filter(item => item.ms <= maxMs);
    for (const item of due) await item.fn();
    await flushMicrotasks();
  };

  return {
    $, handlers, registered, fireTimers, flushMicrotasks,
    getInvalidations: () => invalidations,
    async startSession() {
      for (const fn of handlers.get('session.start') || []) await fn($, {}, () => {});
    },
    async runThings() {
      let out;
      for (const fn of handlers.get('command.run') || []) out = await fn($, { command: 'things' });
      return out;
    },
    async renderCard() {
      const fns = handlers.get('ui.render') || [];
      return fns[0]($, { component: 'CommandOutput', props: { command: 'things' } }, () => null);
    },
  };
}

function collectText(node, acc = []) {
  if (!node) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (node.props?.alt) acc.push(node.props.alt);
  if (node.props?.label) acc.push(node.props.label);
  for (const child of node.children || []) collectText(child, acc);
  return acc;
}

function samplePayload() {
  return {
    revision: 7,
    key: '["local","desktop"]',
    title: '性能优化任务',
    record: { revision: 7, state: 'unfinished', progress: 33, source: 'analysis', note: '已同步备注', updatedAt: 1 },
    analysis: { ledger: { tasks: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, summary: `任务${i}`, title: `完整任务${i}`, status: i < 2 ? 'done' : 'todo' })) } },
    timeline: [],
    projectGit: { hasRemote: true },
  };
}

test('command.run renders real card immediately when backend responds within 80ms', async t => {
  const payload = samplePayload();
  const harness = await loadRegisterHarness(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'watch') return new Promise(() => {});
    return { ok: true, status: 200, text: JSON.stringify(payload) };
  });

  await harness.startSession();
  assert.deepEqual(harness.registered, ['things']);
  await harness.runThings();
  const tree = await harness.renderCard();
  const texts = collectText(tree);
  assert.ok(texts.includes('剩余任务 4'));
  assert.equal(texts.some(s => s.includes('正在读取会话进度')), false);
});

test('command.run switches to skeleton after 80ms slow stall and hydrates seamlessly when reply arrives', async t => {
  let resolveRead;
  const harness = await loadRegisterHarness(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'read') return new Promise(resolve => { resolveRead = resolve; });
    if (body.action === 'watch') return new Promise(() => {});
    if (body.action === 'update-info') return { ok: true, status: 200, text: JSON.stringify({ updateInfo: { available: false } }) };
    return { ok: true, status: 200, text: JSON.stringify({}) };
  });

  // session.start must complete without waiting on slow read
  await harness.startSession();
  assert.deepEqual(harness.registered, ['things']);

  // command.run blocks at most 80ms, then unblocks once 80ms elapses
  let commandFinished = false;
  const running = harness.runThings().then(() => { commandFinished = true; });
  await harness.flushMicrotasks();
  assert.equal(commandFinished, false);

  await harness.fireTimers(80);
  await running;
  assert.equal(commandFinished, true);

  // Skeleton renders immediately without writable controls
  const skeletonTree = await harness.renderCard();
  const skeletonTexts = collectText(skeletonTree);
  assert.ok(skeletonTexts.includes('正在读取会话进度…'));
  assert.equal(skeletonTexts.includes('更新进度'), false);
  assert.equal(skeletonTexts.includes('保存记录'), false);
  assert.equal(skeletonTexts.includes('清除进度'), false);

  // Backend finishes later -> triggers ui.invalidate and swaps to real card
  const invBefore = harness.getInvalidations();
  resolveRead({ ok: true, status: 200, text: JSON.stringify(samplePayload()) });
  await harness.flushMicrotasks();
  assert.ok(harness.getInvalidations() > invBefore);

  const realTree = await harness.renderCard();
  const realTexts = collectText(realTree);
  assert.ok(realTexts.includes('剩余任务 4'));
  assert.equal(realTexts.includes('正在读取会话进度…'), false);
});

test('command.run renders error fallback with retry button when initial read fails', async t => {
  const harness = await loadRegisterHarness(t, async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.action === 'read') return { ok: false, status: 503, text: JSON.stringify({ error: '守护进程未就绪' }) };
    if (body.action === 'watch') return new Promise(() => {});
    return { ok: true, status: 200, text: JSON.stringify({}) };
  });

  await harness.startSession();
  await harness.runThings();
  const tree = await harness.renderCard();
  const texts = collectText(tree);
  assert.ok(texts.includes('尚未读取到会话进度'));
  assert.ok(texts.includes('重试读取'));
  assert.ok(texts.some(s => s.includes('守护进程未就绪')));
});
