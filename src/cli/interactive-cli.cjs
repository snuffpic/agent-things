'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { probeEnvironment, formatProbeText } = require('./environment-probe.cjs');
const { selectLanguageWithProbe, selectApps, askConfirm, selectMenu } = require('./prompt-tui.cjs');
const { readConfig, executeSetup, uninstallAll, DATA_DIR } = require('./setup-orchestrator.cjs');
const launchd = require('../launchd.cjs');
const { CdpSession, listTargets, CDP_PORT = 39222, ANTIGRAVITY_CDP_PORT = 29222 } = require('../cdp.cjs');
const { attachmentStatus } = require('../manual-status-agent.cjs');
const { requestProgressHttp } = require('../local-progress-http.cjs');
const { getUpdateInfo, startUpdate, verifyServices } = require('../npm-updates.cjs');
const { startupStatus } = require('../manual-status-startup.cjs');
const { portInUse } = require('../startup/watch.cjs');
const { COOLDOWN_MS } = require('../startup/controller.cjs');
const { detectSystemLang } = require('../i18n.cjs');
async function showUpdates(lang) {
  const zh = lang === 'zh';
  console.log(zh ? '\n正在检查 npm 最新版本…' : '\nChecking npm for updates…');
  try {
    const info = await getUpdateInfo({ force: true });
    console.log(zh ? `当前安装版本：${info.currentVersion || '未安装'}` : `Installed version: ${info.currentVersion || 'not installed'}`);
    if (['queued', 'checking', 'downloading', 'waiting', 'installing'].includes(info.update?.stage)) {
      const stages = zh
        ? { queued: '等待启动', checking: '检查版本', downloading: '下载中', waiting: '等待分析结束', installing: '升级中' }
        : { queued: 'queued', checking: 'checking', downloading: 'downloading', waiting: 'waiting for analysis', installing: 'installing' };
      console.log(zh ? `升级正在后台进行：${stages[info.update.stage]}。终端可以关闭。` : `Update running in background: ${stages[info.update.stage] || info.update.stage}. You may close the terminal.`);
      return;
    }
    if (info.update?.stage === 'failed') console.log(zh ? `上次升级失败：${info.update.error}` : `Previous update failed: ${info.update.error}`);
    if (info.checkError) { console.log(zh ? `检查失败：${info.checkError}。可稍后重试。` : `Check failed: ${info.checkError}. Try again later.`); return; }
    if (!info.available) { console.log(zh ? '已是最新版本。' : 'Already up to date.'); return; }
    console.log(zh ? `发现新版本 v${info.latestVersion}` : `New version available: v${info.latestVersion}`);
    if (await askConfirm(zh ? '立即升级？将保留任务记录和应用选择。' : 'Upgrade now? Task records and app selections will be preserved.', false, lang)) {
      await startUpdate();
      console.log(zh ? '升级已交给后台执行，终端可以关闭。可在面板或此菜单查看结果。完成后请重新连接 MCP。' : 'Update started in the background. You may close the terminal and check the result in the panel or this menu. Reconnect MCP after completion.');
    }
  } catch (error) { console.log(zh ? `升级入口暂不可用：${error.message}` : `Update unavailable: ${error.message}`); }
}

