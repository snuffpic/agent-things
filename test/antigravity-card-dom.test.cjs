'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { renderAntigravityCardHtml } = require('../src/antigravity-card.cjs');

function createCardDomFixture({ initialProgress = 50, initialRevision = 10, convId = 'dom-test-conv', initialRecord = undefined } = {}) {
  const elements = new Map();

  function makeEl(id, tagName = 'div') {
    const el = {
      id,
      tagName: tagName.toUpperCase(),
      style: {
        display: '',
        setProperty(k, v) { this[k] = v; },
        getProperty(k) { return this[k]; },
      },
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        toggle(c) { if (this.classes.has(c)) { this.classes.delete(c); return false; } else { this.classes.add(c); return true; } },
        contains(c) { return this.classes.has(c); },
      },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      value: '',
      textContent: '',
      className: '',
      disabled: false,
      hidden: false,
      listeners: {},
      addEventListener(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
      dispatchEvent(evt) { (this.listeners[evt.type] || []).forEach(fn => fn(evt)); },
    };
    elements.set(id, el);
    return el;
  }

  // Pre-create standard card elements referenced by scripts
  const inputSlider = makeEl('inputSlider', 'input');
  const inputProgressNumber = makeEl('inputProgressNumber', 'input');
  const txtNote = makeEl('txtNote', 'textarea');
  const rangeBox = makeEl('rangeBox', 'div');
  const btnSaveRecord = makeEl('btnSaveRecord', 'button');
  const btnClearRecord = makeEl('btnClearRecord', 'button');
  const btnAnalyze = makeEl('btnAnalyze', 'button');
  btnAnalyze.textContent = '更新进度';
  btnAnalyze.disabled = false;

  const conflictBox = makeEl('conflictBox', 'div');
  conflictBox.style.display = 'none';
  const conflictMsg = makeEl('conflictMsg', 'span');
  const btnResolveConflict = makeEl('btnResolveConflict', 'button');
  const feedbackMsg = makeEl('feedbackMsg', 'div');
  const overviewView = makeEl('overviewView', 'div');
  const historyView = makeEl('historyView', 'div');
  const editView = makeEl('editView', 'div');
  editView.hidden = true;
  const scoreUnitEl = makeEl('__scoreUnit__', 'span');
  const overviewScoreNumber = makeEl('overviewScoreNumber', 'span');
  const overviewStatusLabel = makeEl('overviewStatusLabel', 'span');
  const overviewTimestamp = makeEl('overviewTimestamp', 'div');
  const overviewSourceLabel = makeEl('overviewSourceLabel', 'span');
  const summaryBlock = makeEl('summaryBlock', 'div');
  const overviewSummary = makeEl('overviewSummary', 'div');

  const resolvedRecord = initialRecord === undefined ? {
    state: 'unfinished',
    progress: initialProgress,
    note: '初始备注',
    revision: initialRevision,
  } : initialRecord;

  // Render production card HTML
  const html = renderAntigravityCardHtml({
    title: 'DOM 交互验收会话',
    conversationId: convId,
    record: resolvedRecord,
    tasks: [],
    revision: initialRevision,
  });

  // Extract <script> content
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, '卡片 HTML 必须包含核心交互脚本');
  const scriptCode = scriptMatch[1];

  let proxyHandler = null;
  const postedToParent = [];
  const activeTimers = new Set();
  const trackTimeout = (fn, ms) => {
    const id = setTimeout(() => {
      activeTimers.delete(id);
      fn();
    }, ms);
    if (typeof id.unref === 'function') id.unref();
    activeTimers.add(id);
    return id;
  };
  const cancelTimeout = id => {
    activeTimers.delete(id);
    clearTimeout(id);
  };
  const cleanupCardTimers = () => {
    for (const id of [...activeTimers]) {
      clearTimeout(id);
      activeTimers.delete(id);
    }
  };

  const fakeWindow = {
    location: { href: `file:///brain/${convId}/things-card.html` },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: trackTimeout,
    clearTimeout: cancelTimeout,
    parent: {
      postMessage: (data, targetOrigin, transfer) => {
        postedToParent.push({ data, targetOrigin, transfer });
        if (proxyHandler) proxyHandler(data);
      },
    },
    MessageChannel: class {
      constructor() {
        this.port1 = {
          onmessage: null,
          postMessage: msg => {},
          close: () => {},
        };
        this.port2 = {
          onmessage: null,
          postMessage: msg => {},
          close: () => {},
        };
      }
    },
    confirm: () => true,
  };

  const fakeBody = makeEl('__body__', 'body');
  fakeBody.scrollHeight = 526;
  fakeBody.offsetHeight = 526;
  const shellEl = makeEl('agentThingsCard', 'div');
  shellEl.scrollHeight = 526;
  shellEl.offsetHeight = 526;
  shellEl.getBoundingClientRect = () => ({ height: 526.2 });
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      this.observed = [];
      resizeObservers.push(this);
    }
    observe(target) {
      this.observed.push(target);
    }
  }

  const fakeDocument = {
    readyState: 'loading', // 阻止自动调用 initCard() 启动真实 SSE 轮询定时器
    body: fakeBody,
    addEventListener: () => {},
    getElementById: id => elements.get(id) || makeEl(id),
    querySelectorAll: () => [],
    querySelector: sel => (sel === '.score-unit' ? scoreUnitEl : null),
  };

  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    setTimeout: trackTimeout,
    clearTimeout: cancelTimeout,
    __cleanupCardTimers: cleanupCardTimers,
    ResizeObserver: FakeResizeObserver,
    getComputedStyle: () => ({ marginTop: '0px', marginBottom: '0px' }),
    confirm: () => true,
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Error,
    Promise,
    Set,
    Map,
  };

  const wrappedScript = scriptCode + `
    window.__cardState = {
      setHostChannelPort(p) { hostChannelPort = p; },
      get isFormDirty() { return isFormDirty; },
      get draftBaseRevision() { return draftBaseRevision; },
      get savedRevision() { return savedRevision; },
      get currentProgress() { return currentProgress; },
      switchToEdit,
      switchToOverview,
      onSliderInput,
      markFormDirty,
      handleRemoteSessionUpdate,
      onSaveRecord,
      onClearClick,
      resolveConflictKeepDraft,
      onIncomingHostMessage,
      onSourceClick,
      onOpenPaneClick,
      requestHostAuth,
      setupHostAutoResize,
      dispose() {
        if (saveSwitchTimer) { clearTimeout(saveSwitchTimer); saveSwitchTimer = null; }
        if (sseReconnectTimer) { clearTimeout(sseReconnectTimer); sseReconnectTimer = null; }
        if (sseSource) { try { sseSource.close(); } catch(_) {} sseSource = null; }
        for (const [key, req] of pendingActions.entries()) {
          if (req && req.timer) clearTimeout(req.timer);
          pendingActions.delete(key);
        }
        __cleanupCardTimers();
      }
    };
  `;

  vm.createContext(sandbox);
  vm.runInContext(wrappedScript, sandbox);

  // 默认模拟已完成首次握手并建立了专属 MessagePort 通道
  const mockCardPort = {
    postMessage: msg => {
      postedToParent.push({ data: msg });
      if (proxyHandler) proxyHandler(msg);
    },
    close: () => {},
  };
  fakeWindow.__cardState.setHostChannelPort(mockCardPort);

  return {
    card: fakeWindow.__cardState,
    elements,
    postedToParent,
    fakeBody,
    shellEl,
    resizeObservers,
    fakeWindow,
    setProxyHandler(fn) { proxyHandler = fn; },
    getEl(id) { return elements.get(id); },
  };
}

