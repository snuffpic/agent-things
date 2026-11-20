'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const {
  BUNDLE_NAME,
  isCompatibleNode,
  probeDshRuntime,
  installDshPlugin,
  uninstallDshPlugin,
} = require('../src/harnesses/deepseek/dsh-installer.cjs');
const { formatProbeText } = require('../src/cli/environment-probe.cjs');
const { buildBundle } = require('../scripts/build-dsh-bundle.cjs');

test('dsh-installer checks Node semver compatibility and probes runtime/profiles', t => {
  assert.equal(isCompatibleNode('v24.9.0'), true);
  assert.equal(isCompatibleNode('v24.19.0'), true);
  assert.equal(isCompatibleNode('v25.0.0'), true);
  assert.equal(isCompatibleNode('v23.11.0'), false);
  assert.equal(isCompatibleNode('v24.8.9'), false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-probe-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const home = path.join(root, 'home');
  const fnmBin = path.join(home, '.local/share/fnm/node-versions/v24.19.0/installation/bin');
  fs.mkdirSync(fnmBin, { recursive: true });
  fs.writeFileSync(path.join(fnmBin, 'dsh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(fnmBin, 'node'), '#!/bin/sh\n');

  const webDir = path.join(home, '.dsh/profiles/web');
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { [BUNDLE_NAME]: 'link:/tmp/pkg' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLE_NAME] } },
  }));

  const runtime = probeDshRuntime({
    home,
    env: { HOME: home, PATH: '/usr/bin:/bin' },
    execFn: () => 'v24.19.0\n',
  });
  assert.equal(runtime.installed, true);
  assert.equal(runtime.binary, path.join(fnmBin, 'dsh'));
  assert.equal(runtime.nodeVersion, 'v24.19.0');
  assert.equal(runtime.nodeCompatible, true);
  assert.deepEqual(runtime.profiles, ['web']);
  assert.equal(runtime.pluginInstalled, true);
  assert.deepEqual(runtime.pluginProfiles, ['web']);
  assert.equal(runtime.bundleReady, false);
  assert.deepEqual(runtime.brokenPluginProfiles, ['web']);
  assert.equal(runtime.profileLinks[0].error, 'missing-target');

  // Create a valid target bundle at /tmp-equivalent inside root and point web profile link to it
  const validBundle = path.join(root, 'valid-bundle');
  fs.mkdirSync(path.join(validBundle, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(validBundle, 'package.json'), JSON.stringify({ name: BUNDLE_NAME, version: '1.3.4' }));
  fs.writeFileSync(path.join(validBundle, 'cordis.patch.yml'), '- insert: []\n');
  fs.writeFileSync(path.join(validBundle, 'lib/index.js'), 'export default {};');
  fs.writeFileSync(path.join(validBundle, 'lib/client.js'), 'export default {};');
  fs.writeFileSync(path.join(webDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { [BUNDLE_NAME]: `link:${validBundle}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', BUNDLE_NAME] } },
  }));
  const healthyRuntime = probeDshRuntime({
    home,
    env: { HOME: home, PATH: '/usr/bin:/bin' },
    execFn: () => 'v24.19.0\n',
  });
  assert.equal(healthyRuntime.bundleReady, true);
  assert.deepEqual(healthyRuntime.healthyPluginProfiles, ['web']);
  assert.deepEqual(healthyRuntime.brokenPluginProfiles, []);
  assert.equal(healthyRuntime.profileLinks[0].valid, true);
  assert.equal(healthyRuntime.profileLinks[0].version, '1.3.4');

  // Reject installation explicitly when paired Node is below 24.9
  assert.throws(
    () => installDshPlugin({ bundleDir: validBundle, home, env: { HOME: home, PATH: '/usr/bin:/bin' }, execFn: () => 'v22.14.0\n' }),
    /Node >= v24\.9\.0/,
  );

  assert.match(formatProbeText({ id: 'deepseek', installed: true, profiles: ['web'] }, 'zh'), /web/);
  assert.match(formatProbeText({ id: 'deepseek', installed: true, profiles: ['web'] }, 'en'), /Ready \(web\)/);
});

test('dsh-installer backs up profile package.json, installs, and cleanly uninstalls with manifest fallback', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-install-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const home = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  const bundleDir = path.join(root, 'bundle');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(bundleDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(binDir, 'dsh'), '');
  fs.writeFileSync(path.join(binDir, 'node'), '');
  fs.writeFileSync(path.join(bundleDir, 'package.json'), JSON.stringify({ name: BUNDLE_NAME }));
  fs.writeFileSync(path.join(bundleDir, 'cordis.patch.yml'), '- insert: []\n');
  fs.writeFileSync(path.join(bundleDir, 'lib/index.js'), 'export const inject = []; export function apply() {}');
  fs.writeFileSync(path.join(bundleDir, 'lib/client.js'), 'window.__ModuleLoader__.load({id:"x"})');

  const webPkg = path.join(home, '.dsh/profiles/web/package.json');
  const calls = [];
  const fakeExec = (file, args) => {
    calls.push([path.basename(file), ...args]);
    if (args[0] === '--version') return 'v24.19.0';
    if (args.includes('--dump-config')) {
      fs.mkdirSync(path.dirname(webPkg), { recursive: true });
      fs.writeFileSync(webPkg, JSON.stringify({
        name: 'dsh-profile-web',
        dependencies: {},
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
      }));
      return '';
    }
    if (args.includes('add')) {
      const cur = JSON.parse(fs.readFileSync(webPkg, 'utf8'));
      cur.dependencies[BUNDLE_NAME] = args.at(-1);
      cur.dsh.profile.bundles.push(BUNDLE_NAME);
      fs.writeFileSync(webPkg, JSON.stringify(cur, null, 2));
      return '';
    }
    if (args.includes('remove')) {
      throw new Error('simulated cli failure');
    }
    return '';
  };

  const res = installDshPlugin({ bundleDir, home, env: { HOME: home, PATH: binDir }, execFn: fakeExec });
  assert.deepEqual(res.profiles, ['web']);
  assert.ok(fs.existsSync(`${webPkg}.bak`), 'profile package.json backup must be created');
  assert.ok(calls.some(c => c[0] === 'dsh' && c.includes('--dump-config')));
  assert.ok(calls.some(c => c[0] === 'dsh' && c.includes('add')));

  // Simulate uninstall fallback when CLI remove fails
  const unRes = uninstallDshPlugin({ home, env: { HOME: home, PATH: binDir }, execFn: fakeExec });
  assert.deepEqual(unRes.removed, ['web']);
  const afterPkg = JSON.parse(fs.readFileSync(webPkg, 'utf8'));
  assert.equal(afterPkg.dependencies[BUNDLE_NAME], undefined);
  assert.equal(afterPkg.dsh.profile.bundles.includes(BUNDLE_NAME), false);
});

test('packaged DSH bundle activates Host plugin, portable lock, routes, /things command, and Client UI slots', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bundle-e2e-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { outDir } = buildBundle({ outDir: path.join(dir, 'bundle') });

  const builtPkg = JSON.parse(fs.readFileSync(path.join(outDir, 'package.json'), 'utf8'));
  assert.equal(builtPkg.author, 'snuffpic');
  assert.equal(builtPkg.homepage, 'https://github.com/snuffpic/agent-things#readme');
  assert.equal(builtPkg.repository?.directory, 'packages/dsh-agent-things');
  assert.ok(Array.isArray(builtPkg.keywords) && builtPkg.keywords.includes('dsh-plugin') && builtPkg.keywords.includes('deepseek-harness'));
  assert.ok(builtPkg.files.includes('README.md'));
  assert.equal(builtPkg.files.indexOf('docs'), builtPkg.files.indexOf('locale/*.json') + 1);
  const enMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'locale/en.json'), 'utf8'));
  const zhMeta = JSON.parse(fs.readFileSync(path.join(outDir, 'locale/zh.json'), 'utf8'));
  assert.equal(enMeta.meta?.title, 'Agent Things');
  assert.equal(enMeta.meta?.detail, 'docs/DETAIL.md');
  assert.equal(zhMeta.meta?.title, 'Agent Things');
  assert.equal(zhMeta.meta?.detail, 'docs/DETAIL.zh.md');
  assert.ok(fs.readFileSync(path.join(outDir, 'README.md'), 'utf8').includes('Agent Things'));
  assert.ok(fs.readFileSync(path.join(outDir, 'docs/DETAIL.md'), 'utf8').includes('/things'));
  assert.ok(fs.readFileSync(path.join(outDir, 'docs/DETAIL.zh.md'), 'utf8').includes('/things'));

  const stateFile = path.join(dir, 'manual-state.json');

  // 1. Test portable cross-platform lock + store inside built bundle
  const { ManualStatusStore } = require(path.join(outDir, 'src/manual-status-store.cjs'));
  const store = new ManualStatusStore(stateFile);
  const key = JSON.stringify(['local', 's-portable']);
  store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 25, note: 'bundle lock ok' } });
  assert.equal(store.getProgress('s-portable').progress, 25);

  // 2. Test built Host ESM plugin (packages/dsh-agent-things/lib/index.js)
  const hostMod = await import(pathToFileURL(path.join(outDir, 'lib/index.js')).href);
  assert.equal(hostMod.name, 'agent-things');
  assert.ok(Array.isArray(hostMod.inject));
  assert.equal(hostMod.default, undefined);

  const routes = new Map();
  const commands = new Map();
  const mcps = new Map();
  const disposers = [];
  const events = new Map();

  const mockHostCtx = {
    get: name => (name === 'sessions' ? mockHostCtx.sessions
      : name === 'sessionPersistence' ? mockHostCtx.sessionPersistence
        : name === 'llm' ? mockHostCtx.llm : undefined),
    sessions: { get: () => undefined },
    sessionPersistence: { open: async () => { throw Object.assign(new Error('not found'), { code: 'SESSION_PERSISTENCE_NOT_FOUND' }); } },
    llm: { listProviders: () => [], listModels: async () => [], prepareCall: async () => { throw new Error('unused'); } },
    connection: {
      fetch: {
        register: spec => {
          routes.set(spec.path, spec);
          return () => routes.delete(spec.path);
        },
      },
    },
    commands: {
      register: def => {
        commands.set(def.name, def);
        return () => commands.delete(def.name);
      },
    },
    mcpManager: {
      register: (srvName, cfg) => {
        mcps.set(srvName, cfg);
        return () => mcps.delete(srvName);
      },
    },
    on: (ev, fn) => {
      events.set(ev, fn);
      return () => events.delete(ev);
    },
    effect: fn => {
      const res = fn();
      if (typeof res === 'function') disposers.push(res);
    },
    inject: (deps, cb) => {
      if (deps.includes('mcpManager')) cb(mockHostCtx);
    },
  };

  await hostMod.apply(mockHostCtx, { stateFile });
  assert.ok(routes.has('/api/agent-things/summary'));
  assert.ok(routes.has('/api/agent-things/events'));
  assert.ok(routes.has('/api/agent-things/locate'));
  assert.ok(routes.has('/api/agent-things/rpc'));
  assert.ok(commands.has('things'));
  assert.ok(mcps.has('agent_things'));
  assert.ok(fs.existsSync(mcps.get('agent_things').args[0]));

  const cmdOut = await commands.get('things').handler({ agent: { id: 's-portable' }, rawInput: 'show' });
  assert.equal(cmdOut.kind, 'success');
  assert.match(cmdOut.text, /25%/);

  const sumRes = await routes.get('/api/agent-things/summary').fetch(new Request('http://localhost/api/agent-things/summary'));
  assert.equal(sumRes.status, 200);
  const sumJson = await sumRes.json();
  assert.equal(sumJson.items['s-portable'].progress, 25);
  assert.equal(sumJson.snapshot.records[key].progress, 25);

  // Verify RPC compatibility with native session-status.js protocol
  const rpcAnalysisRes = await routes.get('/api/agent-things/rpc').fetch(new Request('http://localhost/api/agent-things/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'analysis-state', requestId: 'req-1', key }),
  }));
  assert.equal(rpcAnalysisRes.status, 200);
  const rpcAnalysis = await rpcAnalysisRes.json();
  assert.equal(rpcAnalysis.requestId, 'req-1');
  assert.equal(rpcAnalysis.session.record.progress, 25);
  assert.equal(rpcAnalysis.sidebarSession.progress, 25);
  assert.ok(Array.isArray(rpcAnalysis.analysisState.timeline));

  const rpcConflictRes = await routes.get('/api/agent-things/rpc').fetch(new Request('http://localhost/api/agent-things/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'update', requestId: 'req-2', key, expectedRevision: 99, record: { state: 'completed', progress: 100, note: 'conflict' } }),
  }));
  assert.equal(rpcConflictRes.status, 200);
  const rpcConflict = await rpcConflictRes.json();
  assert.equal(rpcConflict.requestId, 'req-2');
  assert.equal(rpcConflict.errorInfo.code, 'REVISION_CONFLICT');

  for (const d of disposers) await d();
  assert.equal(routes.size, 0);

  // 3. Test built Client bundle (packages/dsh-agent-things/lib/client.js)
  const clientCode = fs.readFileSync(path.join(outDir, 'lib/client.js'), 'utf8');
  assert.equal(clientCode.includes('dsh-client.css'), false, 'old v1 CSS file reference must not remain in bundle');
  assert.equal(clientCode.includes('.at-dsh-panel'), false, 'old v1 rewritten .at-dsh-panel CSS/UI must not remain in bundle');

  let registeredModule = null;
  const mockFetch = async () => new Response(JSON.stringify({ version: 1, revision: 0, items: {}, snapshot: { version: 1, revision: 0, lang: 'zh', records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} } }), { status: 200 });
  const appendedStyles = [];
  const fakeStyleEl = {
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    remove() { appendedStyles.length = 0; },
  };
  const clientSandbox = {
    setTimeout,
    clearTimeout,
    AbortController,
    Response,
    TextDecoder,
    fetch: mockFetch,
    document: {
      head: {
        querySelector: () => appendedStyles[0] || null,
        appendChild: el => appendedStyles.push(el),
      },
      createElement: () => fakeStyleEl,
    },
    window: {
      __ModuleLoader__: {
        load: def => { registeredModule = def; },
      },
    },
  };
  vm.runInNewContext(clientCode, clientSandbox);
  assert.equal(registeredModule.id, BUNDLE_NAME);
  assert.deepEqual(Object.keys(registeredModule.meta()), []);

  const clientExports = registeredModule.factory(specifier => {
    if (specifier === 'react') {
      return {
        createElement: () => null,
        useState: init => [typeof init === 'function' ? init() : init, () => {}],
        useEffect: () => {},
        useRef: init => ({ current: init }),
        useCallback: fn => fn,
      };
    }
    throw new Error(`Unexpected client external dependency: ${specifier}`);
  });
  assert.ok(Array.isArray(clientExports.inject));
  assert.equal(typeof clientExports.apply, 'function');
  assert.equal(typeof clientSandbox.__agentThingsPresentation, 'object');
  assert.equal(typeof clientSandbox.__agentThingsCreatePresentation, 'function');

  const composedSidebar = clientExports.composeSidebarHtml({
    rawHtml: clientSandbox.window ? fs.readFileSync(path.join(__dirname, '../src/plugins/things/sidecars/things_board/index.html'), 'utf8') : '',
    bridgeId: 'b-1',
    sessionId: 's-portable',
    lang: 'zh',
    theme: {
      mode: 'dark',
      bg: '#151517',
      fg: '#e6edf3',
      mutedFg: '#a0a6ad',
      primary: '#4D6BFE',
      accent: { normal: '#4D6BFE', hover: '#627DFE', pressed: '#748CFE', onAccent: '#FFFFFF' },
    },
  });
  assert.equal(composedSidebar.includes('<script src="/preload.js"></script>'), false);
  assert.match(composedSidebar, /__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__/);
  assert.match(composedSidebar, /class="shell" id="agentThingsCard"/);
  assert.match(composedSidebar, /border:\s*none/);
  assert.match(composedSidebar, /--accent-hover/);
  assert.match(composedSidebar, /snapshotFetchSeq/);
  assert.match(composedSidebar, /pendingRemotePayload/);
  assert.match(composedSidebar, /allowEmpty/);

  const registeredSlots = [];
  const registeredTabs = [];
  const clientDisposers = [];
  const mockClientCtx = {
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    sidebarRight: { openTab: () => {} },
    sidebarRightTabs: { register: def => { registeredTabs.push(def); return () => {}; } },
    slots: {
      register: (meta, comp) => ({ meta, comp }),
      inject: (slotName, factoryFn) => {
        registeredSlots.push({ slotName, entry: factoryFn() });
        return () => {};
      },
    },
    uiWorkspace: { openSession: () => {} },
    sessions: { using: async () => {}, list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    on: () => () => {},
    effect: fn => {
      const res = fn();
      if (typeof res === 'function') clientDisposers.push(res);
    },
  };
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ version: 1, revision: 0, items: {}, snapshot: { version: 1, revision: 0, lang: 'zh', records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} } }), { status: 200 });
  try {
    clientExports.apply(mockClientCtx);
    assert.equal(registeredTabs.length, 1);
    assert.equal(registeredTabs[0].kind, 'things');
    assert.equal(registeredTabs[0].priority, 'extension');
    const slotNames = registeredSlots.map(s => s.slotName);
    for (const expected of [
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab.title',
      'sidebar.session.row.leading',
      'conversation.chat.commandview',
    ]) {
      assert.ok(slotNames.includes(expected), `missing slot registration: ${expected}`);
    }
    assert.equal(slotNames.includes('conversation.session.header.utilities'), false);
    assert.equal(slotNames.includes('sidebar.session.row.trailing'), false);
    const cmdView = registeredSlots.find(s => s.slotName === 'conversation.chat.commandview');
    assert.equal(cmdView.entry.meta.key, 'things');
    assert.equal(appendedStyles.length, 1);
    assert.equal(appendedStyles[0].attrs['data-plugin'], 'agent-things-dsh');
    assert.match(appendedStyles[0].textContent, /height:\s*38px/);
    assert.match(appendedStyles[0].textContent, /line-height:\s*26px/);
    assert.match(appendedStyles[0].textContent, /data-at-dsh-leading-slot/);
    assert.equal(appendedStyles[0].textContent.includes('.at-dsh-header-utility'), false);
    assert.equal(appendedStyles[0].textContent.includes('.at-dsh-panel'), false);
  } finally {
    for (const d of clientDisposers) d();
    assert.equal(appendedStyles.length, 0);
    globalThis.fetch = prevFetch;
  }

  // 4. Test real DOM harness isolation against Antigravity DevTools injector
  let foreignDestroyed = false;
  let dshLeadingStatusCount = 0;
  const createdHosts = [];
  const fakeSlot = {
    children: [],
    style: {
      map: new Map(),
      getPropertyValue(k) { return this.map.get(k) || ''; },
      getPropertyPriority() { return ''; },
      setProperty(k, v) { this.map.set(k, v); },
      removeProperty(k) { this.map.delete(k); },
    },
    querySelectorAll() { return []; },
    contains(node) { return createdHosts.includes(node); },
    append(node) { createdHosts.push(node); dshLeadingStatusCount += 1; },
    getAttribute(k) { return k === 'data-at-dsh-leading-slot' ? 's-portable' : null; },
  };
  const fakeRow = {
    isConnected: true,
    getAttribute(k) {
      if (k === 'data-row-key') return 'session:s-portable';
      if (k === 'aria-selected') return 'true';
      return null;
    },
    querySelector(sel) {
      if (sel === '[data-at-dsh-leading-slot]') return fakeSlot;
      if (sel === '[class*="title"]') return { textContent: '123哈哈' };
      return null;
    },
    querySelectorAll(sel) { return sel === '[data-at-dsh-leading-slot]' ? [fakeSlot] : []; },
    matches() { return false; },
    getBoundingClientRect: () => ({ width: 240, height: 38, left: 8, top: 296 }),
    addEventListener() {},
    removeEventListener() {},
  };
  const matchesSimpleSelector = (node, sel) => {
    if (!node || typeof sel !== 'string') return false;
    if (sel.startsWith('.')) return node.classList?.contains?.(sel.slice(1)) || false;
    const attrMatch = sel.match(/^([a-z0-9-]+)\[([a-z0-9-]+)="([^"]*)"\]$/i);
    if (attrMatch) {
      return String(node.tagName || '').toLowerCase() === attrMatch[1].toLowerCase()
        && node.getAttribute?.(attrMatch[2]) === attrMatch[3];
    }
    return String(node.tagName || '').toLowerCase() === sel.toLowerCase();
  };
  const findFirstDescendant = (nodes, sel) => {
    for (const node of nodes || []) {
      if (matchesSimpleSelector(node, sel)) return node;
      const found = findFirstDescendant(node._children, sel);
      if (found) return found;
    }
    return null;
  };
  const makeFakeEl = tag => {
    const classes = new Set();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      isConnected: true,
      attrs: {},
      style: {
        cssText: '',
        map: new Map(),
        setProperty(k, v) { this.map.set(k, v); },
        removeProperty(k) { this.map.delete(k); },
        getPropertyValue(k) { return this.map.get(k) || ''; },
        getPropertyPriority() { return ''; },
      },
      get className() { return Array.from(classes).join(' '); },
      set className(val) {
        classes.clear();
        for (const c of String(val || '').split(/\s+/).filter(Boolean)) classes.add(c);
      },
      classList: {
        contains: c => classes.has(c),
        add: (...cs) => { for (const c of cs) if (c) classes.add(c); },
        remove: (...cs) => { for (const c of cs) classes.delete(c); },
        toggle: (c, f) => (f === undefined ? !classes.has(c) : Boolean(f)) ? (classes.add(c), true) : (classes.delete(c), false),
      },
      setAttribute(k, v) {
        this.attrs[k] = String(v);
        if (k === 'class') this.className = v;
      },
      getAttribute(k) { return k === 'class' ? this.className : (this.attrs[k] ?? null); },
      toggleAttribute(k, f) { this.attrs[k] = f ? '' : undefined; },
      hasAttribute(k) { return this.attrs[k] !== undefined; },
      closest() { return null; },
      querySelector(sel) { return findFirstDescendant(this._children, sel); },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatchEvent(ev) {
        for (const fn of listeners.get(ev?.type) || []) fn(ev);
        return true;
      },
      getBoundingClientRect: () => ({ width: 24, height: 28, left: 20, top: 301 }),
      querySelectorAll() { return []; },
      replaceChildren(...nodes) { this._children = [...nodes]; },
      append(...nodes) { for (const n of nodes) el._children.push(n); },
      appendChild(node) { el._children.push(node); return node; },
      prepend(...nodes) { el._children.unshift(...nodes); },
      _children: [],
      get firstElementChild() { return el._children[0] || null; },
      shadowRoot: null,
      remove() { createdHosts.length = 0; },
      attachShadow() {
        const sr = {
          _children: [],
          append(...nodes) { for (const n of nodes) sr._children.push(n); },
          appendChild(node) { sr._children.push(node); return node; },
          prepend(...nodes) { sr._children.unshift(...nodes); },
          querySelector(sel) { return findFirstDescendant(sr._children, sel); },
          querySelectorAll() { return []; },
        };
        el.shadowRoot = sr;
        return sr;
      },
    };
    return el;
  };
  class FakeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const isoStyles = [];
  const isoSandbox = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    AbortController,
    Response,
    TextDecoder,
    MutationObserver: FakeObserver,
    ResizeObserver: FakeObserver,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({
      backgroundColor: '#151517',
      color: '#e6edf3',
      getPropertyValue: k => (k === '--dsw-alias-state-business-primary' ? '#7AAAFF' : ''),
    }),
    fetch: async () => new Response(JSON.stringify({ version: 1, revision: 0, items: {}, snapshot: { version: 1, revision: 0, lang: 'zh', records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} } }), { status: 200 }),
    document: {
      head: {
        querySelector: () => isoStyles[0] || null,
        appendChild: el => {
          el.remove = () => { isoStyles.length = 0; };
          isoStyles.push(el);
        },
      },
      body: makeFakeEl('body'),
      documentElement: makeFakeEl('html'),
      createElement: tag => makeFakeEl(tag),
      createElementNS: (_ns, tag) => makeFakeEl(tag),
      querySelectorAll: sel => {
        if (sel === '[data-row-key^="session:"]') return [fakeRow];
        return [];
      },
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      __ModuleLoader__: { load: def => { registeredModule = def; } },
      __codexSessionStatus: { destroy() { foreignDestroyed = true; }, status: () => ({ version: 'foreign' }) },
      __sessionStatusHarness: { globalName: '__antigravitySessionStatus' },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  isoSandbox.window.window = isoSandbox.window;
  isoSandbox.window.document = isoSandbox.document;
  isoSandbox.globalThis = isoSandbox;
  isoSandbox.CSS = { escape: s => String(s) };
  vm.runInNewContext(clientCode, isoSandbox);
  const pendingIsoEffects = [];
  const isoExports = registeredModule.factory(specifier => {
    if (specifier === 'react') {
      return {
        createElement: (tag, props) => {
          const el = typeof tag === 'string' ? makeFakeEl(tag) : null;
          if (el && props?.ref && typeof props.ref === 'object') props.ref.current = el;
          return el;
        },
        useState: init => [typeof init === 'function' ? init() : init, () => {}],
        useEffect: fn => { pendingIsoEffects.push(fn); },
        useRef: init => ({ current: init }),
        useCallback: fn => fn,
      };
    }
    throw new Error(`Unexpected client external dependency: ${specifier}`);
  });
  const isoDisposers = [];
  const isoSlots = [];
  const sidebarOpenCalls = [];
  const isoCtx = {
    ...mockClientCtx,
    sidebarRight: { openTab: opts => sidebarOpenCalls.push(opts) },
    slots: {
      register: (meta, comp) => ({ meta, comp }),
      inject: (slotName, factoryFn) => {
        isoSlots.push({ slotName, entry: factoryFn() });
        return () => {};
      },
    },
    effect: fn => {
      const res = fn();
      if (typeof res === 'function') isoDisposers.push(res);
    },
  };
  try {
    isoExports.apply(isoCtx);
    assert.equal(foreignDestroyed, true, 'must replace foreign injector if it ran first');
    assert.equal(dshLeadingStatusCount, 1, 'must mount official status ring inside leading slot');
    assert.equal(isoSandbox.window.__codexSessionStatus.exportForReload()?.busy, true);
    assert.ok(isoSandbox.window.__dshSessionStatus);
    assert.equal(typeof isoSandbox.window.__dshSessionStatus.receive, 'function');
    assert.equal(isoSandbox.window.__agentThingsHostAccent, '#0169CC');
    assert.equal(isoSandbox.document.documentElement.style.getPropertyValue('--agent-things-accent'), '#0169CC');
    assert.equal(isoExports.readHostTheme(null, 'zh').primary, '#0169CC');
    assert.equal(isoStyles.length, 1);

    // Multi-instance style refcounting guard: disposing a second style holder preserves active styles
    const releaseExtraStyle = isoExports.injectHostLayoutStyles();
    assert.equal(isoStyles.length, 1);
    releaseExtraStyle();
    assert.equal(isoStyles.length, 1, 'style must stay alive while another instance holds reference');

    // Render inline /things command card and verify Antigravity .open-pane button & accent parity
    const cmdSlot = isoSlots.find(s => s.slotName === 'conversation.chat.commandview');
    assert.ok(cmdSlot);
    pendingIsoEffects.length = 0;
    const cmdHost = cmdSlot.entry.comp({ sessionId: 's-portable' });
    assert.ok(cmdHost);
    for (const eff of pendingIsoEffects.splice(0)) {
      const cleanup = eff();
      if (typeof cleanup === 'function') isoDisposers.push(cleanup);
    }
    assert.equal(cmdHost.firstElementChild.style.getPropertyValue('--accent'), '#0169CC');
    const cardShadow = cmdHost.firstElementChild?.shadowRoot;
    assert.ok(cardShadow, 'inline /things card should mount official Shadow DOM root');
    const cardShell = cardShadow.querySelector('.shell');
    assert.ok(cardShell, 'inline /things card should render .shell');
    assert.equal(cardShell.classList.contains('has-open-pane'), true);
    assert.ok(cardShadow.querySelector('style[data-at-dsh-open-pane="1"]'));
    const openPaneBtn = cardShell.querySelector('.open-pane');
    assert.ok(openPaneBtn, 'inline /things card should include Antigravity .open-pane button');
    assert.equal(openPaneBtn.getAttribute('aria-label'), '在侧栏打开');
    assert.equal(openPaneBtn.querySelector('.open-pane-tip')?.textContent, '在侧栏打开');
    openPaneBtn.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {} });
    assert.equal(sidebarOpenCalls.length, 1);
    assert.equal(sidebarOpenCalls[0], 'things');
  } finally {
    for (const d of isoDisposers) d();
    assert.equal(isoStyles.length, 0, 'style must be removed after all holders release');
  }
});

test('P1 client, sidebar HTML, atomic PID lock reclaim, multi-profile installer, and degraded host resilience', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p1-int-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { outDir } = buildBundle({ outDir: path.join(root, 'bundle') });

  // 1. Sidebar HTML has #btnToggleAllRemaining, dsh-lang-sync, and ev.source guard
  const sidebarHtml = fs.readFileSync(
    path.join(__dirname, '../src/plugins/things/sidecars/things_board/index.html'),
    'utf8',
  );
  assert.match(sidebarHtml, /id="btnToggleAllRemaining"/);
  assert.match(sidebarHtml, /dsh-lang-sync/);
  assert.match(sidebarHtml, /ev\.source !== window\.parent/);

  // 2. Built client bundle: LeadingRingAnchor [sessionId] dep stability, stopBubble onPointerDown, non-enumerable bridges, unique bridgeId, ev.source guard
  const clientCode = fs.readFileSync(path.join(outDir, 'lib/client.js'), 'utf8');
  let registered = null;
  const effectCalls = [];
  const winListeners = new Map();
  const makeEl = tag => {
    const props = {};
    const children = [];
    return {
      tagName: String(tag || '').toUpperCase(),
      style: { setProperty() {}, removeProperty() {} },
      classList: { contains: () => false, add() {}, remove() {}, toggle: () => false },
      dataset: {},
      setAttribute(k, v) { props[k] = String(v); },
      getAttribute(k) { return props[k] ?? null; },
      toggleAttribute() {},
      hasAttribute: k => props[k] !== undefined,
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      replaceChildren: (...n) => { children.splice(0, children.length, ...n); },
      append: (...n) => children.push(...n),
      appendChild: n => (children.push(n), n),
      prepend: (...n) => children.unshift(...n),
      get firstElementChild() { return children[0] || null; },
      remove() {},
      attachShadow() {
        return {
          _children: [],
          append() {},
          appendChild: n => n,
          prepend() {},
          querySelector: () => null,
          querySelectorAll: () => [],
        };
      },
      _props: props,
    };
  };
  const winObj = {
    __ModuleLoader__: { load: def => { registered = def; } },
    addEventListener: (type, fn) => {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => winListeners.get(type)?.delete(fn),
  };
  winObj.window = winObj;

  const sandbox = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    AbortController,
    Response,
    TextDecoder,
    crypto: globalThis.crypto,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ backgroundColor: '#ffffff', color: '#111111', getPropertyValue: () => '' }),
    fetch: async () => new Response(JSON.stringify({ version: 1, revision: 0, items: {}, snapshot: { version: 1, revision: 0, lang: 'zh', records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} } }), { status: 200 }),
    document: {
      head: { querySelector: () => null, appendChild() {} },
      body: makeEl('body'),
      documentElement: makeEl('html'),
      createElement: tag => makeEl(tag),
      createElementNS: (_ns, tag) => makeEl(tag),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    window: winObj,
    CSS: { escape: s => String(s) },
  };
  winObj.document = sandbox.document;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(clientCode, sandbox);

  let shouldThrowFetch = false;
  sandbox.fetch = async () => {
    if (shouldThrowFetch) throw new Error('network down');
    return new Response(JSON.stringify({ version: 1, revision: 0, items: {}, snapshot: { version: 1, revision: 0, lang: 'zh', records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} } }), { status: 200 });
  };

  const hooks = {
    createElement: (tag, props) => {
      if (typeof tag === 'string') {
        const el = makeEl(tag);
        el._reactProps = props || {};
        if (props?.ref && typeof props.ref === 'object') props.ref.current = el;
        return el;
      }
      return tag(props || {});
    },
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: (fn, deps) => { effectCalls.push({ fn, deps }); },
    useRef: init => ({ current: init }),
    useCallback: fn => fn,
  };
  const mod = registered.factory(spec => {
    if (spec === 'react') return hooks;
    throw new Error(`Unexpected external dep: ${spec}`);
  });

  const slots = [];
  const disposers = [];
  const ctx = {
    locale: {
      register: () => () => {},
      getLocale: () => ({ active: 'zh-CN' }),
      subscribe: () => () => {},
    },
    connection: {
      fetch: async (u, o) => sandbox.fetch(u, o),
      sse: { subscribe: () => () => {} },
    },
    sessions: {
      using: async () => {},
      list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} },
    },
    uiWorkspace: { openSession: () => {} },
    sidebarRight: { openTab() {} },
    sidebarRightTabs: { register: () => () => {} },
    slots: { register: (meta, comp) => ({ meta, comp }), inject: (name, fn) => (slots.push({ name, entry: fn() }), () => {}) },
    on: () => () => {},
    effect: fn => {
      const res = fn();
      if (typeof res === 'function') disposers.push(res);
    },
  };
  t.after(() => { for (const d of disposers) d(); });
  mod.apply(ctx);

  const leadingSlot = slots.find(s => s.name === 'sidebar.session.row.leading');
  assert.ok(leadingSlot);
  effectCalls.length = 0;
  const ringEl = leadingSlot.entry.comp({ sessionId: 's-p1' });
  assert.equal(effectCalls.length, 1);
  assert.deepEqual(Array.from(effectCalls[0].deps), ['s-p1']);
  let stopped = false;
  ringEl._reactProps.onPointerDown?.({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true, 'onPointerDown must stopPropagation');

  const sidebarSlot = slots.find(s => s.name === 'sidebar.right.pane.tab');
  assert.ok(sidebarSlot);
  effectCalls.length = 0;
  sidebarSlot.entry.comp({});
  const mount1Cleanups = [];
  for (const eff of effectCalls.splice(0)) {
    const clean = eff.fn();
    if (typeof clean === 'function') mount1Cleanups.push(clean);
  }
  sidebarSlot.entry.comp({});
  const mount2Cleanups = [];
  for (const eff of effectCalls.splice(0)) {
    const clean = eff.fn();
    if (typeof clean === 'function') mount2Cleanups.push(clean);
  }
  assert.equal(Object.keys(winObj).includes('__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__'), false);
  const bridgeDesc = Object.getOwnPropertyDescriptor(winObj, '__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__');
  assert.equal(bridgeDesc.enumerable, false);
  const bridgeIds = Object.keys(winObj.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__);
  assert.equal(bridgeIds.length, 2);
  assert.notEqual(bridgeIds[0], bridgeIds[1]);

  shouldThrowFetch = true;
  const errActionRes = await winObj.__AGENT_THINGS_DSH_SIDEBAR_BRIDGES__[bridgeIds[0]].performAction('s-p1', 'analyze');
  assert.equal(errActionRes.status, 500);
  assert.match(errActionRes.body.error, /network down/);
  shouldThrowFetch = false;

  const composed = mod.composeSidebarHtml({
    rawHtml: sidebarHtml,
    bridgeId: bridgeIds[0],
    sessionId: 's-p1',
    lang: 'zh',
    theme: mod.readHostTheme(null, 'zh'),
  });
  assert.match(composed, /ev\.source !== window\.parent/);

  for (const c of [...mount1Cleanups, ...mount2Cleanups]) c();

  // 3. Atomic PID lock reclaim for dead PID and expired unparseable lock
  const { tryAcquirePidLock } = require(path.join(outDir, 'src/state-file-lock.cjs'));
  const lockFile = path.join(root, 'lock-dir/state.json.write-lock');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, at: Date.now() }));
  assert.equal(tryAcquirePidLock(lockFile), true, 'dead PID lock must be atomically reclaimed');
  assert.equal(fs.existsSync(`${lockFile}.reclaim`), false);
  fs.unlinkSync(lockFile);

  fs.writeFileSync(lockFile, '{corrupt');
  const past = new Date(Date.now() - 20000);
  fs.utimesSync(lockFile, past, past);
  assert.equal(tryAcquirePidLock(lockFile), true, 'expired corrupt lock must be atomically reclaimed');
  assert.equal(fs.existsSync(`${lockFile}.reclaim`), false);
  fs.unlinkSync(lockFile);

  // 4. Multi-profile default install targets all detected profiles and checks link target
  const home = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'dsh'), '');
  fs.writeFileSync(path.join(binDir, 'node'), '');
  for (const p of ['web', 'desktop']) {
    const pDir = path.join(home, '.dsh/profiles', p);
    fs.mkdirSync(pDir, { recursive: true });
    fs.writeFileSync(path.join(pDir, 'package.json'), JSON.stringify({
      name: `dsh-profile-${p}`,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }));
  }
  const multiExec = (_file, args) => {
    if (args[0] === '--version') return 'v24.19.0';
    if (args.includes('add')) {
      const pIdx = args.indexOf('--profile');
      const p = args[pIdx + 1];
      const pkgPath = path.join(home, '.dsh/profiles', p, 'package.json');
      const cur = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      cur.dependencies[BUNDLE_NAME] = args.at(-1);
      cur.dsh.profile.bundles.push(BUNDLE_NAME);
      fs.writeFileSync(pkgPath, JSON.stringify(cur, null, 2));
    }
    return '';
  };
  const multiRes = installDshPlugin({ bundleDir: outDir, home, env: { HOME: home, PATH: binDir }, execFn: multiExec });
  assert.deepEqual(multiRes.profiles.sort(), ['desktop', 'web']);

  // 5. Degraded host startup preserves corrupted state file & exposes actionable HTTP 500 + /things error
  const badStateFile = path.join(root, 'corrupt-manual-state.json');
  fs.writeFileSync(badStateFile, '{"corrupted": ', 'utf8');
  const hostMod = await import(pathToFileURL(path.join(outDir, 'lib/index.js')).href);
  const badRoutes = new Map();
  const badCommands = new Map();
  const loggedErrors = [];
  await hostMod.apply({
    get: name => (name === 'logger' ? { error: msg => loggedErrors.push(msg) } : undefined),
    connection: { fetch: { register: spec => (badRoutes.set(spec.path, spec), () => {}) } },
    commands: { register: def => (badCommands.set(def.name, def), () => {}) },
    inject: () => {},
    effect: fn => fn(),
    on: () => {},
  }, { stateFile: badStateFile, lang: 'zh', enableMcp: false });

  assert.equal(fs.readFileSync(badStateFile, 'utf8'), '{"corrupted": ');
  assert.equal(loggedErrors.length, 1);
  const degradedRes = await badRoutes.get('/api/agent-things/summary').fetch(new Request('http://localhost/api/agent-things/summary'));
  assert.equal(degradedRes.status, 500);
  const degradedJson = await degradedRes.json();
  assert.equal(degradedJson.errorInfo.code, 'STATE_FILE_ERROR');
  const degradedCmd = await badCommands.get('things').handler({ agent: { id: 's1' }, rawInput: '' });
  assert.equal(degradedCmd.kind, 'error');
});

test('Plugin manager configuration slot (plugins.bundle.config) uses DSH primitives and syncs analysis-config API', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-cfg-ui-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { outDir } = buildBundle({ outDir: path.join(root, 'bundle') });

  const clientCode = fs.readFileSync(path.join(outDir, 'lib/client.js'), 'utf8');
  let registered = null;
  const makeEl = tag => ({
    tagName: String(tag || '').toUpperCase(),
    style: { setProperty() {}, removeProperty() {} },
    classList: { contains: () => false, add() {}, remove() {}, toggle: () => false },
    dataset: {},
    setAttribute() {},
    getAttribute: () => null,
    toggleAttribute() {},
    hasAttribute: () => false,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    replaceChildren() {},
    append() {},
    appendChild: n => n,
    prepend() {},
    remove() {},
    attachShadow: () => ({ append() {}, appendChild: n => n, prepend() {}, querySelector: () => null, querySelectorAll: () => [] }),
  });

  const fetchedRequests = [];
  let currentSavedConfig = { mode: 'default', provider: null, model: null, reasoningEffort: null };
  let savedAvailable = true;
  const makeConfigPayload = () => ({
    version: 1,
    lang: 'zh',
    config: currentSavedConfig,
    catalog: {
      groups: [
        {
          id: 'deepseek-account',
          name: 'DeepSeek 账号',
          models: [{
            id: 'deepseek-flash',
            name: 'DeepSeek-V4.1-Flash',
            reasoning: {
              efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
              defaultEffort: 'high',
            },
          }],
        },
        {
          id: 'custom-api',
          name: 'Custom OpenAI',
          models: [{ id: 'gpt-5-mini', name: 'GPT-5 Mini', reasoning: null }],
        },
      ],
      failures: [],
      defaultRoute: {
        provider: 'deepseek-account',
        providerName: 'DeepSeek 账号',
        model: 'deepseek-flash',
        modelName: 'DeepSeek-V4.1-Flash',
        reasoningEffort: 'low',
        isFlash: true,
        supportsReasoning: true,
        reasoning: {
          efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
          defaultEffort: 'high',
        },
      },
    },
    availability: {
      savedAvailable,
      savedModelInfo: null,
      fallbackRoute: savedAvailable ? null : { provider: 'deepseek-account', providerName: 'DeepSeek 账号', model: 'deepseek-flash', modelName: 'DeepSeek-V4.1-Flash', reasoningEffort: 'low', isFlash: true },
    },
  });

  let roCallback = null;
  let observedEl = null;

  const sandbox = {
    setTimeout,
    clearTimeout,
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    AbortController,
    Response,
    TextDecoder,
    crypto: globalThis.crypto,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class {
      constructor(cb) { roCallback = cb; }
      observe(el) { observedEl = el; }
      unobserve() {}
      disconnect() {}
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ backgroundColor: '#ffffff', color: '#111111', getPropertyValue: () => '' }),
    fetch: async (url, init) => {
      fetchedRequests.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
      if (String(url).includes('api/agent-things/analysis-config')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(init.body);
          currentSavedConfig = {
            mode: body.mode === 'custom' ? 'custom' : 'default',
            provider: body.mode === 'custom' ? body.provider : null,
            model: body.mode === 'custom' ? body.model : null,
            reasoningEffort: body.reasoningEffort || null,
          };
          savedAvailable = true;
        }
        return new Response(JSON.stringify(makeConfigPayload()), { status: 200 });
      }
      return new Response(JSON.stringify({ version: 1, revision: 0, items: {}, snapshot: { version: 1, revision: 0, lang: 'zh', records: {}, analyzingKeys: [], keyVersionBase: 0, keyVersions: {} } }), { status: 200 });
    },
    document: {
      head: { querySelector: () => null, appendChild() {} },
      body: makeEl('body'),
      documentElement: makeEl('html'),
      createElement: tag => makeEl(tag),
      createElementNS: (_ns, tag) => makeEl(tag),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      __ModuleLoader__: { load: def => { registered = def; } },
      addEventListener() {},
      removeEventListener() {},
    },
    CSS: { escape: s => String(s) },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = sandbox.document;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(clientCode, sandbox);

  let stateIdx = 0;
  let refIdx = 0;
  const states = [];
  const refs = [];
  const effects = [];
  const makeVNode = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(c => c != null && c !== false && c !== true) });
  const ButtonStub = function ButtonStub() {};
  const TagStub = function TagStub() {};
  const SegmentedControlStub = function SegmentedControlStub() {};
  const MenuSurfaceStub = function MenuSurfaceStub() {};
  const MenuGroupStub = function MenuGroupStub() {};
  const InputStub = function InputStub() {};
  const IconRefreshStub = function IconRefreshStub() {};
  const reactStub = {
    createElement: makeVNode,
    useState: init => {
      const idx = stateIdx++;
      if (!(idx in states)) states[idx] = typeof init === 'function' ? init() : init;
      return [states[idx], v => { states[idx] = typeof v === 'function' ? v(states[idx]) : v; }];
    },
    useMemo: fn => fn(),
    useLayoutEffect: fn => effects.push(fn),
    useEffect: fn => effects.push(fn),
    useRef: init => {
      const idx = refIdx++;
      if (!(idx in refs)) refs[idx] = { current: init };
      return refs[idx];
    },
    useCallback: fn => fn,
    useId: () => 'uid-1',
  };
  const primitivesStub = {
    Button: ButtonStub,
    Tag: TagStub,
    SegmentedControl: SegmentedControlStub,
    MenuSurface: MenuSurfaceStub,
    MenuGroup: MenuGroupStub,
    Input: InputStub,
    IconRefreshOutlineRegular: IconRefreshStub,
    rankByName: (items, q) => items.filter(i => String(i.name || '').toLowerCase().includes(String(q).toLowerCase())),
    observeStickyMenuGroups: () => () => {},
  };

  const clientMod = registered.factory(spec => {
    if (spec === 'react') return reactStub;
    if (spec === 'react-dom') return { createPortal: (node, container) => ({ portal: true, node, container }) };
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitivesStub;
    throw new Error(`Unexpected dep: ${spec}`);
  });

  const injectedSlots = [];
  const disposers = [];
  const declaredClientCtxProps = new Set([...(clientMod.inject || []), 'on', 'effect', 'get']);
  const rawClientCtx = {
    locale: { register: () => () => {}, getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} },
    connection: { fetch: (u, o) => sandbox.fetch(u, o), sse: { subscribe: () => () => {} } },
    sessions: { using: async () => {}, list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    uiWorkspace: { openSession: () => {} },
    sidebarRight: { openTab() {} },
    sidebarRightTabs: { register: () => () => {} },
    slots: { register: (meta, comp) => ({ meta, comp }), inject: (name, fn) => (injectedSlots.push({ name, entry: fn() }), () => {}) },
    on: () => () => {},
    effect: fn => { const d = fn(); if (typeof d === 'function') disposers.push(d); },
    get: name => (Object.prototype.hasOwnProperty.call(rawClientCtx, name) ? rawClientCtx[name] : undefined),
  };
  const strictClientCtx = new Proxy(rawClientCtx, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !declaredClientCtxProps.has(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  clientMod.apply(strictClientCtx);
  t.after(() => { for (const d of disposers) d(); });

  const cfgSlot = injectedSlots.find(s => s.name === 'plugins.bundle.config');
  assert.ok(cfgSlot, 'plugins.bundle.config slot must be registered');
  assert.equal(cfgSlot.entry.meta.key, 'agent-things-dsh');

  // summary view returns localized one-liner
  stateIdx = 0;
  refIdx = 0;
  const summaryText = cfgSlot.entry.comp({ view: 'summary' });
  assert.equal(typeof summaryText, 'string');
  assert.ok(summaryText.includes('模型'));

  // initial page render loads catalog + defaults SegmentedControl to 'low'
  stateIdx = 0;
  refIdx = 0;
  effects.length = 0;
  const initialTree = cfgSlot.entry.comp({ view: 'page' });
  const headElStub = { getBoundingClientRect: () => ({ width: 680 }), clientWidth: 680 };
  refs[0].current = headElStub;
  effects.forEach(fn => fn());
  await new Promise(resolve => setTimeout(resolve, 25));

  stateIdx = 0;
  refIdx = 0;
  effects.length = 0;
  const loadedTree = cfgSlot.entry.comp({ view: 'page' });
  const findNodes = (node, pred, out = []) => {
    if (!node || typeof node !== 'object') return out;
    if (node.portal && node.node) {
      findNodes(node.node, pred, out);
      return out;
    }
    if (pred(node)) out.push(node);
    for (const ch of node.children || []) findNodes(ch, pred, out);
    return out;
  };
  const getRefreshButton = tree => findNodes(tree, n => n.type === ButtonStub && String(n.props.className || '').includes('at-dsh-plugin-refresh-btn'))[0];
  assert.equal(observedEl, headElStub);
  assert.deepEqual(getRefreshButton(loadedTree).children, ['刷新模型']);

  // Narrow width -> '刷新' (2 chars); extra-narrow width -> icon-only
  assert.equal(typeof roCallback, 'function');
  roCallback([{ contentRect: { width: 460 } }]);
  stateIdx = 0;
  refIdx = 0;
  const shortTree = cfgSlot.entry.comp({ view: 'page' });
  assert.deepEqual(getRefreshButton(shortTree).children, ['刷新']);

  roCallback([{ contentRect: { width: 320 } }]);
  stateIdx = 0;
  refIdx = 0;
  const iconTree = cfgSlot.entry.comp({ view: 'page' });
  const iconRefreshBtn = getRefreshButton(iconTree);
  assert.deepEqual(iconRefreshBtn.children, []);
  assert.ok(iconRefreshBtn.props.icon);
  assert.equal(iconRefreshBtn.props['aria-label'], '刷新模型');

  // Restore wide width before continuing interactions
  roCallback([{ contentRect: { width: 680 } }]);
  stateIdx = 0;
  refIdx = 0;
  cfgSlot.entry.comp({ view: 'page' });

  const seg = findNodes(loadedTree, n => n.type === SegmentedControlStub)[0];
  assert.ok(seg, 'SegmentedControl from dsh-client-ui-primitives should render');
  assert.equal(seg.props.value, 'low');
  assert.deepEqual(Array.from(seg.props.options, o => o.value), ['off', 'low', 'high', 'max']);

  // Open model dropdown and verify DSH MenuSurface + MenuGroup render both DeepSeek & custom OpenAI API models
  const triggerBtn = findNodes(loadedTree, n => n.type === 'button' && n.props.className === 'at-dsh-model-trigger')[0];
  assert.ok(triggerBtn);
  triggerBtn.props.onClick();
  stateIdx = 0;
  refIdx = 0;
  const openTree = cfgSlot.entry.comp({ view: 'page' });
  const menuSurf = findNodes(openTree, n => n.type === MenuSurfaceStub)[0];
  assert.ok(menuSurf, 'MenuSurface from dsh-client-ui-primitives should render in portal');
  const menuGroups = findNodes(openTree, n => n.type === MenuGroupStub);
  assert.ok(menuGroups.some(g => g.props.label === 'Custom OpenAI'), 'Custom API provider group must appear');

  // Switch effort to 'high' and trigger Save -> posts to api/agent-things/analysis-config
  seg.props.onChange('high');
  stateIdx = 0;
  refIdx = 0;
  const dirtyTree = cfgSlot.entry.comp({ view: 'page' });
  const saveBtn = findNodes(dirtyTree, n => n.type === ButtonStub && n.props.variant === 'primary')[0];
  assert.equal(saveBtn.props.disabled, false);
  await saveBtn.props.onClick();
  const postCall = fetchedRequests.find(r => r.method === 'POST' && r.url.includes('analysis-config'));
  assert.ok(postCall);
  assert.equal(postCall.body.reasoningEffort, 'high');

  // Verify host route table also registers /api/agent-things/analysis-config
  const hostMod = await import(pathToFileURL(path.join(outDir, 'lib/index.js')).href);
  const hostRoutes = new Set();
  const hostDisposers = [];
  t.after(async () => {
    for (const d of hostDisposers) await d?.();
  });
  await hostMod.apply({
    get: () => undefined,
    connection: { fetch: { register: spec => (hostRoutes.add(spec.path), () => {}) } },
    commands: { register: () => () => {} },
    inject: () => {},
    effect: fn => {
      const d = fn();
      if (typeof d === 'function') hostDisposers.push(d);
    },
    on: () => {},
  }, { stateFile: path.join(root, 'host-state.json'), enableMcp: false });
  assert.ok(hostRoutes.has('/api/agent-things/analysis-config'));
});