const STARTUP_EVENTS = {
  'quit-timeout': ['客户端退出较慢，正在继续等待退出以完成重开', 'Client is slow to quit; waiting to finish reopening'],
  'quit-accepted': ['客户端已接受退出请求，等待进程结束', 'Client accepted the quit request; waiting for it to exit'],
  'late-exit-observed': ['已检测到延迟退出，正在继续重开', 'Delayed exit detected; resuming reopening'],
  'late-exit-replaced': ['已检测到另一个客户端进程，交接已结束', 'Another client process appeared; handoff ended'],
  'late-exit-expired': ['延迟退出等待已到期，可重新打开客户端', 'Delayed-exit monitoring expired; open the client again'],
  reopening: ['正在带调试端口重开客户端', 'Reopening the client with the debug port'],
  'quit-refused': ['客户端未接受退出请求', 'Client declined the quit request'],
  'skipped-cooldown': ['本次启动落在上次接管后的保护冷却期内', 'Launch fell within the cooldown after the previous handoff'],
  'skipped-active-or-background': ['检测到客户端已在使用或位于后台，跳过接管', 'Client was active or in the background, so handoff was skipped'],
  'another-instance-started': ['接管期间出现另一个客户端进程', 'Another client process appeared during handoff'],
  'port-in-use': ['调试端口已被占用', 'Debug port was already in use'],
  'launch-failed': ['带调试端口重开失败', 'Could not reopen with the debug port'],
  'reopen-canceled': ['接管期间已有客户端启动', 'The client was already launching during handoff'],
  observing: ['启动观察模式', 'Startup observation mode'],
  watching: ['启动监听已就绪', 'Startup watcher ready'],
  reopened: ['客户端已带调试端口重开', 'Client reopened with the debug port'],
};

async function showStartupDiagnosis({ app, attachment, expectedPort, stateDir, stateFile, label, logDir, logFile, windowLabel, enabled, running, zh }) {
  if (!enabled || !app.installed) return;
  let startup;
  try {
    const options = {};
    if (stateFile) options.stateFile = stateFile;
    if (label) options.label = label;
    if (logDir) options.logDir = logDir;
    startup = Object.keys(options).length ? startupStatus(stateDir, options) : startupStatus(stateDir);
  } catch (error) {
    console.log(`  ${zh ? '读取启动记录失败' : 'Cannot read startup history'}: ${error.message}`);
  }
  if (startup?.event) {
    const date = startup.updatedAt ? ` · ${new Date(startup.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}` : '';
    console.log(`  ${zh ? '最近启动记录' : 'Last startup event'}: ${STARTUP_EVENTS[startup.event]?.[zh ? 0 : 1] || startup.event}${date}`);
  }
  const appBundle = `${app.id === 'codex' ? 'ChatGPT' : 'Antigravity'}.app`;
  const waitingWindow = windowLabel === 'Antigravity' ? 'an Antigravity' : `a ${windowLabel}`;
  let diagnosis;
  if (!running) diagnosis = zh ? '插件后台未运行。请在管理菜单同步组件与技能。' : 'The plugin daemon is stopped. Sync components and skills from the menu.';
  else if (attachment.authHealthy === false) diagnosis = zh ? '后台进程存在，但鉴权健康检查未通过。请在管理菜单同步组件并查看启动日志。' : 'The daemon process exists, but its authenticated health check failed. Sync components and inspect the startup log.';
  else if (!app.running) diagnosis = zh ? `等待 ${appBundle} 启动。` : `Waiting for ${appBundle} to launch.`;
  else if (!attachment.portOpen && await portInUse(expectedPort)) diagnosis = zh ? `${expectedPort} 已被监听，但无法连接到调试接口。请检查端口占用。` : `Port ${expectedPort} is listening, but its debugger is unreachable. Check which process owns the port.`;
  else if (!attachment.portOpen) {
    const retry = startup?.lastAttemptAt && startup.lastAttemptAt + COOLDOWN_MS - Date.now();
    diagnosis = zh
      ? `当前客户端没有开启 ${expectedPort} 调试端口。保存工作后完全退出 ${appBundle}，再从原图标打开。`
      : `The client has no debugger on port ${expectedPort}. Save your work, fully quit ${appBundle}, then open it again.`;
    if (retry > 0) diagnosis += zh ? ` 建议在 ${Math.ceil(retry / 1000)} 秒后重开。` : ` Reopen after ${Math.ceil(retry / 1000)} seconds.`;
  } else if (!attachment.windows.length) diagnosis = zh ? `调试端口可连接，等待 ${windowLabel} 主窗口。` : `Debugger reachable. Waiting for ${waitingWindow} main window.`;
  else if (!attachment.windows.some(window => window.version)) diagnosis = zh ? '已找到主窗口，界面组件尚未挂载。' : 'Main window found. The UI component has not attached yet.';
  else diagnosis = zh ? '界面组件已挂载。' : 'UI component attached.';
  console.log(`  ${zh ? '诊断' : 'Diagnosis'}: ${diagnosis}`);
  if (startup?.logDirectory) console.log(`  ${zh ? '启动日志' : 'Startup log'}: ${path.join(startup.logDirectory, logFile)}`);
}

