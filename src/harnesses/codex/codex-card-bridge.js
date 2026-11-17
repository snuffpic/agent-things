'use strict';
(() => {
  const container = document.getElementById('progress-card');
  const pending = new Map();
  const readActions = new Set(['analysis-state', 'project-git', 'app-update-info']);
  let nextId = 0, ready = false, theme, initial, watchGeneration = 0;

  const uiText = (key, fallback) => {
    const p = window.__agentThingsPresentation;
    const lang = initial?.lang || initial?.snapshot?.lang || window.__agentThingsLang || p?.lang || 'zh';
    const ui = p?.forLang ? p.forLang(lang) : null;
    return ui?.strings?.[key] ?? p?.strings?.[key] ?? fallback;
  };

  function notify(method, params, id) {
    window.parent.postMessage({ jsonrpc: '2.0', method, params, ...(id == null ? {} : { id }) }, '*');
  }

  function request(method, params, timeout = 15000, uiRequestId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(uiText('cardTimeout', '卡片连接超时'))); }, timeout);
      pending.set(id, { resolve, reject, timer, uiRequestId });
      notify(method, params, id);
    });
  }

  async function watchChanges(conversationId, cardToken) {
    const generation = ++watchGeneration;
    let cursor, retryMs = 500;
    while (generation === watchGeneration) {
      try {
        const result = await request('tools/call', { name: 'read_session_card', arguments: {
          conversation_id: conversationId, card_token: cardToken, action: 'watch-state', ...(cursor ? { cursor } : {}),
        } });
        if (generation !== watchGeneration) return;
        const state = result.structuredContent;
        if (result.isError || !state?.cursor) throw new Error(result.content?.[0]?.text || uiText('cardSyncUnavailable', '卡片同步暂不可用'));
        cursor = state.cursor;
        retryMs = 500;
        window.__codexSessionStatus?.receiveCardEvent(state);
      } catch {
        if (generation !== watchGeneration) return;
        window.__codexSessionStatus?.disconnectCardEvents();
        await new Promise(resolve => setTimeout(resolve, retryMs));
        retryMs = Math.min(retryMs * 2, 8000);
      }
    }
  }

  window.addEventListener('pagehide', () => {
    watchGeneration++;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      notify('notifications/cancelled', { requestId: id });
      entry.reject(new Error(uiText('cardClosed', '卡片已关闭')));
    }
    pending.clear();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && initial?.conversationId && initial.cardToken) void watchChanges(initial.conversationId, initial.cardToken);
  });

  function mount() {
    if (!ready || !initial || window.__codexSessionStatus) return;
    const { conversationId, cardToken, key, title, snapshot, analysisState, session } = initial;
    if (!conversationId || !key || !snapshot) { container.textContent = uiText('cardMissingSession', '卡片缺少当前会话信息'); return; }
    if (!cardToken) { container.textContent = uiText('cardAuthUnavailable', '卡片授权不可用，请重新打开会话进度卡片'); return; }
    container.replaceChildren();
    installCodexSessionStatus('codex-mcp-app', null, {
      container, key, title, snapshot, analysisState, session, theme, lang: initial.lang || snapshot?.lang,
      async send(payload) {
        const { type, requestId, expectedRevision, record, source, cancelRequestId, force } = JSON.parse(payload);
        if (type === 'panel-event') return;
        if (type === 'cancel-request') {
          for (const [id, entry] of pending) if (entry.uiRequestId === cancelRequestId) {
            notify('notifications/cancelled', { requestId: id }); clearTimeout(entry.timer); pending.delete(id);
            entry.reject(Object.assign(new Error(uiText('cardRequestCancelled', '请求已取消')), { code: 'REQUEST_CANCELLED' }));
          }
          return;
        }
        const name = readActions.has(type) ? 'read_session_card' : 'change_session_card';
        try {
          const result = await request('tools/call', { name, arguments: { conversation_id: conversationId, card_token: cardToken, action: type,
            ...(typeof force === 'boolean' ? { force } : {}),
            ...(expectedRevision == null ? {} : { expectedRevision }), ...(record === undefined ? {} : { record }), ...(source ? { source } : {}) } }, 18000, requestId);
          const errorInfo = result.structuredContent?.errorInfo;
          const error = result.isError || !result.structuredContent ? result.content?.[0]?.text || uiText('cardOpFailed', '卡片操作失败') : undefined;
          window.__codexSessionStatus?.reply({ requestId, ...result.structuredContent, error, errorInfo });
        } catch (error) { window.__codexSessionStatus?.reply({ requestId, error: error.message, errorInfo: { code: error.code || 'HOST_UNAVAILABLE', message: error.message, retryable: true } }); }
      },
    });
    new ResizeObserver(() => {
      const height = Math.ceil(container.getBoundingClientRect().height);
      notify('ui/notifications/size-changed', { height });
    }).observe(container);
    void watchChanges(conversationId, cardToken);
  }

  window.addEventListener('message', ({ source, data }) => {
    if (source !== window.parent || data?.jsonrpc !== '2.0') return;
    const entry = pending.get(data.id);
    if (entry) {
      clearTimeout(entry.timer); pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error.message)); else entry.resolve(data.result);
    }
    if (data.method === 'ui/notifications/tool-result') {
      initial = { ...data.params?.structuredContent, cardToken: data.params?._meta?.cardToken };
      mount();
    } else if (data.method === 'ui/notifications/host-context-changed') {
      theme = data.params?.theme;
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.style.colorScheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
      }
      const hostAccent = data.params?.styles?.variables?.['--color-ring-primary'];
      if (hostAccent) {
        window.__agentThingsHostAccent = hostAccent;
        document.documentElement.style.setProperty('--agent-things-accent', hostAccent);
      }
      window.__codexSessionStatus?.setTheme(theme);
    }
  });

  request('ui/initialize', { appInfo: { name: 'agent-things', version: window.__agentThingsVersion || '1.3.3' }, appCapabilities: {}, protocolVersion: '2026-01-26' }, 5000)
    .then(result => {
      theme = result?.hostContext?.theme;
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.style.colorScheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
      }
      const hostAccent = result?.hostContext?.styles?.variables?.['--color-ring-primary'];
      if (hostAccent) {
        window.__agentThingsHostAccent = hostAccent;
        document.documentElement.style.setProperty('--agent-things-accent', hostAccent);
      }
      ready = true;
      notify('ui/notifications/initialized', {});
      mount();
    })
    .catch(error => { container.textContent = error.message; });
})();
