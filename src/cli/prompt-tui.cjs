'use strict';
const { version } = require('../../package.json');
const readline = require('node:readline');
const { formatProbeText } = require('./environment-probe.cjs');

// ANSI escape codes
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_LINE = '\x1b[2K';
const CURSOR_UP = n => (n > 0 ? `\x1b[${n}A` : '');
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

function getProbeIcon(item) {
  if (!item.installed) return `${GRAY}✖${RESET}`;
  if (item.id === 'codex' && item.running && !item.portActive) return `${YELLOW}!${RESET}`;
  return `${GREEN}✔${RESET}`;
}

/**
 * Screen 1: Select Language with dynamic environment preview
 */
async function selectLanguageWithProbe(env, defaultLang = 'zh') {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) throw new Error('交互模式需要终端；自动安装请使用 setup --yes。');
  const wasRaw = stdin.isRaw;

  const languages = [
    { code: 'zh', label: '简体中文 (Chinese)' },
    { code: 'en', label: 'English' },
  ];
  let selectedIndex = defaultLang === 'en' ? 1 : 0;
  let lastLineCount = 0;

  function render() {
    const currentLang = languages[selectedIndex].code;
    const isZh = currentLang === 'zh';

    const lines = [];
    lines.push('');
    lines.push(`  ${CYAN}┌─────────────────────────────────────────────────────────────┐${RESET}`);
    lines.push(`  ${CYAN}│${RESET}  ${BOLD}Agent Things v${version} (Things 3 for AI Coding Agents)${RESET}        ${CYAN}│${RESET}`);
    lines.push(`  ${CYAN}└─────────────────────────────────────────────────────────────┘${RESET}`);
    lines.push('');
    lines.push(`  ${BOLD}${isZh ? '? 请选择语言 / Select Language:' : '? Select Language / 请选择语言:'}${RESET}`);

    for (let i = 0; i < languages.length; i++) {
      const opt = languages[i];
      const isSelected = i === selectedIndex;
      const marker = isSelected ? `${CYAN}❯${RESET}` : ' ';
      const bullet = isSelected ? `${CYAN}(●)${RESET}` : `${GRAY}( )${RESET}`;
      const text = isSelected ? `${BOLD}${opt.label}${RESET}` : `${opt.label}`;
      lines.push(`  ${marker} ${bullet} ${text}`);
    }

    lines.push('');
    lines.push(`  ${GRAY}─────────────────────────────────────────────────────────────${RESET}`);
    lines.push(`  ${DIM}${isZh ? '🔍 本机环境探测预览 (随语言联动):' : '🔍 Local Environment Preview (Synced with language):'}${RESET}`);

    const targets = [env.codex, env.antigravity, env.claude, env.agy].filter(Boolean);
    for (const item of targets) {
      const icon = getProbeIcon(item);
      const name = item.name.padEnd(18, ' ');
      const desc = formatProbeText(item, currentLang);
      lines.push(`   ${icon} ${name} ${GRAY}${desc}${RESET}`);
    }
    lines.push(`  ${GRAY}─────────────────────────────────────────────────────────────${RESET}`);
    lines.push(`  ${DIM}${isZh ? '  (使用 ↑/↓ 或 j/k 移动光标切换，按 <回车> 确认)' : '  (Use ↑/↓ or j/k to move cursor, press <Enter> to confirm)'}${RESET}`);

    // If already rendered before, move cursor up and clear
    if (lastLineCount > 0) {
      stdout.write(CURSOR_UP(lastLineCount) + '\r');
    }
    for (const l of lines) {
      stdout.write(CLEAR_LINE + l + '\n');
    }
    lastLineCount = lines.length;
  }

  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdout.write(HIDE_CURSOR);
  render();

  return new Promise((resolve, reject) => {
    function onKeyPress(str, key) {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup(); stdout.write(SHOW_CURSOR);
        reject(Object.assign(new Error('操作已取消。'), { code: 'CLI_CANCELLED' })); return;
      }
      if (key.name === 'escape') {
        cleanup(); stdout.write(SHOW_CURSOR); resolve(null); return;
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = (selectedIndex - 1 + languages.length) % languages.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        selectedIndex = (selectedIndex + 1) % languages.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        stdout.write(SHOW_CURSOR);
        resolve(languages[selectedIndex].code);
      }
    }

    function onEnd() { cleanup(); stdout.write(SHOW_CURSOR); reject(Object.assign(new Error('输入已结束，操作取消。'), { code: 'CLI_CANCELLED' })); }
    function cleanup() {
      stdin.removeListener('end', onEnd); stdin.removeListener('close', onEnd);
      stdin.removeListener('keypress', onKeyPress);
      if (!stdin.listenerCount('keypress')) stdin.pause();
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
    }

    stdin.once('end', onEnd); stdin.once('close', onEnd);
    stdin.on('keypress', onKeyPress);
    stdin.resume();
  });
}

/**
 * Screen 2: Select Apps with select-all and invert shortcuts
 */
