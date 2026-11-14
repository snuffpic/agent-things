'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { fileURLToPath } = require('node:url');
const { inspectGit } = require('../../analysis-git.cjs');
const execute = promisify(execFile);

/**
 * 动态检测 Antigravity 会话关联的 Git 仓库与远端配置。
 * 遵循严格的项目边界隔离法则：
 * 1. 优先读取 Antigravity 原生数据库 conversation_summaries.db，确定会话是否关联具体项目 (Projects)；
 * 2. 普通独立会话 (outside-of-project / 无 workspace) 默认不包含 Git 推送选项；
 * 3. 只有明确属于项目、且项目工作区配置了有效 Git Remote 时才激活。
 */
async function detectAntigravityGit(threadId, options = {}) {
  if (typeof threadId !== 'string' || !threadId || path.basename(threadId) !== threadId || ['.', '..'].includes(threadId)) throw new Error('无效会话路径');
  const dbPath = options.dbPath || path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
  const brainBase = options.brainDir || path.join(os.homedir(), '.gemini', 'antigravity', 'brain');

  // 1. 优先从 Antigravity 官方元数据数据库读取工作区信息
  if (fs.existsSync(dbPath)) {
    try {
      const sql = `SELECT workspace_uris, project_id FROM conversation_summaries WHERE conversation_id = '${threadId.replace(/'/g, "''")}';`;
      const { stdout } = await execute('sqlite3', ['-json', dbPath, sql], { timeout: 3000 });
      const rows = JSON.parse(stdout || '[]');
      if (rows.length > 0) {
        const { workspace_uris, project_id } = rows[0];
        // 独立会话或未关联项目
        if (!project_id || project_id === 'outside-of-project' || !workspace_uris || workspace_uris === '[]' || workspace_uris === '""') {
          return { status: 'checked', hasRepository: false, hasRemote: false, projectPath: null, projectKnown: true, checkedAt: Date.now() };
        }
        // 解析项目工作区 URI
        let uris = [];
        try { uris = JSON.parse(workspace_uris); } catch { /* ignore */ }
        if (Array.isArray(uris)) {
          for (const u of uris) {
            try {
              const localPath = u.startsWith('file://') ? fileURLToPath(u) : u;
              if (fs.existsSync(localPath)) {
                const res = await inspectGit(localPath);
                return { ...res, detectedPath: localPath, projectPath: localPath, checkedAt: Date.now() };
              }
            } catch { /* ignore parse error */ }
          }
        }
        return { status: 'checked', hasRepository: false, hasRemote: false, checkedAt: Date.now() };
      }
    } catch { /* ignore sqlite error, fallback to transcript heuristics */ }
  }

  // 2. 降级备用分支：如果数据库未收录（例如测试环境或新建会话尚未持久化）
  const brainDir = path.join(brainBase, threadId);
  if (!fs.existsSync(brainDir)) {
    return { status: 'checked', hasRepository: false, hasRemote: false, checkedAt: Date.now() };
  }

  const logFile = path.join(brainDir, '.system_generated', 'logs', 'transcript.jsonl');
  const targetLog = fs.existsSync(logFile) ? logFile : path.join(brainDir, '.system_generated', 'logs', 'transcript_full.jsonl');

  if (fs.existsSync(targetLog)) {
    try {
      const content = fs.readFileSync(targetLog, 'utf8');
      // 如果转录日志明确声明了“用户没有激活任何 workspace”，则绝不误判为 Git 项目
      if (content.includes('The user does not have any active workspace.')) {
        return { status: 'checked', hasRepository: false, hasRemote: false, projectPath: null, projectKnown: true, checkedAt: Date.now() };
      }

      // 测试环境或显式指定的工作区
      const lines = content.trim().split('\n');
      for (const line of lines.slice(-50).reverse()) {
        try {
          const step = JSON.parse(line);
          const workspace = step.workspace || step.active_workspace;
          if (workspace && typeof workspace === 'string' && fs.existsSync(workspace)) {
            const res = await inspectGit(workspace);
            return { ...res, detectedPath: workspace, projectPath: workspace, checkedAt: Date.now() };
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore read error */ }
  }

  return { status: 'checked', hasRepository: false, hasRemote: false, checkedAt: Date.now() };
}

module.exports = { detectAntigravityGit };
