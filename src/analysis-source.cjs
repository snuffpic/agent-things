'use strict';

// The caller owns app-server transport and invokes this only for an explicit analysis action.
async function readTurns(request, threadId, boundary, onTurn, onPage) {
  if (typeof request !== 'function' || typeof threadId !== 'string' || !threadId) throw new Error('会话来源无效');
  const turns = [], cursors = new Set(), turnIds = new Set();
  let cursor = null;
  do {
    const page = await request('thread/turns/list', { threadId, sortDirection: 'asc', itemsView: 'full', cursor, limit: 100 });
    if (!page || !Array.isArray(page.data) || (page.nextCursor != null && typeof page.nextCursor !== 'string')) throw new Error('回合分页响应无效');
    for (const turn of page.data) {
      if (!turn || typeof turn.id !== 'string' || turnIds.has(turn.id)) throw new Error('回合分页重复或缺少标识');
      turnIds.add(turn.id);
      if (boundary && turn.id === boundary.id) { if (onTurn) await onTurn(boundary); else turns.push(boundary); if (onPage) await onPage(); return turns; }
      if (onTurn) await onTurn(turn); else turns.push(turn);
    }
    if (onPage) await onPage();
    cursor = page.nextCursor ?? null;
    if (cursor !== null) {
      if (!cursor || cursors.has(cursor) || page.data.length === 0) throw new Error('回合分页未连续前进');
      cursors.add(cursor);
    }
  } while (cursor !== null);
  if (boundary) throw new Error('分析边界已不存在，请重试');
  return turns;
}

async function captureTurns(request, threadId) {
  const page = await request('thread/turns/list', { threadId, sortDirection: 'desc', itemsView: 'full', cursor: null, limit: 1 });
  if (!page || !Array.isArray(page.data) || page.data.length > 1) throw new Error('无法读取分析边界');
  const boundary = page.data[0] ?? null;
  if (!boundary) return { turns: [], boundary: null };
  if (typeof boundary.id !== 'string' || !Array.isArray(boundary.items)) throw new Error('分析边界无效');
  const turns = await readTurns(request, threadId, structuredClone(boundary));
  return { turns, boundary: { turnId: boundary.id, itemId: boundary.items.at(-1)?.id ?? null, turnCount: turns.length, occurredAt: boundary.completedAt ?? boundary.startedAt ?? null } };
}
async function captureExtracted(request, hostId, threadId, onProgress = () => {}) {
  const { extractHistory } = require('./analysis-history.cjs');
  const page = await request('thread/turns/list', { threadId, sortDirection: 'desc', itemsView: 'full', cursor: null, limit: 1 });
  if (!page || !Array.isArray(page.data) || page.data.length > 1) throw new Error('无法读取分析边界');
  const boundary = page.data[0] ?? null;
  const combined = extractHistory({ hostId, threadId, turns: [] });
  const gaps = new Set(); let turnCount = 0, compactBytes = 2;
  let capturedBoundary = null;
  if (boundary) {
    if (typeof boundary.id !== 'string' || !Array.isArray(boundary.items)) throw new Error('分析边界无效');
    capturedBoundary = { turnId: boundary.id, itemId: boundary.items.at(-1)?.id ?? null, occurredAt: boundary.completedAt ?? boundary.startedAt ?? null };
    await onProgress({ boundary: capturedBoundary, turnCount: 0, rawBytes: 0, compactBytes });
    await readTurns(request, threadId, boundary, turn => {
      const part = extractHistory({ hostId, threadId, turns: [turn] });
      turnCount++;
      for (const event of part.events) {
        const old = event.ref;
        const ref = old[0] + String(combined.events.length + 1);
        const cleanEvent = { ...event, ref };
        compactBytes += Buffer.byteLength(JSON.stringify(cleanEvent)) + (combined.events.length ? 1 : 0);
        combined.events.push(cleanEvent); combined.sources[ref] = part.sources[old];
      }
      combined.turnHashes.push(...part.turnHashes);
      combined.continuous &&= part.continuous;
      for (const gap of part.gaps) gaps.add(gap);
      combined.stats.rawBytes += part.stats.rawBytes;
      combined.stats.filteredItems += part.stats.filteredItems;
    }, () => onProgress({ boundary: capturedBoundary, turnCount, rawBytes: combined.stats.rawBytes, compactBytes }));
  }
  combined.gaps = [...gaps];
  combined.stats.retainedEvents = combined.events.length;
  combined.stats.compactBytes = Buffer.byteLength(JSON.stringify(combined.events));
  combined.stats.estimatedTokens = Math.ceil(combined.stats.compactBytes / 3);
  return { extracted: combined, boundary: capturedBoundary ? { ...capturedBoundary, turnCount } : null };
}
module.exports = { readTurns, captureTurns, captureExtracted };