test('DOM 回归 1：卡片加载、输入 80% 置脏草稿、接收外部 70% 推送时基准版本不偷跑', async () => {
  const f = createCardDomFixture({ initialProgress: 50, initialRevision: 10 });
  const { card, getEl } = f;

  try {
    // 1. 进入编辑态
    card.switchToEdit();
    assert.equal(getEl('editView').hidden, false);
    assert.equal(card.isFormDirty, false);
    assert.equal(card.draftBaseRevision, 10);

    // 2. 模拟用户输入 80% 与新备注
    card.onSliderInput(80);
    getEl('txtNote').value = '用户编辑的 80% 草稿备注';
    card.markFormDirty();

    assert.equal(card.isFormDirty, true, '表单进入脏编辑态');
    assert.equal(card.currentProgress, 80, '当前进度更新为 80');
    assert.equal(getEl('inputSlider').value, 80);
    assert.equal(getEl('inputProgressNumber').value, 80);
    assert.equal(card.draftBaseRevision, 10, '编辑中 draftBaseRevision 锁定在初始版本');

    // 3. 外部（侧栏）保存 70%（版本推进至 11），SSE 推送到卡片
    card.handleRemoteSessionUpdate({
      session: {
        conversationId: 'dom-test-conv',
        recordRevision: 11,
        progress: {
          progress: 70,
          state: 'unfinished',
          note: '侧栏保存的 70%',
        },
      },
    });

    // 断言：由于处于 isFormDirty 态，已保存版本推进至 11，但 draftBaseRevision 坚决锁定在 10，表单草稿不被覆盖！
    assert.equal(card.savedRevision, 11, 'savedRevision 更新为外部最新版本 11');
    assert.equal(card.draftBaseRevision, 10, '草稿基准版本绝不偷跑，仍锁定在 10');
    assert.equal(card.currentProgress, 80, '输入框草稿 80% 完好无损');
    assert.equal(getEl('txtNote').value, '用户编辑的 80% 草稿备注', '备注草稿完好无损');
  } finally {
    card.dispose();
  }
});

