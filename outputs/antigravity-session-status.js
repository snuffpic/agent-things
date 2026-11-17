// Antigravity Session Status Bundle (Auto-generated)
// Zero-friction embedded panel for Antigravity

'use strict';
(function () {
  const connection = window.__agentThingsConnection;
  const SERVICE_ORIGIN = connection.origin;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` };
  const getServiceOrigin = () => window.__agentThingsConnection?.origin || SERVICE_ORIGIN;
  const getServiceHeaders = () => {
    const conn = window.__agentThingsConnection;
    if (conn?.token) return { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` };
    return headers;
  };

  const THINGS_SIDECAR_ID = 'things/things_board';
  const THINGS_SIDECAR_DEFAULT_PATH = '/';
  const waitMs = ms => new Promise(resolve => setTimeout(resolve, ms));
  const getUiText = (key, enFallback, zhFallback) => {
    const p = window.__agentThingsPresentation;
    const lang = window.__agentThingsConnection?.lang || window.__agentThingsLang || p?.lang || 'zh';
    if (key) {
      const ui = p?.forLang ? p.forLang(lang) : null;
      const val = ui?.strings?.[key] ?? p?.strings?.[key];
      if (val) return val;
    }
    return lang === 'en' ? enFallback : (zhFallback || enFallback);
  };

  function normalizeLocatorText(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, m => m.replace(/```[^\n]*\n?/g, '').replace(/```/g, ''))
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findSourceMessageElement(viewport, source) {
    if (!viewport || !source) return null;
    const quote = normalizeLocatorText(source.locator);
    const containers = [...viewport.querySelectorAll('[data-testid="user-input-step"], [data-testid="agent-response"]')];

    if (quote) {
      let matchedContainer = null;
      for (const container of containers) {
        if (normalizeLocatorText(container.textContent).includes(quote)) {
          matchedContainer = container;
          break;
        }
      }

      if (!matchedContainer && quote.length >= 28) {
        const head = quote.slice(0, 22);
        const tail = quote.slice(-18);
        matchedContainer = containers.find(container => {
          const text = normalizeLocatorText(container.textContent);
          return text.includes(head) && text.includes(tail);
        }) || null;
      }

      if (matchedContainer) {
        if (matchedContainer.getAttribute?.('data-testid') === 'user-input-step') {
          return matchedContainer.querySelector?.('[data-testid="user-message-bubble"]') || matchedContainer;
        }
        const innerCandidates = [...(matchedContainer.querySelectorAll?.(
          '[data-testid="user-message-bubble"], p, li, pre, blockquote, h1, h2, h3, h4, h5, h6, td, [data-content-search-unit-key], [data-step-id]'
        ) || [])];
        const anchorNeedle = quote.length >= 24 ? quote.slice(0, 24) : quote;
        let innerMatch = null;
        for (const el of innerCandidates) {
          const norm = normalizeLocatorText(el.textContent);
          if (norm.includes(quote) || (anchorNeedle.length >= 16 && norm.includes(anchorNeedle))) {
            innerMatch = el;
          }
        }
        return innerMatch || matchedContainer;
      }
    }

    if (source.turnId) {
      const index = Number(source.turnId);
      const userSteps = [...viewport.querySelectorAll('[data-testid="user-input-step"]')];
      if (Number.isInteger(index) && index > 0 && index <= userSteps.length) {
        const step = userSteps[index - 1];
        return step.querySelector?.('[data-testid="user-message-bubble"]') || step;
      }
    }
    return null;
  }

  function clickNavigatorForTurn(turnNumber) {
    if (typeof document === 'undefined' || !Number.isInteger(turnNumber) || turnNumber < 1) {
      return { clickedExactTurn: false, clickedChapter: false };
    }
    const turnIdx = turnNumber - 1;
    const exactTurnBtn = document.querySelector(`[data-testid="conversation-navigator-turn"][data-turn-index="${turnIdx}"]`);
    if (exactTurnBtn) {
      exactTurnBtn.click();
      return { clickedExactTurn: true, clickedChapter: false };
    }

    const groups = [...document.querySelectorAll('[data-testid="conversation-navigator-group"]')];
    let offset = 0;
    for (const groupBtn of groups) {
      const label = groupBtn.getAttribute('aria-label') || '';
      const countMatch = label.match(/(\d+)\s*turns?\b/i);
      const count = countMatch ? Number(countMatch[1]) : 0;
      if (count > 0) {
        if (turnNumber >= offset + 1 && turnNumber <= offset + count) {
          groupBtn.click();
          return { clickedExactTurn: false, clickedChapter: true };
        }
        offset += count;
      }
    }
    return { clickedExactTurn: false, clickedChapter: false };
  }

  function highlightLocatedElement(targetEl) {
    if (!targetEl) return;
    const bubble = targetEl.querySelector?.('[data-testid="user-message-bubble"]') || targetEl;
    bubble.scrollIntoView?.({ block: 'center', behavior: 'smooth' });

    if (!bubble.style) return;
    const prevOutline = bubble.style.outline;
    const prevShadow = bubble.style.boxShadow;
    const prevTransition = bubble.style.transition;

    let accentHex = '#2F75C3';
    try {
      const rootAccent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      if (rootAccent) accentHex = rootAccent;
    } catch (_) {}

    bubble.style.transition = 'outline-color 200ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 200ms cubic-bezier(0.23, 1, 0.32, 1)';
    bubble.style.outline = `2px solid ${accentHex}`;
    bubble.style.boxShadow = `0 0 0 4px color-mix(in srgb, ${accentHex} 25%, transparent), 0 8px 24px color-mix(in srgb, ${accentHex} 35%, transparent)`;

    setTimeout(() => {
      bubble.style.outline = prevOutline;
      bubble.style.boxShadow = prevShadow;
      bubble.style.transition = prevTransition;
    }, 3500);
  }

  function findSidebarRowByCascadeId(cascadeId) {
    if (!cascadeId || typeof document === 'undefined') return null;
    const rows = document.querySelectorAll('.agy-sidebar-row[data-cascade-id]');
    for (const row of rows) {
      if (row.getAttribute('data-cascade-id') === cascadeId) return row;
    }
    return null;
  }

  function extractSidebarRowTitle(row) {
    if (!row || typeof row.querySelector !== 'function') return '';
    const anchor = row.querySelector('a');
    const ariaLabel = typeof anchor?.getAttribute === 'function' ? anchor.getAttribute('aria-label')?.trim() : '';
    if (ariaLabel) return ariaLabel;
    const truncate = row.querySelector('span.truncate')?.textContent?.trim();
    if (truncate) return truncate;
    return '';
  }

  function getConversationTitle(convId) {
    if (typeof document === 'undefined') return '';
    const row = (convId && findSidebarRowByCascadeId(convId))
      || document.querySelector('.agy-sidebar-row[data-selected="true"]')
      || document.querySelector('.agy-sidebar-row.bg-sidebar-secondary');
    return extractSidebarRowTitle(row);
  }

  async function switchConversationIfNeeded(threadId, rowFallback = null, timeoutMs = 4000) {
    if (!threadId) return null;
    const readUrlConvId = () => window.location?.pathname?.split('/')?.filter(Boolean)?.pop() || '';
    if (readUrlConvId() === threadId) return findSidebarRowByCascadeId(threadId) || rowFallback || true;

    const row = findSidebarRowByCascadeId(threadId) || rowFallback;
    if (!row) throw new Error(getUiText(null, 'Session item not found', '找不到对应的会话项'));

    if (!harness.isRowSelected(row)) {
      const link = row.querySelector?.('a');
      if (link) link.click();
      else row.click();
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const currentRow = findSidebarRowByCascadeId(threadId) || row;
      if (readUrlConvId() === threadId || harness.isRowSelected(currentRow)) {
        await waitMs(120);
        return currentRow;
      }
      await waitMs(80);
    }
    throw new Error(getUiText(null, 'Timed out switching to target session', '切换到目标会话超时'));
  }

  function collectReactBridge() {
    const out = { store: null, ext: null, sidecarPool: null, router: null, onSidecarLinkClick: null };
    if (typeof document === 'undefined') return out;
    const rootEl = document.querySelector('#root') || document.body?.firstElementChild;
    if (!rootEl) return out;
    const containerKey = Object.keys(rootEl).find(k => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
    const rootFiber = containerKey ? rootEl[containerKey] : null;
    if (!rootFiber) return out;

    const seen = new Set();
    const queue = [rootFiber];
    let head = 0;
    let steps = 0;
    while (head < queue.length && steps++ < 20000) {
      const node = queue[head++];
      if (!node || seen.has(node)) continue;
      seen.add(node);
      const mp = node.memoizedProps;
      if (mp && typeof mp === 'object') {
        if (!out.store && mp.store && typeof mp.store.getState === 'function' && typeof mp.store.dispatch === 'function') {
          out.store = mp.store;
        }
        if (!out.onSidecarLinkClick && typeof mp.onSidecarLinkClick === 'function') {
          out.onSidecarLinkClick = mp.onSidecarLinkClick;
        }
        const ctxVal = mp.value;
        if (ctxVal && typeof ctxVal === 'object') {
          if (!out.ext && typeof ctxVal.get === 'function') {
            try {
              const candidate = ctxVal.get('extensibility');
              if (candidate) out.ext = candidate;
            } catch (_) {}
          }
          if (!out.sidecarPool && (typeof ctxVal.navigateIframe === 'function' || typeof ctxVal.setIframeSrc === 'function')) {
            out.sidecarPool = ctxVal;
          }
          if (!out.router && ctxVal.router && typeof ctxVal.router.navigate === 'function') {
            out.router = ctxVal.router;
          }
        }
        if (!out.router && mp.router && typeof mp.router.navigate === 'function') {
          out.router = mp.router;
        }
      }
      if (out.store && out.ext && out.sidecarPool && out.router && out.onSidecarLinkClick) break;
      if (node.child) queue.push(node.child);
      if (node.sibling) queue.push(node.sibling);
    }
    return out;
  }

  function resolveThingsSidecarDescriptor(ext) {
    const items = ext?.provider?.getState?.();
    if (!Array.isArray(items)) return null;
    const item = items.find(d => d && d.sidecarId === THINGS_SIDECAR_ID);
    if (!item || !item.config?.uiConfig || !item.baseUrl) return null;
    const views = Array.isArray(item.config.uiConfig.views) ? item.config.uiConfig.views : [];
    const view = views.find(v => v && v.entrypoint === 1) || views[0];
    if (!view) return null;
    const viewPath = view.path || THINGS_SIDECAR_DEFAULT_PATH;
    const title = view.title || item.config.uiConfig.displayName || 'Things';
    const baseViewUrl = typeof ext.resolveSidecarUrl === 'function'
      ? ext.resolveSidecarUrl(item.baseUrl, viewPath)
      : item.baseUrl;
    return {
      sidecarId: item.sidecarId,
      path: viewPath,
      title,
      baseViewUrl,
      tabId: `sidecar__${item.sidecarId}__${viewPath}`,
    };
  }

  function buildConversationSidecarUrl(baseViewUrl, convId) {
    if (!baseViewUrl || !convId) return baseViewUrl;
    try {
      const url = new URL(baseViewUrl);
      url.searchParams.set('conversationId', convId);
      return url.toString();
    } catch (_) {
      return baseViewUrl;
    }
  }

  function isThingsSidecarOpenInStore(store, convId) {
    if (!store?.getState) return null;
    try {
      const st = store.getState();
      const paneV1 = convId ? st?.sidePanel?.conversationPanes?.[convId] : st?.sidePanel?.homePane;
      const paneV2 = convId ? st?.sidePanelV2?.conversationPanes?.[convId] : st?.sidePanelV2?.homePane;
      const activeTabId = paneV2?.activeTabId ?? paneV1?.activeTabId ?? '';
      if (paneV1?.isPaneOpen === true && typeof activeTabId === 'string' && activeTabId.startsWith(`sidecar__${THINGS_SIDECAR_ID}__`)) {
        return true;
      }
      if (paneV1 || paneV2) return false;
    } catch (_) {}
    return null;
  }

  function isThingsSidecarOpen(store, convId) {
    const storeResult = isThingsSidecarOpenInStore(store, convId);
    if (storeResult !== null) return storeResult;
    if (typeof document !== 'undefined') {
      const slot = document.querySelector(`[data-testid="sidecar-iframe-slot"][data-sidecar-id="${THINGS_SIDECAR_ID}"][data-visible="true"]`);
      if (slot && typeof slot.getBoundingClientRect === 'function' && slot.getBoundingClientRect().width > 0) {
        const slotUrl = slot.getAttribute?.('data-sidecar-url') || '';
        if (!slotUrl || !convId || slotUrl.includes(`conversationId=${convId}`)) {
          return true;
        }
      }
      const frames = document.querySelectorAll('iframe[data-testid="sidecar-iframe"]');
      for (const frame of frames) {
        if (frame.src?.includes('things--things_board') && typeof frame.getBoundingClientRect === 'function' && frame.getBoundingClientRect().width > 0) {
          if (!convId || !frame.src.includes('conversationId=') || frame.src.includes(`conversationId=${convId}`)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function openViaReduxBridge(bridge, descriptor, activeConvId, { avoidReload = true } = {}) {
    const targetUrl = buildConversationSidecarUrl(descriptor.baseViewUrl, activeConvId);
    if (avoidReload && typeof bridge.sidecarPool?.setIframeSrc === 'function') {
      bridge.sidecarPool.setIframeSrc(targetUrl, targetUrl);
    } else if (typeof bridge.sidecarPool?.navigateIframe === 'function') {
      bridge.sidecarPool.navigateIframe(descriptor.baseViewUrl, targetUrl);
    } else if (typeof bridge.sidecarPool?.setIframeSrc === 'function') {
      bridge.sidecarPool.setIframeSrc(targetUrl, targetUrl);
    }
    const treeId = activeConvId ? { kind: 'cascadeId', cascadeId: activeConvId } : { kind: 'home' };
    const st = bridge.store.getState();
    const setContentType = st?.sidePanelV2 ? 'sidePanelV2/setContent' : 'sidePanel/setContent';
    bridge.store.dispatch({
      type: setContentType,
      payload: {
        treeId,
        content: {
          type: 'sidecarView',
          sidecarView: {
            sidecarId: descriptor.sidecarId,
            path: descriptor.path,
            url: descriptor.baseViewUrl,
            title: descriptor.title,
          },
        },
        tabId: descriptor.tabId,
      },
    });
    bridge.store.dispatch({
      type: 'sidePanel/setSidePanelOpen',
      payload: { treeId, isOpen: true },
    });
    if (typeof bridge.router?.navigate === 'function') {
      try {
        bridge.router.navigate({
          search: prev => ({ ...(prev || {}), tab: descriptor.tabId }),
          replace: true,
        });
      } catch (_) {}
    }
  }

  async function tryOpenViaDomFallback() {
    if (typeof document === 'undefined') return;
    const toggleBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
    if (toggleBtn && toggleBtn.getAttribute('aria-expanded') !== 'true') {
      toggleBtn.click();
      await waitMs(150);
    }
    const submenuItem = document.querySelector(`[data-testid="plugins-submenu-item"][data-sidecar-id="${THINGS_SIDECAR_ID}"]`);
    if (submenuItem) {
      submenuItem.click();
      await waitMs(120);
      return;
    }
    const existingTab = [...document.querySelectorAll('[data-testid="aux-pane-split"] [role="tab"]')]
      .find(tab => (tab.textContent || '').trim() === 'Things');
    if (existingTab) {
      existingTab.click();
      await waitMs(120);
    }
  }

  const harness = {
    globalName: '__antigravitySessionStatus',
    attributeFilter: ['data-cascade-id', 'class', 'hidden', 'aria-expanded', 'style'],

    send(payload) {
      fetch(`${getServiceOrigin()}/rpc`, {
        method: 'POST',
        headers: getServiceHeaders(),
        body: payload,
      })
        .then(res => res.json())
        .then(reply => {
          if (window.__codexSessionStatus?.reply) {
            window.__codexSessionStatus.reply(reply);
          }
        })
        .catch(err => {
          try {
            const msg = JSON.parse(payload);
            if (window.__codexSessionStatus?.reply) {
              window.__codexSessionStatus.reply({
                requestId: msg.requestId,
                error: `${getUiText(null, 'Background service connection failed: ', '后台服务连接失败：')}${err.message}`,
                snapshot: { revision: 0, records: {} },
              });
            }
          } catch { /* ignore */ }
        });
    },

    isRowSelected(row) {
      if (!row) return false;
      if (row.getAttribute('data-selected') === 'true') return true;
      if (row.classList.contains('bg-sidebar-secondary')) return true;
      const id = row.getAttribute('data-cascade-id');
      const currentId = window.location.pathname.split('/').filter(Boolean).pop();
      return Boolean(id && id === currentId);
    },

    async openPane({ entry } = {}) {
      const requestedThreadId = entry?.threadId || null;
      if (requestedThreadId) {
        await switchConversationIfNeeded(requestedThreadId, entry?.row);
      }
      const activeConvId = requestedThreadId || getCurrentConversationId();
      const bridge = collectReactBridge();
      const descriptor = bridge.ext ? resolveThingsSidecarDescriptor(bridge.ext) : null;
      if (bridge.ext && !descriptor) {
        throw new Error(getUiText(null, 'Things sidebar plugin is not enabled. Enable it in Plugins Manager first.', 'Things 侧边栏插件未启用，请先在 Plugins Manager 中启用 Things 插件'));
      }

      if (isThingsSidecarOpen(bridge.store, activeConvId)) {
        syncSidecarConversation(activeConvId);
        return { ok: true, method: 'alreadyOpen', conversationId: activeConvId };
      }

      if (descriptor && bridge.store?.dispatch && typeof bridge.sidecarPool?.setIframeSrc === 'function') {
        openViaReduxBridge(bridge, descriptor, activeConvId, { avoidReload: true });
        await waitMs(80);
        if (isThingsSidecarOpen(bridge.store, activeConvId)) {
          syncSidecarConversation(activeConvId);
          return { ok: true, method: 'reduxStore', conversationId: activeConvId };
        }
      }

      if (bridge.onSidecarLinkClick) {
        bridge.onSidecarLinkClick(THINGS_SIDECAR_ID);
        await waitMs(80);
        if (isThingsSidecarOpen(bridge.store, activeConvId)) {
          syncSidecarConversation(activeConvId);
          return { ok: true, method: 'onSidecarLinkClick', conversationId: activeConvId };
        }
      }

      if (descriptor && bridge.store?.dispatch) {
        openViaReduxBridge(bridge, descriptor, activeConvId, { avoidReload: false });
        await waitMs(80);
        if (isThingsSidecarOpen(bridge.store, activeConvId)) {
          syncSidecarConversation(activeConvId);
          return { ok: true, method: 'reduxStore', conversationId: activeConvId };
        }
      }

      await tryOpenViaDomFallback();
      if (isThingsSidecarOpen(bridge.store, activeConvId)) {
        syncSidecarConversation(activeConvId);
        return { ok: true, method: 'domFallback', conversationId: activeConvId };
      }

      throw new Error(getUiText(null, 'Unable to open Things sidebar plugin; verify the extension is enabled in Antigravity.', '未能打开 Things 侧边栏插件，请确认已在 Antigravity 中启用该扩展'));
    },

    async locate({ entry, source, analysisMessage } = {}) {
      const setMsg = text => { if (analysisMessage) analysisMessage.textContent = text; };
      const targetThreadId = entry?.threadId || source?.threadId || getCurrentConversationId();

      if (targetThreadId && targetThreadId !== getCurrentConversationId()) {
        try {
          await switchConversationIfNeeded(targetThreadId, entry?.row, 5000);
        } catch (err) {
          const message = err?.message || getUiText(null, 'Session item not found', '找不到对应的会话项');
          setMsg(message);
          return { ok: false, located: false, conversationId: getCurrentConversationId(), message };
        }
      }

      const deadline = Date.now() + 3000;
      while (targetThreadId && getCurrentConversationId() !== targetThreadId && Date.now() < deadline) {
        await waitMs(80);
      }

      const activeConvId = getCurrentConversationId();
      const getViewport = () => (
        document.querySelector('[data-testid="autoscroll-viewport"]') ||
        document.querySelector('main') ||
        document.body
      );

      let targetEl = findSourceMessageElement(getViewport(), source);
      const jumpedMsg = getUiText('locatedJumpMessage', 'Jumped to source message', '已跳转到来源消息');
      if (targetEl) {
        highlightLocatedElement(targetEl);
        setMsg(jumpedMsg);
        return { ok: true, located: true, method: 'dom', conversationId: activeConvId, message: jumpedMsg };
      }

      let navResult = { clickedExactTurn: false, clickedChapter: false };
      const turnNum = source?.turnId ? Number(source.turnId) : null;
      if (Number.isInteger(turnNum) && turnNum > 0) {
        navResult = clickNavigatorForTurn(turnNum);
        if (navResult.clickedExactTurn || navResult.clickedChapter) {
          await waitMs(280);
          targetEl = findSourceMessageElement(getViewport(), source);
          if (targetEl) {
            highlightLocatedElement(targetEl);
            setMsg(jumpedMsg);
            return { ok: true, located: true, method: 'navigator', conversationId: activeConvId, message: jumpedMsg };
          }
        }
      }

      let stagnantCount = 0;
      let prevMarker = '';
      for (let attempt = 0; attempt < 35; attempt++) {
        const load = document.querySelector('button[aria-label^="Load older messages"]') ||
          [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Load older messages');
        if (!load || load.disabled || load.getAttribute?.('aria-disabled') === 'true') break;

        const vp = getViewport();
        const curMarker = `${load.getAttribute?.('aria-label') || ''}|${vp?.scrollHeight || 0}`;
        setMsg(getUiText(null, 'Loading earlier history...', '正在展开历史消息…'));
        load.click();
        await waitMs(240);

        targetEl = findSourceMessageElement(getViewport(), source);
        if (targetEl) {
          highlightLocatedElement(targetEl);
          setMsg(jumpedMsg);
          return { ok: true, located: true, method: 'loadOlder', conversationId: activeConvId, message: jumpedMsg };
        }

        const vpAfter = getViewport();
        const afterMarker = `${load.getAttribute?.('aria-label') || ''}|${vpAfter?.scrollHeight || 0}`;
        if (curMarker === prevMarker && afterMarker === curMarker) {
          stagnantCount++;
          if (stagnantCount >= 2) break;
        } else {
          stagnantCount = 0;
        }
        prevMarker = afterMarker;
      }

      if (navResult.clickedExactTurn) {
        const turnMsg = getUiText(null, 'Jumped to this turn via session navigator', '已通过会话导航跳转至该轮次');
        setMsg(turnMsg);
        return { ok: true, located: true, method: 'turnNavigator', conversationId: activeConvId, message: turnMsg };
      }

      const failMsg = getUiText(null, 'Source message not found; check if it was deleted or collapsed', '来源消息尚未找到，请确认该消息未被删除或折叠');
      setMsg(failMsg);
      return { ok: false, located: false, conversationId: activeConvId, message: failMsg };
    },

    reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelBusy, isPanelEntry }) {
      const extractSessionTitle = row => extractSidebarRowTitle(row) || getUiText('fallbackThreadTitle', 'Session', '会话');

      // 1. 清理已断开连接、非侧边栏行、或绑定的 cascadeId 已被 React 复用给其他会话的 slot（解决串台）
      for (const [row, entry] of [...mounted.entries()]) {
        const isSidebarRow = row.classList.contains('agy-sidebar-row');
        const currentCascadeId = row.getAttribute('data-cascade-id');
        if (!row.isConnected || !entry.host.isConnected || !isSidebarRow || !currentCascadeId || currentCascadeId !== entry.threadId) {
          if (entry.slot?.isConnected) {
            entry.slot.remove();
          }
          if (row.style?.getPropertyValue('padding-left') === '8px') {
            row.style.removeProperty('padding-left');
          }
          unmount(entry);
        }
      }

      // 2. 严格仅在侧边栏行内查询与注入，彻底杜绝主聊天区顶部被污染
      const rows = document.querySelectorAll('.agy-sidebar-row[data-cascade-id]');
      for (const row of rows) {
        const cascadeId = row.getAttribute('data-cascade-id');
        if (!cascadeId) continue;

        // 统一对齐（方案 A）：项目子会话被官方硬编码 pl-[30px]，在注入圆环后会产生双重避让，统一重置为 8px 与普通会话平齐
        if (row.className && row.className.includes('pl-[') && row.style.getPropertyValue('padding-left') !== '8px') {
          row.style.setProperty('padding-left', '8px', 'important');
        }

        const title = extractSessionTitle(row);
        let entry = mounted.get(row);
        if (entry) {
          if (entry.title !== title) {
            entry.title = title;
            paint(entry);
          }
          paintVisibility(entry);
          continue;
        }

        const key = JSON.stringify(['local', cascadeId]);
        // Title container is typically children[1]
        const titleContainer = row.children[1] || row;
        let slot = titleContainer.querySelector(':scope > [data-antigravity-status-slot]');
        if (!slot) {
          slot = document.createElement('div');
          slot.setAttribute('data-antigravity-status-slot', '');
          slot.style.cssText = 'flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;pointer-events:auto;z-index:2;';
          titleContainer.prepend(slot);
        }

        const { host, button, original } = attachHost(slot, false, null);

        const onEnter = () => { entry.hovered = true; paintVisibility(entry); };
        const onLeave = () => { entry.hovered = false; paintVisibility(entry); };
        row.addEventListener('pointerenter', onEnter);
        row.addEventListener('pointerleave', onLeave);

        button.addEventListener('click', event => {
          event.stopPropagation();
          event.preventDefault();
          // 先关旧面板再开新面板，支持从 A 顺畅切换到 B
          if (isPanelEntry(entry)) {
            closePanel();
          } else {
            closePanel();
            // 打开面板时，瞬时重采样当前行最新的首句 Prompt 会话标题，确保完全对齐
            entry.title = extractSessionTitle(row);
            openPanel(entry);
          }
        });

        entry = {
          row,
          key,
          threadId: cascadeId,
          rawHost: 'local',
          slot,
          host,
          button,
          title,
          hovered: false,
          ringKey: null,
          original,
          onEnter,
          onLeave,
        };
        mounted.set(row, entry);

        paint(entry);
      }
    },
  };

  window.__sessionStatusHarness = harness;

  // Sync snapshot periodically
  let lastRevision = -1;
  const syncSnapshot = async () => {
    try {
      checkConversationChange();
      const res = await fetch(`${getServiceOrigin()}/snapshot`, { headers: getServiceHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.snapshot && data.snapshot.revision !== lastRevision) {
          lastRevision = data.snapshot.revision;
          window.__codexSessionStatus?.receive(data.snapshot);
        }
      }
    } catch { /* service not started yet, retry */ }
  };

  const syncTimer = setInterval(syncSnapshot, 3000);
  if (typeof syncTimer.unref === 'function') syncTimer.unref();
  harness.dispose = () => clearInterval(syncTimer);
  syncSnapshot();

  // 注销旧版本遗留的全局监听器（支持凭据轮换与重载清理）
  if (typeof window.__antigravityHarnessDispose === 'function') {
    try { window.__antigravityHarnessDispose(); } catch (_) {}
  }

  // 清理旧版本遗留的重复全局定位监听器，统一收口到 onCardMessage / dispatchCardRequest
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function' && window.__agentThingsLocateListener) {
    try { window.removeEventListener('message', window.__agentThingsLocateListener); } catch (_) {}
    window.__agentThingsLocateListener = null;
  }

  // 保持单例 Map 对象身份不变，实现生命周期重入无缝衔接
  const registeredCards = (typeof window !== 'undefined' && window.__agentThingsCardBindings instanceof Map)
    ? window.__agentThingsCardBindings
    : new Map(); // Window -> { conversationId, iframe, expectedPath, win, port, handshakeDone, active, loadToken }
  if (typeof window !== 'undefined') {
    window.__agentThingsCardBindings = registeredCards;
  }

  // 会话切换毫秒级广播机制（驱动 Sidecar 面板与卡片即时跟随宿主活动会话）
  const getCurrentConversationId = () => {
    try {
      return (window.location.pathname.split('/').filter(Boolean).pop() || '').trim();
    } catch (_) {
      return '';
    }
  };
  let lastActiveConversationId = getCurrentConversationId();

  function buildConversationChangedMessage(convId) {
    const title = getConversationTitle(convId);
    return title
      ? { type: 'ANTIGRAVITY_CONVERSATION_CHANGED', conversationId: convId, title }
      : { type: 'ANTIGRAVITY_CONVERSATION_CHANGED', conversationId: convId };
  }

  function syncSidecarConversation(convId) {
    if (!convId || typeof document === 'undefined') return;
    const message = buildConversationChangedMessage(convId);
    try {
      const allIframes = document.querySelectorAll('iframe');
      for (const ifr of allIframes) {
        try {
          ifr.contentWindow?.postMessage(message, '*');
        } catch (_) {}
      }
    } catch (_) {}
  }

  const notifyConversationChanged = (newId) => {
    if (!newId || newId === lastActiveConversationId) return;
    lastActiveConversationId = newId;
    const message = buildConversationChangedMessage(newId);
    syncSidecarConversation(newId);
    try {
      for (const binding of registeredCards.values()) {
        try {
          binding.port?.postMessage(message);
        } catch (_) {}
      }
    } catch (_) {}
  };

  const checkConversationChange = () => {
    const curId = getCurrentConversationId();
    if (curId && curId !== lastActiveConversationId) {
      notifyConversationChanged(curId);
    }
  };

  if (typeof window !== 'undefined' && !window.__agentThingsRouteHooked) {
    window.__agentThingsRouteHooked = true;
    window.addEventListener('popstate', checkConversationChange);
    window.addEventListener('hashchange', checkConversationChange);
    if (window.history && typeof window.history.pushState === 'function') {
      const origPush = window.history.pushState;
      window.history.pushState = function() {
        const ret = origPush.apply(this, arguments);
        setTimeout(checkConversationChange, 0);
        return ret;
      };
    }
    if (window.history && typeof window.history.replaceState === 'function') {
      const origReplace = window.history.replaceState;
      window.history.replaceState = function() {
        const ret = origReplace.apply(this, arguments);
        setTimeout(checkConversationChange, 0);
        return ret;
      };
    }
  }

  // 内部辅助：处理已绑定专属端口收到的业务消息
  let dispatchCardRequest;

  // 继承上一代宿主桥遗留的可信卡片绑定（后台重启导致宿主桥重新注入时，旧卡片端口无缝接管）
  if (typeof window !== 'undefined') {
    registeredCards.forEach((prevBinding, win) => {
      if (!/^[a-f0-9]{64}$/.test(prevBinding?.digest)) {
        if (prevBinding) prevBinding.active = false;
        prevBinding?.port?.close();
        registeredCards.delete(win);
        return;
      }
      if (prevBinding && prevBinding.active && prevBinding.iframe?.isConnected && prevBinding.port) {
        const boundConvId = prevBinding.conversationId;
        const currentUrlId = window.location?.pathname?.split('/')?.filter(Boolean)?.pop();
        const iframeAttrId = prevBinding.iframe.getAttribute?.('data-conversation-id');
        if (boundConvId === currentUrlId || (iframeAttrId && iframeAttrId === boundConvId)) {
          prevBinding.handshakeDone = true;
          // 重新将端口消息监听器绑定到新一代宿主桥的 dispatchCardRequest 处理逻辑
          try {
            prevBinding.port.onmessage = async (portEvt) => {
              if (portEvt && portEvt.data && typeof portEvt.data === 'object') {
                if (typeof dispatchCardRequest === 'function') {
                  await dispatchCardRequest(prevBinding, prevBinding.port, portEvt.data);
                }
              }
            };
          } catch (_) {}
        }
      }
    });
  }

  function normalizeArtifactPath(urlString) {
    if (!urlString || typeof urlString !== 'string') return null;
    try {
      const parsed = new URL(urlString, typeof window !== 'undefined' ? window.location?.href : 'file:///');
      if (parsed.protocol !== 'file:' && parsed.protocol !== 'vscode-file:') return null;
      let pathname = decodeURIComponent(parsed.pathname);
      const parts = pathname.split('/').filter(Boolean);
      const stack = [];
      for (const p of parts) {
        if (p === '.') continue;
        if (p === '..') stack.pop();
        else stack.push(p);
      }
      return '/' + stack.join('/');
    } catch (_) {
      return null;
    }
  }

  function getIframeHref(iframe) {
    try {
      return iframe.contentWindow?.location?.href || '';
    } catch (_) {
      return ''; // 跨域受限抛错直接返回空，彻底移除静态 src 授权回退
    }
  }

  function registerCardIframe(iframe, explicitConvId = null, options = {}) {
    if (!iframe || !iframe.contentWindow) return false;

    // brainDir 和会话 ID 必须来自宿主可信上下文，缺失时拒绝登记
    const knownBrainDir = window.__agentThingsConnection?.brainDir || '';
    if (!knownBrainDir) return false;
    const normBrain = normalizeArtifactPath('file://' + knownBrainDir);
    if (!normBrain) return false;

    const currentUrlId = explicitConvId || (iframe.getAttribute && iframe.getAttribute('data-conversation-id')) || (typeof window !== 'undefined' ? window.location?.pathname?.split('/')?.filter(Boolean)?.pop() : null);
    if (!currentUrlId || typeof currentUrlId !== 'string') return false;

    // 基于宿主可信上下文推导唯一法定路径
    const expectedPath = normalizeArtifactPath(`file://${normBrain}/${currentUrlId}/things-card.html`);
    if (!expectedPath) return false;

    const win = iframe.contentWindow;
    const existing = registeredCards.get(win);
    const passedToken = options.loadToken || null;
    if (!passedToken) return false;

    // 若当前 iframe 实例已登记且持有活跃专属端口和完成的握手：
    if (existing && existing.active && existing.iframe === iframe && existing.port && existing.handshakeDone) {
      // 只有在新的 loadToken 与现有活跃 token 一致时（如常规扫描），才保留现有活跃通道；
      // 若提供了全新的 loadToken，说明宿主通过可信流程重新装入了新文档，必须重置通道以允许新文档握手。
      if (passedToken === existing.loadToken) {
        return true;
      }
      try { existing.port?.close(); } catch (_) {}
      existing.port = null;
      existing.handshakeDone = false;
    }

    // 若工件能读取到 location.href（非沙盒或同源模式），严格全等预期路径
    const curHref = getIframeHref(iframe);
    // A verified setter is about to replace the initial blank document.
    const initialBlank = curHref === 'about:blank' && options.loading === true && /^[a-f0-9]{64}$/.test(options.digest);
    if (curHref && !initialBlank) {
      const normPath = normalizeArtifactPath(curHref);
      if (!normPath || normPath !== expectedPath) return false;
    }

    const binding = {
      conversationId: currentUrlId,
      iframe,
      expectedPath,
      win,
      port: null,
      handshakeDone: false,
      active: true,
      loadToken: passedToken,
      digest: options.digest || null,
    };
    registeredCards.set(win, binding);

    if (iframe.__agentThingsNavHandler && typeof iframe.removeEventListener === 'function') {
      try { iframe.removeEventListener('load', iframe.__agentThingsNavHandler); } catch (_) {}
    }
    let loadCount = 0;
    const onNav = () => {
      loadCount++;
      // 任何后续加载（二次 load）或失效，证明发生了文档内部导航或重载
      if (loadCount > 1 || !binding.active) {
        binding.active = false;
        try { binding.port?.close(); } catch (_) {}
        binding.port = null;
        registeredCards.delete(win);
      }
    };
    iframe.__agentThingsNavHandler = onNav;
    if (typeof iframe.addEventListener === 'function') {
      iframe.addEventListener('load', onNav);
    }
    return true;
  }

  function sendReplyToCard(binding, capturedPort, replyData) {
    // 异步回包前二次核验（TOCTOU 防御）：必须仍处于登记簿中、同一活动对象且未偏离
    if (!binding || !binding.active || !registeredCards.has(binding.win) || registeredCards.get(binding.win) !== binding) return false;
    if (!binding.iframe?.isConnected || binding.iframe.contentWindow !== binding.win) {
      binding.active = false;
      try { binding.port?.close(); } catch (_) {}
      registeredCards.delete(binding.win);
      return false;
    }
    const currentHref = getIframeHref(binding.iframe);
    if (currentHref) {
      const currentNorm = normalizeArtifactPath(currentHref);
      if (currentNorm !== binding.expectedPath) {
        binding.active = false;
        try { binding.port?.close(); } catch (_) {}
        registeredCards.delete(binding.win);
        return false;
      }
    }
    // 票据和备注只走绑定的专属端口；绝不使用 postMessage('*') 回退
    if (!capturedPort || binding.port !== capturedPort) {
      return false;
    }
    try {
      capturedPort.postMessage(replyData);
      return true;
    } catch (_) {
      return false;
    }
  }

  function scanAndRegisterIframes() {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const f of iframes) registerCardIframe(f);
    } catch (_) {}
  }

  const cardObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(mutations => {
    checkConversationChange();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.tagName === 'IFRAME') registerCardIframe(node);
        else if (node.querySelectorAll) {
          const ifs = node.querySelectorAll('iframe');
          for (const f of ifs) registerCardIframe(f);
        }
      }
      for (const node of m.removedNodes) {
        if (node.tagName === 'IFRAME' && node.contentWindow) {
          const b = registeredCards.get(node.contentWindow);
          if (b) {
            b.active = false;
            try { b.port?.close(); } catch (_) {}
            registeredCards.delete(node.contentWindow);
          }
        } else if (node.querySelectorAll) {
          const ifs = node.querySelectorAll('iframe');
          for (const f of ifs) {
            if (f.contentWindow) {
              const b = registeredCards.get(f.contentWindow);
              if (b) {
                b.active = false;
                try { b.port?.close(); } catch (_) {}
                registeredCards.delete(f.contentWindow);
              }
            }
          }
        }
      }
    }
  }) : null;

  try {
    if (cardObserver) {
      cardObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
  } catch (_) {}
  scanAndRegisterIframes();

  // 内部辅助：处理已绑定专属端口收到的业务消息
  dispatchCardRequest = async (binding, targetPort, data) => {
    const boundConvId = binding.conversationId;

    // 强制核对会话 ID：若不匹配，仅通过当前端口回传错误，绝不注销合法绑定通道
    if (data.conversationId && data.conversationId !== boundConvId) {
      sendReplyToCard(binding, targetPort, {
        type: data.type === 'AGENT_THINGS_AUTH_REQUEST' ? 'AGENT_THINGS_AUTH_RESPONSE' : 'AGENT_THINGS_ACTION_RESULT',
        nonce: data.nonce,
        success: false,
        error: '会话身份不匹配：禁止跨会话操作',
      });
      return;
    }

    // 卡片渲染更新确认通知
    if (data.type === 'AGENT_THINGS_CARD_UPDATED') {
      binding.lastReportedProgress = data.progress;
      binding.lastReportedRevision = data.revision;
      binding.lastReportedState = data.state;
      return;
    }

    // 签发单会话短期只读订阅票据（含首次拿票与后台重启后原通道自动换票）
    if (data.type === 'AGENT_THINGS_AUTH_REQUEST') {
      const { nonce } = data;
      if (!nonce) return;
      try {
        const activeOrigin = getServiceOrigin();
        const res = await fetch(`${activeOrigin}/session/ticket`, {
          method: 'POST',
          headers: getServiceHeaders(),
          body: JSON.stringify({ conversationId: boundConvId }),
        });
        if (res.ok) {
          const reply = await res.json();
          sendReplyToCard(binding, targetPort, {
            type: 'AGENT_THINGS_AUTH_RESPONSE',
            nonce,
            conversationId: boundConvId,
            ticket: reply.ticket,
            expiresAt: reply.expiresAt,
            origin: activeOrigin,
          });
        }
      } catch (_) {}
      return;
    }

    // 宿主桥代发写操作（保存、清除、分析）
    if (data.type === 'AGENT_THINGS_ACTION_PROXY') {
      const { nonce, action, payload } = data;
      if (!nonce) return;
      try {
        const key = JSON.stringify(['local', boundConvId]);
        let rpcMsg = null;
        if (action === 'update') {
          rpcMsg = { type: 'update', key, record: payload.record, expectedRevision: payload.expectedRevision, requestId: 'proxy-update-' + Date.now() };
        } else if (action === 'clear') {
          rpcMsg = { type: 'clear', key, expectedRevision: payload.expectedRevision, requestId: 'proxy-clear-' + Date.now() };
        } else if (action === 'analyze') {
          rpcMsg = { type: 'analyze', key, requestId: 'proxy-analyze-' + Date.now() };
        }
        if (rpcMsg) {
          const res = await fetch(`${getServiceOrigin()}/rpc`, {
            method: 'POST',
            headers: getServiceHeaders(),
            body: JSON.stringify(rpcMsg),
          });
          const reply = await res.json();
          if (reply.snapshot) {
            window.__codexSessionStatus?.receive?.(reply.snapshot);
          }
          const targetRecord = reply.snapshot?.records?.[key] || null;
          const targetAnalysis = reply.snapshot?.analysis?.[key] || null;
          const analysisTasks = Array.isArray(targetAnalysis?.ledger?.tasks) ? targetAnalysis.ledger.tasks : null;
          const analysisSummary = targetAnalysis?.ledger?.summary || '';
          const sessionData = {
            conversationId: boundConvId,
            recordRevision: targetRecord?.revision ?? 0,
            progress: targetRecord ? (targetRecord.progress ?? null) : null,
            state: targetRecord ? (targetRecord.state ?? null) : 'unstarted',
            note: targetRecord ? (targetRecord.note ?? '') : '',
            source: targetRecord?.source || (targetAnalysis ? 'analysis' : 'manual'),
            updatedAt: targetRecord?.updatedAt || new Date().toISOString(),
            summary: (targetRecord?.note || analysisSummary) ?? '',
            ...(analysisTasks ? { tasks: analysisTasks } : {}),
          };
          sendReplyToCard(binding, targetPort, {
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce,
            action,
            success: !reply.error,
            error: reply.error || null,
            session: sessionData,
            data: { session: sessionData },
          });
        }
      } catch (err) {
        sendReplyToCard(binding, targetPort, {
          type: 'AGENT_THINGS_ACTION_RESULT',
          nonce,
          action,
          success: false,
          error: err.message || '代理请求失败',
        });
      }
      return;
    }

    // 定位跳转（强制使用 boundConvId）
    if (data.type === 'AGENT_THINGS_LOCATE' && data.source) {
      const { nonce } = data;
      try {
        const result = await harness.locate({
          entry: { threadId: boundConvId },
          source: data.source,
          analysisMessage: { textContent: '' },
        });
        if (nonce) {
          sendReplyToCard(binding, targetPort, {
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce,
            action: 'locate',
            success: Boolean(result?.located),
            data: result,
            error: result?.located ? undefined : (result?.message || '未找到来源消息'),
          });
        }
      } catch (err) {
        if (nonce) {
          sendReplyToCard(binding, targetPort, {
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce,
            action: 'locate',
            success: false,
            error: err?.message || '定位来源失败',
          });
        }
      }
      return;
    }

    // 在侧栏打开 Things 插件（强制使用 boundConvId）
    if (data.type === 'AGENT_THINGS_OPEN_PANE') {
      const { nonce } = data;
      try {
        await harness.openPane({ entry: { threadId: boundConvId } });
        if (nonce) {
          sendReplyToCard(binding, targetPort, {
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce,
            action: 'open-pane',
            success: true,
            data: { opened: true, conversationId: boundConvId },
          });
        }
      } catch (err) {
        if (nonce) {
          sendReplyToCard(binding, targetPort, {
            type: 'AGENT_THINGS_ACTION_RESULT',
            nonce,
            action: 'open-pane',
            success: false,
            error: err?.message || '打开侧栏插件失败',
          });
        }
      }
      return;
    }
  };

  // 监听来自全局 window 的初始握手及操作消息
  const onCardMessage = async event => {
    try {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      // 允许未完成专属端口接管的内嵌卡片或纯 MCP 面板发起跨会话/会话内跳转定位
      if (data.type === 'AGENT_THINGS_LOCATE' && data.source) {
        const existingBinding = registeredCards.get(event.source);
        if (!existingBinding?.handshakeDone) {
          const targetThreadId = data.conversationId || getCurrentConversationId();
          const result = await harness.locate({
            entry: { threadId: targetThreadId },
            source: data.source,
            analysisMessage: { textContent: '' },
          });
          if (data.nonce && event.source && typeof event.source.postMessage === 'function') {
            try {
              event.source.postMessage({
                type: 'AGENT_THINGS_LOCATE_RESULT',
                nonce: data.nonce,
                located: Boolean(result?.located),
                success: Boolean(result?.located),
                message: result?.message || '',
                data: result,
              }, '*');
            } catch (_) {}
          }
          return;
        }
      }

      // 1. 查找宿主登记簿：必须是已由宿主登记且仍处于活动连接状态的同一 iframe 实例
      let binding = registeredCards.get(event.source);
      if (!binding) {
        // 若消息先于 MutationObserver 微任务到达，尝试从当前 DOM 中定位 contentWindow 匹配的 iframe 按可信规则登记
        try {
          const matching = Array.from(document.querySelectorAll('iframe')).find(f => f.contentWindow === event.source);
          if (matching) {
            registerCardIframe(matching, data.conversationId, {
              loadToken: data.loadToken || null,
              digest: data.digest || null,
            });
            binding = registeredCards.get(event.source);
          }
        } catch (_) {}
      }
      if (!binding || !binding.active || !binding.iframe?.isConnected || binding.iframe.contentWindow !== event.source) {
        if (binding) {
          binding.active = false;
          try { binding.port?.close(); } catch (_) {}
          registeredCards.delete(event.source);
        }
        return;
      }

      // 2. 检查实时地址偏离（可读地址模式下的同步前置防御）
      const curHref = getIframeHref(binding.iframe);
      if (curHref) {
        const currentNorm = normalizeArtifactPath(curHref);
        if (currentNorm !== binding.expectedPath) {
          binding.active = false;
          try { binding.port?.close(); } catch (_) {}
          registeredCards.delete(event.source);
          return;
        }
      }

      // 3. 跨会话违规检查：无论是否已完成握手，若消息声明了非法会话 ID，坚决拒绝并释放临时端口，原卡片通道完好保留
      if (data.conversationId && data.conversationId !== binding.conversationId) {
        if (event.ports && event.ports[0]) {
          const tempPort = event.ports[0];
          try {
            tempPort.postMessage({
              type: data.type === 'AGENT_THINGS_AUTH_REQUEST' ? 'AGENT_THINGS_AUTH_RESPONSE' : 'AGENT_THINGS_ACTION_RESULT',
              nonce: data.nonce,
              success: false,
              error: getUiText(null, 'Session identity mismatch: cross-session action blocked', '会话身份不匹配：禁止跨会话操作'),
            });
            tempPort.close?.();
          } catch (_) {}
        }
        return;
      }

      // 4. 握手完成后的窗口入口旁路彻底封锁：
      if (binding.handshakeDone) {
        // 握手已完成：窗口入口在握手完成后直接拒绝所有操作，绝不转交给端口执行写入 RPC！
        // 若消息携带了端口，坚决关闭
        if (event.ports && event.ports[0]) {
          try { event.ports[0].close?.(); } catch (_) {}
        }
        return;
      }

      // 5. 首次握手分支（尚未完成握手）
      // 约束 1：防住首次握手前的抢占与无令牌绕过
      // 若绑定中设定了 loadToken，发送方必须提供严格匹配的 loadToken，否则坚决阻断
      if (binding.loadToken && (!data.loadToken || data.loadToken !== binding.loadToken)) {
        if (event.ports && event.ports[0]) {
          try { event.ports[0].close?.(); } catch (_) {}
        }
        return;
      }

      const port = event.ports?.[0];
      if (!port) return;
      if (data.type !== 'AGENT_THINGS_AUTH_REQUEST' || binding.handshakePending) {
        port.close?.();
        return;
      }
      binding.handshakePending = true;
      let isVerified = false;
      const currentBrainDir = window.__agentThingsConnection?.brainDir || '';
      if (/^[a-f0-9]{64}$/.test(binding.digest)) {
        try {
          const verifyRes = await fetch(`${getServiceOrigin()}/session/verify-artifact`, {
            method: 'POST',
            headers: getServiceHeaders(),
            body: JSON.stringify({ conversationId: binding.conversationId, digest: binding.digest, brainDir: currentBrainDir }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.valid) {
            isVerified = true;
          }
        } catch (_) {}
      }

      binding.handshakePending = false;
      if (registeredCards.get(event.source) !== binding || !binding.active || !binding.iframe.isConnected) {
        port.close?.();
        return;
      }
      if (!isVerified) {
        binding.active = false;
        registeredCards.delete(event.source);
        port.close?.();
        return;
      }

      // 前置校验全部通过：安全接收并锁定专属端口
      binding.port = port;
      binding.handshakeDone = true;
      binding.loadToken = null; // 单次消费，防止重放

      // 为专属端口安装消息监听器，后台重启换票及代理写操作收敛于该端口
      try {
        binding.port.onmessage = async portEvt => {
          if (portEvt && portEvt.data && typeof portEvt.data === 'object') {
            await dispatchCardRequest(binding, binding.port, portEvt.data);
          }
        };
      } catch (_) {}

      // 处理首次握手请求
      await dispatchCardRequest(binding, binding.port, data);
    } catch (_) {}
  };

  const pendingCardLoads = new Map();

  // 原生工件可信装入点拦截处理函数（动态委托）
  const handleSrcdocSetter = function(iframe, val, originalSet) {
    pendingCardLoads.get(iframe)?.abort();
    pendingCardLoads.delete(iframe);
    const previous = registeredCards.get(iframe.contentWindow);
    if (previous) {
      previous.active = false;
      previous.port?.close();
      registeredCards.delete(previous.win);
    }
    const rawContent = String(val);
    const isCard = rawContent.includes('AGENT_THINGS_AUTH_REQUEST') || rawContent.includes('agentThingsCard');
    const testId = iframe.getAttribute?.('data-testid');
    // 主对话气泡内的 <agent-embed> 会随右侧栏开启而整体位于 aux-pane-split 容器下，不能误按右侧独立工件 Tab 拦截
    const agentEmbedAncestor = iframe.closest?.('[data-testid="agent-embed"]');
    const auxSplitAncestor = iframe.closest?.('[data-testid="aux-pane-split"]');
    const hasDistinctEmbedAncestor = !!agentEmbedAncestor && agentEmbedAncestor !== auxSplitAncestor;
    const isInlineEmbed = testId === 'agent-embed-iframe'
      || (hasDistinctEmbedAncestor && testId !== 'artifact-dynamic-ui-iframe');
    const isInAux = !isInlineEmbed && (!!auxSplitAncestor || testId === 'artifact-dynamic-ui-iframe');
    let currentTab = '';
    try { currentTab = new URL(window.location.href).searchParams.get('tab') || ''; } catch (_) {}
    const isCardTab = currentTab.includes('things-card.html');

    if (isCard && (isInAux ? isCardTab : true)) {
      let tabConvId = null;
      if (isInAux && isCardTab) {
        try {
          const match = currentTab.match(/[/\\\\]([^/\\\\]+)[/\\\\]things-card\.html/i) || currentTab.match(/([^/]+)\/things-card\.html/i);
          if (match) tabConvId = match[1];
        } catch (_) {}
      }
      if (!tabConvId) {
        try {
          const match = rawContent.match(/conversationId\s*=\s*["']([^"']+)["']/);
          if (match) tabConvId = match[1];
        } catch (_) {}
      }
      if (!tabConvId && typeof window !== 'undefined') {
        tabConvId = window.location?.pathname?.split('/')?.filter(Boolean)?.pop() || null;
      }

      // 提取内嵌的完整工件文档（完整涵盖 <!DOCTYPE html> 到 </html>，包含完整 <head> 与 <body>）
      let fullDoc = rawContent;
      const cardAnchor = rawContent.indexOf('agentThingsCard') !== -1 ? rawContent.indexOf('agentThingsCard') : rawContent.indexOf('AGENT_THINGS_AUTH_REQUEST');
      if (cardAnchor !== -1) {
        const dtIndex = rawContent.lastIndexOf('<!DOCTYPE html>', cardAnchor);
        const htmlIndex = rawContent.lastIndexOf('<html', cardAnchor);
        let docStart = -1;
        if (dtIndex !== -1 && (htmlIndex === -1 || dtIndex < htmlIndex)) {
          docStart = dtIndex;
        } else if (htmlIndex !== -1) {
          docStart = htmlIndex;
        }
        if (docStart !== -1) {
          const docEnd = rawContent.indexOf('</html>', cardAnchor);
          if (docEnd !== -1) {
            fullDoc = rawContent.slice(docStart, docEnd + 7);
          }
        }
      }

      // 检查工件文档边界与恶意追加：
      // 若为独立 HTML（非官方外层包装模板），必须严格等于 fullDoc；在 </html> 后追加任何脚本均视为非法篡改
      const isOfficialWrapper = /^<!DOCTYPE html><html class="(?:dark|light)"><head><meta http-equiv="Content-Security-Policy"/.test(rawContent);
      if (!isOfficialWrapper && rawContent.trim() !== fullDoc.trim()) {
        return originalSet.call(iframe, val);
      }

      const controller = new AbortController();
      pendingCardLoads.set(iframe, controller);
      const timeout = setTimeout(() => controller.abort(), 5000);
      // Hold the document until verification completes; no card script runs while awaiting the service.
      return (async () => {
        const isCurrent = () => pendingCardLoads.get(iframe) === controller && !controller.signal.aborted
          && iframe.isConnected && (isInAux && isCardTab ? new URL(window.location.href).searchParams.get('tab') === currentTab : true);
        let verifiedDigest;
        try {
          const response = await fetch(`${getServiceOrigin()}/session/verify-artifact`, {
            method: 'POST',
            headers: { ...getServiceHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: tabConvId, content: fullDoc, brainDir: window.__agentThingsConnection?.brainDir || '' }),
            signal: controller.signal,
          });
          const result = await response.json();
          if (!isCurrent()) return;
          if (!response.ok || result.valid !== true || !/^[a-f0-9]{64}$/.test(result.expectedDigest)) {
            return originalSet.call(iframe, val);
          }
          verifiedDigest = result.expectedDigest;
        } catch (_) {
          // An explicit replacement/disposal must never reinstall an obsolete document.
          if (pendingCardLoads.get(iframe) === controller && iframe.isConnected
            && (isInAux && isCardTab ? new URL(window.location.href).searchParams.get('tab') === currentTab : true)) originalSet.call(iframe, val);
          return;
        } finally { clearTimeout(timeout); }

        let dynamicToken = null;
        try {
          const arr = new Uint8Array(16);
          window.crypto.getRandomValues(arr);
          dynamicToken = 'dyn-token-' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (_) {
          return originalSet.call(iframe, val);
        }
  
        if (!registerCardIframe(iframe, tabConvId, {
          loadToken: dynamicToken,
          digest: verifiedDigest,
          loading: true,
        })) return originalSet.call(iframe, val);
  
        // 以通过校验的工件内容 fullDoc 为唯一渲染输入，彻底剔除外部未经验证的追加字符与脚本
        let hostAccent = '';
        let hostAccentFg = '';
        let hostMode = '';
        try {
          const rs = getComputedStyle(document.documentElement);
          hostAccent = rs.getPropertyValue('--primary').trim();
          hostAccentFg = rs.getPropertyValue('--primary-foreground').trim();
          if (document.body?.classList?.contains('theme-light')) hostMode = 'light';
          else if (document.body?.classList?.contains('theme-dark')) hostMode = 'dark';
          else {
            const bg = rs.getPropertyValue('--background').trim();
            if (bg) {
              if (bg.startsWith('#') && bg.length >= 7) {
                const r = parseInt(bg.slice(1, 3), 16), g = parseInt(bg.slice(3, 5), 16), b = parseInt(bg.slice(5, 7), 16);
                hostMode = (0.299 * r + 0.587 * g + 0.114 * b) > 130 ? 'light' : 'dark';
              } else if (bg.startsWith('rgb')) {
                const m = bg.match(/\d+/g);
                if (m && m.length >= 3) hostMode = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 130 ? 'light' : 'dark';
              }
            }
          }
        } catch (_) {}
        const tokenScript = '<script>window.__agentThingsLoadToken = ' + JSON.stringify(dynamicToken) + ';'
          + (hostAccent ? 'window.__agentThingsHostAccent = ' + JSON.stringify(hostAccent) + ';' : '')
          + (hostAccentFg ? 'window.__agentThingsHostAccentFg = ' + JSON.stringify(hostAccentFg) + ';' : '')
          + (hostMode ? 'window.__agentThingsHostTheme = ' + JSON.stringify(hostMode) + ';' : '')
          + '</' + 'script>';
        let modifiedHtml = fullDoc;
        // 彻底清理之前注入过的所有 loadToken 脚本（兼容普通与转义关闭标签）
        modifiedHtml = modifiedHtml
          .replace(/<script[^>]*>window\.__agentThingsLoadToken[\s\S]*?<\/script>/gi, '')
          .replace(/<script[^>]*>window\.__agentThingsLoadToken[\s\S]*?<\\\/script>/gi, '');
        if (hostMode) {
          modifiedHtml = modifiedHtml.replace(/<html\b([^>]*)>/i, (_, attrs) => {
            const cleaned = attrs
              .replace(/\s+data-color-mode\s*=\s*["'][^"']*["']/gi, '')
              .replace(/\s+style\s*=\s*["']color-scheme:[^"']*["']/gi, '');
            return '<html data-color-mode="' + hostMode + '" style="color-scheme:' + hostMode + '"' + cleaned + '>';
          });
        }
        if (modifiedHtml.includes('<head>')) {
          modifiedHtml = modifiedHtml.replace('<head>', '<head>' + tokenScript);
        } else {
          modifiedHtml = tokenScript + modifiedHtml;
        }
        return originalSet.call(iframe, modifiedHtml);
      })().finally(() => {
        clearTimeout(timeout);
        if (pendingCardLoads.get(iframe) === controller) pendingCardLoads.delete(iframe);
      });
    }

    return originalSet.call(iframe, val);
  };

  if (typeof window !== 'undefined') {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('message', onCardMessage);
    }
    window.__antigravityHarnessSecurity = {
      normalizeArtifactPath,
      registerCardIframe,
      onCardMessage,
      registeredCards,
      sendReplyToCard,
      handleSrcdocSetter,
    };

    // 锁定最纯正的底层宿主原生 descriptor（跨 Realm 获取，穿透所有历史猴子补丁）
    if (typeof HTMLIFrameElement !== 'undefined' && typeof document !== 'undefined') {
      if (!window.__agentThingsBaseSrcdocDesc || !window.__agentThingsBaseSrcdocDesc.set?.toString()?.includes('[native code]')) {
        try {
          const freshRealm = document.createElement('iframe');
          if (document.body) {
            document.body.appendChild(freshRealm);
            const nativeDesc = Object.getOwnPropertyDescriptor(freshRealm.contentWindow?.HTMLIFrameElement?.prototype, 'srcdoc');
            freshRealm.remove();
            if (nativeDesc && nativeDesc.set) {
              window.__agentThingsBaseSrcdocDesc = nativeDesc;
            }
          }
        } catch (_) {}
      }
      if (!window.__agentThingsBaseSrcdocDesc) {
        window.__agentThingsBaseSrcdocDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
      }
      const baseDesc = window.__agentThingsBaseSrcdocDesc;

      // 原生工件可信装入点拦截器（动态委托模式：固定委托给最新的 handleSrcdocSetter）
      if (baseDesc && baseDesc.set) {
        try {
          Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
            get() {
              return baseDesc.get.call(this);
            },
            set(val) {
              const handler = window.__antigravityHarnessSecurity?.handleSrcdocSetter;
              if (typeof handler === 'function') {
                return handler(this, val, baseDesc.set);
              }
              return baseDesc.set.call(this, val);
            },
            configurable: true,
          });
          window.__agentThingsSrcdocHookInstalled = true;
        } catch (_) {}
      }
    }
  }

  window.__antigravityHarnessDispose = () => {
    for (const controller of pendingCardLoads.values()) controller.abort();
    pendingCardLoads.clear();
    clearInterval(syncTimer);
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', onCardMessage);
      if (window.__agentThingsLocateListener) {
        window.removeEventListener('message', window.__agentThingsLocateListener);
        window.__agentThingsLocateListener = null;
      }
    }
    try { cardObserver?.disconnect(); } catch (_) {}
    // 注意：不清除活跃卡片端口，以便新宿主桥注入后可信接管原通道
  };
})();


