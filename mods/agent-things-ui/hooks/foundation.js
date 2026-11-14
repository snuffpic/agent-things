// Generated from src/ui-foundation.cjs. Edit the shared source.
const presentation = (function createPresentation() {
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
})();
export const { labels, colors, taskLabels, layout, accent, progressValue, progressState, draftTransition, analysisDisabled } = presentation;
