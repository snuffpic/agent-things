'use strict';
(function () {
  const getUiText = (key, fallback, zhFallback) => {
    const p = window.__agentThingsPresentation;
    const lang = window.__agentThingsLang || p?.lang || 'zh';
    if (key) {
      const ui = p?.forLang ? p.forLang(lang) : null;
      const val = ui?.strings?.[key] ?? p?.strings?.[key];
      if (val) return val;
    }
    return lang === 'en' ? fallback : (zhFallback || fallback);
  };
  const padding = new Map();
  let lastSyncedThemeKey = '';
  const syncClaudeThemeAccent = () => {
    try {
      const mode = document.documentElement?.dataset?.mode === 'light' ? 'light' : 'dark';
      let codeTheme = mode === 'light' ? 'claude-light' : 'claude-dark';
      try {
        const rawPrefs = window.localStorage?.getItem('epitaxy-editor-prefs');
        if (rawPrefs) {
          const parsed = JSON.parse(rawPrefs);
          const picked = mode === 'light' ? parsed?.state?.codeThemeLight : parsed?.state?.codeThemeDark;
          if (typeof picked === 'string' && picked.trim()) codeTheme = picked.trim();
        }
      } catch {}
      const p = window.__agentThingsPresentation;
      const themes = p?.claudeCodeThemes || { 'claude-light': '#C6613F', 'claude-dark': '#D97757' };
      const mappedAccent = themes[codeTheme] || (mode === 'light' ? '#C6613F' : '#D97757');
      window.__agentThingsHostAccent = mappedAccent;
      document.documentElement?.style?.setProperty('--agent-things-accent', mappedAccent);
      const sig = `${mode}:${codeTheme}:${mappedAccent}`;
      if (sig !== lastSyncedThemeKey && typeof window.__agentThingsClaudeSend === 'function') {
        lastSyncedThemeKey = sig;
        try {
          window.__agentThingsClaudeSend(JSON.stringify({
            type: 'theme-sync',
            requestId: `theme-${Date.now().toString(36)}`,
            mode,
            codeTheme,
            accent: mappedAccent,
          }));
        } catch {}
      }
    } catch {}
  };
  const identity = row => row.closest('[data-row-key]')?.getAttribute('data-row-key');
  const mainButton = row => [...row.querySelectorAll('[data-row-main-button]')].find(node => node.closest('[data-row]') === row);
  const harness = {
    globalName: '__claudeSessionStatus',
    startupRows: () => [...document.querySelectorAll('.dframe-sidebar .df-session-list [data-row]')].filter(row => identity(row)?.startsWith('code:')),
    attributeFilter: ['data-row-key', 'data-selected', 'aria-current', 'class', 'hidden', 'aria-expanded', 'style', 'data-theme', 'data-mode'],
    send: payload => window.__agentThingsClaudeSend(payload),
    isRowSelected: row => mainButton(row)?.getAttribute('aria-current') === 'page' || ['true', 'open', 'focused'].includes(row.getAttribute('data-selected')),
    unmount(entry) {
      const previous = padding.get(entry.row);
      if (previous) { previous.button.style.paddingInlineStart = previous.padding; entry.row.style.position = previous.position; padding.delete(entry.row); }
    },
    async locate({ entry, source, analysisMessage, request }) {
      const row = [...document.querySelectorAll('.dframe-sidebar [data-row]')].find(node => identity(node) === `code:${entry.threadId}`);
      if (!row) { analysisMessage.textContent = getUiText(null, 'Please expand the corresponding session in the sidebar first', '请先在侧栏展开对应会话'); return; }
      const scope = document.querySelector(`[data-session-id="${CSS.escape(entry.threadId)}"]`)?.closest('.epitaxy-chat-panel');
      const target = source.itemId && scope?.querySelector(['data-epitaxy-entry', 'data-entry-key', 'data-turn-key']
        .map(attribute => `[${attribute}="${CSS.escape(source.itemId)}"]`).join(','));
      if (target) { target.scrollIntoView({ block: 'center', behavior: 'instant' }); analysisMessage.textContent = getUiText('locatedMessage', 'Located source', '已定位来源'); return; }
      analysisMessage.textContent = getUiText('locatingSourceMessage', 'Locating source message...', '正在定位来源消息…');
      const result = await request('locate-source', 22000, { source });
      if (result?.located) analysisMessage.textContent = getUiText('locatedMessage', 'Located source', '已定位来源');
      else analysisMessage.textContent = result?.message || getUiText('locateUnavailable', 'Unable to locate source message right now', '暂时无法定位来源消息');
    },
    async openPane({ entry, request }) {
      // 先切到该会话，再请求本地后台转达给该会话的 mod，由 mod 打开常驻侧栏面板。
      const row = [...document.querySelectorAll('.dframe-sidebar [data-row]')].find(node => identity(node) === `code:${entry.threadId}`);
      const main = row && mainButton(row);
      if (main && !harness.isRowSelected(row)) main.click();
      const result = await request('open-pane', 9000);
      if (!result?.delivered) throw new Error(getUiText(null,
        'The Agent Things plugin is not running in this session yet. Type /reload-plugins or send a message in that session, then click again.',
        '该会话的 Agent Things 插件未在运行。请在该会话输入 /reload-plugins 或先发送一条消息，再点一次。'));
    },
    reconcile({ mounted, unmount, attachHost, paint, paintVisibility, openPanel, closePanel, isPanelEntry }) {
      syncClaudeThemeAccent();
      for (const [row, entry] of [...mounted]) {
        if (!row.isConnected || !entry.host.isConnected || identity(row) !== `code:${entry.threadId}`) unmount(entry);
      }
      for (const row of document.querySelectorAll('.dframe-sidebar .df-session-list [data-row]')) {
        const key = identity(row);
        const main = mainButton(row);
        if (!key?.startsWith('code:') || row.tagName !== 'DIV' || !main) continue;
        const threadId = key.slice(5);
        if (!threadId || threadId.length > 256) continue;
        const title = (row.querySelector('[data-row-label]')?.textContent || main.textContent || getUiText('fallbackThreadTitle', 'Session', '会话')).trim();
        let entry = mounted.get(row);
        if (entry) { if (entry.title !== title) { entry.title = title; paint(entry); } paintVisibility(entry); continue; }
        padding.set(row, { button: main, padding: main.style.paddingInlineStart, position: row.style.position });
        const inset = parseFloat(getComputedStyle(main).paddingInlineStart) || 0;
        main.style.paddingInlineStart = `${inset + 28}px`;
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
        const slot = document.createElement('span');
        slot.className = 'status-slot-injected';
        slot.style.cssText = `position:absolute;inset-inline-start:calc(${inset}px + var(--df-row-indent, 0px) * 0.3);top:50%;transform:translateY(-50%);width:24px;height:24px;display:flex;z-index:4;`;
        row.append(slot);
        const { host, button, original } = attachHost(slot, false, null);
        const onEnter = () => { entry.hovered = true; paintVisibility(entry); };
        const onLeave = () => { entry.hovered = false; paintVisibility(entry); };
        row.addEventListener('pointerenter', onEnter); row.addEventListener('pointerleave', onLeave);
        button.addEventListener('pointerdown', event => event.stopPropagation());
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          if (isPanelEntry(entry)) closePanel(); else { closePanel(); openPanel(entry); }
        });
        entry = { row, key: JSON.stringify(['local', threadId]), threadId, rawHost: 'local', title, slot, host, button, original, hovered: false, ringKey: null, onEnter, onLeave };
        mounted.set(row, entry); paint(entry);
      }
    },
    dispose() { window.removeEventListener?.('storage', syncClaudeThemeAccent); window.removeEventListener?.('focus', syncClaudeThemeAccent); delete window.__sessionStatusHarness; },
  };
  window.addEventListener?.('storage', syncClaudeThemeAccent);
  window.addEventListener?.('focus', syncClaudeThemeAccent);
  syncClaudeThemeAccent();
  window.__sessionStatusHarness = harness;
})();