/* Manual session marks. Loaded in a dedicated CDP isolated world. */
function installCodexSessionStatus(version, restored, embedded) {
  if (window.__codexSessionStatus && !embedded?.independent) return;
  const harness = embedded?.independent ? null : window.__sessionStatusHarness || null;
  let localCards = null;
  const send = payload => {
    if (embedded) embedded.send(payload);
    else if (harness?.send) harness.send(payload);
    else window.__codexSessionStatusSend(payload);
  };
  const presentation = window.__agentThingsPresentation;
  let activeLang = embedded?.lang || embedded?.snapshot?.lang || window.__agentThingsConnection?.lang || window.__agentThingsLang || presentation?.lang || 'zh';
  let ui = presentation?.forLang ? presentation.forLang(activeLang) : null;
  let strings = ui?.strings || presentation?.strings || {};
  let labels = ui?.labels || presentation?.labels || {
    unstarted: '尚未开始', unfinished: '有遗留事项', completed: '全部完成', pushed: '全部完成并已推送',
  };
  let taskLabels = ui?.taskLabels || presentation?.taskLabels || {
    todo: '待开始', in_progress: '进行中', blocked: '受阻', needs_verification: '待验收', done: '已完成',
  };
  const S = (key, vars) => (ui?.t ? ui.t(key, vars) : (strings[key] || key));
  const setLang = nextLang => {
    const resolved = nextLang === 'en' ? 'en' : nextLang === 'zh' ? 'zh' : activeLang;
    if (!presentation?.forLang || (resolved === activeLang && ui)) return false;
    activeLang = resolved;
    ui = presentation.forLang(activeLang);
    strings = ui.strings;
    labels = ui.labels;
    taskLabels = ui.taskLabels;
    return true;
  };
  const colors = presentation?.colors || { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' };
  let currentAccent = presentation?.accent?.normal || '#0169CC';
  let currentAccentPalette = presentation?.accent || { normal: '#0169CC', hover: '#005bb3', pressed: '#004f9c', onAccent: '#FFFFFF' };
  function resolveHostAccent(isDark = true) {
    const raw = (window.__agentThingsHostAccent || document.documentElement.style.getPropertyValue('--agent-things-accent') || (() => {
      try {
        const rootStyle = getComputedStyle(document.documentElement);
        for (const varName of ['--codex-base-accent', '--color-button-accent', '--primary', '--agent-things-accent']) {
          const candidate = rootStyle.getPropertyValue(varName).trim();
          if (candidate) return candidate;
        }
      } catch {}
      return '';
    })()).trim();
    const fallback = presentation?.accent?.normal || '#0169CC';
    return presentation?.resolveAccentPalette
      ? presentation.resolveAccentPalette(raw || fallback, { isDark, fallback })
      : { normal: raw || fallback, hover: '#005bb3', pressed: '#004f9c', onAccent: '#FFFFFF' };
  }
  function syncAccent(node, isDark = true) {
    const palette = resolveHostAccent(isDark);
    currentAccentPalette = palette;
    currentAccent = palette.normal;
    if (!node?.style) return palette;
    const pairs = [
      ['--accent', palette.normal],
      ['--accent-hover', palette.hover],
      ['--accent-pressed', palette.pressed],
      ['--on-accent', palette.onAccent],
    ];
    for (const [k, v] of pairs) {
      if (node.style.getPropertyValue(k) !== v) node.style.setProperty(k, v);
    }
    return palette;
  }
  let snapshot = { revision: 0, records: {} };
  const mounted = new Map();
  const pending = new Map();
  const panelStates = new Map(restored?.panelStates || []);
  let panel = null;
  let serial = 0;
  const requestPrefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let frame = 0;
  let destroyed = false;
  const startup = { installedAt: Date.now(), sidebarReadyAt: null, badgesReadyAt: null };
  function measureStartup() {
    if (startup.badgesReadyAt !== null) return;
    const rows = harness?.startupRows ? harness.startupRows().filter(visible)
      : [...document.querySelectorAll('[data-app-action-sidebar-project-list-id] [data-app-action-sidebar-thread-row]')].filter(row => ['local', 'remote'].includes(row.getAttribute('data-app-action-sidebar-thread-kind')) && visible(row));
    if (!rows.length) return;
    startup.sidebarReadyAt ??= Date.now();
    if (rows.every(row => row.querySelector('[data-codex-session-status]'))) startup.badgesReadyAt = Date.now();
  }

  function rememberPanel(target) {
    const active = target.root.shadowRoot.activeElement;
    const state = { key: target.entry.key, mode: target.mode, dirty: target.dirty, revision: target.revision,
      note: target.note.value, progress: target.progress.value, draft: { ...target.draft },
      remainingExpanded: target.remainingExpanded, scrollTop: target.body.scrollTop,
      noteScrollTop: target.note.scrollTop, selectionStart: target.note.selectionStart, selectionEnd: target.note.selectionEnd,
      focus: active === target.note ? 'note' : active === target.progress ? 'progress' : null,
      error: target.error.textContent, conflict: target.conflict };
    panelStates.set(target.entry.key, state);
    try { sessionStorage.setItem(`codex-session-status-panel:v1:${target.entry.key}`, JSON.stringify(state)); } catch { /* Keep the in-memory copy when storage is unavailable. */ }
    return state;
  }

  function rememberedPanel(key) {
    if (panelStates.has(key)) return panelStates.get(key);
    try {
      const state = JSON.parse(sessionStorage.getItem(`codex-session-status-panel:v1:${key}`));
      if (state && ['overview', 'edit', 'history'].includes(state.mode)) { panelStates.set(key, state); return state; }
    } catch { /* Start from the current saved record if a browser cache cannot be read. */ }
    return null;
  }

  function restorePanel(target, state) {
    target.remainingExpanded = state.remainingExpanded;
    if (state.dirty) {
      target.dirty = true; target.revision = state.revision;
      target.draft = state.draft || { state: recordFor(state.key)?.state || 'unfinished',
        progress: state.progress === '' ? null : Number(state.progress), note: state.note || '' };
      target.note.value = state.note; updateDraft(target, target.draft); target.progress.value = state.progress;
    }
    target.restoreScroll = state.scrollTop || 0;
    target.setView(state.mode || (state.dirty ? 'edit' : 'overview'));
    target.error.textContent = state.error || '';
    target.conflict = Boolean(state.dirty && state.conflict);
    target.resolveConflict.hidden = !target.conflict;
    if (target.mode === 'edit') {
      if (state.focus === 'note') {
        target.note.focus({ preventScroll: true });
        target.note.setSelectionRange(state.selectionStart ?? target.note.value.length, state.selectionEnd ?? target.note.value.length);
      } else if (state.focus === 'progress') target.progress.focus({ preventScroll: true });
      target.note.scrollTop = state.noteScrollTop || 0;
    }
  }

  function panelEvent(action, entry) {
    try { send(JSON.stringify({ type: 'panel-event', action,
      requestId: `${requestPrefix}:${++serial}`, key: entry.key })); } catch { /* Diagnostic only. */ }
  }

  function element(tag, text, parent, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    parent?.append(node);
    return node;
  }

  function recordFor(key) {
    const record = snapshot.records[key];
    return record?.state ? record : null;
  }

  function summary(key) {
    const record = recordFor(key);
    if (!record) return S('badgeNotOrganized');
    return `${labels[record.state]}${record.progress === null ? S('badgeProgressUnrecordedSuffix') : ` · ${record.progress}%`}`;
  }

  function makeRing(button, record, pie = false, loading = false) {
    button.replaceChildren();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
    svg.setAttribute('aria-hidden', 'true');
    if (loading) {
      svg.setAttribute('class', 'loading');
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      for (const [name, value] of Object.entries({ cx: 12, cy: 12, r: 10, fill: 'none', stroke: currentAccent || '#0169cc', 'stroke-width': 1.6, 'stroke-dasharray': '42 63', 'stroke-linecap': 'round' })) circle.setAttribute(name, value);
      svg.append(circle); button.append(svg); return;
    }
    const color = record ? colors[record.state] : '#858991';
    for (const progress of pie ? [null] : [null, record?.progress]) {
      if (progress === undefined || progress === null && svg.childElementCount) continue;
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      for (const [name, value] of Object.entries({ cx: 12, cy: 12, r: 10, fill: 'none', stroke: color, 'stroke-width': 1.6 })) {
        circle.setAttribute(name, value);
      }
      if (progress === null) circle.setAttribute('opacity', pie ? '1' : record?.progress != null ? '.25' : '.85');
      else {
        circle.setAttribute('stroke-dasharray', `${62.832 * progress / 100} 62.832`);
        circle.setAttribute('transform', 'rotate(-90 12 12)');
        circle.setAttribute('stroke-linecap', 'round');
      }
      svg.append(circle);
    }
    if (pie && record?.progress > 0) {
      const sector = document.createElementNS(svg.namespaceURI, 'path');
      const angle = record.progress / 100 * Math.PI * 2;
      const x = 12 + 7.4 * Math.sin(angle);
      const y = 12 - 7.4 * Math.cos(angle);
      sector.setAttribute('d', record.progress === 100
        ? 'M12 4.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8'
        : `M12 12L12 4.6A7.4 7.4 0 ${record.progress > 50 ? 1 : 0} 1 ${x} ${y}Z`);
      sector.setAttribute('fill', color); sector.setAttribute('class', 'progress-pie');
      svg.append(sector);
    }
    if (pie || record) {
      const text = document.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('x', '12'); text.setAttribute('y', '12.4');
      text.setAttribute('text-anchor', 'middle'); text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', color);
      text.setAttribute('style', `font:600 ${pie ? 6.4 : 8}px -apple-system,BlinkMacSystemFont,sans-serif;font-variant-numeric:tabular-nums`);
      text.textContent = record?.progress == null ? '—' : pie ? `${record.progress}%` : String(record.progress);
      if (record?.progress == null) text.setAttribute('class', 'progress-unknown');
      svg.append(text);
    }
    button.append(svg);
  }

  function paintVisibility(entry) {
    const selected = harness?.isRowSelected ? harness.isRowSelected(entry.row) : entry.row.getAttribute('data-app-action-sidebar-thread-selected') === 'true';
    entry.host.toggleAttribute('data-visible', Boolean(recordFor(entry.key) || snapshot.analyzingKeys?.includes(entry.key) || entry.hovered || selected));
  }

  function paint(entry) {
    const record = recordFor(entry.key);
    const loading = snapshot.analyzingKeys?.includes(entry.key) || false;
    const ringKey = JSON.stringify([record?.state, record?.progress, loading]);
    if (entry.ringKey !== ringKey) { makeRing(entry.button, record, false, loading); entry.ringKey = ringKey; }
    paintVisibility(entry);
    entry.button.setAttribute('aria-busy', String(loading));
    const description = S('ringAriaPattern', { title: entry.title, summary: loading ? S('ringUpdating') : summary(entry.key) });
    entry.button.setAttribute('aria-label', description);
    entry.button.title = description;
  }

  function unmount(entry) {
    harness?.unmount?.(entry);
    entry.row.removeEventListener('pointerenter', entry.onEnter); entry.row.removeEventListener('pointerleave', entry.onLeave);
    entry.host.remove();
    for (const [name, previous] of Object.entries(entry.original)) {
      if (previous.value) entry.slot.style.setProperty(name, previous.value, previous.priority);
      else entry.slot.style.removeProperty(name);
    }
    if (entry.slot.classList.contains('status-slot-injected')) entry.slot.remove();
    mounted.delete(entry.row);
  }

  function attachHost(slot, emptyWrapper, placeholder) {
    const original = Object.fromEntries(['width', 'min-width', 'flex-basis'].map(name => [name, {
      value: slot.style.getPropertyValue(name), priority: slot.style.getPropertyPriority(name)
    }]));
    for (const name of Object.keys(original)) slot.style.setProperty(name, '24px');
    const target = emptyWrapper ? placeholder : slot;
    for (const existing of target.querySelectorAll('span[data-codex-session-status]')) {
      existing.remove();
    }
    const host = element('span', null, target);
    host.setAttribute('data-codex-session-status', '');
    host.style.cssText = 'display:flex;width:24px;height:28px;flex:none;align-items:center;justify-content:center';
    const shadow = host.attachShadow({ mode: 'open' });
    element('style', `:host{opacity:0}:host([data-visible]),:host(:focus-within){opacity:1}@keyframes status-spin{to{transform:rotate(360deg)}}svg.loading{animation:status-spin .85s linear infinite;transform-origin:center}button{all:unset;box-sizing:border-box;width:28px;height:28px;display:grid;place-items:center;cursor:pointer;border-radius:7px;transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 150ms cubic-bezier(.23,1,.32,1)}button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}button:active{transform:scale(.94)}button:focus-visible{outline:2px solid var(--accent,#0169cc);outline-offset:1px}svg{display:block;pointer-events:none}`, shadow);
    const button = element('button', null, shadow);
    button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    return { host, button, original };
  }

  function reconcile() {
    frame = 0;
    if (destroyed) return;
    measureStartup();
    if (harness?.reconcile) {
      harness.reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelBusy: () => panel?.busy, isPanelEntry: e => panel?.entry === e });
      measureStartup();
      if (panel && (!panel.entry.host.isConnected || !visible(panel.entry.host))) closePanel(false);
      else positionPanel();
      return;
    }
    for (const entry of mounted.values()) {
      if (!entry.row.isConnected || !entry.host.isConnected || !entry.row.closest('[data-app-action-sidebar-project-list-id]') ||
          !['local', 'remote'].includes(entry.row.getAttribute('data-app-action-sidebar-thread-kind')) ||
          entry.row.getAttribute('data-app-action-sidebar-thread-id') !== entry.threadId ||
          entry.row.getAttribute('data-app-action-sidebar-thread-host-id') !== entry.rawHost) unmount(entry);
    }
    const rows = document.querySelectorAll('[data-app-action-sidebar-project-list-id] [data-app-action-sidebar-thread-row]');
    for (const row of rows) {
      const kind = row.getAttribute('data-app-action-sidebar-thread-kind');
      if (kind !== 'local' && kind !== 'remote') continue;
      const threadId = row.getAttribute('data-app-action-sidebar-thread-id');
      if (!threadId) continue;
      const titleNode = row.querySelector('[data-thread-title]');
      const title = row.getAttribute('data-app-action-sidebar-thread-title') || titleNode?.textContent || S('sessionFallbackTitle');
      const existing = mounted.get(row);
      if (existing) {
        if (existing.title !== title) { existing.title = title; paint(existing); }
        paintVisibility(existing);
        continue;
      }
      // Target the existing reserved leading slot; leave occupied native icons intact.
      const trigger = titleNode?.closest('[data-thread-title-trigger]');
      const slot = trigger?.previousElementSibling;
      if (!slot || !slot.classList.contains('w-4')) continue;
      // Native rows keep an empty relative wrapper inside the leading slot.
      const placeholder = slot.firstElementChild;
      const emptyWrapper = slot.childElementCount === 1 && placeholder.tagName === 'DIV' &&
        placeholder.childElementCount === 0 && !placeholder.textContent.trim();
      if (slot.childElementCount !== 0 && !emptyWrapper) continue;
      const rawHost = row.getAttribute('data-app-action-sidebar-thread-host-id');
      const key = JSON.stringify([rawHost || (kind === 'remote' ? 'cloud' : 'local'), threadId]);
      const { host, button, original } = attachHost(slot, emptyWrapper, placeholder);
      const entry = { row, key, threadId, rawHost, title, slot, host, button, original, hovered: row.matches(':hover') };
      entry.onEnter = () => { entry.hovered = true; paintVisibility(entry); };
      entry.onLeave = () => { entry.hovered = false; paintVisibility(entry); };
      row.addEventListener('pointerenter', entry.onEnter); row.addEventListener('pointerleave', entry.onLeave);
      for (const type of ['pointerdown', 'dblclick']) host.addEventListener(type, e => e.stopPropagation());
      button.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation();
        if (panel?.busy) return;
        if (panel?.entry === entry) closePanel();
        else { closePanel(); openPanel(entry); }
      });
      mounted.set(row, entry); paint(entry);
    }
    if (panel && (!panel.entry.host.isConnected || !visible(panel.entry.host))) closePanel(false);
    else positionPanel();
  }

  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(reconcile);
  }

  function visible(node) {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  }

  function detectPanelColorMode(entry) {
    if (embedded) return embedded.theme && ['light', 'dark'].includes(embedded.theme) ? embedded.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    for (let node = entry?.row; node; node = node.parentElement) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!rgba || (rgba[3] ?? 1) < .95) continue;
      return rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722 < 150 ? 'dark' : 'light';
    }
    const docTheme = typeof document !== 'undefined'
      ? (document.documentElement?.getAttribute?.('data-theme') || document.documentElement?.dataset?.mode || (document.body?.classList?.contains('theme-light') ? 'light' : document.body?.classList?.contains('theme-dark') ? 'dark' : ''))
      : '';
    if (docTheme === 'light' || docTheme === 'dark') return docTheme;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function positionPanel() {
    if (!panel) return;
    if (embedded) {
      const mode = embedded.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      if (panel.root.getAttribute('data-color-mode') !== mode) panel.root.setAttribute('data-color-mode', mode);
      if (typeof syncAccent === 'function') syncAccent(panel.root, mode === 'dark');
      return;
    }
    // Foreground colors change when the host window becomes inactive.
    // Read the painted page background, whose luminance represents its theme.
    let mode = null;
    for (let node = panel.entry.row; node; node = node.parentElement) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (!rgba || (rgba[3] ?? 1) < .95) continue;
      mode = rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722 < 150 ? 'dark' : 'light';
      break;
    }
    mode ||= panel.root.getAttribute('data-color-mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (panel.root.getAttribute('data-color-mode') !== mode) panel.root.setAttribute('data-color-mode', mode);
    if (typeof syncAccent === 'function') syncAccent(panel.root, mode === 'dark');
    const anchor = panel.entry.host.getBoundingClientRect();
    const rect = panel.shell.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right + 10, innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(anchor.top - 12, innerHeight - rect.height - 8));
    panel.shell.style.left = `${left}px`; panel.shell.style.top = `${top}px`;
  }

  function updateDraft(target, patch) {
    target.draft = presentation ? presentation.draftTransition({ draft: target.draft, baseRevision: target.revision }, { type: 'patch', patch }).draft : { ...target.draft, ...patch };
    target.dirty = true;
    const draft = target.draft;
    target.progress.value = draft.progress ?? '';
    target.slider.value = draft.progress ?? 0;
    target.range.style.setProperty('--fill', `${draft.progress ?? 0}%`);
    target.range.style.setProperty('--mark', colors[draft.state] || colors.unfinished);
    for (const [state, button] of target.choices) button.setAttribute('aria-pressed', String(draft.state === state));
    rememberPanel(target);
  }

  function refreshPanel() {
    if (!panel) return;
    const target = panel, record = recordFor(target.entry.key);
    target.choices.get('pushed').hidden = target.projectGit?.hasRemote !== true;
    target.git.textContent = target.projectGit?.status === 'unknown' ? S('gitCheckUnavailable') : '';
    if (!target.busy && !target.dirty) {
      target.revision = snapshot.records[target.entry.key]?.revision ?? 0;
      target.draft = presentation ? presentation.draftTransition({}, { type: 'begin', record, revision: target.revision }).draft : { state: record?.state || 'unfinished', progress: record?.progress ?? null, note: record?.note || '' };
      target.note.value = target.draft.note;
      target.progress.value = target.draft.progress ?? '';
      target.slider.value = target.draft.progress ?? 0;
      target.range.style.setProperty('--fill', `${target.draft.progress ?? 0}%`);
      target.range.style.setProperty('--mark', colors[target.draft.state]);
      for (const [state, button] of target.choices) button.setAttribute('aria-pressed', String(target.draft.state === state));
    }
    makeRing(target.titleProgress, record, true);
    target.heading.setAttribute('aria-label', `${target.entry.title}, ${summary(target.entry.key)}`);
    target.statusLabel.textContent = record ? labels[record.state] : S('statusUnrecorded');
    target.statusDot.style.borderColor = record ? colors[record.state] : colors.unstarted;
    target.timestamp.textContent = record ? (ui?.formatDate ? ui.formatDate(record.updatedAt) : new Date(record.updatedAt).toLocaleString(activeLang === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : '';
    target.scoreNumber.textContent = record?.progress ?? '—';
    target.scoreUnit.hidden = false;
    target.meter.style.setProperty('--fill', `${record?.progress ?? 0}%`);
    target.meter.style.setProperty('--mark', record ? colors[record.state] : colors.unstarted);
    target.sourceLabel.textContent = record ? (record.source === 'analysis' ? S('sourceAuto') : S('sourceManual')) : '';
    const summaryText = record?.note || '';
    if (target.overviewSummary.textContent !== summaryText) {
      target.overviewSummary.textContent = summaryText;
      target.setSummaryExpanded(false);
    }
    target.summaryBlock.hidden = !summaryText;
    target.noteOpen.textContent = record?.note ? S('editLabel') : S('addLabel');
    target.analyze.disabled = presentation ? presentation.analysisDisabled(target.busy || target.capabilities?.analyze === false, target.analyzing, target.updateInfo?.update?.stage) : target.busy || target.analyzing || ['waiting', 'installing'].includes(target.updateInfo?.update?.stage);
    target.renderHistory?.();
    positionPanel();
    target.scheduleMarquees?.();
    if (target.restoreScroll != null && (target.mode === 'edit' || target.analysisState)) {
      target.body.scrollTop = target.restoreScroll; target.restoreScroll = null;
    }
  }

  async function save(patch = {}, reset = false, target = panel) {
    if (!target || target.busy) return false;
    const raw = target.progress.value.trim();
    const progress = raw === '' ? null : Number(raw);
    if (!reset && progress !== null && (!Number.isInteger(progress) || progress < 0 || progress > 100)) {
      target.error.textContent = S('invalidProgressError'); return false;
    }
    const record = reset ? null : { ...target.draft, progress, note: target.note.value, ...patch };
    target.busy = true; target.error.textContent = '';
    for (const control of target.controls) control.disabled = true;
    try {
      const state = await target.request('update', 7000, { expectedRevision: target.revision, record });
      target.dirty = false;
      target.conflict = false; target.resolveConflict.hidden = true;
      rememberPanel(target);
      // 保存成功即补读一次，并吸收保存期间到达的待刷新，避免 finally 再读一次。
      target.syncVersion = panelVersion(target.entry.key); target.syncPending = false;
      if (embedded && state) target.showHistory(state); else target.pollHistory?.();
      return true;
    } catch (error) {
      target.error.textContent = error.message;
      if ((error.code === 'REVISION_CONFLICT' || (!error.code && (error.message === '此会话已在其他窗口更新，请重新确认' || error.message === S('conflictDetectedFeedback')))) && target.dirty && !reset) {
        target.conflict = true;
        target.resolveConflict.hidden = false;
        rememberPanel(target);
      }
      return false;
    } finally {
      target.busy = false;
      for (const control of target.controls) control.disabled = false;
      if (target.syncPending && panel === target) syncPanel(target);
      if (panel === target) { target.analyze.disabled = target.analyzing; refreshPanel(); }
    }
  }

  async function rebaseDraft(target) {
    if (target.busy || !target.conflict) return;
    target.busy = true;
    for (const control of target.controls) control.disabled = true;
    try {
      const state = await target.request('analysis-state', 7000);
      target.revision = snapshot.records[target.entry.key]?.revision ?? 0;
      target.conflict = false; target.resolveConflict.hidden = true;
      target.error.textContent = S('conflictReloadedFeedback');
      target.showHistory?.(state);
      rememberPanel(target);
    } catch (error) {
      target.error.textContent = error.message;
    } finally {
      target.busy = false;
      for (const control of target.controls) control.disabled = false;
      if (panel === target) {
        if (target.syncPending) syncPanel(target);
        refreshPanel();
      }
    }
  }

  function cancelRead(requestId, request) {
    if (!['project-git', 'analysis-state', 'app-update-info'].includes(request.type) || !(embedded || harness?.supportsRequestCancellation)) return;
    try { send(JSON.stringify({ type: 'cancel-request', requestId: `${requestPrefix}:${++serial}`, cancelRequestId: requestId })); } catch { /* Local cleanup still runs if the host has disconnected. */ }
  }
  function closePanel(restoreFocus = true) {
    if (!panel || panel.busy) return;
    for (const [id, request] of pending) {
      if (request.key === panel.entry.key && ['project-git', 'analysis-state', 'app-update-info'].includes(request.type) && (embedded || harness?.supportsRequestCancellation)) {
        cancelRead(id, request); clearTimeout(request.timer); pending.delete(id);
        request.reject(Object.assign(new Error(S('cardRequestCancelled')), { code: 'REQUEST_CANCELLED' }));
      }
    }
    rememberPanel(panel);
    panelEvent('close', panel.entry);
    const target = panel; panel = null;
    clearTimeout(target.pollTimer); cancelAnimationFrame(target.marqueeFrame);
    clearTimeout(target.updateTimer);
    target.resizeObserver?.disconnect();
    target.root.remove(); target.entry.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && target.entry.host.isConnected) target.entry.button.focus();
  }

  function openPanel(entry) {
    if (panel) return;
    const root = document.createElement('div');
    const initialMode = detectPanelColorMode(entry);
    root.setAttribute('data-codex-session-status-panel', '');
    root.setAttribute('data-color-mode', initialMode);
    syncAccent(root, initialMode === 'dark');
    if (!embedded) root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    const shadow = root.attachShadow({ mode: 'open' });
    element('style', `
      :host{--accent:${currentAccentPalette.normal || '#0169cc'};--accent-hover:${currentAccentPalette.hover || '#005bb3'};--accent-pressed:${currentAccentPalette.pressed || '#004f9c'};--on-accent:${currentAccentPalette.onAccent || '#ffffff'};--ease-out:cubic-bezier(0.23,1,0.32,1);--ease-in-out:cubic-bezier(0.77,0,0.175,1);--ink:#e6edf3;--secondary:#a0a6ad;--muted:#828c96;--note:#bbc3ca;--track:#ffffff12;--line:#ffffff14;--input-border:#ffffff18;--input-bg:#ffffff03;--hover:#ffffff09;--selected:#ffffff10;--source-bg:#ffffff0a;--number-line:#ffffff25;--thumb:#ffffff;--danger:#ef7777;--error:#f7ad86;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);color-scheme:dark}
      *{box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{display:none;width:0;height:0}button,input,textarea{font:inherit}button{cursor:pointer}button,input,textarea{color:inherit}[hidden]{display:none!important}
      .shell{position:fixed;pointer-events:auto;width:${presentation?.layout.panelWidth || 340}px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);display:flex;flex-direction:column;overflow:hidden;--panel-bg:#0e1318;background:var(--panel-bg);border:1px solid #ffffff1c;border-radius:20px;box-shadow:0 16px 54px #0005;padding:22px 20px 14px}
      .shell:hover{--panel-bg:#1f242a}.title-heading{display:flex;flex:none;align-items:flex-start;gap:10px;margin-right:24px;border-radius:5px;outline-offset:4px}
      h2.title{font-size:24px;font-weight:650;line-height:1.3;letter-spacing:-.5px;margin:0;min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
      .title-progress{display:flex;flex:none;width:32px;height:32px;margin-top:1px}.title-progress svg{width:32px;height:32px}.title-progress .progress-pie,.title-progress text{transition:opacity 160ms var(--ease-out),transform 160ms var(--ease-out);transform-origin:12px 12px}.title-progress text{opacity:0;transform:scale(.94)}.title-progress text.progress-unknown{opacity:1;transform:none}.title-heading:hover .progress-pie,.title-heading:focus-visible .progress-pie{opacity:0;transform:scale(.94)}.title-heading:hover text,.title-heading:focus-visible text{opacity:1;transform:scale(1)}
      .close{position:absolute;right:12px;top:7px;border:0;background:none;color:var(--secondary);font-size:0;width:28px;height:28px;padding:0;border-radius:6px;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out),background-color 150ms var(--ease-out)}.close:hover{color:var(--ink);background:var(--hover)}.close:active:not(:disabled){transform:scale(.94)}.close::before,.close::after{content:"";position:absolute;left:7px;top:13px;width:14px;height:1px;background:currentColor;transform:rotate(45deg)}.close::after{transform:rotate(-45deg)}
      .open-pane{position:absolute;right:44px;top:7px;border:0;background:none;color:var(--secondary);width:28px;height:28px;padding:0;border-radius:6px;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out),background-color 150ms var(--ease-out)}.open-pane:hover{color:var(--ink);background:var(--hover)}.open-pane:active:not(:disabled){transform:scale(.94)}.open-pane::before{content:"";position:absolute;left:7px;top:8px;width:14px;height:12px;border:1.3px solid currentColor;border-radius:3px;box-sizing:border-box}.open-pane::after{content:"";position:absolute;left:16px;top:8px;width:1.3px;height:12px;background:currentColor}.shell.has-open-pane .title-heading{margin-right:56px}.open-pane-tip{position:absolute;right:0;top:calc(100% + 6px);padding:5px 8px;border-radius:6px;background:var(--panel-bg);color:var(--ink);border:1px solid var(--line);box-shadow:0 4px 14px #0003;font-size:11px;line-height:1.4;white-space:nowrap;pointer-events:none;transform-origin:top right;opacity:0;transform:scale(.96) translateY(-2px);visibility:hidden;transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out),visibility 0s linear 150ms;z-index:2}.open-pane:is(:hover,:focus-visible) .open-pane-tip{opacity:1;transform:scale(1) translateY(0);visibility:visible;transition:opacity 150ms var(--ease-out) 160ms,transform 150ms var(--ease-out) 160ms,visibility 0s linear 160ms}
      .panel-body{overflow:auto;min-height:0;margin-top:23px;scrollbar-width:none;-ms-overflow-style:none}.panel-body::-webkit-scrollbar{display:none;width:0;height:0}.view{padding-bottom:4px}.status-line{display:flex;align-items:center;justify-content:space-between;gap:16px}.status-block{transform:translateY(2px);min-width:0;flex:1}.status-name{display:flex;align-items:center;gap:7px;line-height:18px;min-width:0}.status-name>span:last-child,.timestamp{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state-dot{width:10px;height:10px;border:1.5px solid;border-radius:50%;flex:none;transition:border-color 180ms var(--ease-out)}.timestamp{font-size:11px;line-height:16px;color:var(--secondary);margin-top:2px;margin-left:17px}.score{display:flex;align-items:baseline;line-height:1;font-variant-numeric:tabular-nums;flex:none}.score-number{font-size:39px;font-weight:550;letter-spacing:-1px}.score-unit{font-size:15px;color:var(--secondary);margin-left:3px}
      .meter{height:4px;background:var(--track);border-radius:999px;margin:14px 0 10px;overflow:hidden}.meter::after{content:"";display:block;height:100%;width:var(--fill);background:var(--mark);border-radius:inherit;transition:width 220ms var(--ease-out),background-color 180ms var(--ease-out)}.totals-row{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--secondary)}.totals,.source-label{font-size:11px;font-weight:400;line-height:16px}.source-label{margin-left:auto;text-align:right;white-space:nowrap}.summary-block{position:relative;margin:16px 0;outline:none}.overview-summary{font-size:13px;line-height:1.65;color:var(--note);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}.summary-expand{position:absolute;right:0;bottom:0;border:0;background:linear-gradient(to right,transparent,var(--panel-bg) 18px);padding:0 0 0 22px;color:var(--secondary);font-size:12px;line-height:21.45px;white-space:nowrap;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.summary-expand:hover{color:inherit}.summary-expand:active:not(:disabled){transform:scale(.97)}.summary-block.expanded .overview-summary{display:block;-webkit-line-clamp:unset}.summary-block.expanded .summary-expand{position:static;display:block;margin-left:auto;padding-left:0;background:none}
      .actions{display:flex;align-items:center;gap:14px;margin:18px 0 22px}.primary{border:0;background:var(--accent);color:var(--on-accent,#fff);border-radius:9px;padding:9px 14px;font-weight:550;min-height:36px;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 1px 2px rgba(0,0,0,.14);transition:transform 160ms var(--ease-out),background-color 160ms var(--ease-out),opacity 160ms var(--ease-out)}.primary:hover:not(:disabled){background:var(--accent-hover);color:var(--on-accent,#fff)}.primary:active:not(:disabled){background:var(--accent-pressed,var(--accent-hover));transform:scale(.97)}.text-button,.clear,.back{border:0;background:none;padding:0;color:var(--secondary);font-size:12px;white-space:nowrap;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.text-button:hover,.back:hover{color:inherit}.text-button:active:not(:disabled),.back:active:not(:disabled),.clear:active:not(:disabled){transform:scale(.97)}.actions .clear{margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap}.actions .clear:hover{color:var(--danger)}.actions .clear{position:relative}.clear-tooltip{position:absolute;right:0;bottom:calc(100% + 8px);padding:6px 9px;border-radius:6px;background:var(--panel-bg);color:var(--secondary);border:1px solid var(--line);box-shadow:0 6px 18px rgba(0,0,0,.22);font-size:11px;white-space:nowrap;pointer-events:none;transform-origin:bottom right;opacity:0;transform:scale(.96) translateY(3px);visibility:hidden;transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out),visibility 0s linear 150ms;z-index:2}.clear:is(:hover,:focus-visible) .clear-tooltip{opacity:1;transform:scale(1) translateY(0);visibility:visible;transition:opacity 150ms var(--ease-out) 160ms,transform 150ms var(--ease-out) 160ms,visibility 0s linear 160ms}.section-head{border-top:1px solid var(--line);padding-top:16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}.section-head h3{font-size:12px;font-weight:550;margin:0}.remaining-toggle{border:0;background:none;padding:0;transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.remaining-toggle:active:not(:disabled){transform:scale(.97)}.row-detail{font-size:12px;font-weight:400;line-height:18px;color:var(--secondary);white-space:nowrap}
      .task-row{position:relative;display:flex;gap:9px;align-items:flex-start;padding:9px 0;overflow:hidden;isolation:isolate}.task-dot{width:12px;height:12px;border:1.3px solid #c89b38;border-radius:50%;margin-top:4px;flex:none;transition:transform 180ms var(--ease-out),border-color 180ms var(--ease-out),background-color 180ms var(--ease-out)}.task-row[data-status=done] .task-dot{border-color:#548eea;background:#548eea22}.task-content{min-width:0;flex:1}.task-title{width:100%;overflow:hidden;mask-image:linear-gradient(to right,#000 calc(100% - 12px),transparent)}.task-track{display:flex;width:max-content;transform:translateX(0);transition:transform .22s ease-out}.task-copy{white-space:nowrap;flex:none}.task-row:is(:hover,:focus-within) .task-title.overflowing .task-track{transform:translateX(calc(-1 * var(--travel)));transition-duration:var(--duration,4s);transition-timing-function:linear;will-change:transform}.task-meta{font-size:10px;color:var(--secondary);margin-top:3px}.task-source{position:absolute;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;padding-left:28px;background:linear-gradient(to right,transparent,var(--panel-bg) 25px);opacity:0;pointer-events:none;transform:translateX(4px);transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out)}.task-source button{border:0;border-radius:6px;background:var(--source-bg);color:inherit;padding:5px 7px;font-size:11px;white-space:nowrap;transition:transform 160ms var(--ease-out),background-color 150ms var(--ease-out)}.task-source button:active:not(:disabled){transform:scale(.96)}.task-row:hover .task-source,.task-row:focus-within .task-source{opacity:1;pointer-events:auto;transform:none}.task-row:focus-visible{outline:1px solid var(--accent);outline-offset:1px}
      @media(prefers-reduced-motion:reduce){.task-row .task-title.overflowing .task-track{transform:none;transition:none}.task-title{overflow:auto}.primary:active:not(:disabled),.text-button:active:not(:disabled),.back:active:not(:disabled),.clear:active:not(:disabled),.choice:active:not(:disabled),.quiet-row:active:not(:disabled),.range-input:hover::-webkit-slider-thumb,.range-input:active::-webkit-slider-thumb{transform:none}}
      @media(hover:none){.task-source{opacity:1;pointer-events:auto;transform:none}}
      .empty{font-size:12px;color:var(--secondary);padding:13px 0}.quiet-row{border:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;width:100%;background:none;color:inherit;padding:15px 0;text-align:left;font-size:12px;transition:transform 160ms var(--ease-out),background-color 150ms var(--ease-out)}.quiet-row:active:not(:disabled){transform:scale(.988)}.quiet-row span:last-child{color:var(--secondary);transition:transform 160ms var(--ease-out),color 150ms var(--ease-out)}.quiet-row:hover span:last-child{transform:translateX(2px)}.overview-bottom{margin-top:13px}.view-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.view-heading h3{font-size:14px;font-weight:550;margin:0}.choice{display:flex;align-items:center;gap:10px;width:100%;padding:8px 9px;border:0;border-radius:7px;background:none;color:inherit;text-align:left;transition:transform 160ms var(--ease-out),background-color 150ms var(--ease-out)}.choice:hover{background:var(--hover)}.choice:active:not(:disabled){transform:scale(.988)}.choice[aria-pressed=true]{background:var(--selected)}.dot{width:12px;height:12px;border:1.6px solid var(--mark);border-radius:50%;flex:none;transition:background-color 180ms var(--ease-out),border-color 180ms var(--ease-out)}.choice[aria-pressed=true] .dot{background:var(--mark);box-shadow:inset 0 0 0 2px var(--panel-bg)}
      .progress-section{margin-top:20px}.progress-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.label{font-size:11px;color:var(--secondary)}.number-wrap{display:flex;align-items:center;gap:5px;color:var(--secondary)}.progress-number{appearance:textfield;color:var(--ink);width:65px;padding:2px 3px 4px;background:none;border:0;border-bottom:1px solid var(--number-line);font-size:27px;font-weight:550;text-align:right;font-variant-numeric:tabular-nums}.progress-number::-webkit-inner-spin-button{appearance:none}.range{position:relative;height:48px;margin-top:2px;--mark:#c89b38}.range-track{position:absolute;left:7px;right:7px;top:9px;height:6px;border-radius:999px;background:linear-gradient(to right,var(--range-fill,var(--mark)) var(--fill),var(--track) var(--fill));pointer-events:none;transition:background-color 160ms var(--ease-out)}.range.is-dragging .range-track{transition:none}.range-input{position:relative;appearance:none;width:100%;height:24px;background:transparent;margin:0;display:block;padding:0;cursor:pointer}.range-input::-webkit-slider-runnable-track{height:6px;background:transparent}.range-input::-webkit-slider-thumb{appearance:none;width:16px;height:16px;margin-top:-5px;background:var(--thumb);border:.5px solid rgba(0,0,0,.14);border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.28),0 0 0 .5px rgba(0,0,0,.08);transition:transform 150ms var(--ease-out),box-shadow 150ms var(--ease-out)}.range-input:hover::-webkit-slider-thumb{transform:scale(1.06)}.range-input:active::-webkit-slider-thumb{transform:scale(1.1);box-shadow:0 2px 6px rgba(0,0,0,.34),0 0 0 1px rgba(0,0,0,.12)}.range-nodes{position:absolute;left:7px;right:7px;top:0;pointer-events:none}.range-node{position:absolute;left:var(--at);top:8px;width:0;font-size:10px;font-weight:500;opacity:.78;color:var(--secondary);font-variant-numeric:tabular-nums}.range-node::before{display:none}.range-node-label{position:absolute;top:20px;left:0;transform:translateX(-50%)}.range-node:first-child .range-node-label{transform:none}.range-node:last-child .range-node-label{transform:translateX(-100%)}.unknown-row{display:flex;justify-content:flex-end;margin:2px 0 18px}.unknown{font-size:11px}
      .note-label{display:block;font-size:11px;color:var(--secondary);margin-bottom:8px}textarea{display:block;width:100%;resize:vertical;min-height:66px;max-height:140px;background:var(--input-bg);color:inherit;border:1px solid var(--input-border);border-radius:8px;padding:9px;line-height:1.6;font-size:12px;scrollbar-width:none;-ms-overflow-style:none}textarea::-webkit-scrollbar{display:none;width:0;height:0}textarea::placeholder{color:var(--muted)}.edit-actions{display:flex;justify-content:flex-end;gap:18px;align-items:center;padding:21px 0 16px}.git{font-size:11px;color:var(--secondary)}.analysis-message{font-size:11px;color:var(--secondary);margin:0 0 13px}.analysis-message:empty,.error:empty,.git:empty{display:none}.error{flex:none;font-size:12px;color:var(--error);padding-top:10px;white-space:pre-wrap}button:disabled,input:disabled,textarea:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      .shell textarea:focus-visible{outline:none}
      .app-update{margin-top:3px;padding:10px 11px;background:var(--hover);border:1px solid var(--line);border-radius:10px}.app-update-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.app-update-label{font-size:12px;line-height:18px;color:var(--ink);min-width:0;overflow-wrap:anywhere}.app-update-button{flex:none;padding:5px 10px;min-height:28px;border-radius:7px;font-size:11px}.app-update-detail{margin-top:7px;font-size:11px;line-height:1.6;color:var(--secondary);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.app-update[data-failed=true] .app-update-detail{color:var(--error)}
      :host([data-color-mode=light]){--ink:#22272e;--secondary:#576374;--muted:#667383;--note:#46515f;--track:#dfe4ea;--line:#dfe4ea;--input-border:#c7d0da;--input-bg:#f7f9fb;--hover:#f0f3f6;--selected:#e9edf2;--source-bg:#e9eef4;--number-line:#b6c1ce;--thumb:#ffffff;--danger:#bf2f3a;--error:#b13a2d;color:var(--ink);color-scheme:light}
      :host([data-color-mode=light]) .shell{--panel-bg:#fff;border-color:#dfe4ea;box-shadow:0 14px 45px #26344520}
      :host([data-color-mode=light]) .shell:hover{--panel-bg:#f5f6f7}
      :host([data-color-mode=light]) .range{--range-fill:color-mix(in srgb,var(--mark) 85%,#000)}
      :host([data-color-mode=light]) .meter::after{background:color-mix(in srgb,var(--mark) 85%,#000)}
      @media(prefers-color-scheme:light){
        :host(:not([data-color-mode=dark])){--ink:#22272e;--secondary:#576374;--muted:#667383;--note:#46515f;--track:#dfe4ea;--line:#dfe4ea;--input-border:#c7d0da;--input-bg:#f7f9fb;--hover:#f0f3f6;--selected:#e9edf2;--source-bg:#e9eef4;--number-line:#b6c1ce;--thumb:#ffffff;--danger:#bf2f3a;--error:#b13a2d;color:var(--ink);color-scheme:light}
        :host(:not([data-color-mode=dark])) .shell{--panel-bg:#fff;border-color:#dfe4ea;box-shadow:0 14px 45px #26344520}
        :host(:not([data-color-mode=dark])) .shell:hover{--panel-bg:#f5f6f7}
        :host(:not([data-color-mode=dark])) .range{--range-fill:color-mix(in srgb,var(--mark) 85%,#000)}
        :host(:not([data-color-mode=dark])) .meter::after{background:color-mix(in srgb,var(--mark) 85%,#000)}
      }
    `, shadow);
    if (embedded) element('style', '.shell,:host([data-color-mode=light]) .shell,:host(:not([data-color-mode=dark])) .shell{box-shadow:none}.shell{position:relative;max-width:100%;max-height:none}.panel-body{overflow:visible}', shadow);
    const shell = element('div', null, shadow, 'shell');
    shell.setAttribute('role', embedded ? 'region' : 'dialog'); shell.setAttribute('aria-label', S('panelAriaPattern', { title: entry.title }));
    const close = embedded ? null : element('button', '×', shell, 'close'); close?.setAttribute('aria-label', S('close'));
    // 宿主支持时，在关闭按钮左侧提供「在侧栏打开」：把卡片交给宿主的常驻侧栏面板。
    const openPane = harness?.openPane ? element('button', null, shell, 'open-pane') : null;
    let openPaneTip = null;
    if (openPane) {
      shell.classList.add('has-open-pane'); openPane.setAttribute('aria-label', S('openInSidebar'));
      openPaneTip = element('span', S('openInSidebar'), openPane, 'open-pane-tip');
      openPaneTip.setAttribute('role', 'tooltip');
    }
    const heading = element('div', null, shell, 'title-heading'); heading.tabIndex = 0;
    const titleProgress = element('span', null, heading, 'title-progress');
    element('h2', entry.title, heading, 'title');
    const body = element('div', null, shell, 'panel-body');
    const overview = element('div', null, body, 'view overview');
    const statusLine = element('div', null, overview, 'status-line');
    const statusBlock = element('div', null, statusLine, 'status-block');
    const statusName = element('div', null, statusBlock, 'status-name');
    const statusDot = element('span', null, statusName, 'state-dot');
    const statusLabel = element('span', null, statusName);
    const timestamp = element('div', null, statusBlock, 'timestamp');
    const score = element('div', null, statusLine, 'score');
    const scoreNumber = element('span', null, score, 'score-number');
    const scoreUnit = element('span', '%', score, 'score-unit');
    const meter = element('div', null, overview, 'meter');
    const totalsRow = element('div', null, overview, 'totals-row');
    const totals = element('span', S('totalsEmpty'), totalsRow, 'totals');
    const sourceLabel = element('span', null, totalsRow, 'source-label');
    const summaryBlock = element('div', null, overview, 'summary-block'); summaryBlock.tabIndex = 0;
    const overviewSummary = element('div', null, summaryBlock, 'overview-summary');
    const summaryExpand = element('button', S('expandAll'), summaryBlock, 'summary-expand');
    summaryExpand.hidden = true; summaryExpand.setAttribute('aria-expanded', 'false');
    const actions = element('div', null, overview, 'actions');
    const analyze = element('button', S('btnUpdate'), actions, 'primary analyze');
    const editOpen = element('button', S('btnAdjust'), actions, 'text-button edit-open');
    const clear = element('button', S('btnClear'), actions, 'clear');
    clear.setAttribute('aria-label', S('btnClear'));
    const clearTip = element('span', S('clearTooltip'), clear, 'clear-tooltip');
    clearTip.setAttribute('role', 'tooltip');
    const sectionHead = element('div', null, overview, 'section-head');
    const tasksHeading = element('h3', S('remainingHeadingPattern', { count: 0 }), sectionHead);
    const remainingToggle = element('button', null, sectionHead, 'remaining-toggle row-detail');
    remainingToggle.hidden = true; remainingToggle.setAttribute('aria-expanded', 'false');
    const currentTasks = element('div', null, overview, 'current-tasks');
    const bottom = element('div', null, overview, 'overview-bottom');
    const historyOpen = element('button', null, bottom, 'quiet-row history-open'); const historyRowTitle = element('span', S('completedHeading'), historyOpen);
    const historyCount = element('span', S('countArrowPattern', { count: 0 }), historyOpen, 'row-detail');
    const noteRow = element('button', null, bottom, 'quiet-row note-open'); const noteRowTitle = element('span', S('notesLabel'), noteRow);
    const noteOpen = element('span', S('addLabel'), noteRow);
    const timelineOpen = embedded ? element('button', S('timelineLink'), bottom, 'quiet-row timeline-open') : null;
    const appUpdate = element('div', null, bottom, 'app-update'); appUpdate.hidden = true;
    const appUpdateRow = element('div', null, appUpdate, 'app-update-row');
    const appUpdateLabel = element('span', null, appUpdateRow, 'app-update-label'); appUpdateLabel.setAttribute('role', 'status');
    const appUpdateButton = element('button', S('upgradeBtn'), appUpdateRow, 'primary app-update-button');
    const appUpdateDetail = element('div', null, appUpdate, 'app-update-detail'); appUpdateDetail.hidden = true;
    const edit = element('div', null, body, 'view edit-view'); edit.hidden = true;
    const editHeading = element('div', null, edit, 'view-heading'); const editHeadingTitle = element('h3', S('editHeading'), editHeading);
    const choices = new Map(), choiceLabels = new Map(), controls = [];
    for (const [state, label] of Object.entries(labels)) {
      const button = element('button', null, edit, 'choice'); button.style.setProperty('--mark', colors[state]);
      element('span', null, button, 'dot'); choiceLabels.set(state, element('span', label, button)); button.setAttribute('aria-pressed', 'false');
      choices.set(state, button); controls.push(button); if (state === 'pushed') button.hidden = true;
      button.onclick = () => updateDraft(target, { state, progress: state === 'unstarted' ? 0 : state === 'unfinished'
        ? target.draft.state === 'unfinished' ? target.draft.progress : null : 100 });
      button.onkeydown = event => {
        if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const buttons = [...choices.values()].filter(item => !item.hidden);
        buttons[(buttons.indexOf(button) + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
      };
    }
    const progressSection = element('div', null, edit, 'progress-section');
    const progressHead = element('div', null, progressSection, 'progress-head'); const progressHeadLabel = element('label', S('progressLabel'), progressHead, 'label');
    const numberWrap = element('div', null, progressHead, 'number-wrap');
    const progress = element('input', null, numberWrap, 'progress-number'); progress.type = 'number'; progress.min = '0'; progress.max = '100'; progress.step = '1'; progress.placeholder = '—'; progress.setAttribute('aria-label', S('progressLabel')); element('span', '%', numberWrap);
    const range = element('div', null, progressSection, 'range'); element('div', null, range, 'range-track');
    const nodes = element('div', null, range, 'range-nodes'); nodes.setAttribute('aria-hidden', 'true');
    for (const value of [0, 25, 50, 75, 100]) { const node = element('span', null, nodes, 'range-node'); node.style.setProperty('--at', `${value}%`); element('span', String(value), node, 'range-node-label'); }
    const slider = element('input', null, range, 'range-input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.setAttribute('aria-label', S('sliderAriaLabel'));
    const unknownRow = element('div', null, progressSection, 'unknown-row'); const unknown = element('button', S('clearValueBtn'), unknownRow, 'text-button unknown');
    const noteLabel = element('label', S('notesLabel'), edit, 'note-label');
    const note = element('textarea', null, edit); note.maxLength = 4000; note.placeholder = S('notePlaceholder'); note.setAttribute('aria-label', S('noteAriaLabel'));
    noteLabel.htmlFor = note.id = `session-status-note-${serial}`;
    const git = element('div', null, edit, 'git');
    const editActions = element('div', null, edit, 'edit-actions');
    const cancel = element('button', S('cancelBtn'), editActions, 'text-button cancel');
    const submit = element('button', S('saveBtn'), editActions, 'primary save-record');
    const history = element('div', null, body, 'view history-view'); history.hidden = true;
    const historyHeading = element('div', null, history, 'view-heading'); const historyHeadingTitle = element('h3', S('completedHeading'), historyHeading);
    const back = element('button', S('backLabel'), historyHeading, 'back');
    const historyList = element('div', null, history, 'history-list');
    const timelineView = embedded ? element('div', null, body, 'view history-view') : null;
    let timelineList, timelineHeadingTitle, timelineBackBtn;
    if (timelineView) {
      timelineView.hidden = true;
      const title = element('div', null, timelineView, 'view-heading'); timelineHeadingTitle = element('h3', S('timelineHeading'), title);
      timelineBackBtn = element('button', S('backLabel'), title, 'back');
      timelineBackBtn.onclick = () => target.setView('overview');
      timelineList = element('div', null, timelineView, 'history-list');
    }
    const analysisMessage = element('div', null, body, 'analysis-message'); analysisMessage.setAttribute('role', 'status');
    const error = element('div', null, shell, 'error'); error.setAttribute('role', 'status');
    const resolveConflict = element('button', S('resolveConflictBtn'), shell, 'text-button'); resolveConflict.hidden = true;
    controls.push(note, progress, slider, unknown, cancel, submit, clear, analyze, editOpen, resolveConflict);
    panel = { entry, root, shell, body, heading, titleProgress, choices, note, progress, slider, range, git, error, resolveConflict, controls,
      statusLabel, statusDot, timestamp, scoreNumber, scoreUnit, meter, sourceLabel, overviewSummary, summaryBlock, noteOpen,
      totals, analyze, historyList, dirty: false, busy: false, analyzing: false, revision: 0, mode: 'overview' };
    const target = panel;
    target.applyLocale = () => {
      shell.setAttribute('aria-label', S('panelAriaPattern', { title: entry.title }));
      close?.setAttribute('aria-label', S('close'));
      if (openPane) {
        openPane.setAttribute('aria-label', S('openInSidebar'));
        if (openPaneTip) openPaneTip.textContent = S('openInSidebar');
      }
      summaryExpand.textContent = target.summaryExpanded ? S('collapse') : S('expandAll');
      analyze.textContent = target.analyzing ? S('btnUpdating') : S('btnUpdate');
      editOpen.textContent = S('btnAdjust');
      clear.textContent = S('btnClear');
      clear.setAttribute('aria-label', S('btnClear'));
      clearTip.textContent = S('clearTooltip');
      historyRowTitle.textContent = S('completedHeading');
      noteRowTitle.textContent = S('notesLabel');
      if (timelineOpen) timelineOpen.textContent = S('timelineLink');
      editHeadingTitle.textContent = S('editHeading');
      for (const [state, labelEl] of choiceLabels) labelEl.textContent = labels[state];
      progressHeadLabel.textContent = S('progressLabel');
      progress.setAttribute('aria-label', S('progressLabel'));
      slider.setAttribute('aria-label', S('sliderAriaLabel'));
      unknown.textContent = S('clearValueBtn');
      noteLabel.textContent = S('notesLabel');
      note.placeholder = S('notePlaceholder');
      note.setAttribute('aria-label', S('noteAriaLabel'));
      cancel.textContent = S('cancelBtn');
      submit.textContent = S('saveBtn');
      historyHeadingTitle.textContent = S('completedHeading');
      back.textContent = S('backLabel');
      if (timelineHeadingTitle) timelineHeadingTitle.textContent = S('timelineHeading');
      if (timelineBackBtn) timelineBackBtn.textContent = S('backLabel');
      resolveConflict.textContent = S('resolveConflictBtn');
      target.tasksKey = null; target.completedKey = null; target.timelineRevision = null;
    };
    target.capabilities = embedded?.session?.capabilities || null;
    panelEvent('open', entry);
    target.request = (type, timeout, extra = {}) => new Promise((resolve, reject) => {
      const requestId = `${requestPrefix}:${++serial}`;
      const timer = setTimeout(() => { cancelRead(requestId, { type }); pending.delete(requestId); const error = new Error(S('cardRequestTimeout')); error.code = 'STATUS_REQUEST_TIMEOUT'; reject(error); }, timeout);
      pending.set(requestId, { resolve, reject, timer, type, key: entry.key });
      try { send(JSON.stringify({ type, requestId, key: entry.key, ...extra })); }
      catch { clearTimeout(timer); pending.delete(requestId); const error = new Error(S('cardStatusDisconnected')); error.code = 'STATUS_SEND_FAILED'; reject(error); }
    });
    resolveConflict.onclick = () => rebaseDraft(target);
    const showAppUpdate = info => {
      target.updateInfo = info;
      const update = info?.update;
      const stage = update?.stage;
      const stages = strings.updateStages || { queued: '正在准备升级', checking: '正在检查版本', downloading: '正在下载新版本', waiting: '等待当前分析结束', installing: '正在升级' };
      const active = Boolean(stages[stage]) || target.upgradeStarting;
      const completed = stage === 'completed' && Date.now() - Date.parse(update.updatedAt) < 60000;
      const failed = stage === 'failed';
      appUpdate.hidden = !info?.available && !active && !failed && !completed;
      appUpdate.setAttribute('data-failed', String(failed));
      appUpdateLabel.textContent = active ? stages[stage] || stages.queued : failed ? S('updateFailedLabel') : completed
        ? S('upgradedToPattern', { version: update.currentVersion }) : S('updateAvailablePattern', { version: info?.latestVersion });
      appUpdateButton.textContent = active ? S('pleaseWait') : completed ? S('completedShort') : failed ? S('retryBtn') : S('upgradeBtn');
      appUpdateButton.disabled = active || completed;
      const command = info?.command || 'npx agent-things@latest';
      appUpdateDetail.textContent = target.updateConnectionError ? `${S('reconnectHint')}\n${S('terminalUpgradePrefix')}${command}`
        : failed ? `${update.error}\n${S('terminalUpgradePrefix')}${command}` : completed && update.reconnectMcp ? S('reconnectMcpHint') : '';
      appUpdateDetail.hidden = !appUpdateDetail.textContent;
      refreshPanel();
      return active;
    };
    const pollAppUpdate = async () => {
      clearTimeout(target.updateTimer);
      try {
        const info = await target.request('app-update-info', 12000);
        if (panel !== target) return;
        target.updateConnectionError = null;
        const active = showAppUpdate(info);
        target.updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);
      } catch (error) {
        if (panel !== target) return;
        target.updateConnectionError = error.message;
        if (target.updateInfo) showAppUpdate(target.updateInfo);
        target.updateTimer = setTimeout(pollAppUpdate, 2000);
      }
    };
    appUpdateButton.onclick = async () => {
      if (appUpdateButton.disabled) return;
      clearTimeout(target.updateTimer);
      target.upgradeStarting = true;
      showAppUpdate(target.updateInfo);
      try {
        const info = await target.request('app-update-start', 12000);
        if (panel !== target) return;
        target.updateConnectionError = null;
        target.upgradeStarting = false;
        showAppUpdate(info);
      } catch (error) {
        if (panel !== target) return;
        target.upgradeStarting = false;
        target.updateConnectionError = error.message;
        showAppUpdate(target.updateInfo);
      }
      if (panel === target) target.updateTimer = setTimeout(pollAppUpdate, 1000);
    };
    target.scheduleMarquees = () => {
      cancelAnimationFrame(target.marqueeFrame);
      target.marqueeFrame = requestAnimationFrame(() => {
        if (panel !== target) return;
        if (target.mode === 'overview' && !target.summaryExpanded) summaryExpand.hidden = overviewSummary.scrollHeight <= overviewSummary.clientHeight + 1;
        for (const title of shadow.querySelectorAll('.task-title')) {
          if (!title.clientWidth) continue;
          const width = title.firstElementChild.firstElementChild.getBoundingClientRect().width;
          const maskWidth = title.closest('.task-row').querySelector('.task-source')?.offsetWidth || 0;
          const distance = Math.max(0, width - title.clientWidth + maskWidth + 8);
          title.classList.toggle('overflowing', distance > 1);
          title.style.setProperty('--travel', `${distance}px`);
          title.style.setProperty('--duration', `${Math.max(1, distance / 26)}s`);
        }
      });
    };
    target.setSummaryExpanded = expanded => {
      target.summaryExpanded = expanded;
      summaryBlock.classList.toggle('expanded', expanded);
      summaryExpand.textContent = expanded ? S('collapse') : S('expandAll');
      summaryExpand.setAttribute('aria-expanded', String(expanded));
      positionPanel(); target.scheduleMarquees();
    };
    summaryExpand.onclick = () => { summaryExpand.focus({ preventScroll: true }); target.setSummaryExpanded(!target.summaryExpanded); };
    summaryBlock.addEventListener('focusout', event => { if (!summaryBlock.contains(event.relatedTarget)) target.setSummaryExpanded(false); });
    target.resizeObserver = new ResizeObserver(target.scheduleMarquees); target.resizeObserver.observe(body);
    target.setView = mode => {
      target.mode = mode; overview.hidden = mode !== 'overview'; edit.hidden = mode !== 'edit'; history.hidden = mode !== 'history';
      if (timelineView) timelineView.hidden = mode !== 'timeline';
      body.scrollTop = 0; target.error.textContent = '';
      if (mode !== 'edit') { target.conflict = false; resolveConflict.hidden = true; }
      refreshPanel();
      rememberPanel(target);
    };
    const cancelEdit = () => { target.dirty = false; target.setView('overview'); editOpen.focus(); };
    target.cancelEdit = cancelEdit;
    editOpen.onclick = () => { target.setView('edit'); (choices.get(target.draft.state) || choices.values().next().value).focus(); };
    noteRow.onclick = () => { target.setView('edit'); note.focus(); };
    historyOpen.onclick = () => target.setView('history'); back.onclick = () => target.setView('overview'); cancel.onclick = cancelEdit;
    if (timelineOpen) timelineOpen.onclick = () => target.setView('timeline');
    remainingToggle.onclick = () => { target.remainingExpanded = !target.remainingExpanded; refreshPanel(); };
    const locate = async source => {
      if (target.capabilities?.locate === false) { analysisMessage.textContent = S('locateHostDisconnected'); return; }
      if (embedded) {
        if (!source?.turnId || !source?.itemId) { analysisMessage.textContent = S('locateNoSource'); return; }
        analysisMessage.textContent = S('locatingMessage');
        try {
          const result = await target.request('locate-source', 14000, { source: { turnId: source.turnId, itemId: source.itemId } });
          analysisMessage.textContent = result?.message || S('locatedMessage');
        } catch (error) { analysisMessage.textContent = error.message; }
        return;
      }
      if (!source?.turnId || !source?.itemId) { analysisMessage.textContent = S('locateNoSource'); return; }
      const harness = window.__sessionStatusHarness;
      if (harness?.locate) {
        try { await harness.locate({ entry, source, analysisMessage, request: target.request }); }
        catch (error) { analysisMessage.textContent = error.message; }
        return;
      }
      const row = entry.row;
      if (row.getAttribute('data-app-action-sidebar-thread-selected') !== 'true') {
        const trigger = row.querySelector('[data-thread-title-trigger]');
        if (!trigger) { analysisMessage.textContent = S('locateOpenFailed'); return; } trigger.click();
      }
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (row.getAttribute('data-app-action-sidebar-thread-selected') === 'true') {
          const message = [...document.querySelectorAll('[data-content-search-unit-key]')].find(node => node.getAttribute('data-content-search-unit-key') === `${source.turnId}:${source.itemId}`);
          if (message) { message.scrollIntoView({ block: 'center', behavior: 'smooth' }); const previous = message.style.outline; const highlight = `2px solid ${currentAccent || '#0169cc'}`; message.style.outline = highlight; setTimeout(() => { if (message.style.outline === highlight || message.style.outline.startsWith('2px solid')) message.style.outline = previous; }, 3000); analysisMessage.textContent = S('locatedMessage'); return; }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      try { await target.request('locate-source', 30000, { source }); analysisMessage.textContent = S('locatedMessage'); }
      catch (error) { analysisMessage.textContent = error.message; }
    };
    const renderTask = (task, sources, parent) => {
      const row = element('div', null, parent, 'task-row'); row.dataset.status = task.status; row.tabIndex = 0;
      element('span', null, row, 'task-dot'); const content = element('div', null, row, 'task-content');
      const title = element('div', null, content, 'task-title'); title.title = task.title;
      const track = element('div', null, title, 'task-track');
      const text = task.title || task.summary;
      element('span', text, track, 'task-copy');
      element('div', taskLabels[task.status] || S('taskUnknown'), content, 'task-meta');
      const ref = task.evidenceRefs?.find(value => sources?.[value]?.turnId);
      if (ref) { const mask = element('div', null, row, 'task-source'); const link = element('button', S('viewSource'), mask); link.setAttribute('aria-label', `${S('viewSourceAriaPrefix')}${task.title}`); link.onclick = () => locate(sources[ref]); }
    };
    target.renderHistory = () => {
      const state = target.analysisState; if (!state) return;
      if (timelineList && target.timelineRevision !== state.revision) {
        target.timelineRevision = state.revision;
        timelineList.replaceChildren();
        for (const item of [...(state.timeline || [])].reverse()) {
          const date = new Date(item.requestedAt).toLocaleString(activeLang === 'en' ? 'en-US' : 'zh-CN');
          const progress = item.record?.progress ?? item.progress;
          const label = item.source === 'analysis' ? S('timelineAnalysis') : S('timelineManual');
          const value = item.status === 'failed' ? S('analysisFailedWord') : item.status === 'pending' ? S('analyzingWord') : progress == null ? S('unrecordedShort') : `${progress}%`;
          element('div', `${date} · ${label} · ${value}`, timelineList, 'quiet-row');
        }
        if (!timelineList.childElementCount) element('div', S('emptyTimeline'), timelineList, 'empty');
      }
      const ledger = state.analysis?.ledger; const tasks = ledger?.tasks || [];
      const remaining = tasks.filter(task => ['todo', 'in_progress', 'blocked', 'needs_verification'].includes(task.status));
      const completed = tasks.filter(task => task.status === 'done');
      totals.textContent = tasks.length ? S('totalsPattern', { done: completed.length, total: tasks.length }) : S('totalsEmpty');
      tasksHeading.textContent = S('remainingHeadingPattern', { count: remaining.length });
      remainingToggle.hidden = remaining.length <= 3;
      remainingToggle.textContent = target.remainingExpanded ? S('collapseArrow') : S('showAllCountPattern', { count: remaining.length });
      remainingToggle.setAttribute('aria-expanded', String(Boolean(target.remainingExpanded)));
      const tasksKey = JSON.stringify([remaining, state.analysis?.sources, Boolean(target.remainingExpanded), activeLang]);
      if (target.tasksKey !== tasksKey) {
        target.tasksKey = tasksKey; currentTasks.replaceChildren();
        if (!tasks.length) element('div', S('emptyNoTasks'), currentTasks, 'empty');
        else if (!remaining.length) element('div', S('emptyNoRemaining'), currentTasks, 'empty');
        for (const task of target.remainingExpanded ? remaining : remaining.slice(0, 3)) renderTask(task, state.analysis?.sources, currentTasks);
      }
      historyCount.textContent = S('countArrowPattern', { count: completed.length });
      const completedKey = JSON.stringify([completed, state.analysis?.sources, activeLang]);
      if (target.completedKey === completedKey) return;
      target.completedKey = completedKey; historyList.replaceChildren();
      for (const task of completed) renderTask(task, state.analysis?.sources, historyList);
      if (!completed.length) element('div', S('emptyCompleted'), historyList, 'empty');
    };

    const pollHistory = () => {
      if (panel !== target) return;
      target.request('analysis-state', 7000).then(showHistory).catch(() => {
        if (panel !== target) return;
        analysisMessage.textContent = S('retryingStatus');
        clearTimeout(target.pollTimer); target.pollTimer = setTimeout(pollHistory, 2000);
      });
    };
    target.pollHistory = pollHistory;
    const showHistory = state => {
      if (panel !== target || !state || (target.historyRevision ?? -1) > state.revision) return;
      target.historyRevision = state.revision; target.analysisState = state;
      const active = (state.timeline || []).find(item => item.source === 'analysis' && item.status === 'pending');
      target.analyzing = Boolean(active); analyze.disabled = target.analyzing;
      const stages = strings.analysisStages || { starting: '正在启动分析', reading: '正在读取会话', retrying: '正在重新连接', analyzing: '正在分析任务' };
      target.stageMessage = active ? (stages[active.stage] || stages.analyzing) : '';
      const latest = state.timeline?.at(-1);
      analysisMessage.textContent = target.stageMessage || (latest?.status === 'failed' ? `${S('analysisFailedPrefix')}${latest.error || S('analysisFailedRetry')}` : ''); analyze.textContent = active ? S('btnUpdating') : S('btnUpdate');
      clearTimeout(target.pollTimer); if (active && !embedded?.streamConnected) target.pollTimer = setTimeout(pollHistory, 2000);
      refreshPanel();
    };
    target.showHistory = showHistory;
    analyze.onclick = async () => {
      analyze.disabled = true; analysisMessage.textContent = S('startingAnalysisFeedback');
      try { showHistory(await target.request('analyze', 7000)); }
      catch (error) {
        if (panel !== target) return;
        if (['STATUS_REQUEST_TIMEOUT', 'STATUS_SEND_FAILED'].includes(error.code)) {
          analysisMessage.textContent = S('retryingStatus'); clearTimeout(target.pollTimer); target.pollTimer = setTimeout(pollHistory, 2000);
        } else { analysisMessage.textContent = error.message; analyze.disabled = false; }
      }
    };
    const setProgress = value => {
      const state = presentation ? presentation.progressState(target.draft.state, value) : value === 100 ? target.draft.state === 'pushed' ? 'pushed' : 'completed'
        : value === 0 && target.draft.state === 'unstarted' ? 'unstarted' : 'unfinished';
      updateDraft(target, { progress: value, state });
    };
    let dragging = false;
    slider.onpointerdown = () => { dragging = true; range.classList.add('is-dragging'); };
    const endDrag = () => { dragging = false; range.classList.remove('is-dragging'); }; slider.onpointerup = endDrag; slider.onpointercancel = endDrag; slider.onlostpointercapture = endDrag;
    slider.oninput = () => { const value = Number(slider.value), nearest = Math.round(value / 25) * 25; setProgress(presentation ? presentation.progressValue(value, dragging) : dragging && Math.abs(value - nearest) <= 2 ? nearest : value); };
    progress.oninput = () => { const raw = progress.value.trim(); if (!raw) setProgress(null); else if (Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 100) setProgress(Number(raw)); else target.dirty = true; };
    unknown.onclick = () => setProgress(null);
    note.oninput = () => { target.draft.note = note.value; target.dirty = true; rememberPanel(target); };
    submit.onclick = async () => { if (await save({}, false, target)) target.setView('overview'); };
    progress.onkeydown = event => { if (event.key === 'Enter') submit.click(); };
    clear.onclick = async () => { if (await save({}, true, target)) target.setView('overview'); };
    if (close) close.onclick = () => closePanel();
    if (openPane) openPane.onclick = async () => {
      openPane.disabled = true; analysisMessage.textContent = '';
      try { await harness.openPane({ entry, request: target.request }); if (panel === target) closePanel(); }
      catch (error) { if (panel === target) { openPane.disabled = false; analysisMessage.textContent = error.message; } }
    };
    // 完整子树与主题属性就绪后一次性挂载进文档，杜绝首帧按默认暗底渲染后再切浅色的闪烁。
    (embedded?.container || document.body).append(root);
    // 首次历史读取前以当前快照为基线：读取期间到达的新版快照会触发补读。
    target.syncVersion = panelVersion(entry.key);
    if (embedded?.analysisState) showHistory(embedded.analysisState); else pollHistory();
    pollAppUpdate();
    target.request('project-git', 14000).then(info => { if (panel === target) { target.projectGit = info; refreshPanel(); } }).catch(() => {
      if (panel === target) { target.projectGit = { status: 'unknown', hasRemote: false }; refreshPanel(); }
    });
    entry.button?.setAttribute('aria-expanded', 'true'); refreshPanel();
    const remembered = rememberedPanel(entry.key);
    if (remembered) restorePanel(target, remembered); else if (!embedded) editOpen.focus();
  }

  function receive(next) {
    if (!next || (next.revision < snapshot.revision && (!next.lang || next.lang === activeLang))) return;
    const langChanged = next.lang ? setLang(next.lang) : false;
    snapshot = next;
    if (langChanged && panel) panel.applyLocale?.();
    for (const entry of mounted.values()) paint(entry);
    refreshPanel();
    // 其他入口改了这个会话（保存、清除、分析、任务来源）：按单会话数据版本补读；弹窗忙时记下，空闲后补读一次。乱序回复由 historyRevision 丢弃。
    if (panel?.pollHistory) syncPanel(panel);
  }

  function panelVersion(key) {
    if (snapshot.keyVersions) return snapshot.keyVersions[key] ?? snapshot.keyVersionBase ?? 0;
    return JSON.stringify([snapshot.records?.[key] || null, (snapshot.analyzingKeys || []).includes(key)]);
  }

  function syncPanel(target) {
    const version = panelVersion(target.entry.key);
    if (target.syncVersion === undefined) { target.syncVersion = version; return; }
    if (target.syncVersion === version && !target.syncPending) return;
    if (target.busy) { target.syncPending = true; return; }
    target.syncVersion = version; target.syncPending = false; target.pollHistory();
  }

  function onOutside(event) {
    if (!panel || event.composedPath().includes(panel.root) || event.composedPath().includes(panel.entry.host)) return;
    if (event.composedPath().some(node => node.hasAttribute?.('data-codex-session-status'))) return;
    closePanel(false);
  }

  function onKey(event) {
    if (!panel || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation();
    closePanel();
  }

  function onScroll() {
    if (!panel) return;
    if (!visible(panel.entry.host)) closePanel(false);
    else positionPanel();
  }

  const observer = new MutationObserver(records => {
    if (records.every(r => r.target.closest?.('[data-codex-session-status], [data-codex-session-status-panel]'))) return;
    schedule();
  });
  const rootObserver = !embedded ? new MutationObserver(() => {
    const mode = panel?.root.getAttribute('data-color-mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    syncAccent(panel?.root, mode === 'dark');
    for (const entry of mounted.values()) {
      entry.host?.style.setProperty('--accent', currentAccent);
      if (snapshot.analyzingKeys?.includes(entry.key)) makeRing(entry.button, recordFor(entry.key), false, true);
    }
  }) : null;
  const headObserver = !embedded && document.head ? new MutationObserver(() => {
    const mode = panel?.root.getAttribute('data-color-mode') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    syncAccent(panel?.root, mode === 'dark');
    for (const entry of mounted.values()) entry.host?.style.setProperty('--accent', currentAccent);
  }) : null;
  const filter = harness?.attributeFilter || ['data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-id', 'data-app-action-sidebar-thread-host-id', 'data-app-action-sidebar-thread-title', 'hidden', 'aria-expanded', 'style', 'class', 'data-theme', 'data-mode'];
  if (!embedded) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: filter });
    rootObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-mode', 'data-appearance-preset'] });
    headObserver?.observe(document.head, { childList: true, subtree: true, characterData: true });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
  }
  window.addEventListener('resize', positionPanel);
  syncAccent(null, matchMedia('(prefers-color-scheme: dark)').matches);
  const api = {
    receive(next) { receive(next); localCards?.receive(next); },
    receiveCardEvent({ snapshot: next, analysisState, session }) {
      if (!embedded) return;
      embedded.streamConnected = true;
      if (!next || next.revision < snapshot.revision) return;
      if (panel && session?.key === panel.entry.key) panel.capabilities = session.capabilities;
      receive(next);
      panel?.showHistory(analysisState);
    },
    disconnectCardEvents() {
      if (!embedded?.streamConnected) return;
      embedded.streamConnected = false;
      if (panel?.analyzing) panel.pollHistory();
    },
    setTheme(theme) {
      if (!embedded) return;
      if (['light', 'dark'].includes(theme) && embedded.theme !== theme) {
        embedded.theme = theme;
        positionPanel();
      } else if (panel?.root) {
        if (panel.root.getAttribute('data-color-mode') !== (embedded.theme || theme) && ['light', 'dark'].includes(embedded.theme || theme)) {
          positionPanel();
        } else {
          syncAccent(panel.root, (embedded.theme || 'dark') === 'dark');
        }
      }
    },
    reply(message) {
      localCards?.reply(message);
      const { requestId, error, errorInfo, session, snapshot: next, analysisState, projectGit, updateInfo, navigation, pane } = message;
      if (panel && session?.key === panel.entry.key) panel.capabilities = session.capabilities;
      receive(next);
      const request = pending.get(requestId);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(requestId);
      if (error) request.reject(Object.assign(new Error(error), errorInfo || {})); else request.resolve(navigation || updateInfo || projectGit || analysisState || pane);
    },
    status: () => ({ mounted: mounted.size, panelOpen: Boolean(panel), revision: snapshot.revision, version, startup: { ...startup } }),
    exportForReload({ allowPending = false } = {}) {
      if (!allowPending && (panel?.busy || pending.size)) return { busy: true };
      const active = panel ? rememberPanel(panel) : null;
      return { snapshot, panel: active, panelStates: [...panelStates], localCards: localCards?.exportState() };
    },
    destroy() {
      destroyed = true; localCards?.destroy(); harness?.dispose?.(); observer.disconnect(); rootObserver?.disconnect(); headObserver?.disconnect(); cancelAnimationFrame(frame);
      if (panel) { rememberPanel(panel); panelEvent('dispose', panel.entry); clearTimeout(panel.pollTimer); clearTimeout(panel.updateTimer); cancelAnimationFrame(panel.marqueeFrame); panel.resizeObserver?.disconnect(); panel.root.remove(); panel.entry.button?.setAttribute('aria-expanded', 'false'); panel = null; }
      for (const entry of [...mounted.values()]) unmount(entry);
      document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', positionPanel);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(S('cardDaemonDisconnected'))); }
      pending.clear(); if (!embedded?.independent) delete window.__codexSessionStatus;
      if (harness?.globalName && window[harness.globalName]) delete window[harness.globalName];
    }
  };
  if (!embedded?.independent) window.__codexSessionStatus = api;
  if (!embedded?.independent && harness?.globalName) window[harness.globalName] = api;
  if (embedded) {
    receive(embedded.snapshot);
    openPanel({ key: embedded.key, title: embedded.title });
    if (restored?.panel) restorePanel(panel, restored.panel);
    return api;
  }
  localCards = harness?.createLocalCards?.({
    mount: (options, state) => installCodexSessionStatus(version, state, options),
    send: payload => send(payload), snapshot: () => snapshot, restored: restored?.localCards,
  });
  reconcile();
  if (restored) {
    receive(restored.snapshot);
    const saved = restored.panel;
    const entry = saved && [...mounted.values()].find(item => item.key === saved.key);
    if (entry) {
      panelStates.set(saved.key, saved);
      openPanel(entry);
    }
  }
}


