'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

test('codex-session-status mcp server lifecycle & tools', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-test-'));
  const scriptPath = path.join(__dirname, '..', 'bin', 'codex-session-status.cjs');

  const child = spawn(process.execPath, [scriptPath, 'mcp', '--data-dir', tmpDir, '--port', '39999'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = [];
  let buffer = '';

  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        responses.push(JSON.parse(line));
      } catch {}
    }
  });

  const waitForResponse = async (id, timeout = 3000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const found = responses.find(r => r.id === id);
      if (found) return found;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for response id: ${id}`);
  };

  try {
    // 1. initialize
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    }) + '\n');

    const initRes = await waitForResponse(0, 10000);
    assert.equal(initRes.result.serverInfo.name, 'codex-session-status');

    // 2. tools/list
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n');

    const toolsRes = await waitForResponse(2);
    const toolNames = toolsRes.result.tools.map(t => t.name);
    assert.ok(toolNames.includes('update_session_progress'));
    assert.ok(toolNames.includes('get_session_progress'));
    assert.ok(toolNames.includes('list_all_session_statuses'));

    // 3. update_session_progress
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'update_session_progress',
        arguments: {
          conversation_id: 'conv-test-1',
          state: 'unfinished',
          progress: 45,
          note: '正在重构 MCP 伴生层',
        },
      },
    }) + '\n');

    const updateRes = await waitForResponse(3);
    assert.equal(JSON.parse(updateRes.result.content[0].text).progress, 45);

    // 4. get_session_progress
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'get_session_progress',
        arguments: { conversation_id: 'conv-test-1' },
      },
    }) + '\n');

    const getRes = await waitForResponse(4);
    const parsedRecord = JSON.parse(getRes.result.content[0].text);
    assert.equal(parsedRecord.progress, 45);
    assert.equal(parsedRecord.state, 'unfinished');

    // 5. list_all_session_statuses with current_project (default)
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'list_all_session_statuses',
        arguments: { scope: 'current_project', current_session_id: 'conv-test-1' },
      },
    }) + '\n');

    const listRes = await waitForResponse(5);
    const listData = JSON.parse(listRes.result.content[0].text);
    assert.equal(listData.scope, 'current_project');
    assert.equal(listData.returnedCount, 1);
    assert.equal(listData.sessions[0].threadId, 'conv-test-1');

    // 6. list_all_session_statuses with recent_25
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'list_all_session_statuses',
        arguments: { scope: 'recent_25' },
      },
    }) + '\n');

    const recentRes = await waitForResponse(6);
    const recentData = JSON.parse(recentRes.result.content[0].text);
    assert.equal(recentData.scope, 'recent_25');
    assert.equal(recentData.returnedCount, 1);

    // 7. list_all_session_statuses with all_projects
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'list_all_session_statuses',
        arguments: { scope: 'all_projects' },
      },
    }) + '\n');

    const allRes = await waitForResponse(7);
    const allData = JSON.parse(allRes.result.content[0].text);
    assert.equal(allData.scope, 'all_projects');
    assert.ok(Array.isArray(allData.projects));

    let serial = 7;
    const request = (method, params) => {
      const id = ++serial;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return waitForResponse(id);
    };
    const openTool = toolsRes.result.tools.find(tool => tool.name === 'open_session_card');
    const uri = openTool._meta.ui.resourceUri;
    assert.deepEqual(openTool._meta.ui.visibility, ['model']);
    assert.deepEqual(toolsRes.result.tools.find(tool => tool.name === 'change_session_card')._meta.ui.visibility, ['app']);
    const listed = await request('resources/list', {});
    assert.equal(listed.result.resources[0].uri, uri);
    const resource = await request('resources/read', { uri });
    assert.equal(resource.result.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(resource.result.contents[0].text, /installCodexSessionStatus/);

    const conversation_id = '11111111-2222-4333-8444-555555555555';
    const rawCardCall = async (name, args, _meta) => (await request('tools/call', { name, arguments: args, _meta })).result;
    const opening = await rawCardCall('open_session_card', { title: '进度测试' }, { thread_id: conversation_id });
    const open = opening.structuredContent;
    const card_token = opening._meta.cardToken;
    assert.match(card_token, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(open, 'cardToken'), false);
    const callCard = (name, args, meta) => rawCardCall(name, name === 'open_session_card' ? args : { card_token, ...args }, meta);
    const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    assert.equal((await rawCardCall('read_session_card', { conversation_id, action: 'watch-state' })).isError, true);
    assert.equal((await callCard('read_session_card', { conversation_id: otherId, action: 'analysis-state' })).isError, true);
    const otherWrite = { conversation_id: otherId, action: 'update', expectedRevision: 0, record: { state: 'unfinished', progress: 70, note: '' } };
    assert.equal((await rawCardCall('change_session_card', otherWrite)).isError, true);
    assert.equal((await callCard('change_session_card', otherWrite)).isError, true);
    assert.equal(open.conversationId, conversation_id);
    assert.deepEqual(open.snapshot.records, {});
    const update = (expectedRevision, record) => callCard('change_session_card', { conversation_id, action: 'update', expectedRevision, record });
    const watch = async cursor => {
      const result = await callCard('read_session_card', { conversation_id, action: 'watch-state', cursor });
      assert.equal(result.isError, undefined);
      return result.structuredContent;
    };
    const initial = await watch();
    assert.match(initial.cursor, /^[a-f0-9]{64}$/);
    assert.deepEqual(initial.snapshot.records, {});
    let delivered = false;
    const pendingChange = watch(initial.cursor).then(value => { delivered = true; return value; });
    const { ManualStatusStore } = require('../src/manual-status-store.cjs');
    const state = new ManualStatusStore(path.join(tmpDir, 'manual-state.json'));
    const other = state.resolveKey(otherId);
    const { createCodexCard } = require('../src/harnesses/codex/codex-card.cjs');
    const restarted = createCodexCard({ store: state });
    assert.deepEqual((await restarted.call('read_session_card', { conversation_id, card_token, action: 'analysis-state' })).structuredContent.snapshot.records, {});
    const externalRecord = { state: 'unfinished', progress: 35, note: '侧栏已保存' };
    state.update({ key: other, expectedRevision: 0, record: externalRecord });
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(delivered, false);
    // A held watch request must leave the MCP channel available for other operations.
    const read = await callCard('read_session_card', { conversation_id, action: 'analysis-state' });
    assert.deepEqual(read.structuredContent.snapshot.records, {});
    state.update({ key: open.key, expectedRevision: 0, record: externalRecord });
    const changed = await pendingChange;
    assert.notEqual(changed.cursor, initial.cursor);
    assert.deepEqual(Object.keys(changed.snapshot.records), [open.key]);
    assert.equal(changed.snapshot.records[open.key].progress, 35);
    assert.equal(changed.analysisState.timeline.length, 1);
    assert.deepEqual(await watch(initial.cursor), changed);

    const record = { state: 'unfinished', progress: 60, note: '新记录' };
    const current = (await callCard('read_session_card', { conversation_id, action: 'analysis-state' })).structuredContent;
    const saved = (await update(current.snapshot.records[open.key].revision, record)).structuredContent.snapshot.records[open.key];
    assert.equal(saved.progress, 60);
    const conflict = await update(0, { ...record, progress: 20 });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.snapshot.records[open.key].progress, 60);
    const refreshed = (await callCard('read_session_card', { conversation_id, action: 'analysis-state' })).structuredContent;
    assert.equal(refreshed.snapshot.records[open.key].note, '新记录');
    assert.equal(refreshed.analysisState.timeline.length, 2);
    assert.equal((await callCard('open_session_card', { conversation_id }, { thread_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).isError, true);
    assert.equal((await update(saved.revision, null)).structuredContent.snapshot.records[open.key].state, null);

    const cleared = await watch();
    const stillWaiting = callCard('read_session_card', { conversation_id, action: 'watch-state', cursor: cleared.cursor });
    // 8. close stdin pipe, verifying clean shutdown with a pending watch
    const exitPromise = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    child.stdin.end();
    const exitResult = await Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Process failed to exit on stdin close')), 3000)),
    ]);
    assert.equal(exitResult.code, 0);
    assert.equal((await stillWaiting).structuredContent.errorInfo.code, 'REQUEST_CANCELLED');
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
