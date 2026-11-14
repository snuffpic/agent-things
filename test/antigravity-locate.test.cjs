'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const harnessSource = fs.readFileSync(
  path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'),
  'utf8',
);

const sidecarHtml = fs.readFileSync(
  path.join(__dirname, '../src/plugins/things/sidecars/things_board/index.html'),
  'utf8',
);

const sidecarMain = fs.readFileSync(
  path.join(__dirname, '../src/plugins/things/sidecars/things_board/main.mjs'),
  'utf8',
);

function makeNode({
  testId = null,
  textContent = '',
  attrs = {},
  children = [],
  parentElement = null,
  onClick = null,
} = {}) {
  let ownText = textContent;
  const node = {
    get textContent() {
      if (ownText) return ownText;
      return (this.children || []).map((c) => c.textContent || '').join(' ');
    },
    set textContent(v) {
      ownText = String(v || '');
    },
    style: {},
    parentElement,
    children,
    scrollIntoViewCalled: null,
    clicked: 0,
    disabled: false,
    getAttribute(name) {
      if (name === 'data-testid') return testId;
      return attrs[name] ?? null;
    },
    click() {
      this.clicked += 1;
      if (onClick) onClick(this);
    },
    scrollIntoView(opts) {
      this.scrollIntoViewCalled = opts;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
      const out = [];
      const walk = (item) => {
        for (const child of item.children || []) {
          if (matchesSelector(child, parts)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    },
  };
  for (const c of children) c.parentElement = node;
  return node;
}

function matchesSelector(node, selectors) {
  for (const sel of selectors) {
    const testIdMatch = sel.match(/^\[data-testid="([^"]+)"\]$/);
    if (testIdMatch) {
      if (node.getAttribute?.('data-testid') === testIdMatch[1]) return true;
      continue;
    }
    const turnMatch = sel.match(/^\[data-testid="conversation-navigator-turn"\]\[data-turn-index="(\d+)"\]$/);
    if (turnMatch) {
      if (
        node.getAttribute?.('data-testid') === 'conversation-navigator-turn' &&
        node.getAttribute?.('data-turn-index') === turnMatch[1]
      ) {
        return true;
      }
      continue;
    }
    const ariaStartsMatch = sel.match(/^button\[aria-label\^="([^"]+)"\]$/);
    if (ariaStartsMatch) {
      const aria = node.getAttribute?.('aria-label') || '';
      if (node.attrsTag === 'button' && aria.startsWith(ariaStartsMatch[1])) return true;
      continue;
    }
    if (sel === 'button' && node.attrsTag === 'button') return true;
    if (sel === (node.tagName || '').toLowerCase()) return true;
  }
  return false;
}

function createLocateTestEnv({
  convId = 'conv-locate-1',
  sidebarRows = [],
  viewportChildren = [],
  navTurns = [],
  navGroups = [],
  olderButtons = [],
  extraSelectors = {},
} = {}) {
  const listeners = new Map();
  const fakeWindow = {
    location: {
      pathname: `/c/${convId}`,
      href: `https://127.0.0.1:55327/c/${convId}`,
    },
    __agentThingsConnection: {
      origin: 'http://127.0.0.1:39999',
      token: 'test-token',
      brainDir: '/tmp/mock-brain',
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };

  const viewport = makeNode({
    testId: 'autoscroll-viewport',
    children: viewportChildren,
  });

  const selectorHandlers = {
    '[data-testid="autoscroll-viewport"]': () => viewport,
    '.agy-sidebar-row[data-cascade-id]': () => sidebarRows,
    '[data-testid="conversation-navigator-group"]': () => navGroups,
    button: () => olderButtons,
    ...extraSelectors,
  };

  const fakeDocument = {
    body: viewport,
    querySelector(selector) {
      const turnMatch = selector.match(/^\[data-testid="conversation-navigator-turn"\]\[data-turn-index="(\d+)"\]$/);
      if (turnMatch) {
        return navTurns.find((n) => n.getAttribute('data-turn-index') === turnMatch[1]) || null;
      }
      if (selector === 'button[aria-label^="Load older messages"]') {
        return olderButtons.find((b) => (b.getAttribute('aria-label') || '').startsWith('Load older messages')) || null;
      }
      const direct = selectorHandlers[selector];
      if (direct) {
        const v = typeof direct === 'function' ? direct() : direct;
        return Array.isArray(v) ? (v[0] || null) : (v || null);
      }
      return viewport.querySelector(selector);
    },
    querySelectorAll(selector) {
      const direct = selectorHandlers[selector];
      if (direct) {
        const v = typeof direct === 'function' ? direct() : direct;
        return Array.isArray(v) ? v : (v ? [v] : []);
      }
      return viewport.querySelectorAll(selector);
    },
  };

  const fetchImpl = async (url) => {
    if (String(url).includes('/session/verify-artifact')) {
      return { ok: true, json: async () => ({ valid: true }) };
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
      dispose: window.__antigravityHarnessDispose,
    };`,
  );

  const result = runner(
    fakeWindow,
    fakeDocument,
    fetchImpl,
    fakeWindow.__agentThingsConnection.origin,
    { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
  );

  return { ...result, fakeWindow, fakeDocument, viewport, listeners };
}

test('harness.locate matches assistant agent-response with Markdown normalization', async () => {
  const p = makeNode({ textContent: '已完成 /things 卡片刷新并验证通过' });
  p.tagName = 'p';
  const agentResp = makeNode({
    testId: 'agent-response',
    children: [p],
  });

  const env = createLocateTestEnv({
    convId: 'conv-md',
    viewportChildren: [agentResp],
  });
  try {
    const res = await env.harness.locate({
      entry: { threadId: 'conv-md' },
      source: { turnId: '8', locator: '已完成 `/things` 卡片刷新' },
      analysisMessage: {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.located, true);
    assert.equal(p.scrollIntoViewCalled?.block, 'center');
  } finally {
    env.dispose?.();
  }
});

test('harness.locate switches across conversations before locating message', async () => {
  const targetBubble = makeNode({
    testId: 'user-message-bubble',
    textContent: '请为 Antigravity 添加右侧跳转来源功能',
  });
  const targetStep = makeNode({
    testId: 'user-input-step',
    children: [targetBubble],
  });

  let envRef = null;
  const rowTarget = {
    classList: { contains: () => false },
    querySelector: () => null,
    getAttribute(name) {
      if (name === 'data-cascade-id') return 'conv-target';
      return null;
    },
    click() {
      envRef.fakeWindow.location.pathname = '/c/conv-target';
      envRef.fakeWindow.location.href = 'https://127.0.0.1:55327/c/conv-target';
      envRef.viewport.children = [targetStep];
      targetStep.parentElement = envRef.viewport;
    },
    dispatchEvent() {},
    scrollIntoView() {},
  };

  envRef = createLocateTestEnv({
    convId: 'conv-current',
    sidebarRows: [rowTarget],
    viewportChildren: [],
  });

  try {
    const res = await envRef.harness.locate({
      entry: { threadId: 'conv-target' },
      source: { turnId: '2', locator: 'Antigravity 添加右侧跳转来源' },
      analysisMessage: {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.located, true);
    assert.equal(envRef.fakeWindow.location.pathname, '/c/conv-target');
    assert.equal(targetBubble.scrollIntoViewCalled?.block, 'center');
  } finally {
    envRef.dispose?.();
  }
});

test('harness.locate expands chapter group and clicks Load older messages until target mounts', async () => {
  const olderBubble = makeNode({
    testId: 'user-message-bubble',
    textContent: '旧对话历史需求：排查状态卡住问题',
  });
  const olderStep = makeNode({
    testId: 'user-input-step',
    children: [olderBubble],
  });

  let olderClicks = 0;
  let envRef = null;
  const chapterGroup = makeNode({
    testId: 'conversation-navigator-group',
    attrs: { 'aria-label': '11月12日周四, 0:10 – 15:54, 21 turns' },
    onClick() {},
  });
  const loadOlderBtn = {
    attrsTag: 'button',
    textContent: 'Load older messages',
    disabled: false,
    getAttribute(name) {
      if (name === 'aria-label') return `Load older messages, showing ${200 + olderClicks * 50} of 1000`;
      return null;
    },
    click() {
      olderClicks += 1;
      if (olderClicks >= 3) {
        envRef.viewport.children = [olderStep];
        olderStep.parentElement = envRef.viewport;
      }
    },
  };

  envRef = createLocateTestEnv({
    convId: 'conv-long',
    viewportChildren: [],
    navGroups: [chapterGroup],
    olderButtons: [loadOlderBtn],
  });

  try {
    const res = await envRef.harness.locate({
      entry: { threadId: 'conv-long' },
      source: { turnId: '5', locator: '排查状态卡住问题' },
      analysisMessage: {},
    });
    assert.equal(res.ok, true);
    assert.equal(res.located, true);
    assert.equal(chapterGroup.clicked, 1, '命中对应章节范围应先展开章节');
    assert.equal(olderClicks, 3, '应连续加载历史消息直到目标挂载');
    assert.equal(olderBubble.scrollIntoViewCalled?.block, 'center');
  } finally {
    envRef.dispose?.();
  }
});

test('harness.locate returns located=false when source cannot be found', async () => {
  const env = createLocateTestEnv({
    convId: 'conv-missing',
    viewportChildren: [],
  });
  try {
    const res = await env.harness.locate({
      entry: { threadId: 'conv-missing' },
      source: { locator: '完全不存在的一段文本' },
      analysisMessage: {},
    });
    assert.equal(res.ok, false);
    assert.equal(res.located, false);
  } finally {
    env.dispose?.();
  }
});

test('window AGENT_THINGS_LOCATE posts AGENT_THINGS_LOCATE_RESULT back to verified frame', async () => {
  const p = makeNode({ textContent: '卡片来源锚点测试内容' });
  p.tagName = 'p';
  const step = makeNode({ testId: 'agent-response', children: [p] });

  const env = createLocateTestEnv({
    convId: 'conv-msg',
    viewportChildren: [step],
  });

  const postedBack = [];
  const cardWindow = {
    postMessage(msg, targetOrigin) {
      postedBack.push({ msg, targetOrigin });
    },
  };
  const cardIframe = {
    contentWindow: cardWindow,
    getAttribute(name) {
      if (name === 'data-testid') return 'artifact-dynamic-ui-iframe';
      if (name === 'src') return 'http://127.0.0.1:4100/card.html';
      return null;
    },
    closest() {
      return null;
    },
  };
  env.fakeDocument.querySelectorAll = (selector) => {
    if (selector === 'iframe') return [cardIframe];
    if (selector === '[data-testid="autoscroll-viewport"]') return [env.viewport];
    return env.viewport.querySelectorAll(selector);
  };

  try {
    const messageListeners = [...(env.listeners.get('message') || [])];
    assert.equal(messageListeners.length, 1, '不应残留重复的 window message locate 监听器');
    for (const fn of messageListeners) {
      fn({
        source: cardWindow,
        origin: 'http://127.0.0.1:4100',
        data: {
          type: 'AGENT_THINGS_LOCATE',
          conversationId: 'conv-msg',
          nonce: 'loc-nonce-1',
          source: { locator: '卡片来源锚点测试内容' },
        },
      });
    }
    await new Promise((r) => setTimeout(r, 80));
    const locateRes = postedBack.find((item) => item.msg?.type === 'AGENT_THINGS_LOCATE_RESULT');
    assert.ok(locateRes, '应回复 AGENT_THINGS_LOCATE_RESULT');
    assert.equal(locateRes.msg.nonce, 'loc-nonce-1');
    assert.equal(locateRes.msg.located, true);
    assert.equal(p.scrollIntoViewCalled?.block, 'center');
  } finally {
    env.dispose?.();
  }
});

test('things_board sidebar aligns with Claude Figure 2 task-source hover button and /api/locate jump protocol', () => {
  assert.ok(sidecarHtml.includes('.task-source'), '侧栏样式应使用统一的 .task-source 悬停滑入容器');
  assert.ok(!sidecarHtml.includes('查看来源 ▾'), '侧栏不应再渲染带下箭头的 查看来源 ▾');
  assert.ok(!sidecarHtml.includes('class="source-quote"'), '侧栏不应保留内联展开的 source-quote');
  assert.ok(sidecarHtml.includes("await fetch('/api/locate'"), '侧栏 onSourceClick 应等待 /api/locate 的真实定位结果');

  assert.ok(sidecarMain.includes('window.__sessionStatusHarness'), '侧栏 /api/locate 应优先调用宿主 __sessionStatusHarness.locate');
  assert.ok(sidecarMain.includes('awaitPromise: true'), '侧栏 CDP Runtime.evaluate 必须 awaitPromise 获取真实结果');
  assert.ok(sidecarMain.includes('[data-testid="agent-response"]'), '侧栏兜底脚本应兼容助手回答气泡定位');
});
