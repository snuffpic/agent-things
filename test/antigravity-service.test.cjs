'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');

test('AntigravityService serves snapshot and handles rpc updates', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-service-test-'));
  const stateFile = path.join(tmpDir, 'state.json');

  const mockRun = async () => ({
    summary: '测试分析完成',
    gitPush: { status: 'pushed', evidenceRefs: [] },
    tasks: [],
    removedTaskIds: [],
  });

  const service = new AntigravityService({
    port: 0, // random available port
    stateFile,
    run: mockRun,
  });

  try {
    const port = await service.start();
    assert.ok(port > 0);

    // 1. Check /snapshot
    const snapRes = await fetch(`http://127.0.0.1:${port}/snapshot`, { headers: { Authorization: `Bearer ${service.http.credentials.token}` } });
    assert.equal(snapRes.status, 200);
    const snapData = await snapRes.json();
    assert.ok(snapData.snapshot);
    assert.equal(typeof snapData.snapshot.revision, 'number');

    // 2. Test /rpc update
    const testKey = JSON.stringify(['local', 'test-thread-id']);
    const updateMsg = {
      requestId: 'req-1',
      type: 'update',
      key: testKey,
      expectedRevision: 0,
      record: {
        state: 'unfinished',
        progress: 85,
        note: '测试备注',
      },
    };

    const rpcRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
      body: JSON.stringify(updateMsg),
    });
    assert.equal(rpcRes.status, 200);
    const rpcReply = await rpcRes.json();
    assert.equal(rpcReply.requestId, 'req-1');
    assert.equal(rpcReply.error, null);
    assert.equal(rpcReply.snapshot.records[testKey].progress, 85);
    assert.equal(rpcReply.snapshot.records[testKey].state, 'unfinished');

    // 3. Test /rpc project-git (默认独立会话无 Git 信息时返回 false)
    const gitRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.http.credentials.token}` },
      body: JSON.stringify({ requestId: 'req-2', type: 'project-git', key: testKey }),
    });
    const gitReply = await gitRes.json();
    assert.equal(gitReply.requestId, 'req-2');
    assert.equal(gitReply.projectGit.hasRemote, false);

    // 4. Test /rpc project-git (当会话关联项目工作区且有远端时返回 true)
    const { execSync } = require('node:child_process');
    const { pathToFileURL } = require('node:url');
    const mockDbPath = path.join(tmpDir, 'conversation_summaries.db');
    const gitThreadId = 'test-git-thread';
    const gitKey = JSON.stringify(['local', gitThreadId]);
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(repoDir, { recursive: true });
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git remote add origin https://example.com/repo.git', { cwd: repoDir, stdio: 'ignore' });
    const repoUri = pathToFileURL(repoDir).href;
    execSync(`sqlite3 "${mockDbPath}" 'CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, project_id text, workspace_uris text);'`);
    execSync(`sqlite3 "${mockDbPath}" "INSERT INTO conversation_summaries VALUES ('${gitThreadId}', 'proj-1', '[\\"${repoUri}\\"]');"`);

    const gitService = new AntigravityService({
      port: 0,
      stateFile: path.join(tmpDir, 'state2.json'),
      brainDir: tmpDir,
      dbPath: mockDbPath,
    });
    const gitPort = await gitService.start();
    try {
      const gitRes2 = await fetch(`http://127.0.0.1:${gitPort}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${gitService.http.credentials.token}` },
        body: JSON.stringify({ requestId: 'req-3', type: 'project-git', key: gitKey }),
      });
      const gitReply2 = await gitRes2.json();
      assert.equal(gitReply2.requestId, 'req-3');
      assert.equal(gitReply2.projectGit.hasRemote, true);
    } finally {
      await gitService.stop();
    }

  } finally {
    await service.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
