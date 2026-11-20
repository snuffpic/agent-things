'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_MESSAGE_CHARS = 24000;
const MAX_PAGE_BYTES = 480000;

function truncateTranscriptText(text, maxChars = MAX_MESSAGE_CHARS) {
  const raw = String(text || '');
  if (raw.length <= maxChars) return raw;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 48);
  const omitted = Math.max(0, raw.length - head - tail);
  return `${raw.slice(0, head)}\n...[truncated ${omitted} chars]...\n${tail > 0 ? raw.slice(raw.length - tail) : ''}`;
}

function stripThingsCommandLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter(line => !/^\s*\/things(?:\s|$)/i.test(line))
    .join('\n')
    .trim();
}

function extractTextBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n');
}

function isHumanUserMessage(data) {
  const kind = data?.source?.kind;
  return kind === undefined || kind === 'user' || kind === 'user-rpc';
}

function mapTurnStatus(reasonKind) {
  if (reasonKind === 'completed' || reasonKind === 'max-tokens') return 'completed';
  if (reasonKind === 'error') return 'failed';
  return 'interrupted';
}

function parseDshSessionEvents(events = [], { header = null } = {}) {
  const turns = [];
  const turnsByNumber = new Map();
  let latestRoute = null;
  let orphanCounter = 0;

  const ensureTurn = (turnNumber, time = null) => {
    const num = Number.isInteger(turnNumber) && turnNumber >= 0 ? turnNumber : null;
    if (num !== null && turnsByNumber.has(num)) return turnsByNumber.get(num);
    const id = num !== null ? `turn-${num}` : `orphan-${++orphanCounter}`;
    const turn = {
      id,
      turn: num,
      status: 'inProgress',
      startedAt: time ?? null,
      completedAt: time ?? null,
      items: [],
    };
    if (num !== null) turnsByNumber.set(num, turn);
    turns.push(turn);
    return turn;
  };

  let activeTurn = null;

  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue;
    const seq = event.seq;
    const time = typeof event.time === 'number' ? event.time : null;
    const data = event.data;

    if (event.type === 'turn/start') {
      const incomingTurn = Number.isInteger(data?.turn) && data.turn >= 0 ? data.turn : null;
      if (activeTurn && activeTurn.status === 'inProgress' && activeTurn.turn !== incomingTurn) {
        activeTurn.status = 'interrupted';
      }
      activeTurn = ensureTurn(data?.turn, time);
      if (activeTurn.startedAt == null && time !== null) activeTurn.startedAt = time;
      continue;
    }

    if (event.type === 'turn/end') {
      const target = ensureTurn(data?.turn ?? activeTurn?.turn, time);
      target.status = mapTurnStatus(data?.reason?.kind);
      if (time !== null) target.completedAt = time;
      if (activeTurn === target) activeTurn = null;
      continue;
    }

    if (event.type === 'request/header') {
      const cfg = data?.header?.config;
      if (cfg && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
        latestRoute = {
          provider: cfg.provider,
          model: cfg.model,
          ...(typeof cfg.reasoningEffort === 'string' ? { reasoningEffort: cfg.reasoningEffort } : {}),
        };
      }
      continue;
    }

    if (event.type === 'user/message') {
      if (!isHumanUserMessage(data)) continue;
      const cleaned = stripThingsCommandLines(extractTextBlocks(data?.content));
      if (!cleaned) continue;
      const text = truncateTranscriptText(cleaned);
      const target = activeTurn || ensureTurn(null, time);
      if (target.startedAt == null && time !== null) target.startedAt = time;
      if (time !== null) target.completedAt = time;
      target.items.push({
        id: `seq-${seq}`,
        seq,
        turn: target.turn,
        type: 'userMessage',
        content: [{ type: 'text', text }],
      });
      continue;
    }

    if (event.type === 'assistant/message') {
      const rawText = extractTextBlocks(data?.message?.content);
      if (!rawText.trim()) continue;
      const text = truncateTranscriptText(rawText);
      const turnNumber = typeof data?.turn === 'number' ? data.turn : activeTurn?.turn;
      const target = ensureTurn(turnNumber, time);
      if (time !== null) target.completedAt = time;
      target.items.push({
        id: `seq-${seq}`,
        seq,
        turn: target.turn,
        type: 'agentMessage',
        text,
        phase: null,
        interrupted: Boolean(data?.interrupted),
      });
    }
  }

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (i < turns.length - 1 && turn.status === 'inProgress') {
      turn.status = 'interrupted';
    }
    let lastAgent = null;
    for (const item of turn.items) {
      if (item.type === 'agentMessage') lastAgent = item;
    }
    if (lastAgent && turn.status === 'completed' && !lastAgent.interrupted) {
      lastAgent.phase = 'final_answer';
    }
  }

  return {
    header,
    turns,
    latestRoute,
  };
}

