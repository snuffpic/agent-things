'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { CodexService } = require('../src/harnesses/codex/codex-service.cjs');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { ClaudeService } = require('../src/harnesses/claude/claude-service.cjs');
const { getCardTools, createCodexCard } = require('../src/harnesses/codex/codex-card.cjs');

test('both hosts expose identical update replies without changing session records', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-rpc-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const info = { currentVersion: '1.0.0', latestVersion: '1.1.0', available: true };
  for (const host of ['codex', 'antigravity']) {
    const calls = [];
    const updates = { getUpdateInfo: async options => { calls.push(options || {}); return info; }, startUpdate: async () => { calls.push('start'); } };
    const stateFile = path.join(directory, host + '.json');
    const service = host === 'codex' ? new CodexService({ store: new ManualStatusStore(stateFile), updates }) : new AntigravityService({ port: 0, stateFile, updates });
    t.after(() => service.stop());
    let reply;
    service.evaluate = async (_, expression) => { reply = JSON.parse(expression.slice('window.__codexSessionStatus.reply('.length, -1)); };
    service.broadcast = async () => { throw Error('Update polling must not broadcast task snapshots'); };
    const dispatch = async message => host === 'codex' ? (await service.handleMessage({}, JSON.stringify(message)), reply) : service.handleRpc(message);
    const original = JSON.stringify(service.store.snapshot());
    const checked = await dispatch({ type: 'app-update-info', requestId: 'check', force: true });
    assert.deepEqual(checked.updateInfo, info);
    assert.equal(checked.error, null);
    assert.deepEqual(calls, [{ force: true }]);
    const started = await dispatch({ type: 'app-update-start', requestId: 'start' });
    assert.deepEqual(started.updateInfo, info);
    assert.deepEqual(calls, [{ force: true }, 'start', {}]);
    updates.startUpdate = async () => { throw require('../src/progress-error.cjs').progressError('SERVICE_STOPPING', 'already running'); };
    const failed = await dispatch({ type: 'app-update-start', requestId: 'failure' });
    assert.match(failed.error, /already running/);
    assert.equal(JSON.stringify(service.store.snapshot()), original);
  }
});

test('Antigravity update execution requires an authenticated local request', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-http-'));
  let starts = 0;
  const updates = { startUpdate: async () => { starts++; }, getUpdateInfo: async () => ({ available: true, update: { stage: 'queued' } }) };
  const service = new AntigravityService({ port: 0, stateFile: path.join(directory, 'state.json'), updates });
  t.after(async () => { await service.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  const port = await service.start();
  const request = token => fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ type: 'app-update-start', requestId: 'upgrade' }) });
  assert.equal((await request()).status, 401);
  assert.equal(starts, 0);
  assert.equal((await request(service.http.credentials.token)).status, 200);
  assert.equal(starts, 1);
});

test('Codex MCP read_session_card schema and bridge forward force flag for manual update checks', async t => {
  const readTool = getCardTools('zh').find(tool => tool.name === 'read_session_card');
  assert.equal(readTool.inputSchema.properties.force.type, 'boolean');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-card-force-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const sentRequests = [];
  const card = createCodexCard({
    store,
    request: async message => {
      sentRequests.push(message);
      return { updateInfo: { currentVersion: '1.3.2', latestVersion: '1.3.3', available: message.force === true } };
    },
  });
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const openRes = await card.call('open_session_card', { conversation_id: conversationId }, { thread_id: conversationId });
  const cardToken = openRes._meta.cardToken;

  const res = await card.call('read_session_card', {
    conversation_id: conversationId,
    card_token: cardToken,
    action: 'app-update-info',
    force: true,
  }, { thread_id: conversationId });
  assert.equal(sentRequests.length, 1);
  assert.equal(sentRequests[0].type, 'app-update-info');
  assert.equal(sentRequests[0].force, true);
  assert.equal(res.structuredContent.updateInfo.available, true);

  // Verify codex-card-bridge.js forwards `force` over MCP tools/call
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '../src/harnesses/codex/codex-card-bridge.js'), 'utf8');
  const postedRpc = [];
  let embeddedSend = null;
  const fakeWindow = {
    parent: { postMessage: msg => postedRpc.push(msg) },
    addEventListener: () => {},
  };
  const fakeDocument = {
    documentElement: { style: { setProperty: () => {} }, setAttribute: () => {} },
    getElementById: () => ({ replaceChildren: () => {}, textContent: '' }),
  };
  const timers = new Set();
  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    ResizeObserver: class { observe() {} },
    installCodexSessionStatus: (_v, _r, embedded) => { embeddedSend = embedded.send; },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); if (id.unref) id.unref(); return id; },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); },
    JSON,
    Map,
    Set,
    Error,
    Promise,
    Date,
    Math,
  };
  fakeWindow.addEventListener = (type, fn) => {
    if (type === 'message') fakeWindow._onMessage = fn;
  };
  vm.runInNewContext(bridgeSrc, sandbox);
  const initMsg = postedRpc.find(m => m.method === 'ui/initialize');
  assert.ok(initMsg);
  fakeWindow._onMessage({ source: fakeWindow.parent, data: { jsonrpc: '2.0', id: initMsg.id, result: { hostContext: { theme: 'dark' } } } });
  fakeWindow._onMessage({
    source: fakeWindow.parent,
    data: {
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: {
        structuredContent: { conversationId, key: JSON.stringify(['local', conversationId]), snapshot: { revision: 0, records: {} }, lang: 'zh' },
        _meta: { cardToken },
      },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof embeddedSend, 'function');
  void embeddedSend(JSON.stringify({ type: 'app-update-info', requestId: 'r-force', force: true }));
  const callMsg = postedRpc.find(m => m.method === 'tools/call' && m.params?.arguments?.action === 'app-update-info');
  assert.ok(callMsg);
  assert.equal(callMsg.params.arguments.force, true);
  for (const id of timers) clearTimeout(id);
});

