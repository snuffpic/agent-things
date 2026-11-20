#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'packages/dsh-agent-things');

function collectRelativeCjsDeps(entryFiles) {
  const visited = new Set();
  const queue = [...entryFiles.map(f => path.resolve(f))];
  const relRequireRe = /require\(\s*['"](\.[^'"]+\.cjs)['"]\s*\)/g;

  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file) || !fs.existsSync(file)) continue;
    visited.add(file);
    const code = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = relRequireRe.exec(code)) !== null) {
      const dep = path.resolve(path.dirname(file), match[1]);
      if (dep.startsWith(SRC + path.sep) && !visited.has(dep)) {
        queue.push(dep);
      }
    }
  }
  return [...visited].filter(file => file.startsWith(SRC + path.sep));
}

function copyDirRecursive(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, dstPath);
    else fs.copyFileSync(srcPath, dstPath);
  }
}

function buildClientBundle(packageName, version) {
  const foundationCode = fs.readFileSync(path.join(SRC, 'ui-foundation.cjs'), 'utf8');
  const rendererCode = fs.readFileSync(path.join(SRC, 'session-status.js'), 'utf8');
  const sidebarHtml = fs.readFileSync(path.join(SRC, 'plugins/things/sidecars/things_board/index.html'), 'utf8');
  const clientCode = fs.readFileSync(path.join(SRC, 'harnesses/deepseek/dsh-client.js'), 'utf8');

  const bundled = [
    `window.__ModuleLoader__.load({`,
    `  id: ${JSON.stringify(packageName)},`,
    `  factory: function(require) {`,
    `    var module = { exports: {} };`,
    `    var exports = module.exports;`,
    `    var __AGENT_THINGS_VERSION__ = ${JSON.stringify(version || '')};`,
    `    var __AGENT_THINGS_SIDEBAR_HTML__ = ${JSON.stringify(sidebarHtml)};`,
    `    (function () {`,
    `      var module = { exports: {} };`,
    foundationCode.trimEnd(),
    `      if (typeof globalThis !== 'undefined' && module.exports && typeof module.exports.createPresentation === 'function') {`,
    `        globalThis.__agentThingsCreatePresentation = module.exports.createPresentation;`,
    `        if (!globalThis.__agentThingsPresentation) {`,
    `          globalThis.__agentThingsPresentation = module.exports.createPresentation(globalThis.__agentThingsLang);`,
    `        }`,
    `      }`,
    `    })();`,
    rendererCode.trimEnd(),
    clientCode.trimEnd(),
    `    return module.exports;`,
    `  },`,
    `  meta: function() {`,
    `    return {};`,
    `  }`,
    `});`,
    ``,
  ].join('\n');

  new vm.Script(bundled, { filename: 'lib/client.js' });
  return bundled;
}

