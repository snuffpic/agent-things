'use strict';

const React = require('react');
let createPortal = null;
try { createPortal = require('react-dom')?.createPortal || null; } catch { /* test or headless */ }
let uiPrimitives = null;
try { uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch { /* test or headless */ }

const h = React.createElement;
let fallbackIdSeq = 0;
const { useState, useEffect, useRef } = React;
const useMemo = React.useMemo || (fn => fn());
const useLayoutEffect = React.useLayoutEffect || React.useEffect;
const useId = React.useId || (() => `at-dsh-id-${++fallbackIdSeq}`);

const NS = 'agentThings';
const TAB_PROVIDER_ID = 'agent-things-dsh';
const TAB_KIND = 'things';
const HOST_STYLE_ID = 'agent-things-dsh-host-layout';

function getPresentationFactory() {
  if (typeof globalThis !== 'undefined' && typeof globalThis.__agentThingsCreatePresentation === 'function') {
    return globalThis.__agentThingsCreatePresentation;
  }
  return null;
}

function getPresentation(lang) {
  const create = getPresentationFactory();
  if (create) {
    try { return create(lang); } catch { /* ignore */ }
  }
  return (typeof globalThis !== 'undefined' && globalThis.__agentThingsPresentation) || null;
}

function normalizeLang(localeValue) {
  const raw = typeof localeValue === 'string'
    ? localeValue
    : (localeValue?.active || 'zh');
  return /^zh\b/i.test(String(raw)) ? 'zh' : 'en';
}

function isDarkThemeActive() {
  if (typeof document === 'undefined') return false;
  if (document.body?.hasAttribute?.('data-ds-dark-theme')) return true;
  if (document.documentElement?.style?.colorScheme === 'dark') return true;
  if (typeof matchMedia === 'function') {
    return Boolean(matchMedia('(prefers-color-scheme: dark)').matches);
  }
  return false;
}

function resolveOfficialAccent(lang = 'zh') {
  const accent = getPresentation(lang)?.accent;
  return {
    normal: accent?.normal || '#0169CC',
    hover: accent?.hover || '#005bb3',
    pressed: accent?.pressed || '#004f9c',
    onAccent: accent?.onAccent || '#FFFFFF',
  };
}

function readHostTheme(containerEl = null, lang = 'zh') {
  const dark = isDarkThemeActive();
  const mode = dark ? 'dark' : 'light';
  const fallbackBg = dark ? '#0e1318' : '#ffffff';
  const fallbackFg = dark ? '#e6edf3' : '#22272e';
  const fallbackMuted = dark ? '#a0a6ad' : '#576374';
  const accent = resolveOfficialAccent(lang);

  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') {
    return { mode, bg: fallbackBg, fg: fallbackFg, mutedFg: fallbackMuted, primary: accent.normal, accent };
  }

  let bg = '';
  let node = containerEl;
  while (node && node !== document.documentElement) {
    try {
      const c = getComputedStyle(node).backgroundColor;
      if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') {
        bg = c;
        break;
      }
    } catch { /* ignore */ }
    node = node.parentElement;
  }

  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  const rootStyle = document.documentElement ? getComputedStyle(document.documentElement) : null;
  const readVar = name => bodyStyle?.getPropertyValue(name)?.trim() || rootStyle?.getPropertyValue(name)?.trim() || '';

  bg ||= readVar('--dsw-alias-bg-layer-1') || readVar('--dsw-alias-bg-base') || bodyStyle?.backgroundColor || fallbackBg;
  const fg = readVar('--dsw-alias-label-primary') || bodyStyle?.color || fallbackFg;
  const mutedFg = readVar('--dsw-alias-label-secondary') || readVar('--dsw-alias-label-tertiary') || fallbackMuted;

  return { mode, bg, fg, mutedFg, primary: accent.normal, accent };
}

function syncDocumentAccent(containerEl = null, lang = 'zh') {
  const theme = readHostTheme(containerEl, lang);
  if (typeof window !== 'undefined') {
    window.__agentThingsHostAccent = theme.primary;
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    try {
      document.documentElement.style?.setProperty?.('--agent-things-accent', theme.primary);
      if (document.documentElement.dataset) {
        document.documentElement.dataset.mode = theme.mode;
      }
    } catch { /* ignore */ }
  }
  return theme;
}

function normalizeSpace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function resolveSessionTitleFromDom(sessionId) {
  if (typeof document === 'undefined' || !sessionId) return '';
  for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
    if (row.getAttribute('data-row-key') === `session:${sessionId}`) {
      const titleEl = row.querySelector('[class*="title"]');
      const txt = titleEl?.textContent?.trim();
      if (txt) return txt;
    }
  }
  return '';
}

function sessionIdFromKey(key) {
  if (typeof key !== 'string') return '';
  try {
    const parsed = JSON.parse(key);
    if (Array.isArray(parsed) && typeof parsed[1] === 'string') {
      return parsed[1].replace(/^local:/, '');
    }
  } catch { /* fallback */ }
  return String(key).replace(/^local:/, '');
}

function keyForSession(sessionId) {
  return JSON.stringify(['local', String(sessionId || '').replace(/^local:/, '')]);
}

function activeMainViewSessionId(ctx) {
  try {
    const byId = ctx.sessions?.list?.getSnapshot?.()?.byId;
    if (byId && typeof byId === 'object') {
      for (const row of Object.values(byId)) {
        if ((row?.retainedBy?.mainView ?? 0) > 0 && row?.id) return row.id;
      }
    }
  } catch { /* ignore */ }
  if (typeof document !== 'undefined') {
    const selected = document.querySelector('[data-row-key^="session:"][aria-selected="true"]');
    const rowKey = selected?.getAttribute?.('data-row-key') || '';
    if (rowKey.startsWith('session:')) return rowKey.slice('session:'.length);
  }
  return '';
}

async function findTurnElement(turn, locator, role) {
  const snippet = locator ? normalizeSpace(locator).slice(0, 48) : '';
  for (let attempt = 0; attempt < 18; attempt++) {
    const turnNodes = turn != null
      ? [...document.querySelectorAll(`[data-chat-turn="${turn}"]:not([hidden])`)]
      : [...document.querySelectorAll('[data-chat-anchor-key]:not([hidden])')];
    if (turnNodes.length) {
      if (snippet) {
        const matched = turnNodes.filter(el => normalizeSpace(el.textContent).includes(snippet));
        if (matched.length) {
          return role === 'assistant' ? matched[matched.length - 1] : matched[0];
        }
      }
      if (turn != null) {
        return role === 'assistant' ? turnNodes[turnNodes.length - 1] : turnNodes[0];
      }
    }
    await new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 40);
    });
  }
  return null;
}

const HOST_LAYOUT_CSS = `
[data-row-key^="session:"] {
  height: 38px !important;
  min-height: 38px !important;
}
[data-row-key^="session:"] > span[class*="title"] {
  line-height: 26px !important;
}
[data-row-key^="session:"] > span:first-child:has([data-at-dsh-leading-slot]) {
  width: 24px !important;
  min-width: 24px !important;
  height: 28px !important;
  flex: none !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}
[data-at-dsh-leading-slot] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 28px;
}
[data-at-dsh-sidebar-host] {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow: hidden;
}
.at-dsh-sidebar-frame {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
  border: 0;
  margin: 0;
  padding: 0;
  background: transparent;
}
.at-dsh-command-host {
  margin-top: 8px;
  max-width: 100%;
}
.at-dsh-flash-highlight {
  animation: at-dsh-flash 1.8s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes at-dsh-flash {
  0% { box-shadow: 0 0 0 2px #4176e6, 0 0 0 6px rgba(65, 118, 230, 0.24); border-radius: 10px; }
  70% { box-shadow: 0 0 0 2px #4176e6, 0 0 0 3px rgba(65, 118, 230, 0.1); border-radius: 10px; }
  100% { box-shadow: none; }
}
.at-dsh-plugin-config {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 680px;
}
.at-dsh-plugin-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.at-dsh-plugin-head-copy {
  flex: 1 1 auto;
  min-width: 0;
}
.at-dsh-plugin-refresh-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}
@keyframes at-dsh-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: no-preference) {
  .at-dsh-plugin-refresh-btn.is-loading svg {
    animation: at-dsh-spin 0.9s linear infinite;
  }
}
.at-dsh-plugin-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.at-dsh-plugin-desc {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.at-dsh-plugin-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.at-dsh-plugin-field-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.at-dsh-plugin-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.at-dsh-plugin-hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.at-dsh-plugin-banner {
  border-radius: var(--dsw-radius-md, 8px);
  padding: 8px 12px;
  font-size: 12px;
  line-height: 18px;
}
.at-dsh-plugin-banner-warn {
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-state-warn-label);
  border: 0.5px solid var(--dsw-alias-border-l3);
}
.at-dsh-plugin-banner-error {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.at-dsh-model-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 6px 10px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color 140ms ease, border-color 140ms ease;
}
@media (hover: hover) {
  .at-dsh-model-trigger:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.at-dsh-model-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, #0169CC);
}
.at-dsh-model-trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}
.at-dsh-model-trigger-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.at-dsh-model-trigger-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-trigger-provider {
  flex: none;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-chevron {
  flex: none;
  color: var(--dsw-alias-label-caption);
}
.at-dsh-model-select-native {
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.at-dsh-model-menu {
  box-sizing: border-box;
  z-index: 1200;
  border: 0;
  padding: 4px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--dsw-elevation-prominent);
  color: var(--dsw-alias-label-primary);
}
.at-dsh-model-menu-search {
  flex-shrink: 0;
  position: relative;
  margin: 2px 0 3px;
}
.at-dsh-model-menu-search-clear {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.at-dsh-model-menu-groups {
  min-height: 0;
  overflow: hidden auto;
}
.at-dsh-model-menu-option {
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}
@media (hover: hover) {
  .at-dsh-model-menu-option:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.at-dsh-model-menu-option:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.at-dsh-model-menu-option-copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.at-dsh-model-menu-option-name {
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-menu-option-sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.at-dsh-model-menu-check {
  flex: 0 0 14px;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-primary);
}
.at-dsh-plugin-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.at-dsh-plugin-status {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
`.trim();

function injectHostLayoutStyles() {
  if (typeof document === 'undefined' || !document.head) return () => {};
  let styleEl = document.head.querySelector(`style[data-plugin="${TAB_PROVIDER_ID}"]`);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-plugin', TAB_PROVIDER_ID);
    styleEl.setAttribute('data-id', HOST_STYLE_ID);
    styleEl.textContent = HOST_LAYOUT_CSS;
    styleEl.__atDshLayoutRefCount = 0;
    document.head.appendChild(styleEl);
  }
  styleEl.__atDshLayoutRefCount = (styleEl.__atDshLayoutRefCount || 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    styleEl.__atDshLayoutRefCount = Math.max(0, (styleEl.__atDshLayoutRefCount || 1) - 1);
    if (styleEl.__atDshLayoutRefCount === 0) {
      try { styleEl.remove(); } catch { /* ignore */ }
    }
  };
}

