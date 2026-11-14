'use strict';
// Isolated Chromium integration: production card, sandbox, host bridge and local service.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { generateCardArtifact } = require('../src/antigravity-card.cjs');
const { CdpSession, listTargets } = require('../src/cdp.cjs');

async function waitFor(fn, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Antigravity sandbox loading check timed out');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-loading-browser-'));
  const brainDir = path.join(dir, 'brain'), id = 'loading-test';
  const service = new AntigravityService({ port: 0, stateFile: path.join(dir, 'state.json'), brainDir });
  let chrome, session, chromeLog = '';
  try {
    await service.start();
    const key = service.canonicalKey(id);
    service.store.update({ key, expectedRevision: 0, record: { state: 'unfinished', progress: 60, note: '隔离加载验收' } });
    const artifact = generateCardArtifact({ conversationId: id, brainDir: path.join(brainDir, id), connection: { origin: `http://127.0.0.1:${service.port}` } });
    const html = fs.readFileSync(artifact.path, 'utf8');
    const harness = fs.readFileSync(path.join(__dirname, '../src/harnesses/antigravity/antigravity-harness.js'), 'utf8');
    const bootstrap = `window.errors=[];window.addEventListener('error',e=>window.errors.push(e.message));window.requests=[];window.__agentThingsConnection=${JSON.stringify({ origin: `http://127.0.0.1:${service.port}`, token: service.http.credentials.token, brainDir })};
      const realFetch=window.fetch.bind(window);
      window.fetch=async (...args)=>{if(String(args[0]).endsWith('/session/verify-artifact'))await new Promise(r=>setTimeout(r,250));const r=await realFetch(...args);const info=String(args[0]).endsWith('/session/verify-artifact')?await r.clone().json():{};window.requests.push({path:new URL(args[0]).pathname,status:r.status,valid:info.valid});return r};
      ${harness}
      window.loopTicks=0;setInterval(()=>window.loopTicks++,10);
      window.loadingStarted=performance.now();
      document.querySelector('iframe').srcdoc=${JSON.stringify(html)};
      setTimeout(()=>{window.responsiveBeforeVerification=window.loopTicks>0&&!window.__agentThingsCardBindings.size},100);`;
    fs.writeFileSync(path.join(dir, 'bootstrap.js'), bootstrap);
    fs.writeFileSync(path.join(dir, 'host.html'), '<!doctype html><meta charset="utf-8"><div data-testid="aux-pane-split"><iframe data-testid="artifact-dynamic-ui-iframe" sandbox="allow-scripts allow-forms"></iframe></div><script src="./bootstrap.js"></script>');
    const reservation = http.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}/chrome`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--no-proxy-server', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    chrome.stderr.on('data', chunk => { chromeLog = (chromeLog + chunk.toString()).slice(-2000); });
    await waitFor(async () => { try { return (await listTargets(port, 1000)).length > 0; } catch { return false; } }).catch(e=>{throw new Error(e.message+'; Chrome: '+chromeLog+'; exit='+chrome.exitCode)});
    const url = `${pathToFileURL(path.join(dir, 'host.html')).href}?tab=${encodeURIComponent(`artifact__file://${artifact.path}`)}`;
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    session = new CdpSession(target, port);
    await session.connect();
    await session.request('Page.enable').catch(e=>{throw new Error('Page.enable: '+e.message)});
    await session.request('Page.navigate', { url }).catch(e=>{throw new Error('Page.navigate: '+e.message)});
    const run = async expression => (await session.evaluate(expression)).result.value;
    try {
      await waitFor(() => run('Boolean([...window.__agentThingsCardBindings?.values()||[]].find(b=>b.handshakeDone&&b.lastReportedProgress===60))'));
    } catch (error) {
      console.error(await run(`({ errors:window.errors, requests:window.requests, hook:window.__agentThingsSrcdocHookInstalled, href:window.location.href, body:document.body?.innerHTML.slice(0,300), length:document.querySelector('iframe')?.srcdoc.length, bindings:[...window.__agentThingsCardBindings?.values()||[]].map(b=>({active:b.active,handshake:b.handshakeDone,hasPort:!!b.port,progress:b.lastReportedProgress})) })`));
      throw error;
    }
    assert.equal(await run('window.responsiveBeforeVerification'), true);
    assert.equal(await run('[...window.__agentThingsCardBindings.values()][0].loadToken'), null);
    // A new setter assignment must revoke the old document's port immediately.
    await run(`document.querySelector('iframe').srcdoc='<html>replacement</html>'`);
    assert.equal(await run('window.__agentThingsCardBindings.size'), 0);
    console.log('PASS: sandbox srcdoc loads asynchronously, authenticates, receives 60%, and revokes on replacement.');
  } finally {
    session?.close();
    if (chrome) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await exited; }
    }
    chrome?.stderr?.destroy();
    await service.stop();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