// <generated-presentation-fallback>
if (typeof globalThis !== 'undefined' && !globalThis.__agentThingsPresentation) {
  globalThis.__agentThingsPresentation = (function createPresentation(lang) {
  const normalizeLang = value => (value === 'en' ? 'en' : 'zh');
  const currentLang = normalizeLang(lang ?? (typeof globalThis !== 'undefined' ? globalThis.__agentThingsLang : undefined));
  const colors = { unstarted: '#9098a2', unfinished: '#c89b38', completed: '#548eea', pushed: '#a17be3' };
  const layout = { contentWidth: 300, panelWidth: 340, progressNodes: [0, 25, 50, 75, 100] };
  const accent = { normal: '#0169CC', hover: '#005bb3', pressed: '#004f9c', onAccent: '#FFFFFF' };
  const claudeCodeThemes = {
    'claude-light': '#C6613F',
    'claude-dark': '#D97757',
    'github-light': '#0969DA',
    'github-light-high-contrast': '#0550AE',
    'github-dark': '#1F6FEB',
    'github-dark-dimmed': '#316DCA',
    'github-dark-high-contrast': '#409EFF',
    'pierre-light': '#0073E6',
    'pierre-dark': '#0087EE',
    'vscode-light': '#007ACC',
    'vscode-dark': '#007ACC',
    'one-light': '#4078F2',
    'one-dark-pro': '#61AFEF',
    'catppuccin-latte': '#8839EF',
    'catppuccin-mocha': '#CBA6F7',
    'solarized-light': '#268BD2',
    'solarized-dark': '#268BD2',
    'vitesse-light': '#4D9375',
    'vitesse-dark': '#4D9375',
    'min-light': '#256ABF',
    'min-dark': '#5598E7',
    'rose-pine-dawn': '#D7827E',
    'rose-pine': '#EA9A97',
    'slack-ochin': '#1264A3',
    'slack-dark': '#36C5F0',
    'dracula': '#BD93F9',
    'dracula-soft': '#BD93F9',
    'nord': '#88C0D0',
    'monokai': '#F92672',
    'tokyo-night': '#7AA2F7',
    'night-owl': '#82AAFF',
    'ayu-dark': '#E6B450',
  };

  function normalizeHexColor(value, fallback = null) {
    if (typeof value !== 'string') return fallback;
    const raw = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toUpperCase();
    }
    const rgbMatch = raw.match(/^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/i);
    if (rgbMatch) {
      const toHex = n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0');
      return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`.toUpperCase();
    }
    return fallback;
  }

  function hexToRgb(hex) {
    const clean = normalizeHexColor(hex, '#0169CC').slice(1);
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  function getRelativeLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(channel => {
      const srgb = channel / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function mixHexColors(hexA, hexB, weightA) {
    const [r1, g1, b1] = hexToRgb(hexA);
    const [r2, g2, b2] = hexToRgb(hexB);
    const wA = Math.max(0, Math.min(1, weightA));
    const wB = 1 - wA;
    const toHex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(r1 * wA + r2 * wB)}${toHex(g1 * wA + g2 * wB)}${toHex(b1 * wA + b2 * wB)}`.toUpperCase();
  }

  function resolveAccentPalette(rawColor, { isDark = true, fallback = '#0169CC' } = {}) {
    const normal = normalizeHexColor(rawColor, normalizeHexColor(fallback, '#0169CC'));
    const lum = getRelativeLuminance(normal);
    const onAccent = lum > 0.45 ? '#0D0D0D' : '#FFFFFF';
    // Darken bright accents or shade toward dark/light ink subtly without losing hue identity.
    const mixTarget = lum > 0.45 ? '#000000' : (isDark ? '#FFFFFF' : '#000000');
    const hoverWeight = lum > 0.45 ? 0.88 : (isDark ? 0.88 : 0.88);
    const pressedWeight = lum > 0.45 ? 0.78 : (isDark ? 0.78 : 0.78);
    return {
      normal,
      hover: mixHexColors(normal, mixTarget, hoverWeight),
      pressed: mixHexColors(normal, mixTarget, pressedWeight),
      onAccent,
    };
  }

  const locales = {
    zh: {
      appTitle: 'Agent Things',
      docTitleSuffix: '任务进展',
      defaultDocTitle: 'Agent Things 会话任务进度',
      defaultSessionTitle: '当前会话',
      fallbackShortTitle: '会话进度',
      fallbackThreadTitle: '会话',
      labels: {
        unstarted: '尚未开始',
        unfinished: '有遗留事项',
        completed: '全部完成',
        pushed: '全部完成并已推送',
      },
      taskLabels: {
        todo: '待开始',
        in_progress: '进行中',
        blocked: '受阻',
        needs_verification: '待验收',
        done: '已完成',
        unknown: '状态未知',
      },
      unrecordedSummary: '尚未记录进展',
      unorganized: '未整理',
      progressUnrecorded: '进度未记录',
      sidebarUpdating: '正在更新进度',
      sidebarTooltipPattern: '{title}：{status}，点击记录任务进展',
      noTasksYet: '暂无任务统计',
      totalsPattern: '已完成 {done} / {total} 项任务',
      basisPattern: '已完成 {done}/{total} 项任务，剩余 {remaining} 项（{remainingPercent}%）',
      basisEmpty: '暂无任务',
      sourceAuto: '自动分析',
      sourceManual: '手动调整',
      sourceManualRecord: '手动记录',
      btnUpdate: '更新进度',
      btnUpdating: '正在分析…',
      btnAdjust: '手动调整',
      btnClear: '清除进度',
      clearTooltip: '立即清除进度与任务记录',
      clearConfirm: '确定要清除本会话的任务进度和记录吗？',
      clearingFeedback: '正在清除…',
      clearedFeedback: '✓ 已清空进度',
      clearFailedPrefix: '清除失败: ',
      openInSidebar: '在侧栏打开',
      openPaneFailedPrefix: '打开侧栏失败: ',
      close: '关闭',
      expandAll: '查看全部',
      collapse: '收起',
      remainingHeadingPattern: '剩余任务 {count}',
      showAllCountPattern: '查看全部 {count} 条 ›',
      collapseArrow: '收起 ›',
      emptyNoTasks: '点击更新进度，整理这次会话的任务',
      emptyNoRemaining: '暂无未完成任务',
      completedHeading: '已完成任务',
      countArrowPattern: '{count} 条 ›',
      notesLabel: '备注',
      addLabel: '添加',
      editLabel: '编辑',
      untitledTask: '未命名事项',
      completedTaskFallback: '已完成事项',
      viewSource: '查看来源',
      viewSourceAriaPrefix: '查看来源：',
      backLabel: '‹ 返回',
      backPlain: '返回',
      emptyCompleted: '暂无已完成任务',
      emptySourceText: '此记录没有可显示的原文',
      editHeading: '手动记录会话状态',
      progressLabel: '进度',
      progressAltPattern: '进度 {value}%',
      progressUnrecordedWord: '未记录',
      currentProgressAlt: '当前进度',
      clearValueBtn: '清空进度',
      notePlaceholder: '记下下一步要做的事…',
      noteAriaLabel: '事项备注',
      sliderAriaLabel: '拖动调整进度',
      cancelBtn: '取消',
      saveBtn: '保存记录',
      savingBtn: '正在保存…',
      savingFeedback: '正在保存…',
      savedFeedback: '✓ 保存成功',
      saveFailedPrefix: '保存失败: ',
      conflictBanner: '保存冲突：内容已被其他入口修改。当前草稿已保留。',
      conflictShortToast: '保存冲突，已保留当前草稿',
      conflictDetectedFeedback: '保存失败：检测到版本冲突',
      resolveConflictBtn: '读取最新版本并保留草稿',
      conflictRebasedFeedback: '基准版本已对齐最新状态，再次点击保存即可提交当前草稿。',
      conflictReloadedFeedback: '已读取最新版本，草稿已保留。再次保存即可提交。',
      timelineHeading: '进展记录',
      timelineLink: '进展记录 ›',
      emptyTimeline: '暂无进展记录',
      dividerAlt: '分隔线',
      loadingTitle: '正在读取会话进度…',
      loadingAlt: '加载中',
      loadingTasksAlt: '正在加载任务列表',
      loadingSubtitle: '正在同步当前会话任务，完成后将自动更新…',
      notLoadedTitle: '尚未读取到会话进度',
      notLoadedAlt: '未读取',
      retryLoadBtn: '重试读取',
      processing: '正在处理…',
      retryingStatus: '状态查询暂时失败，正在重试…',
      locatingMessage: '正在定位消息…',
      locatingShort: '定位中...',
      locatingSourceMessage: '正在定位来源消息…',
      locatedMessage: '已定位来源',
      locatedJumpMessage: '已跳转并定位到会话来源',
      locateSent: '已发送定位请求',
      locateFailedPrefix: '定位失败：',
      locateHostUnavailable: '未能连接宿主定位接口',
      locateNotFound: '未找到对应会话消息',
      locateUnsupported: '当前环境不支持跳转来源',
      locateTimeout: '定位来源超时，请在原会话中确认历史消息',
      locateNoSource: '此记录没有可定位的消息',
      locateHostDisconnected: '当前宿主未连接，暂时无法定位来源消息',
      locateOpenFailed: '无法打开来源会话',
      locateUnavailable: '暂时无法定位来源消息',
      locateCommandErrorPrefix: '跳转失败：',
      startingAnalysisFeedback: '正在开始分析…',
      updateFailedPrefix: '更新失败: ',
      analysisNotDonePrefix: '分析未完成: ',
      analysisFailedPrefix: '分析失败：',
      analysisFailedWord: '分析失败',
      analyzingWord: '分析中',
      analysisFailedRetry: '请重试',
      analysisAbnormal: '执行异常',
      analysisStages: {
        starting: '正在启动分析…',
        reading: '正在读取会话…',
        analyzing: '正在分析任务…',
        retrying: '正在重新连接…',
      },
      invalidProgressError: '请输入 0–100 的整数，或留空',
      unknownActionError: '未知错误',
      gitCheckUnavailable: '暂时无法检测 Git 信息',
      sidebarHintText: '如需启用侧边栏插件，请打开「开发者 → Enable Main Process Debugger」。',
      dismissHint: '不再提醒',
      updateStages: {
        queued: '正在准备升级',
        checking: '正在检查版本',
        downloading: '正在下载新版本',
        waiting: '等待当前分析结束',
        installing: '正在升级',
      },
      updateAvailablePattern: '发现新版本 v{version}',
      upgradedToPattern: '已升级至 v{version}',
      updateFailedLabel: '升级失败',
      upgradeBtn: '立即升级',
      upgradingShort: '正在升级…',
      checkUpdateBtn: '检查更新',
      checkingUpdateShort: '正在检查…',
      alreadyLatestPattern: '当前已是最新版 v{version}',
      versionTagPattern: 'v{version}',
      checkUpdateFailedLabel: '检查更新失败',
      pleaseWait: '请稍候',
      completedShort: '已完成',
      retryBtn: '重试',
      terminalUpgradePrefix: '终端升级：',
      reconnectHint: '正在重新连接后台，升级状态将在连接后恢复',
      reconnectMcpHint: '请在客户端重新连接 MCP 服务',
      cardCommandDescription: '打开会话任务进度卡片',
      cardCommandReply: 'Agent Things · 会话任务进度',
      cardMissingSession: '卡片缺少当前会话信息',
      cardAuthUnavailable: '卡片授权不可用，请重新打开会话进度卡片',
      cardSyncUnavailable: '卡片同步暂不可用',
      cardTimeout: '卡片连接超时',
      cardClosed: '卡片已关闭',
      cardOpFailed: '卡片操作失败',
      cardRequestCancelled: '请求已取消',
      cardRequestTimeout: '请求超时，请重试',
      cardStatusDisconnected: '状态连接暂不可用',
      cardDaemonDisconnected: '本地进程已断开',
      claudeInlineOffline: '本地后台连接失败',
      mdProgressHeading: '当前会话任务进度',
      mdStateDone: '全部完成 (100%)',
      mdStateUnstarted: '未开始',
      mdTasksOverview: '任务总览',
      mdTasksEmpty: '暂无任务清单',
      mdNotesLabel: '会话备注',
      mdQuickActionsLabel: '快捷交互',
      mdQuickActionsText: '可在卡片中点击“手动调整”滑动调整进度或修改备注，或点击“更新进度”开始自动分析。',
      hookPresentedMessage: '已呈现当前会话任务进度卡片',
      noSessionBadge: '无会话',
      offlineBadge: '离线',
      badgeNotOrganized: '未整理',
      badgeProgressUnrecordedSuffix: ' · 进度未记录',
      ringAriaPattern: '{title}：{summary}，点击记录任务进展',
      ringUpdating: '正在更新进度',
      sessionFallbackTitle: '会话',
      statusUnrecorded: '尚未记录进展',
      panelAriaPattern: '{title} 任务进展',
      totalsEmpty: '暂无任务统计',
      taskUnknown: '状态未知',
      timelineAnalysis: '自动分析',
      timelineManual: '手动记录',
      unrecordedShort: '未记录',
    },
    en: {
      appTitle: 'Agent Things',
      docTitleSuffix: 'Progress',
      defaultDocTitle: 'Agent Things Progress',
      defaultSessionTitle: 'Current session',
      fallbackShortTitle: 'Session progress',
      fallbackThreadTitle: 'Session',
      labels: {
        unstarted: 'Not started',
        unfinished: 'Remaining items',
        completed: 'Completed',
        pushed: 'Completed & pushed',
      },
      taskLabels: {
        todo: 'To do',
        in_progress: 'In progress',
        blocked: 'Blocked',
        needs_verification: 'Needs verification',
        done: 'Done',
        unknown: 'Unknown status',
      },
      unrecordedSummary: 'No progress recorded',
      unorganized: 'Not organized',
      progressUnrecorded: 'Progress not recorded',
      sidebarUpdating: 'Updating progress',
      sidebarTooltipPattern: '{title}: {status} · Click to track progress',
      noTasksYet: 'No task stats yet',
      totalsPattern: '{done} of {total} tasks done',
      basisPattern: 'Completed {done}/{total} tasks, {remaining} remaining ({remainingPercent}%)',
      basisEmpty: 'No tasks yet',
      sourceAuto: 'Auto-analyzed',
      sourceManual: 'Manual',
      sourceManualRecord: 'Manual',
      btnUpdate: 'Update progress',
      btnUpdating: 'Analyzing...',
      btnAdjust: 'Adjust',
      btnClear: 'Clear',
      clearTooltip: 'Clear progress and task records now',
      clearConfirm: 'Clear progress and task records for this session?',
      clearingFeedback: 'Clearing...',
      clearedFeedback: '✓ Cleared',
      clearFailedPrefix: 'Clear failed: ',
      openInSidebar: 'Open in sidebar',
      openPaneFailedPrefix: 'Open sidebar failed: ',
      close: 'Close',
      expandAll: 'Show all',
      collapse: 'Collapse',
      remainingHeadingPattern: 'Remaining tasks ({count})',
      showAllCountPattern: 'Show all {count} ›',
      collapseArrow: 'Collapse ›',
      emptyNoTasks: 'Click Update progress to organize tasks for this session',
      emptyNoRemaining: 'No remaining tasks',
      completedHeading: 'Completed tasks',
      countArrowPattern: '{count} ›',
      notesLabel: 'Notes',
      addLabel: 'Add',
      editLabel: 'Edit',
      untitledTask: 'Untitled task',
      completedTaskFallback: 'Completed task',
      viewSource: 'View source',
      viewSourceAriaPrefix: 'View source: ',
      backLabel: '‹ Back',
      backPlain: 'Back',
      emptyCompleted: 'No completed tasks',
      emptySourceText: 'No original message text available for this record',
      editHeading: 'Set session status',
      progressLabel: 'Progress',
      progressAltPattern: 'Progress {value}%',
      progressUnrecordedWord: 'unrecorded',
      currentProgressAlt: 'Current progress',
      clearValueBtn: 'Clear value',
      notePlaceholder: 'Add next steps or notes...',
      noteAriaLabel: 'Session notes',
      sliderAriaLabel: 'Drag to adjust progress',
      cancelBtn: 'Cancel',
      saveBtn: 'Save',
      savingBtn: 'Saving...',
      savingFeedback: 'Saving...',
      savedFeedback: '✓ Saved',
      saveFailedPrefix: 'Save failed: ',
      conflictBanner: 'Save conflict: updated elsewhere. Your draft has been kept.',
      conflictShortToast: 'Save conflict, draft kept',
      conflictDetectedFeedback: 'Save failed: revision conflict detected',
      resolveConflictBtn: 'Load latest & keep draft',
      conflictRebasedFeedback: 'Synced to latest version. Click Save again to submit your draft.',
      conflictReloadedFeedback: 'Loaded latest version with draft preserved. Save again to submit.',
      timelineHeading: 'Timeline',
      timelineLink: 'Timeline ›',
      emptyTimeline: 'No activity yet',
      dividerAlt: 'Divider',
      loadingTitle: 'Loading session progress...',
      loadingAlt: 'Loading',
      loadingTasksAlt: 'Loading task list',
      loadingSubtitle: 'Syncing session tasks, will update automatically...',
      notLoadedTitle: 'Session progress not loaded yet',
      notLoadedAlt: 'Not loaded',
      retryLoadBtn: 'Retry',
      processing: 'Processing...',
      retryingStatus: 'Status check failed, retrying...',
      locatingMessage: 'Locating message...',
      locatingShort: 'Locating...',
      locatingSourceMessage: 'Locating source message...',
      locatedMessage: 'Source located',
      locatedJumpMessage: 'Jumped to source message',
      locateSent: 'Locate request sent',
      locateFailedPrefix: 'Locate failed: ',
      locateHostUnavailable: 'Unable to reach host locate API',
      locateNotFound: 'Source message not found',
      locateUnsupported: 'Jumping to source is not supported here',
      locateTimeout: 'Locate timed out. Please check conversation history.',
      locateNoSource: 'No locatable source message for this item',
      locateHostDisconnected: 'Host is disconnected, unable to locate source message',
      locateOpenFailed: 'Unable to open source session',
      locateUnavailable: 'Unable to locate source message right now',
      locateCommandErrorPrefix: 'Jump failed: ',
      startingAnalysisFeedback: 'Starting analysis...',
      updateFailedPrefix: 'Update failed: ',
      analysisNotDonePrefix: 'Analysis incomplete: ',
      analysisFailedPrefix: 'Analysis failed: ',
      analysisFailedWord: 'Analysis failed',
      analyzingWord: 'Analyzing',
      analysisFailedRetry: 'please retry',
      analysisAbnormal: 'execution error',
      analysisStages: {
        starting: 'Starting analysis...',
        reading: 'Reading session...',
        analyzing: 'Analyzing tasks...',
        retrying: 'Reconnecting...',
      },
      invalidProgressError: 'Enter an integer 0–100, or leave blank',
      unknownActionError: 'Unknown error',
      gitCheckUnavailable: 'Git status unavailable right now',
      sidebarHintText: 'To enable the sidebar pane, open Developer → Enable Main Process Debugger.',
      dismissHint: 'Dismiss',
      updateStages: {
        queued: 'Preparing upgrade',
        checking: 'Checking version',
        downloading: 'Downloading update',
        waiting: 'Waiting for analysis to finish',
        installing: 'Upgrading',
      },
      updateAvailablePattern: 'Update available v{version}',
      upgradedToPattern: 'Upgraded to v{version}',
      updateFailedLabel: 'Upgrade failed',
      upgradeBtn: 'Upgrade',
      upgradingShort: 'Upgrading...',
      checkUpdateBtn: 'Check updates',
      checkingUpdateShort: 'Checking...',
      alreadyLatestPattern: 'Up to date (v{version})',
      versionTagPattern: 'v{version}',
      checkUpdateFailedLabel: 'Update check failed',
      pleaseWait: 'Please wait',
      completedShort: 'Done',
      retryBtn: 'Retry',
      terminalUpgradePrefix: 'Terminal upgrade: ',
      reconnectHint: 'Reconnecting to background service; upgrade status will resume shortly',
      reconnectMcpHint: 'Please reconnect the MCP server in your client',
      cardCommandDescription: 'Open session task progress card',
      cardCommandReply: 'Agent Things · Session Progress',
      cardMissingSession: 'Card is missing current session info',
      cardAuthUnavailable: 'Card authorization unavailable; please reopen the card',
      cardSyncUnavailable: 'Card sync unavailable',
      cardTimeout: 'Card connection timed out',
      cardClosed: 'Card closed',
      cardOpFailed: 'Card action failed',
      cardRequestCancelled: 'Request cancelled',
      cardRequestTimeout: 'Request timed out, please retry',
      cardStatusDisconnected: 'Status connection unavailable',
      cardDaemonDisconnected: 'Local service disconnected',
      claudeInlineOffline: 'Local service connection failed',
      mdProgressHeading: 'Session task progress',
      mdStateDone: 'Completed (100%)',
      mdStateUnstarted: 'Not started',
      mdTasksOverview: 'Overview',
      mdTasksEmpty: 'No task checklist yet',
      mdNotesLabel: 'Session notes',
      mdQuickActionsLabel: 'Quick actions',
      mdQuickActionsText: 'Click "Adjust" on the card to set progress/notes manually, or click "Update progress" to auto-analyze.',
      hookPresentedMessage: 'Session task progress card presented',
      noSessionBadge: 'No session',
      offlineBadge: 'Offline',
      badgeNotOrganized: 'Not organized',
      badgeProgressUnrecordedSuffix: ' · Progress unrecorded',
      ringAriaPattern: '{title}: {summary}. Click to track progress',
      ringUpdating: 'Updating progress',
      sessionFallbackTitle: 'Session',
      statusUnrecorded: 'No progress recorded',
      panelAriaPattern: '{title} Task Progress',
      totalsEmpty: 'No task metrics yet',
      taskUnknown: 'Unknown status',
      timelineAnalysis: 'Auto analysis',
      timelineManual: 'Manual record',
      unrecordedShort: 'Unrecorded',
    },
  };

  function format(template, vars = {}) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
  }

  function forLang(targetLang) {
    const code = normalizeLang(targetLang);
    const dict = locales[code];
    return {
      lang: code,
      strings: dict,
      labels: dict.labels,
      taskLabels: dict.taskLabels,
      t(key, vars) {
        return format(dict[key] ?? locales.zh[key] ?? key, vars);
      },
      formatDate(value) {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      },
    };
  }

  function progressValue(value, dragging = false) {
    value = Math.max(0, Math.min(100, Math.round(value)));
    const nearest = Math.round(value / 25) * 25;
    return dragging && Math.abs(value - nearest) <= 2 ? nearest : value;
  }
  function progressState(state, value) {
    return value === 100 ? state === 'pushed' ? 'pushed' : 'completed'
      : value === 0 && state === 'unstarted' ? 'unstarted' : 'unfinished';
  }
  function draftTransition(current, event) {
    if (event.type === 'begin') return { draft: { state: event.record?.state || 'unfinished', progress: event.record?.progress ?? null, note: event.record?.note || '' }, baseRevision: event.revision ?? event.record?.revision ?? 0, conflict: false };
    if (event.type === 'patch') return { ...current, draft: { ...current.draft, ...event.patch } };
    if (event.type === 'conflict') return { ...current, conflict: true };
    if (event.type === 'rebase') return { ...current, baseRevision: event.revision, conflict: false };
    if (event.type === 'saved' || event.type === 'cleared') return { draft: null, baseRevision: event.revision, conflict: false };
    return current;
  }
  function analysisDisabled(busy, analyzing, upgradeStage) {
    return Boolean(busy || analyzing || ['waiting', 'installing'].includes(upgradeStage));
  }
  function updateBannerState(info, dict, options = {}) {
    const textDict = dict || {};
    const fmtText = (template, vars = {}) => String(template || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
    const update = info?.update;
    const stage = update?.stage;
    const stages = textDict.updateStages || {
      queued: 'Preparing upgrade',
      checking: 'Checking version',
      downloading: 'Downloading update',
      waiting: 'Waiting for analysis to finish',
      installing: 'Upgrading',
    };
    const activeStage = Boolean(stages[stage]) || Boolean(options.starting);
    const updatedAtMs = update?.updatedAt ? Date.parse(update.updatedAt) : NaN;
    const now = options.now ?? Date.now();
    const completed = stage === 'completed' && Number.isFinite(updatedAtMs) && now - updatedAtMs < 60000;
    const failed = stage === 'failed';
    const visible = Boolean(info?.available || activeStage || failed || completed);
    const command = info?.command || 'npx agent-things@latest';
    const label = activeStage
      ? (stages[stage] || stages.queued)
      : failed
        ? fmtText(textDict.updateFailedLabel || 'Upgrade failed')
        : completed
          ? fmtText(textDict.upgradedToPattern || 'Upgraded to v{version}', { version: update?.currentVersion || '' })
          : fmtText(textDict.updateAvailablePattern || 'Update available v{version}', { version: info?.latestVersion || '' });
    const buttonText = activeStage
      ? (textDict.pleaseWait || 'Please wait')
      : completed
        ? (textDict.completedShort || 'Done')
        : failed
          ? (textDict.retryBtn || 'Retry')
          : (textDict.upgradeBtn || 'Upgrade');
    const detail = options.connectionError
      ? `${textDict.reconnectHint || ''}\n${textDict.terminalUpgradePrefix || ''}${command}`
      : failed
        ? `${update?.error || ''}\n${textDict.terminalUpgradePrefix || ''}${command}`
        : (completed && update?.reconnectMcp ? (textDict.reconnectMcpHint || '') : '');
    const currentVersion = info?.currentVersion || '';
    const checkFailed = !visible && options.manualCheckStatus === 'failed';
    let versionText = currentVersion ? fmtText(textDict.versionTagPattern || 'v{version}', { version: currentVersion }) : '';
    if (checkFailed) {
      const errText = options.checkError || info?.checkError || '';
      versionText = errText ? `${textDict.checkUpdateFailedLabel || 'Update check failed'}: ${errText}` : (textDict.checkUpdateFailedLabel || 'Update check failed');
    } else if (!visible && options.manualCheckStatus === 'latest' && currentVersion) {
      versionText = fmtText(textDict.alreadyLatestPattern || 'Up to date (v{version})', { version: currentVersion });
    }
    const checking = Boolean(options.checking);
    return {
      visible,
      active: activeStage,
      completed,
      failed,
      buttonDisabled: activeStage || completed,
      label,
      buttonText,
      detail,
      currentVersion,
      versionText,
      showVersionBar: !visible,
      checking,
      checkDisabled: checking,
      checkFailed,
      checkButtonText: checking ? (textDict.checkingUpdateShort || 'Checking...') : (textDict.checkUpdateBtn || 'Check updates'),
    };
  }

  const active = forLang(currentLang);
  return {
    lang: active.lang,
    labels: active.labels,
    colors,
    taskLabels: active.taskLabels,
    strings: active.strings,
    locales,
    layout,
    accent,
    claudeCodeThemes,
    normalizeHexColor,
    resolveAccentPalette,
    t: active.t,
    format,
    forLang,
    formatDate: active.formatDate,
    progressValue,
    progressState,
    draftTransition,
    analysisDisabled,
    updateBannerState,
  };
})(globalThis.__agentThingsLang);
}
// </generated-presentation-fallback>
