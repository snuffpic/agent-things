#!/usr/bin/env node
'use strict';
const { AntigravityService, DEFAULT_PORT, DEFAULT_STATE_FILE } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { AntigravityInjector } = require('../src/harnesses/antigravity/antigravity-injector.cjs');
const { requestProgressHttp } = require('../src/local-progress-http.cjs');
const { assertIntegrationEnabled } = require('../src/cli/integration-state.cjs');
const { serveMcp } = require('../src/mcp-stdio.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--daemon', '--no-ui', '--help', '-h', 'help'].includes(arg))) throw new Error('未知 Antigravity 服务选项');
  if (args.some(arg => ['--help', '-h', 'help'].includes(arg))) { console.log('用法：antigravity-session-status [--daemon] [--no-ui]；Agent Things (Antigravity) 后台与 MCP stdio 服务。'); return; }
  const isDaemon = process.argv.includes('--daemon');
  const port = Number(process.env.SESSION_STATUS_PORT ?? DEFAULT_PORT);
  const stateFile = process.env.SESSION_STATUS_STATE_FILE || DEFAULT_STATE_FILE;
  let service = null, injector = null, stopping = false, refreshing = false, remote = false;
  const request = (route, body) => requestProgressHttp(stateFile, route, body, port);
  const ensureService = async () => {
    assertIntegrationEnabled('antigravity');
    if (service || stopping) return;
    if (remote) {
      try { await request('/health'); return; }
      catch { remote = false; }
    }
    const candidate = new AntigravityService({ port, stateFile });
    try { await candidate.start(); }
    catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      // Binding is the ownership decision. Another starting owner may still be
      // publishing its credential file, so verify its identity before reuse.
      for (let attempt = 0; attempt < 20; attempt++) {
        try { await request('/health'); remote = true; return; }
        catch (failure) {
          if (attempt === 19) throw failure;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
    }
    service = candidate;
    injector = process.argv.includes('--no-ui') ? null : new AntigravityInjector(service.http.credentials, { allowOrigin: origin => service.http.allowOrigin(origin) });
  };
  await ensureService();
  const refresh = async () => {
    if (refreshing || stopping) return;
    refreshing = true;
    try { await ensureService(); await injector?.scan(); }
    catch (error) {
      if (error.code === 'INTEGRATION_DISABLED') await shutdown();
      else process.stderr.write(`[agent-things antigravity] ${error.message}\n`);
    }
    finally { refreshing = false; }
  };
  const timer = setInterval(refresh, 2500);
  void refresh();
  const shutdown = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer); await injector?.stop();
    if (service) await service.stop();
  };
  const antigravityTools = [
    {
      name: 'render_things_card',
      description: '在当前 Antigravity 会话生成并返回 Agent Things 任务进度信息流卡片工件与内嵌标签。一步完成读取、卡片工件生成与回复文本。',
      inputSchema: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string', minLength: 1, description: '当前会话的 Conversation ID' },
          artifact_dir: { type: 'string', description: '工件目录路径（可选）' },
        },
        required: ['conversation_id'],
        additionalProperties: false,
      },
    },
  ];

  if (!isDaemon) serveMcp({ name: 'antigravity-session-status', extraTools: antigravityTools, callTool: async (name, args) => {
    await ensureService();
    return (await request('/tools', { name, args })).result;
  }, onClose: shutdown });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { main };
