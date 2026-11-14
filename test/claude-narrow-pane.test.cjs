'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadHooks(t, payload) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'things-narrow-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
  const hooksDir = path.join(__dirname, '../mods/agent-things-ui/hooks');
  for (const name of fs.readdirSync(hooksDir)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(hooksDir, name), path.join(tempDir, name));
  }
  const pres = await import(`${pathToFileURL(path.join(tempDir, 'presentation.js')).href}?v=${Math.random()}`);
  const ctrls = await import(`${pathToFileURL(path.join(tempDir, 'controls.js')).href}?v=${Math.random()}`);
  const reg = await import(`${pathToFileURL(path.join(tempDir, 'register.js')).href}?v=${Math.random()}`);

  const handlers = new Map();
  const storeMap = new Map();
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
    session: { id: async () => 'cli-narrow-1', cwd: async () => '/tmp/project' },
    store: { get: async k => storeMap.get(k), set: async (k, v) => { storeMap.set(k, v); } },
    command: { register: async () => {} },
    clock: { sleep: () => new Promise(() => {}), after: () => {}, every: () => {} },
    ui: { resolve: () => uiNodes, open: async () => {}, invalidate: () => {} },
    http: {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.action === 'watch') return new Promise(() => {});
        if (body.action === 'update-info') return { ok: true, status: 200, text: JSON.stringify({ updateInfo: { available: false } }) };
        return { ok: true, status: 200, text: JSON.stringify(payload) };
      },
    },
  };
  const on = (event, matcherOrFn, maybeFn) => {
    const fn = typeof matcherOrFn === 'function' ? matcherOrFn : maybeFn;
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  };
  reg.register(on);
  for (const fn of handlers.get('session.start') || []) await fn($, {}, () => {});
  for (let i = 0; i < 6; i++) await Promise.resolve();
  return {
    pres,
    controls: ctrls.default,
    async renderPane(columns) {
      const renderHandlers = handlers.get('ui.render') || [];
      return renderHandlers[1]($, {
        component: 'Pane',
        requestId: 'agent-things',
        props: { title: 'Agent Things', bodyColumns: columns },
        viewport: { columns, rows: 50 },
      }, () => null);
    },
  };
}

function findNodes(root, predicate, acc = []) {
  if (!root || typeof root === 'string') return acc;
  if (predicate(root)) acc.push(root);
  for (const child of root.children || []) findNodes(child, predicate, acc);
  return acc;
}

test('presentation isolates circular indicators from squashing and truncates narrow labels with ellipsis', async t => {
  const { pres } = await loadHooks(t, {});
  const ring = pres.headerRing({ state: 'unfinished', progress: 42 }, false);
  assert.match(ring, /width="32" height="34" preserveAspectRatio="xMidYMid meet"/);
  assert.equal(ring.includes('<text x="42"'), false);

  const singleSpec = pres.headerTitleSpec('Reload plugins', 250);
  assert.equal(singleSpec.height, 34);
  assert.match(singleSpec.source, /preserveAspectRatio="xMinYMin meet"/);

  const narrowSpec = pres.headerTitleSpec('自动交接调查与修复在极窄侧边栏中需要正确省略的标题', 110);
  assert.equal(narrowSpec.height, 64);
  assert.match(narrowSpec.source, /preserveAspectRatio="xMinYMin meet"/);
  assert.ok(narrowSpec.source.includes('...'));

  const badge = pres.statusBadgeSvg('#9098a2', '全部完成并已推送', 80);
  assert.match(badge, /<circle cx="5" cy="9" r="4\.25"/);
  assert.match(badge, /preserveAspectRatio="xMinYMid meet"/);
  assert.ok(badge.includes('...'));

  const score = pres.scoreSvg(92);
  assert.match(score, /width="96" height="48" preserveAspectRatio="xMaxYMid meet"/);
});

