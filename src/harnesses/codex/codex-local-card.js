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
