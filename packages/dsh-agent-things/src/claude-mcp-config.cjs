'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveNode } = require('./resolve.cjs');

const owned = server => server?.args?.some(arg => typeof arg === 'string' && arg.endsWith('/claude-session-status.cjs'));
function updateClaudeMcp({ scriptPath, file = path.join(os.homedir(), '.claude.json'), enabled = true } = {}) {
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const current = data.mcpServers?.session_status;
  if (current && !owned(current)) {
    if (enabled) throw new Error('Claude 已存在其他 session_status 服务，请先检查配置');
    return { removed: false };
  }
  if (enabled) {
    if (!scriptPath || !path.isAbsolute(scriptPath)) throw new Error('Claude MCP 入口路径无效');
    data.mcpServers ||= {};
    data.mcpServers.session_status = { type: 'stdio', command: resolveNode(), args: [scriptPath] };
  } else {
    if (!owned(current)) return { removed: false };
    delete data.mcpServers.session_status;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.agent-things-backup`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file);
  return { removed: !enabled };
}
module.exports = { installClaudeMcp: options => updateClaudeMcp(options), disableClaudeMcp: options => updateClaudeMcp({ ...options, enabled: false }) };
