'use strict';
const crypto = require('node:crypto');

const EXTRACTOR_VERSION = 3;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// 规则 1：长代码块脱水（保留短示例命令，折叠冗长实现片段）
function dehydrateCodeBlocks(text) {
  return text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const lines = code.split('\n');
    if (lines.length <= 5 && code.length <= 160) return match;
    const header = lines.slice(0, 2).join('\n');
    const footer = lines.slice(-1).join('\n');
    return '```' + (lang || '') + '\n' + header + '\n// ... [代码块共 ' + lines.length + ' 行已折叠] ...\n' + footer + '\n```';
  });
}

// 规则 3：连续终端日志堆栈脱水（折叠连续多行时间戳日志行）
function dehydrateTerminalLogs(text) {
  const logLineRegex = /^\[?\d{2,4}[-:\/]\d{2}[-:\/]\d{2,4}[ T]?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?/;
  const lines = text.split('\n');
  const compacted = [];
  let logBuffer = [];

  const flushLogs = () => {
    if (logBuffer.length > 5) {
      compacted.push(...logBuffer.slice(0, 2));
      compacted.push('[... 中间 ' + (logBuffer.length - 4) + ' 行时间戳运行日志已折叠 ...]');
      compacted.push(...logBuffer.slice(-2));
    } else {
      compacted.push(...logBuffer);
    }
    logBuffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (logLineRegex.test(line.trim())) {
      logBuffer.push(line);
    } else {
      flushLogs();
      compacted.push(line);
    }
  }
  flushLogs();
  return compacted.join('\n');
}

// Strip only recognized machine envelopes; quoted XML and ordinary human text remain data.
function cleanMessage(text) {
  let value = text.trim();
  const leading = /^<(heartbeat|in-app-browser-context|send_user_message_question_reply)\b[^>]*>([\s\S]*?)<\/\1>/;
  let match;
  while ((match = value.match(leading))) {
    let replacement = '';
    if (match[1] === 'send_user_message_question_reply') {
      try {
        const replies = JSON.parse(match[2]);
        if (!Array.isArray(replies) || replies.some(reply => typeof reply.question !== 'string' || typeof reply.answer !== 'string')) return value;
        replacement = replies.map(reply => `提问：${reply.question}\n用户回答：${reply.answer}`).join('\n');
      } catch { return value; }
    }
    value = (replacement + '\n' + value.slice(match[0].length)).trim();
    if (replacement) break;
  }
  // 仅应用规则 1 (代码块脱水) 与 规则 3 (终端日志脱水)，智能体正文汇报完整保留
  value = dehydrateCodeBlocks(value);
  value = dehydrateTerminalLogs(value);
  return value;
}

// Input is an ordered, complete list of app-server turns, not raw tool output.
function extractHistory({ hostId, threadId, turns, continuous = true }) {
  if (typeof hostId !== 'string' || typeof threadId !== 'string' || !Array.isArray(turns)) throw new Error('会话来源无效');
  const events = [], sources = {}, gaps = new Set();
  let filtered = 0, bytes = 0;
  const turnHashes = [];
  const emit = (prefix, turn, item, data) => {
    const ref = `${prefix}${events.length + 1}`;
    const event = { ref, turnStartedAt: turn.startedAt ?? null, turnCompletedAt: turn.completedAt ?? null, ...data };
    events.push(event);
    const locator = typeof data.text === 'string' ? data.text.split('\n').map(line => line.trim()).find(line => line.length >= 10 && !/^[#<\-]/.test(line))?.slice(0, 24) : null;
    sources[ref] = { hostId, threadId, turnId: turn.id, itemId: item.id, locator: locator || null, turnStartedAt: turn.startedAt ?? null, turnCompletedAt: turn.completedAt ?? null, hash: hash(data) };
  };
  const ids = new Set();
  for (const turn of turns) {
    if (!turn || typeof turn.id !== 'string' || !Array.isArray(turn.items) || ids.has(turn.id)) throw new Error('回合来源无效或重复');
    ids.add(turn.id);
    if (turn.itemsView && turn.itemsView !== 'full') gaps.add('回合条目未完整加载');
    if (!['completed', 'failed', 'interrupted', 'inProgress'].includes(turn.status)) gaps.add('未知回合状态');
    bytes += Buffer.byteLength(JSON.stringify(turn));
    const lastUnknown = turn.status === 'completed' && !turn.items.some(item => item.type === 'agentMessage' && item.phase === 'final_answer')
      ? turn.items.findLast(item => item.type === 'agentMessage' && item.phase == null) : null;
    const turnEvents = [];
    const begin = events.length;
    const itemIds = new Set();
    for (const item of turn.items) {
      if (!item || typeof item.id !== 'string' || itemIds.has(item.id)) throw new Error('条目来源无效或重复');
      itemIds.add(item.id);
      if (item.type === 'userMessage' && Array.isArray(item.content)) {
        const text = cleanMessage(item.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n'));
        if (text) emit('u', turn, item, { type: 'user', text }); else filtered++;
      } else if (item.type === 'agentMessage' && typeof item.text === 'string' && (item.phase === 'final_answer' || item === lastUnknown)) {
        const text = cleanMessage(item.text);
        if (text) {
          emit('a', turn, item, { type: 'answer', text, finality: item.phase === 'final_answer' ? 'confirmed' : 'unknown' });
          if (item.phase == null) gaps.add('最终答复标记未知');
        } else filtered++;
      } else filtered++;
    }
    for (const event of events.slice(begin)) turnEvents.push({ ...event, ref: undefined, itemId: sources[event.ref].itemId });
    turnHashes.push({ turnId: turn.id, status: turn.status, hash: hash({ status: turn.status, itemsView: turn.itemsView || 'full', events: turnEvents }) });
    if (turnEvents.length && turn.status !== 'completed') gaps.add(`回合${turn.status}`);
    if (turn.status === 'completed' && turnEvents.some(event => event.type === 'user') && !turnEvents.some(event => event.type === 'answer')) gaps.add('回合缺少最终答复');
  }
  if (!continuous) gaps.add('分页不连续');
  const compactBytes = Buffer.byteLength(JSON.stringify(events));
  return { hostId, threadId, events, sources, turnHashes, limitations: [], continuous: continuous && !gaps.has('回合条目未完整加载'), gaps: [...gaps],
    stats: { rawBytes: bytes, compactBytes, retainedEvents: events.length, filteredItems: filtered, estimatedTokens: Math.ceil(compactBytes / 3) }, extractorVersion: EXTRACTOR_VERSION };
}

// A successful checkpoint binds the ledger to an immutable completed prefix.
function prepareIncremental(extracted, checkpoint, versions) {
  if (!extracted.continuous) throw new Error('来源不连续，不能推进检查点');
  if (checkpoint && (checkpoint.hostId !== extracted.hostId || checkpoint.threadId !== extracted.threadId)) throw new Error('检查点会话不匹配');
  let start = 0, reason = 'initial', changedTurn;
  const versionsMatch = !versions || ['prompt', 'schema', 'ledger'].every(key => checkpoint?.versions?.[key] === versions[key]);
  if (checkpoint && checkpoint.extractorVersion === extracted.extractorVersion && versionsMatch) {
    const prior = checkpoint.turnHashes;
    while (start < prior.length && start < extracted.turnHashes.length && prior[start].turnId === extracted.turnHashes[start].turnId && prior[start].hash === extracted.turnHashes[start].hash) start++;
    reason = start === prior.length ? 'incremental' : 'history_changed';
    if (reason === 'history_changed') {
      changedTurn = { index: start, previousTurnId: prior[start]?.turnId, currentTurnId: extracted.turnHashes[start]?.turnId };
      start = 0;
    }
  } else if (checkpoint) reason = versionsMatch ? 'extractor_changed' : 'versions_changed';
  const turnIds = new Set(extracted.turnHashes.slice(start).map(turn => turn.turnId));
  return { reason, changedTurn, startTurn: start, events: extracted.events.filter(event => turnIds.has(extracted.sources[event.ref].turnId)),
    ledger: checkpoint?.ledger || null };
}

function commitCheckpoint(extracted, ledger, versions) {
  if (!extracted.continuous) throw new Error('来源不连续，不能推进检查点');
  if (!ledger || typeof ledger !== 'object' || !versions?.prompt || !versions?.schema || !versions?.ledger) throw new Error('成功账本或版本缺失');
  if (extracted.turnHashes.some(turn => !['completed', 'failed', 'interrupted'].includes(turn.status))) throw new Error('范围含未完成回合，不能推进检查点');
  return { hostId: extracted.hostId, threadId: extracted.threadId, extractorVersion: extracted.extractorVersion,
    versions: { prompt: versions.prompt, schema: versions.schema, ledger: versions.ledger },
    turnHashes: extracted.turnHashes, ledger };
}
module.exports = { extractHistory, prepareIncremental, commitCheckpoint };
