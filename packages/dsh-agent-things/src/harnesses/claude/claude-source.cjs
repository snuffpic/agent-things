'use strict';
const crypto = require('node:crypto');
const { stripLeadingEnvelopes } = require('../../analysis-history.cjs');

function textContent(content, { stripEnvelopes = false } = {}) {
  const cleanPart = text => (stripEnvelopes ? stripLeadingEnvelopes(text) : String(text || ''));
  if (typeof content === 'string') return cleanPart(content);
  return Array.isArray(content)
    ? content.filter(part => part?.type === 'text').map(part => cleanPart(part.text || '')).filter(Boolean).join('\n')
    : '';
}

function cleanCompactSummary(text) {
  let value = String(text || '').trim();
  value = value.replace(/^This session is being continued from a previous conversation[\s\S]*?(?=<system-reminder>|\bSummary:)/i, '');
  value = stripLeadingEnvelopes(value);
  value = value.replace(/\n+(?:If you need specific details from before compaction|Continue the conversation from where it left off|Please continue the conversation|If you are working with the user|The messages after this summary are the most recent messages from before compaction)[\s\S]*$/i, '').trim();
  return value ? `[前情摘要]\n${value}` : '';
}

function transcriptTurns(result) {
  const messages = Array.isArray(result) ? result : result?.messages;
  if (!Array.isArray(messages)) throw new Error('Claude 会话文本格式不受支持');
  const turns = [];
  for (const entry of messages) appendTranscriptEntry(turns, entry);
  return turns;
}

function appendTranscriptEntry(turns, entry) {
  const clean = cleanTranscriptMessage(entry);
  if (clean) appendCleanMessage(turns, clean);
}
function cleanTranscriptMessage(entry) {
  const message = entry.message || entry;
  const role = message.role || entry.type;
  if (!['user', 'assistant'].includes(role) || entry.isSidechain || entry.isMeta) return null;
  if (role === 'assistant' && message.stop_reason && message.stop_reason !== 'end_turn') return null;
  let original = textContent(message.content, { stripEnvelopes: true });
  if (role === 'user' && entry.isCompactSummary) original = cleanCompactSummary(original);
  const text = original.length > 24000 ? `${original.slice(0, 12000)}\n[内容已精简]\n${original.slice(-12000)}` : original;
  if (!text.trim()) return null;
  const id = entry.uuid || entry.id;
  if (typeof id !== 'string' || !id) throw new Error('Claude 消息缺少稳定身份');
  return { id, role, text, occurredAt: entry.timestamp || null };
}
function appendCleanMessage(turns, { id, role, text, occurredAt }) {
  if (role === 'user') turns.push({ id, status: 'completed', startedAt: occurredAt, completedAt: occurredAt, items: [{ id, type: 'userMessage', content: [{ type: 'text', text }] }] });
  else {
    const turn = turns.at(-1);
    if (turn) { turn.items.push({ id, type: 'agentMessage', text, phase: 'final_answer' }); turn.completedAt = occurredAt || turn.completedAt; }
  }
}

class ClaudeTranscriptServer {
  constructor(host) { this.host = host; this.snapshotId = crypto.randomUUID(); }
  async initialize() {}
  async close() {}
  async request(method, params) {
    if (method === 'thread/read') {
      const session = await this.host('session', params.threadId);
      return { thread: { id: params.threadId, cwd: session?.cwd || null } };
    }
    if (method !== 'thread/turns/list') throw new Error('Claude 数据源不支持此方法');
    return this.host('turns', params.threadId, { snapshotId: this.snapshotId, sortDirection: params.sortDirection || 'asc', cursor: params.cursor || null, limit: params.limit || 100 });
  }
}

function pageClaudeTurns(turns, { sortDirection = 'asc', cursor = null, limit = 100 } = {}) {
  const ordered = sortDirection === 'desc' ? [...turns].reverse() : turns;
  const start = cursor ? ordered.findIndex(turn => turn.id === cursor) + 1 : 0;
  if (cursor && start === 0) throw new Error('Claude 会话分页位置已变化，请重新分析');
  const data = [];
  let bytes = 0;
  for (const turn of ordered.slice(start, start + Math.min(100, limit))) {
    const size = Buffer.byteLength(JSON.stringify(turn));
    if (size > 480000) throw new Error('Claude 单轮文本过大，请先精简该轮内容');
    if (bytes + size > 480000 && data.length) break;
    data.push(turn); bytes += size;
  }
  return { data, nextCursor: start + data.length < ordered.length ? data.at(-1).id : null };
}

module.exports = { transcriptTurns, cleanTranscriptMessage, appendCleanMessage, pageClaudeTurns, ClaudeTranscriptServer };