test('Claude inline endpoint and plugin UI handle check-update, upgrade, completion and failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-update-ui-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fakeSession = { sessionId: 'local_c1', cliSessionId: 'cli-c1', cwd: dir, title: 'Claude 升级验收' };
  const rpcCalls = [];
  const service = new ClaudeService({
    stateFile: path.join(dir, 'state.json'),
    localSource: { resolve: () => fakeSession },
  });
  t.after(() => service.stop());
  service.rpc = async msg => {
    rpcCalls.push(msg);
    if (msg.type === 'app-update-info') {
      return { error: null, updateInfo: { currentVersion: '1.3.2', latestVersion: msg.force ? '1.3.3' : '1.3.2', available: Boolean(msg.force) } };
    }
    return { error: null, updateInfo: { currentVersion: '1.3.2', available: true, update: { stage: 'queued' } } };
  };
  const inlineCheck = await service.inline({ action: 'update-info', force: true, sessionId: 'cli-c1', requestId: 'c1' });
  assert.equal(rpcCalls.at(-1).type, 'app-update-info');
  assert.equal(rpcCalls.at(-1).force, true);
  assert.equal(inlineCheck.updateInfo.available, true);

  // Test register.js interactive check-update -> available -> upgrade -> completed flow
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  const hooksDir = path.join(__dirname, '../mods/agent-things-ui/hooks');
  for (const name of fs.readdirSync(hooksDir)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(hooksDir, name), path.join(dir, name));
  }
  const reg = await import(`${pathToFileURL(path.join(dir, 'register.js')).href}?v=${Math.random()}`);
  const handlers = new Map();
  const afterQueue = [];
  let everyCb = null;
  let modeReply = { available: false, currentVersion: '1.3.2', latestVersion: '1.3.2', command: 'npx agent-things@latest', update: null };
  const seenActions = [];
  const uiNodes = {
    Box: props => ({ type: 'Box', props, children: props.children || [] }),
    Text: props => ({ type: 'Text', props, children: props.children || [] }),
    Button: props => ({ type: 'Button', props, children: [props.label] }),
    Input: props => ({ type: 'Input', props, children: [] }),
    Svg: props => ({ type: 'Svg', props, children: [] }),
    Client: props => ({ type: 'Client', props, children: [] }),
  };
  const $ = {
    env: { get: async () => dir },
    fs: { read: async () => JSON.stringify({ port: 29890, token: 't' }) },
    session: { id: async () => 'cli-c1', cwd: async () => dir },
    store: { get: async () => undefined, set: async () => {} },
    command: { register: async () => {} },
    clock: {
      sleep: () => new Promise(() => {}),
      after: (ms, fn) => { afterQueue.push({ ms, fn }); },
      every: (_ms, fn) => { everyCb = fn; },
    },
    ui: { resolve: () => uiNodes, open: async () => {}, invalidate: () => {} },
    http: {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        seenActions.push(body);
        if (body.action === 'watch') return new Promise(() => {});
        if (body.action === 'update-info') {
          if (body.force && seenActions.filter(b => b.action === 'update-info' && b.force).length >= 2) {
            modeReply = { available: true, currentVersion: '1.3.2', latestVersion: '1.3.3', command: 'npx agent-things@latest', update: null };
          }
          return { ok: true, status: 200, text: JSON.stringify({ lang: 'zh', updateInfo: modeReply }) };
        }
        if (body.action === 'upgrade') {
          modeReply = { available: true, currentVersion: '1.3.2', latestVersion: '1.3.3', command: 'npx agent-things@latest', update: { stage: 'installing' } };
          return { ok: true, status: 200, text: JSON.stringify({ lang: 'zh', updateInfo: modeReply }) };
        }
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            lang: 'zh',
            revision: 1,
            title: 'Claude 测试会话',
            record: { state: 'unfinished', progress: 50, note: '检查更新测试' },
            analysis: { ledger: { summary: '测试中', tasks: [] } },
            timeline: [],
          }),
        };
      },
    },
  };
  reg.register((event, matcherOrFn, maybeFn) => {
    const fn = typeof matcherOrFn === 'function' ? matcherOrFn : maybeFn;
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  });
  for (const fn of handlers.get('session.start') || []) await fn($, {}, () => {});
  // Flush clock.after(0) update-info init
  for (const entry of afterQueue.splice(0)) if (entry.ms === 0) await entry.fn();
  const renderPane = async () => handlers.get('ui.render')[1]($, { component: 'Pane', requestId: 'agent-things', props: { bodyColumns: 42 }, viewport: { columns: 42, rows: 50 } }, () => null);
  const findButtons = (node, key, acc = []) => {
    if (!node || typeof node === 'string') return acc;
    if (node.type === 'Button' && node.props?.key === key) acc.push(node);
    for (const c of node.children || []) findButtons(c, key, acc);
    return acc;
  };
  let tree = await renderPane();
  assert.ok(JSON.stringify(tree).includes('v1.3.2'));
  let checkBtn = findButtons(tree, 'check-update')[0];
  assert.equal(checkBtn.props.label, '检查更新');

  // 1st click: still latest -> shows 当前已是最新版 v1.3.2
  await checkBtn.props.onPress();
  assert.equal(seenActions.filter(b => b.action === 'update-info' && b.force === true).length, 1);
  tree = await renderPane();
  assert.ok(JSON.stringify(tree).includes('当前已是最新版 v1.3.2'));

  // 2nd click: new version found -> switches to 发现新版本 v1.3.3 + 立即升级
  checkBtn = findButtons(tree, 'check-update')[0];
  await checkBtn.props.onPress();
  tree = await renderPane();
  assert.ok(JSON.stringify(tree).includes('发现新版本 v1.3.3'));
  const upgradeBtn = findButtons(tree, 'upgrade')[0];
  assert.equal(upgradeBtn.props.label, '立即升级');

  // Click 立即升级 -> shows installing then completed with reconnect hint
  await upgradeBtn.props.onPress();
  tree = await renderPane();
  assert.ok(JSON.stringify(tree).includes('正在升级'));
  modeReply = { available: false, currentVersion: '1.3.3', latestVersion: '1.3.3', command: 'npx agent-things@latest', update: { stage: 'completed', currentVersion: '1.3.3', reconnectMcp: true, updatedAt: new Date().toISOString() } };
  assert.equal(typeof everyCb, 'function');
  await everyCb();
  tree = await renderPane();
  assert.ok(JSON.stringify(tree).includes('已升级至 v1.3.3'));
  assert.ok(JSON.stringify(tree).includes('请在客户端重新连接 MCP 服务'));
});

