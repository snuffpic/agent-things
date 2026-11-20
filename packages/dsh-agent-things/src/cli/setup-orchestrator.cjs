'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { installRuntime, prepareStartup, commitInstallation, recoverPendingTransaction, verifyPluginOwnership, repairPluginRegistry, checkCommitStatus } = require('../runtime-install.cjs');
const { installCodexMcp, disableCodexMcp } = require('../codex-mcp-config.cjs');
const launchd = require('../launchd.cjs');
const { installAntigravityMcp, disableAntigravityMcp } = require('../antigravity-mcp-config.cjs');
const { installClaudeMcp, disableClaudeMcp } = require('../claude-mcp-config.cjs');
const { isAppRunning } = require('./environment-probe.cjs');
const { resolveNode } = require('../resolve.cjs');
const { assertSetupIdle } = require('../npm-updates.cjs');
const { syncClaudeInline } = require('../claude-inline-install.cjs');

const LABEL = 'com.codexsessionstatus.agent';
const home = process.env.HOME || os.homedir();
const DATA_DIR = path.join(home, 'Library/Application Support/CodexSessionStatus');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOG_DIR = path.join(home, 'Library/Logs/CodexSessionStatus');
const PLIST_FILE = path.join(home, 'Library/LaunchAgents', `${LABEL}.plist`);

function readConfig({ file = CONFIG_FILE } = {}) {
  if (!fs.existsSync(file)) return null;
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config || !['zh', 'en'].includes(config.lang) || !Array.isArray(config.enabledApps)) throw new Error(`配置格式无效，请检查并保留原文件：${file}`);
  return { ...config, enabledApps: config.enabledApps.filter(app => ['codex', 'antigravity', 'claude', 'deepseek'].includes(app)) };
}