async function selectApps(env, lang = 'zh', enabledApps = null) {
  const isZh = lang === 'zh';
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) throw new Error('交互模式需要终端；自动安装请使用 setup --yes。');
  const wasRaw = stdin.isRaw;

  const appOptions = [
    {
      id: 'codex',
      name: 'Codex (ChatGPT)',
      installed: env.codex?.installed ?? false,
      detail: formatProbeText(env.codex, lang),
      selected: Boolean(env.codex?.installed && (enabledApps === null || enabledApps.includes('codex'))),
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      installed: env.antigravity?.installed ?? false,
      detail: formatProbeText(env.antigravity, lang),
      selected: Boolean(env.antigravity?.installed && (enabledApps === null || enabledApps.includes('antigravity'))),
    },
    {
      id: 'claude', name: 'Claude Desktop · Code', installed: env.claude?.installed ?? false,
      detail: formatProbeText(env.claude, lang),
      selected: Boolean(env.claude?.installed && (enabledApps === null || enabledApps.includes('claude'))),
    },
  ];

  let focusIndex = 0;
  let lastLineCount = 0;

  function render() {
    const lines = [];
    lines.push('');
    const promptTitle = isZh
      ? '? 请勾选需要启用“进度清单”的目标应用:'
      : '? Select target applications to mount Progress Checklist:';
    lines.push(`  ${BOLD}${promptTitle}${RESET}`);

    for (let i = 0; i < appOptions.length; i++) {
      const app = appOptions[i];
      const isFocused = i === focusIndex;
      const marker = isFocused ? `${CYAN}❯${RESET}` : ' ';
      const check = app.selected ? `${GREEN}[✔]${RESET}` : `${GRAY}[ ]${RESET}`;
      const name = isFocused ? `${BOLD}${app.name}${RESET}` : app.name;
      const statusNote = app.installed ? `${GRAY}(${app.detail})${RESET}` : `${GRAY}(${app.detail} - ${isZh ? '未安装' : 'Not installed'})${RESET}`;
      lines.push(`  ${marker} ${check} ${name}  ${statusNote}`);
    }

    lines.push('');
    const tip = isZh
      ? '快捷键: <空格> 勾选/取消  |  <a> 全选/全不选  |  <回车> 确认安装'
      : 'Keys: <Space> Toggle  |  <a> Select all / Clear all  |  <Enter> Confirm';
    lines.push(`  ${DIM}${tip}${RESET}`);

    if (lastLineCount > 0) {
      stdout.write(CURSOR_UP(lastLineCount) + '\r');
    }
    for (const l of lines) {
      stdout.write(CLEAR_LINE + l + '\n');
    }
    lastLineCount = lines.length;
  }

  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdout.write(HIDE_CURSOR);
  render();

  return new Promise((resolve, reject) => {
    function onKeyPress(str, key) {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup(); stdout.write(SHOW_CURSOR);
        reject(Object.assign(new Error('操作已取消。'), { code: 'CLI_CANCELLED' })); return;
      }
      if (key.name === 'escape') {
        cleanup(); stdout.write(SHOW_CURSOR); resolve(null); return;
      }

      if (key.name === 'up' || key.name === 'k') {
        focusIndex = (focusIndex - 1 + appOptions.length) % appOptions.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        focusIndex = (focusIndex + 1) % appOptions.length;
        render();
      } else if (key.name === 'space') {
        const cur = appOptions[focusIndex];
        if (cur.installed) cur.selected = !cur.selected;
        render();
      } else if (str === 'a' || str === 'A') {
        const selectable = appOptions.filter(a => a.installed);
        const allSelected = selectable.every(a => a.selected);
        for (const app of appOptions) {
          if (app.installed) app.selected = !allSelected;
        }
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        stdout.write(SHOW_CURSOR);
        const chosen = appOptions.filter(a => a.selected).map(a => a.id);
        resolve(chosen);
      }
    }

    function onEnd() { cleanup(); stdout.write(SHOW_CURSOR); reject(Object.assign(new Error('输入已结束，操作取消。'), { code: 'CLI_CANCELLED' })); }
    function cleanup() {
      stdin.removeListener('end', onEnd); stdin.removeListener('close', onEnd);
      stdin.removeListener('keypress', onKeyPress);
      if (!stdin.listenerCount('keypress')) stdin.pause();
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
    }

    stdin.once('end', onEnd); stdin.once('close', onEnd);
    stdin.on('keypress', onKeyPress);
    stdin.resume();
  });
}

/**
 * Ask simple confirm question
 */
