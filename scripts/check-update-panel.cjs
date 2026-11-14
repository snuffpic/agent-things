'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');
const { CodexService } = require('../src/harnesses/codex/codex-service.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'update-panel-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${directory}/chrome`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
  const store = new ManualStatusStore(path.join(directory, 'state.json'));
  const original = JSON.stringify(store.snapshot());
  let info = { currentVersion: '1.0.0', latestVersion: '1.0.0', available: false, command: 'npx agent-things@latest', update: null };
  let disconnected = false, starts = 0;
  const updates = {
    getUpdateInfo: async () => { if (disconnected) throw Error('模拟后台暂时断开'); return info; },
    startUpdate: async () => { starts++; info = { ...info, update: { id: `update-${starts}`, stage: 'queued' } }; },
  };
  const agent = new CodexService({ store, port, updates });
  agent.projectGit = async () => ({ status: 'checked', hasRemote: false });
  const waitFor = async predicate => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Update panel fixture timed out');
  };
  try {
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/list`)).ok; } catch { return false; } });
    const fixture = pathToFileURL(path.join(root, 'test/fixtures/session-status.html')).href;
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(fixture)}`, { method: 'PUT' })).json();
    const session = await agent.attach(target);
    agent.sessions.set(target.id, session);
    await session.request('Emulation.setDeviceMetricsOverride', { width: 1050, height: 900, deviceScaleFactor: 2, mobile: false });
    const run = async expression => {
      const result = await agent.evaluate(session, expression);
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const panel = 'document.querySelector("[data-codex-session-status-panel]").shadowRoot';
    const click = selector => run(`${panel}.querySelector(${JSON.stringify(selector)}).click()`);
    const open = async () => {
      await run('document.querySelector("[data-codex-session-status]").shadowRoot.querySelector("button").click()');
      await waitFor(async () => await run('Boolean(document.querySelector("[data-codex-session-status-panel]"))'));
    };
    await open();
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-label').textContent.includes('1.0.0')`));
    assert.equal(await run(`${panel}.querySelector('.app-update').hidden`), true);
    await click('.close');
    info = { ...info, latestVersion: '1.1.0', available: true };
    await open();
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-label').textContent === '发现新版本 v1.1.0'`));
    assert.equal(await run(`${panel}.querySelector('.note-open').nextElementSibling.className`), 'app-update');
    assert.equal(await run(`${panel}.querySelector('.app-update-button').textContent`), '立即升级');
    assert.equal(await run(`(()=>{const p=${panel};return p.querySelector('.app-update-button').getBoundingClientRect().right<=p.querySelector('.app-update').getBoundingClientRect().right})()`), true);
    const output = path.join(root, 'outputs'); fs.mkdirSync(output, { recursive: true });
    const screenshot = async name => {
      const image = await session.request('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
    };
    await screenshot('npm-update-panel-dark.png');
    await run(`document.querySelectorAll('[data-app-action-sidebar-thread-row]').forEach(row=>row.style.color='#22272e');window.dispatchEvent(new Event('resize'))`);
    assert.equal(await run('document.querySelector("[data-codex-session-status-panel]").getAttribute("data-color-mode")'), 'light');
    await screenshot('npm-update-panel-light.png');
    await click('.app-update-button');
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-button').disabled`));
    assert.equal(starts, 1);
    await click('.close');
    info.update.stage = 'waiting';
    await open();
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-label').textContent === '等待当前分析结束'`));
    assert.equal(await run(`${panel}.querySelector('.analyze').disabled`), true);
    disconnected = true;
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-detail').textContent.includes('正在重新连接后台')`));
    disconnected = false;
    info.update = { stage: 'failed', error: '模拟健康检查失败，已恢复旧版' };
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-label').textContent === '升级失败'`));
    assert.equal(await run(`${panel}.querySelector('.app-update-button').textContent`), '重试');
    assert.equal(await run(`${panel}.querySelector('.app-update-detail').textContent.includes('npx agent-things@latest')`), true);
    await click('.app-update-button');
    await waitFor(async () => starts === 2);
    info = { ...info, currentVersion: '1.1.0', available: false, update: { stage: 'completed', currentVersion: '1.1.0', reconnectMcp: true, updatedAt: new Date().toISOString() } };
    await waitFor(async () => await run(`${panel}.querySelector('.app-update-label').textContent === '已升级至 v1.1.0'`));
    assert.equal(await run(`${panel}.querySelector('.app-update-detail').textContent`), '请在客户端重新连接 MCP 服务');
    assert.equal(JSON.stringify(store.snapshot()), original);
    console.log('PASS: update banner placement, current-version hiding, light/dark layout, background update after close, reconnect, retry and completion; task records unchanged.');
  } finally {
    await agent.stop();
    chrome.kill('SIGTERM');
    await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
