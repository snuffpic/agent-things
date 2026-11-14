'use strict';
const { progressError } = require('./progress-error.cjs');
const { readTurns } = require('./analysis-source.cjs');
const normalize = text => text.replace(/\s+/g, ' ').trim();

function messageText(item) {
  if (item.type === 'userMessage') return (item.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (item.type === 'agentMessage' && (item.phase === 'final_answer' || item.phase == null) &&
      !/^\s*(?:\[external_agent_tool_|<EXTERNAL SESSION IMPORTED>)/.test(item.text || '')) return item.text;
  return '';
}

async function resolveTaskSources(request, key, tasks, { inferTitles = false } = {}) {
  if (!tasks.some(task => task.source || inferTitles)) return tasks.map(() => null);
  const [hostId, sidebarId] = JSON.parse(key);
  const threadId = sidebarId.replace(/^local:/, '');
  const pending = tasks.map(task => {
    const reference = task.source || (inferTitles && task.title.length >= 10 ? { locator: task.title } : null);
    if (reference && (typeof reference.locator !== 'string' || normalize(reference.locator).length < 10 || reference.locator.length > 240)) throw progressError('INVALID_ARGUMENT', '任务来源原文应为10至240个字符');
    return reference;
  });
  const matches = tasks.map(() => []);
  await readTurns(request, threadId, null, turn => {
    for (const item of turn.items || []) {
      const text = messageText(item);
      if (!text) continue;
      const clean = normalize(text);
      pending.forEach((reference, index) => {
        if (!reference || reference.turnId && reference.turnId !== turn.id || reference.itemId && reference.itemId !== item.id) return;
        if (clean.includes(normalize(reference.locator))) matches[index].push({ hostId, threadId, turnId: turn.id, itemId: item.id,
          locator: reference.locator.trim(), turnStartedAt: turn.startedAt ?? null, turnCompletedAt: turn.completedAt ?? null });
      });
    }
  });
  return matches.map((candidates, index) => {
    if (candidates.length === 1) return candidates[0];
    if (!tasks[index].source) return null;
    throw progressError('SOURCE_NOT_FOUND', `第 ${index + 1} 项任务来源${candidates.length ? '匹配多条消息，请补充 turnId 和 itemId' : '未在本会话中找到，请核对原文'}`);
  });
}

module.exports = { resolveTaskSources };
