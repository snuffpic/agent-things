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

    // 宿主桥代发写操作（保存、清除、分析、版本更新）
    if (data.type === 'AGENT_THINGS_ACTION_PROXY') {
      const { nonce, action, payload } = data;
      if (!nonce) return;
      try {
        const key = JSON.stringify(['local', boundConvId]);
        const isUpdateAction = action === 'app-update-info' || action === 'app-update-start';
        let rpcMsg = null;
        if (action === 'update') {
          rpcMsg = { type: 'update', key, record: payload.record, expectedRevision: payload.expectedRevision, requestId: 'proxy-update-' + Date.now() };
        } else if (action === 'clear') {
          rpcMsg = { type: 'clear', key, expectedRevision: payload.expectedRevision, requestId: 'proxy-clear-' + Date.now() };
        } else if (action === 'analyze') {
          rpcMsg = { type: 'analyze', key, requestId: 'proxy-analyze-' + Date.now() };
        } else if (action === 'app-update-info') {
          rpcMsg = {
            type: 'app-update-info',
            key,
            ...(typeof payload?.force === 'boolean' ? { force: payload.force } : {}),
            requestId: 'proxy-update-info-' + Date.now(),
          };
        } else if (action === 'app-update-start') {
          rpcMsg = { type: 'app-update-start', key, requestId: 'proxy-update-start-' + Date.now() };
        }
        if (rpcMsg) {
          const res = await fetch(`${getServiceOrigin()}/rpc`, {
            method: 'POST',
            headers: getServiceHeaders(),
            body: JSON.stringify(rpcMsg),
          });
          const reply = await res.json();
          if (isUpdateAction) {
            sendReplyToCard(binding, targetPort, {
              type: 'AGENT_THINGS_ACTION_RESULT',
              nonce,
              action,
              success: !reply.error,
              error: reply.error || null,
              updateInfo: reply.updateInfo || null,
              data: { updateInfo: reply.updateInfo || null, lang: reply.lang },
            });
            return;
          }
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
