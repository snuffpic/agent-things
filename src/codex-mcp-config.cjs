'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex');
const DEFAULT_SCRIPT_PATH = path.join(os.homedir(), 'Library/Application Support/CodexSessionStatus/runtime/bin/codex-session-status.cjs');
const SECTION_REGEX = /(?:^|\r?\n)\[mcp_servers\.session_status\](?:\r?\n(?!\[).*)*(?:\r?\n|$)/;

function getConfigFile(codexHome = DEFAULT_CODEX_HOME) {
  return path.join(codexHome, 'config.toml');
}

function installCodexMcp({
  codexHome = DEFAULT_CODEX_HOME,
  scriptPath = DEFAULT_SCRIPT_PATH,
  nodeBin = process.execPath
} = {}) {
  const file = getConfigFile(codexHome);
  if (!fs.existsSync(file)) {
    throw new Error(`未找到 Codex 配置文件：${file}`);
  }

  const content = fs.readFileSync(file, 'utf8');
  const sectionHeader = '[mcp_servers.session_status]';
  const existing = content.match(SECTION_REGEX)?.[0];
  if (existing && !existing.includes('codex-session-status.cjs')) throw new Error('Codex session_status 名称已被其他服务使用');
  const sectionContent = `[mcp_servers.session_status]\ncommand = ${JSON.stringify(nodeBin)}\nargs = [${JSON.stringify(scriptPath)}, "mcp"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 3600`;

  let updated;
  if (content.includes(sectionHeader)) {
    updated = content.replace(SECTION_REGEX, (match, offset) => {
      const prefix = offset === 0 ? '' : '\n';
      return `${prefix}${sectionContent}\n\n`;
    }).trimEnd() + '\n';
  } else {
    updated = content.trimEnd() + '\n\n' + sectionContent + '\n';
  }

  fs.writeFileSync(`${file}.bak`, content, { mode: 0o600 });
  fs.writeFileSync(file, updated, { mode: 0o600 });

  return { success: true, file, server: 'session_status', scriptPath };
}

function disableCodexMcp({ codexHome = DEFAULT_CODEX_HOME }) {
  const file = getConfigFile(codexHome);
  if (!fs.existsSync(file)) return { success: false, reason: 'file_not_found' };

  const content = fs.readFileSync(file, 'utf8');
  const sectionHeader = '[mcp_servers.session_status]';
  if (!content.includes(sectionHeader)) return { success: true, removed: false };
  if (!content.match(SECTION_REGEX)?.[0].includes('codex-session-status.cjs')) return { success: true, removed: false, reason: 'not_owned' };

  const updated = content.replace(SECTION_REGEX, '\n').trimEnd() + '\n';

  fs.writeFileSync(`${file}.bak`, content, { mode: 0o600 });
  fs.writeFileSync(file, updated, { mode: 0o600 });

  return { success: true, removed: true };
}

module.exports = {
  getConfigFile,
  installCodexMcp,
  disableCodexMcp,
};