test('DOM 回归 2：保存冲突展示、读取最新版本并保留草稿对齐、再次保存成功落盘', async () => {
  const f = createCardDomFixture({ initialProgress: 50, initialRevision: 10 });
  const { card, getEl } = f;

  try {
    card.switchToEdit();
    card.onSliderInput(80);
    getEl('txtNote').value = '冲突保护草稿';
    card.markFormDirty();

    // 外部推进版本至 11
    card.handleRemoteSessionUpdate({
      session: { recordRevision: 11, progress: { progress: 70, state: 'unfinished', note: '侧栏保存 70%' } },
    });

    // 模拟宿主桥 RPC 响应
    let lastReceivedPayload = null;
    f.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_ACTION_PROXY') {
        lastReceivedPayload = msg.payload;
        // 检查 expectedRevision：如果与当前远端版本 (11) 不符，返回冲突语义 error
        if (msg.payload.expectedRevision !== 11) {
          card.onIncomingHostMessage({
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce: msg.nonce,
            action: msg.action,
            success: false,
            error: '此会话已在其他窗口更新，请重新确认',
          });
        } else {
          card.onIncomingHostMessage({
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce: msg.nonce,
            action: msg.action,
            success: true,
            data: {
              session: {
                conversationId: 'dom-test-conv',
                recordRevision: 12,
                progress: msg.payload.record.progress,
                state: msg.payload.record.state,
                note: msg.payload.record.note,
              },
            },
          });
        }
      }
    });

    // 1. 用户点击「保存记录」
    await card.onSaveRecord();

    // 断言：服务端报错语义冲突，卡片 DOM 展示冲突提示层，草稿 80% 完好
    assert.equal(lastReceivedPayload.expectedRevision, 10, '首次提交时携带旧基准版本 10');
    assert.equal(getEl('conflictBox').style.display, 'block', '冲突提示框显式展开');
    assert.match(getEl('conflictMsg').textContent, /保存冲突/);
    assert.match(getEl('feedbackMsg').textContent, /检测到版本冲突/);
    assert.equal(card.currentProgress, 80, '冲突后草稿依然保留');

    // 2. 用户点击「读取最新版本并保留草稿」
    card.resolveConflictKeepDraft();

    // 断言：基准版本对齐至已保存版本 11，冲突提示隐藏，表单草稿仍为 80%
    assert.equal(card.draftBaseRevision, 11, '基准版本对齐至 70% 对应的修订号 11');
    assert.equal(getEl('conflictBox').style.display, 'none', '冲突框隐藏');
    assert.equal(card.currentProgress, 80, '80% 草稿完好保留');
    assert.equal(getEl('txtNote').value, '冲突保护草稿', '草稿文本完好保留');

    // 3. 用户再次点击「保存记录」
    await card.onSaveRecord();

    // 断言：再次提交携带对齐后的 revision 11，保存成功，版本推进至 12，表单脏标记重置
    assert.equal(lastReceivedPayload.expectedRevision, 11, '再次提交携带对齐后的版本 11');
    assert.equal(card.savedRevision, 12, '保存成功，版本更新为 12');
    assert.equal(card.draftBaseRevision, 12);
    assert.equal(card.isFormDirty, false, '表单脏标记已重置');
    assert.match(getEl('feedbackMsg').textContent, /保存成功/);
  } finally {
    card.dispose();
  }
});