async function askConfirm(question, defaultYes = true, lang = 'zh') {
  const isZh = lang === 'zh';
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) throw new Error('交互模式需要终端；自动安装请使用 setup --yes。');
  const wasRaw = stdin.isRaw;

  let isYes = defaultYes;
  let lastLineCount = 0;

  function render() {
    const lines = [];
    const yesText = isYes ? `${BOLD}${CYAN}(●) ${isZh ? '是 (Yes)' : 'Yes'}${RESET}` : `${GRAY}( ) ${isZh ? '是 (Yes)' : 'Yes'}${RESET}`;
    const noText = !isYes ? `${BOLD}${CYAN}(●) ${isZh ? '否 (No)' : 'No'}${RESET}` : `${GRAY}( ) ${isZh ? '否 (No)' : 'No'}${RESET}`;
    lines.push('');
    lines.push(`  ${BOLD}${question}${RESET}`);
    lines.push(`    ${yesText}    ${noText}`);
    lines.push(`  ${DIM}${isZh ? '  (使用 ←/→ 切换，按 <回车> 确认)' : '  (Use ←/→ to switch, press <Enter> to confirm)'}${RESET}`);

    if (lastLineCount > 0) {
      stdout.write(CURSOR_UP(lastLineCount) + '\r');
    }
    for (const l of lines) {
      stdout.write(CLEAR_LINE + l + '\n');
    }
    lastLineCount = lines.length;
  }

  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdout.write(HIDE_CURSOR);
  render();

  return new Promise((resolve, reject) => {
    function onKeyPress(str, key) {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup(); stdout.write(SHOW_CURSOR);
        reject(Object.assign(new Error('操作已取消。'), { code: 'CLI_CANCELLED' })); return;
      }
      if (key.name === 'escape') {
        cleanup(); stdout.write(SHOW_CURSOR); resolve(null); return;
      }

      if (key.name === 'left' || key.name === 'right' || key.name === 'tab') {
        isYes = !isYes;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        stdout.write(SHOW_CURSOR);
        resolve(isYes);
      }
    }

    function onEnd() { cleanup(); stdout.write(SHOW_CURSOR); reject(Object.assign(new Error('输入已结束，操作取消。'), { code: 'CLI_CANCELLED' })); }
    function cleanup() {
      stdin.removeListener('end', onEnd); stdin.removeListener('close', onEnd);
      stdin.removeListener('keypress', onKeyPress);
      if (!stdin.listenerCount('keypress')) stdin.pause();
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
    }

    stdin.once('end', onEnd); stdin.once('close', onEnd);
    stdin.on('keypress', onKeyPress);
    stdin.resume();
  });
}

/**
 * Single-select menu for control hub
 */
async function selectMenu(title, options, lang = 'zh') {
  const isZh = lang === 'zh';
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY) throw new Error('交互模式需要终端；自动安装请使用 setup --yes。');
  const wasRaw = stdin.isRaw;

  let selectedIndex = 0;
  let lastLineCount = 0;

  function render() {
    const lines = [];
    lines.push('');
    lines.push(`  ${BOLD}${title}${RESET}`);

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = i === selectedIndex;
      const marker = isSelected ? `${CYAN}❯${RESET}` : ' ';
      const bullet = isSelected ? `${CYAN}●${RESET}` : `${GRAY}○${RESET}`;
      const text = isSelected ? `${BOLD}${opt.label}${RESET}` : opt.label;
      lines.push(`  ${marker} ${bullet} ${text}`);
    }

    lines.push('');
    const tip = isZh ? '  (使用 ↑/↓ 移动光标，按 <回车> 确认)' : '  (Use ↑/↓ to move cursor, press <Enter> to confirm)';
    lines.push(`  ${DIM}${tip}${RESET}`);

    if (lastLineCount > 0) {
      stdout.write(CURSOR_UP(lastLineCount) + '\r');
    }
    for (const l of lines) {
      stdout.write(CLEAR_LINE + l + '\n');
    }
    lastLineCount = lines.length;
  }

  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdout.write(HIDE_CURSOR);
  render();

  return new Promise((resolve, reject) => {
    function onKeyPress(str, key) {
      if (!key) return;

      if (key.ctrl && key.name === 'c') {
        cleanup(); stdout.write(SHOW_CURSOR);
        reject(Object.assign(new Error('操作已取消。'), { code: 'CLI_CANCELLED' })); return;
      }
      if (key.name === 'escape') {
        cleanup(); stdout.write(SHOW_CURSOR); resolve(null); return;
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        stdout.write(SHOW_CURSOR);
        resolve(options[selectedIndex].value);
      }
    }

    function onEnd() { cleanup(); stdout.write(SHOW_CURSOR); reject(Object.assign(new Error('输入已结束，操作取消。'), { code: 'CLI_CANCELLED' })); }
    function cleanup() {
      stdin.removeListener('end', onEnd); stdin.removeListener('close', onEnd);
      stdin.removeListener('keypress', onKeyPress);
      if (!stdin.listenerCount('keypress')) stdin.pause();
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
    }

    stdin.once('end', onEnd); stdin.once('close', onEnd);
    stdin.on('keypress', onKeyPress);
    stdin.resume();
  });
}

module.exports = {
  selectLanguageWithProbe,
  selectApps,
  askConfirm,
  selectMenu,
};
