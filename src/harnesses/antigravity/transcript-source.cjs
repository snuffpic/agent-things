'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  parseTranscriptSteps,
  convertStepsToTurns,
  cleanUserRequestText,
  isFinalAgentResponse,
  safeTruncateText,
} = require('./transcript-cleaner.cjs');
const { detectAntigravityGit } = require('./antigravity-git.cjs');

/**
 * Antigravity 数据源适配器 (Transcript Source Adapter)
 * 专职负责：定位 Antigravity 宿主本地沙盒目录 (~/.gemini/antigravity/brain/) 并暴露标准 RPC 查询协议。
 * 具体的日志清洗与步骤转换委托给独立的 transcript-cleaner.cjs 处理。
 */

function loadAntigravityTurns(brainDir, threadId) {
  const cleanId = typeof threadId === 'string' && threadId.startsWith('local:') ? threadId.slice(6) : threadId;
  if (typeof cleanId !== 'string' || !cleanId || path.basename(cleanId) !== cleanId || ['.', '..'].includes(cleanId)) throw new Error('无效会话路径');
  const logFile = path.join(brainDir, cleanId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(logFile)) {
    // 降级检查完整日志文件 transcript_full.jsonl
    const fullLog = path.join(brainDir, cleanId, '.system_generated', 'logs', 'transcript_full.jsonl');
    if (fs.existsSync(fullLog)) {
      return convertStepsToTurns(parseTranscriptSteps(fullLog));
    }
    return [];
  }
  return convertStepsToTurns(parseTranscriptSteps(logFile));
}

class AntigravityTranscriptServer {
  constructor({ brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain'), cwd = process.cwd() } = {}) {
    this.brainDir = brainDir;
    this.cwd = cwd;
    this.turns = new Map();
  }

  async initialize() {}
  async close() { this.turns.clear(); }

  async request(method, params = {}) {
    if (method === 'thread/turns/list') {
      const { threadId, sortDirection = 'asc', limit = 100, cursor = null } = params;
      if (!this.turns.has(threadId)) this.turns.set(threadId, loadAntigravityTurns(this.brainDir, threadId));
      let turns = this.turns.get(threadId);
      if (sortDirection === 'desc') {
        turns = [...turns].reverse();
      }

      let startIndex = 0;
      if (cursor != null && typeof cursor === 'string') {
        const foundIndex = turns.findIndex(t => t.id === cursor);
        if (foundIndex !== -1) {
          startIndex = foundIndex + 1;
        } else {
          const parsed = parseInt(cursor, 10);
          if (!isNaN(parsed) && parsed >= 0) {
            startIndex = parsed;
          }
        }
      }

      const pageSize = Number.isInteger(limit) && limit > 0 ? limit : 100;
      const pageData = turns.slice(startIndex, startIndex + pageSize);
      const nextIndex = startIndex + pageData.length;
      const nextCursor = nextIndex < turns.length && pageData.length > 0
        ? String(pageData.at(-1)?.id ?? nextIndex)
        : null;

      return { data: pageData, nextCursor };
    }

    if (method === 'thread/read') {
      const gitInfo = await detectAntigravityGit(params.threadId, { brainDir: this.brainDir });
      return {
        thread: {
          id: params.threadId,
          cwd: gitInfo.detectedPath || this.cwd
        }
      };
    }

    throw new Error(`AntigravityTranscriptServer 未知方法: ${method}`);
  }
}

module.exports = {
  loadAntigravityTurns,
  AntigravityTranscriptServer,
  // 保持向后兼容的再导出
  parseTranscriptSteps,
  convertStepsToTurns,
  cleanUserRequestText,
  isFinalAgentResponse,
  safeTruncateText,
};