test('DOM 回归 3：真实 /rpc analyze 失败事件驱动卡片 DOM 按钮复位、解除禁用与展示错误', async () => {
  const f = createCardDomFixture({ initialProgress: 60, initialRevision: 5 });
  const { card, getEl } = f;

  try {
    const btnAnalyze = getEl('btnAnalyze');
    assert.equal(btnAnalyze.textContent, '更新进度');
    assert.equal(btnAnalyze.disabled, false);

    // 1. 模拟分析中状态
    card.handleRemoteSessionUpdate({
      session: {
        analyzing: true,
        analysisStatus: { status: 'pending', stage: 'analyzing' },
      },
    });
    assert.equal(btnAnalyze.disabled, true, '分析中按钮处于禁用态');
    assert.equal(btnAnalyze.textContent, '正在分析…');

    // 2. 模拟真实 /rpc analyze 抛错失败广播到达
    card.handleRemoteSessionUpdate({
      session: {
        analyzing: false,
        analysisStatus: {
          status: 'failed',
          error: 'LLM token quota exceeded (429)',
        },
      },
    });

    // 断言卡片真实 DOM 状态机：
    assert.equal(btnAnalyze.disabled, false, '分析失败后按钮恢复可用');
    assert.equal(btnAnalyze.textContent, '更新进度', '按钮文案恢复为更新进度');
    assert.match(getEl('feedbackMsg').textContent, /分析未完成: LLM token quota exceeded \(429\)/, '错误原因显式渲染在提示区');
  } finally {
    card.dispose();
  }
});


test('source clicks use the authenticated port after handshake and handle locate results', async () => {
  const f = createCardDomFixture();
  const source = { turnId: 'turn-one', itemId: 'reply-one', locator: '原文' };
  const btn = {
    disabled: false,
    getAttribute: name => (name === 'data-source' ? JSON.stringify(source) : null),
  };
  try {
    f.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_LOCATE') {
        f.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce: msg.nonce,
          action: 'locate',
          success: true,
          data: { located: true, message: '已跳转并定位到会话来源' },
        });
      }
    });
    await f.card.onSourceClick(btn);
    assert.equal(f.postedToParent.length, 1);
    assert.equal(f.postedToParent[0].data.type, 'AGENT_THINGS_LOCATE');
    assert.equal(f.postedToParent[0].data.conversationId, 'dom-test-conv');
    assert.equal(f.postedToParent[0].targetOrigin, undefined, 'must use the port, not the window channel');
    assert.equal(btn.disabled, false);
    assert.equal(f.getEl('feedbackMsg').textContent, '已跳转并定位到会话来源');
  } finally { f.card.dispose(); }

  // 验证未命中来源消息时展示错误反馈并恢复按钮，以及无 port 时 window.parent 回退收到 AGENT_THINGS_LOCATE_RESULT
  const f2 = createCardDomFixture();
  try {
    f2.card.setHostChannelPort(null);
    f2.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_LOCATE') {
        f2.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_LOCATE_RESULT',
          nonce: msg.nonce,
          located: false,
          message: '未找到对应会话消息',
        });
      }
    });
    const btn2 = {
      disabled: false,
      getAttribute: name => (name === 'data-source' ? JSON.stringify(source) : null),
    };
    await f2.card.onSourceClick(btn2);
    assert.equal(f2.postedToParent.length, 1);
    assert.equal(f2.postedToParent[0].targetOrigin, '*');
    assert.equal(btn2.disabled, false);
    assert.match(f2.getEl('feedbackMsg').textContent, /未找到对应会话消息/);
  } finally { f2.card.dispose(); }
});

