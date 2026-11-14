'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launchd = require('../src/launchd.cjs');
const { resolveNode } = require('../src/resolve.cjs');
const { DEFAULT_STATE_FILE } = require('../src/harnesses/claude/claude-service.cjs');
const LABEL = 'com.agentthings.claude';
const PLIST_PATH = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
async function install({ root } = {}) {
  const directory = path.dirname(DEFAULT_STATE_FILE);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await launchd.bootout(LABEL);
  launchd.writePlist({ Label: LABEL, ProgramArguments: [resolveNode(), path.join(root, 'bin/claude-session-status.cjs'), '--daemon'],
    RunAtLoad: true, KeepAlive: { SuccessfulExit: false }, ThrottleInterval: 10,
    EnvironmentVariables: { NODE_OPTIONS: '', NODE_PATH: '' },
    StandardOutPath: path.join(directory, 'daemon.log'), StandardErrorPath: path.join(directory, 'daemon.err.log') }, PLIST_PATH);
  launchd.bootstrap(PLIST_PATH);
}
async function uninstall() { await launchd.bootout(LABEL); fs.rmSync(PLIST_PATH, { force: true }); }
module.exports = { install, uninstall, LABEL, PLIST_PATH };
