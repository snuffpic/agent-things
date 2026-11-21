#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AntigravityService, DEFAULT_PORT, DEFAULT_STATE_FILE } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { AntigravityInjector } = require('../src/harnesses/antigravity/antigravity-injector.cjs');
const { ANTIGRAVITY_CDP_PORT } = require('../src/cdp.cjs');
const { requestProgressHttp } = require('../src/local-progress-http.cjs');
const { assertIntegrationEnabled } = require('../src/cli/integration-state.cjs');
const { serveMcp } = require('../src/mcp-stdio.cjs');
const { readConfiguredLang } = require('../src/i18n.cjs');

function readAntigravityAutostart(stateDir) {
  const defaults = { app: '/Applications/Antigravity.app', port: ANTIGRAVITY_CDP_PORT, allowClientRestart: true };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(stateDir, 'autostart.json'), 'utf8'));
    return {
      ...defaults,
      ...(raw && typeof raw === 'object' ? raw : {}),
      app: typeof raw?.app === 'string' && raw.app.trim() ? raw.app : defaults.app,
      port: Number.isInteger(raw?.port) && raw.port > 0 ? raw.port : defaults.port,
      allowClientRestart: raw?.allowClientRestart !== false,
    };
  } catch {
    return defaults;
  }
}

function resolveBridgePath(stateDir) {
  const candidates = [
    process.env.AGENT_THINGS_BRIDGE_PATH,
    path.join(os.homedir(), 'Library/Application Support/CodexSessionStatus/bridge'),
    path.join(stateDir, 'bridge'),
  ].filter(Boolean);
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

async function main() {
  const args = process.argv.slice(2);
  const en = readConfiguredLang() === 'en';
  if (args.some(arg => !['--daemon', '--watch-startup', '--no-ui', '--help', '-h', 'help'].includes(arg))) throw new Error(en ? 'Unknown Antigravity service option' : '未知 Antigravity 服务选项');
  if (args.some(arg => ['--help', '-h', 'help'].includes(arg))) {
    console.log(en
      ? 'Usage: antigravity-session-status [--daemon] [--watch-startup] [--no-ui]; Agent Things (Antigravity) daemon and MCP stdio service.'
      : '用法：antigravity-session-status [--daemon] [--watch-startup] [--no-ui]；Agent Things (Antigravity) 后台与 MCP stdio 服务。');
    return;
  }
  const isDaemon = process.argv.includes('--daemon');
  const watchStartup = isDaemon && process.argv.includes('--watch-startup') && !process.argv.includes('--no-ui');
  const port = Number(process.env.SESSION_STATUS_PORT ?? DEFAULT_PORT);
  const stateFile = process.env.SESSION_STATUS_STATE_FILE || DEFAULT_STATE_FILE;
  let service = null, injector = null, watcher = null, stopping = false, refreshing = false, remote = false;
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
    stopping = true; clearInterval(timer); watcher?.stop(); await injector?.stop();
    if (service) await service.stop();
  };
  if (watchStartup && process.platform === 'darwin') {
    const stateDir = path.dirname(stateFile);
    const bridgePath = resolveBridgePath(stateDir);
    if (bridgePath) {
      const settings = readAntigravityAutostart(stateDir);
      watcher = require('../src/startup/watch.cjs').startWatcher({
        root: stateDir,
        settings: {
          ...settings,
          bridgePath,
          stateFile: path.join(stateDir, 'startup-state.json'),
        },
        log: message => console.log(message),
        onLaunch: () => { void refresh(); },
      });
      watcher.exited.catch(error => {
        console.error(error.message);
        shutdown().then(() => { process.exitCode = 1; });
      });
    }
  }
  const antigravityTools = toolLang => {
    const isEn = toolLang === 'en';
    return [
      {
        name: 'render_things_card',
        description: isEn
          ? 'Generate and return the inline Agent Things session progress card artifact and embed tag for the current Antigravity conversation in one step.'
          : '在当前 Antigravity 会话生成并返回 Agent Things 任务进度信息流卡片工件与内嵌标签。一步完成读取、卡片工件生成与回复文本。',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: { type: 'string', minLength: 1, description: isEn ? 'Conversation ID of the current session' : '当前会话的 Conversation ID' },
            artifact_dir: { type: 'string', description: isEn ? 'Artifact directory path (optional)' : '工件目录路径（可选）' },
          },
          required: ['conversation_id'],
          additionalProperties: false,
        },
      },
    ];
  };

  if (!isDaemon) serveMcp({ name: 'antigravity-session-status', extraTools: antigravityTools, callTool: async (name, args) => {
    await ensureService();
    return (await request('/tools', { name, args })).result;
  }, onClose: shutdown });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }));
}

if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { main };
