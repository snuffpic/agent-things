'use strict';
(function () {
  const padding = new Map();
  const identity = row => row.closest('[data-row-key]')?.getAttribute('data-row-key');
  const mainButton = row => [...row.querySelectorAll('[data-row-main-button]')].find(node => node.closest('[data-row]') === row);
  const harness = {
    globalName: '__claudeSessionStatus',
    startupRows: () => [...document.querySelectorAll('.dframe-sidebar .df-session-list [data-row]')].filter(row => identity(row)?.startsWith('code:')),
    attributeFilter: ['data-row-key', 'data-selected', 'aria-current', 'class', 'hidden', 'aria-expanded', 'style', 'data-theme'],
    send: payload => window.__agentThingsClaudeSend(payload),
    isRowSelected: row => mainButton(row)?.getAttribute('aria-current') === 'page' || ['true', 'open', 'focused'].includes(row.getAttribute('data-selected')),
    unmount(entry) {
      const previous = padding.get(entry.row);
      if (previous) { previous.button.style.paddingInlineStart = previous.padding; entry.row.style.position = previous.position; padding.delete(entry.row); }
    },
    async locate({ entry, source, analysisMessage, request }) {
      const row = [...document.querySelectorAll('.dframe-sidebar [data-row]')].find(node => identity(node) === `code:${entry.threadId}`);
      if (!row) { analysisMessage.textContent = '请先在侧栏展开对应会话'; return; }
      const scope = document.querySelector(`[data-session-id="${CSS.escape(entry.threadId)}"]`)?.closest('.epitaxy-chat-panel');
      const target = source.itemId && scope?.querySelector(['data-epitaxy-entry', 'data-entry-key', 'data-turn-key']
        .map(attribute => `[${attribute}="${CSS.escape(source.itemId)}"]`).join(','));
      if (target) { target.scrollIntoView({ block: 'center', behavior: 'instant' }); analysisMessage.textContent = '已定位来源'; return; }
      analysisMessage.textContent = '正在定位来源消息…';
      const result = await request('locate-source', 22000, { source });
      if (result?.located) analysisMessage.textContent = '已定位来源';
      else analysisMessage.textContent = result?.message || '暂时无法定位来源消息';
    },
    async openPane({ entry, request }) {
      // 先切到该会话，再请求本地后台转达给该会话的 mod，由 mod 打开常驻侧栏面板。
      const row = [...document.querySelectorAll('.dframe-sidebar [data-row]')].find(node => identity(node) === `code:${entry.threadId}`);
      const main = row && mainButton(row);
      if (main && !harness.isRowSelected(row)) main.click();
      const result = await request('open-pane', 9000);
      if (!result?.delivered) throw new Error('该会话的 Agent Things 插件未在运行。请在该会话输入 /reload-plugins 或先发送一条消息，再点一次。');
    },
    reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelEntry }) {
      for (const [row, entry] of [...mounted]) {
        if (!row.isConnected || !entry.host.isConnected || identity(row) !== `code:${entry.threadId}`) unmount(entry);
      }
      for (const row of document.querySelectorAll('.dframe-sidebar .df-session-list [data-row]')) {
        const key = identity(row);
        const main = mainButton(row);
        if (!key?.startsWith('code:') || row.tagName !== 'DIV' || !main) continue;
        const threadId = key.slice(5);
        if (!threadId || threadId.length > 256) continue;
        const title = (row.querySelector('[data-row-label]')?.textContent || main.textContent || '会话').trim();
        let entry = mounted.get(row);
        if (entry) { if (entry.title !== title) { entry.title = title; paint(entry); } paintVisibility(entry); continue; }
        padding.set(row, { button: main, padding: main.style.paddingInlineStart, position: row.style.position });
        const inset = parseFloat(getComputedStyle(main).paddingInlineStart) || 0;
        main.style.paddingInlineStart = `${inset + 28}px`;
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
        const slot = document.createElement('span');
        slot.className = 'status-slot-injected';
        slot.style.cssText = `position:absolute;inset-inline-start:calc(${inset}px + var(--df-row-indent, 0px) * 0.3);top:50%;transform:translateY(-50%);width:24px;height:24px;display:flex;z-index:4;`;
        row.append(slot);
        const { host, button, original } = attachHost(slot, false, null);
        const onEnter = () => { entry.hovered = true; paintVisibility(entry); };
        const onLeave = () => { entry.hovered = false; paintVisibility(entry); };
        row.addEventListener('pointerenter', onEnter); row.addEventListener('pointerleave', onLeave);
        button.addEventListener('pointerdown', event => event.stopPropagation());
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          if (isPanelEntry(entry)) closePanel(); else { closePanel(); openPanel(entry); }
        });
        entry = { row, key: JSON.stringify(['local', threadId]), threadId, rawHost: 'local', title, slot, host, button, original, hovered: false, ringKey: null, onEnter, onLeave };
        mounted.set(row, entry); paint(entry);
      }
    },
    dispose() { delete window.__sessionStatusHarness; },
  };
  window.__sessionStatusHarness = harness;
})();








