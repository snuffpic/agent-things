'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { CdpSession, listTargets } = require('../src/cdp.cjs');
const root = path.resolve(__dirname, '..');
const python = process.env.PYTHON || execFileSync('/usr/bin/xcrun', ['--find', 'python3'], { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (predicate, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(100); }
  throw Error('Fresh install acceptance timed out');
};
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const appPids = () => execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).split('\n')
  .filter(line => /\/Applications\/(?:ChatGPT|Antigravity|Claude)\.app\/Contents\/MacOS\/(?:ChatGPT|Antigravity|Claude)$/.test(line)).map(line => line.trim().split(/\s+/)[0]).sort();
const job = label => { try { return execFileSync('/bin/launchctl', ['print', `gui/${process.getuid()}/${label}`], { encoding: 'utf8', stdio: 'pipe' }); } catch { return ''; } };
async function stopJob(label) {
  if (!job(label)) return;
  execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'pipe' });
  await wait(() => !job(label), 5000);
}
async function terminal(home, env, scenario, output) {
  const child = spawn(python, [path.join(root, 'scripts/acceptance/fresh-install-terminal.py'), scenario, output], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw Error(stderr || stdout);
  return JSON.parse(stdout.trim());
}
async function mcp(config, env, conversationId, project, toolCount = 5) {
  const child = spawn(config.command, config.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', stderr = '', serial = 0;
  const replies = new Map();
  child.stderr.on('data', chunk => stderr += chunk);
  child.stdout.on('data', chunk => {
    buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) { try { const reply = JSON.parse(line); replies.set(reply.id, reply); } catch {} }
  });
  const call = async (method, params = {}) => {
    const id = ++serial; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    await wait(() => replies.has(id), 10000).catch(error => { throw Error(error.message + ': ' + stderr); });
    const reply = replies.get(id); assert.ok(!reply.error, JSON.stringify(reply)); assert.ok(!reply.result.isError, JSON.stringify(reply)); return reply.result;
  };
  try {
    await call('initialize', { protocolVersion: '2024-11-05' });
    assert.equal((await call('tools/list')).tools.length, toolCount);
    const args = { conversation_id: conversationId, project_path: project };
    await call('tools/call', { name: 'update_session_progress', arguments: { ...args, state: 'unfinished', progress: 47, note: 'fresh-install acceptance' } });
    const result = await call('tools/call', { name: 'get_session_progress', arguments: args });
    assert.equal(JSON.parse(result.content[0].text).progress, 47);
  } finally {
    const exit = new Promise(resolve => child.once('exit', resolve)); child.stdin.end();
    await Promise.race([exit, delay(4000)]); if (child.exitCode === null) { child.kill('SIGTERM'); throw Error('MCP did not exit after stdin closed'); }
  }
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-install-'));
  const output = path.join(root, 'outputs', 'fresh-install-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(output, { recursive: true });
  const protectedFiles = ['Library/Application Support/CodexSessionStatus/manual-state.json', '.gemini/antigravity/session-status/manual-state.json',
    'Library/Application Support/CodexSessionStatus/config.json', '.codex/config.toml', '.gemini/antigravity/mcp_config.json',
    '.claude.json', 'Library/Application Support/Claude/developer_settings.json', 'Library/Application Support/AgentThings/claude/manual-state.json'].map(file => path.join(os.homedir(), file));
  const protectedHashes = protectedFiles.map(hash), beforePids = appPids();
  const cases = [], labels = [], sessions = [], targets = [];
  let chrome, registry;
  try {
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }));
    const bytes = fs.readFileSync(path.join(temporary, pack.filename));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    const fixture = path.join(temporary, 'fresh-codex.html'); fs.copyFileSync(path.join(root, 'test/fixtures/session-status.html'), fixture);
    let registryOrigin, registryFailure = false;
    registry = http.createServer((req, res) => {
      if (registryFailure) { res.statusCode = 503; res.end('{"error":"ACCEPTANCE_REGISTRY_UNAVAILABLE"}'); return; }
      if (req.url === '/package.tgz') { res.end(bytes); return; }
      if (req.url.startsWith('/c/')) { res.setHeader('Content-Type', 'text/html'); res.end('<style>body{background:#202226;color:#ddd;font:14px sans-serif}.agy-sidebar-row{display:flex;width:280px;padding:16px}</style><nav><div class="agy-sidebar-row" data-cascade-id="fresh-agy" data-selected="true"><span></span><div><a aria-label="新用户安装验收">新用户安装验收</a></div></div></nav><main></main>'); return; }
      const release = { ...pkg, dist: { tarball: registryOrigin + '/package.tgz', integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` } };
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/agent-things') res.end(JSON.stringify({ name: pkg.name, 'dist-tags': { latest: pkg.version }, versions: { [pkg.version]: release } }));
      else if (req.url === '/agent-things/latest') res.end(JSON.stringify(release));
      else { res.statusCode = 404; res.end('{}'); }
    });
    await new Promise(resolve => registry.listen(0, '127.0.0.1', resolve)); registryOrigin = `http://127.0.0.1:${registry.address().port}`;
    const cdpPort = await freePort();
    chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${temporary}/chrome`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
    await wait(async () => { try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).ok; } catch { return false; } });
    for (const scenario of ['codex', 'antigravity', 'both', 'claude', 'all', 'none', 'cancel', 'ctrl-c', 'missing-login', 'invalid-config', 'bootstrap-failure', 'registry-failure']) {
      console.log('Checking fresh install: ' + scenario);
      const home = path.join(temporary, scenario); fs.mkdirSync(home);
      const data = path.join(home, 'Library/Application Support/CodexSessionStatus');
      assert.equal(fs.existsSync(data), false);
      const prefix = `com.agentthings.acceptance.${process.pid}.${scenario}`;
      const caseLabels = [`${prefix}.codex`, `${prefix}.antigravity`, `${prefix}.claude`, `${prefix}.update`]; labels.push(...caseLabels);
      const hasClaude = ['claude', 'all'].includes(scenario);
      const env = { ...process.env, HOME: home, npm_config_registry: registryOrigin, npm_config_cache: path.join(home, '.npm'),
        npm_config_userconfig: path.join(home, '.npmrc'), npm_config_fetch_retries: '0', npm_config_fetch_timeout: '5000', npm_config_update_notifier: 'false',
        NODE_OPTIONS: `--require=${path.join(root, 'scripts/acceptance/fresh-install-preload.cjs')}`,
        AGENT_THINGS_ACCEPTANCE_HOME: home, AGENT_THINGS_ACCEPTANCE_LABEL: prefix, AGENT_THINGS_ACCEPTANCE_CDP: String(cdpPort),
        SESSION_STATUS_PORT: '0', DEVELOPER_DIR: '/agent-things-no-developer-tools', AGENT_THINGS_ACCEPTANCE_CLAUDE: hasClaude ? '1' : '',
        AGENT_THINGS_ACCEPTANCE_REGISTRY: registryOrigin };
      for (const name of ['CODEX_HOME', 'CODEX_THREAD_ID', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'NPM_TOKEN', 'NODE_AUTH_TOKEN']) delete env[name];
      if (scenario === 'bootstrap-failure') env.AGENT_THINGS_ACCEPTANCE_FAIL = 'bootstrap';
      if (scenario !== 'missing-login') { fs.mkdirSync(path.join(home, '.codex'), { recursive: true }); fs.writeFileSync(path.join(home, '.codex/config.toml'), 'model = "fixture"\n'); }
      fs.mkdirSync(path.join(home, '.gemini/antigravity'), { recursive: true });
      const agyConfigFile = path.join(home, '.gemini/antigravity/mcp_config.json');
      fs.writeFileSync(agyConfigFile, scenario === 'invalid-config' ? '{broken' : JSON.stringify({ mcpServers: { unrelated: { command: 'preserved' } } }));
      if (hasClaude) {
        const metadata = path.join(home, 'Library/Application Support/Claude/claude-code-sessions/account/org');
        fs.mkdirSync(metadata, { recursive: true });
        fs.writeFileSync(path.join(metadata, 'local_fresh-claude.json'), JSON.stringify({ sessionId: 'local_fresh-claude', cliSessionId: 'fresh-claude', cwd: path.join(home, 'project'), title: 'Fixture' }));
        fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { unrelated: { command: 'preserved' } } }));
      }
      const originalCodexConfig = hash(path.join(home, '.codex/config.toml'));
      const originalAgyConfig = hash(agyConfigFile);
      const targetMap = {};
      for (const [host, url] of [['codex', pathToFileURL(fixture).href], ['antigravity', registryOrigin + '/c/fresh-agy']]) {
        const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
        targets.push(target.id); targetMap[host] = target;
      }
      fs.mkdirSync(path.join(home, 'Library/Application Support/Antigravity'), { recursive: true });
      fs.writeFileSync(path.join(home, 'Library/Application Support/Antigravity/DevToolsActivePort'), String(cdpPort));
      const transcript = path.join(output, scenario + '.terminal.txt');
      registryFailure = scenario === 'registry-failure';
      let result = await terminal(home, env, ['missing-login', 'invalid-config', 'bootstrap-failure'].includes(scenario) ? 'both' : scenario, transcript);
      registryFailure = false;
      const text = fs.readFileSync(transcript, 'utf8');
      if (['none', 'cancel', 'ctrl-c'].includes(scenario)) {
        assert.equal(result.exitCode, scenario === 'ctrl-c' ? 130 : 0); assert.equal(fs.existsSync(path.join(data, 'config.json')), false);
        assert.equal(hash(path.join(home, '.codex/config.toml')), originalCodexConfig); assert.equal(hash(agyConfigFile), originalAgyConfig);
        assert.ok(caseLabels.every(label => !job(label))); cases.push({ scenario, ...result, cancelledCleanly: true });
      } else if (['missing-login', 'invalid-config', 'bootstrap-failure', 'registry-failure'].includes(scenario)) {
        assert.equal(result.exitCode, 1, text); assert.equal(fs.existsSync(path.join(data, 'config.json')), false);
        assert.ok(caseLabels.every(label => !job(label))); assert.equal(fs.existsSync(path.join(data, 'runtime')), false);
        assert.equal(hash(path.join(home, '.codex/config.toml')), originalCodexConfig); assert.equal(hash(agyConfigFile), originalAgyConfig);
        if (scenario === 'missing-login') assert.ok(text.includes('登录'));
        if (scenario === 'bootstrap-failure') {
          assert.ok(text.includes('ACCEPTANCE_AGY_BOOTSTRAP_FAILURE'));
          result = await terminal(home, env, 'both', path.join(output, scenario + '.retry.txt'));
          assert.equal(result.exitCode, 0); cases.push({ scenario, rollback: true, retry: true });
        } else cases.push({ scenario, errorVisible: true, partialInstallRemoved: true });
      }
      if (['codex', 'antigravity', 'both', 'claude', 'all', 'bootstrap-failure'].includes(scenario)) {
        assert.equal(result.exitCode, 0, text); assert.equal(result.cursorRestored, true);
        const config = JSON.parse(fs.readFileSync(path.join(data, 'config.json')));
        const expected = scenario === 'all' ? ['codex', 'antigravity', 'claude'] : hasClaude ? ['claude'] : ['bootstrap-failure', 'both'].includes(scenario) ? ['codex', 'antigravity'] : [scenario];
        assert.deepEqual(config.enabledApps, expected);
        await delay(1500);
        const checks = [];
        for (const host of ['codex', 'antigravity']) {
          const label = `${prefix}.${host}`;
          if (!expected.includes(host)) { assert.equal(job(label), ''); continue; }
          await wait(() => /\bpid = [1-9]\d*/.test(job(label)));
          const session = new CdpSession(targetMap[host], cdpPort); await session.connect(); sessions.push(session);
          let contextId;
          if (host === 'codex') {
            const { frameTree } = await session.request('Page.getFrameTree');
            contextId = (await session.request('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'agent-things-codex' })).executionContextId;
          }
          const evaluate = async expression => (await session.request('Runtime.evaluate', { expression, ...(contextId ? { contextId } : {}), returnByValue: true })).result.value;
          await wait(async () => await evaluate('Boolean(window.__codexSessionStatus?.status().mounted)'));
          const project = path.join(home, 'project'); fs.mkdirSync(project, { recursive: true });
          let entry;
          if (host === 'codex') {
            const toml = fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8').split('[mcp_servers.session_status]')[1];
            entry = { command: JSON.parse(toml.match(/command = (.+)/)[1]), args: JSON.parse(toml.match(/args = (.+)/)[1]) };
          } else entry = JSON.parse(fs.readFileSync(agyConfigFile)).mcpServers.session_status;
          await mcp(entry, env, JSON.stringify(['local', host === 'codex' ? 'local:one' : 'fresh-agy']), project, host === 'codex' ? 8 : 5);
          await wait(async () => await evaluate('window.__codexSessionStatus?.status().revision >= 1'));
          await wait(async () => await evaluate('document.querySelector("[data-codex-session-status]")?.shadowRoot.querySelector("svg text")?.textContent === "47"'));
          assert.ok(/\bpid = [1-9]\d*/.test(job(label)), 'Service survives terminal and MCP close');
          const pid = job(label).match(/\bpid = ([1-9]\d*)/)[1];
          await stopJob(label);
          const plist = path.join(home, 'Library/LaunchAgents', host === 'codex' ? 'com.codexsessionstatus.agent.plist' : 'com.antigravity.session-status.plist');
          execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
          await wait(() => /\bpid = [1-9]\d*/.test(job(label)) && !job(label).includes(`pid = ${pid}\n`));
          await wait(async () => await evaluate('document.querySelector("[data-codex-session-status]")?.shadowRoot.querySelector("svg text")?.textContent === "47"'));
          checks.push({ host, actualLaunchdService: true, terminalClosed: true, mounted: await evaluate('window.__codexSessionStatus.status().mounted'), mcpReadWrite: true, progressVisible: true, serviceRestartRetainsProgress: true });
        }
        if (hasClaude) {
          await wait(() => /\bpid = [1-9]\d*/.test(job(`${prefix}.claude`)));
          const entry = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'))).mcpServers.session_status;
          const project = path.join(home, 'project'); fs.mkdirSync(project, { recursive: true });
          await mcp(entry, env, JSON.stringify(['local', 'local_fresh-claude']), project);
          const runtime = path.join(data, 'runtime');
          assert.ok(fs.existsSync(path.join(home, '.claude/skills/agent-things-ui/hooks/register.js')));
          assert.ok(fs.existsSync(path.join(runtime, 'src/harnesses/claude/claude-navigation.cjs')));
          assert.equal(fs.existsSync(path.join(data, 'bridge')), expected.includes('codex'));
          assert.equal(fs.existsSync(path.join(home, 'Library/Application Support/Claude/developer_settings.json')), false);
          checks.push({ host: 'claude', actualLaunchdService: true, terminalClosed: true, mcpReadWrite: true, cardInstalled: true });
        }
        const managed = await terminal(home, env, 'management', path.join(output, scenario + '.management.txt'));
        assert.equal(managed.exitCode, 0); assert.equal(managed.stage, 'management');
        const ledgerFiles = expected.map(host => host === 'codex' ? path.join(data, 'manual-state.json') : host === 'claude' ? path.join(home, 'Library/Application Support/AgentThings/claude/manual-state.json') : path.join(home, '.gemini/antigravity/session-status/manual-state.json'));
        const ledgerHashes = ledgerFiles.map(hash);
        if (scenario === 'all') {
          const metadataFile = path.join(data, 'runtime/package.json');
          const metadata = JSON.parse(fs.readFileSync(metadataFile));
          fs.writeFileSync(metadataFile, JSON.stringify({ ...metadata, version: '1.0.0' }));
          const beforeConfig = JSON.parse(fs.readFileSync(path.join(data, 'config.json')));
          execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(data, 'runtime/src/npm-updates.cjs'))}).startUpdate().catch(e=>{console.error(e);process.exitCode=1})`], { env, stdio: 'pipe', timeout: 10000 });
          await wait(() => {
            const status = JSON.parse(fs.readFileSync(path.join(data, 'npm-update.json')));
            assert.notEqual(status.stage, 'failed', status.error);
            return status.stage === 'completed';
          }, 30000);
          const afterConfig = JSON.parse(fs.readFileSync(path.join(data, 'config.json')));
          assert.equal(JSON.parse(fs.readFileSync(metadataFile)).version, pkg.version);
          assert.deepEqual(afterConfig.enabledApps, beforeConfig.enabledApps);
          assert.equal(afterConfig.lang, beforeConfig.lang);
          assert.deepEqual(ledgerFiles.map(hash), ledgerHashes);
          await stopJob(`${prefix}.update`);
          checks.push({ independentNpmUpgrade: true, threeHostServicesVerified: true, preferencesAndRecordsRetained: true });
        }
        const removed = await terminal(home, env, 'uninstall', path.join(output, scenario + '.uninstall.txt'));
        assert.equal(removed.exitCode, 0); assert.ok(caseLabels.every(label => !job(label)));
        assert.equal(fs.existsSync(path.join(data, 'runtime')), false); assert.deepEqual(ledgerFiles.map(hash), ledgerHashes);
        assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'config.json'))).installed, false);
        const reinstalled = await terminal(home, env, scenario === 'bootstrap-failure' ? 'both' : scenario, path.join(output, scenario + '.reinstall.txt'));
        assert.equal(reinstalled.exitCode, 0); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'config.json'))).enabledApps, expected);
        await wait(() => expected.every(host => /\bpid = [1-9]\d*/.test(job(`${prefix}.${host}`))));
        assert.deepEqual(ledgerFiles.map(hash), ledgerHashes);
        cases.push({ scenario, ...result, applications: expected, checks, reentry: true, uninstallAndReinstall: true, recordsRetained: true });
      }
      for (const label of caseLabels) await stopJob(label);
      for (const target of Object.values(targetMap)) await fetch(`http://127.0.0.1:${cdpPort}/json/close/${target.id}`);
    }
    assert.deepEqual(protectedFiles.map(hash), protectedHashes); assert.deepEqual(appPids(), beforePids);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, cases, protectedDataUnchanged: true, clientsNotRestarted: true,
      boundary: 'Isolated HOME and real launchd; local npm registry and browser host fixtures. Claude manual debugger attachment is stubbed; cold signed-in hosts and a fresh macOS account remain manual acceptance.' }, null, 2));
    console.log(JSON.stringify({ passed: true, scenarios: new Set(cases.map(item => item.scenario)).size, results: cases.length, report: path.join(output, 'report.json') }));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ passed: false, cases, error: error.stack }, null, 2));
    throw error;
  } finally {
    for (const label of labels) await stopJob(label);
    for (const session of sessions) session.close();
    if (chrome) { chrome.kill('SIGTERM'); await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); }); }
    if (registry) await new Promise(resolve => registry.close(resolve));
    assert.deepEqual(protectedFiles.map(hash), protectedHashes); assert.deepEqual(appPids(), beforePids);
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
