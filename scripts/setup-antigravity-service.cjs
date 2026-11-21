#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');
const { ANTIGRAVITY_CDP_PORT } = require('../src/cdp.cjs');
const { prepareStartup } = require('../src/runtime-install.cjs');

const PLIST_NAME = 'com.antigravity.session-status.plist';
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = path.join(LAUNCH_AGENTS_DIR, PLIST_NAME);
const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'bin', 'antigravity-session-status.cjs');
const LOG_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'session-status');
const DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'CodexSessionStatus');
const ANTIGRAVITY_APP = '/Applications/Antigravity.app';

function getAvailableNode() {
  const candidates = [
    process.execPath,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    path.join(os.homedir(), '.bun/bin/bun'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'node';
}

async function install({ root = ROOT, dataDir = DATA_DIR, logDir = LOG_DIR } = {}) {
  const launchd = require('../src/launchd.cjs');
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const copyBridge = !fs.existsSync(path.join(dataDir, 'bridge')) && fs.existsSync(path.join(root, 'native/bin/bridge'));
  prepareStartup(root, dataDir, {
    app: ANTIGRAVITY_APP,
    port: ANTIGRAVITY_CDP_PORT,
    autostartFile: path.join(logDir, 'autostart.json'),
    copyBridge,
  });
  await launchd.bootout('com.antigravity.session-status');
  launchd.writePlist({
    Label: 'com.antigravity.session-status',
    ProgramArguments: [getAvailableNode(), path.join(root, 'bin/antigravity-session-status.cjs'), '--daemon', '--watch-startup'],
    RunAtLoad: true, KeepAlive: { SuccessfulExit: false }, ThrottleInterval: 10,
    ProcessType: 'Interactive',
    StandardOutPath: path.join(logDir, 'daemon.log'), StandardErrorPath: path.join(logDir, 'daemon.err.log'),
    EnvironmentVariables: { PATH: process.env.PATH || '/usr/bin:/bin:/opt/homebrew/bin' },
  }, PLIST_PATH);
  launchd.bootstrap(PLIST_PATH);
}

async function uninstall() {
  const launchd = require('../src/launchd.cjs');
  await launchd.bootout('com.antigravity.session-status');
  fs.rmSync(PLIST_PATH, { force: true });
}

function status() {
  try {
    const out = execSync(`launchctl list | grep com.antigravity.session-status || true`, { encoding: 'utf8' });
    if (out.trim()) {
      console.log(`🟢 Running:\n${out.trim()}`);
    } else {
      console.log(`⚪ Not running.`);
    }
  } catch (err) {
    console.error(err.message);
  }
}

if (require.main === module) {
  const cmd = process.argv[2] || 'install';
  if (cmd === 'install') install().catch(error => { console.error(error.message); process.exitCode = 1; });
  else if (cmd === 'uninstall') uninstall().catch(error => { console.error(error.message); process.exitCode = 1; });
  else if (cmd === 'status') status();
  else {
    console.log('Usage: setup-antigravity-service.cjs [install|uninstall|status]');
  }
}

module.exports = { install, uninstall, status, PLIST_PATH };