test('DOM 回归 4：点击右上角「在侧栏打开」在已握手时走专属端口并处理业务异常，未注入时走原生 OPEN_SIDECAR 兜底', async () => {
  // 1. 已建立专属端口时：走 AGENT_THINGS_OPEN_PANE 并接收成功回包
  const f1 = createCardDomFixture();
  try {
    f1.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_OPEN_PANE') {
        f1.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce: msg.nonce,
          action: 'open-pane',
          success: true,
          data: { opened: true },
        });
      }
    });
    await f1.card.onOpenPaneClick();
    assert.equal(f1.postedToParent.length, 1);
    assert.equal(f1.postedToParent[0].data.type, 'AGENT_THINGS_OPEN_PANE');
    assert.equal(f1.postedToParent[0].data.conversationId, 'dom-test-conv');
    assert.equal(f1.postedToParent[0].targetOrigin, undefined, '已握手通道优先走专属端口');
    assert.equal(f1.getEl('btnOpenPane').disabled, false, '完成后按钮恢复可用');
    assert.equal(f1.getEl('feedbackMsg').textContent, '');
  } finally {
    f1.card.dispose();
  }

  // 2. 宿主返回业务异常（如未启用插件）：显式向用户展示错误提示，不静默回退
  const f2 = createCardDomFixture();
  try {
    f2.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_OPEN_PANE') {
        f2.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce: msg.nonce,
          action: 'open-pane',
          success: false,
          error: 'Things 侧栏插件未启用',
        });
      }
    });
    await f2.card.onOpenPaneClick();
    assert.equal(f2.postedToParent.length, 1, '业务错误时不额外触发 window.parent.postMessage');
    assert.match(f2.getEl('feedbackMsg').textContent, /打开侧栏失败: Things 侧栏插件未启用/);
    assert.equal(f2.getEl('btnOpenPane').disabled, false);
  } finally {
    f2.card.dispose();
  }

  // 3. 无宿主端口注入（纯 MCP 卡片）：直接通过原生 OPEN_SIDECAR 打开侧栏
  const f3 = createCardDomFixture();
  try {
    f3.card.setHostChannelPort(null);
    await f3.card.onOpenPaneClick();
    assert.equal(f3.postedToParent.length, 1);
    assert.deepEqual(
      { ...f3.postedToParent[0].data },
      { type: 'OPEN_SIDECAR', target: 'things/things_board' },
    );
    assert.equal(f3.postedToParent[0].targetOrigin, '*');
    assert.equal(f3.getEl('btnOpenPane').disabled, false);
  } finally {
    f3.card.dispose();
  }

  // 4. 首次握手 pending（无宿主响应）时点击「在侧栏打开」在短超时内快速降级到 OPEN_SIDECAR，不傻等 4500ms
  const f4 = createCardDomFixture();
  try {
    f4.card.setHostChannelPort(null);
    f4.card.requestHostAuth().catch(() => {});
    const t0 = performance.now();
    await f4.card.onOpenPaneClick();
    const elapsedMs = performance.now() - t0;
    assert.ok(elapsedMs < 1500, `pending 握手降级应远快于 4500ms（实测 ${elapsedMs.toFixed(1)}ms）`);
    assert.ok(
      f4.postedToParent.some(p => p.data?.type === 'OPEN_SIDECAR' && p.data?.target === 'things/things_board'),
      '快速降级后必须发送原生 OPEN_SIDECAR',
    );
  } finally {
    f4.card.dispose();
  }
});

