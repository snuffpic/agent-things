'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { pathToFileURL } = require('node:url');

const {
  normalizeLang,
  detectSystemLang,
  readConfiguredLang,
  getUi,
  formatSessionMarkdownSummary,
} = require('../src/i18n.cjs');
const { parseArguments } = require('../src/cli/arguments.cjs');
const { syncSkillFiles } = require('../src/cli/setup-orchestrator.cjs');
const { getCardTools, resource: codexResource } = require('../src/harnesses/codex/codex-card.cjs');
const { renderAntigravityCardHtml } = require('../src/antigravity-card.cjs');
const { processHookInput } = require('../src/antigravity-hook.cjs');
const { mergeAnalysis } = require('../src/analysis-ledger.cjs');
const { AnalysisService } = require('../src/analysis-service.cjs');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { getAnalysisInstructions } = require('../src/analysis-budget.cjs');

test('detectSystemLang and readConfiguredLang normalize en/zh properly and honor config priority', t => {
  assert.equal(normalizeLang('en_US.UTF-8'), 'en');
  assert.equal(normalizeLang('zh-Hans-CN'), 'zh');
  assert.equal(normalizeLang('fr'), null);

  assert.equal(detectSystemLang({ LC_ALL: 'en_US.UTF-8' }, { readDefaults: false }), 'en');
  assert.equal(detectSystemLang({ LANG: 'zh_CN.UTF-8' }, { readDefaults: false }), 'zh');
  assert.equal(detectSystemLang({ LANG: 'ja_JP.UTF-8' }, { readDefaults: false }), 'en');
  assert.equal(detectSystemLang({ AGENT_THINGS_LANG: 'zh', LANG: 'en_US.UTF-8' }, { readDefaults: false }), 'zh');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-cfg-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const cfgPath = path.join(tmpDir, 'CodexSessionStatus', 'config.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({ lang: 'en', enabledApps: ['codex'] }));

  assert.equal(readConfiguredLang({ file: cfgPath, env: {} }), 'en');
  assert.equal(readConfiguredLang({ file: cfgPath, env: { AGENT_THINGS_LANG: 'zh' } }), 'zh');
});

test('parseArguments accepts --lang en/zh and interactive menu exposes lang switch action', async () => {
  assert.deepEqual(parseArguments(['setup', '--lang', 'en', '--yes']), {
    command: 'setup',
    port: 39222,
    watchStartup: false,
    yes: true,
    lang: 'en',
  });
  assert.throws(() => parseArguments(['setup', '--lang', 'jp']));

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = raw => { stdin.isRaw = raw; };
  let ansiOut = '';
  stdout.on('data', chunk => { ansiOut += chunk; });

  const mod = { exports: {} };
  const promptFile = path.join(__dirname, '../src/cli/prompt-tui.cjs');
  const promptReq = id => (id === '../../package.json' ? { version: '1.1.1' }
    : id === './environment-probe.cjs' ? { formatProbeText: () => 'Installed' }
      : id === '../i18n.cjs' ? require('../src/i18n.cjs') : require(id));
  vm.runInThisContext('(function(require,module,exports,process){' + fs.readFileSync(promptFile, 'utf8') + '\n})')(
    promptReq, mod, mod.exports, { stdin, stdout },
  );

  const pendingLang = mod.exports.selectLanguageWithProbe({
    codex: { id: 'codex', name: 'Codex', installed: true },
    antigravity: { id: 'antigravity', name: 'Antigravity', installed: true },
  }, 'zh');
  stdin.emit('keypress', '', { name: 'down' });
  stdin.emit('keypress', '', { name: 'return' });
  assert.equal(await pendingLang, 'en');
  assert.ok(ansiOut.includes('English'));

  // Test interactive-cli menu 'lang' switching action
  let savedConfig = { lang: 'zh', enabledApps: ['codex'] };
  const setupCalls = [];
  const pickedActions = ['lang', 'exit'];
  const recordedMenus = [];
  const mocks = {
    'node:fs': { existsSync: () => true, readFileSync: () => '' },
    './environment-probe.cjs': {
      probeEnvironment: async () => ({
        codex: { id: 'codex', name: 'Codex', installed: true },
        antigravity: { id: 'antigravity', name: 'Antigravity', installed: true },
        claude: { id: 'claude', name: 'Claude', installed: true },
      }),
      formatProbeText: () => 'ok',
    },
    './prompt-tui.cjs': {
      selectLanguageWithProbe: async () => 'en',
      selectApps: async () => ['codex'],
      askConfirm: async () => false,
      selectMenu: async (_title, items) => {
        recordedMenus.push(items);
        return pickedActions.shift();
      },
    },
    './setup-orchestrator.cjs': {
      DATA_DIR: '/tmp/fixture-data',
      readConfig: () => savedConfig,
      executeSetup: async options => {
        setupCalls.push(options);
        savedConfig = { lang: options.lang, enabledApps: options.enabledApps };
      },
      uninstallAll: async () => {},
    },
    '../launchd.cjs': { printJob: () => null },
    '../cdp.cjs': { CdpSession: class {}, listTargets: async () => [] },
    '../manual-status-agent.cjs': { attachmentStatus: async () => ({ mountedConversations: 0 }) },
    '../manual-status-startup.cjs': { startupStatus: () => ({}) },
    '../startup/watch.cjs': { portInUse: async () => false },
    '../startup/controller.cjs': { COOLDOWN_MS: 120000 },
    '../local-progress-http.cjs': { requestProgressHttp: async () => ({}) },
    '../harnesses/claude/claude-service.cjs': { DEFAULT_STATE_FILE: '/tmp/claude.json' },
    '../npm-updates.cjs': { getUpdateInfo: async () => ({ available: false }), startUpdate: async () => {}, verifyServices: async () => {} },
  };
  const cliMod = { exports: {} };
  vm.runInThisContext('(function(require,module,exports,process,console){' + fs.readFileSync(path.join(__dirname, '../src/cli/interactive-cli.cjs'), 'utf8') + '\n})')(
    id => Object.hasOwn(mocks, id) ? mocks[id] : id === '../i18n.cjs' ? require('../src/i18n.cjs') : require(id),
    cliMod,
    cliMod.exports,
    { stdin: { isTTY: true } },
    { log: () => {} },
  );
  await cliMod.exports.runInteractiveCli();
  assert.equal(setupCalls.length, 1);
  assert.equal(setupCalls[0].lang, 'en');
  assert.ok(recordedMenus[0].some(item => item.value === 'lang'));
  assert.ok(recordedMenus[1].some(item => item.value === 'lang' && /English/i.test(item.label)));
});

test('syncSkillFiles installs EN skill versions under lang="en" and restores ZH cleanly', t => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-skills-'));
  t.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));

  syncSkillFiles(['codex', 'antigravity', 'claude'], { homeDirectory: fakeHome, lang: 'en' });
  const codexEn = fs.readFileSync(path.join(fakeHome, '.codex/skills/things/SKILL.md'), 'utf8');
  const codexChecklistEn = fs.readFileSync(path.join(fakeHome, '.codex/skills/things/checklist.md'), 'utf8');
  const agyEn = fs.readFileSync(path.join(fakeHome, '.gemini/config/skills/things/SKILL.md'), 'utf8');
  const claudeEn = fs.readFileSync(path.join(fakeHome, '.claude/skills/agent-things/SKILL.md'), 'utf8');

  const stripAllowedChineseNote = text => text.replace(/"进度清单" in Chinese/g, '');
  assert.doesNotMatch(stripAllowedChineseNote(codexEn), /[\u4e00-\u9fff]/);
  assert.doesNotMatch(stripAllowedChineseNote(codexChecklistEn), /[\u4e00-\u9fff]/);
  assert.ok(codexChecklistEn.includes('# Agent Things Progress Checklist Guide'));
  assert.doesNotMatch(stripAllowedChineseNote(agyEn), /[\u4e00-\u9fff]/);
  assert.doesNotMatch(stripAllowedChineseNote(claudeEn), /[\u4e00-\u9fff]/);
  assert.ok(codexEn.includes('mcp__session_status__open_session_card'));
  assert.ok(agyEn.includes('render_things_card'));

  syncSkillFiles(['codex'], { homeDirectory: fakeHome, lang: 'zh' });
  const codexZh = fs.readFileSync(path.join(fakeHome, '.codex/skills/things/SKILL.md'), 'utf8');
  assert.match(codexZh, /[\u4e00-\u9fff]/);
  assert.equal(fs.existsSync(path.join(fakeHome, '.gemini/config/skills/things/SKILL.md')), false);
});

