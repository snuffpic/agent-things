#!/usr/bin/env node
'use strict';
const { ClaudeService, DEFAULT_PORT, DEFAULT_STATE_FILE } = require('../src/harnesses/claude/claude-service.cjs');
const { ClaudeInjector } = require('../src/harnesses/claude/claude-injector.cjs');
const { requestProgressHttp } = require('../src/local-progress-http.cjs');
const { serveMcp } = require('../src/mcp-stdio.cjs');
const { assertIntegrationEnabled } = require('../src/cli/integration-state.cjs');
const { readConfig } = require('../src/cli/setup-orchestrator.cjs');
const { readConfiguredLang } = require('../src/i18n.cjs');

async function main(args = process.argv.slice(2)) {
  const en = readConfiguredLang() === 'en';
  if (args.some(arg => !['--daemon', '--no-ui', '--help', '-h'].includes(arg))) throw new Error(en ? 'Unknown Claude service option' : '未知 Claude 服务选项');
  if (args.includes('--help') || args.includes('-h')) {
    console.log(en
      ? 'Usage: claude-session-status [--daemon] [--no-ui]; Agent Things (Claude) daemon and MCP stdio service.'
      : '用法：claude-session-status [--daemon] [--no-ui]；Agent Things (Claude) 后台与 MCP stdio 服务。');
    return;
  }
  assertIntegrationEnabled('claude');
  const stateFile = process.env.SESSION_STATUS_STATE_FILE || DEFAULT_STATE_FILE;
  const port = Number(process.env.SESSION_STATUS_PORT ?? DEFAULT_PORT);
  let service = null, injector = null, stopping = false, refreshing = false;
  const request = (route, body) => requestProgressHttp(stateFile, route, body, port || undefined);
  try { await request('/health'); }
  catch {
    service = new ClaudeService({ stateFile, port });
    try { await service.start(); }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; await request('/health'); service = null; }
    if (service && !args.includes('--no-ui')) injector = new ClaudeInjector({ stateFile });
  }
  const refresh = async () => {
    if (stopping || refreshing) return;
    refreshing = true;
    try { assertIntegrationEnabled('claude'); await injector?.scan(); }
    catch (error) { if (error.code === 'INTEGRATION_DISABLED') await stop(); else process.stderr.write(`[agent-things claude] ${error.message}\n`); }
    finally { refreshing = false; }
  };
  const timer = setInterval(refresh, 1000);
  const stop = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    // A replacement daemon adopts the live host. Disabling the integration
    // removes its UI before the service disappears.
    if (service && injector?.attachedPid && !readConfig()?.enabledApps.includes('claude')) await Promise.race([service.requestHost('detach', '').catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
    await service?.stop();
  };
  void refresh();
  if (!args.includes('--daemon')) serveMcp({ name: 'claude-session-status', callTool: async (name, toolArgs) => {
    assertIntegrationEnabled('claude'); return (await request('/tools', { name, args: toolArgs })).result;
  }, onClose: stop });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }); });
}
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { main };