test('antigravity-card: setupHostAutoResize reports initial natural height and live ResizeObserver changes', () => {
  const f = createCardDomFixture();
  try {
    const triggerMeasure = f.card.setupHostAutoResize();
    assert.equal(typeof triggerMeasure, 'function');
    assert.equal(f.resizeObservers.length, 1);
    assert.ok(f.resizeObservers[0].observed.includes(f.fakeBody));
    assert.ok(f.resizeObservers[0].observed.includes(f.shellEl));

    const firstResize = f.postedToParent.filter(p => p.data?.type === 'RESIZE');
    assert.equal(firstResize.length, 1);
    assert.equal(firstResize[0].data.height, 531, '526.2 + 4 slack rounds up to 531px above 200px default');
    assert.equal(firstResize[0].targetOrigin, '*');

    // Small fluctuation within deadband (<= 4px) is ignored
    f.fakeBody.scrollHeight = 528;
    f.fakeBody.offsetHeight = 528;
    f.shellEl.scrollHeight = 528;
    f.shellEl.offsetHeight = 528;
    f.shellEl.getBoundingClientRect = () => ({ height: 528 });
    f.resizeObservers[0].cb();
    assert.equal(f.postedToParent.filter(p => p.data?.type === 'RESIZE').length, 1);

    // Expanding card triggers live RESIZE update
    f.fakeBody.scrollHeight = 680;
    f.fakeBody.offsetHeight = 680;
    f.shellEl.scrollHeight = 680;
    f.shellEl.offsetHeight = 680;
    f.shellEl.getBoundingClientRect = () => ({ height: 680 });
    f.resizeObservers[0].cb();
    const resizes = f.postedToParent.filter(p => p.data?.type === 'RESIZE');
    assert.equal(resizes.length, 2);
    assert.equal(resizes[1].data.height, 684);

    // Top-level standalone page (window.parent === window) does not emit RESIZE
    f.fakeWindow.parent = f.fakeWindow;
    f.card.setupHostAutoResize();
    assert.equal(f.postedToParent.filter(p => p.data?.type === 'RESIZE').length, 2);
  } finally {
    f.card.dispose();
  }
});

