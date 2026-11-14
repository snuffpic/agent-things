#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { tryAcquirePidLock } = require('../src/state-file-lock.cjs');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { ManualStatusAgent, attachmentStatus } = require('../src/manual-status-agent.cjs');
const { CDP_PORT } = require('../src/cdp.cjs');
const { installAutostart, disableAutostart, startupStatus } = require('../src/manual-status-startup.cjs');
const { installCodexMcp, disableCodexMcp } = require('../src/codex-mcp-config.cjs');
const { runInteractiveCli, showHealthStatus } = require('../src/cli/interactive-cli.cjs');

function resolveSessionKey(store, convId) { return store.resolveKey(convId); }

async function runMcpServer({ store, directory, port }) {
  const { assertIntegrationEnabled } = require('../src/cli/integration-state.cjs');
  assertIntegrationEnabled('codex');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'agent.lock');

  let agent = null;
  let scanTimer = null;
  const canRunAgent = tryAcquirePidLock(lock);

  if (canRunAgent) {
    try {
      store.recoverPending();
      agent = new ManualStatusAgent({
        store,
        port,
        logFile: path.join(os.homedir(), 'Library', 'Logs', 'CodexSessionStatus', 'analysis.jsonl'),
        onError: err => process.stderr.write(`[agent-things codex] ${err.message}\n`),
      });
      await agent.startControl();
      const scan = async () => {
        try { assertIntegrationEnabled('codex'); await agent.scan(); }
        catch (error) { if (error.code === 'INTEGRATION_DISABLED') await cleanup(); }
      };
      scanTimer = setInterval(scan, 2500);
      scan();
    } catch (err) {
      if (agent) { await agent.stop(); agent = null; }
      if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock);
      if (err.code !== 'EEXIST') throw err;
    }
  }


  async function cleanup() {
    if (scanTimer) clearInterval(scanTimer);
    if (agent) {
      try { await agent.stop(); } catch {}
      agent = null;
    }
    if (fs.existsSync(lock)) {
      try {
        if (fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) {
          fs.unlinkSync(lock);
        }
      } catch {}
    }
  };

  const { serveMcp } = require('../src/mcp-stdio.cjs');
  const { requestProgressHttp } = require('../src/local-progress-http.cjs');
  const { createCodexCard, tools: extraTools, resource } = require('../src/harnesses/codex/codex-card.cjs');
  const card = createCodexCard({ store });
  serveMcp({ name: 'codex-session-status', extraTools, resource,
    onClose: async () => {
      card.stopEvents();
      if (agent?.analysisService) await Promise.allSettled([...agent.analysisService.active.values()].map(job => job.promise));
      await cleanup();
    },
    callTool: async (name, args, meta, options) => {
      assertIntegrationEnabled('codex');
      if (extraTools.some(tool => tool.name === name)) return card.call(name, args, meta, options);
      return (await requestProgressHttp(store.file, '/tools', { name, args }, undefined, options)).value;
    },
  });

  process.once('SIGINT', () => cleanup().then(() => process.exit(0)));
  process.once('SIGTERM', () => cleanup().then(() => process.exit(0)));
}