test('ui-foundation zh/en keys match and generated sidecar ui-i18n.mjs aligns cleanly', async () => {
  const zhUi = getUi('zh');
  const enUi = getUi('en');
  assert.deepEqual(Object.keys(enUi.strings).sort(), Object.keys(zhUi.strings).sort());
  assert.deepEqual(Object.keys(enUi.labels).sort(), Object.keys(zhUi.labels).sort());
  assert.deepEqual(Object.keys(enUi.taskLabels).sort(), Object.keys(zhUi.taskLabels).sort());

  const { getUiForLang } = await import(pathToFileURL(path.join(__dirname, '../src/plugins/things/sidecars/things_board/ui-i18n.mjs')).href);
  const sidecarEn = getUiForLang('en');
  assert.equal(sidecarEn.strings.btnUpdate, enUi.strings.btnUpdate);
  assert.equal(sidecarEn.strings.btnAdjust, enUi.strings.btnAdjust);
  assert.equal(sidecarEn.strings.btnClear, enUi.strings.btnClear);

  const mdEn = formatSessionMarkdownSummary({
    lang: 'en',
    progressData: { state: 'unfinished', progress: 50, totalTasks: 2, completedTasks: 1, note: 'Check API', summary: 'Half done' },
    embedTag: '<agent-embed src="file:///tmp/card.html" />',
  });
  assert.doesNotMatch(mdEn.userMarkdown, /[\u4e00-\u9fff]/);
  assert.ok(mdEn.userMarkdown.includes('Session task progress'));
  assert.ok(mdEn.userMarkdown.includes('1 of 2 tasks done'));
});