test('DOM 回归 5：手动调整保存与 SSE 竞态、无 SSE 回包兜底、取消恢复、清除重置均即时同步总览 DOM', async () => {
  // 1. 空白会话开启手动调整至 100%，保存途中 SSE 抢先抵达被 dirty 拦截，保存完与切回总览均须呈现 100%
  const f1 = createCardDomFixture({ initialProgress: null, initialRevision: 0, initialRecord: null });
  try {
    f1.card.switchToEdit();
    f1.card.onSliderInput(100);
    f1.getEl('txtNote').value = '手动调至 100%';

    f1.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_ACTION_PROXY' && msg.action === 'update') {
        // 模拟 SSE change 先于 ACTION_RESULT 到达（此时卡片仍为 isFormDirty === true）
        f1.card.handleRemoteSessionUpdate({
          session: {
            conversationId: 'dom-test-conv',
            recordRevision: 1,
            progress: { state: 'completed', progress: 100, note: '手动调至 100%', source: 'manual', updatedAt: '2026-11-17T10:44:00.000Z' },
          },
        });
        f1.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce: msg.nonce,
          action: 'update',
          success: true,
          session: {
            conversationId: 'dom-test-conv',
            recordRevision: 1,
            progress: 100,
            state: 'completed',
            note: '手动调至 100%',
            source: 'manual',
            updatedAt: '2026-11-17T10:44:00.000Z',
            summary: '手动调至 100%',
          },
        });
      }
    });

    await f1.card.onSaveRecord();
    assert.equal(f1.card.isFormDirty, false);
    assert.equal(f1.card.savedRevision, 1);
    assert.equal(f1.getEl('overviewScoreNumber').textContent, 100);
    assert.equal(f1.getEl('__scoreUnit__').hidden, false);
    assert.equal(f1.getEl('overviewStatusLabel').textContent, '全部完成');
    assert.equal(f1.getEl('summaryBlock').hidden, false);
    assert.equal(f1.getEl('overviewSummary').textContent, '手动调至 100%');
    assert.match(f1.getEl('overviewTimestamp').textContent, /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);

    f1.card.switchToOverview();
    assert.equal(f1.getEl('overviewScoreNumber').textContent, 100);

    // 2. 无 SSE 推送纯靠 ACTION_RESULT 回包保存，也能当场刷新总览
    f1.card.switchToEdit();
    f1.card.onSliderInput(85);
    f1.getEl('txtNote').value = '直刷备注';
    f1.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_ACTION_PROXY' && msg.action === 'update') {
        f1.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce: msg.nonce,
          action: 'update',
          success: true,
          session: {
            conversationId: 'dom-test-conv',
            recordRevision: 2,
            progress: 85,
            state: 'unfinished',
            note: '直刷备注',
            source: 'manual',
            updatedAt: '2026-11-17T10:45:00.000Z',
            summary: '直刷备注',
          },
        });
      }
    });
    await f1.card.onSaveRecord();
    f1.card.switchToOverview();
    assert.equal(f1.getEl('overviewScoreNumber').textContent, 85);
    assert.equal(f1.getEl('overviewStatusLabel').textContent, '有遗留事项');
    assert.equal(f1.getEl('overviewSummary').textContent, '直刷备注');

    // 3. 编辑草稿未保存期间远端推送 60%，点击取消返回总览时立刻同步到 60%
    f1.card.switchToEdit();
    f1.card.onSliderInput(30);
    f1.card.handleRemoteSessionUpdate({
      session: {
        conversationId: 'dom-test-conv',
        recordRevision: 3,
        progress: { state: 'unfinished', progress: 60, note: '远端推送60', source: 'analysis', updatedAt: '2026-11-17T10:46:00.000Z' },
      },
    });
    assert.equal(f1.getEl('overviewScoreNumber').textContent, 85, '编辑期间总览未破坏表单草稿');
    f1.card.switchToOverview();
    assert.equal(f1.getEl('overviewScoreNumber').textContent, 60, '取消退出编辑后立即应用远端暂存快照');
    assert.equal(f1.getEl('overviewSourceLabel').textContent, '自动分析');

    // 4. 清除操作后立刻重置回 尚未开始 / — 且版本号归 0
    f1.setProxyHandler(msg => {
      if (msg.type === 'AGENT_THINGS_ACTION_PROXY' && msg.action === 'clear') {
        f1.card.onIncomingHostMessage({
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce: msg.nonce,
          action: 'clear',
          success: true,
          session: {
            conversationId: 'dom-test-conv',
            recordRevision: 0,
            progress: null,
            state: 'unstarted',
            note: '',
            summary: '',
            source: 'manual',
            updatedAt: '2026-11-17T10:47:00.000Z',
          },
        });
      }
    });
    await f1.card.onClearClick();
    assert.equal(f1.card.savedRevision, 0);
    assert.equal(f1.getEl('overviewScoreNumber').textContent, '—');
    assert.equal(f1.getEl('__scoreUnit__').hidden, true);
    assert.equal(f1.getEl('overviewStatusLabel').textContent, '尚未开始');
    assert.equal(f1.getEl('summaryBlock').hidden, true);
  } finally {
    f1.card.dispose();
  }
});
