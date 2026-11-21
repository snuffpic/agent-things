'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execSync, execFileSync } = require('node:child_process');
const { listTargets, isMainWindow } = require('../cdp.cjs');

async function probeDshDiagnostics({ dshHome, env = process.env, home = os.homedir() } = {}) {
  const stateFile = env?.AGENT_THINGS_DSH_STATE?.trim()
    ? path.resolve(env.AGENT_THINGS_DSH_STATE.trim())
    : (process.platform === 'darwin'
        ? path.join(home, 'Library/Application Support/AgentThings/deepseek/manual-state.json')
        : path.join(dshHome || path.join(home, '.dsh'), 'agent-things/manual-state.json'));
  const dir = path.dirname(stateFile);
  const bridgeFile = env?.AGENT_THINGS_DSH_BRIDGE?.trim()
    ? path.resolve(env.AGENT_THINGS_DSH_BRIDGE.trim())
    : path.join(dir, 'bridge.json');
  const analysisConfigFile = path.join(dir, 'analysis-config.json');

  let markedSessions = 0;
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      markedSessions = Object.values(state?.records || {}).filter(record => record && record.state).length;
    }
  } catch { /* ignore unreadable state */ }

  let analysisConfig = { mode: 'default', provider: null, model: null, reasoningEffort: null };
  try {
    if (fs.existsSync(analysisConfigFile)) {
      const cfg = JSON.parse(fs.readFileSync(analysisConfigFile, 'utf8'));
      analysisConfig = {
        mode: cfg?.mode === 'custom' ? 'custom' : 'default',
        provider: cfg?.mode === 'custom' && typeof cfg?.provider === 'string' ? cfg.provider : null,
        model: cfg?.mode === 'custom' && typeof cfg?.model === 'string' ? cfg.model : null,
        reasoningEffort: typeof cfg?.reasoningEffort === 'string' && cfg.reasoningEffort ? cfg.reasoningEffort : null,
      };
    }
  } catch { /* ignore unreadable config */ }

  const bridge = { configured: false, reachable: false, port: null, pid: null };
  try {
    if (fs.existsSync(bridgeFile)) {
      const creds = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
      if (creds?.service === 'agent-things-dsh' && Number.isInteger(creds.port) && creds.port > 0 && typeof creds.token === 'string') {
        bridge.configured = true;
        bridge.port = creds.port;
        bridge.pid = Number.isInteger(creds.pid) ? creds.pid : null;
        try {
          const res = await fetch(`http://127.0.0.1:${creds.port}/health`, {
            headers: { Authorization: `Bearer ${creds.token}` },
            signal: AbortSignal.timeout(500),
          });
          if (res.ok) {
            const payload = await res.json();
            if (payload?.ok && payload?.service === 'agent-things-dsh') {
              bridge.reachable = true;
              if (Number.isInteger(payload.pid)) bridge.pid = payload.pid;
            }
          }
        } catch { /* bridge process no longer active */ }
      }
    }
  } catch { /* ignore unreadable bridge credentials */ }

  return { stateFile, markedSessions, analysisConfig, bridge };
}

function checkPort(port, timeoutMs = 250) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = value => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

function resolveBin(name) {
  try {
    const res = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (res && fs.existsSync(res)) return res;
  } catch {}
  for (const dir of ['/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.local/bin')]) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function isAppRunning(executable) {
  const output = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' });
  return output.split('\n').some(line => line.trim() === executable);
}

