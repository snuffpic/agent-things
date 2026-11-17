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
    clearTimeout(target.updateTimer); clearTimeout(target.manualCheckTimer);
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
      .version-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 2px;font-size:11px;line-height:16px;color:var(--muted)}.version-bar-text{min-width:0;overflow-wrap:anywhere}.version-bar[data-failed=true] .version-bar-text{color:var(--error)}.version-check-button{flex:none;font-size:11px;color:var(--muted)}.version-check-button:hover:not(:disabled){color:inherit}
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
    const versionBar = element('div', null, overview, 'version-bar'); versionBar.hidden = true;
    const versionBarText = element('span', null, versionBar, 'version-bar-text'); versionBarText.setAttribute('role', 'status');
    const checkUpdateButton = element('button', S('checkUpdateBtn'), versionBar, 'text-button version-check-button');
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
      if (target.updateInfo || target.updateChecking || target.manualCheckStatus) showAppUpdate(target.updateInfo);
      else checkUpdateButton.textContent = S('checkUpdateBtn');
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
      const options = {
        starting: target.upgradeStarting,
        checking: target.updateChecking,
        connectionError: target.updateConnectionError,
        manualCheckStatus: target.manualCheckStatus,
        checkError: target.manualCheckError,
      };
      const banner = presentation?.updateBannerState
        ? presentation.updateBannerState(info, strings, options)
        : (() => {
            const update = info?.update;
            const stage = update?.stage;
            const stages = strings.updateStages || { queued: '正在准备升级', checking: '正在检查版本', downloading: '正在下载新版本', waiting: '等待当前分析结束', installing: '正在升级' };
            const active = Boolean(stages[stage]) || Boolean(options.starting);
            const completed = stage === 'completed' && Date.now() - Date.parse(update.updatedAt) < 60000;
            const failed = stage === 'failed';
            const visible = Boolean(info?.available || active || failed || completed);
            const command = info?.command || 'npx agent-things@latest';
            return {
              visible,
              active,
              completed,
              failed,
              buttonDisabled: active || completed,
              label: active ? stages[stage] || stages.queued : failed ? S('updateFailedLabel') : completed
                ? S('upgradedToPattern', { version: update?.currentVersion }) : S('updateAvailablePattern', { version: info?.latestVersion }),
              buttonText: active ? S('pleaseWait') : completed ? S('completedShort') : failed ? S('retryBtn') : S('upgradeBtn'),
              detail: options.connectionError ? `${S('reconnectHint')}\n${S('terminalUpgradePrefix')}${command}`
                : failed ? `${update?.error || ''}\n${S('terminalUpgradePrefix')}${command}` : completed && update?.reconnectMcp ? S('reconnectMcpHint') : '',
              versionText: options.manualCheckStatus === 'failed'
                ? `${S('checkUpdateFailedLabel')}${options.checkError ? `: ${options.checkError}` : ''}`
                : (options.manualCheckStatus === 'latest' && info?.currentVersion ? S('alreadyLatestPattern', { version: info.currentVersion }) : (info?.currentVersion ? `v${info.currentVersion}` : '')),
              showVersionBar: !visible,
              checkDisabled: Boolean(options.checking),
              checkFailed: !visible && options.manualCheckStatus === 'failed',
              checkButtonText: options.checking ? S('checkingUpdateShort') : S('checkUpdateBtn'),
            };
          })();
      appUpdate.hidden = !banner.visible;
      appUpdate.setAttribute('data-failed', String(banner.failed));
      appUpdateLabel.textContent = banner.label;
      appUpdateButton.textContent = banner.buttonText;
      appUpdateButton.disabled = banner.buttonDisabled;
      appUpdateDetail.textContent = banner.detail;
      appUpdateDetail.hidden = !appUpdateDetail.textContent;
      versionBar.hidden = !(banner.showVersionBar && (info || banner.checking || banner.checkFailed));
      versionBar.setAttribute('data-failed', String(banner.checkFailed));
      versionBarText.textContent = banner.versionText;
      checkUpdateButton.textContent = banner.checkButtonText;
      checkUpdateButton.disabled = banner.checkDisabled;
      refreshPanel();
      return banner.active;
    };
    const pollAppUpdate = async () => {
      clearTimeout(target.updateTimer);
      try {
        const info = await target.request('app-update-info', 12000);
        if (panel !== target) return;
        target.updateConnectionError = null;
        if (info?.available) {
          target.manualCheckStatus = '';
          target.manualCheckError = '';
        }
        const active = showAppUpdate(info);
        target.updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);
      } catch (error) {
        if (panel !== target) return;
        target.updateConnectionError = error.message;
        if (target.updateInfo) showAppUpdate(target.updateInfo);
        target.updateTimer = setTimeout(pollAppUpdate, 2000);
      }
    };
    checkUpdateButton.onclick = async () => {
      if (target.updateChecking || checkUpdateButton.disabled) return;
      clearTimeout(target.updateTimer);
      clearTimeout(target.manualCheckTimer);
      target.updateChecking = true;
      target.manualCheckStatus = '';
      target.manualCheckError = '';
      showAppUpdate(target.updateInfo);
      try {
        const info = await target.request('app-update-info', 12000, { force: true });
        if (panel !== target) return;
        target.updateChecking = false;
        target.updateConnectionError = null;
        if (info?.checkError && !info?.available) {
          target.manualCheckStatus = 'failed';
          target.manualCheckError = info.checkError;
        } else if (!info?.available) {
          target.manualCheckStatus = 'latest';
          target.manualCheckTimer = setTimeout(() => {
            if (panel !== target || target.manualCheckStatus !== 'latest') return;
            target.manualCheckStatus = '';
            showAppUpdate(target.updateInfo);
          }, 5000);
        }
        const active = showAppUpdate(info);
        target.updateTimer = setTimeout(pollAppUpdate, active ? 2000 : 60000);
      } catch (error) {
        if (panel !== target) return;
        target.updateChecking = false;
        target.manualCheckStatus = 'failed';
        target.manualCheckError = error.message;
        showAppUpdate(target.updateInfo);
        target.updateTimer = setTimeout(pollAppUpdate, 60000);
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
      if (panel) { rememberPanel(panel); panelEvent('dispose', panel.entry); clearTimeout(panel.pollTimer); clearTimeout(panel.updateTimer); clearTimeout(panel.manualCheckTimer); cancelAnimationFrame(panel.marqueeFrame); panel.resizeObserver?.disconnect(); panel.root.remove(); panel.entry.button?.setAttribute('aria-expanded', 'false'); panel = null; }
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