test('Codex, Antigravity card & hook, and Claude UI render unified English strings without CJK', async t => {
  // 1. Codex MCP tool descriptions & HTML resource
  const enTools = getCardTools('en');
  assert.equal(enTools.length, 3);
  for (const tool of enTools) {
    assert.doesNotMatch(tool.description, /[\u4e00-\u9fff]/);
  }
  const prevLang = process.env.AGENT_THINGS_LANG;
  process.env.AGENT_THINGS_LANG = 'en';
  try {
    const html = codexResource.read();
    assert.ok(html.includes('<html lang="en">'));
    assert.ok(html.includes('Loading session progress...'));
    assert.doesNotMatch(html, /加载会话任务进度/);

    // 2. Antigravity hook + card artifact
    const hookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hook-en-'));
    t.after(() => fs.rmSync(hookDir, { recursive: true, force: true }));
    const hookRes = processHookInput(JSON.stringify({
      lastUserInput: '/things',
      conversationId: 'en-conv-1',
      artifactDirectoryPath: hookDir,
    }));
    const md = hookRes.injectSteps[0].ephemeralMessage;
    assert.equal(typeof md, 'string');
    assert.ok(md.includes('things-card.html'));
    assert.doesNotMatch(md, /[\u4e00-\u9fff]/);
    const cardHtml = fs.readFileSync(path.join(hookDir, 'things-card.html'), 'utf8');
    assert.ok(cardHtml.includes('<html lang="en">'));
    assert.ok(cardHtml.includes('Update progress'));
    assert.ok(cardHtml.includes('Adjust'));
    const cardVisibleHtml = cardHtml
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.includes('isConflict =') && !line.includes("!== '当前会话'"))
      .join('\n');
    assert.doesNotMatch(cardVisibleHtml, /[\u4e00-\u9fff]/);

    // 3. Antigravity direct card render with tasks
    const populatedHtml = renderAntigravityCardHtml({
      title: 'English UI check',
      conversationId: 'en-conv-2',
      record: { state: 'unfinished', progress: 50, source: 'analysis', note: 'Follow up' },
      tasks: [{ title: 'Write i18n tests', status: 'todo' }],
      summary: 'Working on localization.',
      lang: 'en',
    });
    assert.ok(populatedHtml.includes('Auto-analyzed'));
    assert.ok(populatedHtml.includes('Remaining tasks (1)'));
  } finally {
    if (prevLang === undefined) delete process.env.AGENT_THINGS_LANG;
    else process.env.AGENT_THINGS_LANG = prevLang;
  }

  // 4. Claude mods/agent-things-ui English rendering
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ui-en-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
  const hooksDir = path.join(__dirname, '../mods/agent-things-ui/hooks');
  for (const name of fs.readdirSync(hooksDir)) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(hooksDir, name), path.join(tempDir, name));
  }
  const reg = await import(`${pathToFileURL(path.join(tempDir, 'register.js')).href}?v=${Math.random()}`);
  const handlers = new Map();
  const uiNodes = {
    Box: props => ({ type: 'Box', props, children: props.children || [] }),
    Text: props => ({ type: 'Text', props, children: props.children || [] }),
    Button: props => ({ type: 'Button', props, children: [props.label] }),
    Input: props => ({ type: 'Input', props, children: [] }),
    Svg: props => ({ type: 'Svg', props, children: [] }),
    Client: props => ({ type: 'Client', props, children: [] }),
  };
  const $ = {
    env: { get: async () => tempDir },
    fs: { read: async () => JSON.stringify({ port: 29889, token: 'test-token' }) },
    session: { id: async () => 'cli-en-1', cwd: async () => tempDir },
    store: { get: async () => undefined, set: async () => {} },
    command: { register: async () => {} },
    clock: { sleep: () => new Promise(() => {}), after: () => {}, every: () => {} },
    ui: { resolve: () => uiNodes, open: async () => {}, invalidate: () => {} },
    http: {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.action === 'watch') return new Promise(() => {});
        if (body.action === 'update-info') return { ok: true, status: 200, text: JSON.stringify({ updateInfo: { available: false } }) };
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            lang: 'en',
            revision: 1,
            title: 'English Claude session',
            record: { state: 'unfinished', progress: 40, note: 'Test EN' },
            analysis: { ledger: { summary: 'Halfway', tasks: [{ id: 't1', title: 'Task one', status: 'todo' }] } },
            timeline: [],
          }),
        };
      },
    },
  };
  reg.register((event, matcherOrFn, maybeFn) => {
    const fn = typeof matcherOrFn === 'function' ? matcherOrFn : maybeFn;
    if (!handlers.has(event)) handlers.set(event, []);
    handlers.get(event).push(fn);
  });
  for (const fn of handlers.get('session.start') || []) await fn($, {}, () => {});
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const tree = await handlers.get('ui.render')[1]($, {
    component: 'Pane',
    requestId: 'agent-things',
    props: { title: 'Agent Things', bodyColumns: 42 },
    viewport: { columns: 42, rows: 50 },
  }, () => null);
  const serialized = JSON.stringify(tree);
  assert.ok(serialized.includes('Update progress'));
  assert.ok(serialized.includes('Adjust'));
  assert.ok(serialized.includes('Clear'));
  assert.ok(serialized.includes('Remaining items'));
  assert.doesNotMatch(serialized, /[\u4e00-\u9fff]/);
});

