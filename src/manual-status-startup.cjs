'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const launchd = require('./launchd.cjs');
const { DEFAULT_APP, resolveCodexBin, resolveNode } = require('./resolve.cjs');
const { installRuntime, prepareStartup, commitInstallation, recoverPendingTransaction } = require('./runtime-install.cjs');
const { withLifecycleLock } = require('./lifecycle-lock.cjs');

const LABEL = 'com.codexsessionstatus.agent';
const plistFile = () => path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const logDirectory = () => path.join(os.homedir(), 'Library/Logs/CodexSessionStatus');

function startupStatus(directory) {
  let state = null;
  const file = path.join(directory, 'state.json');
  if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { enabled: Boolean(launchd.printJob(LABEL)), event: state?.event ?? null,
    updatedAt: state?.updatedAt ?? null, lastAttemptAt: state?.lastAttemptAt ?? null, logDirectory: logDirectory() };
}

async function installAutostartUnlocked(directory) {
  if (process.platform !== 'darwin') throw new Error('自动挂载目前支持 macOS');
  resolveCodexBin(DEFAULT_APP);
  const node = resolveNode();
  const source = path.resolve(__dirname, '..');
  const runtime = path.join(directory, 'runtime');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  prepareStartup(source, directory);
  await launchd.bootout(LABEL);
  try {
    installRuntime(source, runtime, { enabledApps: ['codex'], dataDir: directory, homeDirectory: process.env.HOME || os.homedir() });
    commitInstallation(directory, [runtime]);
  } catch (err) {
    try { recoverPendingTransaction(directory); } catch (_) {}
    throw err;
  }
  fs.writeFileSync(path.join(directory, 'autostart.json'), JSON.stringify({ app: DEFAULT_APP, allowClientRestart: true }) + '\n', { mode: 0o600 });
  fs.mkdirSync(logDirectory(), { recursive: true, mode: 0o700 });
  launchd.writePlist({
    Label: LABEL,
    ProgramArguments: [node, path.join(runtime, 'bin/codex-session-status.cjs'), 'run', '--watch-startup', '--data-dir', directory],
    RunAtLoad: true, KeepAlive: { SuccessfulExit: false }, ThrottleInterval: 10, ProcessType: 'Interactive',
    EnvironmentVariables: { NODE_OPTIONS: '', NODE_PATH: '' },
    StandardOutPath: path.join(logDirectory(), 'agent.log'), StandardErrorPath: path.join(logDirectory(), 'agent.err.log')
  }, plistFile());
  const started = Date.now();
  launchd.bootstrap(plistFile());
  for (let i = 0; i < 100; i++) {
    const status = startupStatus(directory);
    if (status.updatedAt >= started && ['watching', 'observing'].includes(status.event)) return status;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`自动挂载未就绪，请查看 ${logDirectory()}/agent.err.log`);
}

const installAutostart = directory => withLifecycleLock(directory, () => installAutostartUnlocked(directory));

async function disableAutostartUnlocked() {
  await launchd.bootout(LABEL);
  if (fs.existsSync(plistFile())) fs.unlinkSync(plistFile());
}

const disableAutostart = (directory = path.join(os.homedir(), 'Library/Application Support/CodexSessionStatus')) => withLifecycleLock(directory, disableAutostartUnlocked);

module.exports = { installAutostart, disableAutostart, startupStatus, installRuntime };
