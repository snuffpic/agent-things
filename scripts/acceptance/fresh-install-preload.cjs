'use strict';
// Test-only adapter: real installer/services, isolated launchd labels and fixture hosts.
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.AGENT_THINGS_ACCEPTANCE_HOME;
if (!root || process.env.HOME !== root) throw Error('Fresh-install isolation is not configured');
const prefix = process.env.AGENT_THINGS_ACCEPTANCE_LABEL;
const port = Number(process.env.AGENT_THINGS_ACCEPTANCE_CDP);
const labels = { 'com.codexsessionstatus.agent': `${prefix}.codex`, 'com.antigravity.session-status': `${prefix}.antigravity`, 'com.agentthings.claude': `${prefix}.claude`, 'com.codexsessionstatus.update': `${prefix}.update` };
// Keep the updater's npm-origin and integrity checks intact while supplying
// the release bytes from the isolated test registry.
if (process.env.AGENT_THINGS_ACCEPTANCE_REGISTRY) {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input.href);
    if (url.origin !== 'https://registry.npmjs.org') return fetchOriginal(input, options);
    const registry = process.env.AGENT_THINGS_ACCEPTANCE_REGISTRY;
    const response = await fetchOriginal(registry + (url.pathname.endsWith('/latest') ? '/agent-things/latest' : '/package.tgz'), options);
    if (!url.pathname.endsWith('/latest')) return response;
    const value = await response.json();
    if (value.dist) value.dist.tarball = 'https://registry.npmjs.org/agent-things/-/agent-things.tgz';
    return new Response(JSON.stringify(value), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  };
}
const loaded = new WeakSet();
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  const result = originalLoad.call(this, name, parent, isMain);
  if (!result || typeof result !== 'object' || loaded.has(result)) return result;
  const file = Module._resolveFilename(name, parent);
  if (file.endsWith('/src/launchd.cjs')) {
    loaded.add(result);
    const print = result.printJob, stop = result.bootout, write = result.writePlist, start = result.bootstrap;
    result.printJob = label => print(labels[label] || label);
    result.bootout = label => {
      if (!labels[label] && !label.startsWith(prefix + '.')) throw Error('Refusing non-test service: ' + label);
      return stop(labels[label] || label);
    };
    result.writePlist = (config, file) => {
      if (!file.startsWith(root + '/')) throw Error('Refusing non-test plist: ' + file);
      const args = config.ProgramArguments.filter(arg => arg !== '--watch-startup');
      if (config.Label === 'com.codexsessionstatus.agent') args.push('--port', String(port));
      write({ ...config, Label: labels[config.Label] || config.Label, ProgramArguments: args,
        EnvironmentVariables: { ...config.EnvironmentVariables, HOME: root, NODE_OPTIONS: `--require=${__filename}`,
          DEVELOPER_DIR: '/agent-things-no-developer-tools', SESSION_STATUS_PORT: process.env.SESSION_STATUS_PORT,
          AGENT_THINGS_ACCEPTANCE_HOME: root, AGENT_THINGS_ACCEPTANCE_LABEL: prefix, AGENT_THINGS_ACCEPTANCE_CDP: String(port),
          AGENT_THINGS_ACCEPTANCE_CLAUDE: process.env.AGENT_THINGS_ACCEPTANCE_CLAUDE || '',
          AGENT_THINGS_ACCEPTANCE_REGISTRY: process.env.AGENT_THINGS_ACCEPTANCE_REGISTRY || '' } }, file);
    };
    result.bootstrap = file => {
      if (!file.startsWith(root + '/')) throw Error('Refusing non-test bootstrap');
      const marker = path.join(root, 'bootstrap-failure-injected');
      if (process.env.AGENT_THINGS_ACCEPTANCE_FAIL === 'bootstrap' && file.includes('com.antigravity.') && !fs.existsSync(marker)) {
        fs.writeFileSync(marker, 'injected'); throw Error('ACCEPTANCE_AGY_BOOTSTRAP_FAILURE');
      }
      start(file);
    };
  } else if (file.endsWith('/src/cdp.cjs')) {
    loaded.add(result);
    const list = result.listTargets, Session = result.CdpSession;
    result.listTargets = (value, timeout) => list(!value || value === 39222 ? port : value, timeout);
    result.isMainWindow = target => target.type === 'page' && target.url.startsWith('file:') && target.url.includes('fresh-codex.html');
    result.CdpSession = class extends Session {
      constructor(target, value) { super(target, !value || value === 39222 ? port : value); }
    };
  } else if (file.endsWith('/src/harnesses/codex/codex-service.cjs')) {
    loaded.add(result);
    result.CodexService.prototype.projectGit = async () => ({ status: 'checked', hasRemote: false });
  } else if (file.endsWith('/src/cli/environment-probe.cjs')) {
    loaded.add(result);
    const probe = result.probeEnvironment;
    result.probeEnvironment = async () => {
      const value = await probe();
      value.claude.installed = process.env.AGENT_THINGS_ACCEPTANCE_CLAUDE === '1';
      return value;
    };
  } else if (file.endsWith('/src/harnesses/claude/claude-injector.cjs')) {
    loaded.add(result);
    result.ClaudeInjector.prototype.scan = async function () {
      if (!this.stateFile.startsWith(root + '/')) throw Error('Refusing real Claude attachment');
      this.status = { state: 'manual-debugger-required' };
      fs.writeFileSync(path.join(path.dirname(this.stateFile), 'attachment.json'), JSON.stringify({ ...this.status, checkedAt: new Date().toISOString() }));
      return this.status;
    };
  }
  return result;
};