function buildBundle({ outDir = OUT } = {}) {
  const targetDir = path.resolve(outDir);
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packageName = 'agent-things-dsh';

  fs.rmSync(path.join(targetDir, 'lib'), { recursive: true, force: true });
  fs.rmSync(path.join(targetDir, 'src'), { recursive: true, force: true });
  fs.rmSync(path.join(targetDir, 'docs'), { recursive: true, force: true });
  fs.mkdirSync(path.join(targetDir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'locale'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, 'bin'), { recursive: true });

  // 1. package.json
  const repository = rootPkg.repository && typeof rootPkg.repository === 'object'
    ? { ...rootPkg.repository, directory: 'packages/dsh-agent-things' }
    : { type: 'git', url: 'git+https://github.com/snuffpic/agent-things.git', directory: 'packages/dsh-agent-things' };
  const bundlePkg = {
    name: packageName,
    version: rootPkg.version,
    description: 'Agent Things progress rings, source-linked AI to-dos, and /things cards for DeepSeek Harness',
    icon: './icon.svg',
    license: rootPkg.license || 'MIT',
    author: rootPkg.author || 'snuffpic',
    homepage: rootPkg.homepage || 'https://github.com/snuffpic/agent-things#readme',
    repository,
    keywords: [
      'dsh',
      'dsh-plugin',
      'dsh-bundle',
      'deepseek-harness',
      'cordis',
      'things',
      'task-manager',
      'session-status',
    ],
    type: 'module',
    engines: {
      dsh: '>=0.1.0',
    },
    main: 'lib/index.js',
    exports: {
      '.': {
        default: './lib/index.js',
      },
      './client': {
        default: './lib/client.js',
      },
      './src/*': './src/*',
      './package.json': './package.json',
      './cordis.patch.yml': './cordis.patch.yml',
      './locale/*.json': './locale/*.json',
    },
    files: [
      'package.json',
      'README.md',
      'icon.svg',
      'cordis.patch.yml',
      'locale/*.json',
      'docs',
      'bin/dsh-mcp.cjs',
      'src/**/*',
      'lib/**/*',
    ],
    dsh: {
      bundle: {
        patch: './cordis.patch.yml',
        listedByDefault: true,
      },
      client: {
        platform: 'web',
        inject: [
          '@deepseek-ai/dsh-api-session-controller',
          '@deepseek-ai/dsh-client-connection',
          '@deepseek-ai/dsh-client-locale',
          '@deepseek-ai/dsh-client-ui-renderer',
          '@deepseek-ai/dsh-client-ui-workspace',
          '@deepseek-ai/dsh-client-ui-conversation',
          '@deepseek-ai/dsh-client-ui-chat',
          '@deepseek-ai/dsh-client-ui-sidebar-right',
        ],
      },
    },
  };
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(bundlePkg, null, 2) + '\n', 'utf8');

  // 2. icon.svg
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="9" stroke="#4176E6" stroke-width="2.2" stroke-opacity="0.25"/>
  <circle cx="12" cy="12" r="9" stroke="#4176E6" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="56.55" stroke-dashoffset="12" transform="rotate(-90 12 12)"/>
  <path d="M8.5 12.2L10.9 14.6L15.8 9.7" stroke="#4176E6" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
  fs.writeFileSync(path.join(targetDir, 'icon.svg'), iconSvg, 'utf8');

  // 3. cordis.patch.yml
  const patchYml = `- insert:
    - id: agent-things
      name: ${packageName}
`;
  fs.writeFileSync(path.join(targetDir, 'cordis.patch.yml'), patchYml, 'utf8');

  // 4. locale files
  fs.writeFileSync(
    path.join(targetDir, 'locale/en.json'),
    JSON.stringify({
      meta: {
        title: 'Agent Things',
        description: 'Things-style session progress rings, notes, /things commands, and source-linked AI task extraction.',
        detail: 'docs/DETAIL.md',
      },
    }, null, 2) + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(targetDir, 'locale/zh.json'),
    JSON.stringify({
      meta: {
        title: 'Agent Things',
        description: '在会话侧栏与工作区提供 Things 风格进度圆环、备忘、/things 命令与带来源定位的 AI 待办提取。',
        detail: 'docs/DETAIL.zh.md',
      },
    }, null, 2) + '\n',
    'utf8',
  );

  // 4b. package README and localized plugin detail documentation
  const bundleReadme = [
    '# Agent Things for DeepSeek Harness (`agent-things-dsh`)',
    '',
    'Things-style session progress rings, workspace notes, `/things` commands, and source-linked AI task extraction for DeepSeek Harness.',
    '',
    '## Features',
    '',
    '- **Session progress rings & notes**: Track session progress (`25%`, `50%`, `75%`, `90%`, `100%` / `unfinished`, `waiting`, `completed`) directly in the conversation list and header.',
    '- **`/things` slash command & inline card**: Render interactive progress checklists inside conversations.',
    '- **Source-linked AI to-do extraction**: Extract structured tasks from replies and jump back to the exact source message.',
    '- **Task analysis model settings**: Choose the extraction model (default `DeepSeek-V4.1-Flash`, including custom OpenAI API models configured in DSH) and reasoning effort (`Off`, `Low`, `High`, `Max`).',
    '',
    '## Repository & Installation',
    '',
    'Maintained in [snuffpic/agent-things](https://github.com/snuffpic/agent-things) (`packages/dsh-agent-things`). Install or manage across ChatGPT, Antigravity, Claude Desktop, and DeepSeek Harness via `npx agent-things`.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(targetDir, 'README.md'), bundleReadme, 'utf8');

  const detailEn = [
    '## Overview',
    '',
    'Agent Things brings Things-style session progress management and structured to-do extraction to DeepSeek Harness without changing your active chat model.',
    '',
    '## Key Capabilities',
    '',
    '- **Session status & progress rings**: Set `unfinished`, `waiting`, or `completed` states and fine-grained percentage rings from the sidebar or conversation header.',
    '- **Right workspace & `/things` cards**: View all extracted to-dos, manually added tasks, and session notes; click any source-linked item to jump directly to the originating message.',
    '- **`/things` slash command & MCP sync**: Read or update task lists from prompts via `/things` or the bundled MCP tools, backed by `~/.codex/session-status/manual-state.json`.',
    '- **Independent analysis model & reasoning effort**: Configure the model used for background task extraction (defaults to `DeepSeek-V4.1-Flash` with `Low` reasoning effort, and supports custom API models added in DSH) from this plugin settings page.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(targetDir, 'docs/DETAIL.md'), detailEn, 'utf8');

  const detailZh = [
    '## 概述',
    '',
    'Agent Things 为 DeepSeek Harness 提供 Things 风格的会话进度管理、备忘录、`/things` 命令卡片与带来源定位的 AI 待办提取能力，且后台解析与当前对话模型完全解耦。',
    '',
    '## 核心功能',
    '',
    '- **会话状态与进度圆环**：在左侧会话列表和对话顶部状态栏快速标记「未完成」「等待反馈」「已完成」及 `25%` / `50%` / `75%` / `90%` / `100%` 精细进度，并记录会话备忘。',
    '- **右侧工作区与 `/things` 卡片**：集中查看 AI 提取的待办与手动任务；点击带来源角标的条目可直接跳回并高亮对应的历史回复消息。',
    '- **`/things` 斜杠命令与跨端同步**：支持通过 `/things` 命令和内置 MCP 工具更新任务，进度状态通过共享账本 `~/.codex/session-status/manual-state.json` 保持同步。',
    '- **独立任务解析模型与思考程度设置**：可在本插件设置页选择专门用于解析待办的可用模型（含通过 DSH 添加的自定义 API 模型）与思考程度（`Off` / `Low` / `High` / `Max`），默认优先使用 `DeepSeek-V4.1-Flash` 与 `Low`。',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(targetDir, 'docs/DETAIL.zh.md'), detailZh, 'utf8');

  // 5. Copy Host ESM plugin & MCP bin
  fs.copyFileSync(path.join(SRC, 'harnesses/deepseek/dsh-host.mjs'), path.join(targetDir, 'lib/index.js'));
  const mcpDst = path.join(targetDir, 'bin/dsh-mcp.cjs');
  fs.copyFileSync(path.join(ROOT, 'bin/dsh-mcp.cjs'), mcpDst);
  fs.chmodSync(mcpDst, 0o755);

  // 6. Collect and copy transitive CJS runtime files & analysis assets
  const runtimeEntries = [
    path.join(SRC, 'harnesses/deepseek/dsh-service.cjs'),
    path.join(SRC, 'harnesses/deepseek/dsh-runner.cjs'),
    path.join(SRC, 'harnesses/deepseek/dsh-source.cjs'),
    path.join(SRC, 'mcp-stdio.cjs'),
    path.join(SRC, 'progress-tools.cjs'),
    path.join(SRC, 'manual-status-store.cjs'),
    path.join(SRC, 'i18n.cjs'),
  ];
  const deps = collectRelativeCjsDeps(runtimeEntries);
  for (const absPath of deps) {
    const rel = path.relative(SRC, absPath);
    const dst = path.join(targetDir, 'src', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(absPath, dst);
  }
  copyDirRecursive(path.join(SRC, 'analysis-assets'), path.join(targetDir, 'src/analysis-assets'));

  // 6b. Replace macOS-only Swift bridge lock with portable cross-platform atomic PID lock
  const portableStateLock = `'use strict';
const fs = require('node:fs');
const path = require('node:path');

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function reclaimStaleLock(lockFile, statBefore, verifyStale) {
  const guardFile = lockFile + '.reclaim';
  let guardFd;
  try {
    guardFd = fs.openSync(guardFile, 'wx', 0o600);
  } catch {
    try {
      const guardStat = fs.statSync(guardFile);
      if (Date.now() - guardStat.mtimeMs > 10000) {
        const staleGuard = guardFile + '.stale.' + process.pid + '.' + Date.now();
        try { fs.renameSync(guardFile, staleGuard); fs.unlinkSync(staleGuard); } catch {}
      }
    } catch {}
    return false;
  }
  try {
    const currentStat = fs.statSync(lockFile);
    if (statBefore && (currentStat.ino !== statBefore.ino || currentStat.dev !== statBefore.dev)) {
      return false;
    }
    if (typeof verifyStale === 'function' && !verifyStale(currentStat)) {
      return false;
    }
    const staleFile = lockFile + '.stale.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 6);
    fs.renameSync(lockFile, staleFile);
    try { fs.unlinkSync(staleFile); } catch {}
    return true;
  } catch {
    return false;
  } finally {
    try { fs.closeSync(guardFd); } catch {}
    try { fs.unlinkSync(guardFile); } catch {}
  }
}

function tryAcquirePidLock(lockFile, depth = 0) {
  if (depth > 3) return false;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  try {
    const fd = fs.openSync(lockFile, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if (!err || err.code !== 'EEXIST') throw err;
    let statBefore = null;
    try {
      statBefore = fs.statSync(lockFile);
      const raw = fs.readFileSync(lockFile, 'utf8');
      const info = JSON.parse(raw);
      if (isPidAlive(info?.pid)) return false;
      const reclaimed = reclaimStaleLock(lockFile, statBefore, () => {
        try {
          const recheck = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          return !isPidAlive(recheck?.pid);
        } catch {
          return false;
        }
      });
      return reclaimed ? tryAcquirePidLock(lockFile, depth + 1) : false;
    } catch {
      try {
        const stat = statBefore || fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > 10000) {
          const reclaimed = reclaimStaleLock(lockFile, stat, curStat => Date.now() - curStat.mtimeMs > 10000);
          return reclaimed ? tryAcquirePidLock(lockFile, depth + 1) : false;
        }
      } catch {}
      return false;
    }
  }
}

function withStateFileLock(file, operation) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = \`\${file}.write-lock\`;
  const deadline = performance.now() + 3000;
  const delay = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    if (tryAcquirePidLock(lock)) break;
    if (performance.now() >= deadline) throw new Error('账本正由其他进程更新，请稍后重试');
    Atomics.wait(delay, 0, 0, 15);
  }
  try { return operation(); }
  finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

module.exports = { withStateFileLock, tryAcquirePidLock };
`;
  fs.writeFileSync(path.join(targetDir, 'src/state-file-lock.cjs'), portableStateLock, 'utf8');
  if (fs.existsSync(path.join(targetDir, 'src/native-bridge.cjs'))) {
    fs.unlinkSync(path.join(targetDir, 'src/native-bridge.cjs'));
  }

  // 7. Build wrapped client.js
  fs.writeFileSync(path.join(targetDir, 'lib/client.js'), buildClientBundle(packageName, rootPkg.version), 'utf8');

  return { outDir: targetDir, copiedFiles: deps.length };
}

if (require.main === module) {
  const result = buildBundle();
  console.log(`Built ${path.relative(ROOT, result.outDir)} (${result.copiedFiles} runtime modules)`);
}

module.exports = { buildBundle };