function buildItemCoordinateIndex(turns) {
  const index = new Map();
  for (const turn of turns) {
    for (const item of turn.items || []) {
      index.set(item.id, {
        itemId: item.id,
        turnId: turn.id,
        turn: turn.turn ?? null,
        seq: item.seq ?? null,
        role: item.type === 'userMessage' ? 'user' : 'assistant',
      });
    }
  }
  return index;
}

async function readDshSessionSnapshot(ctx, sessionId, signal) {
  const sessions = ctx.get?.('sessions') ?? ctx.sessions;
  const live = sessions?.get?.(sessionId);
  if (live) {
    const events = typeof live.snapshotEvents === 'function' ? live.snapshotEvents() : [];
    const parsed = parseDshSessionEvents(events, { header: live.header || null });
    return {
      id: sessionId,
      cwd: live.header?.cwd || null,
      header: live.header || null,
      events,
      ...parsed,
    };
  }

  const persistence = ctx.get?.('sessionPersistence') ?? ctx.sessionPersistence;
  if (!persistence || typeof persistence.open !== 'function') {
    throw new Error('DSH sessionPersistence unavailable');
  }

  let handle;
  try {
    handle = await persistence.open(sessionId, 'read', signal ? { signal } : {});
  } catch (error) {
    if (error && (error.name === 'SessionPersistenceNotFoundError' || error.code === 'SESSION_PERSISTENCE_NOT_FOUND')) {
      return { id: sessionId, cwd: null, header: null, events: [], turns: [], latestRoute: null };
    }
    throw error;
  }

  try {
    const readResult = await handle.read(0, undefined, signal ? { signal } : {});
    const events = readResult?.events || [];
    const parsed = parseDshSessionEvents(events, { header: handle.header || null });
    return {
      id: sessionId,
      cwd: handle.header?.cwd || null,
      header: handle.header || null,
      events,
      ...parsed,
    };
  } finally {
    await handle.close();
  }
}

class DshTranscriptServer {
  constructor(loadSnapshot) {
    this.loadSnapshot = loadSnapshot;
    this.snapshotId = randomUUID();
    this.cache = new Map();
  }

  async initialize() {}

  async close() {
    this.cache.clear();
  }

  async snapshotFor(threadId) {
    if (!this.cache.has(threadId)) {
      this.cache.set(threadId, await this.loadSnapshot(threadId));
    }
    return this.cache.get(threadId);
  }

  async request(method, params) {
    const snap = await this.snapshotFor(params.threadId);
    if (method === 'thread/read') {
      const safeCwd = typeof snap.cwd === 'string' && path.isAbsolute(snap.cwd) ? snap.cwd : null;
      return { thread: { id: params.threadId, cwd: safeCwd }, latestRoute: snap.latestRoute || null };
    }
    if (method !== 'thread/turns/list') {
      throw new Error(`Unsupported DSH transcript method: ${method}`);
    }
    const settledTurns = (snap.turns || []).filter(turn => turn && turn.status !== 'inProgress');
    const ordered = params.sortDirection === 'desc' ? [...settledTurns].reverse() : settledTurns;
    const start = params.cursor ? ordered.findIndex(turn => turn.id === params.cursor) + 1 : 0;
    if (params.cursor && start === 0) throw new Error('会话分页位置已变化，请重试');
    const limit = Math.min(100, params.limit || 100);
    const data = [];
    let bytes = 0;
    for (let i = start; i < ordered.length && data.length < limit; i++) {
      const turn = ordered[i];
      const size = Buffer.byteLength(JSON.stringify(turn), 'utf8');
      if (data.length > 0 && bytes + size > MAX_PAGE_BYTES) break;
      data.push(turn);
      bytes += size;
    }
    return {
      data,
      nextCursor: start + data.length < ordered.length ? data.at(-1).id : null,
    };
  }
}

module.exports = {
  extractTextBlocks,
  isHumanUserMessage,
  parseDshSessionEvents,
  buildItemCoordinateIndex,
  readDshSessionSnapshot,
  DshTranscriptServer,
};