async function probeEnvironment() {
  const home = os.homedir();

  // 1. Codex (ChatGPT.app)
  const codexAppPath = fs.existsSync('/Applications/ChatGPT.app') ? '/Applications/ChatGPT.app' : null;
  const codexRunning = isAppRunning('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT');
  let codexPortActive = false;
  try { codexPortActive = (await listTargets(39222, 500)).some(isMainWindow); } catch {}

  // 2. Antigravity
  const antigravityApp = fs.existsSync('/Applications/Antigravity.app');
  const antigravityInstalled = antigravityApp;
  let antigravityPort = null;
  const devToolsFile = path.join(home, 'Library/Application Support/Antigravity/DevToolsActivePort');
  if (fs.existsSync(devToolsFile)) {
    try {
      const line = fs.readFileSync(devToolsFile, 'utf8').trim().split('\n')[0];
      const p = Number(line);
      if (p > 0 && await checkPort(p)) antigravityPort = p;
    } catch {}
  }

  // 3. agy CLI
  const agyPath = resolveBin('agy');

  // 4. Claude Desktop
  const claudeApp = fs.existsSync('/Applications/Claude.app') ? '/Applications/Claude.app' : null;

  // 5. DeepSeek Harness (dsh)
  const { probeDshRuntime } = require('../harnesses/deepseek/dsh-installer.cjs');
  const dshRuntime = probeDshRuntime();
  const dshDiag = await probeDshDiagnostics({ dshHome: dshRuntime.dshHome });

  return {
    codex: {
      id: 'codex',
      name: 'Codex (ChatGPT)',
      installed: Boolean(codexAppPath),
      path: codexAppPath,
      running: codexRunning,
      portActive: codexPortActive,
    },
    antigravity: {
      id: 'antigravity',
      name: 'Antigravity',
      installed: antigravityInstalled,
      path: antigravityApp ? '/Applications/Antigravity.app' : null,
      running: isAppRunning('/Applications/Antigravity.app/Contents/MacOS/Antigravity'),
      port: antigravityPort,
    },
    agy: {
      id: 'agy',
      name: 'agy CLI',
      installed: Boolean(agyPath),
      path: agyPath,
    },
    claude: {
      id: 'claude',
      name: 'Claude Desktop',
      installed: Boolean(claudeApp),
      path: claudeApp,
      running: isAppRunning('/Applications/Claude.app/Contents/MacOS/Claude'),
    },
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek Harness',
      installed: dshRuntime.installed,
      path: dshRuntime.binary,
      nodeVersion: dshRuntime.nodeVersion,
      nodeCompatible: dshRuntime.nodeCompatible,
      dshHome: dshRuntime.dshHome,
      profiles: dshRuntime.profiles,
      pluginProfiles: dshRuntime.pluginProfiles,
      profileLinks: dshRuntime.profileLinks,
      healthyPluginProfiles: dshRuntime.healthyPluginProfiles,
      brokenPluginProfiles: dshRuntime.brokenPluginProfiles,
      bundleReady: dshRuntime.bundleReady,
      pluginInstalled: dshRuntime.pluginInstalled,
      stateFile: dshDiag.stateFile,
      markedSessions: dshDiag.markedSessions,
      analysisConfig: dshDiag.analysisConfig,
      bridge: dshDiag.bridge,
    },
  };
}

function formatProbeText(item, lang = 'zh') {
  const isZh = lang === 'zh';
  if (!item?.installed) {
    return isZh ? '未检测到应用' : 'Not detected';
  }
  const displayPath = item.path ? item.path.replace(os.homedir(), '~') : '';
  if (item.id === 'codex') {
    if (item.portActive) return isZh ? `运行中 (CDP: 39222 可用)` : `Running (CDP: 39222 available)`;
    if (item.running) return isZh ? `运行中 (无调试端口，需重启)` : `Running (No debug port, restart needed)`;
    return isZh ? `已安装 (${displayPath})` : `Installed (${displayPath})`;
  }
  if (item.id === 'antigravity') {
    if (item.port) return isZh ? `运行中 (调试端口: ${item.port} 可达)` : `Running (Debug port: ${item.port} reachable)`;
    if (item.running) return isZh ? '运行中 (无调试端口，需重启)' : 'Running (No debug port, restart needed)';
    return isZh ? `已安装 (${displayPath})` : `Installed (${displayPath})`;
  }
  if (item.id === 'agy') {
    return isZh ? `已就绪 (${displayPath})` : `Ready (${displayPath})`;
  }
  if (item.id === 'claude') {
    return isZh ? `已安装 (${displayPath})` : `Installed (${displayPath})`;
  }
  if (item.id === 'deepseek') {
    if (item.nodeCompatible === false) {
      return isZh
        ? `需 Node >= 24.9 (当前: ${item.nodeVersion || '未知'})`
        : `Needs Node >= 24.9 (found: ${item.nodeVersion || 'unknown'})`;
    }
    if (Array.isArray(item.brokenPluginProfiles) && item.brokenPluginProfiles.length > 0 && !(item.healthyPluginProfiles?.length)) {
      const brokenNote = item.brokenPluginProfiles.join(', ');
      return isZh ? `插件链接异常 (${brokenNote})` : `Broken plugin link (${brokenNote})`;
    }
    if (item.bridge?.reachable && item.bridge?.port) {
      const profileNote = item.profiles?.length ? item.profiles.join(', ') : 'web';
      return isZh ? `运行中 (${profileNote} · 桥接 :${item.bridge.port})` : `Running (${profileNote} · bridge :${item.bridge.port})`;
    }
    const profileNote = item.profiles?.length ? item.profiles.join(', ') : 'web';
    return isZh ? `已就绪 (${profileNote})` : `Ready (${profileNote})`;
  }
  return isZh ? `已就绪` : `Ready`;
}

module.exports = {
  probeEnvironment,
  probeDshDiagnostics,
  isAppRunning,
  formatProbeText,
  checkPort,
  resolveBin,
};
