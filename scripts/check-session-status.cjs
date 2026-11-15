'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { ManualStatusAgent } = require('../src/manual-status-agent.cjs');
const { ManualStatusStore } = require('../src/manual-status-store.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-status-browser-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${temporary}/chrome`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLog = '';
  chrome.stderr.on('data', data => { chromeLog = (chromeLog + data).slice(-3000); });
  const store = new ManualStatusStore(path.join(temporary, 'state.json'));
  const errors = [];
  const rendererFile = path.join(temporary, 'session-status.js');
  fs.copyFileSync(path.join(root, 'src/session-status.js'), rendererFile);
  const harnessFile = path.join(temporary, 'codex-harness.js');
  fs.copyFileSync(path.join(root, 'src/harnesses/codex/codex-harness.js'), harnessFile);
  fs.copyFileSync(path.join(root, 'src/harnesses/codex/codex-local-card.js'), path.join(temporary, 'codex-local-card.js'));
  fs.appendFileSync(harnessFile, '\nwindow.__fixtureHarnessVersion = 1;\n');
  const agent = new ManualStatusAgent({ store, port, rendererFile, harnessFile, onError: error => errors.push(error.message) });
  let projectHasRemote = true;
  agent.projectGit = async () => ({ status: 'checked', hasRemote: projectHasRemote });
  const requestIds = new Set();
  const handleMessage = agent.handleMessage.bind(agent);
  agent.handleMessage = (session, payload) => {
    const { requestId } = JSON.parse(payload);
    assert.equal(requestIds.has(requestId), false, 'Requests remain unique across windows and renderer reloads');
    requestIds.add(requestId);
    return handleMessage(session, payload);
  };
  // Hosted CI runners (especially Intel) can take well over 6 s to paint a frame under load.
  const waitFor = async (predicate, timeout = process.env.CI ? 20000 : 6000, describe = null) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    let detail = '';
    if (describe) { try { detail = `\n${JSON.stringify(await describe(), null, 2)}`; } catch (error) { detail = `\n(diagnostics failed: ${error.message})`; } }
    throw new Error(`Browser check timed out${detail}`);
  };
  try {
    await waitFor(async () => {
      try { return (await fetch(`http://127.0.0.1:${port}/json/list`)).ok; } catch { return false; }
    }, 20000).catch(error => { throw new Error(`${error.message}\n${chromeLog}`); });
    const fixture = pathToFileURL(path.join(root, 'test/fixtures/session-status.html')).href;
    const create = async () => {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(fixture)}`, { method: 'PUT' })).json();
      const session = await agent.attach(target);
      agent.sessions.set(target.id, session);
      await session.request('Emulation.setDeviceMetricsOverride', { width: 1050, height: 760, deviceScaleFactor: 2, mobile: false });
      await session.request('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      return session;
    };
    const one = await create();
    const run = async (expression, session = one) => {
      try { return (await agent.evaluate(session, expression)).result.value; }
      catch (error) { throw new Error(`${error.message}\nExpression: ${expression}`); }
    };
    // Model host loading: the renderer is installed before the sidebar exists.
    await run(`(() => { window.__fixtureNav = document.querySelector('nav'); window.__fixtureNav.remove(); window.__codexSessionStatus.destroy(); })()`);
    await agent.updateRenderer(one);
    assert.equal((await run('window.__codexSessionStatus.status().startup')).sidebarReadyAt, null);
    await run(`new Promise(resolve => setTimeout(() => { window.__fixtureSidebarReadyAt = Date.now(); document.body.prepend(window.__fixtureNav); resolve(); }, 250))`);
    await waitFor(async () => Boolean((await run('window.__codexSessionStatus.status().startup')).badgesReadyAt));
    const appearance = await run('({ ...window.__codexSessionStatus.status().startup, fixtureReadyAt: window.__fixtureSidebarReadyAt })');
    assert.ok(appearance.sidebarReadyAt >= appearance.fixtureReadyAt);
    assert.ok(appearance.badgesReadyAt - appearance.fixtureReadyAt < 3000, 'Badges must appear within 3s of sidebar readiness');
    console.log(`Startup fixture: sidebar-to-badges ${appearance.badgesReadyAt - appearance.fixtureReadyAt}ms`);
    const mark = 'document.querySelector("[data-codex-session-status]").shadowRoot.querySelector("button")';
    const panel = 'document.querySelector("[data-codex-session-status-panel]").shadowRoot';
    const key = JSON.stringify(['local', 'local:one']);
    const noteText = ['<img src=x onerror=alert(1)>', '等待复核'].join(String.fromCharCode(10));
    const output = path.join(root, 'outputs'); fs.mkdirSync(output, { recursive: true });
    const click = selector => run(`${panel}.querySelector(${JSON.stringify(selector)}).click()`);
    const openEdit = async () => { await click('.edit-open'); await waitFor(async () => await run(`!${panel}.querySelector('.edit-view').hidden`)); };
    const number = async value => run(`(()=>{const n=${panel}.querySelector('.progress-number');n.value=${JSON.stringify(String(value))};n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const commit = async () => { await click('.save-record'); await waitFor(async () => await run(`!${panel}.querySelector('.overview').hidden && !${panel}.querySelector('.save-record').disabled`)); };
    const setChoice = async index => { await openEdit(); await run(`${panel}.querySelectorAll('.choice')[${index}].click()`); await commit(); };
    assert.equal((await run('window.__codexSessionStatus.status()')).mounted, 5);
    assert.equal(await run('document.querySelector("[data-native-icon]").isConnected'), true);
    assert.equal(await run(`${mark}.querySelector('svg').getBoundingClientRect().width`), 24);
    const firstHost = 'document.querySelector("[data-codex-session-status]")';
    assert.equal(await run(`getComputedStyle(${firstHost}).opacity`), '0');
    await run(`document.querySelector('[data-app-action-sidebar-thread-row]').dispatchEvent(new PointerEvent('pointerenter'))`);
    assert.equal(await run(`getComputedStyle(${firstHost}).opacity`), '1');
    await run(`document.querySelector('[data-app-action-sidebar-thread-row]').dispatchEvent(new PointerEvent('pointerleave'))`);
    assert.equal(await run(`getComputedStyle(${firstHost}).opacity`), '0');
    await run(`document.querySelector('[data-app-action-sidebar-thread-row]').setAttribute('data-app-action-sidebar-thread-selected','true')`);
    await waitFor(async () => await run(`getComputedStyle(${firstHost}).opacity`) === '1');
    await run(`document.querySelector('[data-app-action-sidebar-thread-row]').removeAttribute('data-app-action-sidebar-thread-selected')`);
    await waitFor(async () => await run(`getComputedStyle(${firstHost}).opacity`) === '0');
    await run(`${mark}.click()`);
    assert.equal(await run('window.__codexSessionStatus.status().panelOpen'), true);
    assert.equal((await one.evaluate('window.navigationClicks')).result.value, 0);
    await waitFor(async () => !await run(`${panel}.querySelectorAll('.choice')[3].hidden`));
    assert.equal(await run(`${panel}.querySelector('.shell').getBoundingClientRect().width`), 340);
    assert.equal(await run(`${panel}.querySelector('.clear').parentElement.className`), 'actions');
    assert.equal(await run(`getComputedStyle(${panel}.querySelector('.clear')).color`), 'rgb(130, 140, 150)');
    const clearPoint = await run(`(()=>{const r=${panel}.querySelector('.clear').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await one.request('Input.dispatchMouseEvent', { type: 'mouseMoved', ...clearPoint });
    await waitFor(async () => await run(`getComputedStyle(${panel}.querySelector('.clear')).color`) === 'rgb(239, 119, 119)');
    await one.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 700 });
    assert.equal(await run(`${panel}.textContent.includes('保存在本机')`), false);
    assert.equal(await run(`${panel}.querySelector('.remaining-toggle').hidden`), true);
    await setChoice(0);
    assert.equal(store.snapshot().records[key].state, 'unstarted');
    assert.equal(await run(`${mark}.querySelector('circle').getAttribute('stroke')`), '#9098a2');
    await setChoice(1);
    assert.equal(store.snapshot().records[key].state, 'unfinished');
    assert.equal(store.snapshot().records[key].progress, null);
    await openEdit();
    assert.equal(await run(`${panel}.querySelector('.edit-view h3').textContent`), '手动记录会话状态');
    assert.deepEqual(await run(`[...${panel}.querySelectorAll('.range-node')].map(n=>n.textContent)`), ['0','25','50','75','100']);
    assert.equal(await run(`(()=>{const body=${panel}.querySelector('.panel-body').getBoundingClientRect();return [...${panel}.querySelectorAll('.range-node-label')].every(n=>{const r=n.getBoundingClientRect();return r.left>=body.left&&r.right<=body.right})})()`), true, 'All five tick labels fit inside the panel');
    const beforeDraft = JSON.stringify(store.snapshot());
    await run(`(()=>{const r=${panel}.querySelector('.range-input');r.dispatchEvent(new PointerEvent('pointerdown'));r.value='24';r.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    assert.equal(await run(`${panel}.querySelector('.progress-number').value`), '25');
    await run(`(()=>{const r=${panel}.querySelector('.range-input');r.value='62';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new PointerEvent('pointerup'))})()`);
    assert.equal(await run(`${panel}.querySelector('.progress-number').value`), '62');
    assert.equal(JSON.stringify(store.snapshot()), beforeDraft, 'Draft stays local until explicit save');
    await click('.cancel'); assert.equal(JSON.stringify(store.snapshot()), beforeDraft);
    await click('.note-open');
    assert.equal(await run(`${panel}.querySelector('.unknown').textContent`), '清空进度');
    assert.equal(await run(`getComputedStyle(${panel}.querySelector('textarea')).outlineStyle`), 'none');
    const longDraft = Array.from({ length: 60 }, (_, index) => `第${index + 1}行：保留未保存的备注与当前编辑位置`).join('\n');
    await run(`(()=>{const n=${panel}.querySelector('textarea');n.value=${JSON.stringify(longDraft)};n.focus();n.setSelectionRange(12,24);n.dispatchEvent(new Event('input',{bubbles:true}));n.scrollTop=96})()`);
    const savedNoteScroll = await run(`${panel}.querySelector('textarea').scrollTop`);
    await one.request('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 700, button: 'left', clickCount: 1 });
    await one.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1000, y: 700, button: 'left', clickCount: 1 });
    assert.equal(await run('window.__codexSessionStatus.status().panelOpen'), false);
    assert.equal(JSON.stringify(store.snapshot()), beforeDraft, 'An outside click keeps the draft separate from the saved record');
    await run(`${mark}.click()`);
    assert.equal(await run(`${panel}.querySelector('.edit-view').hidden`), false);
    assert.equal(await run(`${panel}.querySelector('textarea').value`), longDraft);
    assert.equal(await run(`${panel}.querySelector('textarea').scrollTop`), savedNoteScroll);
    await run(`document.querySelectorAll('[data-codex-session-status]')[1].shadowRoot.querySelector('button').click()`);
    assert.equal(await run(`${panel}.querySelector('.overview').hidden`), false);
    assert.notEqual(await run(`${panel}.querySelector('textarea').value`), longDraft);
    await run(`${mark}.click()`);
    assert.equal(await run(`${panel}.querySelector('textarea').value`), longDraft);
    assert.equal(JSON.stringify(store.snapshot()), beforeDraft, 'Switching chats does not submit a draft');
    await click('.close');
    fs.appendFileSync(rendererFile, '\n// reload closed-panel draft memory\n');
    await waitFor(async () => await agent.updateRenderer(one) === 'updated');
    await run(`${mark}.click()`);
    assert.equal(await run(`${panel}.querySelector('.edit-view').hidden`), false);
    assert.equal(await run(`${panel}.querySelector('textarea').value`), longDraft);
    await click('.cancel'); await openEdit();
    assert.notEqual(await run(`${panel}.querySelector('textarea').value`), longDraft, 'Explicit cancellation clears the draft');
    await click('.cancel');
    await openEdit(); await number(60);
    await run(`(()=>{const n=${panel}.querySelector('textarea');n.value=${JSON.stringify(noteText)};n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await commit();
    assert.equal(store.snapshot().records[key].progress, 60);
    assert.equal(await run(`${panel}.querySelector('.source-label').textContent`), '手动调整');
    assert.ok(await run(`${panel}.querySelector('.timestamp').textContent.length > 0`));
    assert.equal(await run(`${panel}.querySelector('img')`), null, 'Notes are text');
    const expandedNote = '完整备注：逐项核对会话任务的当前进展，保留原始说明与后续安排。'.repeat(16);
    store.update({ key, expectedRevision: store.snapshot().records[key].revision, record: { state: 'unfinished', progress: 60, note: expandedNote } });
    await agent.broadcast();
    await waitFor(async () => !await run(`${panel}.querySelector('.summary-expand').hidden`));
    assert.equal(await run(`getComputedStyle(${panel}.querySelector('.overview-summary')).webkitLineClamp`), '3');
    const previewHeight = await run(`${panel}.querySelector('.overview-summary').clientHeight`);
    await click('.summary-expand');
    assert.equal(await run(`${panel}.querySelector('.summary-block').classList.contains('expanded')`), true);
    assert.equal(await run(`${panel}.querySelector('.overview-summary').textContent`), expandedNote);
    assert.ok(await run(`${panel}.querySelector('.overview-summary').clientHeight`) > previewHeight);
    await run(`${panel}.querySelector('.edit-open').focus()`);
    assert.equal(await run(`${panel}.querySelector('.summary-block').classList.contains('expanded')`), false);
    assert.equal(await run(`${panel}.querySelector('.overview-summary').clientHeight`), previewHeight);
    store.update({ key, expectedRevision: store.snapshot().records[key].revision, record: { state: 'unfinished', progress: 60, note: noteText } });
    await agent.broadcast();
    await waitFor(async () => await run(`${panel}.querySelector('.summary-expand').hidden`));
    await setChoice(2); assert.equal(store.snapshot().records[key].state, 'completed');
    await setChoice(3); assert.equal(store.snapshot().records[key].state, 'pushed');
    await click('.close'); projectHasRemote = false; await run(`${mark}.click()`); await openEdit();
    await waitFor(async () => await run(`${panel}.querySelectorAll('.choice')[3].hidden`));
    assert.equal(await run(`getComputedStyle(${panel}.querySelectorAll('.choice')[3]).display`), 'none');
    await click('.cancel'); await click('.close'); projectHasRemote = true; await run(`${mark}.click()`);
    const two = await create(); assert.equal(await run(`${mark}.textContent`, two), '100');
    await one.request('Page.bringToFront');
    await openEdit(); await number(37); await commit();
    await waitFor(async () => await run(`${mark}.textContent`, two) === '37');
    await openEdit();
    await run(`(()=>{const n=${panel}.querySelector('textarea');n.value='保留手动草稿';n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    store.update({ key, expectedRevision: store.snapshot().records[key].revision, record: { state: 'unfinished', progress: 30, note: '另一窗口' } }); await agent.broadcast();
    await click('.save-record'); await waitFor(async () => await run(`${panel}.querySelector('.error').textContent.includes('其他窗口')`));
    assert.equal(await run(`${panel}.querySelector('textarea').value`), '保留手动草稿');
    await click('.save-record');
    await waitFor(async () => await run(`${panel}.querySelector('.error').textContent.includes('其他窗口')`));
    assert.equal(store.snapshot().records[key].note, '另一窗口', 'Repeated save cannot silently overwrite the newer record');
    await run(`[...${panel}.querySelectorAll('button')].find(button => button.textContent === '读取最新版本并保留草稿').click()`);
    await waitFor(async () => await run(`${panel}.querySelector('.error').textContent.includes('已读取最新版本')`));
    await commit(); assert.equal(store.snapshot().records[key].note, '保留手动草稿');
    await click('.clear'); await waitFor(() => store.snapshot().records[key]?.state === null);
    await waitFor(async () => await run(`!${panel}.querySelector('.save-record').disabled && !${panel}.querySelector('.analyze').disabled`));
    assert.equal(new ManualStatusStore(store.file).snapshot().records[key].state, null);
    const { AnalysisService } = require('../src/analysis-service.cjs');
    const fakeTurn = { id: 'turn-1', status: 'completed', items: [{ id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '测试任务' }] }] };
    const longTitle = '检查完整会话增量分析、任务来源跳转与后台运行状态，并完成视觉和交互验收';
    agent.analysisService = new AnalysisService({ store, onChange: () => agent.broadcast(),
      makeServer: () => ({ initialize: async () => {}, close() {}, request: async () => ({ data: [fakeTurn], nextCursor: null }) }),
      run: async ({ input }) => ({ summary: '当前结果', tasks: [longTitle, '继续实现', '等待依赖', '交付验收', '已交付任务'].map((title, index) => ({ knownTaskId: null, title, status: ['in_progress', 'todo', 'blocked', 'needs_verification', 'done'][index], evidenceRefs: [input.events.find(event => event.type === 'user').ref] })), removedTaskIds: [] }) });
    await click('.analyze'); await waitFor(() => store.snapshot().records[key]?.source === 'analysis');
    await waitFor(async () => await run(`${panel}.querySelector('.totals').textContent.includes('1 / 5')`));
    assert.equal(await run(`${panel}.querySelectorAll('.current-tasks .task-row').length`), 3);
    assert.equal(await run(`${panel}.querySelector('.remaining-toggle').textContent`), '查看全部 4 条 ›');
    assert.equal(await run(`${panel}.querySelector('.history-open .row-detail').textContent`), '1 条 ›');
    assert.deepEqual(await run(`[...${panel}.querySelector('.overview-bottom').children].map(n=>n.className)`), ['quiet-row history-open', 'quiet-row note-open', 'app-update']);
    assert.equal(await run(`(()=>{const a=getComputedStyle(${panel}.querySelector('.remaining-toggle')),b=getComputedStyle(${panel}.querySelector('.history-open .row-detail'));return a.fontSize===b.fontSize&&a.lineHeight===b.lineHeight&&a.color===b.color})()`), true);
    await click('.remaining-toggle');
    assert.equal(await run(`${panel}.querySelectorAll('.current-tasks .task-row').length`), 4);
    assert.equal(await run(`[...${panel}.querySelectorAll('.current-tasks .task-row')].every(n=>n.dataset.status!=='done')`), true);
    await click('.remaining-toggle');
    assert.equal(await run(`${panel}.querySelectorAll('.current-tasks .task-row').length`), 3);
    assert.equal(await run(`${panel}.querySelector('.source-label').textContent`), '自动分析');
    assert.equal(await run(`(()=>{const a=${panel}.querySelector('.totals'),b=${panel}.querySelector('.source-label'),sa=getComputedStyle(a),sb=getComputedStyle(b);return sa.fontSize===sb.fontSize&&sa.fontWeight===sb.fontWeight&&sa.lineHeight===sb.lineHeight&&Math.abs(a.getBoundingClientRect().top-b.getBoundingClientRect().top)<.5})()`), true, 'Totals and source share type and vertical alignment');
    await waitFor(async () => await run(`${panel}.querySelector('.current-tasks .task-title').classList.contains('overflowing')`), undefined, () => run(`(async () => {
      const title = ${panel}.querySelector('.current-tasks .task-title');
      const copy = title?.firstElementChild?.firstElementChild;
      const frame = await Promise.race([new Promise(resolve => requestAnimationFrame(() => resolve('fired'))), new Promise(resolve => setTimeout(() => resolve('not fired in 2s'), 2000))]);
      return { frame, visibility: document.visibilityState, dpr: devicePixelRatio, innerWidth, titleText: copy?.textContent,
        titleClientWidth: title?.clientWidth, copyWidth: copy?.getBoundingClientRect().width,
        maskWidth: title?.closest('.task-row')?.querySelector('.task-source')?.offsetWidth,
        className: title?.className, travel: title?.style.getPropertyValue('--travel'),
        font: copy && getComputedStyle(copy).fontFamily, fontSize: copy && getComputedStyle(copy).fontSize,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, userAgent: navigator.userAgent };
    })()`));
    await one.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 700 });
    const taskOffset = () => run(`new DOMMatrix(getComputedStyle(${panel}.querySelector('.current-tasks .task-track')).transform).m41`);
    assert.equal(await taskOffset(), 0, 'Task title rests at its initial position');
    await run(`window.__originalTaskRow=${panel}.querySelector('.current-tasks .task-row')`);
    await agent.broadcast();
    assert.equal(await run(`window.__originalTaskRow===${panel}.querySelector('.current-tasks .task-row')`), true, 'An unchanged snapshot preserves the task node');
    assert.equal(await run(`getComputedStyle(${panel}.querySelector('.current-tasks .task-source')).opacity`), '0');
    const taskPoint = await run(`(()=>{const r=${panel}.querySelector('.current-tasks .task-row').getBoundingClientRect();return {x:r.x+30,y:r.y+10}})()`);
    await one.request('Input.dispatchMouseEvent', { type: 'mouseMoved', ...taskPoint });
    await waitFor(async () => await run(`getComputedStyle(${panel}.querySelector('.current-tasks .task-source')).opacity`) === '1');
    await waitFor(async () => await taskOffset() < -1);
    const movingOffset = await taskOffset();
    await agent.broadcast();
    assert.equal(await run(`window.__originalTaskRow===${panel}.querySelector('.current-tasks .task-row')`), true);
    assert.ok(await taskOffset() <= movingOffset + .5, 'A snapshot does not rewind hovered text');
    assert.match(await run(`getComputedStyle(${panel}.querySelector('.current-tasks .task-source')).backgroundImage`), /gradient/);
    await one.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1000, y: 700 });
    await waitFor(async () => Math.abs(await taskOffset()) < .01);
    await click('.history-open');
    assert.equal(await run(`${panel}.querySelector('.back').textContent`), '‹ 返回');
    assert.equal(await run(`${panel}.querySelector('.history-view').textContent.includes('已分析')`), false);
    assert.equal(await run(`${panel}.querySelector('.history-view h3').textContent`), '已完成任务');
    assert.equal(await run(`${panel}.querySelectorAll('.history-list .task-row').length`), 1);
    assert.equal(await run(`${panel}.querySelector('.history-list .task-row').dataset.status`), 'done');
    await run(`(()=>{document.querySelector('[data-app-action-sidebar-thread-row]').setAttribute('data-app-action-sidebar-thread-selected','true');const t=document.createElement('div');t.setAttribute('data-content-search-unit-key','turn-1:user-1');t.textContent='测试来源';document.body.append(t);${panel}.querySelector('.history-list .task-source button').click()})()`);
    await waitFor(async () => await run(`${panel}.querySelector('.analysis-message').textContent.includes('已定位来源')`));
    const capture = async name => { const { data } = await one.request('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(output, name), Buffer.from(data, 'base64')); };
    await capture('production-panel-history.png'); await click('.back'); await capture('production-panel-overview.png');
    await openEdit(); await capture('production-panel-manual.png'); await click('.cancel');
    await one.request('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await run(`document.body.style.backgroundColor='#fff';document.querySelector('nav').style.backgroundColor='#fff';document.documentElement.setAttribute('data-theme','light')`);
    await waitFor(async () => await run(`document.querySelector('[data-codex-session-status-panel]').getAttribute('data-color-mode')`) === 'light');
    await capture('production-panel-overview-light.png');
    await openEdit(); await capture('production-panel-manual-light.png'); await click('.cancel');
    await one.request('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await run(`document.body.style.removeProperty('background-color');document.querySelector('nav').style.removeProperty('background-color');document.documentElement.setAttribute('data-theme','dark')`);

    let finishModel;
    const deferred = new Promise(resolve => { finishModel = resolve; }); agent.analysisService.run = () => deferred;
    await click('.analyze'); await waitFor(() => store.analysisState(key).timeline.at(-1).status === 'pending');
    await waitFor(async () => await run(`${mark}.getAttribute('aria-busy')`) === 'true');
    assert.equal(await run(`${mark}.querySelector('text') === null`), true);
    assert.equal(await run(`getComputedStyle(${mark}.querySelector('svg')).animationName`), 'status-spin');
    await run(`window.__loadingRing = ${mark}.querySelector('svg')`);
    await agent.broadcast();
    assert.equal(await run(`window.__loadingRing === ${mark}.querySelector('svg')`), true);
    await click('.close');
    assert.equal(await run(`${mark}.getAttribute('aria-busy')`), 'true');
    await run(`${mark}.click()`);
    await waitFor(async () => await run(`${panel}.querySelector('.analyze').disabled`));
    await click('.history-open');
    await waitFor(async () => await run(`${panel}.querySelector('.analysis-message').textContent.includes('正在分析')`));
    fs.appendFileSync(rendererFile, '\n// reload during background analysis\n');
    await waitFor(async () => await agent.updateRenderer(one) === 'updated');
    assert.equal(await run(`${panel}.querySelector('.history-view').hidden`), false);
    const task = store.analysisState(key).analysis.ledger.tasks[0];
    finishModel({ summary: '完成后的结果', tasks: [{ knownTaskId: task.id, title: longTitle, status: 'done', evidenceRefs: ['u1'] }], removedTaskIds: [] });
    await waitFor(() => store.analysisState(key).timeline.at(-1).status === 'completed');
    await waitFor(async () => !await run(`${panel}.querySelector('.analyze').disabled`));
    await waitFor(async () => await run(`${mark}.getAttribute('aria-busy')`) === 'false');
    assert.equal(await run(`${mark}.querySelector('svg.loading') === null`), true);
    await click('.back');
    assert.equal(await run(`${panel}.querySelector('.remaining-toggle').hidden`), true, 'Three remaining tasks need no expansion control');
    assert.equal(await run(`${panel}.querySelectorAll('.current-tasks .task-row').length`), 3);
    assert.equal(await run(`${panel}.querySelector('.history-open .row-detail').textContent`), '2 条 ›');
    let rejectModel;
    const failing = new Promise((resolve, reject) => { rejectModel = reject; }); agent.analysisService.run = () => failing;
    await click('.analyze'); await waitFor(() => store.analysisState(key).timeline.at(-1).status === 'pending');
    const originalHandle = agent.handleMessage.bind(agent); let dropped = false;
    agent.handleMessage = (session, payload) => { if (!dropped && JSON.parse(payload).type === 'analysis-state') { dropped = true; return Promise.resolve(); } return originalHandle(session, payload); };
    await waitFor(() => dropped);
    await waitFor(async () => await run(`${panel}.querySelector('.analysis-message').textContent.includes('状态查询暂时失败')`), 10000);
    rejectModel(new Error('模拟分析失败')); await click('.history-open');
    await waitFor(async () => await run(`${panel}.querySelector('.analysis-message').textContent.includes('模拟分析失败')`), 8000);
    agent.handleMessage = originalHandle;
    const expectedError = errors.findIndex(message => message.includes('模拟分析失败')); assert.ok(expectedError >= 0); errors.splice(expectedError, 1);
    await click('.back'); await openEdit();
    await run(`(()=>{const n=${panel}.querySelector('textarea');n.value='热更新未保存草稿';n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await number(43); const originalVersion = await run('window.__codexSessionStatus.status().version');
    const beforeReload = JSON.stringify(store.snapshot()); fs.appendFileSync(rendererFile, '\n// draft reload\n');
    fs.appendFileSync(harnessFile, '\nwindow.__fixtureHarnessVersion = 2;\n');
    await waitFor(async () => await agent.updateRenderer(one) === 'updated'); await agent.updateRenderer(two);
    assert.notEqual(await run('window.__codexSessionStatus.status().version'), originalVersion);
    assert.equal(await run(`${panel}.querySelector('textarea').value`), '热更新未保存草稿');
    assert.equal(await run(`${panel}.querySelector('.progress-number').value`), '43');
    assert.equal(await run(`${panel}.querySelector('.edit-view').hidden`), false);
    assert.equal(JSON.stringify(store.snapshot()), beforeReload);
    await waitFor(async () => await agent.updateRenderer(one) === 'current');
    assert.equal(await run('window.__fixtureHarnessVersion'), 2, 'Hot reload activates the new harness together with the renderer');
    const workingVersion = await run('window.__codexSessionStatus.status().version'), workingSource = fs.readFileSync(rendererFile, 'utf8');
    const installSignature = 'function installCodexSessionStatus(version, restored, embedded) {';
    assert.ok(workingSource.includes(installSignature), 'Failure injection must match the current installer');
    fs.writeFileSync(rendererFile, workingSource.replace(installSignature, installSignature + ' throw new Error("fixture install failure");'));
    assert.equal(await agent.updateRenderer(one), 'failed');
    assert.equal(await run('window.__codexSessionStatus.status().version'), workingVersion);
    assert.equal(await run(`${panel}.querySelector('textarea').value`), '热更新未保存草稿');
    assert.ok(errors.pop().includes('fixture install failure')); assert.deepEqual(errors, []);
    fs.writeFileSync(rendererFile, workingSource + '\n// recovery\n');
    await waitFor(async () => await agent.updateRenderer(one) === 'updated');
    await click('.cancel');
    await run(`(()=>{const row=document.querySelector('[data-app-action-sidebar-thread-row]');const clone=row.cloneNode(true);const host=clone.querySelector('[data-codex-session-status]');host.closest('.w-4').removeAttribute('style');host.remove();row.replaceWith(clone)})()`);
    await waitFor(async () => await run('document.querySelectorAll("[data-codex-session-status]").length') === 5);
    const navigation = await run(`(async () => {
      const row = document.querySelector('[data-app-action-sidebar-thread-row]');
      row.setAttribute('data-app-action-sidebar-thread-selected','true');
      const root = document.querySelector('main');
      const message = { textContent: '' }, quote = '两条消息都有相同内容，必须使用消息身份定位';
      let selected = null;
      for (const id of ['a','b']) {
        const node = document.createElement('div'); node.dataset.contentSearchUnitKey = 'source-' + id + ':answer-' + id;
        node.textContent = quote; node.scrollIntoView = () => { selected = id; }; root.append(node);
      }
      const entry = { row, threadId: row.getAttribute('data-app-action-sidebar-thread-id') };
      await window.__sessionStatusHarness.locate({ entry, source: { turnId:'source-b',itemId:'answer-b',locator:quote },analysisMessage:message });
      const exact = selected === 'b'; selected = null;
      await window.__sessionStatusHarness.locate({ entry, source: { turnId:'missing',itemId:'missing',locator:quote },analysisMessage:message });
      const ambiguousRejected = selected === null && message.textContent !== '已定位来源';
      const nav = document.createElement('button'); nav.dataset.threadUserMessageNavigationItemId = 'old:answer-old';
      nav.onclick = () => { const node=document.createElement('div');node.dataset.contentSearchUnitKey='old:answer-old';node.scrollIntoView=()=>{selected='old'};root.append(node); };root.append(nav);
      await window.__sessionStatusHarness.locate({entry, source:{turnId:'old',itemId:'answer-old',locator:'通过宿主导航加载更早的消息内容'},analysisMessage:message});
      return {exact,ambiguousRejected,olderLoaded:selected==='old'};
    })()`);
    assert.deepEqual(navigation, { exact: true, ambiguousRejected: true, olderLoaded: true });
    await run('window.__codexSessionStatus.destroy()');
    assert.equal((await one.evaluate('document.querySelectorAll("[data-codex-session-status], [data-codex-session-status-panel]").length')).result.value, 0);
    const diagnostics = fs.readFileSync(path.join(temporary, 'analysis.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(diagnostics.some(event => event.event === 'analysis.cancel'), false);
    assert.ok(diagnostics.some(event => event.event === 'panel.dispose'));
    assert.deepEqual(errors, []);
    await agent.updateRenderer(one);
    // Local /things is a UI action: no model turn or ledger write.
    await run(`(()=>{
      document.querySelectorAll('[data-app-action-sidebar-thread-row]').forEach((r,i)=>r.setAttribute('data-app-action-sidebar-thread-selected',String(i===0)));
      const root=document.createElement('div');root.dataset.codexComposerRoot='';root.style.minHeight='48px';document.querySelector('main').dataset.threadFindTarget='conversation';
      const editor=document.createElement('div');editor.contentEditable='true';root.append(editor);document.querySelector('main').append(root);
      editor.textContent='/things';editor.focus();editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    })()`);
    await waitFor(async()=>await run(`document.querySelectorAll('[data-agent-things-local-card]').length`)===1);
    assert.equal(await run(`document.querySelector('[data-codex-composer-root] [contenteditable]').textContent`),'');
    assert.equal(await run(`getComputedStyle(document.querySelector('[data-agent-things-local-card]').querySelector('[data-codex-session-status-panel]').shadowRoot.querySelector('.shell')).boxShadow`),'none');
    await run(`(()=>{const e=document.querySelector('[data-codex-composer-root] [contenteditable]');e.textContent='/things';e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})()`);
    assert.equal(await run(`document.querySelectorAll('[data-agent-things-local-card]').length`),1);
    const localPanel = `document.querySelector('[data-agent-things-local-card]').querySelector('[data-codex-session-status-panel]').shadowRoot`;
    await run(`(()=>{const r=${localPanel};r.querySelector('.edit-open').click();const n=r.querySelector('.progress-number');n.value='47';n.dispatchEvent(new Event('input',{bubbles:true}));r.querySelector('.save-record').click()})()`);
    await waitFor(async()=>store.snapshot().records[key]?.progress===47);
    store.update({key,expectedRevision:store.snapshot().records[key].revision,record:{state:'unfinished',progress:61,note:'external local card sync'}});await agent.broadcast();
    await waitFor(async()=>await run(`${localPanel}.querySelector('.progress-number')?.value`) === '61');
    assert.equal(await run(`(()=>{const e=document.querySelector('[data-codex-composer-root] [contenteditable]');e.textContent='/things hello';const k=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});e.dispatchEvent(k);return k.defaultPrevented})()`),false);
    assert.equal(await run(`document.querySelector('[data-codex-composer-root] [contenteditable]').textContent`),'/things hello');
    await run(`document.querySelector('[data-codex-composer-root] [contenteditable]').textContent=''`);
    await run(`(()=>{const r=document.querySelector('[data-agent-things-local-card]').querySelector('[data-codex-session-status-panel]').shadowRoot;r.querySelector('.edit-open').click();const t=r.querySelector('textarea');t.value='local card draft';t.dispatchEvent(new Event('input',{bubbles:true}));document.querySelectorAll('[data-app-action-sidebar-thread-row]').forEach(r=>r.setAttribute('data-app-action-sidebar-thread-selected','false'))})()`);
    await waitFor(async()=>await run(`document.querySelectorAll('[data-agent-things-local-card]').length`)===0);
    await run(`document.querySelector('[data-app-action-sidebar-thread-row]').setAttribute('data-app-action-sidebar-thread-selected','true')`);
    await waitFor(async()=>await run(`document.querySelectorAll('[data-agent-things-local-card]').length`)===1);
    assert.equal(await run(`document.querySelector('[data-agent-things-local-card]').querySelector('[data-codex-session-status-panel]').shadowRoot.querySelector('textarea').value`),'local card draft');
    await run(`document.querySelector('[data-codex-composer-root]').remove()`);
    if (process.env.AGENT_THINGS_CHECK_HOST !== 'codex') {
    const agyHarness = fs.readFileSync(path.join(root, 'src/harnesses/antigravity/antigravity-harness.js'), 'utf8');
    await run(`window.__agentThingsConnection = {origin:'http://127.0.0.1:1',token:'fixture'};` + agyHarness);
    await run(`(async()=>{
      const row=document.createElement('div');row.className='agy-sidebar-row';row.dataset.cascadeId='fixture';row.setAttribute('data-selected','true');document.body.append(row);
      const user=document.createElement('div');user.dataset.testid='user-input-step';user.textContent='这是对应回合中的原始用户提问';document.querySelector('main').append(user);
      const reply=document.createElement('p');reply.textContent='这条模型最终答复明确确认任务已经全部完成';reply.scrollIntoView=()=>{window.__locatedAssistant=true};document.querySelector('main').append(reply);
      const message={textContent:''};
      await window.__sessionStatusHarness.locate({entry:{threadId:'fixture',row},source:{turnId:'1',itemId:'a_2',locator:reply.textContent},analysisMessage:message});
      window.__sourceMessage=message.textContent;window.__sessionStatusHarness.dispose();
    })()`);
    assert.equal(await run('window.__locatedAssistant'), true, 'Antigravity locates the quoted final answer instead of the user card');
    assert.equal(await run('window.__sourceMessage'), '已定位来源');
    }
    fs.writeFileSync(path.join(output, 'panel-redesign-validation.json'), JSON.stringify({ fixture: true, nativeClientInjection: false,
      checks: 'passed', scope: process.env.AGENT_THINGS_CHECK_HOST || 'all', at: new Date().toISOString(), cases: ['explicit-save-cancel','five-node-snap-and-free-drag','manual-states','remote-gating',
      'source-time-layout','marquee','hover-mask','direct-history-tasks','source-navigation','cross-window','background-analysis-after-close',
      'lost-poll-recovery','draft-hot-reload','failed-render-rollback'] }, null, 2));
    console.log('PASS: production panel views, save/cancel, snap/free drag, history, marquee, source hover, persistence, analysis lifecycle and hot reload.');
  } finally {
    await agent.stop();
    chrome.kill('SIGTERM');
    await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve); });
    chrome.stderr.destroy();
    // Chrome helper processes can still be flushing the profile after the main process exits;
    // a leftover temporary folder must not turn a passed check into a failure.
    try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
    catch (error) { console.warn(`Could not remove temporary browser profile ${temporary}: ${error.message}`); }
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
