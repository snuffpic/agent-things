'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
function assertIntegrationEnabled(app) {
  const file = path.join(os.homedir(), 'Library/Application Support/CodexSessionStatus/config.json');
  if (!fs.existsSync(file)) return; // Standalone MCP installation.
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const en = config?.lang === 'en';
  if (!Array.isArray(config.enabledApps)) throw new Error(en ? 'Invalid plugin configuration' : '插件启用配置无效');
  if (!config.enabledApps.includes(app)) {
    throw Object.assign(new Error(en ? 'Integration for this application is disabled; please reload the host MCP configuration.' : '此应用的插件已停用，请重新加载宿主 MCP 配置。'), { code: 'INTEGRATION_DISABLED' });
  }
}
module.exports = { assertIntegrationEnabled };
