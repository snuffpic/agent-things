'use strict';
(function () {
  const getUiText = (key, fallback) => {
    const p = window.__agentThingsPresentation;
    const lang = window.__agentThingsLang || p?.lang || 'zh';
    const ui = p?.forLang ? p.forLang(lang) : null;
    return ui?.strings?.[key] ?? p?.strings?.[key] ?? fallback;
  };
  const codexHarness = {
    globalName: '__codexSessionStatus',
    createLocalCards: options => createCodexLocalCards(options),
    supportsRequestCancellation: true,
    attributeFilter: [
      'data-app-action-sidebar-thread-selected',
      'data-app-action-sidebar-thread-id',
      'data-app-action-sidebar-thread-host-id',
      'data-app-action-sidebar-thread-title',
      'data-app-action-sidebar-thread-kind',
      'hidden',
      'aria-expanded',
      'style',
      'class',
      'data-theme'
    ],

    send(payload) {
      if (typeof window.__codexSessionStatusSend === 'function') {
        window.__codexSessionStatusSend(payload);
      }
    },

    isRowSelected(row) {
      if (!row) return false;
      return row.getAttribute('data-app-action-sidebar-thread-selected') === 'true';
    },

    reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelBusy, isPanelEntry }) {
      for (const entry of mounted.values()) {
        if (!entry.row.isConnected ||
            !entry.host.isConnected ||
            entry.row.getAttribute('data-app-action-sidebar-thread-id') !== entry.threadId ||
            entry.row.getAttribute('data-app-action-sidebar-thread-host-id') !== entry.rawHost) {
          if (entry.slot?.classList.contains('status-slot-injected')) {
            entry.slot.remove();
          }
          unmount(entry);
        }
      }

      // 支持匹配全部侧边栏会话项（包括项目列表项与近期普通会话项）
      const rows = document.querySelectorAll('[data-app-action-sidebar-thread-row]');
      for (const row of rows) {
        const kind = row.getAttribute('data-app-action-sidebar-thread-kind');
        if (kind !== 'local' && kind !== 'remote') continue;
        const threadId = row.getAttribute('data-app-action-sidebar-thread-id');
        if (!threadId) continue;

        const titleNode = row.querySelector('[data-thread-title]');
        const title = row.getAttribute('data-app-action-sidebar-thread-title') || titleNode?.textContent?.trim() || getUiText('fallbackThreadTitle', '会话');
        const existing = mounted.get(row);
        if (existing) {
          if (existing.title !== title) { existing.title = title; paint(existing); }
          paintVisibility(existing);
          continue;
        }

        // 识别或挂载插槽（仅在原生前置槽位完全空置时复用；若已被原生图标占用或不存在，则插入独立防溢出插槽）
        const trigger = titleNode?.closest('[data-thread-title-trigger]') || row.querySelector('button') || row.firstElementChild;
        let slot = trigger?.previousElementSibling;
        let emptyWrapper = false;
        let placeholder = null;

        if (slot && slot.classList.contains('status-slot-injected')) {
          // 已存在的独立注入槽
          emptyWrapper = false;
        } else if (slot && slot.classList.contains('w-4')) {
          placeholder = slot.firstElementChild;
          emptyWrapper = slot.childElementCount === 1 && placeholder?.tagName === 'DIV' &&
            placeholder.childElementCount === 0 && !placeholder.textContent.trim();
        }

        // 若前置槽不存在、或者虽有 w-4 但里面有原生真实图标占用，则创建并插入独立插槽
        if (!slot || (!slot.classList.contains('status-slot-injected') && !emptyWrapper)) {
          slot = row.querySelector('.status-slot-injected');
          if (!slot) {
            slot = document.createElement('div');
            slot.className = 'status-slot-injected w-4';
            slot.style.cssText = 'width:24px;min-width:24px;display:flex;align-items:center;justify-content:center;flex-shrink:0';
            if (trigger?.parentElement) {
              trigger.parentElement.insertBefore(slot, trigger);
            } else {
              row.prepend(slot);
            }
          }
          emptyWrapper = false;
          placeholder = null;
        }

        const rawHost = row.getAttribute('data-app-action-sidebar-thread-host-id');
        const key = JSON.stringify([rawHost || (kind === 'remote' ? 'cloud' : 'local'), threadId]);
        const { host, button, original } = attachHost(slot, emptyWrapper, placeholder);
        const entry = { row, key, threadId, rawHost, title, slot, host, button, original, hovered: row.matches(':hover') };

        entry.onEnter = () => { entry.hovered = true; paintVisibility(entry); };
        entry.onLeave = () => { entry.hovered = false; paintVisibility(entry); };
        row.addEventListener('pointerenter', entry.onEnter);
        row.addEventListener('pointerleave', entry.onLeave);

        mounted.set(row, entry);
        paint(entry);

        button.onclick = event => {
          event.stopPropagation();
          if (isPanelBusy()) return;
          if (isPanelEntry(entry)) closePanel(true);
          else { closePanel(); openPanel(entry); }
        };
      }
    },

    async locate({ entry, source, analysisMessage }) {
      if (!source?.turnId || !source?.itemId) {
        analysisMessage.status = 'not_found';
        analysisMessage.textContent = getUiText('locateNoSource', '此记录没有可定位的消息');
        return;
      }

      const row = entry.row;
      const targetThreadId = source.threadId ? (source.threadId.startsWith('local:') ? source.threadId : 'local:' + source.threadId) : entry.threadId;

      // 1. 若当前会话未激活，先自动切换打开来源会话
      if (row.getAttribute('data-app-action-sidebar-thread-selected') !== 'true') {
        const trigger = row.querySelector('[data-thread-title-trigger]') || row.querySelector('button') || row;
        trigger.click();
      }

      const deadline = Date.now() + 4500;
      let isCurrent = false;
      while (Date.now() < deadline) {
        isCurrent = row.getAttribute('data-app-action-sidebar-thread-selected') === 'true' ||
          [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')].some(r =>
            r.getAttribute('data-app-action-sidebar-thread-selected') === 'true' &&
            r.getAttribute('data-app-action-sidebar-thread-id') === targetThreadId);
        if (isCurrent) break;
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      if (!isCurrent) {
        analysisMessage.status = 'not_found';
        analysisMessage.textContent = getUiText('locateOpenFailed', '未能打开来源会话，请重试');
        return;
      }

      const unitKey = `${source.turnId}:${source.itemId}`;
      const escapedKey = CSS.escape(unitKey);
      const escapedTurn = CSS.escape(source.turnId);

      // 2. 策略 1：检查目标节点是否已在当前 DOM 中挂载
      let targetNode = document.querySelector(`[data-content-search-unit-key="${escapedKey}"]`) ||
                       document.querySelector(`[data-turn-key="history-content:turn:${escapedTurn}"]`);

      // 策略 2：若当前不在 DOM 中（虚拟列表卸载），利用 Codex 官方右侧常驻 Navigation Rail 原生直达
      if (!targetNode) {
        const navBtn = document.querySelector(`[data-thread-user-message-navigation-item-id="${escapedKey}"]`) ||
                       document.querySelector(`[data-thread-user-message-navigation-item-id^="${escapedTurn}:"]`) ||
                       document.querySelector(`[data-thread-user-message-navigation-item-id="${escapedTurn}"]`);
        if (navBtn) {
          analysisMessage.textContent = getUiText('locatingMessage', '正在定位消息…');
          navBtn.click();
          // 等待官方虚拟列表挂载目标回合
          const deadline = Date.now() + 1500;
          while (Date.now() < deadline) {
            targetNode = document.querySelector(`[data-content-search-unit-key="${escapedKey}"]`) ||
                         document.querySelector(`[data-turn-key="history-content:turn:${escapedTurn}"]`);
            if (targetNode) break;
            await new Promise(r => setTimeout(r, 60));
          }
        }
      }

      // 策略 3：如果包含 locator 文本，尝试在已渲染的气泡或全文中进行文本比对兜底
      if (!targetNode && source.locator) {
        const bubbles = [...document.querySelectorAll('[data-content-search-unit-key], [data-user-message-bubble]')];
        const quote = source.locator.replace(/\s+/g, ' ').trim();
        const matches = [...new Set(bubbles.filter(b => (b.textContent || '').replace(/\s+/g, ' ').includes(quote)).map(b => b.closest('[data-content-search-unit-key]') || b))];
        const match = matches.length === 1 ? matches[0] : null;
        if (match) targetNode = match.closest('[data-content-search-unit-key]') || match.closest('[data-turn-key]') || match;
      }

      // 3. 执行平滑视口居中与呼吸发光动画
      if (targetNode) {
        targetNode.scrollIntoView({ block: 'center', behavior: 'smooth' });

        const bubble = targetNode.querySelector('[data-user-message-bubble]') || targetNode;
        try {
          bubble.animate?.(
            [
              { backgroundColor: 'color-mix(in srgb, var(--color-text, #fff) 22%, transparent)' },
              { backgroundColor: 'color-mix(in srgb, var(--color-text, #fff) 22%, transparent)', offset: 0.35 },
              { backgroundColor: 'transparent' }
            ],
            { duration: 2000, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
          );
        } catch { /* ignore */ }

        const previousOutline = bubble.style.outline;
        const previousBoxShadow = bubble.style.boxShadow;
        bubble.style.outline = '2px solid #548eea';
        bubble.style.boxShadow = '0 0 14px rgba(84, 142, 234, 0.5)';
        setTimeout(() => {
          if (bubble.style.outline === '2px solid rgb(84, 142, 234)') {
            bubble.style.outline = previousOutline;
            bubble.style.boxShadow = previousBoxShadow;
          }
        }, 3000);

        analysisMessage.status = 'located';
        analysisMessage.textContent = getUiText('locatedMessage', '已定位来源');
      } else {
        analysisMessage.status = 'not_found';
        analysisMessage.textContent = getUiText('locateNotFound', '未找到原始消息，可能已被清理');
      }
    }
  };

  window.__sessionStatusHarness = codexHarness;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { codexHarness };
  }
})();
