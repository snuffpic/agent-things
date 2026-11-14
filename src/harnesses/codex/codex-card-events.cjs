'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { progressError } = require('../../progress-error.cjs');

const WAIT_MS = 10000;

function cardCursor({ snapshot, analysisState }) {
  // The ledger's global revision also changes when another chat is written.
  return crypto.createHash('sha256').update(JSON.stringify([
    snapshot.records, analysisState.analysis, analysisState.timeline,
  ])).digest('hex');
}

function createCardEvents({ store, read, waitMs = WAIT_MS }) {
  const waiting = new Map();
  const fileName = path.basename(store.file);
  let watcher, closed = false;

  function stopWatching(error) {
    watcher?.close();
    watcher = null;
    for (const waiters of waiting.values()) {
      for (const waiter of waiters) waiter.finish(null, error);
    }
  }

  function publish(_event, file) {
    if (!waiting.size || (file && file !== fileName)) return;
    try {
      store.reloadIfModified(true);
      for (const [key, waiters] of waiting) {
        const state = read(key);
        const cursor = cardCursor(state);
        for (const waiter of waiters) {
          if (waiter.cursor !== cursor) waiter.finish({ ...state, cursor });
        }
      }
    } catch (error) { stopWatching(error); }
  }

  return {
    async wait(key, previousCursor, signal) {
      signal?.throwIfAborted();
      if (closed) throw new Error('卡片同步已关闭');
      if (!watcher) {
        watcher = fs.watch(path.dirname(store.file), { persistent: false }, publish);
        watcher.on('error', stopWatching);
      }
      const state = read(key);
      const cursor = cardCursor(state);
      if (cursor !== previousCursor) return { ...state, cursor };
      const waiters = waiting.get(key) || new Set();
      return new Promise((resolve, reject) => {
        const waiter = { cursor, finish(result, error) {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          waiters.delete(waiter);
          if (!waiters.size) waiting.delete(key);
          if (error) reject(error); else resolve(result || { cursor });
        } };
        const abort = () => waiter.finish(null, progressError('REQUEST_CANCELLED'));
        const timer = setTimeout(() => waiter.finish(), waitMs);
        waiters.add(waiter);
        waiting.set(key, waiters);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    },
    close() { closed = true; stopWatching(); },
  };
}

module.exports = { createCardEvents };
