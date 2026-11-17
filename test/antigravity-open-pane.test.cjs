'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harnessSource = fs.readFileSync(
  path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'),
  'utf8',
);

function createMockClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...cls) => cls.forEach(c => set.add(c)),
    remove: (...cls) => cls.forEach(c => set.delete(c)),
    contains: c => set.has(c),
  };
}

function createHarnessTestEnv({
  convId = 'conv-1',
  brainDir = '/tmp/mock-brain',
  rootFiber = null,
  sidebarRows = [],
  domNodes = {},
  fetchImpl = null,
} = {}) {
  const listeners = new Map();
  const fakeWindow = {
    location: {
      pathname: `/c/${convId}`,
      href: `https://127.0.0.1:55327/c/${convId}?tab=file__preview`,
    },
    __agentThingsConnection: {
      origin: 'http://127.0.0.1:39999',
      token: 'test-token',
      brainDir,
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };

  const rootEl = rootFiber ? { __reactContainer$test: rootFiber } : null;

  const selectorMap = {
    '#root': () => rootEl,
    '.agy-sidebar-row[data-cascade-id]': () => sidebarRows,
    ...domNodes,
  };

  const fakeDocument = {
    body: { firstElementChild: rootEl },
    querySelector(selector) {
      const entry = selectorMap[selector];
      const val = typeof entry === 'function' ? entry() : entry;
      if (Array.isArray(val)) return val[0] || null;
      return val || null;
    },
    querySelectorAll(selector) {
      const entry = selectorMap[selector];
      const val = typeof entry === 'function' ? entry() : entry;
      if (!val) return [];
      return Array.isArray(val) ? val : [val];
    },
  };

  const defaultFetch = async (url) => {
    if (String(url).includes('/session/verify-artifact')) {
      return { ok: true, json: async () => ({ valid: true }) };
    }
    if (String(url).includes('/session/ticket')) {
      return {
        ok: true,
        json: async () => ({ ticket: 'ticket-open-pane', expiresAt: Date.now() + 60000 }),
      };
    }
    return { ok: true, json: async () => ({ snapshot: { revision: 1, records: {} } }) };
  };

  const runner = new Function(
    'window',
    'document',
    'fetch',
    'SERVICE_ORIGIN',
    'headers',
    `${harnessSource}
    return {
      harness: window.__sessionStatusHarness,
      security: window.__antigravityHarnessSecurity,
      dispose: window.__antigravityHarnessDispose,
    };`,
  );

  const result = runner(
    fakeWindow,
    fakeDocument,
    fetchImpl || defaultFetch,
    fakeWindow.__agentThingsConnection.origin,
    { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
  );

  return { ...result, fakeWindow, fakeDocument, listeners };
}

function createDescriptor({ sidecarId = 'things/things_board', baseUrl = 'http://127.0.0.1:4100/sidecar' } = {}) {
  return {
    sidecarId,
    baseUrl,
    config: {
      uiConfig: {
        displayName: 'Things',
        views: [{ entrypoint: 1, path: '/', title: 'Things' }],
      },
    },
  };
}

function createFiberChain({ store, ext, sidecarPool, router, onSidecarLinkClick }) {
  const leaf = {
    memoizedProps: {
      onSidecarLinkClick,
      router,
    },
    child: null,
    sibling: null,
  };
  const mid = {
    memoizedProps: {
      value: sidecarPool,
    },
    child: leaf,
    sibling: null,
  };
  const extNode = {
    memoizedProps: {
      value: ext ? { get: k => (k === 'extensibility' ? ext : null), router } : null,
    },
    child: mid,
    sibling: null,
  };
  return {
    memoizedProps: { store },
    child: extNode,
    sibling: null,
  };
}

test('Level 1：通过 React Fiber onSidecarLinkClick 打开当前会话侧栏插件', async () => {
  const convId = 'conv-level-1';
  const sidecarLinks = [];
  const state = {
    sidePanel: { conversationPanes: {} },
    sidePanelV2: { conversationPanes: {} },
  };
  const store = {
    getState: () => state,
    dispatch: () => {},
  };
  const ext = {
    provider: { getState: () => [createDescriptor()] },
    resolveSidecarUrl: (base, p) => `${base}${p === '/' ? '' : p}`,
  };
  const rootFiber = createFiberChain({
    store,
    ext,
    onSidecarLinkClick: id => {
      sidecarLinks.push(id);
      state.sidePanel.conversationPanes[convId] = { isPaneOpen: true, activeTabId: 'sidecar__things/things_board__/' };
      state.sidePanelV2.conversationPanes[convId] = { activeTabId: 'sidecar__things/things_board__/' };
    },
  });

  const env = createHarnessTestEnv({ convId, rootFiber });
  try {
    const res = await env.harness.openPane({ entry: { threadId: convId } });
    assert.deepEqual(sidecarLinks, ['things/things_board']);
    assert.deepEqual(res, {
      ok: true,
      method: 'onSidecarLinkClick',
      conversationId: convId,
    });
  } finally {
    env.dispose?.();
  }
});

test('跨会话切换 + Level 2：切换会话后通过 sidecarPool + Redux + router.navigate 打开侧栏', async () => {
  const initialConv = 'conv-old';
  const targetConv = 'conv-target';
  const dispatches = [];
  const navigatedUrls = [];
  const routerSearchUpdates = [];

  const state = {
    sidePanel: { conversationPanes: {} },
    sidePanelV2: { conversationPanes: {} },
  };

  const store = {
    getState: () => state,
    dispatch(action) {
      dispatches.push(action);
      if (action.type === 'sidePanelV2/setContent') {
        state.sidePanelV2.conversationPanes[targetConv] = { activeTabId: action.payload.tabId };
      } else if (action.type === 'sidePanel/setSidePanelOpen') {
        state.sidePanel.conversationPanes[targetConv] = {
          ...(state.sidePanel.conversationPanes[targetConv] || {}),
          isPaneOpen: action.payload.isOpen,
        };
      }
    },
  };

  const ext = {
    provider: { getState: () => [createDescriptor()] },
    resolveSidecarUrl: base => base,
  };

  const sidecarPool = {
    navigateIframe(baseViewUrl, targetUrl) {
      navigatedUrls.push({ baseViewUrl, targetUrl });
    },
  };

  let currentRouterQuery = { tab: 'file__old' };
  const router = {
    navigate({ search, replace }) {
      currentRouterQuery = search(currentRouterQuery);
      routerSearchUpdates.push({ query: currentRouterQuery, replace });
    },
  };

  const targetRow = {
    getAttribute(attr) {
      if (attr === 'data-cascade-id') return targetConv;
      if (attr === 'data-selected') return env.fakeWindow.location.pathname.endsWith(targetConv) ? 'true' : 'false';
      return null;
    },
    classList: createMockClassList(),
    querySelector(sel) {
      if (sel === 'a') {
        return {
          click() {
            env.fakeWindow.location.pathname = `/c/${targetConv}`;
            targetRow.classList.add('bg-sidebar-secondary');
          },
        };
      }
      return null;
    },
    click() {
      env.fakeWindow.location.pathname = `/c/${targetConv}`;
    },
  };

  const rootFiber = createFiberChain({ store, ext, sidecarPool, router });
  const env = createHarnessTestEnv({
    convId: initialConv,
    rootFiber,
    sidebarRows: [targetRow],
  });

  try {
    const res = await env.harness.openPane({ entry: { threadId: targetConv } });
    assert.equal(env.fakeWindow.location.pathname, `/c/${targetConv}`, '必须先切换到目标会话');
    assert.deepEqual(navigatedUrls, [{
      baseViewUrl: 'http://127.0.0.1:4100/sidecar',
      targetUrl: `http://127.0.0.1:4100/sidecar?conversationId=${targetConv}`,
    }]);
    assert.equal(dispatches[0].type, 'sidePanelV2/setContent');
    assert.deepEqual(dispatches[0].payload.treeId, { kind: 'cascadeId', cascadeId: targetConv });
    assert.equal(dispatches[0].payload.tabId, 'sidecar__things/things_board__/');
    assert.equal(dispatches[1].type, 'sidePanel/setSidePanelOpen');
    assert.equal(dispatches[1].payload.isOpen, true);
    assert.equal(routerSearchUpdates[0].query.tab, 'sidecar__things/things_board__/');
    assert.equal(routerSearchUpdates[0].replace, true);
    assert.deepEqual(res, {
      ok: true,
      method: 'reduxStore',
      conversationId: targetConv,
    });
  } finally {
    env.dispose?.();
  }
});

test('Level 3：无 Fiber 控制权时通过 DOM Fallback 打开侧栏插件', async () => {
  const convId = 'conv-dom-fallback';
  let auxExpanded = false;
  let slotVisible = false;
  const clicks = [];

  const toggleBtn = {
    getAttribute: attr => (attr === 'aria-expanded' ? String(auxExpanded) : null),
    click() {
      clicks.push('toggle');
      auxExpanded = true;
    },
  };

  const submenuItem = {
    click() {
      clicks.push('submenu');
      slotVisible = true;
    },
  };

  const slot = {
    getBoundingClientRect: () => ({ width: slotVisible ? 360 : 0 }),
  };

  const env = createHarnessTestEnv({
    convId,
    rootFiber: null,
    domNodes: {
      '[data-testid="toggle-aux-sidebar"]': () => toggleBtn,
      '[data-testid="plugins-submenu-item"][data-sidecar-id="things/things_board"]': () => submenuItem,
      '[data-testid="sidecar-iframe-slot"][data-sidecar-id="things/things_board"][data-visible="true"]': () => (slotVisible ? slot : null),
    },
  });

  try {
    const res = await env.harness.openPane({ entry: { threadId: convId } });
    assert.deepEqual(clicks, ['toggle', 'submenu']);
    assert.deepEqual(res, {
      ok: true,
      method: 'domFallback',
      conversationId: convId,
    });
  } finally {
    env.dispose?.();
  }
});

test('插件未启用时给出明确错误而非静默失败', async () => {
  const convId = 'conv-disabled';
  const rootFiber = createFiberChain({
    store: { getState: () => ({}), dispatch: () => {} },
    ext: { provider: { getState: () => [] } },
  });
  const env = createHarnessTestEnv({ convId, rootFiber });

  try {
    await assert.rejects(
      () => env.harness.openPane({ entry: { threadId: convId } }),
      /Things 侧边栏插件未启用/,
    );
  } finally {
    env.dispose?.();
  }
});

test('Card 专属端口处理 AGENT_THINGS_OPEN_PANE：防越权与成功/失败回包', async () => {
  const convId = 'conv-card-port';
  const brainDir = '/tmp/mock-brain';
  const cardSrc = `file://${brainDir}/${convId}/things-card.html`;

  let pluginEnabled = true;
  const state = {
    sidePanel: { conversationPanes: {} },
    sidePanelV2: { conversationPanes: {} },
  };
  const rootFiber = createFiberChain({
    store: { getState: () => state, dispatch: () => {} },
    ext: {
      provider: { getState: () => (pluginEnabled ? [createDescriptor()] : []) },
      resolveSidecarUrl: base => base,
    },
    onSidecarLinkClick: id => {
      assert.equal(id, 'things/things_board');
      state.sidePanel.conversationPanes[convId] = { isPaneOpen: true, activeTabId: 'sidecar__things/things_board__/' };
      state.sidePanelV2.conversationPanes[convId] = { activeTabId: 'sidecar__things/things_board__/' };
    },
  });

  const env = createHarnessTestEnv({ convId, brainDir, rootFiber });
  try {
    const replies = [];
    const mockPort = {
      postMessage: msg => replies.push(msg),
      close: () => {},
    };
    const validIframe = {
      src: cardSrc,
      isConnected: true,
      contentWindow: { location: { href: cardSrc } },
    };

    const loadToken = 'tok-open-pane';
    const digest = 'a'.repeat(64);
    assert.equal(env.security.registerCardIframe(validIframe, convId, { loadToken, digest }), true);

    await env.security.onCardMessage({
      source: validIframe.contentWindow,
      ports: [mockPort],
      data: {
        type: 'AGENT_THINGS_AUTH_REQUEST',
        nonce: 'auth-open-1',
        conversationId: convId,
        loadToken,
      },
    });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].type, 'AGENT_THINGS_AUTH_RESPONSE');
    assert.equal(typeof mockPort.onmessage, 'function');
    replies.length = 0;

    // 1. 跨会话请求被拒绝，不触发侧栏打开
    await mockPort.onmessage({
      data: {
        type: 'AGENT_THINGS_OPEN_PANE',
        nonce: 'open-cross',
        conversationId: 'conv-other',
      },
    });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].type, 'AGENT_THINGS_ACTION_RESULT');
    assert.equal(replies[0].nonce, 'open-cross');
    assert.equal(replies[0].success, false);
    assert.match(replies[0].error, /禁止跨会话操作/);
    replies.length = 0;

    // 2. 同会话合法请求成功打开并返回 open-pane 结果
    await mockPort.onmessage({
      data: {
        type: 'AGENT_THINGS_OPEN_PANE',
        nonce: 'open-ok',
        conversationId: convId,
      },
    });
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0], {
      type: 'AGENT_THINGS_ACTION_RESULT',
      nonce: 'open-ok',
      action: 'open-pane',
      success: true,
      data: { opened: true, conversationId: convId },
    });
    replies.length = 0;

    // 3. 插件禁用时回传业务失败结果
    pluginEnabled = false;
    state.sidePanel.conversationPanes[convId] = { isPaneOpen: false };
    await mockPort.onmessage({
      data: {
        type: 'AGENT_THINGS_OPEN_PANE',
        nonce: 'open-disabled',
        conversationId: convId,
      },
    });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].type, 'AGENT_THINGS_ACTION_RESULT');
    assert.equal(replies[0].nonce, 'open-disabled');
    assert.equal(replies[0].action, 'open-pane');
    assert.equal(replies[0].success, false);
    assert.match(replies[0].error, /Things 侧边栏插件未启用/);
  } finally {
    env.dispose?.();
  }
});

