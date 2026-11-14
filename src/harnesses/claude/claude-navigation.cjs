'use strict';

// Runs in Claude's main renderer world, using its own transcript ref and pager.
async function locateClaudeMessage({ threadId, itemId, timeoutMs = 15000 }) {
  const deadline = Date.now() + timeoutMs;
  const wait = () => new Promise(resolve => setTimeout(resolve, 50));
  const scope = () => {
    const composer = document.querySelector(`[data-session-id="${CSS.escape(threadId)}"]`);
    return composer?.closest('.epitaxy-chat-panel') || composer;
  };
  if (!scope()) {
    const row = document.querySelector(`[data-row-key="${CSS.escape('code:' + threadId)}"]`);
    const button = row?.querySelector('[data-row-main-button]');
    if (!button) return { located: false, reason: 'session_not_visible' };
    button.click();
    while (!scope() && Date.now() < deadline) await wait();
  }
  const find = (root, id) => root?.querySelector(['data-epitaxy-entry', 'data-entry-key', 'data-turn-key', 'data-message-uuid']
    .map(attribute => `[${attribute}="${CSS.escape(id)}"]`).join(','));
  const reveal = element => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    element.animate?.([{ outline: '2px solid #0169cc' }, { outline: '2px solid transparent' }], { duration: 1400 });
    return { located: true };
  };
  function transcript(root) {
    const scroller = root?.querySelector('[data-autoscroll-container]');
    if (!scroller) return {};
    const key = Object.keys(scroller).find(key => key.startsWith('__reactFiber$'));
    let first = key && scroller[key], top = first;
    while (top?.return) top = top.return;
    if (top?.stateNode?.current && top.stateNode.current !== top) first = first.alternate || first;
    let api, pager, entries;
    // Follow this transcript's ancestors only; never search other sessions' trees.
    for (let fiber = first, depth = 0; fiber && depth < 100; fiber = fiber.return, depth++) {
      const props = fiber.memoizedProps || {};
      if (props.sessionId && props.sessionId !== threadId) break;
      const candidate = props.messagesRef?.current || fiber.ref?.current;
      if (!api && typeof candidate?.scrollToEntry === 'function') api = candidate;
      if (props.historyPager) pager = props.historyPager;
      const older = props.value?.olderSource;
      if (!pager && older) pager = { hasEarlier: older.hasOlder, isLoadingEarlier: older.isLoadingOlder, earlierError: older.olderLoadFailed, loadEarlier: () => older.loadOlder({ trigger: 'anchor-restore', chain: () => Date.now() < deadline && !!scope() && !transcript(scope()).entries?.some(entry => entry.id === itemId || entry.sourceUuid === itemId || entry.lastAssistantUuid === itemId) }) };
      if (Array.isArray(props.entries)) entries = props.entries;
      if (api && pager && entries) break;
    }
    return { api, pager, entries };
  }
  while (Date.now() < deadline) {
    const root = scope();
    if (!root) return { located: false, reason: 'session_changed' };
    const mounted = find(root, itemId);
    if (mounted) return reveal(mounted);
    const { api, pager, entries } = transcript(root);
    if (!api || !entries) return { located: false, reason: 'transcript_api_unavailable' };
    const entry = entries.find(entry => entry.id === itemId || entry.sourceUuid === itemId || entry.lastAssistantUuid === itemId);
    if (entry) {
      let report;
      api.scrollToEntry(entry.id, 'instant', { flash: true, report: value => { report = value; } });
      const until = Math.min(deadline, Date.now() + 5000);
      while (Date.now() < until) {
        if (scope() !== root) return { located: false, reason: 'session_changed' };
        const target = find(root, entry.id) || find(root, itemId);
        if (target) return reveal(target);
        await wait();
      }
      return { located: false, reason: 'message_not_rendered', stage: report };
    }
    if (pager?.earlierError) return { located: false, reason: 'history_load_failed' };
    if (!pager?.hasEarlier) return { located: false, reason: 'message_not_in_history' };
    if (!pager.isLoadingEarlier) await pager.loadEarlier();
    // Wait for the host to publish the next page before requesting another.
    while (Date.now() < deadline) {
      await wait();
      const next = transcript(scope());
      if (next.entries !== entries || next.pager?.earlierError || !next.pager?.hasEarlier) break;
    }
  }
  return { located: false, reason: 'history_load_timeout' };
}
const { readConfiguredLang } = require('../../i18n.cjs');

function navigationResult(result, lang = readConfiguredLang()) {
  const en = lang === 'en';
  const messages = en ? {
    session_not_visible: 'Please expand the corresponding session in the Claude sidebar first',
    session_changed: 'Session changed; locating stopped',
    transcript_api_unavailable: 'Message locating interface is unavailable in the current client',
    message_not_rendered: 'Message loaded, but its display position could not be located yet',
    history_load_failed: 'Claude failed to load earlier messages; please retry shortly',
    message_not_in_history: 'This source message was not found in the current session history',
    history_load_timeout: 'Claude is still loading earlier history; please retry shortly',
  } : {
    session_not_visible: '请先在 Claude 侧栏展开对应会话', session_changed: '会话已切换，定位已停止',
    transcript_api_unavailable: '当前客户端的消息定位接口暂不可用', message_not_rendered: '消息已加载，但暂未能定位显示位置',
    history_load_failed: 'Claude 加载历史消息失败，请稍后重试', message_not_in_history: '当前会话历史中没有找到这条来源消息',
    history_load_timeout: 'Claude 仍在加载更早的历史，请稍后重试',
  };
  return { ...result, message: result?.located ? (en ? 'Located source' : '已定位来源') : messages[result?.reason] || (en ? 'Unable to locate source message right now' : '暂时无法定位来源消息') };
}
module.exports = { locateClaudeMessage, navigationResult };
