'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('antigravity-session-status runs as MCP stdio server with tools', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'status-agy-mcp-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = path.join(__dirname, '..', 'bin', 'antigravity-session-status.cjs');
  const child = spawn(process.execPath, [script, '--no-ui'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, SESSION_STATUS_PORT: '0', SESSION_STATUS_STATE_FILE: path.join(directory, 'state.json') },
  });

  const send = (msg) => {
    child.stdin.write(JSON.stringify(msg) + '\n');
  };

  const readLine = () =>
    new Promise(resolve => {
      let buffer = '';
      const onData = chunk => {
        buffer += chunk.toString();
        const idx = buffer.indexOf('\n');
        if (idx !== -1) {
          child.stdout.removeListener('data', onData);
          resolve(JSON.parse(buffer.slice(0, idx)));
        }
      };
      child.stdout.on('data', onData);
    });

  try {
    // 1. initialize
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initRes = await readLine();
    assert.equal(initRes.id, 1);
    assert.ok(initRes.result.capabilities.tools);

    // 2. tools/list
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listRes = await readLine();
    assert.equal(listRes.id, 2);
    const names = listRes.result.tools.map(t => t.name);
    assert.ok(names.includes('update_session_progress'));
    assert.ok(names.includes('get_session_progress'));
    assert.ok(names.includes('list_all_session_statuses'));
    assert.ok(names.includes('render_things_card'));

    // 3. tools/call update_session_progress
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'update_session_progress',
        arguments: {
          conversation_id: 'test-mcp-cid',
          state: 'unfinished',
          progress: 60,
          note: '通过 MCP 自动记录进度',
        },
      },
    });
    const callRes = await readLine();
    assert.equal(callRes.id, 3);
    assert.equal(JSON.parse(callRes.result.content[0].text).progress, 60);

    // 4. tools/call list_all_session_statuses
    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'list_all_session_statuses',
        arguments: { scope: 'current_project', current_session_id: 'test-mcp-cid' },
      },
    });
    const listCallRes = await readLine();
    assert.equal(listCallRes.id, 4);
    const parsedData = JSON.parse(listCallRes.result.content[0].text);
    assert.equal(parsedData.scope, 'current_project');
    assert.ok(parsedData.returnedCount >= 1);

    // 5. tools/call render_things_card for existing session
    send({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'render_things_card',
        arguments: { conversation_id: 'test-mcp-cid', artifact_dir: directory },
      },
    });
    const cardCallRes = await readLine();
    assert.equal(cardCallRes.id, 5);
    const cardData = JSON.parse(cardCallRes.result.content[0].text);
    assert.ok(cardData.artifact_path);
    assert.ok(cardData.embed_tag);
    assert.ok(cardData.user_markdown.includes('60%'));

    // 6. tools/call render_things_card for fresh empty session (zero analysis, zero task write)
    send({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'render_things_card',
        arguments: { conversation_id: 'fresh-blank-session', artifact_dir: directory },
      },
    });
    const blankCardRes = await readLine();
    assert.equal(blankCardRes.id, 6);
    const blankCardData = JSON.parse(blankCardRes.result.content[0].text);
    assert.equal(blankCardData.state, 'unstarted');
    assert.equal(blankCardData.progress, null);
    assert.equal(blankCardData.summary, '尚未记录进展');
    assert.ok(blankCardData.user_markdown.includes('尚未记录进展'));

    // 7. close stdin, verifying clean shutdown
    const exitPromise = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    child.stdin.end();
    const exitResult = await Promise.race([
      exitPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Process failed to exit on stdin close')), 3000)),
    ]);
    assert.equal(exitResult.code, 0);
  } finally {
    if (!child.killed) child.kill('SIGTERM');
  }
});