test('侧边栏已打开或具备 setIframeSrc 时零重载打开/唤醒，不触发 onSidecarLinkClick 与 navigateIframe', async () => {
  const convId = 'conv-no-reload';
  let onSidecarLinkCalls = 0;
  let navigateCalls = 0;
  const setSrcCalls = [];
  const state = {
    sidePanel: { conversationPanes: { [convId]: { isPaneOpen: true, activeTabId: 'sidecar__things/things_board__/' } } },
    sidePanelV2: { conversationPanes: { [convId]: { activeTabId: 'sidecar__things/things_board__/' } } },
  };
  const store = {
    getState: () => state,
    dispatch(action) {
      if (action.type === 'sidePanelV2/setContent') {
        state.sidePanelV2.conversationPanes[convId] = { activeTabId: action.payload.tabId };
      } else if (action.type === 'sidePanel/setSidePanelOpen') {
        state.sidePanel.conversationPanes[convId] = {
          ...(state.sidePanel.conversationPanes[convId] || {}),
          isPaneOpen: action.payload.isOpen,
        };
      }
    },
  };
  const ext = {
    provider: { getState: () => [createDescriptor()] },
    resolveSidecarUrl: base => base,
  };
  const rootFiber = createFiberChain({
    store,
    ext,
    onSidecarLinkClick: () => { onSidecarLinkCalls++; },
    sidecarPool: {
      setIframeSrc: (key, url) => { setSrcCalls.push({ key, url }); },
      navigateIframe: () => { navigateCalls++; },
    },
    router: { navigate: () => {} },
  });

  const env = createHarnessTestEnv({ convId, rootFiber });
  try {
    const resAlready = await env.harness.openPane({ entry: { threadId: convId } });
    assert.deepEqual(resAlready, { ok: true, method: 'alreadyOpen', conversationId: convId });
    assert.equal(onSidecarLinkCalls, 0);
    assert.equal(navigateCalls, 0);
    assert.equal(setSrcCalls.length, 0);

    // 切到其他 Tab 后重新打开，走 setIframeSrc + Redux 路径而不触发 forceReload / navigateIframe
    state.sidePanelV2.conversationPanes[convId].activeTabId = 'file__other';
    const resReopen = await env.harness.openPane({ entry: { threadId: convId } });
    assert.deepEqual(resReopen, { ok: true, method: 'reduxStore', conversationId: convId });
    assert.equal(onSidecarLinkCalls, 0);
    assert.equal(navigateCalls, 0);
    assert.deepEqual(setSrcCalls, [{
      key: `http://127.0.0.1:4100/sidecar?conversationId=${convId}`,
      url: `http://127.0.0.1:4100/sidecar?conversationId=${convId}`,
    }]);
  } finally {
    env.dispose?.();
  }
});