function writeConfig(data, { file = CONFIG_FILE } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

function matchesManagedSkill(actual, expectedContents, legacyMarker) {
  if (expectedContents.includes(actual)) return true;
  return Boolean(legacyMarker && actual.startsWith(legacyMarker.prefix) && actual.includes(legacyMarker.contains));
}

function unlinkManagedFile(file, expectedContents, legacyMarker) {
  if (!fs.existsSync(file)) return;
  if (!matchesManagedSkill(fs.readFileSync(file, 'utf8'), expectedContents, legacyMarker)) return;
  fs.unlinkSync(file);
  try { fs.rmdirSync(path.dirname(file)); } catch (_) {}
}

function syncSkillFiles(enabledApps, { homeDirectory = home, lang = 'zh' } = {}) {
  const root = path.resolve(__dirname, '../..');
  const en = lang === 'en';
  const skillSrcZh = path.join(root, 'skills/agent-things/SKILL.md');
  const skillSrcEn = path.join(root, 'skills/agent-things/SKILL.en.md');
  const checklistSrcZh = path.join(root, 'skills/things/checklist.md');
  const checklistSrcEn = path.join(root, 'skills/things/checklist.en.md');
  const thingsSkillSrcZh = path.join(root, 'skills/things/SKILL.md');
  const thingsSkillSrcEn = path.join(root, 'skills/things/SKILL.en.md');
  const codexSkillSrcZh = path.join(root, 'skills/codex/things/SKILL.md');
  const codexSkillSrcEn = path.join(root, 'skills/codex/things/SKILL.en.md');
  if (!fs.existsSync(skillSrcZh)) throw new Error(en ? 'Package is missing agent-things skill file' : '安装包缺少 agent-things 技能文件');

  const zhSkillContent = fs.readFileSync(skillSrcZh, 'utf8');
  const enSkillContent = fs.existsSync(skillSrcEn) ? fs.readFileSync(skillSrcEn, 'utf8') : zhSkillContent;
  const content = en ? enSkillContent : zhSkillContent;
  const skillCandidates = [zhSkillContent, enSkillContent];

  const zhChecklistContent = fs.existsSync(checklistSrcZh) ? fs.readFileSync(checklistSrcZh, 'utf8') : zhSkillContent;
  const enChecklistContent = fs.existsSync(checklistSrcEn) ? fs.readFileSync(checklistSrcEn, 'utf8') : enSkillContent;
  const checklistContent = en ? enChecklistContent : zhChecklistContent;
  const checklistCandidates = [zhChecklistContent, enChecklistContent, ...skillCandidates];

  const legacyAgentThings = { prefix: '---\nname: agent-things\n', contains: '# Agent Things 会话进度清单' };
  const legacyAgentThingsEn = { prefix: '---\nname: agent-things\n', contains: '# Agent Things Progress Checklist' };

  for (const [app, relative] of [['claude', '.claude/skills/agent-things']]) {
    const file = path.join(homeDirectory, relative, 'SKILL.md');
    if (enabledApps.includes(app)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    } else unlinkManagedFile(file, skillCandidates, legacyAgentThings) || unlinkManagedFile(file, skillCandidates, legacyAgentThingsEn);
  }

  const antigravitySkillDirectory = path.join(homeDirectory, '.gemini/config/skills/things');
  const antigravitySkill = path.join(antigravitySkillDirectory, 'SKILL.md');
  const antigravityChecklist = path.join(antigravitySkillDirectory, 'checklist.md');
  if (fs.existsSync(thingsSkillSrcZh)) {
    const zhThings = fs.readFileSync(thingsSkillSrcZh, 'utf8');
    const enThings = fs.existsSync(thingsSkillSrcEn) ? fs.readFileSync(thingsSkillSrcEn, 'utf8') : zhThings;
    const thingsContent = en ? enThings : zhThings;
    if (enabledApps.includes('antigravity')) {
      fs.mkdirSync(antigravitySkillDirectory, { recursive: true });
      fs.writeFileSync(antigravityChecklist, checklistContent, 'utf8');
      fs.writeFileSync(antigravitySkill, thingsContent, 'utf8');
    } else if (fs.existsSync(antigravitySkill) && matchesManagedSkill(fs.readFileSync(antigravitySkill, 'utf8'), [zhThings, enThings], { prefix: '---\nname: things\n', contains: 'render_things_card' })) {
      fs.unlinkSync(antigravitySkill);
      unlinkManagedFile(antigravityChecklist, checklistCandidates, legacyAgentThings);
    }
  }
  const codexSkillDirectory = path.join(homeDirectory, '.codex/skills/things');
  const codexSkill = path.join(codexSkillDirectory, 'SKILL.md');
  const checklist = path.join(codexSkillDirectory, 'checklist.md');
  const zhCodex = fs.readFileSync(codexSkillSrcZh, 'utf8');
  const enCodex = fs.existsSync(codexSkillSrcEn) ? fs.readFileSync(codexSkillSrcEn, 'utf8') : zhCodex;
  const codexContent = en ? enCodex : zhCodex;
  if (enabledApps.includes('codex')) {
    if (fs.existsSync(codexSkill) && !fs.readFileSync(codexSkill, 'utf8').includes('mcp__session_status__open_session_card')) {
      throw new Error(en ? 'Codex already has a custom personal skill named things' : 'Codex 已有名为 things 的个人技能');
    }
    fs.mkdirSync(codexSkillDirectory, { recursive: true });
    fs.writeFileSync(checklist, checklistContent);
    fs.writeFileSync(codexSkill, codexContent);
  } else if (fs.existsSync(codexSkill) && fs.readFileSync(codexSkill, 'utf8').includes('mcp__session_status__open_session_card')) {
    fs.unlinkSync(codexSkill);
    unlinkManagedFile(checklist, checklistCandidates, legacyAgentThings);
  }

  for (const [name, marker] of [
    ['agent-things', '# Agent Things 会话进度清单'],
    ['agent-things-card', 'mcp__session_status__open_session_card'],
  ]) {
    for (const prefix of ['.codex/skills', '.gemini/config/skills']) {
      const file = path.join(homeDirectory, prefix, name, 'SKILL.md');
      if (fs.existsSync(file)) {
        const legacy = fs.readFileSync(file, 'utf8');
        if (legacy.startsWith(`---\nname: ${name}\n`) && legacy.includes(marker)) {
          fs.unlinkSync(file);
          try { fs.rmdirSync(path.dirname(file)); } catch (_) {}
        }
      }
    }
  }

  require('../harnesses/antigravity/analysis-profile.cjs').syncAnalysisProfile(enabledApps.includes('antigravity'), { home: homeDirectory });
  return syncClaudeInline(root, enabledApps.includes('claude'), { home: homeDirectory });
}

function syncAntigravityHooks(enabled, { homeDirectory = home, runtime = path.join(DATA_DIR, 'runtime') } = {}) {
  const hooksFile = path.join(homeDirectory, '.gemini/config/hooks.json');
  const candidateScript = path.join(runtime, 'src/antigravity-hook.cjs');
  const hookScript = fs.existsSync(candidateScript) ? candidateScript : path.resolve(__dirname, '../antigravity-hook.cjs');

  let hooks = {};
  if (fs.existsSync(hooksFile)) {
    try {
      hooks = JSON.parse(fs.readFileSync(hooksFile, 'utf8')) || {};
    } catch (_) {
      hooks = {};
    }
  }

  if (enabled) {
    fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
    hooks['agent-things-instant-card'] = {
      enabled: true,
      PreInvocation: [
        {
          type: 'command',
          command: `node "${hookScript}"`,
          timeout: 5,
        },
      ],
    };
    fs.writeFileSync(hooksFile, JSON.stringify(hooks, null, 2) + '\n', 'utf8');
  } else if (hooks['agent-things-instant-card']) {
    delete hooks['agent-things-instant-card'];
    fs.writeFileSync(hooksFile, JSON.stringify(hooks, null, 2) + '\n', 'utf8');
  }
}

async function installBackgroundDaemon(sourceRoot, { refreshRuntime = true } = {}) {
  if (process.platform !== 'darwin') return;
  const node = resolveNode();
  const runtime = path.join(DATA_DIR, 'runtime');

  if (refreshRuntime) prepareStartup(sourceRoot, DATA_DIR);
  await launchd.bootout(LABEL);
  if (refreshRuntime) installRuntime(sourceRoot, runtime, { enabledApps: ['codex'], dataDir: DATA_DIR, homeDirectory: home });

  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });


  const plistContent = {
    Label: LABEL,
    ProgramArguments: [
      node,
      path.join(runtime, 'bin/codex-session-status.cjs'),
      'run',
      '--watch-startup',
      '--data-dir',
      DATA_DIR,
    ],
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    ThrottleInterval: 10,
    ProcessType: 'Interactive',
    EnvironmentVariables: { NODE_OPTIONS: '', NODE_PATH: '' },
    StandardOutPath: path.join(LOG_DIR, 'agent.log'),
    StandardErrorPath: path.join(LOG_DIR, 'agent.err.log'),
  };

  launchd.writePlist(plistContent, PLIST_FILE);
  launchd.bootstrap(PLIST_FILE);
}