test('narrow Pane keeps circular rings non-shrinking, matches single-line height, and renders status dot cleanly', async t => {
  const payload = {
    revision: 3,
    key: '["local","desktop"]',
    title: '自动交接调查与修复超长任务名称测试在窄栏中的自动省略效果',
    record: { revision: 3, state: 'pushed', progress: 92, source: 'analysis', note: '窄侧栏备注自动换行测试', updatedAt: Date.now() },
    analysis: { ledger: { tasks: [] } },
    timeline: [],
    projectGit: { hasRemote: true },
  };
  const { renderPane } = await loadHooks(t, payload);
  const tree = await renderPane(20);

  // Header ring box is non-shrinking and uses fixed 32x34 aspect-preserved circle
  const ringBoxes = findNodes(tree, node =>
    node.type === 'Box' &&
    node.props?.flexShrink === 0 &&
    node.children?.[0]?.type === 'Svg' &&
    node.children[0].props?.width === 32 &&
    node.children[0].props?.height === 34);
  assert.equal(ringBoxes.length, 1);
  assert.match(ringBoxes[0].children[0].props.source, /preserveAspectRatio="xMidYMid meet"/);

  // Title SVG is separate, adaptive width, and ellipsized
  const titleSvgs = findNodes(tree, node =>
    node.type === 'Svg' && node.props?.alt === payload.title);
  assert.equal(titleSvgs.length, 1);
  assert.equal(titleSvgs[0].props.height, 64);
  assert.ok(titleSvgs[0].props.width < 200);
  assert.ok(titleSvgs[0].props.source.includes('...'));

  // Status badge renders both circle indicator and ellipsized status text with non-empty alt
  const statusSvgs = findNodes(tree, node =>
    node.type === 'Svg' && node.props?.alt === '全部完成并已推送');
  assert.equal(statusSvgs.length, 1);
  assert.match(statusSvgs[0].props.source, /<circle cx="5" cy="9" r="4\.25"/);
  assert.ok(statusSvgs[0].props.source.includes('...'));

  // Single-line short title uses height 34 matching the header ring height (no 15px vertical drop)
  const shortHarness = await loadHooks(t, { ...payload, title: 'Reload plugins' });
  const wideTree = await shortHarness.renderPane(35);
  const shortTitleSvgs = findNodes(wideTree, node =>
    node.type === 'Svg' && node.props?.alt === 'Reload plugins');
  assert.equal(shortTitleSvgs.length, 1);
  assert.equal(shortTitleSvgs[0].props.height, 34);

  // Score box is non-shrinking 96x48
  const scoreBoxes = findNodes(tree, node =>
    node.type === 'Box' &&
    node.props?.flexShrink === 0 &&
    node.children?.[0]?.type === 'Svg' &&
    node.children[0].props?.width === 96 &&
    node.children[0].props?.height === 48);
  assert.equal(scoreBoxes.length, 1);
});

test('wide Pane passes adaptive width to slider and uses aspect-preserved SVGs across slider and action buttons', async t => {
  const payload = {
    revision: 4,
    key: '["local","desktop"]',
    title: 'Wide Pane Stretch Guard',
    record: { revision: 4, state: 'unfinished', progress: 25, source: 'manual', note: '', updatedAt: Date.now() },
    analysis: { ledger: { tasks: [] } },
    timeline: [],
    projectGit: { hasRemote: true },
  };
  const { renderPane, controls } = await loadHooks(t, payload);
  let paneTree = await renderPane(64);
  const editBtn = findNodes(paneTree, node => node.type === 'Button' && node.props?.key === 'edit')[0];
  assert.ok(editBtn);
  await editBtn.props.onPress();
  paneTree = await renderPane(64);

  const sliderClient = findNodes(paneTree, node => node.type === 'Client' && node.props?.key === 'progress-slider')[0];
  assert.ok(sliderClient);
  const expectedWidth = Math.max(130, Math.round((64 - 2.2) * 9.3));
  assert.equal(sliderClient.props.props.width, expectedWidth);

  const surface = { columns: 62, rows: 6, state: null, setState(next) { this.state = next; }, onPointer() {}, onKey() {}, post() {} };
  const sliderSvg = controls(sliderClient.props.props, surface);
  assert.equal(sliderSvg.props.width, expectedWidth);
  assert.match(sliderSvg.props.source, new RegExp(`width="${expectedWidth}" height="110" preserveAspectRatio="xMinYMid meet"`));
  assert.match(sliderSvg.props.source, new RegExp(`width="${expectedWidth}" height="51" preserveAspectRatio="xMinYMid meet"`));
  assert.equal(sliderSvg.props.source.includes('preserveAspectRatio="none"'), false);

  const saveClient = findNodes(paneTree, node => node.type === 'Client' && node.props?.key === 'save')[0];
  const saveSvg = controls(saveClient.props.props, { ...surface, state: null });
  assert.ok(saveSvg.props.width < 4096 && saveSvg.props.width >= 80);
  assert.match(saveSvg.props.source, /preserveAspectRatio="xMidYMid meet"/);
});