async function showHealthStatus(lang) {
  const env = await probeEnvironment();
  const config = readConfig();
  const zh = (lang || config?.lang || 'zh') === 'zh';
  lang = zh ? 'zh' : 'en';
  console.log(zh ? '\nAgent Things 运行状态' : '\nAgent Things Health Check');
  const codex = await attachmentStatus(CDP_PORT);
  let codexHealthy = false;
  try { await requestProgressHttp(path.join(DATA_DIR, 'manual-state.json'), '/health', undefined, undefined, { timeoutMs: 1000 }); codexHealthy = true; } catch {}
  codex.authHealthy = codexHealthy;
  let agyHealthy = false, agyMounted = 0, agyPortOpen = false;
  const agyWindows = [];
  const agyStateDir = path.join(os.homedir(), '.gemini/antigravity/session-status');
  const agyState = path.join(agyStateDir, 'manual-state.json');
  try { await requestProgressHttp(agyState, '/health'); agyHealthy = true; } catch {}
  if (env.antigravity.port) {
    try {
      const targets = await listTargets(env.antigravity.port, 1000);
      agyPortOpen = true;
      for (const target of targets) {
        if (target.type !== 'page' || !/^(https?:\/\/(127\.0\.0\.1|localhost)|vscode-file:)/.test(target.url)) continue;
        const session = new CdpSession(target, env.antigravity.port);
        try {
          await session.connect();
          const { result } = await session.evaluate('window.__codexSessionStatus?.status?.() || null');
          const status = result.value;
          const mounted = Number(status?.mounted) || 0;
          agyMounted += mounted;
          agyWindows.push({ version: status?.version || (status ? '1' : null) });
        } catch {} finally { session.close(); }
      }
    } catch {}
  }
  const agyAttachment = { authHealthy: agyHealthy, portOpen: agyPortOpen, windows: agyWindows };
  for (const app of [env.codex, env.antigravity]) {
    const enabled = config?.enabledApps.includes(app.id);
    const job = launchd.printJob(app.id === 'codex' ? 'com.codexsessionstatus.agent' : 'com.antigravity.session-status');
    const service = Boolean(job && /\bpid = [1-9]\d*/.test(job));
    const mounted = app.id === 'codex' ? codex.mountedConversations || 0 : agyMounted;
    let registered = false;
    try {
      if (app.id === 'codex') {
        const content = fs.readFileSync(path.join(os.homedir(), '.codex/config.toml'), 'utf8');
        registered = Boolean(content.match(/\[mcp_servers\.session_status\][\s\S]*?(?=\n\[|$)/)?.[0].includes('codex-session-status.cjs'));
      } else {
        const data = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.gemini/antigravity/mcp_config.json'), 'utf8'));
        registered = Object.values(data.mcpServers || {}).some(server => server.args?.some(arg => typeof arg === 'string' && arg.endsWith('antigravity-session-status.cjs')));
      }
    } catch {}
    console.log(`${app.name}: ${formatProbeText(app, lang)}`);
    console.log(zh
      ? `  启用: ${enabled ? '是' : '否'}；后台: ${service ? '运行' : '停止'}；挂载标记: ${mounted}；MCP配置: ${registered ? '已注册' : '未注册'}`
      : `  Enabled: ${Boolean(enabled)}; daemon: ${service ? 'running' : 'stopped'}; mounted badges: ${mounted}; MCP configured: ${registered}`);
    if (app.id === 'antigravity') {
      console.log(zh ? `  鉴权健康检查: ${agyHealthy ? '通过' : '不可用'}` : `  Authenticated health: ${agyHealthy ? 'OK' : 'unavailable'}`);
      await showStartupDiagnosis({
        app,
        attachment: agyAttachment,
        expectedPort: env.antigravity.port || ANTIGRAVITY_CDP_PORT,
        stateDir: agyStateDir,
        stateFile: path.join(agyStateDir, 'startup-state.json'),
        label: 'com.antigravity.session-status',
        logDir: agyStateDir,
        logFile: 'daemon.log',
        windowLabel: 'Antigravity',
        enabled,
        running: service,
        zh,
      });
    }
    if (app.id === 'codex') {
      console.log(zh ? `  鉴权健康检查: ${codexHealthy ? '通过' : '不可用'}` : `  Authenticated health: ${codexHealthy ? 'OK' : 'unavailable'}`);
      await showStartupDiagnosis({
        app,
        attachment: codex,
        expectedPort: CDP_PORT,
        stateDir: DATA_DIR,
        logFile: 'agent.log',
        windowLabel: 'Codex',
        enabled,
        running: service,
        zh,
      });
    }
  }
  if (env.claude?.installed) {
    const stateFile = require('../harnesses/claude/claude-service.cjs').DEFAULT_STATE_FILE;
    let healthy = false, attachment = null;
    try { await requestProgressHttp(stateFile, '/health'); healthy = true; } catch {}
    try { attachment = JSON.parse(fs.readFileSync(path.join(path.dirname(stateFile), 'attachment.json'), 'utf8')); } catch {}
    if (attachment?.checkedAt && Date.now() - Date.parse(attachment.checkedAt) > 10000) {
      attachment = { state: zh ? '连接状态已过期' : 'connection status stale' };
    }
    const labels = zh
      ? { attached: '已连接', 'manual-debugger-required': '等待手动开启主进程调试器', error: attachment?.error || '连接失败' }
      : { attached: 'attached', 'manual-debugger-required': 'enable Main Process Debugger', error: attachment?.error || 'connection failed' };
    console.log(`Claude Desktop · Code: ${formatProbeText(env.claude, lang)}`);
    console.log(zh ? `  启用: ${config?.enabledApps.includes('claude') ? '是' : '否'}；后台: ${healthy ? '运行' : '停止'}；侧栏扩展: ${labels[attachment?.state] || attachment?.state || '等待连接'}`
      : `  Enabled: ${Boolean(config?.enabledApps.includes('claude'))}; service: ${healthy}; sidebar extension: ${labels[attachment?.state] || attachment?.state || 'waiting'}`);
  }
  if (config?.enabledApps.includes('claude') && fs.existsSync(path.join(os.homedir(), '.claude/skills/agent-things-ui/.claude-plugin/plugin.json'))) console.log(zh ? 'Claude 会话卡片：已安装，使用 /things。' : 'Claude conversation card: installed, run /things.');
  if (env.deepseek?.installed || config?.enabledApps.includes('deepseek')) {
    showDeepSeekDiagnosis(env.deepseek, Boolean(config?.enabledApps.includes('deepseek')), zh);
  }
  console.log(zh ? 'MCP宿主连接状态请在客户端确认；注册配置与实际连接分别判断。\n' : 'Confirm MCP host connection in the client; configuration and connection are separate checks.\n');
}

function showDeepSeekDiagnosis(deepseek, enabled, zh) {
  const home = os.homedir();
  const shortPath = target => (typeof target === 'string' && target ? target.replace(home, '~') : '');
  const lang = zh ? 'zh' : 'en';
  const nodeVer = deepseek?.nodeVersion;
  const nodeDesc = !nodeVer
    ? (zh ? '未检测到' : 'not detected')
    : `${nodeVer} (${deepseek.nodeCompatible === false ? (zh ? '不兼容，需 >= 24.9' : 'incompatible, needs >= 24.9') : (zh ? '兼容' : 'compatible')})`;

  const links = Array.isArray(deepseek?.profileLinks) ? deepseek.profileLinks : [];
  let mountDesc;
  if (links.length) {
    mountDesc = links.map(item => {
      if (item.valid) return item.version ? `${item.profile} (v${item.version})` : item.profile;
      const errMap = zh
        ? { 'not-in-bundles': '未加入 bundles', 'missing-link': '缺少 link 路径', 'missing-target': '链接目标不存在', 'missing-files': '产物缺失', 'missing-package': '未安装包' }
        : { 'not-in-bundles': 'missing from bundles', 'missing-link': 'missing link', 'missing-target': 'missing target', 'missing-files': 'missing files', 'missing-package': 'package missing' };
      return `${item.profile} (${errMap[item.error] || (zh ? '链接异常' : 'broken')})`;
    }).join(', ');
  } else if (Array.isArray(deepseek?.pluginProfiles) && deepseek.pluginProfiles.length) {
    mountDesc = deepseek.pluginProfiles.join(', ');
  } else {
    mountDesc = zh ? '未挂载' : 'not linked';
  }

  const bridge = deepseek?.bridge;
  let bridgeDesc;
  if (bridge?.reachable) {
    bridgeDesc = zh ? `运行中 (127.0.0.1:${bridge.port})` : `running (127.0.0.1:${bridge.port})`;
  } else if (bridge?.configured) {
    bridgeDesc = zh ? '已配置但当前未运行（启动 dsh --profile web 后激活）' : 'configured, inactive (start dsh --profile web)';
  } else {
    bridgeDesc = zh ? '未启动（启动 dsh --profile web 后激活）' : 'inactive (start dsh --profile web)';
  }

  const cfg = deepseek?.analysisConfig;
  const modelDesc = cfg?.mode === 'custom' && cfg?.model
    ? `${cfg.provider ? `${cfg.provider}/` : ''}${cfg.model}${cfg.reasoningEffort ? ` · ${cfg.reasoningEffort}` : ''}`
    : (zh ? `自动选择 · 4.1 Flash${cfg?.reasoningEffort ? ` · ${cfg.reasoningEffort}` : ' · Low'}` : `Auto · 4.1 Flash${cfg?.reasoningEffort ? ` · ${cfg.reasoningEffort}` : ' · Low'}`);
  const marked = Number.isInteger(deepseek?.markedSessions) ? deepseek.markedSessions : 0;

  console.log(`DeepSeek Harness: ${formatProbeText(deepseek, lang)}`);
  console.log(zh
    ? `  启用: ${enabled ? '是' : '否'}；Node: ${nodeDesc}；Bundle 挂载: ${mountDesc}；命令: /things`
    : `  Enabled: ${enabled}; Node: ${nodeDesc}; bundle linked: ${mountDesc}; command: /things`);
  console.log(zh
    ? `  Web 桥接: ${bridgeDesc}；解析模型: ${modelDesc}；已记录会话: ${marked}`
    : `  Web bridge: ${bridgeDesc}; analysis model: ${modelDesc}; marked sessions: ${marked}`);

  const validTargets = links.filter(item => item.valid && item.linkPath).map(item => `${item.profile} -> ${shortPath(item.linkPath)}`);
  let diagnosis = '';
  if (!deepseek?.installed) {
    diagnosis = zh ? '未检测到 dsh 命令。请先安装 @deepseek-ai/dsh（需 Node >= 24.9）。' : 'dsh CLI not detected. Install @deepseek-ai/dsh (requires Node >= 24.9) first.';
  } else if (deepseek.nodeCompatible === false) {
    diagnosis = zh ? `当前 dsh 配套 Node（${nodeVer || '未知'}）低于 24.9，请切换到 Node >= 24.9 环境。` : `Associated Node (${nodeVer || 'unknown'}) is below 24.9; switch to Node >= 24.9.`;
  } else if (Array.isArray(deepseek.brokenPluginProfiles) && deepseek.brokenPluginProfiles.length > 0) {
    diagnosis = zh ? `检测到失效挂载（${deepseek.brokenPluginProfiles.join(', ')}），请在管理菜单执行「同步组件与技能」修复。` : `Broken bundle link detected (${deepseek.brokenPluginProfiles.join(', ')}); run Sync components and skills in the management menu.`;
  } else if (enabled && !links.some(item => item.valid) && !(Array.isArray(deepseek.pluginProfiles) && deepseek.pluginProfiles.length)) {
    diagnosis = zh ? '已启用 DeepSeek Harness，但尚未挂载到 dsh profile。请在管理菜单执行「同步组件与技能」。' : 'DeepSeek Harness is enabled but not linked to a dsh profile. Run Sync components and skills in the management menu.';
  } else if (validTargets.length) {
    diagnosis = zh ? `挂载有效（${validTargets.join('; ')}）。` : `Healthy link (${validTargets.join('; ')}).`;
  }
  if (diagnosis) {
    console.log(`  ${zh ? '诊断' : 'Diagnosis'}: ${diagnosis}`);
  }
}

function completed(apps, zh) {
  console.log(zh ? `\n配置已保存。启用应用：${apps.join(', ') || '无（已停用）'}` : `\nConfiguration saved. Enabled: ${apps.join(', ') || 'none (disabled)'}`);
  console.log(zh ? '请在宿主中重新加载 MCP 配置。终端可以关闭。' : 'Reload MCP configuration in the host. You may close the terminal.');
  if (apps.length) console.log(zh ? '正常打开应用后，可从运行状态页检查挂载。' : 'Open the app normally and check mounting from Health Check.');
  if (apps.includes('codex')) console.log(zh ? 'ChatGPT.app 已打开但尚无标记时，请保存工作后正常退出，再从原图标打开。' : 'If ChatGPT.app is already open without badges, save your work, quit normally, and reopen its original icon.');
  if (apps.includes('antigravity')) console.log(zh
    ? 'Antigravity：Things 面板与 /things 已就绪；从原图标冷启动时会自动附带调试端口并挂载侧栏圆环。若当前已在运行且无圆环，请保存工作后完全退出再重开一次。'
    : 'Antigravity: Things pane and /things are ready; cold launches from its icon attach the debug port for sidebar rings. If already running without rings, save your work, quit, and reopen it once.');
  if (apps.includes('claude')) console.log(zh
    ? 'Claude Code：新会话会加载会话卡片；已有会话输入 /reload-plugins，再用 /things 打开。侧栏圆环可在开发者菜单手动开启 Enable Main Process Debugger 后挂载。'
    : 'Claude Code: new sessions load the card; run /reload-plugins in existing sessions, then /things. For sidebar rings, manually enable Developer → Enable Main Process Debugger.');
  if (apps.includes('deepseek')) console.log(zh
    ? 'DeepSeek Harness：运行 dsh --profile web 打开 Web UI，侧栏圆环、右侧 Things 面板、/things 命令及插件页「任务解析模型」配置均已就绪。'
    : 'DeepSeek Harness: run dsh --profile web to open Web UI; sidebar rings, Things right pane, /things, and Plugin Manager model settings are ready.');
}

async function runInteractiveCli(options = {}) {
  let config = readConfig();
  if (options.all || options.yes) {
    const env = await probeEnvironment();
    const apps = [env.codex, env.antigravity, env.claude, env.deepseek].filter(app => app?.installed).map(app => app.id);
    const lang = options.lang || config?.lang || detectSystemLang();
    if (!apps.length) {
      throw new Error(lang === 'en'
        ? 'No supported applications detected. Install ChatGPT.app, Antigravity.app, Claude.app, or DeepSeek Harness first.'
        : '未检测到支持的应用，请先安装 ChatGPT.app、Antigravity.app、Claude.app 或 DeepSeek Harness。');
    }
    await executeSetup({ lang, enabledApps: apps, autoRestartCodex: false, verify: verifyServices });
    completed(apps, lang === 'zh');
    return;
  }
  if (!process.stdin.isTTY) throw new Error('Interactive mode requires a terminal; use setup --yes for automatic installation. / 交互模式需要终端；自动安装请使用 setup --yes。');
  if (!config || config.installed === false || !fs.existsSync(path.join(DATA_DIR, 'runtime/bin/codex-session-status.cjs'))) {
    const env = await probeEnvironment();
    const defaultLang = config?.lang || detectSystemLang();
    const lang = options.lang || await selectLanguageWithProbe(env, defaultLang);
    if (lang === null) return;
    const apps = await selectApps(env, lang, config?.installed === false ? null : config?.enabledApps || null);
    if (apps === null || !apps.length) { console.log(lang === 'zh' ? '安装已取消。' : 'Setup cancelled.'); return; }
    let autoRestartCodex = false;
    let autoRestartAntigravity = false;
    if (apps.includes('codex') && env.codex.running && !env.codex.portActive) {
      const answer = await askConfirm(lang === 'zh' ? '是否现在正常退出并重新打开 ChatGPT.app 以启用挂载？请先保存工作。' : 'Quit and reopen ChatGPT.app to enable mounting now? Save your work first.', false, lang);
      if (answer === null) return;
      autoRestartCodex = answer;
    }
    if (apps.includes('antigravity') && env.antigravity.running && !env.antigravity.port) {
      const answer = await askConfirm(lang === 'zh' ? '是否现在正常退出并带调试端口重新打开 Antigravity.app 以启用侧边栏进度圆环？请先保存工作。' : 'Quit and reopen Antigravity.app with the debug port to enable sidebar progress rings now? Save your work first.', false, lang);
      if (answer === null) return;
      autoRestartAntigravity = answer;
    }
    await executeSetup({ lang, enabledApps: apps, autoRestartCodex, autoRestartAntigravity, verify: verifyServices });
    completed(apps, lang === 'zh');
    return;
  }
  let lang = options.lang || config.lang;
  let zh = lang === 'zh';
  await showHealthStatus(lang);
  while (true) {
    const items = [
      { label: zh ? '1. 查看运行状态' : '1. Health check', value: 'health' },
      { label: zh ? '2. 修改启用应用' : '2. Update enabled apps', value: 'apps' },
      { label: zh ? '3. 切换界面与分析语言（当前：简体中文）' : '3. Switch language (Current: English)', value: 'lang' },
      { label: zh ? '4. 检查更新 / 升级' : '4. Check for updates / upgrade', value: 'upgrade' },
      { label: zh ? '5. 同步组件与技能' : '5. Sync components and skills', value: 'sync' },
      { label: zh ? '6. 卸载' : '6. Uninstall', value: 'uninstall' },
      { label: zh ? '7. 退出' : '7. Exit', value: 'exit' },
    ];
    const action = await selectMenu(zh ? `Agent Things 管理（已启用：${config.enabledApps.join(', ') || '无'}）` : `Agent Things (Enabled: ${config.enabledApps.join(', ') || 'none'})`, items, lang);
    if (action === null || action === 'exit') return;
    if (action === 'health') { await showHealthStatus(lang); continue; }
    if (action === 'upgrade') { await showUpdates(lang); continue; }
    if (action === 'lang') {
      const nextLang = await selectLanguageWithProbe(await probeEnvironment(), lang);
      if (nextLang === null) continue;
      await executeSetup({ lang: nextLang, enabledApps: config.enabledApps, autoRestartCodex: false, verify: verifyServices });
      config = readConfig() || { ...config, lang: nextLang };
      lang = config.lang || nextLang;
      zh = lang === 'zh';
      completed(config.enabledApps, zh);
      continue;
    }
    if (action === 'uninstall') {
      if (await askConfirm(zh ? '卸载插件后台与入口，保留任务记录和备份？' : 'Uninstall services and integrations, preserving task records and backups?', false, lang)) {
        await uninstallAll(); console.log(zh ? '卸载完成，记录与备份已保留。请重新加载宿主 MCP 配置。' : 'Uninstalled; records and backups preserved. Reload the host MCP configuration.'); return;
      }
      continue;
    }
    let apps = config.enabledApps;
    if (action === 'apps') {
      apps = await selectApps(await probeEnvironment(), lang, config.enabledApps);
      if (apps === null) continue;
    }
    await executeSetup({ lang, enabledApps: apps, autoRestartCodex: false, verify: verifyServices });
    config = readConfig();
    completed(apps, zh);
  }
}
module.exports = { runInteractiveCli, showHealthStatus };
