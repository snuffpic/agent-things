// Agent Things Codex Bundle (Auto-generated)
// Things 3 task manager and session progress overlay for Codex

'use strict';
// Local conversation surface; its lifetime is owned by the Codex adapter.
function createCodexLocalCards({ mount, send, snapshot, restored }) {
  const states = new Map(restored || []);
  let active = null, stopped = false, reconciling = false;
  const visible = node => node?.isConnected && node.getClientRects().length > 0;
  function theme(row) {
    for (let node = row; node; node = node.parentElement) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (rgba && (rgba[3] ?? 1) >= .95) return rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722 < 150 ? 'dark' : 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function current() {
    const composers = [...document.querySelectorAll('[data-codex-composer-root]')].filter(visible);
    const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-selected="true"]')];
    const contents = [...document.querySelectorAll('[data-thread-find-target="conversation"]')].filter(visible);
    if (composers.length !== 1 || rows.length !== 1 || contents.length !== 1) return null;
    const row = rows[0], kind = row.getAttribute('data-app-action-sidebar-thread-kind');
    if (!['local', 'remote'].includes(kind)) return null;
    const id = row.getAttribute('data-app-action-sidebar-thread-id');
    if (!id) return null;
    return { composer: composers[0], content: contents[0], theme: theme(row), key: JSON.stringify([row.getAttribute('data-app-action-sidebar-thread-host-id') || (kind === 'remote' ? 'cloud' : 'local'), id]),
      title: row.getAttribute('data-app-action-sidebar-thread-title') || '会话进度' };
  }
  function retain() {
    if (!active) return;
    states.set(active.key, { title: active.title, saved: active.api.exportForReload({ allowPending: true }) });
    active.api.destroy(); active.container.remove(); active = null;
  }
  function open(entry) {
    if (active?.key === entry.key && active.container.isConnected) return active;
    retain();
    const container = document.createElement('section');
    container.setAttribute('data-agent-things-local-card', entry.key);
    container.setAttribute('aria-label', '会话进度');
    container.style.cssText = 'width:340px;max-width:100%;margin:12px 0;flex:none';
    entry.content.append(container);
    try {
      const api = mount({ container, key: entry.key, title: entry.title, snapshot: snapshot(), send,
        independent: true, theme: entry.theme }, states.get(entry.key)?.saved);
      active = { ...entry, container, api };
      states.set(entry.key, { title: entry.title, saved: null });
      return active;
    } catch (error) { container.remove(); throw error; }
  }
  function reconcile() {
    if (stopped || reconciling) return;
    reconciling = true;
    try {
      const entry = current();
      if (!entry) { retain(); return; }
      if (active && (active.key !== entry.key || !active.container.isConnected || active.composer !== entry.composer || active.content !== entry.content)) retain();
      if (!active && states.has(entry.key)) open(entry);
      active?.api.setTheme(entry.theme);
    } finally { reconciling = false; }
  }
  function consume(event) {
    const keyboard = event.type === 'keydown';
    if (keyboard && (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing)) return;
    if (!keyboard && !/^(发送|Send)(提示|消息| prompt| message)?$/i.test(event.target.closest?.('button')?.getAttribute('aria-label') || '')) return;
    const entry = current();
    if (!entry || !entry.composer.contains(event.target)) return;
    const editor = entry.composer.querySelector('[contenteditable="true"]');
    if (!editor || editor.textContent.trim() !== '/things') return;
    // Rich mentions/attachments remain host submissions.
    if (editor.querySelector('[contenteditable="false"]')) return;
    try { open(entry); } catch { return; }
    event.preventDefault(); event.stopImmediatePropagation();
    editor.focus();
    const selection = document.getSelection(), range = document.createRange();
    range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
    document.execCommand('delete');
    active?.container.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  document.addEventListener('keydown', consume, true);
  document.addEventListener('click', consume, true);
  const observer = new MutationObserver(reconcile);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-id', 'hidden', 'class', 'data-theme', 'data-color-mode'] });
  reconcile();
  return {
    receive(value) { active?.api.receive(value); },
    reply(value) { active?.api.reply(value); },
    exportState() {
      if (active) states.set(active.key, { title: active.title, saved: active.api.exportForReload({ allowPending: true }) });
      return [...states];
    },
    destroy() { stopped = true; observer.disconnect(); document.removeEventListener('keydown', consume, true); document.removeEventListener('click', consume, true); retain(); },
  };
}

(() => { const module = { exports: {} }; 'use strict';

// Pure presentation rules. Browser and Mods adapters are built from this same factory.
function createPresentation() {
  const labels = { unstarted: '尚未开始', unfinished: '有遗留事项', completed: '全部完成', pushed: '全部完成并已推送' };
  const colors = { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' };
  const taskLabels = { todo: '待开始', in_progress: '进行中', blocked: '受阻', needs_verification: '待验收', done: '已完成' };
  const layout = { contentWidth: 300, panelWidth: 340, progressNodes: [0, 25, 50, 75, 100] };
  const accent = { normal: '#0169CC', hover: '#005bb3', pressed: '#004f9c' };
  function progressValue(value, dragging = false) {
    value = Math.max(0, Math.min(100, Math.round(value)));
    const nearest = Math.round(value / 25) * 25;
    return dragging && Math.abs(value - nearest) <= 2 ? nearest : value;
  }
  function progressState(state, value) {
    return value === 100 ? state === 'pushed' ? 'pushed' : 'completed'
      : value === 0 && state === 'unstarted' ? 'unstarted' : 'unfinished';
  }
  function draftTransition(current, event) {
    if (event.type === 'begin') return { draft: { state: event.record?.state || 'unfinished', progress: event.record?.progress ?? null, note: event.record?.note || '' }, baseRevision: event.revision ?? event.record?.revision ?? 0, conflict: false };
    if (event.type === 'patch') return { ...current, draft: { ...current.draft, ...event.patch } };
    if (event.type === 'conflict') return { ...current, conflict: true };
    if (event.type === 'rebase') return { ...current, baseRevision: event.revision, conflict: false };
    if (event.type === 'saved' || event.type === 'cleared') return { draft: null, baseRevision: event.revision, conflict: false };
    return current;
  }
  function analysisDisabled(busy, analyzing, upgradeStage) {
    return Boolean(busy || analyzing || ['waiting', 'installing'].includes(upgradeStage));
  }
  return { labels, colors, taskLabels, layout, accent, progressValue, progressState, draftTransition, analysisDisabled };
}

const browserSource = `globalThis.__agentThingsPresentation = (${createPresentation.toString()})();`;
module.exports = { createPresentation, browserSource };

globalThis.__agentThingsPresentation = module.exports.createPresentation(); })();
'use strict';
(function () {
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
        const title = row.getAttribute('data-app-action-sidebar-thread-title') || titleNode?.textContent?.trim() || '会话';
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
        analysisMessage.textContent = '此记录没有可定位的消息';
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
      if (!isCurrent) { analysisMessage.textContent = '未能打开来源会话，请重试'; return; }

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
          analysisMessage.textContent = '正在定位消息…';
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

        analysisMessage.textContent = '已定位来源';
      } else {
        analysisMessage.textContent = '未找到原始消息，可能已被清理';
      }
    }
  };

  window.__sessionStatusHarness = codexHarness;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { codexHarness };
  }
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
  const labels = presentation?.labels || {
    unstarted: '尚未开始', unfinished: '有遗留事项', completed: '全部完成', pushed: '全部完成并已推送'
  };
  const colors = presentation?.colors || { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' };
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
    if (!record) return '未整理';
    return `${labels[record.state]}${record.progress === null ? ' · 进度未记录' : ` · ${record.progress}%`}`;
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
      for (const [name, value] of Object.entries({ cx: 12, cy: 12, r: 10, fill: 'none', stroke: '#0169cc', 'stroke-width': 1.6, 'stroke-dasharray': '42 63', 'stroke-linecap': 'round' })) circle.setAttribute(name, value);
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
    const description = `${entry.title}：${loading ? '正在更新进度' : summary(entry.key)}，点击记录任务进展`;
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
    element('style', `:host{opacity:0}:host([data-visible]),:host(:focus-within){opacity:1}@keyframes status-spin{to{transform:rotate(360deg)}}svg.loading{animation:status-spin .85s linear infinite;transform-origin:center}button{all:unset;box-sizing:border-box;width:28px;height:28px;display:grid;place-items:center;cursor:pointer;border-radius:7px}button:hover{background:color-mix(in srgb,currentColor 8%,transparent)}button:focus-visible{outline:2px solid #0169cc;outline-offset:1px}svg{display:block;pointer-events:none}`, shadow);
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
      const title = row.getAttribute('data-app-action-sidebar-thread-title') || titleNode?.textContent || '会话';
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

  function positionPanel() {
    if (!panel) return;
    if (embedded) {
      panel.root.setAttribute('data-color-mode', embedded.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
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
    target.git.textContent = target.projectGit?.status === 'unknown' ? '暂时无法检测 Git 信息' : '';
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
    target.heading.setAttribute('aria-label', `${target.entry.title}，${summary(target.entry.key)}`);
    target.statusLabel.textContent = record ? labels[record.state] : '尚未记录进展';
    target.statusDot.style.borderColor = record ? colors[record.state] : colors.unstarted;
    target.timestamp.textContent = record ? new Date(record.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    target.scoreNumber.textContent = record?.progress ?? '—';
    target.scoreUnit.hidden = record?.progress == null;
    target.meter.style.setProperty('--fill', `${record?.progress ?? 0}%`);
    target.meter.style.setProperty('--mark', record ? colors[record.state] : colors.unstarted);
    target.sourceLabel.textContent = record ? record.source === 'analysis' ? '自动分析' : '手动调整' : '';
    const summaryText = record?.note || '';
    if (target.overviewSummary.textContent !== summaryText) {
      target.overviewSummary.textContent = summaryText;
      target.setSummaryExpanded(false);
    }
    target.summaryBlock.hidden = !summaryText;
    target.noteOpen.textContent = record?.note ? '编辑' : '添加';
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
      target.error.textContent = '请输入 0–100 的整数，或留空'; return false;
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
      if ((error.code === 'REVISION_CONFLICT' || (!error.code && error.message === '此会话已在其他窗口更新，请重新确认')) && target.dirty && !reset) {
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
      target.error.textContent = '已读取最新版本，草稿已保留。再次保存即可提交。';
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
        request.reject(Object.assign(new Error('请求已取消'), { code: 'REQUEST_CANCELLED' }));
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
    const root = element('div', null, embedded?.container || document.body);
    root.setAttribute('data-codex-session-status-panel', '');
    if (!embedded) root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
    const shadow = root.attachShadow({ mode: 'open' });
    element('style', `
      :host{--accent:${presentation?.accent.normal || '#0169cc'};--accent-hover:${presentation?.accent.hover || '#005bb3'};--ink:#e6edf3;--secondary:#a0a6ad;--muted:#828c96;--note:#bbc3ca;--track:#ffffff12;--line:#ffffff14;--input-border:#ffffff18;--input-bg:#ffffff03;--hover:#ffffff09;--selected:#ffffff10;--source-bg:#ffffff0a;--number-line:#ffffff25;--thumb:#e6edf3;--thumb-edge:#ffffff30;--danger:#ef7777;--error:#f7ad86;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);color-scheme:dark}
      *{box-sizing:border-box;scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{display:none;width:0;height:0}button,input,textarea{font:inherit}button{cursor:pointer}button,input,textarea{color:inherit}[hidden]{display:none!important}
      .shell{position:fixed;pointer-events:auto;width:${presentation?.layout.panelWidth || 340}px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);display:flex;flex-direction:column;overflow:hidden;--panel-bg:#0e1318;background:var(--panel-bg);border:1px solid #ffffff1c;border-radius:20px;box-shadow:0 16px 54px #0005;padding:22px 20px 14px}
      .shell:hover{--panel-bg:#1f242a}.title-heading{display:flex;flex:none;align-items:flex-start;gap:10px;margin-right:24px;border-radius:5px;outline-offset:4px}
      h2.title{font-size:24px;font-weight:650;line-height:1.3;letter-spacing:-.5px;margin:0;min-width:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
      .title-progress{display:flex;flex:none;width:32px;height:32px;margin-top:1px}.title-progress svg{width:32px;height:32px}.title-progress text{opacity:0}.title-progress text.progress-unknown{opacity:1}.title-heading:hover .progress-pie,.title-heading:focus-visible .progress-pie{opacity:0}.title-heading:hover text,.title-heading:focus-visible text{opacity:1}
      .close{position:absolute;right:12px;top:7px;border:0;background:none;color:var(--secondary);font-size:0;width:28px;height:28px;padding:0}.close::before,.close::after{content:"";position:absolute;left:7px;top:13px;width:14px;height:1px;background:currentColor;transform:rotate(45deg)}.close::after{transform:rotate(-45deg)}
      .open-pane{position:absolute;right:44px;top:7px;border:0;background:none;color:var(--secondary);width:28px;height:28px;padding:0;border-radius:6px}.open-pane:hover{color:var(--ink);background:var(--hover)}.open-pane::before{content:"";position:absolute;left:7px;top:8px;width:14px;height:12px;border:1.3px solid currentColor;border-radius:3px;box-sizing:border-box}.open-pane::after{content:"";position:absolute;left:16px;top:8px;width:1.3px;height:12px;background:currentColor}.shell.has-open-pane .title-heading{margin-right:56px}.open-pane-tip{position:absolute;right:0;top:calc(100% + 6px);padding:5px 8px;border-radius:6px;background:var(--panel-bg);color:var(--ink);border:1px solid var(--line);box-shadow:0 4px 14px #0003;font-size:11px;line-height:1.4;white-space:nowrap;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .08s,visibility 0s;z-index:2}.open-pane:is(:hover,:focus-visible) .open-pane-tip{opacity:1;visibility:visible;transition-delay:.15s}
      .panel-body{overflow:auto;min-height:0;margin-top:23px;scrollbar-width:none;-ms-overflow-style:none}.panel-body::-webkit-scrollbar{display:none;width:0;height:0}.view{padding-bottom:4px}.status-line{display:flex;align-items:center;justify-content:space-between;gap:16px}.status-block{transform:translateY(2px);min-width:0;flex:1}.status-name{display:flex;align-items:center;gap:7px;line-height:18px;min-width:0}.status-name>span:last-child,.timestamp{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state-dot{width:10px;height:10px;border:1.5px solid;border-radius:50%;flex:none}.timestamp{font-size:11px;line-height:16px;color:var(--secondary);margin-top:2px;margin-left:17px}.score{display:flex;align-items:baseline;line-height:1;font-variant-numeric:tabular-nums;flex:none}.score-number{font-size:39px;font-weight:550;letter-spacing:-1px}.score-unit{font-size:15px;color:var(--secondary);margin-left:3px}
      .meter{height:4px;background:var(--track);border-radius:3px;margin:14px 0 10px;overflow:hidden}.meter::after{content:"";display:block;height:100%;width:var(--fill);background:var(--mark);border-radius:inherit}.totals-row{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--secondary)}.totals,.source-label{font-size:11px;font-weight:400;line-height:16px}.source-label{margin-left:auto;text-align:right;white-space:nowrap}.summary-block{position:relative;margin:16px 0;outline:none}.overview-summary{font-size:13px;line-height:1.65;color:var(--note);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}.summary-expand{position:absolute;right:0;bottom:0;border:0;background:linear-gradient(to right,transparent,var(--panel-bg) 18px);padding:0 0 0 22px;color:var(--secondary);font-size:12px;line-height:21.45px;white-space:nowrap}.summary-expand:hover{color:inherit}.summary-block.expanded .overview-summary{display:block;-webkit-line-clamp:unset}.summary-block.expanded .summary-expand{position:static;display:block;margin-left:auto;padding-left:0;background:none}
      .actions{display:flex;align-items:center;gap:17px;margin:18px 0 22px}.primary{border:0;background:var(--accent);color:#fff;border-radius:9px;padding:9px 14px;font-weight:550;min-height:36px}.primary:hover{background:var(--accent-hover);color:#fff}.text-button,.clear,.back{border:0;background:none;padding:0;color:var(--secondary);font-size:12px}.text-button:hover,.back:hover{color:inherit}.actions .clear{margin-left:auto;font-size:11px;color:var(--muted);white-space:nowrap;transition:color .12s}.actions .clear:hover{color:var(--danger)}.actions .clear{position:relative}.clear-tooltip{position:absolute;right:0;bottom:calc(100% + 8px);padding:6px 9px;border-radius:6px;background:var(--panel-bg);color:var(--secondary);border:1px solid var(--line);font-size:11px;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .08s,visibility 0s}.clear:is(:hover,:focus-visible) .clear-tooltip{opacity:1;visibility:visible;transition-delay:.1s}.section-head{border-top:1px solid var(--line);padding-top:16px;display:flex;align-items:center;justify-content:space-between;margin-bottom:5px}.section-head h3{font-size:12px;font-weight:550;margin:0}.remaining-toggle{border:0;background:none;padding:0}.row-detail{font-size:12px;font-weight:400;line-height:18px;color:var(--secondary);white-space:nowrap}
      .task-row{position:relative;display:flex;gap:9px;align-items:flex-start;padding:9px 0;overflow:hidden;isolation:isolate}.task-dot{width:12px;height:12px;border:1.3px solid #c89b38;border-radius:50%;margin-top:4px;flex:none}.task-row[data-status=done] .task-dot{border-color:#548eea;background:#548eea22}.task-content{min-width:0;flex:1}.task-title{width:100%;overflow:hidden;mask-image:linear-gradient(to right,#000 calc(100% - 12px),transparent)}.task-track{display:flex;width:max-content;transform:translateX(0);transition:transform .22s ease-out}.task-copy{white-space:nowrap;flex:none}.task-row:is(:hover,:focus-within) .task-title.overflowing .task-track{transform:translateX(calc(-1 * var(--travel)));transition-duration:var(--duration,4s);transition-timing-function:linear;will-change:transform}.task-meta{font-size:10px;color:var(--secondary);margin-top:3px}.task-source{position:absolute;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:flex-end;padding-left:28px;background:linear-gradient(to right,transparent,var(--panel-bg) 25px);opacity:0;pointer-events:none;transform:translateX(4px);transition:opacity .13s,transform .13s}.task-source button{border:0;border-radius:6px;background:var(--source-bg);color:inherit;padding:5px 7px;font-size:11px;white-space:nowrap}.task-row:hover .task-source,.task-row:focus-within .task-source{opacity:1;pointer-events:auto;transform:none}.task-row:focus-visible{outline:1px solid var(--accent);outline-offset:1px}
      @media(prefers-reduced-motion:reduce){.task-row .task-title.overflowing .task-track{transform:none;transition:none}.task-title{overflow:auto}}
      @media(hover:none){.task-source{opacity:1;pointer-events:auto;transform:none}}
      .empty{font-size:12px;color:var(--secondary);padding:13px 0}.quiet-row{border:0;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;width:100%;background:none;color:inherit;padding:15px 0;text-align:left;font-size:12px}.quiet-row span:last-child{color:var(--secondary)}.overview-bottom{margin-top:13px}.view-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}.view-heading h3{font-size:14px;font-weight:550;margin:0}.choice{display:flex;align-items:center;gap:10px;width:100%;padding:8px 9px;border:0;border-radius:7px;background:none;color:inherit;text-align:left}.choice:hover{background:var(--hover)}.choice[aria-pressed=true]{background:var(--selected)}.dot{width:12px;height:12px;border:1.6px solid var(--mark);border-radius:50%;flex:none}.choice[aria-pressed=true] .dot{background:var(--mark);box-shadow:inset 0 0 0 2px var(--panel-bg)}
      .progress-section{margin-top:20px}.progress-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.label{font-size:11px;color:var(--secondary)}.number-wrap{display:flex;align-items:center;gap:5px;color:var(--secondary)}.progress-number{appearance:textfield;color:var(--ink);width:65px;padding:2px 3px 4px;background:none;border:0;border-bottom:1px solid var(--number-line);font-size:27px;font-weight:550;text-align:right;font-variant-numeric:tabular-nums}.progress-number::-webkit-inner-spin-button{appearance:none}.range{position:relative;height:51px;margin-top:2px;--mark:#c89b38}.range-track{position:absolute;left:7px;right:7px;top:10px;height:4px;border-radius:3px;background:linear-gradient(to right,var(--range-fill,var(--mark)) var(--fill),var(--track) var(--fill));pointer-events:none}.range-input{position:relative;appearance:none;width:100%;height:24px;background:transparent;margin:0;display:block;padding:0;cursor:pointer}.range-input::-webkit-slider-runnable-track{height:4px;background:transparent}.range-input::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-5px;background:var(--thumb);border:2px solid var(--panel-bg);border-radius:50%;box-shadow:0 0 0 1px var(--thumb-edge)}.range-nodes{position:absolute;left:7px;right:7px;top:0;pointer-events:none}.range-node{position:absolute;left:var(--at);top:8px;width:0;font-size:10px;color:var(--secondary);font-variant-numeric:tabular-nums}.range-node::before{content:"";display:block;width:7px;height:7px;transform:translateX(-50%);border-radius:50%;background:var(--panel-bg);border:1px solid var(--secondary);box-shadow:0 0 0 1px var(--panel-bg)}.range-node-label{position:absolute;top:19px;left:0;transform:translateX(-50%)}.range-node:first-child .range-node-label{transform:none}.range-node:last-child .range-node-label{transform:translateX(-100%)}.unknown-row{display:flex;justify-content:flex-end;margin:2px 0 18px}.unknown{font-size:11px}
      .note-label{display:block;font-size:11px;color:var(--secondary);margin-bottom:8px}textarea{display:block;width:100%;resize:vertical;min-height:66px;max-height:140px;background:var(--input-bg);color:inherit;border:1px solid var(--input-border);border-radius:8px;padding:9px;line-height:1.6;font-size:12px;scrollbar-width:none;-ms-overflow-style:none}textarea::-webkit-scrollbar{display:none;width:0;height:0}textarea::placeholder{color:var(--muted)}.edit-actions{display:flex;justify-content:flex-end;gap:18px;align-items:center;padding:21px 0 16px}.git{font-size:11px;color:var(--secondary)}.analysis-message{font-size:11px;color:var(--secondary);margin:0 0 13px}.analysis-message:empty,.error:empty,.git:empty{display:none}.error{flex:none;font-size:12px;color:var(--error);padding-top:10px;white-space:pre-wrap}button:disabled,input:disabled,textarea:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
      .shell textarea:focus-visible{outline:none}
      .app-update{margin-top:3px;padding:10px 11px;background:var(--hover);border:1px solid var(--line);border-radius:10px}.app-update-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.app-update-label{font-size:12px;line-height:18px;color:var(--ink);min-width:0;overflow-wrap:anywhere}.app-update-button{flex:none;padding:5px 10px;min-height:28px;border-radius:7px;font-size:11px}.app-update-detail{margin-top:7px;font-size:11px;line-height:1.6;color:var(--secondary);white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.app-update[data-failed=true] .app-update-detail{color:var(--error)}
      :host([data-color-mode=light]){--ink:#22272e;--secondary:#576374;--muted:#667383;--note:#46515f;--track:#c3ccd6;--line:#dfe4ea;--input-border:#c7d0da;--input-bg:#f7f9fb;--hover:#f0f3f6;--selected:#e9edf2;--source-bg:#e9eef4;--number-line:#b6c1ce;--thumb:var(--accent);--thumb-edge:var(--accent);--danger:#bf2f3a;--error:#b13a2d;color:var(--ink);color-scheme:light}
      :host([data-color-mode=light]) .shell{--panel-bg:#fff;border-color:#dfe4ea;box-shadow:0 14px 45px #26344520}
      :host([data-color-mode=light]) .shell:hover{--panel-bg:#f5f6f7}
      :host([data-color-mode=light]) .range{--range-fill:color-mix(in srgb,var(--mark) 85%,#000)}
      :host([data-color-mode=light]) .meter::after{background:color-mix(in srgb,var(--mark) 85%,#000)}
    `, shadow);
    if (embedded) element('style', '.shell{position:relative;max-width:100%;max-height:none}.shell,:host([data-color-mode=light]) .shell{box-shadow:none}.panel-body{overflow:visible}', shadow);
    const shell = element('div', null, shadow, 'shell');
    shell.setAttribute('role', embedded ? 'region' : 'dialog'); shell.setAttribute('aria-label', `${entry.title} · 任务进展`);
    const close = embedded ? null : element('button', '×', shell, 'close'); close?.setAttribute('aria-label', '关闭');
    // 宿主支持时，在关闭按钮左侧提供「在侧栏打开」：把卡片交给宿主的常驻侧栏面板。
    const openPane = harness?.openPane ? element('button', null, shell, 'open-pane') : null;
    if (openPane) {
      shell.classList.add('has-open-pane'); openPane.setAttribute('aria-label', '在侧栏打开');
      element('span', '在侧栏打开', openPane, 'open-pane-tip').setAttribute('role', 'tooltip');
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
    const totals = element('span', '暂无任务统计', totalsRow, 'totals');
    const sourceLabel = element('span', null, totalsRow, 'source-label');
    const summaryBlock = element('div', null, overview, 'summary-block'); summaryBlock.tabIndex = 0;
    const overviewSummary = element('div', null, summaryBlock, 'overview-summary');
    const summaryExpand = element('button', '查看全部', summaryBlock, 'summary-expand');
    summaryExpand.hidden = true; summaryExpand.setAttribute('aria-expanded', 'false');
    const actions = element('div', null, overview, 'actions');
    const analyze = element('button', '更新进度', actions, 'primary analyze');
    const editOpen = element('button', '手动调整', actions, 'text-button edit-open');
    const clear = element('button', '清除进度', actions, 'clear');
    clear.setAttribute('aria-label', '清除进度');
    const clearTip = element('span', '立即清除进度与任务记录', clear, 'clear-tooltip');
    clearTip.setAttribute('role', 'tooltip');
    const sectionHead = element('div', null, overview, 'section-head');
    const tasksHeading = element('h3', '剩余任务', sectionHead);
    const remainingToggle = element('button', null, sectionHead, 'remaining-toggle row-detail');
    remainingToggle.hidden = true; remainingToggle.setAttribute('aria-expanded', 'false');
    const currentTasks = element('div', null, overview, 'current-tasks');
    const bottom = element('div', null, overview, 'overview-bottom');
    const historyOpen = element('button', null, bottom, 'quiet-row history-open'); element('span', '已完成任务', historyOpen);
    const historyCount = element('span', '0 条 ›', historyOpen, 'row-detail');
    const noteRow = element('button', null, bottom, 'quiet-row note-open'); element('span', '备注', noteRow);
    const noteOpen = element('span', '添加', noteRow);
    const timelineOpen = embedded ? element('button', '进展记录 ›', bottom, 'quiet-row timeline-open') : null;
    const appUpdate = element('div', null, bottom, 'app-update'); appUpdate.hidden = true;
    const appUpdateRow = element('div', null, appUpdate, 'app-update-row');
    const appUpdateLabel = element('span', null, appUpdateRow, 'app-update-label'); appUpdateLabel.setAttribute('role', 'status');
    const appUpdateButton = element('button', '立即升级', appUpdateRow, 'primary app-update-button');
    const appUpdateDetail = element('div', null, appUpdate, 'app-update-detail'); appUpdateDetail.hidden = true;
    const edit = element('div', null, body, 'view edit-view'); edit.hidden = true;
    const editHeading = element('div', null, edit, 'view-heading'); element('h3', '手动记录会话状态', editHeading);
    const choices = new Map(), controls = [];
    for (const [state, label] of Object.entries(labels)) {
      const button = element('button', null, edit, 'choice'); button.style.setProperty('--mark', colors[state]);
      element('span', null, button, 'dot'); element('span', label, button); button.setAttribute('aria-pressed', 'false');
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
    const progressHead = element('div', null, progressSection, 'progress-head'); element('label', '进度', progressHead, 'label');
    const numberWrap = element('div', null, progressHead, 'number-wrap');
    const progress = element('input', null, numberWrap, 'progress-number'); progress.type = 'number'; progress.min = '0'; progress.max = '100'; progress.step = '1'; progress.placeholder = '—'; progress.setAttribute('aria-label', '手动进度'); element('span', '%', numberWrap);
    const range = element('div', null, progressSection, 'range'); element('div', null, range, 'range-track');
    const nodes = element('div', null, range, 'range-nodes'); nodes.setAttribute('aria-hidden', 'true');
    for (const value of [0, 25, 50, 75, 100]) { const node = element('span', null, nodes, 'range-node'); node.style.setProperty('--at', `${value}%`); element('span', String(value), node, 'range-node-label'); }
    const slider = element('input', null, range, 'range-input'); slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.setAttribute('aria-label', '拖动调整进度');
    const unknownRow = element('div', null, progressSection, 'unknown-row'); const unknown = element('button', '清空进度', unknownRow, 'text-button unknown');
    const noteLabel = element('label', '备注', edit, 'note-label');
    const note = element('textarea', null, edit); note.maxLength = 4000; note.placeholder = '记下下一步要做的事…'; note.setAttribute('aria-label', '事项备注');
    noteLabel.htmlFor = note.id = `session-status-note-${serial}`;
    const git = element('div', null, edit, 'git');
    const editActions = element('div', null, edit, 'edit-actions');
    const cancel = element('button', '取消', editActions, 'text-button cancel');
    const submit = element('button', '保存记录', editActions, 'primary save-record');
    const history = element('div', null, body, 'view history-view'); history.hidden = true;
    const historyHeading = element('div', null, history, 'view-heading'); element('h3', '已完成任务', historyHeading);
    const back = element('button', '‹ 返回', historyHeading, 'back');
    const historyList = element('div', null, history, 'history-list');
    const timelineView = embedded ? element('div', null, body, 'view history-view') : null;
    let timelineList;
    if (timelineView) {
      timelineView.hidden = true;
      const title = element('div', null, timelineView, 'view-heading'); element('h3', '进展记录', title);
      element('button', '‹ 返回', title, 'back').onclick = () => target.setView('overview');
      timelineList = element('div', null, timelineView, 'history-list');
    }
    const analysisMessage = element('div', null, body, 'analysis-message'); analysisMessage.setAttribute('role', 'status');
    const error = element('div', null, shell, 'error'); error.setAttribute('role', 'status');
    const resolveConflict = element('button', '读取最新版本并保留草稿', shell, 'text-button'); resolveConflict.hidden = true;
    controls.push(note, progress, slider, unknown, cancel, submit, clear, analyze, editOpen, resolveConflict);
    panel = { entry, root, shell, body, heading, titleProgress, choices, note, progress, slider, range, git, error, resolveConflict, controls,
      statusLabel, statusDot, timestamp, scoreNumber, scoreUnit, meter, sourceLabel, overviewSummary, summaryBlock, noteOpen,
      totals, analyze, historyList, dirty: false, busy: false, analyzing: false, revision: 0, mode: 'overview' };
    const target = panel;
    target.capabilities = embedded?.session?.capabilities || null;
    panelEvent('open', entry);
    target.request = (type, timeout, extra = {}) => new Promise((resolve, reject) => {
      const requestId = `${requestPrefix}:${++serial}`;
      const timer = setTimeout(() => { cancelRead(requestId, { type }); pending.delete(requestId); const error = new Error('请求超时'); error.code = 'STATUS_REQUEST_TIMEOUT'; reject(error); }, timeout);
      pending.set(requestId, { resolve, reject, timer, type, key: entry.key });
      try { send(JSON.stringify({ type, requestId, key: entry.key, ...extra })); }
      catch { clearTimeout(timer); pending.delete(requestId); const error = new Error('状态连接暂不可用'); error.code = 'STATUS_SEND_FAILED'; reject(error); }
    });
    resolveConflict.onclick = () => rebaseDraft(target);
    const showAppUpdate = info => {
      target.updateInfo = info;
      const update = info?.update;
      const stage = update?.stage;
      const stages = { queued: '正在准备升级', checking: '正在检查版本', downloading: '正在下载新版本', waiting: '等待当前分析结束', installing: '正在升级' };
      const active = Boolean(stages[stage]) || target.upgradeStarting;
      const completed = stage === 'completed' && Date.now() - Date.parse(update.updatedAt) < 60000;
      const failed = stage === 'failed';
      appUpdate.hidden = !info?.available && !active && !failed && !completed;
      appUpdate.setAttribute('data-failed', String(failed));
      appUpdateLabel.textContent = active ? stages[stage] || '正在准备升级' : failed ? '升级失败' : completed
        ? `已升级至 v${update.currentVersion}` : `发现新版本 v${info?.latestVersion}`;
      appUpdateButton.textContent = active ? '请稍候' : completed ? '已完成' : failed ? '重试' : '立即升级';
      appUpdateButton.disabled = active || completed;
      const command = info?.command || 'npx agent-things@latest';
      appUpdateDetail.textContent = target.updateConnectionError ? `正在重新连接后台，升级状态将在连接后恢复\n终端升级：${command}`
        : failed ? `${update.error}\n终端升级：${command}` : completed && update.reconnectMcp ? '请在客户端重新连接 MCP 服务' : '';
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
      summaryExpand.textContent = expanded ? '收起' : '查看全部';
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
      if (target.capabilities?.locate === false) { analysisMessage.textContent = '当前宿主未连接，暂时无法定位来源消息'; return; }
      if (embedded) {
        if (!source?.turnId || !source?.itemId) { analysisMessage.textContent = '此记录没有可定位的消息'; return; }
        analysisMessage.textContent = '正在定位消息…';
        try {
          const result = await target.request('locate-source', 14000, { source: { turnId: source.turnId, itemId: source.itemId } });
          analysisMessage.textContent = result?.message || '已定位来源';
        } catch (error) { analysisMessage.textContent = error.message; }
        return;
      }
      if (!source?.turnId || !source?.itemId) { analysisMessage.textContent = '此记录没有可定位的消息'; return; }
      const harness = window.__sessionStatusHarness;
      if (harness?.locate) {
        try { await harness.locate({ entry, source, analysisMessage, request: target.request }); }
        catch (error) { analysisMessage.textContent = error.message; }
        return;
      }
      const row = entry.row;
      if (row.getAttribute('data-app-action-sidebar-thread-selected') !== 'true') {
        const trigger = row.querySelector('[data-thread-title-trigger]');
        if (!trigger) { analysisMessage.textContent = '无法打开来源会话'; return; } trigger.click();
      }
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        if (row.getAttribute('data-app-action-sidebar-thread-selected') === 'true') {
          const message = [...document.querySelectorAll('[data-content-search-unit-key]')].find(node => node.getAttribute('data-content-search-unit-key') === `${source.turnId}:${source.itemId}`);
          if (message) { message.scrollIntoView({ block: 'center', behavior: 'smooth' }); const previous = message.style.outline; message.style.outline = '2px solid #0169cc'; setTimeout(() => { if (message.style.outline === '2px solid rgb(1, 105, 204)') message.style.outline = previous; }, 3000); analysisMessage.textContent = '已定位来源'; return; }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      try { await target.request('locate-source', 30000, { source }); analysisMessage.textContent = '已定位来源'; }
      catch (error) { analysisMessage.textContent = error.message; }
    };
    const taskLabels = presentation?.taskLabels || { todo: '待开始', in_progress: '进行中', blocked: '受阻', needs_verification: '待验收', done: '已完成' };
    const renderTask = (task, sources, parent) => {
      const row = element('div', null, parent, 'task-row'); row.dataset.status = task.status; row.tabIndex = 0;
      element('span', null, row, 'task-dot'); const content = element('div', null, row, 'task-content');
      const title = element('div', null, content, 'task-title'); title.title = task.title;
      const track = element('div', null, title, 'task-track');
      const text = task.summary || task.title;
      element('span', text, track, 'task-copy');
      element('div', taskLabels[task.status] || '状态未知', content, 'task-meta');
      const ref = task.evidenceRefs?.find(value => sources?.[value]?.turnId);
      if (ref) { const mask = element('div', null, row, 'task-source'); const link = element('button', '查看来源', mask); link.setAttribute('aria-label', `查看来源：${task.title}`); link.onclick = () => locate(sources[ref]); }
    };
    target.renderHistory = () => {
      const state = target.analysisState; if (!state) return;
      if (timelineList && target.timelineRevision !== state.revision) {
        target.timelineRevision = state.revision;
        timelineList.replaceChildren();
        for (const item of [...(state.timeline || [])].reverse()) {
          const date = new Date(item.requestedAt).toLocaleString('zh-CN');
          const progress = item.record?.progress ?? item.progress;
          const label = item.source === 'analysis' ? '自动分析' : '手动记录';
          const value = item.status === 'failed' ? '分析失败' : item.status === 'pending' ? '分析中' : progress == null ? '未记录' : `${progress}%`;
          element('div', `${date} · ${label} · ${value}`, timelineList, 'quiet-row');
        }
        if (!timelineList.childElementCount) element('div', '暂无进展记录', timelineList, 'empty');
      }
      const ledger = state.analysis?.ledger; const tasks = ledger?.tasks || [];
      const remaining = tasks.filter(task => ['todo', 'in_progress', 'blocked', 'needs_verification'].includes(task.status));
      const completed = tasks.filter(task => task.status === 'done');
      totals.textContent = tasks.length ? `已完成 ${completed.length} / ${tasks.length} 项任务` : '暂无任务统计';
      tasksHeading.textContent = `剩余任务 ${remaining.length}`;
      remainingToggle.hidden = remaining.length <= 3;
      remainingToggle.textContent = target.remainingExpanded ? '收起 ›' : `查看全部 ${remaining.length} 条 ›`;
      remainingToggle.setAttribute('aria-expanded', String(Boolean(target.remainingExpanded)));
      const tasksKey = JSON.stringify([remaining, state.analysis?.sources, Boolean(target.remainingExpanded)]);
      if (target.tasksKey !== tasksKey) {
        target.tasksKey = tasksKey; currentTasks.replaceChildren();
        if (!tasks.length) element('div', '点击更新进度，整理这次会话的任务', currentTasks, 'empty');
        else if (!remaining.length) element('div', '暂无未完成任务', currentTasks, 'empty');
        for (const task of target.remainingExpanded ? remaining : remaining.slice(0, 3)) renderTask(task, state.analysis?.sources, currentTasks);
      }
      historyCount.textContent = `${completed.length} 条 ›`;
      const completedKey = JSON.stringify([completed, state.analysis?.sources]);
      if (target.completedKey === completedKey) return;
      target.completedKey = completedKey; historyList.replaceChildren();
      for (const task of completed) renderTask(task, state.analysis?.sources, historyList);
      if (!completed.length) element('div', '暂无已完成任务', historyList, 'empty');
    };

    const pollHistory = () => {
      if (panel !== target) return;
      target.request('analysis-state', 7000).then(showHistory).catch(() => {
        if (panel !== target) return;
        analysisMessage.textContent = '状态查询暂时失败，正在重试…';
        clearTimeout(target.pollTimer); target.pollTimer = setTimeout(pollHistory, 2000);
      });
    };
    target.pollHistory = pollHistory;
    const showHistory = state => {
      if (panel !== target || !state || (target.historyRevision ?? -1) > state.revision) return;
      target.historyRevision = state.revision; target.analysisState = state;
      const active = (state.timeline || []).find(item => item.source === 'analysis' && item.status === 'pending');
      target.analyzing = Boolean(active); analyze.disabled = target.analyzing;
      const stages = { starting: '正在启动分析', reading: '正在读取会话', retrying: '正在重新连接', analyzing: '正在分析任务' };
      target.stageMessage = active ? `${stages[active.stage] || '正在分析'}…` : '';
      const latest = state.timeline?.at(-1);
      analysisMessage.textContent = target.stageMessage || (latest?.status === 'failed' ? `分析失败：${latest.error || '请重试'}` : ''); analyze.textContent = active ? '正在分析…' : '更新进度';
      clearTimeout(target.pollTimer); if (active && !embedded?.streamConnected) target.pollTimer = setTimeout(pollHistory, 2000);
      refreshPanel();
    };
    target.showHistory = showHistory;
    analyze.onclick = async () => {
      analyze.disabled = true; analysisMessage.textContent = '正在开始分析…';
      try { showHistory(await target.request('analyze', 7000)); }
      catch (error) {
        if (panel !== target) return;
        if (['STATUS_REQUEST_TIMEOUT', 'STATUS_SEND_FAILED'].includes(error.code)) {
          analysisMessage.textContent = '状态查询暂时失败，正在重试…'; clearTimeout(target.pollTimer); target.pollTimer = setTimeout(pollHistory, 2000);
        } else { analysisMessage.textContent = error.message; analyze.disabled = false; }
      }
    };
    const setProgress = value => {
      const state = presentation ? presentation.progressState(target.draft.state, value) : value === 100 ? target.draft.state === 'pushed' ? 'pushed' : 'completed'
        : value === 0 && target.draft.state === 'unstarted' ? 'unstarted' : 'unfinished';
      updateDraft(target, { progress: value, state });
    };
    let dragging = false;
    slider.onpointerdown = () => { dragging = true; };
    const endDrag = () => { dragging = false; }; slider.onpointerup = endDrag; slider.onpointercancel = endDrag; slider.onlostpointercapture = endDrag;
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
    if (!next || next.revision < snapshot.revision) return;
    snapshot = next;
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
  const filter = harness?.attributeFilter || ['data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-id', 'data-app-action-sidebar-thread-host-id', 'data-app-action-sidebar-thread-title', 'hidden', 'aria-expanded', 'style', 'class', 'data-theme'];
  if (!embedded) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: filter });
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
  }
  window.addEventListener('resize', positionPanel);
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
    setTheme(theme) { if (embedded && embedded.theme !== theme && ['light', 'dark'].includes(theme)) { embedded.theme = theme; positionPanel(); } },
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
      destroyed = true; localCards?.destroy(); harness?.dispose?.(); observer.disconnect(); cancelAnimationFrame(frame);
      if (panel) { rememberPanel(panel); panelEvent('dispose', panel.entry); clearTimeout(panel.pollTimer); clearTimeout(panel.updateTimer); cancelAnimationFrame(panel.marqueeFrame); panel.resizeObserver?.disconnect(); panel.root.remove(); panel.entry.button?.setAttribute('aria-expanded', 'false'); panel = null; }
      for (const entry of [...mounted.values()]) unmount(entry);
      document.removeEventListener('pointerdown', onOutside, true); document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', positionPanel);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('本地进程已断开')); }
      pending.clear(); if (!embedded?.independent) delete window.__codexSessionStatus;
      if (harness?.globalName && window[harness.globalName]) delete window[harness.globalName];
    }
  };
  if (!embedded?.independent) window.__codexSessionStatus = api;
  if (harness?.globalName) window[harness.globalName] = api;
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

