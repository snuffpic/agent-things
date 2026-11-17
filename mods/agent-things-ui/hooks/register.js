import { progressState } from './progress.js';
import { draftTransition, forLang } from './foundation.js';
import { CONTENT_WIDTH, NOTE_LINE_WIDTH, colors, date, svg, headerRing, headerTitleSpec, statusBadgeSvg, timeTextSvg, scoreSvg, bar, preview, wrapText, measureButtonWidth, measureClearWidth, paneIconWidth } from './presentation.js';

let sessionId, cwd, home, data = null, projectGit = null, updateInfo = null, activeLang = 'zh', configLangLoaded = false;
let mode = 'overview', draft = null, baseRevision = 0, busy = false, error = '', source = null, sourceMode = 'overview';
let conflict = false, loading = false, refreshPromise = null;
let expanded = false, noteOpen = false, seen = false, sequence = 0, paneRequested = false, waitLoop = 0;
const PANE = 'agent-things', PANE_TITLE = 'Agent Things', PINNED = 'pane:pinned';
const SIDEBAR_HINT_DISMISSED = 'sidebar-hint:dismissed';
const FIRST_PAINT_WAIT_MS = 80;

const ui = () => forLang(activeLang);
const t = (key, vars) => ui().t(key, vars);

async function request($, action, fields = {}) {
  home ||= await $.env.get('HOME');
  const auth = JSON.parse(await $.fs.read(`${home}/Library/Application Support/AgentThings/claude/manual-state.json.http.json`));
  const response = await $.http.fetch(`http://127.0.0.1:${auth.port}/inline`, {
    method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, sessionId, cwd, requestId: `inline-${sessionId}-${++sequence}`, ...fields }),
  });
  const value = JSON.parse(response.text);
  if (value?.lang === 'en' || value?.lang === 'zh') activeLang = value.lang;
  if (!response.ok || value.error) throw Object.assign(new Error(value.error || t('claudeInlineOffline')), value.errorInfo || {});
  return value;
}
function receive(value) {
  if (value?.lang === 'en' || value?.lang === 'zh') activeLang = value.lang;
  if ('updateInfo' in value) { updateInfo = value.updateInfo; return; }
  if ((!data && 'revision' in value) || (data && value.revision >= data.revision)) data = value;
  if (value.paneRequested) paneRequested = true;
  if (value.projectGit) projectGit = value.projectGit;
  if (value.source) source = value.source;
}
async function refresh($, includeGit = false) {
  receive(await request($, 'read', { includeGit }));
}
// 在右侧侧栏打开卡片，并记为常驻：之后每个会话启动时自动打开，直到用户在侧栏关闭它。
async function openPane($) {
  seen = true; paneRequested = false;
  await $.store.set(PINNED, true);
  await $.ui.open({ id: PANE, title: PANE_TITLE });
}
async function serveRequestedPane($) {
  if (paneRequested) await openPane($);
}
// 同会话多入口同步：向本机后台挂起一个按会话的等待请求。本会话账本变化（任一入口保存、清除、
// 分析开始/进度/成功/失败）或侧栏弹窗请求「在侧栏打开」时立即返回；断开后恢复时补读一次。
// 草稿与基准修订号不受刷新影响；receive 只接受不旧于当前的数据，乱序回复不会把界面退回旧版本。
async function watchChanges($) {
  const token = ++waitLoop;
  if (refreshPromise) await refreshPromise.catch(() => {});
  let offline = !data;
  while (token === waitLoop) {
    try {
      if (offline) { await refresh($); offline = false; error = ''; $.ui.invalidate('ui.render'); await serveRequestedPane($); }
      const value = await request($, 'watch', { since: data?.revision, waitMs: 20000 });
      if (token !== waitLoop) return;
      if (value.changed) { await refresh($); $.ui.invalidate('ui.render'); await serveRequestedPane($); }
      if (value.paneRequested) await openPane($);
    } catch (failure) {
      if (token !== waitLoop) return;
      offline = true;
      // 旧版后台没有 watch：退回每 2 秒补读。
      await $.clock.sleep(/(未知卡片操作|Unknown card action)/i.test(failure.message) ? 2000 : 1000);
    }
  }
}
async function remember($) {
  await $.store.set(`view:${sessionId}`, { mode, draft, baseRevision, expanded, conflict });
}
async function view($, next) {
  mode = next; error = '';
  await remember($); $.ui.invalidate('ui.render');
}
async function edit($) {
  if (!draft) {
    const record = data?.record;
    const state = draftTransition({}, { type: 'begin', record });
    draft = state.draft; baseRevision = state.baseRevision;
  }
  if (!projectGit) {
    void refresh($, true).then(() => $.ui.invalidate('ui.render')).catch(() => {});
  }
  await view($, 'edit');
}
async function setDraft($, patch) {
  draft = draftTransition({ draft, baseRevision }, { type: 'patch', patch }).draft;
  $.ui.invalidate('ui.render');
  await remember($);
}
async function setProgress($, value) {
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 100)) {
    error = t('invalidProgressError'); $.ui.invalidate('ui.render'); return;
  }
  await setDraft($, { progress: value, state: progressState(draft.state, value) });
}
async function operate($, action, fields = {}) {
  if (busy) return;
  busy = true; error = ''; $.ui.invalidate('ui.render');
  try {
    receive(await request($, action, fields));
    if (action === 'save' || action === 'clear') { const state = draftTransition({ draft, baseRevision }, { type: action === 'clear' ? 'cleared' : 'saved', revision: data?.record?.revision || 0 }); draft = state.draft; baseRevision = state.baseRevision; conflict = false; mode = 'overview'; await remember($); }
    if (action === 'source') {
      let located;
      try { located = await request($, 'locate', { taskId: fields.taskId }); }
      catch (failure) { sourceMode = mode; mode = 'source'; throw failure; }
      if (!located.navigation?.located) {
        sourceMode = mode; mode = 'source'; error = located.navigation?.message || t('locateUnavailable');
      }
    }
  } catch (failure) {
    error = failure.message;
    if (failure.code === 'REVISION_CONFLICT' && draft) { conflict = true; await remember($); }
  }
  finally { busy = false; $.ui.invalidate('ui.render'); }
}
async function rebaseDraft($) {
  if (busy || !draft) return;
  busy = true;
  try {
    await refresh($);
    const state = draftTransition({ draft, baseRevision, conflict }, { type: 'rebase', revision: data?.session?.recordRevision ?? data?.record?.revision ?? 0 });
    baseRevision = state.baseRevision; conflict = false;
    error = t('conflictReloadedFeedback');
    await remember($);
  } catch (failure) { error = failure.message; }
  finally { busy = false; $.ui.invalidate('ui.render'); }
}
async function ensureContext($) {
  if (!configLangLoaded) {
    configLangLoaded = true;
    try {
      home ||= await $.env.get('HOME');
      const cfg = JSON.parse(await $.fs.read(`${home}/Library/Application Support/AgentThings/config.json`));
      if (cfg?.lang === 'en' || cfg?.lang === 'zh') activeLang = cfg.lang;
    } catch {}
  }
  if (sessionId) return;
  sessionId = await $.session.id(); cwd = await $.session.cwd();
  const saved = await $.store.get(`view:${sessionId}`);
  if (saved) {
    mode = ['overview', 'edit', 'completed'].includes(saved.mode) ? saved.mode : 'overview';
    draft = saved.draft || null; baseRevision = saved.baseRevision || 0;
    expanded = Boolean(saved.expanded); conflict = Boolean(saved.conflict && draft);
  }
}
function startRefresh($, includeGit = false) {
  if (refreshPromise) return refreshPromise;
  if (!data) error = '';
  refreshPromise = (async () => {
    try {
      await refresh($, includeGit);
      error = '';
      await serveRequestedPane($);
    } catch (failure) {
      if (!data) error = failure.message;
    } finally {
      loading = false;
      refreshPromise = null;
      $.ui.invalidate('ui.render');
    }
  })();
  return refreshPromise;
}
async function raceWithin($, promise, timeoutMs) {
  await Promise.race([promise, $.clock.sleep(timeoutMs)]);
}
async function initialize($) {
  await ensureContext($);
  void startRefresh($);
  $.clock.after(0, async () => {
    try { receive(await request($, 'update-info')); } catch { /* Upgrade discovery is retried by its explicit button. */ }
    $.ui.invalidate('ui.render');
  });
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await initialize($);
    await $.command.register({ name: 'things', description: t('cardCommandDescription'), immediate: true });
    if (paneRequested || await $.store.get(PINNED)) { seen = true; paneRequested = false; void $.ui.open({ id: PANE, title: PANE_TITLE }); }
    void watchChanges($);
    // 账本同步由 watchChanges 负责；这里只跟进升级进度。
    $.clock.every(2000, async () => {
      const updating = ['queued', 'checking', 'downloading', 'waiting', 'installing'].includes(updateInfo?.update?.stage);
      if (!seen || busy || !updating) return;
      try { receive(await request($, 'update-info')); } catch (failure) { error = failure.message; }
      $.ui.invalidate('ui.render');
    });
    return next(e);
  });
  on('command.run', { command: 'things' }, async ($) => {
    await ensureContext($);
    seen = true;
    const pending = startRefresh($);
    if (!data) {
      loading = true;
      await raceWithin($, pending, FIRST_PAINT_WAIT_MS);
    }
    return { text: t('cardCommandReply') };
  });
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set(PINNED, false).catch(() => {});
    return next(e);
  });
  on('ui.message', async ($, e, next) => {
    if (e.component !== 'CommandOutput' && !(e.component === 'Pane' && e.requestId === PANE)) return next(e);
    if (e.element === 'progress-slider' && mode === 'edit' && e.data && 'value' in e.data && (e.data.value === null || Number.isInteger(e.data.value))) {
      await setProgress($, e.data.value);
      return {};
    }
    if (e.element === 'analyze' && e.data?.action === 'analyze') {
      if (!data?.timeline?.some(event => event.status === 'pending')) await operate($, 'analyze');
      return {};
    }
    if (e.element === 'open-pane' && e.data?.action === 'open-pane') { await openPane($); return {}; }
    if (e.element === 'clear' && e.data?.action === 'clear') { await operate($, 'clear', { expectedRevision: data?.record?.revision || 0 }); return {}; }
    if (e.element === 'save' && e.data?.action === 'save' && mode === 'edit') {
      await operate($, 'save', { expectedRevision: baseRevision, record: draft }); return {};
    }
    return next(e);
  });
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== 'things' && e.props.command !== '/things') return next(e);
    return draw($, e, false);
  });
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => draw($, e, true));
}