test('Antigravity host proxy forwards app-update-info (force) and app-update-start to daemon /rpc', async t => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-proxy-update-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const convId = 'ag-update-conv-1';
  const calls = [];
  let latestInfo = { currentVersion: '1.3.2', latestVersion: '1.3.3', available: true, command: 'npx agent-things@latest', update: null };
  const updates = {
    getUpdateInfo: async options => { calls.push({ type: 'info', ...options }); return latestInfo; },
    startUpdate: async () => { calls.push({ type: 'start' }); latestInfo = { ...latestInfo, update: { stage: 'queued' } }; },
  };
  const service = new AntigravityService({ port: 0, stateFile: path.join(tmpDir, 'manual-state.json'), brainDir: path.join(tmpDir, 'brain'), updates });
  const port = await service.start();
  t.after(() => service.stop());

  const harnessCode = fs.readFileSync(path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'), 'utf8');
  const receiveCalls = [];
  const listeners = new Map();
  const iframeWin = { location: { href: '' }, postMessage: () => {} };
  const fakeIframe = {
    isConnected: true,
    contentWindow: iframeWin,
    getAttribute: k => (k === 'data-testid' ? 'agent-embed-iframe' : null),
    closest: sel => (sel === '[data-testid="agent-embed"]' ? {} : null),
    addEventListener: () => {},
  };
  const fakeWindow = {
    location: { pathname: `/c/${convId}`, href: `https://127.0.0.1:50000/c/${convId}` },
    crypto: { getRandomValues: arr => arr.fill(7) },
    addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    __codexSessionStatus: { receive: snap => receiveCalls.push(snap) },
    __agentThingsConnection: { origin: `http://127.0.0.1:${port}`, token: service.http.credentials.token, brainDir: path.join(tmpDir, 'brain') },
  };
  const runner = new Function('window', 'document', 'fetch', 'SERVICE_ORIGIN', 'headers', `${harnessCode}\nreturn { security: window.__antigravityHarnessSecurity, dispose: window.__antigravityHarnessDispose };`);
  const { security, dispose } = runner(fakeWindow, { body: {}, querySelectorAll: () => [fakeIframe], querySelector: () => null }, fetch, `http://127.0.0.1:${port}`, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${service.http.credentials.token}`,
  });
  t.after(() => dispose?.());

  const artifact = require('../src/antigravity-card.cjs').generateCardArtifact({
    conversationId: convId,
    brainDir: path.join(tmpDir, 'brain', convId),
    stateFile: service.stateFile,
    connection: { origin: `http://127.0.0.1:${port}` },
  });
  let injected = '';
  await security.handleSrcdocSetter(fakeIframe, fs.readFileSync(artifact.path, 'utf8'), val => { injected = val; });
  const tokenMatch = injected.match(/window\.__agentThingsLoadToken\s*=\s*"([^"]+)"/);
  assert.ok(tokenMatch, 'Host must inject loadToken into card html');

  const replies = [];
  const cardPort = {
    onmessage: null,
    postMessage: msg => replies.push(msg),
    close: () => {},
  };
  const onMsgHandlers = [...(listeners.get('message') || [])];
  assert.ok(onMsgHandlers.length >= 1);
  for (const fn of onMsgHandlers) {
    await fn({ source: iframeWin, ports: [cardPort], data: { type: 'AGENT_THINGS_AUTH_REQUEST', conversationId: convId, nonce: 'auth-1', loadToken: tokenMatch[1] } });
  }
  assert.ok(replies.some(r => r.type === 'AGENT_THINGS_AUTH_RESPONSE' && r.ticket));

  await cardPort.onmessage({ data: { type: 'AGENT_THINGS_ACTION_PROXY', conversationId: convId, nonce: 'upd-check-1', action: 'app-update-info', payload: { force: true } } });
  const checkReply = replies.find(r => r.nonce === 'upd-check-1');
  assert.equal(checkReply.success, true);
  assert.equal(checkReply.updateInfo.latestVersion, '1.3.3');
  assert.deepEqual(calls[0], { type: 'info', force: true });
  assert.equal(receiveCalls.length, 0, 'Update check proxy must not trigger task snapshot push');

  await cardPort.onmessage({ data: { type: 'AGENT_THINGS_ACTION_PROXY', conversationId: convId, nonce: 'upd-start-1', action: 'app-update-start', payload: {} } });
  const startReply = replies.find(r => r.nonce === 'upd-start-1');
  assert.equal(startReply.success, true);
  assert.equal(startReply.updateInfo.update.stage, 'queued');
  assert.equal(calls[1].type, 'start');
});

