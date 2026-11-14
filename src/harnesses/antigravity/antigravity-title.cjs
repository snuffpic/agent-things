'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { cleanUserRequestText } = require('./transcript-cleaner.cjs');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
const DEFAULT_BRAIN_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
const CACHE_TTL_MS = 5000;
const MAX_CACHE_ENTRIES = 256;
const TRANSCRIPT_HEAD_BYTES = 65536;

const titleCache = new Map();

function cleanConversationId(convIdOrKey) {
  if (typeof convIdOrKey !== 'string') return null;
  let raw = convIdOrKey.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2 && parsed[0] === 'local') {
      raw = String(parsed[1] || '').trim();
    }
  } catch (_) {}
  const cleanId = raw.replace(/^local:/, '').trim();
  if (!cleanId || path.basename(cleanId) !== cleanId || ['.', '..'].includes(cleanId)) {
    return null;
  }
  return cleanId;
}

function readTitleFromDb(cleanId, dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  try {
    const escapedId = cleanId.replace(/'/g, "''");
    const sql = `SELECT title, preview FROM conversation_summaries WHERE conversation_id = '${escapedId}' LIMIT 1;`;
    const stdout = execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rows = JSON.parse(stdout || '[]');
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const candidate = String(rows[0].title || rows[0].preview || '').replace(/\s+/g, ' ').trim();
    return candidate || null;
  } catch (_) {
    return null;
  }
}

function readHeadUtf8(filePath, maxBytes = TRANSCRIPT_HEAD_BYTES) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function formatSnippetTitle(rawText, maxChars = 48) {
  const singleLine = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!singleLine) return null;
  const chars = Array.from(singleLine);
  if (chars.length <= maxChars) return singleLine;
  return `${chars.slice(0, maxChars).join('')}...`;
}

function readTitleFromTranscript(cleanId, brainDir) {
  if (!brainDir) return null;
  const logsDir = path.join(brainDir, cleanId, '.system_generated', 'logs');
  const candidates = [
    path.join(logsDir, 'transcript.jsonl'),
    path.join(logsDir, 'transcript_full.jsonl'),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const head = readHeadUtf8(filePath);
      const lines = head.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let step;
        try {
          step = JSON.parse(line);
        } catch (_) {
          continue;
        }
        if (step?.type !== 'USER_INPUT' || typeof step.content !== 'string') continue;
        const cleaned = cleanUserRequestText(step.content);
        if (!cleaned || /^\s*\/things(?:\s|$)/i.test(cleaned)) continue;
        const title = formatSnippetTitle(cleaned);
        if (title) return title;
      }
    } catch (_) {}
  }
  return null;
}

function getCachedTitle(cacheKey, now) {
  const hit = titleCache.get(cacheKey);
  if (!hit) return undefined;
  if (now - hit.ts > CACHE_TTL_MS) {
    titleCache.delete(cacheKey);
    return undefined;
  }
  return hit.value;
}

function setCachedTitle(cacheKey, value, now) {
  if (titleCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = titleCache.keys().next().value;
    if (oldestKey !== undefined) titleCache.delete(oldestKey);
  }
  titleCache.set(cacheKey, { value, ts: now });
}

function resolveAntigravityTitle(convIdOrKey, options = {}) {
  const {
    dbPath = process.env.ANTIGRAVITY_SUMMARY_DB || DEFAULT_DB_PATH,
    brainDir = DEFAULT_BRAIN_DIR,
    fallback = null,
    cache = true,
  } = options;

  const cleanId = cleanConversationId(convIdOrKey);
  if (!cleanId || cleanId === 'default') return fallback;

  const cacheKey = `${dbPath || ''}\0${brainDir || ''}\0${cleanId}`;
  const now = Date.now();
  if (cache) {
    const cached = getCachedTitle(cacheKey, now);
    if (cached !== undefined) {
      return cached || fallback;
    }
  }

  const resolved = readTitleFromDb(cleanId, dbPath) || readTitleFromTranscript(cleanId, brainDir) || null;
  if (cache && resolved) {
    setCachedTitle(cacheKey, resolved, now);
  }
  return resolved || fallback;
}

module.exports = {
  DEFAULT_DB_PATH,
  DEFAULT_BRAIN_DIR,
  cleanConversationId,
  readTitleFromDb,
  readTitleFromTranscript,
  resolveAntigravityTitle,
};