async function main() {
  const options = require('../src/cli/arguments.cjs').parseArguments(process.argv.slice(2));
  if (options.command === 'setup') {
    await runInteractiveCli({ yes: options.yes, lang: options.lang });
    return;
  }
  if (options.command === 'doctor') {
    await showHealthStatus();
    return;
  }
  const { command, port, watchStartup } = options;
  const directory = options.directory || path.join(os.homedir(), 'Library/Application Support/CodexSessionStatus');

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log('用法：agent-things [command] [options]\n');
    console.log('无参数直接运行：启动交互式向导（环境探测、中英切换、App 多选、后台无感常驻）\n');
    console.log('核心命令：');
    console.log('  setup         交互式安装与管理；--yes/--all 自动配置已安装的支持应用；--lang zh|en');
    console.log('  doctor        查看客户端、后台和挂载诊断');
    console.log('  run           前台运行调试模式，连接 39222 端口并挂载 UI (按 Ctrl+C 退出)');
    console.log('  status        查看已记录会话进度快照 (JSON)');
    console.log('  mcp           作为原生 MCP 伴生服务运行 (JSON-RPC stdio)');
    console.log('  install-mcp   将本服务写入 ~/.codex/config.toml 中作为原生伴生 MCP 服务');
    console.log('  disable-mcp   从 ~/.codex/config.toml 中移除伴生 MCP 服务');
    console.log('  update-renderer / install-autostart / disable-autostart：高级面板更新与Codex后台管理');
    console.log('  run/status/mcp 支持 --port；run/status/mcp/update-renderer/install-autostart 支持 --data-dir；run 支持 --watch-startup');
    return;
  }

  if (command === 'install-mcp') {
    const scriptPath = path.join(directory, 'runtime/bin/codex-session-status.cjs');
    if (!fs.existsSync(scriptPath)) throw new Error('请先运行 agent-things setup 安装运行时。');
    const res = installCodexMcp({ scriptPath });
    console.log(`✅ 已成功将 Agent Things (session_status) 注册为 Codex 原生伴生 MCP 服务！\n配置文件：${res.file}`);
    return;
  }

  if (command === 'disable-mcp') {
    const res = disableCodexMcp({});
    console.log(res.removed ? '✅ 已从 ~/.codex/config.toml 中移除 Agent Things (session_status) 伴生配置。' : 'ℹ️ 未发现 Agent Things (session_status) 配置。');
    return;
  }

  if (command === 'update-renderer') {
    const resources = ['session-status.js', 'harnesses/codex/codex-harness.js', 'ui-foundation.cjs'].map(name => {
      const source = path.join(__dirname, '../src', name);
      const destination = path.join(directory, 'runtime/src', name);
      if (name !== 'ui-foundation.cjs' && !fs.existsSync(destination)) throw new Error('未找到已安装的渲染资源');
      const contents = fs.readFileSync(source);
      new vm.Script(contents.toString('utf8'));
      return { contents, destination };
    });
    for (const { contents, destination } of resources) {
      const temporary = `${destination}.${process.pid}.tmp`;
      try { fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, destination); }
      finally { fs.rmSync(temporary, { force: true }); }
    }
    console.log('渲染资源已更新');
    return;
  }

  if (command === 'install-autostart') {
    console.log('正在设置后台自动挂载…');
    console.log(JSON.stringify(await installAutostart(directory), null, 2));
    return;
  }

  if (command === 'disable-autostart') {
    await disableAutostart();
    console.log('已关闭自动挂载，手动记录保留。');
    return;
  }

  const store = new ManualStatusStore(path.join(directory, 'manual-state.json'));

  if (command === 'status') {
    const data = store.snapshot();
    console.log(JSON.stringify({
      file: store.file,
      revision: data.revision,
      markedConversations: Object.values(data.records).filter(record => record.state).length,
      autostart: startupStatus(directory),
      diagnosticLog: path.join(os.homedir(), 'Library/Logs/CodexSessionStatus/analysis.jsonl'),
      installedRendererVersion: (() => {
        try { return require('../src/renderer-resource.cjs').readRendererResource({ rendererFile: path.join(directory, 'runtime/src/session-status.js'), harnessFile: path.join(directory, 'runtime/src/harnesses/codex/codex-harness.js') }).version; } catch { return null; }
      })(),
      attachment: await attachmentStatus(port),
    }, null, 2));
    return;
  }

  if (command === 'mcp') {
    await runMcpServer({ store, directory, port });
    return;
  }

  if (command !== 'run') throw new Error(`未知命令：${command}`);

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'agent.lock');
  if (!tryAcquirePidLock(lock)) throw new Error('此数据目录已有进程运行，请使用已有进程');
  let agent;
  try {
    store.recoverPending();
    agent = new ManualStatusAgent({
      store, port,
      logFile: path.join(os.homedir(), 'Library/Logs/CodexSessionStatus/analysis.jsonl'),
      onError: error => console.error(error.message),
    });
    await agent.startControl();
  } catch (error) {
    await agent?.stop();
    if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock);
    throw error;
  }
  agent.log('agent.start', { parentPid: process.ppid, revision: store.snapshot().revision });

  let watcher = null;
  let stopping = false;
  let reported = '';
  const scan = async () => {
    try {
      await agent.scan();
      const message = agent.sessions.size ? `已连接 ${agent.sessions.size} 个 Codex 窗口` : '等待 Codex 主窗口';
      if (message !== reported) { console.log(message); reported = message; }
    } catch {
      const message = `等待本地调试端口 ${port}；保存工作后，以 --remote-debugging-port=${port} 启动客户端。`;
      if (message !== reported) { console.log(message); reported = message; }
    }
  };
  const timer = setInterval(scan, 2000);
  let startupScanTimer = null, startupScanEnd = null;
  const boostStartupScan = () => {
    if (stopping) return;
    clearInterval(startupScanTimer); clearTimeout(startupScanEnd);
    const scanUntilConnected = async () => {
      if (agent.scanning) return;
      await scan();
      if (agent.sessions.size) { clearInterval(startupScanTimer); startupScanTimer = null; clearTimeout(startupScanEnd); }
    };
    startupScanTimer = setInterval(scanUntilConnected, 200);
    startupScanEnd = setTimeout(() => { clearInterval(startupScanTimer); startupScanTimer = null; }, 15000);
    scanUntilConnected();
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer); clearInterval(startupScanTimer); clearTimeout(startupScanEnd);
    watcher?.stop();
    try {
      await agent.stop();
    }
    finally {
      if (fs.existsSync(lock) && fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock);
    }
  };
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => stop().then(() => { process.exitCode = 0; }));
  if (watchStartup) {
    const settings = JSON.parse(fs.readFileSync(path.join(directory, 'autostart.json'), 'utf8'));
    watcher = require('../src/startup/watch.cjs').startWatcher({ root: directory, settings, log: console.log, onLaunch: boostStartupScan });
    watcher.exited.catch(error => {
      console.error(error.message);
      stop().then(() => { process.exitCode = 1; });
    });
  }
  await scan();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = error.code === 'CLI_CANCELLED' ? 130 : 1;
  });
}

module.exports = { main, resolveSessionKey, runMcpServer };