test('English analysis prompt/schema/instructions and summary character limits behave as expected', async t => {
  const enPrompt = fs.readFileSync(path.join(__dirname, '../src/analysis-assets/prompt.en.txt'), 'utf8');
  const enSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/analysis-assets/output.en.schema.json'), 'utf8'));
  assert.doesNotMatch(enPrompt, /[\u4e00-\u9fff]/);
  assert.equal(enSchema.properties.summary.maxLength, 120);
  assert.equal(enSchema.properties.tasks.items.properties.summary.maxLength, 60);
  assert.doesNotMatch(getAnalysisInstructions('en'), /[\u4e00-\u9fff]/);

  const enTaskSummary50 = 'Verify English prompt and task extraction ledger.'; // 49 chars (>20, <=60)
  const merged = mergeAnalysis(null, {
    summary: 'Completed English localization verification successfully.',
    tasks: [{ knownTaskId: null, title: 'Verify i18n', summary: enTaskSummary50, status: 'done', evidenceRefs: ['e1'] }],
    removedTaskIds: [],
  }, ['e1'], { lang: 'en' });
  assert.equal(merged.completedTasks, 1);
  assert.ok(merged.basis.includes('Completed 1/1 tasks'));

  assert.throws(() => mergeAnalysis(null, {
    summary: 'Valid summary.',
    tasks: [{ knownTaskId: null, title: 'Too long', summary: 'x'.repeat(61), status: 'todo', evidenceRefs: ['e1'] }],
    removedTaskIds: [],
  }, ['e1'], { lang: 'en' }), /expected 1 to 60 chars/);

  assert.throws(() => mergeAnalysis(null, {
    summary: '总结',
    tasks: [{ knownTaskId: null, title: '太长', summary: '字'.repeat(21), status: 'todo', evidenceRefs: ['e1'] }],
    removedTaskIds: [],
  }, ['e1'], { lang: 'zh' }), /要求为1至20个字符/);

  // AnalysisService forwards English assets under lang='en'
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-en-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const store = new ManualStatusStore(path.join(tmpDir, 'state.json'));
  const key = JSON.stringify(['local', 'thread-en-1']);
  let seenRunArgs = null;
  const service = new AnalysisService({
    store,
    lang: 'en',
    makeServer: () => ({
      async initialize() { return {}; },
      async request(method) {
        if (method === 'thread/turns/list') {
          return {
            data: [{
              id: 'turn-1',
              status: 'completed',
              items: [
                { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Implement English mode' }] },
                { id: 'a1', type: 'agentMessage', text: 'Implemented English prompt and UI.' },
              ],
            }],
            nextCursor: null,
          };
        }
        return {};
      },
      async close() {},
    }),
    run: async args => {
      seenRunArgs = args;
      const validRef = args.input.events.at(-1).ref;
      return {
        summary: 'Implemented English UI and analysis prompt.',
        tasks: [{ knownTaskId: null, title: 'Implement English mode', summary: 'Implemented English prompt and UI cleanly.', status: 'done', evidenceRefs: [validRef] }],
        removedTaskIds: [],
      };
    },
  });
  await service.analyze(key);
  assert.ok(seenRunArgs);
  assert.equal(seenRunArgs.lang, 'en');
  assert.doesNotMatch(seenRunArgs.prompt, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(seenRunArgs.instructions, /[\u4e00-\u9fff]/);
  assert.equal(seenRunArgs.schema.properties.summary.maxLength, 120);
});

test('system language prefers the macOS UI language over the region-derived LANG', () => {
  const ui = lang => () => lang;
  assert.equal(detectSystemLang({ LANG: 'en_US.UTF-8' }, { appleLanguage: ui('zh'), appleLocale: ui('en') }), 'zh');
  assert.equal(detectSystemLang({ LANG: 'zh_CN.UTF-8' }, { appleLanguage: ui('en'), appleLocale: ui('zh') }), 'en');
  assert.equal(detectSystemLang({ LC_ALL: 'en_US.UTF-8' }, { appleLanguage: ui('zh') }), 'en');
  assert.equal(detectSystemLang({ AGENT_THINGS_LANG: 'en', LC_ALL: 'zh_CN.UTF-8' }, { appleLanguage: ui('zh') }), 'en');
  assert.equal(detectSystemLang({ LANG: 'zh_CN.UTF-8' }, { appleLanguage: ui(null), appleLocale: ui('en') }), 'zh');
  assert.equal(detectSystemLang({}, { appleLanguage: ui(null), appleLocale: ui('zh') }), 'zh');
});

test('English skills keep every rule of the Chinese skills and both prompts rewrite into their language', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  for (const file of ['skills/agent-things/SKILL.en.md', 'skills/things/checklist.en.md']) {
    const text = read(file);
    assert.match(text, /major milestone is reached, submit the confirmed task changes/, file);
    assert.match(text, /After clearing, keep the record empty/, file);
    assert.match(text, /On `REVISION_CONFLICT`, re-read the record and confirm the target/, file);
  }
  for (const file of ['skills/agent-things/SKILL.md', 'skills/things/checklist.md']) {
    const text = read(file);
    assert.match(text, /重大里程碑出现时/, file);
    assert.match(text, /清除流程完成后保持空记录/, file);
  }
  const zh = read('src/analysis-assets/prompt.zh-CN.txt');
  const en = read('src/analysis-assets/prompt.en.txt');
  const rules = text => text.split('\n').filter(line => /^\d+\. /.test(line)).length;
  assert.equal(rules(zh), rules(en));
  assert.match(zh, /previousLedger 中的任务标题、短总结或顶层 summary 不是中文时，保留其 knownTaskId/);
  assert.match(en, /If `previousLedger` contains non-English titles or summaries, rewrite/);
});

test('v1.3.1: session-status S() keys exist in zh/en dictionaries, resolveAccentPalette guards contrast, and Mod SVG uses Option A slider', async t => {
  const { createPresentation } = require('../src/ui-foundation.cjs');
  const pres = createPresentation('zh');

  // 1. Every static S('...') key in src/session-status.js exists in both zh & en locales
  const sessionStatusSource = fs.readFileSync(path.join(__dirname, '../src/session-status.js'), 'utf8');
  const usedKeys = [...new Set([...sessionStatusSource.matchAll(/\bS\('([^']+)'/g)].map(m => m[1]))];
  assert.ok(usedKeys.length > 50);
  for (const key of usedKeys) {
    assert.ok(Object.hasOwn(pres.locales.zh, key), `Missing zh i18n key in ui-foundation.cjs: ${key}`);
    assert.ok(Object.hasOwn(pres.locales.en, key), `Missing en i18n key in ui-foundation.cjs: ${key}`);
  }

  // 2. resolveAccentPalette contrast guard & 32 Claude Code Appearance themes
  assert.equal(Object.keys(pres.claudeCodeThemes).length, 32);
  for (const hex of ['#0169CC', '#2F75C3', '#C6613F']) {
    const palette = pres.resolveAccentPalette(hex);
    assert.equal(palette.normal, hex);
    assert.equal(palette.onAccent, '#FFFFFF');
  }
  for (const brightHex of ['#F6C543', '#FFFFFF']) {
    const palette = pres.resolveAccentPalette(brightHex);
    assert.equal(palette.normal, brightHex);
    assert.equal(palette.onAccent, '#0D0D0D');
  }

  // 3. mods/agent-things-ui/hooks/presentation.js Option A slider & dynamic primary() palette
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pres-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
  const hooksDir = path.join(__dirname, '../mods/agent-things-ui/hooks');
  for (const name of ['foundation.js', 'presentation.js']) {
    fs.copyFileSync(path.join(hooksDir, name), path.join(tempDir, name));
  }
  const presMod = await import(`${pathToFileURL(path.join(tempDir, 'presentation.js')).href}?v=${Math.random()}`);
  const sliderSvg = presMod.slider(50, '#c89b38', 240);
  assert.ok(sliderSvg.includes('height="6" rx="3"'));
  assert.ok(sliderSvg.includes('r="8" fill="#ffffff"'));
  assert.ok(!sliderSvg.includes('r="3.5"'));

  const customPalette = pres.resolveAccentPalette('#F6C543');
  const customBtnSvg = presMod.primary('更新进度', false, false, false, undefined, customPalette);
  assert.ok(customBtnSvg.includes('fill="#F6C543"'));
  assert.ok(customBtnSvg.includes('fill="#0D0D0D"'));

  const defaultBtnSvg = presMod.primary('更新进度', false, false, false);
  assert.ok(defaultBtnSvg.includes(`fill="${pres.accent.normal}"`));
  assert.ok(defaultBtnSvg.includes(`fill="${pres.accent.onAccent}"`));
});
