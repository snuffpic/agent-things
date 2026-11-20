'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const DEFAULT_FILE = path.join(os.homedir(), '.gemini/antigravity/mcp_config.json');
const UNIFIED_RELATIVE = '.gemini/config/mcp_config.json';
const LEGACY_RELATIVE = '.gemini/antigravity/mcp_config.json';
const owned = server => Array.isArray(server?.args) && server.args.some(arg => typeof arg === 'string' && path.basename(arg) === 'antigravity-session-status.cjs');
function resolveConfigFiles({ file, homeDirectory = os.homedir() } = {}) {
  if (file) return [file];
  const files = [path.join(homeDirectory, LEGACY_RELATIVE)];
  const unified = path.join(homeDirectory, UNIFIED_RELATIVE);
  if (fs.existsSync(unified)) files.push(unified);
  return files;
}
function mergeServerConfig(existing, nodeBin, scriptPath) {
  const existingTools = existing?.tools && typeof existing.tools === 'object' ? existing.tools : {};
  const existingRenderTool = existingTools.render_things_card && typeof existingTools.render_things_card === 'object'
    ? existingTools.render_things_card
    : {};
  return {
    command: nodeBin,
    args: [scriptPath],
    tools: {
      ...existingTools,
      render_things_card: {
        ...existingRenderTool,
        eager: true,
      },
    },
  };
}
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
function installAntigravityMcp({ file, homeDirectory = os.homedir(), scriptPath, nodeBin = process.execPath } = {}) {
  for (const target of resolveConfigFiles({ file, homeDirectory })) {
    updateConfig(target, servers => {
      const key = Object.keys(servers).find(key => owned(servers[key])) || 'session_status';
      if (servers[key] && !owned(servers[key])) throw new Error('Antigravity session_status 名称已被其他服务使用');
      servers[key] = mergeServerConfig(servers[key], nodeBin, scriptPath);
      return true;
    });
  }
}
function disableAntigravityMcp({ file, homeDirectory = os.homedir() } = {}) {
  for (const target of resolveConfigFiles({ file, homeDirectory })) {
    if (!fs.existsSync(target)) continue;
    updateConfig(target, servers => {
      const keys = Object.keys(servers).filter(key => owned(servers[key]));
      for (const key of keys) delete servers[key];
      return keys.length > 0;
    });
  }
}
module.exports = { installAntigravityMcp, disableAntigravityMcp, resolveConfigFiles };