function createDshBridge(ctx) {
  let summary = { version: 1, revision: 0, lang: normalizeLang(ctx.locale?.getLocale?.()), items: {} };
  let uiSnapshot = { version: 1, revision: 0, lang: summary.lang, records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} };
  const details = new Map();
  const detailPromises = new Map();
  const listeners = new Set();
  const localeListeners = new Set();
  const sessionWaiters = new Map();
  const flashTimers = typeof WeakMap === 'function' ? new WeakMap() : null;
  let stopped = false;
  let sseController = null;
  let reconnectTimer = null;
  let backoffMs = 1000;
  let mainApi = null;
  const embeddedCards = new Set();

  const activeLang = () => normalizeLang(ctx.locale?.getLocale?.());

  const notifyLocale = () => {
    const nextLang = activeLang();
    for (const listener of [...localeListeners]) {
      try { listener(nextLang); } catch { /* isolate subscriber */ }
    }
  };

  const notify = () => {
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* isolate subscriber */ }
    }
  };

  const notifySessionSubscribers = sessionId => {
    const subs = sessionWaiters.get(sessionId);
    if (!subs?.size) return;
    const detail = details.get(sessionId);
    const sidebar = detail?.sidebarSession;
    if (!sidebar) return;
    const title = resolveSessionTitleFromDom(sessionId);
    const payload = title ? { ...sidebar, title } : sidebar;
    for (const cb of [...subs]) {
      try { cb(payload); } catch { /* isolate */ }
    }
  };

  const syncEmbeddedCardsForSession = (sessionId, detail) => {
    for (const card of [...embeddedCards]) {
      if (card.sessionId !== sessionId || !card.api) continue;
      try {
        if (detail) {
          card.api.receiveCardEvent({
            snapshot: uiSnapshot,
            analysisState: detail.analysisState || null,
            session: detail.session || null,
          });
        } else {
          card.api.receive(uiSnapshot);
        }
      } catch { /* ignore disposed card */ }
    }
  };

  const applyUiSnapshot = next => {
    if (!next || typeof next !== 'object') return;
    if (typeof next.revision === 'number' && next.revision < uiSnapshot.revision && (!next.lang || next.lang === uiSnapshot.lang)) {
      return;
    }
    uiSnapshot = next;
    try {
      mainApi?.receive(uiSnapshot);
    } catch { /* ignore */ }
    for (const card of [...embeddedCards]) {
      if (!details.has(card.sessionId)) {
        try { card.api?.receive(uiSnapshot); } catch { /* ignore */ }
      }
    }
  };

  const apiFetch = async (urlPath, options = {}) => {
    const lang = activeLang();
    const sep = urlPath.includes('?') ? '&' : '?';
    const url = `${urlPath}${sep}lang=${encodeURIComponent(lang)}`;
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data?.errorInfo?.code;
      throw err;
    }
    return data;
  };

  const applyDetailPayload = (sessionId, data) => {
    if (!sessionId || !data) return;
    if (details.size >= 100 && !details.has(sessionId)) {
      details.delete(details.keys().next().value);
    }
    details.set(sessionId, data);
    if (data.snapshot) applyUiSnapshot(data.snapshot);
    const rev = data.revision ?? summary.revision;
    if (data.record?.state || data.analyzing || data.timeline?.latestStatus === 'failed') {
      summary = {
        ...summary,
        revision: Math.max(summary.revision || 0, rev || 0),
        items: {
          ...summary.items,
          [sessionId]: {
            ...(summary.items?.[sessionId] || {}),
            sessionId,
            revision: data.revision,
            state: data.record?.state ?? null,
            progress: data.record?.progress ?? null,
            note: data.record?.note ? String(data.record.note).slice(0, 240) : '',
            analyzing: Boolean(data.analyzing),
            analysisStatus: data.analyzing ? 'pending' : (data.timeline?.latestStatus || null),
            analysisStage: data.timeline?.stage || null,
            analysisError: data.timeline?.latestError || null,
            tasksSummary: data.analysis?.ledger ? {
              total: data.analysis.ledger.totalTasks ?? data.analysis.ledger.tasks?.length ?? 0,
              done: data.analysis.ledger.completedTasks ?? (data.analysis.ledger.tasks?.filter(t => t.status === 'done').length || 0),
              percent: data.analysis.ledger.percent ?? 0,
            } : null,
          },
        },
      };
    } else if (summary.items?.[sessionId]) {
      const nextItems = { ...summary.items };
      delete nextItems[sessionId];
      summary = { ...summary, revision: Math.max(summary.revision || 0, rev || 0), items: nextItems };
    }
    syncEmbeddedCardsForSession(sessionId, data);
    notifySessionSubscribers(sessionId);
    notify();
  };

  const fetchSessionDetail = async (sessionId, { force = false, includeGit = true } = {}) => {
    if (!sessionId || stopped) return null;
    const reqKey = `${sessionId}:${activeLang()}:${includeGit ? '1' : '0'}`;
    if (!force && detailPromises.has(reqKey)) return detailPromises.get(reqKey);
    const task = (async () => {
      try {
        const data = await apiFetch(`api/agent-things/session?sessionId=${encodeURIComponent(sessionId)}&includeGit=${includeGit ? '1' : '0'}`);
        applyDetailPayload(sessionId, data);
        return data;
      } finally {
        detailPromises.delete(reqKey);
      }
    })();
    detailPromises.set(reqKey, task);
    return task;
  };

  const refreshSummary = async () => {
    if (stopped) return summary;
    try {
      const next = await apiFetch('api/agent-things/summary');
      summary = { ...next, items: next?.items || {} };
      if (next?.snapshot) applyUiSnapshot(next.snapshot);
      notify();
    } catch { /* retry via SSE or interaction */ }
    return summary;
  };

  const rpc = async payloadObj => {
    const body = { ...payloadObj, lang: activeLang() };
    return apiFetch('api/agent-things/rpc', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  const getAnalysisConfig = async () => apiFetch('api/agent-things/analysis-config');

  const saveAnalysisConfig = async nextConfig => apiFetch('api/agent-things/analysis-config', {
    method: 'POST',
    body: JSON.stringify({ ...nextConfig, lang: activeLang() }),
  });

  const locateAndJump = async (sessionId, { taskId, itemId, turnId, locator } = {}) => {
    const res = await apiFetch('api/agent-things/locate', {
      method: 'POST',
      body: JSON.stringify({ sessionId, taskId, itemId, turnId, locator, lang: activeLang() }),
    });
    if (!res?.located) return res;

    try {
      ctx.uiWorkspace?.openSession?.(sessionId);
    } catch { /* already open */ }

    if (typeof document !== 'undefined') {
      const targetKey = `session:${sessionId}`;
      const waitFrame = () => new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 25);
      });
      for (let w = 0; w < 12; w++) {
        const rows = [...document.querySelectorAll('[data-row-key^="session:"]')];
        const row = rows.find(el => el.getAttribute('data-row-key') === targetKey);
        if (!row || row.getAttribute('aria-selected') === 'true') break;
        await waitFrame();
      }
    }

    if (res.seq != null && ctx.sessions?.using) {
      try {
        await ctx.sessions.using(sessionId, { source: 'controllerOperation' }, async ref => {
          const binding = await ref.ready;
          if (typeof binding?.session?.loadThrough === 'function') {
            await binding.session.loadThrough(res.seq);
          }
        });
      } catch { /* proceed with current DOM */ }
    }

    const hitElement = await findTurnElement(res.turn, res.locator, res.role);
    if (!hitElement) {
      const ui = getPresentation(activeLang());
      return { located: false, reason: 'dom_not_found', message: ui?.strings?.locateNotFound || res.message };
    }
    hitElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    hitElement.classList.remove('at-dsh-flash-highlight');
    void hitElement.offsetWidth;
    hitElement.classList.add('at-dsh-flash-highlight');
    if (flashTimers?.has(hitElement)) {
      clearTimeout(flashTimers.get(hitElement));
    }
    const timerId = setTimeout(() => {
      if (flashTimers?.get(hitElement) === timerId) {
        flashTimers.delete(hitElement);
      }
      hitElement.classList.remove('at-dsh-flash-highlight');
    }, 2000);
    flashTimers?.set(hitElement, timerId);
    return { ...res, scrolled: true };
  };

  const handleSseEvent = (eventType, rawData) => {
    let payload;
    try { payload = JSON.parse(rawData); } catch { return; }
    if (eventType === 'snapshot') {
      summary = { ...payload, items: payload?.items || {} };
      if (payload?.snapshot) applyUiSnapshot(payload.snapshot);
      notify();
      const idsToRefresh = new Set([
        ...details.keys(),
        ...sessionWaiters.keys(),
        ...[...embeddedCards].map(c => c.sessionId),
      ]);
      for (const sid of idsToRefresh) {
        if (sid) void fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
      }
      return;
    }
    if (eventType === 'update') {
      const nextItems = { ...(summary.items || {}) };
      for (const [sid, val] of Object.entries(payload?.items || {})) {
        if (val === null) delete nextItems[sid];
        else nextItems[sid] = val;
      }
      summary = { ...summary, revision: payload?.revision ?? summary.revision, items: nextItems };
      if (payload?.snapshot) applyUiSnapshot(payload.snapshot);
      notify();
      for (const sid of payload?.changedSessionIds || []) {
        if (details.has(sid) || sessionWaiters.has(sid) || [...embeddedCards].some(c => c.sessionId === sid)) {
          void fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
        }
      }
    }
  };

  const connectSse = async () => {
    if (stopped) return;
    if (sseController) {
      sseController.abort();
      sseController = null;
    }
    clearTimeout(reconnectTimer);
    const controller = new AbortController();
    sseController = controller;
    try {
      const res = await fetch(`api/agent-things/events?lang=${encodeURIComponent(activeLang())}`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
      backoffMs = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!stopped && !controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (!frame.trim() || frame.startsWith(':')) continue;
          let eventType = 'message';
          const dataLines = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
          }
          if (dataLines.length) handleSseEvent(eventType, dataLines.join('\n'));
        }
      }
    } catch { /* reconnect with backoff */ }
    if (!stopped && sseController === controller) {
      reconnectTimer = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, 10000);
        void connectSse();
      }, backoffMs);
    }
  };

  const openSidebarForSession = sessionId => {
    if (sessionId) {
      try { ctx.uiWorkspace?.openSession?.(sessionId); } catch { /* ignore */ }
    }
    try { ctx.sidebarRight?.openTab?.(TAB_KIND); } catch { /* ignore */ }
  };

  const subscribeSession = (sessionId, listener) => {
    if (!sessionId) return () => {};
    let set = sessionWaiters.get(sessionId);
    if (!set) {
      set = new Set();
      sessionWaiters.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) sessionWaiters.delete(sessionId);
    };
  };

  const setMainApi = api => { mainApi = api; };
  const registerEmbeddedCard = card => {
    embeddedCards.add(card);
    return () => { embeddedCards.delete(card); };
  };

  const syncAfterRpcResponse = (message, res) => {
    if (res?.snapshot) applyUiSnapshot(res.snapshot);
    const sid = sessionIdFromKey(message?.key);
    if (sid && ['update', 'clear', 'analyze'].includes(message?.type)) {
      void fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
    }
  };

  const handlePanelPayload = async (rawPayload, targetApi) => {
    let message;
    try { message = JSON.parse(rawPayload); } catch { return; }
    if (message?.type === 'open-pane') {
      const sid = sessionIdFromKey(message.key);
      openSidebarForSession(sid);
      targetApi?.reply({ requestId: message.requestId, pane: { delivered: true } });
      return;
    }
    if (message?.type === 'locate-source') {
      const sid = sessionIdFromKey(message.key);
      try {
        const res = await locateAndJump(sid, message.source || {});
        if (res?.located) {
          targetApi?.reply({ requestId: message.requestId, navigation: res });
        } else {
          const ui = getPresentation(activeLang());
          targetApi?.reply({
            requestId: message.requestId,
            error: res?.message || ui?.strings?.locateNotFound || 'Source message not found',
          });
        }
      } catch (err) {
        targetApi?.reply({ requestId: message.requestId, error: err?.message || 'Locate failed' });
      }
      return;
    }
    try {
      const res = await rpc(message);
      syncAfterRpcResponse(message, res);
      targetApi?.reply(res);
    } catch (err) {
      targetApi?.reply({
        requestId: message?.requestId,
        error: err?.message || 'Request failed',
        errorInfo: { code: err?.code || 'HOST_UNAVAILABLE' },
      });
    }
  };

  const start = () => {
    void refreshSummary();
    void connectSse();
  };

  const dispose = () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    if (sseController) {
      sseController.abort();
      sseController = null;
    }
    listeners.clear();
    localeListeners.clear();
    sessionWaiters.clear();
    details.clear();
    embeddedCards.clear();
    try { mainApi?.destroy?.(); } catch { /* ignore */ }
    mainApi = null;
  };

  return {
    getSummary: () => summary,
    getSummaryItem: sessionId => summary.items?.[sessionId] || null,
    getDetail: sessionId => details.get(sessionId) || null,
    getUiSnapshot: () => uiSnapshot,
    getLang: activeLang,
    subscribe: fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    subscribeLocale: fn => {
      localeListeners.add(fn);
      return () => localeListeners.delete(fn);
    },
    notifyLocale,
    subscribeSession,
    setMainApi,
    registerEmbeddedCard,
    refreshSummary,
    fetchSessionDetail,
    applyUiSnapshot,
    rpc,
    getAnalysisConfig,
    saveAnalysisConfig,
    locateAndJump,
    openSidebarForSession,
    handlePanelPayload,
    reconnect: () => {
      void refreshSummary();
      void connectSse();
    },
    start,
    dispose,
  };
}

