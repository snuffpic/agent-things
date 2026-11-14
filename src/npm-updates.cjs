'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const launchd = require('./launchd.cjs');
const { requestProgressHttp } = require('./local-progress-http.cjs');
const { resolveNode } = require('./resolve.cjs');

const REGISTRY = 'https://registry.npmjs.org';
const DATA_DIR = path.join(os.homedir(), 'Library/Application Support/CodexSessionStatus');
const STATUS_FILE = path.join(DATA_DIR, 'npm-update.json');
const CHECK_FILE = path.join(DATA_DIR, 'npm-version-check.json');
// Bootstrap explicitly; keeping this outside LaunchAgents prevents a login-time upgrade.
const PLIST = path.join(DATA_DIR, 'npm-update.plist');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const ACTIVE = new Set(['queued', 'checking', 'downloading', 'waiting', 'installing']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checking;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function stableVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-zA-Z.-]+)?$/.test(value)) throw new Error(`版本号不是稳定版本：${value}`);
  return value.split('+')[0].split('.').map(BigInt);
}

function newerVersion(candidate, current) {
  const next = stableVersion(candidate), old = stableVersion(current);
  for (let i = 0; i < 3; i++) if (next[i] !== old[i]) return next[i] > old[i];
  return false;
}

function installedVersion() {
  const file = path.join(DATA_DIR, 'runtime/package.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null;
}

async function checkForUpdate({ fetchImpl = fetch, currentVersion = installedVersion() } = {}) {
  if (!currentVersion) throw new Error('尚未安装，请先完成安装向导');
  stableVersion(currentVersion);
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(PACKAGE.name)}/latest`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (response.status === 404) throw new Error('npm 上尚未发布此安装包');
  if (!response.ok) throw new Error(`npm 版本检查失败（HTTP ${response.status}）`);
  const release = await response.json();
  if (release.name !== PACKAGE.name) throw new Error('npm 返回的安装包名称不匹配');
  const available = newerVersion(release.version, currentVersion);
  return { currentVersion, latestVersion: release.version, available, checkedAt: new Date().toISOString(),
    command: `npx ${PACKAGE.name}@latest`, release };
}

async function getUpdateInfo({ force = false } = {}) {
  const currentVersion = installedVersion();
  const update = readUpdateStatus();
  if (!currentVersion) return { currentVersion: null, available: false, command: `npx ${PACKAGE.name}@latest`, update };
  let cached = fs.existsSync(CHECK_FILE) ? JSON.parse(fs.readFileSync(CHECK_FILE, 'utf8')) : null;
  if (cached?.currentVersion !== currentVersion) cached = null;
  if (!ACTIVE.has(update?.stage) && (force || !cached || Date.now() - Date.parse(cached.attemptedAt) >= 86400000)) {
    if (!checking) checking = (async () => {
      const attemptedAt = new Date().toISOString();
      let result;
      try {
        const { release, ...info } = await checkForUpdate({ currentVersion });
        result = { ...info, attemptedAt, checkError: null };
      } catch (error) {
        result = { ...cached, currentVersion, available: cached?.available || false, attemptedAt, checkError: error.message };
      }
      writeJson(CHECK_FILE, result);
      return result;
    })().finally(() => { checking = null; });
    cached = await checking;
  }
  return { ...cached, currentVersion, command: `npx ${PACKAGE.name}@latest`, update: readUpdateStatus() };
}

async function downloadRelease(release, directory, { fetchImpl = fetch } = {}) {
  stableVersion(release.version);
  if (release.name !== PACKAGE.name) throw new Error('安装包名称不匹配');
  const url = new URL(release.dist?.tarball);
  if (url.origin !== REGISTRY || url.username || url.password) throw new Error('安装包必须来自 npm 官方仓库');
  const integrity = release.dist?.integrity;
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity)) throw new Error('安装包缺少 SHA-512 校验信息');
  const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(120000), redirect: 'error' });
  if (!response.ok) throw new Error(`npm 安装包下载失败（HTTP ${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (`sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error('安装包完整性校验失败');
  const archive = path.join(directory, 'release.tgz');
  fs.writeFileSync(archive, bytes, { mode: 0o600 });
  const options = { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 };
  const names = execFileSync('/usr/bin/tar', ['-tzf', archive], options).trim().split('\n');
  if (names.some(name => !name.startsWith('package/') || name.includes('\\') || name.split('/').includes('..'))) throw new Error('安装包包含无效路径');
  const entries = execFileSync('/usr/bin/tar', ['-tvzf', archive], options).trim().split('\n');
  if (entries.some(entry => !['-', 'd'].includes(entry[0]))) throw new Error('安装包包含不支持的链接或特殊文件');
  execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', directory], options);
  const root = path.join(directory, 'package');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== release.name || metadata.version !== release.version) throw new Error('安装包版本与 npm 元数据不匹配');
  if (Object.keys(metadata.dependencies || {}).length || Object.keys(metadata.optionalDependencies || {}).length) throw new Error('此升级器要求发布包包含完整运行组件');
  execFileSync(process.execPath, [path.join(root, 'bin/codex-session-status.cjs'), 'help'], { stdio: 'pipe', timeout: 5000 });
  return root;
}

function readUpdateStatus() {
  if (!fs.existsSync(STATUS_FILE)) return null;
  const state = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  if (state.stage === 'queued') {
    if (/\bpid = [1-9]\d*/.test(launchd.printJob(launchd.UPDATE_LABEL) || '') || Date.now() - Date.parse(state.startedAt) < 10000) return state;
    return { ...state, stage: 'failed', error: '升级进程未能启动，请重试' };
  }
  if (ACTIVE.has(state.stage)) {
    try { process.kill(state.pid, 0); }
    catch (error) {
      if (error.code !== 'ESRCH') throw error;
      return { ...state, stage: 'failed', error: '升级进程已中断，请重试' };
    }
  }
  return state;
}

function assertUpdateIdle() {
  if (['waiting', 'installing'].includes(readUpdateStatus()?.stage)) throw new Error('插件正在升级，请等待升级完成后再分析');
}

function assertSetupIdle() {
  const state = readUpdateStatus();
  if (ACTIVE.has(state?.stage) && state.pid !== process.pid) throw new Error('插件正在升级，请等待升级完成后再修改安装配置');
}

function pendingAnalysis() {
  const files = [path.join(DATA_DIR, 'manual-state.json'), path.join(os.homedir(), '.gemini/antigravity/session-status/manual-state.json'), path.join(os.homedir(), 'Library/Application Support/AgentThings/claude/manual-state.json')];
  return files.some(file => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).timeline?.some(event => event.status === 'pending'));
}

async function verifyServices({ enabledApps, runtime }) {
  const deadline = Date.now() + 15000;
  let error;
  do {
    try {
      for (const app of enabledApps) {
        const label = { codex: 'com.codexsessionstatus.agent', antigravity: 'com.antigravity.session-status', claude: 'com.agentthings.claude' }[app];
        if (!/\bpid = [1-9]\d*/.test(launchd.printJob(label) || '')) throw new Error(`${app} 后台服务未启动`);
        if (app === 'codex') await requestProgressHttp(path.join(DATA_DIR, 'manual-state.json'), '/health');
        if (app === 'antigravity') await requestProgressHttp(path.join(os.homedir(), '.gemini/antigravity/session-status/manual-state.json'), '/health');
        if (app === 'claude') await requestProgressHttp(path.join(os.homedir(), 'Library/Application Support/AgentThings/claude/manual-state.json'), '/health');
      }
      if (!fs.existsSync(path.join(runtime, 'package.json'))) throw new Error('安装后的版本信息缺失');
      return;
    } catch (failure) { error = failure; }
    await sleep(250);
  } while (Date.now() < deadline);
  throw error;
}

async function runUpdate(id = crypto.randomUUID()) {
  let state = { id, pid: process.pid, stage: 'checking', startedAt: new Date().toISOString() };
  const publish = fields => {
    state = { ...state, ...fields, updatedAt: new Date().toISOString() };
    writeJson(STATUS_FILE, state);
  };
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  let directory;
  try {
    publish({});
    const checked = await checkForUpdate();
    publish({ currentVersion: checked.currentVersion, latestVersion: checked.latestVersion });
    if (!checked.available) { publish({ stage: 'current' }); return; }
    publish({ stage: 'downloading' });
    directory = fs.mkdtempSync(path.join(DATA_DIR, 'npm-update-'));
    const root = await downloadRelease(checked.release, directory);
    publish({ stage: 'waiting' });
    const deadline = Date.now() + 15 * 60 * 1000;
    while (pendingAnalysis()) {
      if (Date.now() >= deadline) throw new Error('仍有分析任务运行，本次升级已取消，可稍后重试');
      await sleep(500);
    }
    // Read the current preferences after downloading and waiting, not from a UI snapshot.
    const { readConfig } = require('./cli/setup-orchestrator.cjs');
    const config = readConfig();
    if (!config || config.installed === false) throw new Error('插件已卸载，本次升级已取消');
    const setup = require(path.join(root, 'src/cli/setup-orchestrator.cjs'));
    publish({ stage: 'installing' });
    await setup.executeSetup({ lang: config.lang, enabledApps: config.enabledApps, autoRestartCodex: false, verify: async options => {
      const metadata = JSON.parse(fs.readFileSync(path.join(options.runtime, 'package.json'), 'utf8'));
      if (metadata.name !== PACKAGE.name || metadata.version !== checked.latestVersion) throw new Error('安装后的版本与目标版本不匹配');
      await verifyServices(options);
    } });
    publish({ stage: 'completed', currentVersion: installedVersion(), reconnectMcp: true });
  } catch (error) { publish({ stage: 'failed', error: error.message }); process.exitCode = 1; }
  finally { if (directory) fs.rmSync(directory, { recursive: true, force: true }); }
}

async function startUpdateUnlocked() {
  if (process.platform !== 'darwin') throw new Error('目前支持 macOS');
  if (ACTIVE.has(readUpdateStatus()?.stage)) throw new Error('升级正在进行中');
  const job = launchd.printJob(launchd.UPDATE_LABEL);
  if (/\bpid = [1-9]\d*/.test(job || '')) throw new Error('升级正在进行中');
  if (job) await launchd.bootout(launchd.UPDATE_LABEL);
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const id = crypto.randomUUID();
  const queued = { id, stage: 'queued', pid: null, startedAt: new Date().toISOString() };
  writeJson(STATUS_FILE, queued);
  try {
    launchd.writePlist({ Label: launchd.UPDATE_LABEL,
      ProgramArguments: [resolveNode(), __filename, '--worker', id], RunAtLoad: true, ProcessType: 'Background',
      EnvironmentVariables: { NODE_OPTIONS: '', NODE_PATH: '' },
      StandardOutPath: path.join(DATA_DIR, 'npm-update.log'), StandardErrorPath: path.join(DATA_DIR, 'npm-update.err.log'),
    }, PLIST);
    launchd.bootstrap(PLIST);
  } catch (error) { writeJson(STATUS_FILE, { ...queued, stage: 'failed', error: error.message }); throw error; }
  return { started: true, id };
}

const startUpdate = () => require('./lifecycle-lock.cjs').withLifecycleLock(DATA_DIR, startUpdateUnlocked);

if (require.main === module && process.argv[2] === '--worker') void runUpdate(process.argv[3]);
module.exports = { newerVersion, checkForUpdate, getUpdateInfo, downloadRelease, readUpdateStatus, startUpdate, assertUpdateIdle, assertSetupIdle, verifyServices, runUpdate };
