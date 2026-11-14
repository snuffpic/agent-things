'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function syncClaudeInline(root, enabled, { home = (process.env.HOME || os.homedir()) } = {}) {
  const destination = path.join(home, '.claude/skills/agent-things-ui');
  const source = path.join(root, 'mods/agent-things-ui');
  const exists = fs.existsSync(destination);
  if (!enabled && !exists) return null;
  if (exists) {
    const manifestFile = path.join(destination, '.claude-plugin/plugin.json');
    const manifest = fs.existsSync(manifestFile) && JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    if (manifest?.name !== 'agent-things-ui' || manifest?.author?.name !== 'Agent Things') {
      if (!enabled) return null;
      throw new Error('Claude 的 agent-things-ui 目录已被其他内容占用');
    }
  }
  if (enabled && !fs.existsSync(source)) throw new Error('安装包缺少 Claude 会话卡片');
  const backup = path.join(home, 'Library/Application Support/CodexSessionStatus/backups', `claude-inline-${Date.now()}-${process.pid}`);
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  if (enabled) fs.cpSync(source, path.join(backup, 'staged'), { recursive: true });
  if (exists) fs.renameSync(destination, path.join(backup, 'previous'));
  try {
    if (enabled) { fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.renameSync(path.join(backup, 'staged'), destination); }
  } catch (error) {
    if (exists) fs.renameSync(path.join(backup, 'previous'), destination);
    throw error;
  }
  return { backup, rollback() {
    if (enabled && fs.existsSync(destination)) fs.renameSync(destination, path.join(backup, 'rolled-back-install'));
    if (exists) fs.renameSync(path.join(backup, 'previous'), destination);
  } };
}
module.exports = { syncClaudeInline };