function buildSidebarIframeBridgeScript(bridgeId, initialSessionId, lang, theme) {
  const presentation = getPresentation(lang);
  const uiBootstrap = {
    lang,
    labels: presentation?.labels || {},
    taskLabels: presentation?.taskLabels || {},
    colors: presentation?.colors || { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' },
    strings: presentation?.strings || {},
    locales: presentation?.locales || {},
  };
  const updateBannerFn = presentation?.updateBannerState
    ? presentation.updateBannerState.toString()
    : 'function(){return{visible:false,active:false,completed:false,failed:false,buttonDisabled:true,label:"",buttonText:"",detail:"",versionText:"",showVersionBar:false,checkDisabled:true,checkFailed:false,checkButtonText:""}}';

  return `<script>
(function(){
  var BRIDGE_ID = ${JSON.stringify(bridgeId)};
  window.__agentThingsLang = ${JSON.stringify(lang)};
  window.__agentThingsHostTheme = ${JSON.stringify({ mode: theme.mode, primary: theme.primary })};
  window.__agentThingsUpdateBannerState = ${updateBannerFn};
  window.__agentThingsI18n = ${JSON.stringify(uiBootstrap)};
  window.sidecar = { conversationId: ${JSON.stringify(initialSessionId || '')} };

  function getHostBridge() {
    var reg = window.parent && window.parent.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__;
    return reg && reg[BRIDGE_ID] ? reg[BRIDGE_ID] : null;
  }

  function applyDshTokens(t) {
    if (!t) return;
    var root = document.documentElement;
    var accent = t.accent || null;
    var normalAccent = (accent && accent.normal) || t.primary;
    if (t.bg) root.style.setProperty('--background', t.bg);
    if (t.fg) root.style.setProperty('--foreground', t.fg);
    if (t.mutedFg) root.style.setProperty('--muted-foreground', t.mutedFg);
    if (normalAccent) root.style.setProperty('--primary', normalAccent);
    if (accent && accent.onAccent) root.style.setProperty('--primary-foreground', accent.onAccent);
    if (t.mode) {
      window.__agentThingsHostTheme = { mode: t.mode, primary: normalAccent || '' };
      root.setAttribute('data-color-mode', t.mode);
      root.style.setProperty('color-scheme', t.mode);
    }
    if (typeof window.syncThemeWithHost === 'function') {
      try { window.syncThemeWithHost(); } catch (e) {}
    }
    if (t.bg) {
      root.style.setProperty('--at-panel-bg', t.bg);
    }
    if (normalAccent) {
      root.style.setProperty('--primary', normalAccent);
      root.style.setProperty('--accent', normalAccent);
    }
    if (accent && accent.hover) root.style.setProperty('--accent-hover', accent.hover);
    if (accent && accent.pressed) root.style.setProperty('--accent-pressed', accent.pressed);
    if (accent && accent.onAccent) {
      root.style.setProperty('--on-accent', accent.onAccent);
      root.style.setProperty('--primary-foreground', accent.onAccent);
    }
  }

  applyDshTokens(${JSON.stringify(theme)});

  var origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  window.fetch = async function(input, init) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
    var bridge = getHostBridge();
    if (bridge && rawUrl.startsWith('/api/')) {
      var resObj;
      if (rawUrl.startsWith('/api/session')) {
        var qs = rawUrl.split('?')[1] || '';
        var params = new URLSearchParams(qs);
        resObj = await bridge.getSession(params.get('conversationId') || '');
      } else if (rawUrl === '/api/action') {
        var body = init && init.body ? JSON.parse(init.body) : {};
        resObj = await bridge.performAction(body.conversationId, body.action, body.payload || {});
      } else if (rawUrl === '/api/locate') {
        var locBody = init && init.body ? JSON.parse(init.body) : {};
        resObj = await bridge.locate(locBody.conversationId, locBody.source || {});
      } else if (rawUrl.startsWith('/api/ticket')) {
        var tqs = rawUrl.split('?')[1] || '';
        var tparams = new URLSearchParams(tqs);
        resObj = { ok: true, ticket: 'dsh-local', origin: window.location.origin, conversationId: tparams.get('conversationId') || '' };
      } else {
        resObj = { status: 404, body: { error: 'Not found' } };
      }
      var status = (resObj && resObj.status) || 200;
      var payload = (resObj && resObj.body !== undefined) ? resObj.body : resObj;
      return new Response(JSON.stringify(payload), {
        status: status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
    if (origFetch) return origFetch(input, init);
    throw new Error('fetch unavailable');
  };

  function DshEventSource(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = { snapshot: [], change: [], message: [], error: [] };
    var self = this;
    var bridge = getHostBridge();
    var match = String(url).match(/[?&]id=([^&]+)/);
    var convId = match ? decodeURIComponent(match[1]) : (window.sidecar && window.sidecar.conversationId) || '';
    this._unsub = bridge ? bridge.subscribeEvents(convId, function(type, data) {
      if (self.readyState === 2) return;
      var list = self.listeners[type] || [];
      var ev = { type: type, data: JSON.stringify(data) };
      for (var i = 0; i < list.length; i++) {
        try { list[i](ev); } catch (e) {}
      }
    }) : null;
    setTimeout(function() {
      if (self.readyState === 0) self.readyState = 1;
    }, 0);
  }
  DshEventSource.prototype.addEventListener = function(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  };
  DshEventSource.prototype.close = function() {
    this.readyState = 2;
    if (this._unsub) {
      try { this._unsub(); } catch (e) {}
      this._unsub = null;
    }
  };
  window.EventSource = DshEventSource;

  window.addEventListener('message', function(ev) {
    if (!ev || !ev.data) return;
    if (window.parent && window.parent !== window && ev.source != null && ev.source !== window.parent) return;
    if (ev.data.type === 'dsh-theme-sync') {
      applyDshTokens(ev.data.theme);
    } else if (ev.data.type === 'conversation-change' && (ev.data.conversationId || ev.data.allowEmpty)) {
      window.sidecar = { conversationId: ev.data.conversationId || '' };
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyDshTokens(${JSON.stringify(theme)});
    }, { once: true });
  }
})();
</script>`;
}

function composeSidebarHtml({ rawHtml, bridgeId, sessionId, lang, theme }) {
  if (typeof rawHtml !== 'string' || !rawHtml) return '';
  let html = rawHtml.replace(
    '<html lang="zh-CN">',
    `<html lang="${lang === 'en' ? 'en' : 'zh-CN'}" data-color-mode="${theme.mode}" style="color-scheme:${theme.mode}">`,
  );
  const bootstrap = buildSidebarIframeBridgeScript(bridgeId, sessionId, lang, theme);
  if (html.includes('<script src="/preload.js"></script>')) {
    html = html.replace('<script src="/preload.js"></script>', bootstrap);
  } else {
    html = html.replace('</head>', `${bootstrap}\n</head>`);
  }
  return html;
}

function makeUiComponents(ctx, bridge) {
  function LeadingRingAnchor({ sessionId }) {
    const slotRef = useRef(null);
    useEffect(() => {
      if (typeof window !== 'undefined' && typeof window.__agentThingsScheduleReconcile === 'function') {
        window.__agentThingsScheduleReconcile();
      }
      return () => {
        if (typeof window !== 'undefined' && typeof window.__agentThingsScheduleReconcile === 'function') {
          window.__agentThingsScheduleReconcile();
        }
      };
    }, [sessionId]);

    const stopBubble = e => {
      e.stopPropagation();
    };

    return h('span', {
      ref: slotRef,
      'data-at-dsh-leading-slot': sessionId,
      onClick: stopBubble,
      onMouseDown: stopBubble,
      onPointerDown: stopBubble,
      onDoubleClick: stopBubble,
    });
  }

  function ThingsTabTitle() {
    return h('span', null, 'Things');
  }

  function ThingsSidebarTab(props) {
    const hostRef = useRef(null);
    const iframeRef = useRef(null);
    const [activeSessionId, setActiveSessionId] = useState(() => (
      props?.injectedSessionId || props?.sessionId || activeMainViewSessionId(ctx)
    ));
    const currentSessionRef = useRef(activeSessionId);
    currentSessionRef.current = activeSessionId;

    useEffect(() => {
      const propId = props?.injectedSessionId || props?.sessionId;
      if (propId && propId !== currentSessionRef.current) {
        setActiveSessionId(propId);
      }
      const syncActive = () => {
        if (props?.injectedSessionId || props?.sessionId) return;
        const resolved = activeMainViewSessionId(ctx);
        if (resolved && resolved !== currentSessionRef.current) {
          setActiveSessionId(resolved);
        }
      };
      const unsub = typeof ctx.sessions?.list?.subscribe === 'function'
        ? ctx.sessions.list.subscribe(syncActive)
        : () => {};
      return () => {
        try { unsub(); } catch { /* ignore */ }
      };
    }, [props?.injectedSessionId, props?.sessionId]);

    useEffect(() => {
      const iframe = iframeRef.current;
      const host = hostRef.current;
      if (!iframe || !host) return;

      const bridgeId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? `dsh-sb-${crypto.randomUUID()}`
        : `dsh-sidebar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      if (typeof window !== 'undefined') {
        if (!Object.prototype.hasOwnProperty.call(window, '__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__') || !window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__) {
          Object.defineProperty(window, '__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__', {
            value: Object.create(null),
            writable: true,
            configurable: true,
            enumerable: false,
          });
        }
        window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__[bridgeId] = {
          getSession: async convId => {
            const sid = String(convId || '').trim();
            if (!sid) return { ok: true, lang: bridge.getLang(), session: null, title: '' };
            try {
              const detail = await bridge.fetchSessionDetail(sid, { force: true });
              const title = resolveSessionTitleFromDom(sid);
              const session = detail?.sidebarSession ? (title ? { ...detail.sidebarSession, title } : detail.sidebarSession) : null;
              return { ok: true, lang: detail?.lang || bridge.getLang(), session, title };
            } catch (err) {
              return { status: 500, body: { error: err?.message || 'Failed to load session' } };
            }
          },
          performAction: async (convId, action, payload = {}) => {
            const sid = String(convId || '').trim();
            const isUpdate = action === 'app-update-info' || action === 'app-update-start';
            if (!isUpdate && !sid) {
              const en = bridge.getLang() === 'en';
              return { status: 400, body: { error: en ? 'Select or open a session first' : '请先打开或选择一个会话' } };
            }
            try {
              const res = await bridge.rpc({
                requestId: `sb-${Date.now().toString(36)}`,
                type: action === 'save' ? 'update' : action,
                ...(sid ? { key: keyForSession(sid) } : {}),
                ...payload,
              });
              if (res?.error) {
                const suffix = res.errorInfo?.code === 'REVISION_CONFLICT' ? ' (conflict)' : '';
                return { status: res.errorInfo?.code === 'REVISION_CONFLICT' ? 409 : 400, body: { error: `${res.error}${suffix}` } };
              }
              if (res?.snapshot) bridge.applyUiSnapshot(res.snapshot);
              if (sid && ['update', 'save', 'clear', 'analyze'].includes(action)) {
                void bridge.fetchSessionDetail(sid, { force: true, includeGit: false }).catch(() => {});
              }
              if (action === 'update' || action === 'save' || action === 'clear') {
                return { ok: true, session: res.session || res.sidebarSession };
              }
              return res;
            } catch (err) {
              return { status: 500, body: { error: err?.message || 'RPC request failed' } };
            }
          },
          locate: async (convId, source) => {
            const sid = String(convId || '').trim();
            if (!sid) return { located: false };
            try {
              return await bridge.locateAndJump(sid, source || {});
            } catch (err) {
              return { located: false, message: err?.message || 'Locate failed' };
            }
          },
          subscribeEvents: (convId, emit) => {
            const sid = String(convId || '').trim();
            if (!sid) return () => {};
            const unsub = bridge.subscribeSession(sid, sessionData => {
              emit('change', sessionData);
            });
            const existing = bridge.getDetail(sid)?.sidebarSession;
            if (existing) {
              setTimeout(() => {
                const title = resolveSessionTitleFromDom(sid);
                emit('snapshot', title ? { ...existing, title } : existing);
              }, 0);
            }
            return unsub;
          },
        };
      }

      const rawHtml = typeof __AGENT_THINGS_SIDEBAR_HTML__ === 'string' ? __AGENT_THINGS_SIDEBAR_HTML__ : '';
      const lang = bridge.getLang();
      const theme = syncDocumentAccent(host, lang);
      iframe.srcdoc = composeSidebarHtml({ rawHtml, bridgeId, sessionId: currentSessionRef.current, lang, theme });

      let lastThemeSig = `${theme.mode}|${theme.primary}|${theme.bg}`;
      const syncFrameTheme = () => {
        const currentLang = bridge.getLang();
        const nextTheme = syncDocumentAccent(host, currentLang);
        lastThemeSig = `${nextTheme.mode}|${nextTheme.primary}|${nextTheme.bg}`;
        try {
          iframe.contentWindow?.postMessage({ type: 'dsh-theme-sync', theme: nextTheme }, '*');
          iframe.contentWindow?.postMessage({ type: 'dsh-lang-sync', lang: currentLang }, '*');
        } catch { /* ignore */ }
      };

      const themeObserver = typeof MutationObserver === 'function' && document.body
        ? new MutationObserver(() => {
            const candidate = readHostTheme(host, bridge.getLang());
            const nextSig = `${candidate.mode}|${candidate.primary}|${candidate.bg}`;
            if (nextSig !== lastThemeSig) syncFrameTheme();
          })
        : null;
      themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });
      iframe.addEventListener('load', syncFrameTheme);
      const unsubLocale = bridge.subscribeLocale?.(nextLang => {
        try {
          iframe.contentWindow?.postMessage({ type: 'dsh-lang-sync', lang: nextLang }, '*');
        } catch { /* ignore */ }
      });

      return () => {
        iframe.removeEventListener('load', syncFrameTheme);
        unsubLocale?.();
        themeObserver?.disconnect();
        if (typeof window !== 'undefined' && window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__) {
          delete window.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__[bridgeId];
        }
      };
    }, []);

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const nextSessionId = activeSessionId ? String(activeSessionId).trim() : '';
      const title = nextSessionId ? resolveSessionTitleFromDom(nextSessionId) : '';
      try {
        if (iframe.contentWindow?.sidecar) {
          iframe.contentWindow.sidecar.conversationId = nextSessionId;
        }
        iframe.contentWindow?.postMessage({
          type: 'conversation-change',
          conversationId: nextSessionId,
          title,
          ...(!nextSessionId ? { allowEmpty: true } : {}),
        }, '*');
      } catch { /* iframe may still be booting; window.sidecar holds initialSessionId */ }
    }, [activeSessionId]);

    return h('div', { ref: hostRef, 'data-at-dsh-sidebar-host': '' },
      h('iframe', {
        ref: iframeRef,
        className: 'at-dsh-sidebar-frame',
        title: 'Agent Things',
      }),
    );
  }

  const INLINE_OPEN_PANE_CSS = `
.shell > .open-pane {
  position: absolute;
  right: 13px;
  top: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--secondary);
  cursor: pointer;
  transition: color 150ms var(--ease-out), background-color 150ms var(--ease-out), opacity 160ms var(--ease-out), transform 160ms var(--ease-out);
  z-index: 5;
}
.shell > .open-pane:hover,
.shell > .open-pane:focus-visible {
  color: var(--ink);
  background: var(--hover);
}
.shell > .open-pane:active:not(:disabled) {
  transform: scale(0.94);
}
.shell > .open-pane .open-pane-tip {
  position: absolute;
  right: calc(100% + 6px);
  top: 50%;
  transform-origin: center right;
  transform: translateY(-50%) scale(0.96);
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--ink);
  border: 1px solid var(--line);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 150ms var(--ease-out), transform 150ms var(--ease-out), visibility 0s linear 150ms;
  z-index: 20;
}
.shell > .open-pane:is(:hover, :focus-visible) .open-pane-tip {
  opacity: 1;
  transform: translateY(-50%) scale(1);
  visibility: visible;
  transition: opacity 150ms var(--ease-out) 160ms, transform 150ms var(--ease-out) 160ms, visibility 0s linear 160ms;
}
.shell.has-open-pane .title-heading {
  margin-right: 34px;
}
`;

  function createInlineOpenPaneButton(label) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'open-pane';
    btn.setAttribute('aria-label', label);

    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');

    const rect = document.createElementNS(svgNs, 'rect');
    rect.setAttribute('x', '6.65');
    rect.setAttribute('y', '8.15');
    rect.setAttribute('width', '14.7');
    rect.setAttribute('height', '11.7');
    rect.setAttribute('rx', '3');
    rect.setAttribute('stroke', 'currentColor');
    rect.setAttribute('stroke-width', '1.3');

    const path = document.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M16.3 8.2V19.8');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.3');

    svg.append(rect, path);

    const tip = document.createElement('span');
    tip.className = 'open-pane-tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = label;

    btn.append(svg, tip);
    return { btn, tip };
  }

  function attachInlineOpenPaneButton(container, sessionId) {
    let btn = null;
    let tip = null;
    let disposed = false;

    const resolveLabel = () => {
      const lang = bridge.getLang();
      return getPresentation(lang)?.strings?.openInSidebar || (lang === 'en' ? 'Open in sidebar' : '在侧栏打开');
    };

    const ensureMounted = () => {
      if (disposed) return;
      const shadow = container?.firstElementChild?.shadowRoot;
      if (!shadow) return;

      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        if (!shadow.querySelector?.('style[data-at-dsh-open-pane="1"]')) {
          const styleEl = document.createElement('style');
          styleEl.setAttribute('data-at-dsh-open-pane', '1');
          styleEl.textContent = INLINE_OPEN_PANE_CSS;
          shadow.appendChild?.(styleEl);
        }
      }

      const shell = shadow.querySelector?.('.shell');
      if (!shell) return;
      shell.classList?.add?.('has-open-pane');

      const label = resolveLabel();
      const existing = shell.querySelector?.('.open-pane');
      if (existing) {
        btn = existing;
        tip = existing.querySelector?.('.open-pane-tip') || tip;
      } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const created = createInlineOpenPaneButton(label);
        btn = created.btn;
        tip = created.tip;
        btn.addEventListener('click', event => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          bridge.openSidebarForSession(sessionId);
        });
        if (typeof shell.prepend === 'function') shell.prepend(btn);
        else shell.appendChild?.(btn);
      }

      if (btn && btn.getAttribute?.('aria-label') !== label) {
        btn.setAttribute?.('aria-label', label);
      }
      if (tip && tip.textContent !== label) {
        tip.textContent = label;
      }
    };

    ensureMounted();

    const shadow = container?.firstElementChild?.shadowRoot;
    let shadowObserver = null;
    if (typeof MutationObserver === 'function' && shadow) {
      shadowObserver = new MutationObserver(() => ensureMounted());
      try {
        shadowObserver.observe(shadow, { childList: true, subtree: true });
      } catch {
        shadowObserver = null;
      }
    }
    const unsubscribe = bridge.subscribe(() => ensureMounted());

    return () => {
      disposed = true;
      shadowObserver?.disconnect();
      unsubscribe?.();
    };
  }

  function ThingsCommandCard({ sessionId }) {
    const containerRef = useRef(null);
    const cardApiRef = useRef(null);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !sessionId || typeof installCodexSessionStatus !== 'function') return () => {};
      let disposed = false;
      const key = keyForSession(sessionId);
      const existingDetail = bridge.getDetail(sessionId);
      const version = typeof __AGENT_THINGS_VERSION__ === 'string' ? __AGENT_THINGS_VERSION__ : '';
      const cardEntry = { sessionId, api: null };

      const initialTheme = syncDocumentAccent(container, bridge.getLang());

      const api = installCodexSessionStatus(version, null, {
        container,
        key,
        title: resolveSessionTitleFromDom(sessionId) || (bridge.getLang() === 'en' ? 'Current session' : '当前会话'),
        snapshot: bridge.getUiSnapshot(),
        analysisState: existingDetail?.analysisState || null,
        session: existingDetail?.session || null,
        theme: initialTheme.mode,
        lang: bridge.getLang(),
        independent: true,
        streamConnected: true,
        send: rawPayload => {
          Promise.resolve().then(() => {
            if (!disposed && cardEntry.api) {
              void bridge.handlePanelPayload(rawPayload, cardEntry.api);
            }
          });
        },
      });
      cardApiRef.current = api;
      cardEntry.api = api;
      const detachOpenPane = attachInlineOpenPaneButton(container, sessionId);
      const unregister = bridge.registerEmbeddedCard(cardEntry);

      void bridge.fetchSessionDetail(sessionId, { force: true }).catch(() => {});

      const themeObserver = typeof MutationObserver === 'function' && document.body
        ? new MutationObserver(() => {
            if (disposed) return;
            const nextTheme = syncDocumentAccent(container, bridge.getLang());
            api?.setTheme?.(nextTheme.mode);
          })
        : null;
      themeObserver?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });

      return () => {
        disposed = true;
        themeObserver?.disconnect();
        detachOpenPane();
        unregister();
        try { api?.destroy?.(); } catch { /* ignore */ }
        cardApiRef.current = null;
      };
    }, [sessionId]);

    return h('div', { ref: containerRef, className: 'at-dsh-command-host' });
  }

  const ANALYSIS_COPY = {
    zh: {
      title: '任务解析模型',
      subtitle: '选择用于自动分析 /things 待办清单与进度状态的模型和思考程度，不影响当前对话所使用的模型。',
      refresh: '刷新模型',
      refreshShort: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取当前可用模型目录…',
      modelLabel: '解析模型',
      effortLabel: '思考程度',
      recommendedGroup: '推荐默认',
      defaultTitle: '自动选择 · DeepSeek-V4.1-Flash',
      defaultFallbackTitle: '自动选择 · 可用轻量模型',
      defaultCurrentTag: '默认',
      customTag: '自定义',
      unavailableTag: '当前不可用',
      defaultSelectedHint: '未指定固定模型时默认优先使用 DeepSeek-V4.1-Flash（思考程度默认为 Low）。',
      customSelectedHint: '已固定使用该模型路由：',
      unavailableBanner: '原选模型（{saved}）当前不可用（可能已移除或缺少凭据）；后台分析将临时自动回退到 {fallback}。',
      unavailableNoFallback: '原选模型（{saved}）当前不可用，且未检测到其他可用模型，请先在设置 → 模型中配置服务商或 API Key。',
      providerLoadError: '部分模型提供方加载失败（{name}：{message}）',
      searchPlaceholder: '搜索模型名称或 ID…',
      searchClear: '清空搜索',
      emptyModels: '暂无可用模型，请先在「设置 → 模型」添加或登录账号。',
      noSearchResults: '未找到匹配的模型。',
      effortDefaultLowHint: '默认使用 Low，兼顾 JSON 结构化提取准确率与响应速度。',
      effortUnsupported: '当前所选模型未提供思考程度选项，将直接使用模型默认行为。',
      save: '保存',
      saving: '保存中…',
      discard: '取消更改',
      resetDefault: '恢复默认',
      savedOk: '已保存，将在下次分析时生效。',
      resetOk: '已恢复默认配置（DeepSeek-V4.1-Flash · Low）。',
      loadFailed: '读取模型配置失败：',
      saveFailed: '保存失败：',
      summary: '配置用于 /things 后台任务分析的默认模型与思考程度。',
    },
    en: {
      title: 'Task Analysis Model',
      subtitle: 'Choose the model and reasoning effort used for /things task extraction and progress updates without changing your active chat model.',
      refresh: 'Refresh models',
      refreshShort: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading available models…',
      modelLabel: 'Analysis model',
      effortLabel: 'Reasoning effort',
      recommendedGroup: 'Recommended',
      defaultTitle: 'Automatic · DeepSeek-V4.1-Flash',
      defaultFallbackTitle: 'Automatic · Available lightweight model',
      defaultCurrentTag: 'Default',
      customTag: 'Custom',
      unavailableTag: 'Unavailable',
      defaultSelectedHint: 'Uses DeepSeek-V4.1-Flash (Low reasoning effort) by default when available.',
      customSelectedHint: 'Pinned route: ',
      unavailableBanner: 'Saved model ({saved}) is currently unavailable; analysis will temporarily fall back to {fallback}.',
      unavailableNoFallback: 'Saved model ({saved}) is unavailable and no fallback model was found. Configure a provider in Settings -> Models.',
      providerLoadError: 'Failed to load provider ({name}: {message})',
      searchPlaceholder: 'Search model name or ID…',
      searchClear: 'Clear search',
      emptyModels: 'No available models found. Add a provider or sign in under Settings -> Models.',
      noSearchResults: 'No matching models.',
      effortDefaultLowHint: 'Defaults to Low to balance JSON extraction accuracy and latency.',
      effortUnsupported: 'This model does not expose selectable reasoning levels.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard',
      resetDefault: 'Reset to default',
      savedOk: 'Saved. Applies on the next analysis run.',
      resetOk: 'Reset to default (DeepSeek-V4.1-Flash · Low).',
      loadFailed: 'Failed to load model settings: ',
      saveFailed: 'Failed to save: ',
      summary: 'Choose the model and reasoning effort for /things background task analysis.',
    },
  };

  function pickClientFlashEffort(reasoning) {
    const efforts = reasoning?.efforts;
    if (!Array.isArray(efforts) || !efforts.length) return '';
    if (efforts.some(e => e.id === 'low')) return 'low';
    if (efforts.some(e => e.id === 'off')) return 'off';
    if (reasoning.defaultEffort && efforts.some(e => e.id === reasoning.defaultEffort)) return reasoning.defaultEffort;
    return efforts[0].id;
  }

  function isClientFlashModel(model) {
    if (!model) return false;
    if (String(model.id || '').toLowerCase() === 'deepseek-flash') return true;
    return /(?:deepseek[-_.\s/]*v?4(?:\.1)?[-_.\s/]*flash|v?4\.1[-_.\s/]*flash)/i.test(`${model.id || ''} ${model.name || ''}`);
  }

  function sameDraft(a, b) {
    const modeA = a?.mode === 'custom' ? 'custom' : 'default';
    const modeB = b?.mode === 'custom' ? 'custom' : 'default';
    if (modeA !== modeB) return false;
    if ((a?.reasoningEffort || null) !== (b?.reasoningEffort || null)) return false;
    if (modeA === 'default') return true;
    return (a?.provider || null) === (b?.provider || null) && (a?.model || null) === (b?.model || null);
  }

  const REFRESH_FULL_MIN_WIDTH = 580;
  const REFRESH_SHORT_MIN_WIDTH = 380;

  function resolveRefreshButtonMode(width) {
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return 'full';
    if (width < REFRESH_SHORT_MIN_WIDTH) return 'icon';
    if (width < REFRESH_FULL_MIN_WIDTH) return 'short';
    return 'full';
  }

  function ThingsAnalysisSettings(props) {
    const [lang, setLang] = useState(() => bridge.getLang());
    const [payload, setPayload] = useState(null);
    const [draft, setDraft] = useState({ mode: 'default', provider: null, model: null, reasoningEffort: null });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [statusMsg, setStatusMsg] = useState('');
    const [menuOpen, setMenuOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [menuStyle, setMenuStyle] = useState(null);
    const [headWidth, setHeadWidth] = useState(null);

    const headRef = useRef(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);
    const groupsRef = useRef(null);
    const searchRef = useRef(null);
    const dirtyRef = useRef(false);
    const modelFieldId = useId();
    const effortFieldId = useId();
    const menuId = useId();
    const t = ANALYSIS_COPY[lang === 'en' ? 'en' : 'zh'];

    const serverConfig = payload?.config || { mode: 'default', provider: null, model: null, reasoningEffort: null };
    const dirty = Boolean(payload) && !sameDraft(draft, serverConfig);
    dirtyRef.current = dirty;

    const loadConfig = async ({ preserveDraft = false } = {}) => {
      setLoading(true);
      setErrorMsg('');
      try {
        const data = await bridge.getAnalysisConfig();
        setPayload(data);
        if (!preserveDraft || !dirtyRef.current) {
          setDraft({
            mode: data.config?.mode === 'custom' ? 'custom' : 'default',
            provider: data.config?.provider || null,
            model: data.config?.model || null,
            reasoningEffort: data.config?.reasoningEffort || null,
          });
        }
      } catch (err) {
        setErrorMsg(`${t.loadFailed}${err?.message || 'Error'}`);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      let alive = true;
      void loadConfig({ preserveDraft: false });
      const offLocale = bridge.subscribeLocale?.(nextLang => {
        if (!alive) return;
        setLang(nextLang);
        void loadConfig({ preserveDraft: true });
      });
      const onHostCatalogChange = () => {
        if (!alive) return;
        void loadConfig({ preserveDraft: true });
      };
      const offRemote = [];
      try {
        const remote = typeof ctx.get === 'function' ? ctx.get('remote') : null;
        if (typeof remote?.$on === 'function') {
          for (const evName of [
            'llm/adapters-updated',
            'llm/models-updated',
            'settings/document-updated',
            'credentials/record-updated',
            'credentials/reference-updated',
          ]) {
            try { offRemote.push(remote.$on(evName, onHostCatalogChange)); } catch { /* ignore */ }
          }
        }
      } catch { /* remote service optional without hard inject */ }
      const offReset = typeof ctx.on === 'function' ? ctx.on('connection/reset', onHostCatalogChange) : null;
      return () => {
        alive = false;
        offLocale?.();
        for (const off of offRemote) {
          try { off?.(); } catch { /* ignore */ }
        }
        try { offReset?.(); } catch { /* ignore */ }
      };
    }, []);

    useEffect(() => {
      if (!menuOpen || typeof document === 'undefined') return () => {};
      const updateRect = () => {
        const trigger = triggerRef.current;
        if (!trigger || typeof trigger.getBoundingClientRect !== 'function') return;
        const rect = trigger.getBoundingClientRect();
        const vh = typeof window !== 'undefined' ? (window.innerHeight || 800) : 800;
        const vw = typeof window !== 'undefined' ? (window.innerWidth || 1200) : 1200;
        const width = Math.max(260, Math.min(rect.width || 360, vw - 24));
        const left = Math.max(12, Math.min(rect.left, vw - width - 12));
        const spaceBelow = vh - rect.bottom - 14;
        const spaceAbove = rect.top - 14;
        const openUp = spaceBelow < 210 && spaceAbove > spaceBelow;
        const maxHeight = Math.max(160, Math.min(340, openUp ? spaceAbove : spaceBelow));
        setMenuStyle({
          position: 'fixed',
          left: `${Math.round(left)}px`,
          width: `${Math.round(width)}px`,
          maxHeight: `${Math.round(maxHeight)}px`,
          ...(openUp
            ? { bottom: `${Math.round(vh - rect.top + 6)}px`, top: 'auto' }
            : { top: `${Math.round(rect.bottom + 6)}px`, bottom: 'auto' }),
        });
      };
      updateRect();
      const onDown = event => {
        if (triggerRef.current?.contains?.(event.target)) return;
        if (menuRef.current?.contains?.(event.target)) return;
        setMenuOpen(false);
      };
      const onKey = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setMenuOpen(false);
          triggerRef.current?.focus?.();
        }
      };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      window.addEventListener?.('resize', updateRect);
      let stopObserve = null;
      if (typeof uiPrimitives?.observeStickyMenuGroups === 'function' && groupsRef.current) {
        stopObserve = uiPrimitives.observeStickyMenuGroups(groupsRef.current);
      }
      if (searchRef.current) {
        setTimeout(() => { try { searchRef.current?.focus?.(); } catch { /* ignore */ } }, 0);
      }
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener?.('resize', updateRect);
        try { stopObserve?.(); } catch { /* ignore */ }
      };
    }, [menuOpen]);

    useEffect(() => {
      if (props?.view === 'summary') return () => {};
      const el = headRef.current;
      if (!el) return () => {};
      const applyWidth = rawWidth => {
        const w = typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0
          ? rawWidth
          : (el.getBoundingClientRect?.().width || el.clientWidth || 0);
        if (w > 0) {
          const rounded = Math.round(w);
          setHeadWidth(prev => (prev === rounded ? prev : rounded));
        }
      };
      applyWidth();
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(entries => {
          applyWidth(entries?.[0]?.contentRect?.width);
        });
        observer.observe(el);
        return () => observer.disconnect();
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const onResize = () => applyWidth();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener?.('resize', onResize);
      }
      return () => {};
    }, [props?.view === 'summary']);

    const catalog = payload?.catalog || { groups: [], failures: [], defaultRoute: null };
    const availability = payload?.availability || { savedAvailable: true, fallbackRoute: null };
    const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
    const totalModels = groups.reduce((acc, g) => acc + (g.models?.length || 0), 0);
    const showSearch = totalModels > 4;

    const filteredGroups = useMemo(() => {
      const q = showSearch ? query.trim() : '';
      if (!q) return groups;
      const lower = q.toLowerCase();
      return groups
        .map(group => {
          const models = typeof uiPrimitives?.rankByName === 'function'
            ? uiPrimitives.rankByName(group.models || [], q)
            : (group.models || []).filter(m =>
                String(m.name || '').toLowerCase().includes(lower)
                || String(m.id || '').toLowerCase().includes(lower));
          return { ...group, models };
        })
        .filter(group => group.models.length > 0);
    }, [groups, query, showSearch]);

    if (props?.view === 'summary') {
      return t.summary;
    }

    const findGroupAndModel = (providerId, modelId) => {
      if (!providerId || !modelId) return null;
      const group = groups.find(g => g.id === providerId);
      const model = group?.models?.find(m => m.id === modelId);
      return group && model ? { group, model } : null;
    };

    const selectedEntry = draft.mode === 'custom' ? findGroupAndModel(draft.provider, draft.model) : null;
    const defaultRoute = catalog.defaultRoute || null;
    const effectiveReasoning = draft.mode === 'default'
      ? (defaultRoute?.reasoning || null)
      : (selectedEntry?.model?.reasoning || null);
    const efforts = effectiveReasoning?.efforts || [];
    const effectiveIsFlash = draft.mode === 'default'
      ? Boolean(defaultRoute?.isFlash)
      : isClientFlashModel(selectedEntry?.model);

    let effectiveEffort = '';
    if (efforts.length > 0) {
      if (draft.reasoningEffort && efforts.some(e => e.id === draft.reasoningEffort)) {
        effectiveEffort = draft.reasoningEffort;
      } else if (draft.mode === 'default' || effectiveIsFlash) {
        effectiveEffort = pickClientFlashEffort(effectiveReasoning);
      } else {
        effectiveEffort = effectiveReasoning.defaultEffort || efforts[0].id;
      }
    }

    const activeEffortMeta = efforts.find(e => e.id === effectiveEffort) || null;
    const isCustomMissing = draft.mode === 'custom' && draft.provider && draft.model && !selectedEntry && !loading;

    const triggerLabel = draft.mode === 'default'
      ? (defaultRoute
          ? (defaultRoute.isFlash ? t.defaultTitle : t.defaultFallbackTitle)
          : t.defaultTitle)
      : (selectedEntry ? selectedEntry.model.name : (draft.model || t.defaultTitle));
    const triggerProvider = draft.mode === 'default'
      ? (defaultRoute ? `${defaultRoute.modelName} · ${defaultRoute.providerName}` : '')
      : (selectedEntry ? selectedEntry.group.name : (draft.provider || ''));

    const handlePickDefault = () => {
      setDraft({ mode: 'default', provider: null, model: null, reasoningEffort: null });
      setStatusMsg('');
      setErrorMsg('');
      setMenuOpen(false);
    };

    const handlePickModel = (group, model) => {
      const nextEffort = model.reasoning
        ? (isClientFlashModel(model) ? pickClientFlashEffort(model.reasoning) : (model.reasoning.defaultEffort || model.reasoning.efforts[0]?.id || null))
        : null;
      setDraft({
        mode: 'custom',
        provider: group.id,
        model: model.id,
        reasoningEffort: nextEffort || null,
      });
      setStatusMsg('');
      setErrorMsg('');
      setMenuOpen(false);
    };

    const handleChangeEffort = nextEffort => {
      const normalized = nextEffort || null;
      setDraft(prev => {
        const nextVal = (prev.mode === 'default' && !serverConfig.reasoningEffort && normalized === pickClientFlashEffort(effectiveReasoning))
          ? null
          : normalized;
        return {
          ...prev,
          reasoningEffort: nextVal,
        };
      });
      setStatusMsg('');
      setErrorMsg('');
    };

    const handleSave = async () => {
      if (saving || loading) return;
      setSaving(true);
      setErrorMsg('');
      setStatusMsg('');
      try {
        const res = await bridge.saveAnalysisConfig(draft);
        setPayload(res);
        setDraft({
          mode: res.config?.mode === 'custom' ? 'custom' : 'default',
          provider: res.config?.provider || null,
          model: res.config?.model || null,
          reasoningEffort: res.config?.reasoningEffort || null,
        });
        setStatusMsg(t.savedOk);
      } catch (err) {
        setErrorMsg(`${t.saveFailed}${err?.message || 'Error'}`);
      } finally {
        setSaving(false);
      }
    };

    const handleDiscard = () => {
      if (saving) return;
      setDraft({
        mode: serverConfig.mode === 'custom' ? 'custom' : 'default',
        provider: serverConfig.provider || null,
        model: serverConfig.model || null,
        reasoningEffort: serverConfig.reasoningEffort || null,
      });
      setErrorMsg('');
      setStatusMsg('');
    };

    const canReset = draft.mode === 'custom'
      || draft.reasoningEffort !== null
      || serverConfig.mode === 'custom'
      || serverConfig.reasoningEffort !== null;

    const handleResetDefault = async () => {
      if (saving || loading || !canReset) return;
      if (serverConfig.mode === 'default' && !serverConfig.reasoningEffort) {
        setDraft({ mode: 'default', provider: null, model: null, reasoningEffort: null });
        setErrorMsg('');
        setStatusMsg('');
        return;
      }
      setSaving(true);
      setErrorMsg('');
      setStatusMsg('');
      try {
        const res = await bridge.saveAnalysisConfig({ mode: 'default', reasoningEffort: null });
        setPayload(res);
        setDraft({ mode: 'default', provider: null, model: null, reasoningEffort: null });
        setStatusMsg(t.resetOk);
      } catch (err) {
        setErrorMsg(`${t.saveFailed}${err?.message || 'Error'}`);
      } finally {
        setSaving(false);
      }
    };

    const renderButton = ({ label = null, variant = 'outline', disabled = false, icon = null, className = '', ariaLabel, title, onClick }) => {
      if (uiPrimitives?.Button) {
        const props = { variant, size: 'sm', disabled, icon, className: className || undefined, 'aria-label': ariaLabel, title, onClick };
        return label != null ? h(uiPrimitives.Button, props, label) : h(uiPrimitives.Button, props);
      }
      return h('button', { type: 'button', disabled, className: className || undefined, 'aria-label': ariaLabel, title, onClick }, label != null ? label : (icon || '↻'));
    };

    const renderTag = (text, tone = 'neutral') => {
      if (uiPrimitives?.Tag) {
        return h(uiPrimitives.Tag, { tone }, text);
      }
      return h('span', null, text);
    };

    const nativeValue = draft.mode === 'custom' && draft.provider && draft.model
      ? JSON.stringify([draft.provider, draft.model])
      : '__default__';

    const menuNode = menuOpen && uiPrimitives?.MenuSurface && createPortal && typeof document !== 'undefined' && document.body
      ? createPortal(
          h(uiPrimitives.MenuSurface, {
            ref: menuRef,
            id: menuId,
            className: 'at-dsh-model-menu',
            style: menuStyle || undefined,
            role: 'menu',
            'aria-label': t.modelLabel,
          },
            showSearch && h('div', { className: 'at-dsh-model-menu-search' },
              uiPrimitives.Input
                ? h(uiPrimitives.Input, {
                    ref: searchRef,
                    type: 'text',
                    role: 'searchbox',
                    'aria-label': t.searchPlaceholder,
                    placeholder: t.searchPlaceholder,
                    value: query,
                    onChange: ev => setQuery(ev.target.value),
                  })
                : h('input', {
                    ref: searchRef,
                    type: 'text',
                    placeholder: t.searchPlaceholder,
                    value: query,
                    onChange: ev => setQuery(ev.target.value),
                  }),
              query && h('button', {
                type: 'button',
                className: 'at-dsh-model-menu-search-clear',
                'aria-label': t.searchClear,
                onClick: () => {
                  setQuery('');
                  searchRef.current?.focus?.();
                },
              }, uiPrimitives.IconCloseFillRegular ? h(uiPrimitives.IconCloseFillRegular, { size: 13 }) : '×'),
            ),
            h('div', { ref: groupsRef, className: 'at-dsh-model-menu-groups scrollable' },
              (!query.trim()) && h(uiPrimitives.MenuGroup || 'section', { label: t.recommendedGroup },
                h('button', {
                  type: 'button',
                  role: 'menuitemradio',
                  'aria-checked': draft.mode === 'default',
                  className: 'at-dsh-model-menu-option',
                  onClick: handlePickDefault,
                },
                  h('span', { className: 'at-dsh-model-menu-option-copy' },
                    h('span', { className: 'at-dsh-model-menu-option-name' },
                      defaultRoute?.isFlash !== false ? t.defaultTitle : t.defaultFallbackTitle,
                    ),
                    defaultRoute && h('span', { className: 'at-dsh-model-menu-option-sub' },
                      `${defaultRoute.modelName} · ${defaultRoute.providerName}${defaultRoute.reasoningEffort ? ` · ${defaultRoute.reasoningEffort}` : ''}`,
                    ),
                  ),
                  h('span', { className: 'at-dsh-model-menu-check' },
                    draft.mode === 'default' && (uiPrimitives.IconCheckOutlineRegular ? h(uiPrimitives.IconCheckOutlineRegular, { size: 14 }) : '✓'),
                  ),
                ),
              ),
              filteredGroups.map(group => h(uiPrimitives.MenuGroup || 'section', { key: group.id, label: group.name },
                (group.models || []).map(model => {
                  const selected = draft.mode === 'custom' && draft.provider === group.id && draft.model === model.id;
                  const subText = model.name && model.name !== model.id ? model.id : '';
                  return h('button', {
                    key: `${group.id}:${model.id}`,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': selected,
                    className: 'at-dsh-model-menu-option',
                    onClick: () => handlePickModel(group, model),
                  },
                    h('span', { className: 'at-dsh-model-menu-option-copy' },
                      h('span', { className: 'at-dsh-model-menu-option-name' }, model.name || model.id),
                      subText && h('span', { className: 'at-dsh-model-menu-option-sub' }, subText),
                    ),
                    h('span', { className: 'at-dsh-model-menu-check' },
                      selected && (uiPrimitives.IconCheckOutlineRegular ? h(uiPrimitives.IconCheckOutlineRegular, { size: 14 }) : '✓'),
                    ),
                  );
                }),
              )),
              totalModels === 0 && h('p', { className: 'at-dsh-plugin-hint', style: { padding: '8px' } }, t.emptyModels),
              totalModels > 0 && filteredGroups.length === 0 && query.trim() && h('p', { className: 'at-dsh-plugin-hint', style: { padding: '8px' } }, t.noSearchResults),
            ),
          ),
          document.body,
        )
      : null;

    const savedMissingInfo = (!availability.savedAvailable && serverConfig.mode === 'custom' && serverConfig.model)
      ? (() => {
          const savedText = `${serverConfig.provider}/${serverConfig.model}`;
          if (availability.fallbackRoute) {
            const fbText = `${availability.fallbackRoute.modelName} (${availability.fallbackRoute.providerName})`;
            return t.unavailableBanner.replace('{saved}', savedText).replace('{fallback}', fbText);
          }
          return t.unavailableNoFallback.replace('{saved}', savedText);
        })()
      : '';

    const refreshMode = resolveRefreshButtonMode(headWidth);
    const refreshAriaLabel = loading ? t.refreshing : t.refresh;
    const refreshLabel = refreshMode === 'icon'
      ? null
      : (refreshMode === 'short' ? t.refreshShort : refreshAriaLabel);
    const refreshClassName = `at-dsh-plugin-refresh-btn${refreshMode === 'icon' ? ' is-icon-only' : ''}${loading ? ' is-loading' : ''}`;

    return h('div', { className: 'at-dsh-plugin-config', 'data-at-dsh-analysis-settings': '1' },
      h('div', { ref: headRef, className: 'at-dsh-plugin-head', 'data-refresh-mode': refreshMode },
        h('div', { className: 'at-dsh-plugin-head-copy' },
          h('h4', { className: 'at-dsh-plugin-title' }, t.title),
          h('p', { className: 'at-dsh-plugin-desc' }, t.subtitle),
        ),
        renderButton({
          label: refreshLabel,
          variant: 'outline',
          disabled: loading || saving,
          className: refreshClassName,
          ariaLabel: refreshAriaLabel,
          title: refreshAriaLabel,
          icon: uiPrimitives?.IconRefreshOutlineRegular ? h(uiPrimitives.IconRefreshOutlineRegular, { size: 13 }) : null,
          onClick: () => { void loadConfig({ preserveDraft: true }); },
        }),
      ),

      errorMsg && h('div', { className: 'at-dsh-plugin-banner at-dsh-plugin-banner-error', role: 'alert' }, errorMsg),
      savedMissingInfo && h('div', { className: 'at-dsh-plugin-banner at-dsh-plugin-banner-warn', role: 'status' }, savedMissingInfo),
      (catalog.failures || []).map(f => h('div', {
        key: f.id,
        className: 'at-dsh-plugin-banner at-dsh-plugin-banner-warn',
        role: 'status',
      }, t.providerLoadError.replace('{name}', f.name || f.id).replace('{message}', f.message || ''))),

      h('div', { className: 'at-dsh-plugin-field' },
        h('div', { className: 'at-dsh-plugin-field-head' },
          h('label', { className: 'at-dsh-plugin-label', htmlFor: modelFieldId }, t.modelLabel),
          draft.mode === 'default'
            ? renderTag(t.defaultCurrentTag, 'info')
            : isCustomMissing
              ? renderTag(t.unavailableTag, 'warning')
              : renderTag(t.customTag, 'neutral'),
        ),
        uiPrimitives?.MenuSurface && createPortal
          ? h('div', null,
              h('button', {
                ref: triggerRef,
                id: modelFieldId,
                type: 'button',
                className: 'at-dsh-model-trigger',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen,
                'aria-controls': menuOpen ? menuId : undefined,
                disabled: loading || saving,
                onClick: () => {
                  setQuery('');
                  setMenuOpen(prev => !prev);
                },
              },
                uiPrimitives.IconDataOutlineRegular && h(uiPrimitives.IconDataOutlineRegular, { size: 15, className: 'at-dsh-model-chevron' }),
                h('span', { className: 'at-dsh-model-trigger-main' },
                  h('span', { className: 'at-dsh-model-trigger-name' }, loading && !payload ? t.loading : triggerLabel),
                  triggerProvider && h('span', { className: 'at-dsh-model-trigger-provider' }, triggerProvider),
                ),
                uiPrimitives.IconChevronsUpDownOutlineRegular
                  ? h(uiPrimitives.IconChevronsUpDownOutlineRegular, { size: 14, className: 'at-dsh-model-chevron' })
                  : h('span', { className: 'at-dsh-model-chevron' }, '▾'),
              ),
              menuNode,
            )
          : h('select', {
              id: modelFieldId,
              className: 'at-dsh-model-select-native',
              value: nativeValue,
              disabled: loading || saving,
              onChange: ev => {
                const v = ev.target.value;
                if (v === '__default__') {
                  handlePickDefault();
                  return;
                }
                try {
                  const [pid, mid] = JSON.parse(v);
                  const hit = findGroupAndModel(pid, mid);
                  if (hit) handlePickModel(hit.group, hit.model);
                } catch { /* ignore */ }
              },
            },
              h('option', { value: '__default__' }, defaultRoute?.isFlash !== false ? t.defaultTitle : t.defaultFallbackTitle),
              isCustomMissing && h('option', { value: nativeValue, disabled: true }, `${draft.provider}/${draft.model} (${t.unavailableTag})`),
              groups.map(group => h('optgroup', { key: group.id, label: group.name },
                (group.models || []).map(model => h('option', {
                  key: `${group.id}:${model.id}`,
                  value: JSON.stringify([group.id, model.id]),
                }, model.name || model.id)),
              )),
            ),
        h('p', { className: 'at-dsh-plugin-hint' },
          draft.mode === 'default'
            ? t.defaultSelectedHint
            : `${t.customSelectedHint}${selectedEntry ? `${selectedEntry.group.name} / ${selectedEntry.model.name}` : `${draft.provider}/${draft.model}`}`,
        ),
      ),

      h('div', { className: 'at-dsh-plugin-field' },
        h('div', { className: 'at-dsh-plugin-field-head' },
          h('label', { className: 'at-dsh-plugin-label', htmlFor: effortFieldId }, t.effortLabel),
        ),
        efforts.length > 0
          ? (uiPrimitives?.SegmentedControl && efforts.length <= 6
              ? h(uiPrimitives.SegmentedControl, {
                  id: effortFieldId,
                  label: t.effortLabel,
                  value: effectiveEffort,
                  disabled: loading || saving,
                  options: efforts.map(e => ({
                    value: e.id,
                    label: e.name || e.id,
                    ...(e.description ? { title: e.description } : {}),
                  })),
                  onChange: handleChangeEffort,
                })
              : h('select', {
                  id: effortFieldId,
                  className: 'at-dsh-model-select-native',
                  value: effectiveEffort,
                  disabled: loading || saving,
                  onChange: ev => handleChangeEffort(ev.target.value),
                },
                  efforts.map(e => h('option', { key: e.id, value: e.id }, e.name || e.id)),
                ))
          : h('p', { className: 'at-dsh-plugin-hint' }, t.effortUnsupported),
        efforts.length > 0 && h('p', { className: 'at-dsh-plugin-hint' },
          draft.mode === 'default' && effectiveEffort === 'low'
            ? t.effortDefaultLowHint
            : (activeEffortMeta?.description || ''),
        ),
      ),

      h('div', { className: 'at-dsh-plugin-actions' },
        renderButton({
          label: saving ? t.saving : t.save,
          variant: 'primary',
          disabled: !dirty || saving || loading,
          onClick: () => { void handleSave(); },
        }),
        renderButton({
          label: t.discard,
          variant: 'outline',
          disabled: !dirty || saving,
          onClick: handleDiscard,
        }),
        renderButton({
          label: t.resetDefault,
          variant: 'outline',
          disabled: !canReset || saving || loading,
          onClick: () => { void handleResetDefault(); },
        }),
        statusMsg && h('span', { className: 'at-dsh-plugin-status', role: 'status' }, statusMsg),
      ),
    );
  }

  return {
    LeadingRingAnchor,
    ThingsTabTitle,
    ThingsSidebarTab,
    ThingsCommandCard,
    ThingsAnalysisSettings,
  };
}

function installSidebarRingHarness(bridge) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body || typeof installCodexSessionStatus !== 'function') {
    return () => {};
  }

  let reconcileTimer = 0;
  let tick = 0;
  const getMainApi = () => window.__dshSessionStatus || window.__codexSessionStatus || null;
  const clearTimer = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

  const scheduleReconcile = () => {
    if (reconcileTimer) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn => setTimeout(fn, 16));
    reconcileTimer = raf(() => {
      reconcileTimer = 0;
      tick = (tick + 1) % 1000000;
      try {
        document.body?.setAttribute?.('data-at-reconcile-tick', String(tick));
      } catch { /* ignore */ }
    });
  };
  window.__agentThingsScheduleReconcile = scheduleReconcile;

  const harness = {
    globalName: '__dshSessionStatus',
    supportsRequestCancellation: true,
    attributeFilter: ['data-row-key', 'aria-selected', 'data-at-dsh-leading-slot', 'data-at-reconcile-tick', 'hidden', 'style', 'class', 'data-ds-dark-theme'],
    startupRows: () => (typeof document !== 'undefined' ? [...document.querySelectorAll('[data-row-key^="session:"]')] : []),
    isRowSelected: row => row?.getAttribute?.('aria-selected') === 'true',
    async openPane({ entry } = {}) {
      const sid = entry?.threadId || sessionIdFromKey(entry?.key);
      bridge.openSidebarForSession(sid);
      return { delivered: true };
    },
    async locate({ entry, source, analysisMessage }) {
      const sid = entry?.threadId || sessionIdFromKey(entry?.key);
      const ui = getPresentation(bridge.getLang());
      if (analysisMessage) analysisMessage.textContent = ui?.strings?.locatingMessage || 'Locating...';
      const res = await bridge.locateAndJump(sid, source || {});
      if (res?.located) {
        if (analysisMessage) analysisMessage.textContent = res.message || ui?.strings?.locatedMessage || 'Located';
      } else {
        throw new Error(res?.message || ui?.strings?.locateNotFound || 'Source message not found');
      }
    },
    send(rawPayload) {
      Promise.resolve().then(() => bridge.handlePanelPayload(rawPayload, getMainApi()));
    },
    reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelBusy, isPanelEntry }) {
      if (typeof document === 'undefined') return;
      for (const [row, entry] of [...mounted.entries()]) {
        const slot = [...row.querySelectorAll('[data-at-dsh-leading-slot]')]
          .find(node => node.getAttribute('data-at-dsh-leading-slot') === entry.threadId);
        if (!row.isConnected || !slot || !entry.host.isConnected || !slot.contains(entry.host)) {
          if (isPanelEntry(entry)) {
            if (isPanelBusy?.()) continue;
            closePanel(false);
          }
          unmount(entry);
        }
      }

      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        const rowKey = row.getAttribute('data-row-key') || '';
        if (!rowKey.startsWith('session:')) continue;
        const sessionId = rowKey.slice('session:'.length);
        const slot = row.querySelector('[data-at-dsh-leading-slot]');
        if (!sessionId || !slot) continue;

        const key = keyForSession(sessionId);
        const title = resolveSessionTitleFromDom(sessionId) || getPresentation(bridge.getLang())?.strings?.sessionFallbackTitle || 'Session';
        const existing = mounted.get(row);
        if (existing) {
          if (existing.key !== key || existing.slot !== slot) {
            unmount(existing);
          } else {
            if (existing.title !== title) existing.title = title;
            paint(existing);
            continue;
          }
        }

        const { host, button, original } = attachHost(slot, false, null);
        const entry = {
          row,
          slot,
          host,
          button,
          original,
          key,
          threadId: sessionId,
          title,
          hovered: typeof row.matches === 'function' ? row.matches(':hover') : false,
          ringKey: '',
        };
        entry.onEnter = () => { entry.hovered = true; paintVisibility(entry); };
        entry.onLeave = () => { entry.hovered = false; paintVisibility(entry); };
        row.addEventListener('pointerenter', entry.onEnter);
        row.addEventListener('pointerleave', entry.onLeave);
        button.addEventListener('click', event => {
          event.stopPropagation();
          if (isPanelEntry(entry)) closePanel();
          else { closePanel(); openPanel(entry); }
        });
        mounted.set(row, entry);
        paint(entry);
      }
    },
    dispose() {
      // Keep shared global harness intact if an independent embedded card unmounts.
    },
  };

  const priorForeignApi = window.__codexSessionStatus;
  if (priorForeignApi && window.__sessionStatusHarness !== harness) {
    try { priorForeignApi.destroy?.(); } catch { /* ignore */ }
    if (window.__codexSessionStatus === priorForeignApi) {
      delete window.__codexSessionStatus;
    }
  }

  syncDocumentAccent(null, bridge.getLang());
  window.__sessionStatusHarness = harness;
  const version = typeof __AGENT_THINGS_VERSION__ === 'string' ? __AGENT_THINGS_VERSION__ : '';
  installCodexSessionStatus(version, null);
  const mountedApi = getMainApi();
  let wrappedMainApi = null;
  if (mountedApi) {
    mountedApi.receive(bridge.getUiSnapshot());
    bridge.setMainApi(mountedApi);
    // Guard against Antigravity DevTools injector targeting localhost embedded tabs (e.g. http://127.0.0.1:<port>/).
    if (window.__codexSessionStatus === mountedApi) {
      wrappedMainApi = {
        ...mountedApi,
        destroy() {
          try { mountedApi.destroy?.(); } catch { /* ignore */ }
          if (window.__codexSessionStatus === wrappedMainApi) {
            delete window.__codexSessionStatus;
          }
        },
        exportForReload: () => ({ busy: true }),
      };
      window.__codexSessionStatus = wrappedMainApi;
    }
  }

  const panelThemeObserver = typeof MutationObserver === 'function' && document.body
    ? new MutationObserver(() => {
        const nextTheme = syncDocumentAccent(null, bridge.getLang());
        for (const panelRoot of document.querySelectorAll('[data-codex-session-status-panel]')) {
          if (panelRoot.getAttribute('data-color-mode') !== nextTheme.mode) {
            panelRoot.setAttribute('data-color-mode', nextTheme.mode);
          }
        }
      })
    : null;
  panelThemeObserver?.observe(document.body, { childList: true, attributes: true, attributeFilter: ['data-ds-dark-theme', 'style', 'class'] });

  return () => {
    if (reconcileTimer) {
      clearTimer(reconcileTimer);
      reconcileTimer = 0;
    }
    panelThemeObserver?.disconnect();
    bridge.setMainApi(null);
    try { mountedApi?.destroy?.(); } catch { /* ignore */ }
    if (window.__codexSessionStatus === wrappedMainApi || window.__codexSessionStatus === mountedApi) {
      delete window.__codexSessionStatus;
    }
    if (window.__sessionStatusHarness === harness) {
      delete window.__sessionStatusHarness;
    }
    if (window.__agentThingsScheduleReconcile === scheduleReconcile) {
      delete window.__agentThingsScheduleReconcile;
    }
  };
}

const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace', 'sessions', 'connection'];

function apply(ctx) {
  ctx.effect(() => injectHostLayoutStyles(), 'agent-things: host layout styles');

  const bridge = createDshBridge(ctx);
  bridge.start();
  ctx.effect(() => () => bridge.dispose(), 'agent-things: client bridge');

  if (typeof globalThis !== 'undefined') {
    globalThis.__agentThingsLang = bridge.getLang();
    const create = getPresentationFactory();
    if (create) globalThis.__agentThingsPresentation = create(bridge.getLang());
  }

  ctx.effect(() => installSidebarRingHarness(bridge), 'agent-things: session-status overlay');

  ctx.effect(() => ctx.locale.register(NS, { zh: {}, en: {} }), 'agent-things: locale');

  if (typeof ctx.locale?.subscribe === 'function') {
    ctx.effect(() => ctx.locale.subscribe(() => {
      const lang = bridge.getLang();
      if (typeof globalThis !== 'undefined') {
        globalThis.__agentThingsLang = lang;
        const create = getPresentationFactory();
        if (create) globalThis.__agentThingsPresentation = create(lang);
      }
      bridge.notifyLocale();
      void bridge.refreshSummary();
    }), 'agent-things: locale watch');
  }

  ctx.on('connection/reset', () => {
    bridge.reconnect();
  });

  const {
    LeadingRingAnchor,
    ThingsTabTitle,
    ThingsSidebarTab,
    ThingsCommandCard,
    ThingsAnalysisSettings,
  } = makeUiComponents(ctx, bridge);

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_PROVIDER_ID,
    kind: TAB_KIND,
    multiple: false,
    priority: 'extension',
    title: () => 'Things',
    guide: [{
      id: 'things',
      order: 15,
      title: () => 'Things',
      description: () => getPresentation(bridge.getLang())?.strings?.panelAriaPattern?.replace('{title}', '')?.trim() || 'Session task progress & extracted to-dos',
      icon: () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 2, strokeOpacity: 0.25 }),
        h('circle', { cx: 12, cy: 12, r: 9, stroke: '#548eea', strokeWidth: 2, strokeDasharray: '42 60', strokeLinecap: 'round', transform: 'rotate(-90 12 12)' }),
      ),
    }],
  }), 'agent-things: right sidebar tab type');

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_PROVIDER_ID,
    locale: NS,
    inject: sessionId => ({ injectedSessionId: sessionId }),
  }, ThingsSidebarTab)), 'agent-things: right sidebar tab body');

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TAB_PROVIDER_ID,
    locale: NS,
    inject: sessionId => ({ injectedSessionId: sessionId }),
  }, ThingsTabTitle)), 'agent-things: right sidebar tab title');

  ctx.effect(() => ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
    name: 'sidebar.session.row.leading',
    id: 'agent-things.row-leading',
    order: 5,
    locale: NS,
  }, LeadingRingAnchor)), 'agent-things: session row leading ring');

  ctx.effect(() => ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'things',
    locale: NS,
  }, ThingsCommandCard)), 'agent-things: /things command view');

  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'agent-things-dsh',
    locale: NS,
  }, ThingsAnalysisSettings)), 'agent-things: bundle config panel');
}

module.exports = {
  inject,
  apply,
  createDshBridge,
  makeUiComponents,
  composeSidebarHtml,
  readHostTheme,
  syncDocumentAccent,
  injectHostLayoutStyles,
  isDarkThemeActive,
};
