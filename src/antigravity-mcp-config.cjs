'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const DEFAULT_FILE = path.join(os.homedir(), '.gemini/antigravity/mcp_config.json');
const owned = server => Array.isArray(server?.args) && server.args.some(arg => typeof arg === 'string' && path.basename(arg) === 'antigravity-session-status.cjs');
function updateConfig(file, change) {
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const data = original === null ? {} : JSON.parse(original);
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.mcpServers !== undefined && (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)))) throw new Error('Antigravity MCP 配置格式无效');
  data.mcpServers ||= {};
  if (!change(data.mcpServers)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (original !== null) fs.writeFileSync(`${file}.agent-things.bak`, original, { mode: 0o600 });
  const temporary = `${file}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function installAntigravityMcp({ file = DEFAULT_FILE, scriptPath, nodeBin = process.execPath } = {}) {
  updateConfig(file, servers => {
    const key = Object.keys(servers).find(key => owned(servers[key])) || 'session_status';
    if (servers[key] && !owned(servers[key])) throw new Error('Antigravity session_status 名称已被其他服务使用');
    servers[key] = { command: nodeBin, args: [scriptPath] };
    return true;
  });
}
function disableAntigravityMcp({ file = DEFAULT_FILE } = {}) {
  if (!fs.existsSync(file)) return;
  updateConfig(file, servers => {
    const keys = Object.keys(servers).filter(key => owned(servers[key]));
    for (const key of keys) delete servers[key];
    return keys.length > 0;
  });
}
module.exports = { installAntigravityMcp, disableAntigravityMcp };