test('Antigravity Things sidecar main.mjs and index.html support update checks and one-click upgrades', async () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '../src/plugins/things/sidecars/things_board/main.mjs'), 'utf8');
  assert.ok(mainSrc.includes('window.__agentThingsUpdateBannerState='), 'main.mjs should inject shared updateBannerState helper');
  assert.ok(mainSrc.includes("action === 'app-update-info' || action === 'app-update-start'"), 'main.mjs should handle update actions without requiring convId');

  const html = fs.readFileSync(path.join(__dirname, '../src/plugins/things/sidecars/things_board/index.html'), 'utf8');
  assert.ok(html.includes('id="appUpdateBox" hidden'));
  assert.ok(html.includes('id="btnAppUpdate"'));
  assert.ok(html.includes('id="versionBar"'));
  assert.ok(html.includes('id="btnCheckUpdate"'));

  const { createPresentation } = require('../src/ui-foundation.cjs');
  const pres = createPresentation('zh');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const inlineScript = scripts.at(-1)[1];
  const elements = new Map();
  const makeEl = id => {
    const el = { id, hidden: false, disabled: false, textContent: '', value: '', attributes: {}, classList: { classes: new Set(), add(c) { this.classes.add(c); }, remove(c) { this.classes.delete(c); }, toggle(c) { return this.classes.has(c) ? (this.classes.delete(c), false) : (this.classes.add(c), true); }, contains(c) { return this.classes.has(c); } }, setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
    elements.set(id, el);
    return el;
  };
  for (const id of ['appUpdateBox', 'appUpdateLabel', 'btnAppUpdate', 'appUpdateDetail', 'versionBar', 'versionBarText', 'btnCheckUpdate', 'btnAnalyze']) makeEl(id);

  let mode = 'latest';
  const fetchCalls = [];
  const activeTimers = new Set();
  const fakeWindow = {
    location: { search: '' },
    __agentThingsLang: 'zh',
    __agentThingsUpdateBannerState: pres.updateBannerState,
    __agentThingsI18n: { lang: 'zh', labels: pres.labels, taskLabels: pres.taskLabels, colors: pres.colors, strings: pres.strings, locales: pres.locales },
    addEventListener: () => {},
  };
  const fakeDocument = {
    readyState: 'loading',
    documentElement: { lang: 'zh-CN', style: { setProperty: () => {} }, setAttribute: () => {}, getAttribute: () => 'dark' },
    getElementById: id => elements.get(id) || makeEl(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
  };
  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    navigator: { language: 'zh-CN' },
    fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      fetchCalls.push({ url, body });
      if (url === '/api/action' && body.action === 'app-update-info') {
        const updateInfo = mode === 'latest'
          ? { currentVersion: '1.3.2', latestVersion: '1.3.2', available: false, command: 'npx agent-things@latest', update: null }
          : mode === 'available'
            ? { currentVersion: '1.3.2', latestVersion: '1.3.3', available: true, command: 'npx agent-things@latest', update: null }
            : { currentVersion: '1.3.2', latestVersion: '1.3.3', available: true, command: 'npx agent-things@latest', update: { stage: 'installing' } };
        return { ok: true, json: async () => ({ updateInfo }) };
      }
      if (url === '/api/action' && body.action === 'app-update-start') {
        mode = 'installing';
        return { ok: true, json: async () => ({ updateInfo: { currentVersion: '1.3.2', latestVersion: '1.3.3', available: true, command: 'npx agent-things@latest', update: { stage: 'installing' } } }) };
      }
      return { ok: true, json: async () => ({}) };
    },
    URLSearchParams,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); activeTimers.add(id); if (id.unref) id.unref(); return id; },
    clearTimeout: id => { activeTimers.delete(id); clearTimeout(id); },
    setInterval: () => 0,
    clearInterval: () => {},
    EventSource: class { addEventListener() {} close() {} },
    Date,
    Math,
    JSON,
    Map,
    Set,
    Error,
    Promise,
  };
  try {
    vm.runInNewContext(`${inlineScript}\nwindow.__sidecarTest = { pollAppUpdate, onCheckUpdateClick, onUpgradeClick };`, sandbox);
    await fakeWindow.__sidecarTest.pollAppUpdate();
    assert.equal(elements.get('versionBar').hidden, false);
    assert.equal(elements.get('versionBarText').textContent, 'v1.3.2');
    assert.equal(elements.get('appUpdateBox').hidden, true);

    mode = 'available';
    await fakeWindow.__sidecarTest.onCheckUpdateClick();
    const forceCall = fetchCalls.find(c => c.url === '/api/action' && c.body?.action === 'app-update-info' && c.body?.payload?.force === true);
    assert.ok(forceCall, 'Clicking 检查更新 must pass payload.force = true even when conversationId is empty');
    assert.equal(elements.get('versionBar').hidden, true);
    assert.equal(elements.get('appUpdateBox').hidden, false);
    assert.equal(elements.get('appUpdateLabel').textContent, '发现新版本 v1.3.3');
    assert.equal(elements.get('btnAppUpdate').textContent, '立即升级');

    await fakeWindow.__sidecarTest.onUpgradeClick();
    assert.ok(fetchCalls.some(c => c.url === '/api/action' && c.body?.action === 'app-update-start'));
    assert.equal(elements.get('appUpdateLabel').textContent, '正在升级');
    assert.equal(elements.get('btnAnalyze').disabled, true);
  } finally {
    for (const id of activeTimers) clearTimeout(id);
  }
});