async function draw($, e, inPane) {
    seen = true;
    const { labels, taskLabels, strings } = ui();
    const { Box, Text, Button, Input, Svg, Client } = $.ui.resolve(e);
    const record = data?.record?.state ? data.record : null;
    const tasks = data?.analysis?.ledger?.tasks || [];
    const remaining = tasks.filter(task => task.status !== 'done'), completed = tasks.filter(task => task.status === 'done');
    const active = data?.timeline?.findLast(event => event.status === 'pending');
    const color = colors[(mode === 'edit' ? draft?.state : record?.state)] || colors.unstarted;
    const rawCols = Number(e?.props?.bodyColumns ?? e?.viewport?.columns);
    const paneCols = Number.isFinite(rawCols) && rawCols > 0 ? Math.max(12, rawCols - 2.2) : 32;
    const viewWidth = inPane ? Math.max(130, Math.round(paneCols * 9.3)) : CONTENT_WIDTH;
    const text = (value, props = {}) => Text({ children: [String(value)], ...props });
    const button = (key, label, callback, props = {}) => Button({ key, label, onPress: callback, ...props });
    const row = children => Box({ flexDirection: 'row', alignItems: 'center', width: '100%', gap: 1, children });
    const rule = () => Svg({ source: svg(`<path d="M0 1H${viewWidth}" stroke="currentColor" opacity=".14"/>`, viewWidth, 2), alt: t('dividerAlt'), width: 4096, height: 2 });
    const trailing = child => Box({ flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', children: [child] });
    const colWidthFor = (px, minCols = 8.6) => Math.max(minCols, Math.ceil((px / 9.3) * 10) / 10);
    const control = (key, props, width = 8.6) => Box({ width, children: [
      Client({ key, module: './controls.js', width: '100%', height: props.action === 'clear' ? 1.4 : 1.8, props }),
    ] });
    const statusBlockWidth = Math.max(56, viewWidth - 96 - 12);
    const statusRow = ({ dotColor, dotOpacity = 1, label, timeLabel = '', labelOpacity = 1, score, scoreAlt, scoreOpacity = 1 }) => row([
      Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, gap: 0, children: [
        Svg({ source: statusBadgeSvg(dotColor, label, statusBlockWidth, dotOpacity, labelOpacity), alt: label, width: statusBlockWidth, height: 18 }),
        ...(timeLabel ? [Svg({ source: timeTextSvg(timeLabel, statusBlockWidth), alt: timeLabel, width: statusBlockWidth, height: 18 })] : []),
      ] }),
      Box({ flexShrink: 0, alignItems: 'flex-end', children: [
        Svg({ source: scoreSvg(score, scoreOpacity), alt: scoreAlt, width: 96, height: 48 }),
      ] }),
    ]);
    const taskLabelWidth = Math.max(60, Math.min(200, viewWidth - 28));
    const unknownTaskLabel = taskLabels.unknown || t('taskLabels')?.unknown || (activeLang === 'en' ? 'Unknown status' : '状态未知');
    const taskRow = task => Box({ key: `task-${task.id}`, position: 'relative', flexDirection: 'row', alignItems: 'center', width: '100%', gap: 1, children: [
      text(task.status === 'done' ? '✓' : '○', { color: task.status === 'done' ? colors.completed : colors.unfinished }),
      Box({ flexDirection: 'column', flexGrow: 1, minWidth: 0, children: [text(task.summary || task.title), Svg({ source: svg(`<text x="0" y="11" font-size="10" fill="currentColor" opacity=".68">${taskLabels[task.status] || unknownTaskLabel}</text>`, taskLabelWidth, 15, 'xMinYMid meet'), alt: taskLabels[task.status] || unknownTaskLabel, width: taskLabelWidth, height: 15 })] }),
      Box({ position: 'absolute', right: 0, top: 0, height: '100%', justifyContent: 'center', alignItems: 'flex-end', display: 'none', hover: { display: 'flex' }, children: [button(`source-${task.id}`, t('viewSource'), () => operate($, 'source', { taskId: task.id }), { plain: true })] }),
    ] });
    const content = [];
    const skeletonLoading = !data && (loading || Boolean(refreshPromise));
    const titleReserve = inPane ? 0 : 34;
    const titleMaxWidth = Math.max(64, viewWidth - 42 - titleReserve);
    const titleText = data?.title || t('fallbackShortTitle');
    const titleSpec = headerTitleSpec(titleText, titleMaxWidth);
    content.push(Box({ flexDirection: 'row', alignItems: 'flex-start', width: '100%', gap: 1, children: [
      Box({ flexShrink: 0, children: [Svg({ source: headerRing(record, Boolean(active || skeletonLoading)), alt: `${record?.progress ?? t('progressUnrecordedWord')}%`, width: 32, height: 34, isInteractive: true })] }),
      Box({ flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Svg({ source: titleSpec.source, alt: titleText, width: titleSpec.width, height: titleSpec.height })] }),
    ] }));
    if (!data && mode === 'overview') {
      if (skeletonLoading) {
        content.push(statusRow({ dotColor: 'currentColor', dotOpacity: '.35', label: t('loadingTitle'), labelOpacity: '.82', score: null, scoreAlt: t('loadingAlt'), scoreOpacity: '.35' }));
        content.push(Svg({ source: bar(0, colors.unstarted, viewWidth), alt: t('loadingAlt'), width: 4096, height: 4 }));
        const barW1 = Math.max(40, Math.round(viewWidth * 0.53));
        const barW2 = Math.max(40, Math.round(viewWidth * 0.77));
        const barW3 = Math.max(40, Math.round(viewWidth * 0.65));
        content.push(Svg({ source: svg(`<rect x="0" y="2" width="${barW1}" height="10" rx="5" fill="currentColor" opacity=".12"/><rect x="0" y="20" width="${barW2}" height="10" rx="5" fill="currentColor" opacity=".08"/><rect x="0" y="38" width="${barW3}" height="10" rx="5" fill="currentColor" opacity=".08"/>`, viewWidth, 52, 'xMinYMid meet'), alt: t('loadingTasksAlt'), width: viewWidth, height: 52 }));
        content.push(text(t('loadingSubtitle'), { size: 'footnote', dimColor: true }));
      } else {
        content.push(statusRow({ dotColor: 'currentColor', dotOpacity: '.45', label: t('notLoadedTitle'), score: null, scoreAlt: t('notLoadedAlt'), scoreOpacity: '.45' }));
        content.push(Svg({ source: bar(0, colors.unstarted, viewWidth), alt: t('notLoadedAlt'), width: 4096, height: 4 }));
        content.push(row([button('retry-load', t('retryLoadBtn'), () => { loading = true; error = ''; $.ui.invalidate('ui.render'); void startRefresh($); })]));
      }
    } else if (mode === 'source' && source) {
      content.push(button('source-back', t('backPlain'), () => view($, sourceMode), { plain: true }));
      content.push(text(source.title, { bold: true }), text(date(source.occurredAt), { dimColor: true }));
      content.push(text(source.text || source.locator || t('emptySourceText')));
    } else if (mode === 'completed') {
      content.push(row([text(t('completedHeading'), { bold: true }), trailing(button('completed-back', t('backLabel'), () => view($, 'overview'), { plain: true, dimColor: true }))]));
      content.push(...completed.map(taskRow));
      if (!completed.length) content.push(text(t('emptyCompleted'), { dimColor: true }));
    } else if (mode === 'edit' && draft) {
      content.push(Box({ paddingTop: 1.5, paddingBottom: 1, children: [text(t('editHeading'), { bold: true })] }));
      for (const [state, label] of Object.entries(labels)) {
        if (state === 'pushed' && !projectGit?.hasRemote) continue;
        content.push(Box({ flexDirection: 'row', width: '100%', alignItems: 'center', gap: 1, paddingX: 1, paddingY: .75,
          borderStyle: 'round', borderColor: '#00000000', backgroundColor: draft.state === state ? '#8899aa24' : undefined,
          children: [Box({ flexShrink: 0, children: [Svg({ source: svg(`<circle cx="6" cy="7" r="5" fill="none" stroke="${colors[state]}" stroke-width="1.5"/>${draft.state === state ? `<circle cx="6" cy="7" r="2.5" fill="${colors[state]}"/>` : ''}`, 12, 14, 'xMidYMid meet'), alt: label, width: 12, height: 14 })] }),
            button(`state-${state}`, label, () => setDraft($, {
              state, progress: state === 'unstarted' ? 0 : state === 'completed' || state === 'pushed' ? 100 : draft.state === 'unfinished' ? draft.progress : null,
            }), { plain: true })] }));
      }
      content.push(Box({ paddingTop: 2, children: [Client({ key: 'progress-slider', module: './controls.js', width: '100%', height: 5.5,
        props: { kind: 'slider', value: draft.progress, state: draft.state, width: viewWidth, progressLabel: t('progressLabel'), unrecordedWord: t('progressUnrecordedWord') } })] }));
      content.push(row([trailing(button('clear-percentage', t('clearValueBtn'), () => setProgress($, null), { plain: true, dimColor: true }))]));
      content.push(text(t('notesLabel'), { size: 'footnote', dimColor: true }));
      content.push(Input({ key: 'note-input', value: draft.note, rows: 3, placeholder: t('notePlaceholder'),
        onInput: value => setDraft($, { note: value }), onSubmit: value => setDraft($, { note: value }) }));
      const saveLabel = busy ? t('savingBtn') : t('saveBtn');
      const saveWidthCols = colWidthFor(measureButtonWidth(saveLabel), 8.6);
      content.push(row([trailing(button('cancel', t('cancelBtn'), async () => { draft = null; await view($, 'overview'); }, { plain: true })),
        control('save', { kind: 'button', action: 'save', disabled: busy, label: saveLabel, accent: data?.accent || null }, saveWidthCols)]));
      if (conflict) content.push(button('resolve-conflict', t('resolveConflictBtn'), () => rebaseDraft($), { plain: true }));
    } else {
      content.push(statusRow({ dotColor: color, label: labels[record?.state] || t('unrecordedSummary'), timeLabel: date(record?.updatedAt), score: record?.progress, scoreAlt: `${record?.progress ?? t('progressUnrecordedWord')}%` }));
      content.push(Svg({ source: bar(record?.progress, color, viewWidth), alt: t('currentProgressAlt'), width: 4096, height: 4 }));
      content.push(row([text(tasks.length ? t('totalsPattern', { done: completed.length, total: tasks.length }) : t('noTasksYet'), { size: 'footnote', dimColor: true }), trailing(text(record?.source === 'analysis' ? t('sourceAuto') : record ? t('sourceManual') : '', { size: 'footnote', dimColor: true }))]));
      const noteMaxWidth = inPane ? Math.max(100, viewWidth - 16) : NOTE_LINE_WIDTH;
      const wrappedNote = record?.note ? wrapText(record.note, noteMaxWidth) : '';
      const previewNote = record?.note ? preview(record.note, noteMaxWidth) : '';
      if (record?.note) content.push(Box({ width: '100%', flexDirection: 'column', children: [text(noteOpen ? wrappedNote : previewNote, { dimColor: true })] }));
      if (record?.note && previewNote !== wrappedNote) content.push(button('expand-note', noteOpen ? t('collapse') : t('expandAll'), () => { noteOpen = !noteOpen; $.ui.invalidate('ui.render'); }, { plain: true, dimColor: true }));
      const analyzeLabel = active ? t('btnUpdating') : t('btnUpdate');
      const analyzeWidthCols = colWidthFor(measureButtonWidth(analyzeLabel), 8.6);
      const clearLabel = t('btnClear');
      const clearWidthCols = colWidthFor(measureClearWidth(clearLabel), 6.9);
      content.push(row([
        control('analyze', { kind: 'button', action: 'analyze', disabled: Boolean(active) || busy, label: analyzeLabel, accent: data?.accent || null }, analyzeWidthCols),
        button('edit', t('btnAdjust'), () => edit($), { plain: true, dimColor: true }),
        trailing(control('clear', { kind: 'button', action: 'clear', disabled: busy, label: clearLabel }, clearWidthCols)),
      ]));
      if (active) content.push(text(strings.analysisStages?.[active.stage] || strings.analysisStages?.analyzing || t('btnUpdating'), { dimColor: true }));
      const failed = data?.timeline?.at(-1);
      if (!active && failed?.status === 'failed') content.push(text(`${t('analysisFailedPrefix')}${failed.error || t('analysisFailedRetry')}`, { color: '#D43F3F' }));
      content.push(rule());
      const remainingHead = [text(t('remainingHeadingPattern', { count: remaining.length }), { bold: true })];
      if (remaining.length > 3) remainingHead.push(trailing(button('expand-remaining', expanded ? t('collapseArrow') : t('showAllCountPattern', { count: remaining.length }), async () => { expanded = !expanded; await remember($); $.ui.invalidate('ui.render'); }, { plain: true, dimColor: true })));
      content.push(row(remainingHead));
      content.push(...(expanded ? remaining : remaining.slice(0, 3)).map(taskRow));
      if (!remaining.length) content.push(text(tasks.length ? t('emptyNoRemaining') : t('emptyNoTasks'), { dimColor: true }));
      content.push(rule());
      content.push(row([button('completed-label', t('completedHeading'), () => view($, 'completed'), { plain: true }), trailing(button('completed', t('countArrowPattern', { count: completed.length }), () => view($, 'completed'), { plain: true, dimColor: true }))]));
      content.push(rule());
      content.push(row([button('note-label', t('notesLabel'), () => edit($), { plain: true }), trailing(button('edit-note', record?.note ? t('editLabel') : t('addLabel'), () => edit($), { plain: true, dimColor: true }))]));
      const updating = ['queued', 'checking', 'downloading', 'waiting', 'installing'].includes(updateInfo?.update?.stage);
      if (updating) content.push(text(t('upgradingShort'), { dimColor: true }));
      else if (updateInfo?.available) content.push(row([text(t('updateAvailablePattern', { version: updateInfo.latestVersion || '' })), trailing(button('upgrade', t('upgradeBtn'), () => operate($, 'upgrade')))]));
      if (updateInfo?.update?.stage === 'failed') content.push(text(`${t('updateFailedLabel')}: ${updateInfo.update.error || updateInfo.command}`, { color: '#D43F3F' }));
    }
    if (error) content.push(Box({ width: '100%', flexDirection: 'column', children: [text(wrapText(error, inPane ? Math.max(100, viewWidth - 16) : NOTE_LINE_WIDTH), { color: '#D43F3F' })] }));
    if (mode === 'edit' && (conflict || error.includes('其他窗口') || error.includes('another window'))) content.push(button('reload-version', t('resolveConflictBtn'), async () => {
      try { await refresh($); baseRevision = data.record?.revision || 0; error = ''; await remember($); }
      catch (failure) { error = failure.message; }
      $.ui.invalidate('ui.render');
    }));
    if (busy) content.push(text(t('processing'), { dimColor: true }));
    if (mode === 'overview' && !await $.store.get(SIDEBAR_HINT_DISMISSED)) {
      content.push(rule(), text(t('sidebarHintText'), { size: 'footnote', dimColor: true }));
      content.push(row([trailing(button('dismiss-sidebar-hint', t('dismissHint'), async () => {
        await $.store.set(SIDEBAR_HINT_DISMISSED, true);
        $.ui.invalidate('ui.render');
      }, { plain: true, dimColor: true }))]));
    }
    if (inPane) return Box({ key: 'things-pane', flexDirection: 'column', gap: 1, paddingX: 1, paddingTop: 1, paddingBottom: 1.75, width: '100%', children: content });
    // 右上角「在侧栏打开」图标，与侧栏弹窗关闭按钮左侧的图标一致。
    const openPaneLabel = t('openInSidebar');
    const openPaneWidthCols = colWidthFor(paneIconWidth(openPaneLabel), 11.2);
    content.push(Box({ position: 'absolute', top: 0, right: 1, paddingTop: 0.5, width: openPaneWidthCols, height: 1.9, children: [
      Client({ key: 'open-pane', module: './controls.js', width: '100%', height: 1.4, props: { kind: 'icon', action: 'open-pane', label: openPaneLabel } }),
    ] }));
    return Box({ key: 'things-card', position: 'relative', flexDirection: 'column', gap: 1, paddingX: 2.5, paddingTop: 2.75, paddingBottom: 1.75, width: 36.5, borderStyle: 'round', borderDimColor: true, children: content });
}
