'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installCodexMcp, disableCodexMcp } = require('../src/codex-mcp-config.cjs');

test('installCodexMcp and disableCodexMcp modify config.toml cleanly', t => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-config-test-'));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

  const configFile = path.join(tempHome, 'config.toml');
  fs.writeFileSync(configFile, '[mcp_servers.other]\ncommand = "other"\n');

  // 1. 首次安装
  const installRes = installCodexMcp({
    codexHome: tempHome,
    scriptPath: '/path/to/bin/codex-session-status.cjs',
    nodeBin: '/usr/local/bin/node',
  });
  assert.equal(installRes.success, true);

  let content = fs.readFileSync(configFile, 'utf8');
  assert.ok(content.includes('[mcp_servers.session_status]'));
  assert.ok(content.includes('command = "/usr/local/bin/node"'));
  assert.ok(content.includes('[mcp_servers.other]'));

  // 2. 幂等重复安装（应替换而非重复追加，且不能残留 args 数组孤儿片段）
  installCodexMcp({
    codexHome: tempHome,
    scriptPath: '/path/to/bin/codex-session-status.cjs',
    nodeBin: '/opt/homebrew/bin/node',
  });
  content = fs.readFileSync(configFile, 'utf8');
  assert.equal(content.split('[mcp_servers.session_status]').length, 2); // 仅出现一次
  assert.ok(content.includes('command = "/opt/homebrew/bin/node"'));
  assert.equal(content.split('startup_timeout_sec').length, 2); // 确保只有1处超时参数
  assert.equal(content.split('tool_timeout_sec').length, 2); // 确保只有1处工具超时参数
  assert.equal(content.split('args = [').length, 2); // 确保只有1处 args 定义
  assert.ok(!content.includes('command = "/usr/local/bin/node"'));

  // 3. 卸载（应完全清除，无任何悬挂残片）
  const disableRes = disableCodexMcp({ codexHome: tempHome });
  assert.equal(disableRes.success, true);
  content = fs.readFileSync(configFile, 'utf8');
  assert.equal(content.includes('[mcp_servers.session_status]'), false);
  assert.equal(content.includes('startup_timeout_sec'), false);
  assert.equal(content.includes('tool_timeout_sec'), false);
  assert.equal(content.includes('args = ['), false);
  assert.ok(content.includes('[mcp_servers.other]'));
});

test('a foreign session_status configuration is preserved', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-foreign-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, 'config.toml');
  const content = '[mcp_servers.session_status]\ncommand = "foreign"\n';
  fs.writeFileSync(file, content);
  assert.throws(() => installCodexMcp({ codexHome: home }), /其他服务/);
  assert.equal(disableCodexMcp({ codexHome: home }).removed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
});