async function restartCodexWithPort({ lang = 'zh' } = {}) {
  const en = lang === 'en';
  const running = () => isAppRunning('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT');
  if (running()) {
    execFileSync('/usr/bin/osascript', ['-e', 'tell application id "com.openai.codex" to quit'], { timeout: 15000, stdio: 'pipe' });
    const deadline = performance.now() + 10000;
    while (running()) {
      if (performance.now() >= deadline) throw new Error(en ? 'Client has not quit yet; please save your work and retry' : '客户端尚未退出，请完成保存后重试');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  execFileSync('/usr/bin/open', ['-a', '/Applications/ChatGPT.app', '--args', '--remote-debugging-port=39222']);
}

function restartStaleThingsSidecar(homeDirectory = home) {
  if (process.platform !== 'darwin' || !homeDirectory) return;
  try {
    const pluginsDir = path.join(homeDirectory, '.gemini', 'config', 'plugins');
    const thingsPrefix = path.join(pluginsDir, 'things');
    let pgrepOut = '';
    try {
      pgrepOut = execFileSync('/usr/bin/pgrep', ['-f', 'main\\.mjs'], {
        encoding: 'utf8',
        timeout: 2000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return;
    }
    const pids = pgrepOut.split(/\r?\n/)
      .map(line => Number(line.trim()))
      .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    for (const pid of pids) {
      try {
        const lsofOut = execFileSync('/usr/sbin/lsof', ['-n', '-l', '-P', '-a', '-d', 'cwd', '-Fn', '-p', String(pid)], {
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const cwdLine = lsofOut.split(/\r?\n/).find(line => line.startsWith('n'));
        const cwd = cwdLine ? cwdLine.slice(1).trim() : '';
        if (!cwd) continue;
        if (cwd.startsWith(thingsPrefix) && cwd.endsWith(`${path.sep}sidecars${path.sep}things_board`)) {
          process.kill(pid, 'SIGTERM');
        }
      } catch {}
    }
  } catch {}
}

async function executeSetupUnlocked({ lang = 'zh', enabledApps = ['codex', 'antigravity'], autoRestartCodex = false, verify = async () => {} }) {
  const en = lang === 'en';
  assertSetupIdle();
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(en ? 'Node.js 22 or newer is required' : '需要 Node.js 22 或更高版本');
  if (process.platform !== 'darwin') throw new Error(en ? 'Currently only macOS is supported' : '目前支持 macOS');
  if (!['zh', 'en'].includes(lang) || !Array.isArray(enabledApps) || enabledApps.some(app => !['codex', 'antigravity', 'claude', 'deepseek'].includes(app))) {
    throw new Error(en ? 'Please select supported apps and language' : '请选择支持的应用和语言');
  }
  enabledApps = [...new Set(enabledApps)];
  const root = path.resolve(__dirname, '../..');
  const runtime = path.join(DATA_DIR, 'runtime');
  const agy = require('../../scripts/setup-antigravity-service.cjs');
  const claude = require('../../scripts/setup-claude-service.cjs');
  const dshInstaller = require('../harnesses/deepseek/dsh-installer.cjs');
  const dshStateFile = require('../harnesses/deepseek/dsh-service.cjs').resolveDefaultDshStateFile();
  const dshWasInstalled = dshInstaller.probeDshRuntime({ home }).pluginInstalled;
  const codexConfig = path.join(home, '.codex/config.toml');
  const agyConfig = path.join(home, '.gemini/antigravity/mcp_config.json');
  const agyUnifiedConfig = path.join(home, '.gemini/config/mcp_config.json');
  const claudeConfig = path.join(home, '.claude.json');
  if (enabledApps.includes('codex') && !fs.existsSync(codexConfig)) {
    throw new Error(en ? 'Please open ChatGPT.app and sign in to Codex first so its configuration file is created.' : '请先启动 ChatGPT.app 并完成 Codex 登录，以建立配置文件。');
  }
  if (enabledApps.includes('antigravity') && fs.existsSync(agyConfig)) JSON.parse(fs.readFileSync(agyConfig, 'utf8'));
  if (enabledApps.includes('antigravity') && fs.existsSync(agyUnifiedConfig)) JSON.parse(fs.readFileSync(agyUnifiedConfig, 'utf8'));
  if (enabledApps.includes('claude') && fs.existsSync(claudeConfig)) JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  for (const file of [path.join(DATA_DIR, 'manual-state.json'), path.join(home, '.gemini/antigravity/session-status/manual-state.json'), require('../harnesses/claude/claude-service.cjs').DEFAULT_STATE_FILE, dshStateFile]) {
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).timeline?.some(event => event.status === 'pending')) {
      throw new Error(en ? 'Please wait for the active analysis to finish before modifying components.' : '请等待当前分析结束后再修改组件。');
    }
  }
  const dshProfilesDir = path.join(home, '.dsh', 'profiles');
  const dshProfilePkgs = fs.existsSync(dshProfilesDir)
    ? fs.readdirSync(dshProfilesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dshProfilesDir, entry.name, 'package.json'))
    : [];
  const files = [...new Set([CONFIG_FILE, codexConfig, agyConfig, agyUnifiedConfig, claudeConfig, PLIST_FILE, agy.PLIST_PATH, claude.PLIST_PATH,
    path.join(DATA_DIR, 'bridge'), path.join(DATA_DIR, 'autostart.json'),
    path.join(home, '.codex/skills/agent-things/SKILL.md'),
    path.join(home, '.codex/skills/agent-things-card/SKILL.md'),
    path.join(home, '.codex/skills/things/SKILL.md'),
    path.join(home, '.codex/skills/things/checklist.md'),
    path.join(home, '.gemini/config/skills/agent-things/SKILL.md'),
    path.join(home, '.gemini/config/skills/things/SKILL.md'),
    path.join(home, '.gemini/config/skills/things/checklist.md'),
    path.join(home, '.gemini/config/hooks.json'),
    path.join(home, '.gemini/config/agents/agent-things-analysis/agent.md'),
    path.join(home, '.claude/skills/agent-things/SKILL.md'),
    ...dshProfilePkgs,
    path.join(dshProfilesDir, 'web', 'package.json')])];
  const saved = new Map(files.map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
  const running = [LABEL, 'com.antigravity.session-status', claude.LABEL].filter(label => launchd.printJob(label));
  const hadRuntime = fs.existsSync(runtime);
  let runtimeChanged = false, servicesTouched = false, inlineChange = null;
  try {
    // Verify and stage the packaged helper before stopping healthy services.
    if (enabledApps.includes('codex')) prepareStartup(root, DATA_DIR);
    writeConfig({ lang, enabledApps, installed: true, updatedAt: new Date().toISOString() });
    servicesTouched = true;
    await launchd.bootout(LABEL);
    await agy.uninstall();
    await claude.uninstall();
    if (enabledApps.length) {
      installRuntime(root, runtime, { enabledApps, dataDir: DATA_DIR, homeDirectory: home });
      runtimeChanged = true;
    }
    if (enabledApps.includes('codex')) {
      await installBackgroundDaemon(root, { refreshRuntime: false });
      installCodexMcp({ scriptPath: path.join(runtime, 'bin/codex-session-status.cjs') });
    } else {
      fs.rmSync(PLIST_FILE, { force: true });
      disableCodexMcp({});
    }
    if (enabledApps.includes('antigravity')) {
      await agy.install({ root: runtime });
      installAntigravityMcp({ homeDirectory: home, scriptPath: path.join(runtime, 'bin/antigravity-session-status.cjs') });
      syncAntigravityHooks(true, { homeDirectory: home, runtime });
    } else {
      disableAntigravityMcp({ homeDirectory: home });
      syncAntigravityHooks(false, { homeDirectory: home, runtime });
    }
    if (enabledApps.includes('claude')) {
      await claude.install({ root: runtime });
      installClaudeMcp({ scriptPath: path.join(runtime, 'bin/claude-session-status.cjs') });
    } else disableClaudeMcp();
    if (enabledApps.includes('deepseek')) {
      let bundleDir = path.join(runtime, 'packages/dsh-agent-things');
      if (!fs.existsSync(bundleDir)) {
        require('../../scripts/build-dsh-bundle.cjs').buildBundle();
        bundleDir = path.join(root, 'packages/dsh-agent-things');
      }
      dshInstaller.installDshPlugin({ bundleDir, home });
    } else if (dshWasInstalled) {
      dshInstaller.uninstallDshPlugin({ home });
    }
    inlineChange = syncSkillFiles(enabledApps, { homeDirectory: home, lang });
    await verify({ enabledApps, runtime });
    let commitResult = null;
    try {
      commitResult = commitInstallation(DATA_DIR, [runtime, path.join(home, '.gemini/config/plugins/things')]);
    } catch (commitErr) {
      // 提交收尾异常：向外层抛出由外层统一判定提交状态
      throw commitErr;
    }
    if (enabledApps.includes('antigravity')) restartStaleThingsSidecar(home);
  } catch (error) {
    // 1. 提交状态判定：必须在执行任何撤销/回滚操作之前确认提交结果
    const commitStatus = checkCommitStatus(DATA_DIR);
    if (commitStatus.corrupted) {
      throw new Error(en
        ? `Setup failed and transaction state cannot be verified (transaction log corrupted; rollback stopped to preserve state): ${error.message}`
        : `安装异常，且事务状态无法确认（事务日志损坏，已停止回滚保留现场）：${error.message}`);
    }

    const isCommitted = commitStatus.committed;
    if (isCommitted) {
      // 已提交阶段：新版 runtime 与服务配置已经生效成立，严禁停止服务或回退配置！
      let recovery = null;
      let recoveryErr = null;
      try {
        recovery = recoverPendingTransaction(DATA_DIR);
      } catch (rErr) {
        recoveryErr = rErr;
      }

      if (recovery?.recovered && recovery?.status === 'committed_cleanup') {
        // 重试成功：返回安装成功，并附带收尾已自愈提示
        return {
          success: true,
          enabledApps,
          lang,
          warning: en ? `Setup committed; cleanup recovery succeeded: ${error.message}` : `安装提交完成，收尾自愈重试成功：${error.message}`,
        };
      }

      // 持续失败：保留新版配置、服务、事务日志和备份，明确报告“已提交，收尾待恢复”
      const errDetail = recoveryErr ? recoveryErr.message : error.message;
      const pendingErr = new Error(en ? `Setup committed, but cleanup is pending recovery: ${errDetail}` : `安装已提交，但收尾待恢复：${errDetail}`);
      pendingErr.code = 'COMMITTED_PENDING_RECOVERY';
      pendingErr.committed = true;
      pendingErr.enabledApps = enabledApps;
      throw pendingErr;
    }

    // 2. 未提交阶段（提交前失败）：执行原有的安全回滚逻辑
    inlineChange?.rollback();
    try {
      if (servicesTouched) {
        await launchd.bootout(LABEL); await agy.uninstall(); await claude.uninstall();
        if (enabledApps.includes('deepseek') && !dshWasInstalled) {
          try { dshInstaller.uninstallDshPlugin({ home }); } catch {}
        }
      }
      // 物理目录恢复 100% 统一由事务模块按本次登记目标负责，绝不在此手动删除任何未登记目录
      if (runtimeChanged) {
        recoverPendingTransaction(DATA_DIR);
      }
      for (const [file, bytes] of saved) {
        if (bytes === null) fs.rmSync(file, { force: true });
        else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { mode: 0o600 }); }
      }
      for (const label of servicesTouched ? running : []) launchd.bootstrap(label === LABEL ? PLIST_FILE : label === claude.LABEL ? claude.PLIST_PATH : agy.PLIST_PATH);
    } catch (rollback) { throw new Error(en ? `Setup failed: ${error.message}; recovery failed: ${rollback.message}` : `安装失败：${error.message}；恢复失败：${rollback.message}`); }
    throw error;
  }
  if (enabledApps.includes('codex') && autoRestartCodex) {
    try { await restartCodexWithPort({ lang }); }
    catch (error) { throw new Error(en ? `Configuration saved, client restart incomplete: ${error.message}` : `配置已保存，客户端重启未完成：${error.message}`); }
  }
  return { success: true, enabledApps, lang };
}

async function uninstallAllUnlocked() {
  assertSetupIdle();
  const previous = readConfig();
  writeConfig({ lang: previous?.lang || 'zh', enabledApps: [], installed: false, updatedAt: new Date().toISOString() });
  if (process.platform === 'darwin') {
    await launchd.bootout(LABEL);
    if (fs.existsSync(PLIST_FILE)) fs.unlinkSync(PLIST_FILE);
    await require('../../scripts/setup-antigravity-service.cjs').uninstall();
    await require('../../scripts/setup-claude-service.cjs').uninstall();
    disableCodexMcp({});
    disableAntigravityMcp({ homeDirectory: home });
    disableClaudeMcp();
    try { require('../harnesses/deepseek/dsh-installer.cjs').uninstallDshPlugin({ home }); } catch {}
    const agyPluginDir = path.join(home, '.gemini/config/plugins/things');
    if (fs.existsSync(agyPluginDir)) {
      const ownership = verifyPluginOwnership(agyPluginDir, DATA_DIR, { action: 'uninstall' });
      if (ownership.allowed && ownership.reason !== 'not_exists') {
        fs.rmSync(agyPluginDir, { recursive: true, force: true });
      }
    }
  }
  syncSkillFiles([], { homeDirectory: home });
  syncAntigravityHooks(false, { homeDirectory: home });
  for (const file of [path.join(DATA_DIR, 'bridge'), path.join(DATA_DIR, 'autostart.json'), path.join(DATA_DIR, 'state.json')]) fs.rmSync(file, { force: true });
  // Clear runtime
  const runtime = path.join(DATA_DIR, 'runtime');
  if (fs.existsSync(runtime)) {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
  return { success: true };
}

const { withLifecycleLock } = require('../lifecycle-lock.cjs');
const executeSetup = options => withLifecycleLock(DATA_DIR, () => executeSetupUnlocked(options));
const uninstallAll = () => withLifecycleLock(DATA_DIR, uninstallAllUnlocked);

module.exports = {
  readConfig,
  writeConfig,
  syncSkillFiles,
  syncAntigravityHooks,
  installBackgroundDaemon,
  restartCodexWithPort,
  executeSetup,
  uninstallAll,
  repairPluginRegistry,
  DATA_DIR,
  CONFIG_FILE,
  PLIST_FILE,
  LOG_DIR,
};
