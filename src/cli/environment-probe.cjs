'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execSync, execFileSync } = require('node:child_process');
const { listTargets, isMainWindow } = require('../cdp.cjs');

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
    return isZh ? `已安装 (${displayPath})` : `Installed (${displayPath})`;
  }
  if (item.id === 'agy') {
    return isZh ? `已就绪 (${displayPath})` : `Ready (${displayPath})`;
  }
  if (item.id === 'claude') {
    return isZh ? `已安装 (${displayPath})` : `Installed (${displayPath})`;
  }
  return isZh ? `已就绪` : `Ready`;
}

module.exports = {
  probeEnvironment,
  isAppRunning,
  formatProbeText,
  checkPort,
  resolveBin,
};
