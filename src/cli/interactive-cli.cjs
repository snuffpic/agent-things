'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { probeEnvironment, formatProbeText } = require('./environment-probe.cjs');
const { selectLanguageWithProbe, selectApps, askConfirm, selectMenu } = require('./prompt-tui.cjs');
const { readConfig, executeSetup, uninstallAll, DATA_DIR } = require('./setup-orchestrator.cjs');
const launchd = require('../launchd.cjs');
const { CdpSession, listTargets } = require('../cdp.cjs');
const { attachmentStatus } = require('../manual-status-agent.cjs');
const { requestProgressHttp } = require('../local-progress-http.cjs');
const { getUpdateInfo, startUpdate, verifyServices } = require('../npm-updates.cjs');
const { startupStatus } = require('../manual-status-startup.cjs');
const { portInUse } = require('../startup/watch.cjs');
const { COOLDOWN_MS } = require('../startup/controller.cjs');
async function showUpdates(lang) {
  const zh = lang === 'zh';
  console.log(zh ? '\n正在检查 npm 最新版本…' : '\nChecking npm for updates…');
  try {
    const info = await getUpdateInfo({ force: true });
    console.log(zh ? `当前安装版本：${info.currentVersion || '未安装'}` : `Installed version: ${info.currentVersion || 'not installed'}`);
    if (['queued', 'checking', 'downloading', 'waiting', 'installing'].includes(info.update?.stage)) {
      const stages = { queued: '等待启动', checking: '检查版本', downloading: '下载中', waiting: '等待分析结束', installing: '升级中' };
      console.log(zh ? `升级正在后台进行：${stages[info.update.stage]}。终端可以关闭。` : `Update running in background: ${info.update.stage}. You may close the terminal.`);
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

async function showCodexDiagnosis(app, attachment, enabled, running, zh) {
  if (!enabled || !app.installed) return;
  let startup;
  try { startup = startupStatus(DATA_DIR); }
  catch (error) { console.log(`  ${zh ? '读取启动记录失败' : 'Cannot read startup history'}: ${error.message}`); }
  const events = {
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
  if (startup?.event) {
    const date = startup.updatedAt ? ` · ${new Date(startup.updatedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}` : '';
    console.log(`  ${zh ? '最近启动记录' : 'Last startup event'}: ${events[startup.event]?.[zh ? 0 : 1] || startup.event}${date}`);
  }
  let diagnosis;
  if (!running) diagnosis = zh ? '插件后台未运行。请在管理菜单同步组件与技能。' : 'The plugin daemon is stopped. Sync components and skills from the menu.';
  else if (attachment.authHealthy === false) diagnosis = zh ? '后台进程存在，但鉴权健康检查未通过。请在管理菜单同步组件并查看启动日志。' : 'The daemon process exists, but its authenticated health check failed. Sync components and inspect the startup log.';
  else if (!app.running) diagnosis = zh ? '等待 ChatGPT.app 启动。' : 'Waiting for ChatGPT.app to launch.';
  else if (!attachment.portOpen && await portInUse()) diagnosis = zh ? '39222 已被监听，但无法连接到调试接口。请检查端口占用。' : 'Port 39222 is listening, but its debugger is unreachable. Check which process owns the port.';
  else if (!attachment.portOpen) {
    const retry = startup?.lastAttemptAt && startup.lastAttemptAt + COOLDOWN_MS - Date.now();
    diagnosis = zh ? '当前客户端没有开启 39222 调试端口。保存工作后完全退出 ChatGPT.app，再从原图标打开。' : 'The client has no debugger on port 39222. Save your work, fully quit ChatGPT.app, then open it again.';
    if (retry > 0) diagnosis += zh ? ` 建议在 ${Math.ceil(retry / 1000)} 秒后重开。` : ` Reopen after ${Math.ceil(retry / 1000)} seconds.`;
  } else if (!attachment.windows.length) diagnosis = zh ? '调试端口可连接，等待 Codex 主窗口。' : 'Debugger reachable. Waiting for a Codex main window.';
  else if (!attachment.windows.some(window => window.version)) diagnosis = zh ? '已找到主窗口，界面组件尚未挂载。' : 'Main window found. The UI component has not attached yet.';
  else diagnosis = zh ? '界面组件已挂载。' : 'UI component attached.';
  console.log(`  ${zh ? '诊断' : 'Diagnosis'}: ${diagnosis}`);
  if (startup?.logDirectory) console.log(`  ${zh ? '启动日志' : 'Startup log'}: ${path.join(startup.logDirectory, 'agent.log')}`);
}

async function showHealthStatus(lang) {
  const env = await probeEnvironment();
  const config = readConfig();
  const zh = (lang || config?.lang || 'zh') === 'zh';
  lang = zh ? 'zh' : 'en';
  console.log(zh ? '\nAgent Things 运行状态' : '\nAgent Things Health Check');
  const codex = await attachmentStatus(39222);
  let codexHealthy = false;
  try { await requestProgressHttp(path.join(DATA_DIR, 'manual-state.json'), '/health', undefined, undefined, { timeoutMs: 1000 }); codexHealthy = true; } catch {}
  codex.authHealthy = codexHealthy;
  let agyHealthy = false, agyMounted = 0;
  const agyState = path.join(os.homedir(), '.gemini/antigravity/session-status/manual-state.json');
  try { await requestProgressHttp(agyState, '/health'); agyHealthy = true; } catch {}
  if (env.antigravity.port) {
    for (const target of await listTargets(env.antigravity.port, 1000).catch(() => [])) {
      if (target.type !== 'page' || !/^(https?:\/\/(127\.0\.0\.1|localhost)|vscode-file:)/.test(target.url)) continue;
      const session = new CdpSession(target, env.antigravity.port);
      try {
        await session.connect();
        const { result } = await session.evaluate('window.__codexSessionStatus?.status().mounted || 0');
        agyMounted += Number(result.value) || 0;
      } catch {} finally { session.close(); }
    }
  }
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
    if (app.id === 'antigravity') console.log(zh ? `  鉴权健康检查: ${agyHealthy ? '通过' : '不可用'}` : `  Authenticated health: ${agyHealthy ? 'OK' : 'unavailable'}`);
    if (app.id === 'codex') console.log(zh ? `  鉴权健康检查: ${codexHealthy ? '通过' : '不可用'}` : `  Authenticated health: ${codexHealthy ? 'OK' : 'unavailable'}`);
    if (app.id === 'codex') await showCodexDiagnosis(app, codex, enabled, service, zh);
  }
  if (env.claude?.installed) {
    const stateFile = require('../harnesses/claude/claude-service.cjs').DEFAULT_STATE_FILE;
    let healthy = false, attachment = null;
    try { await requestProgressHttp(stateFile, '/health'); healthy = true; } catch {}
    try { attachment = JSON.parse(fs.readFileSync(path.join(path.dirname(stateFile), 'attachment.json'), 'utf8')); } catch {}
    if (attachment?.checkedAt && Date.now() - Date.parse(attachment.checkedAt) > 10000) attachment = { state: '连接状态已过期' };
    const labels = { attached: '已连接', 'manual-debugger-required': '等待手动开启主进程调试器', error: attachment?.error || '连接失败' };
    console.log(`Claude Desktop · Code: ${formatProbeText(env.claude, lang)}`);
    console.log(zh ? `  启用: ${config?.enabledApps.includes('claude') ? '是' : '否'}；后台: ${healthy ? '运行' : '停止'}；侧栏扩展: ${labels[attachment?.state] || attachment?.state || '等待连接'}`
      : `  Enabled: ${Boolean(config?.enabledApps.includes('claude'))}; service: ${healthy}; sidebar extension: ${attachment?.state || 'waiting'}`);
  }
  if (config?.enabledApps.includes('claude') && fs.existsSync(path.join(os.homedir(), '.claude/skills/agent-things-ui/.claude-plugin/plugin.json'))) console.log(zh ? 'Claude 会话卡片：已安装，使用 /things。' : 'Claude conversation card: installed, run /things.');
  console.log(zh ? 'MCP宿主连接状态请在客户端确认；注册配置与实际连接分别判断。\n' : 'Confirm MCP host connection in the client; configuration and connection are separate checks.\n');
}

function completed(apps, zh) {
  console.log(zh ? `\n配置已保存。启用应用：${apps.join(', ') || '无（已停用）'}` : `\nConfiguration saved. Enabled: ${apps.join(', ') || 'none (disabled)'}`);
  console.log(zh ? '请在宿主中重新加载 MCP 配置。终端可以关闭。' : 'Reload MCP configuration in the host. You may close the terminal.');
  if (apps.length) console.log(zh ? '正常打开应用后，可从运行状态页检查挂载。' : 'Open the app normally and check mounting from Health Check.');
  if (apps.includes('codex')) console.log(zh ? 'ChatGPT.app 已打开但尚无标记时，请保存工作后正常退出，再从原图标打开。' : 'If ChatGPT.app is already open without badges, save your work, quit normally, and reopen its original icon.');
  if (apps.includes('claude')) console.log(zh
    ? 'Claude Code：新会话会加载会话卡片；已有会话输入 /reload-plugins，再用 /things 打开。侧栏圆环可在开发者菜单手动开启 Enable Main Process Debugger 后挂载。'
    : 'Claude Code: new sessions load the card; run /reload-plugins in existing sessions, then /things. For sidebar rings, manually enable Developer → Enable Main Process Debugger.');
}

async function runInteractiveCli(options = {}) {
  let config = readConfig();
  if (options.all || options.yes) {
    const env = await probeEnvironment();
    const apps = [env.codex, env.antigravity, env.claude].filter(app => app?.installed).map(app => app.id);
    if (!apps.length) throw new Error('未检测到支持的应用，请先安装 ChatGPT.app、Antigravity.app 或 Claude.app。');
    const lang = options.lang || config?.lang || 'zh';
    await executeSetup({ lang, enabledApps: apps, autoRestartCodex: false, verify: verifyServices });
    completed(apps, lang === 'zh');
    return;
  }
  if (!process.stdin.isTTY) throw new Error('交互模式需要终端；自动安装请使用 setup --yes。');
  if (!config || config.installed === false || !fs.existsSync(path.join(DATA_DIR, 'runtime/bin/codex-session-status.cjs'))) {
    const env = await probeEnvironment();
    const lang = options.lang || await selectLanguageWithProbe(env, config?.lang || 'zh');
    if (lang === null) return;
    const apps = await selectApps(env, lang, config?.installed === false ? null : config?.enabledApps || null);
    if (apps === null || !apps.length) { console.log(lang === 'zh' ? '安装已取消。' : 'Setup cancelled.'); return; }
    let restart = false;
    if (apps.includes('codex') && env.codex.running && !env.codex.portActive) {
      const answer = await askConfirm(lang === 'zh' ? '是否现在正常退出并重新打开 ChatGPT.app 以启用挂载？请先保存工作。' : 'Quit and reopen ChatGPT.app to enable mounting now? Save your work first.', false, lang);
      if (answer === null) return;
      restart = answer;
    }
    await executeSetup({ lang, enabledApps: apps, autoRestartCodex: restart, verify: verifyServices });
    completed(apps, lang === 'zh');
    return;
  }
  const lang = options.lang || config.lang, zh = lang === 'zh';
  await showHealthStatus(lang);
  while (true) {
    const items = [
      { label: zh ? '1. 查看运行状态' : '1. Health check', value: 'health' },
      { label: zh ? '2. 修改启用应用' : '2. Update enabled apps', value: 'apps' },
      { label: zh ? '3. 检查更新 / 升级' : '3. Check for updates / upgrade', value: 'upgrade' },
      { label: zh ? '4. 同步组件与技能' : '4. Sync components and skills', value: 'sync' },
      { label: zh ? '5. 卸载' : '5. Uninstall', value: 'uninstall' },
      { label: zh ? '6. 退出' : '6. Exit', value: 'exit' },
    ];
    const action = await selectMenu(zh ? `Agent Things 管理（已启用：${config.enabledApps.join(', ') || '无'}）` : `Agent Things (Enabled: ${config.enabledApps.join(', ') || 'none'})`, items, lang);
    if (action === null || action === 'exit') return;
    if (action === 'health') { await showHealthStatus(lang); continue; }
    if (action === 'upgrade') { await showUpdates(lang); continue; }
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
