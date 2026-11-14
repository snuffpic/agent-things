'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { detectCodexGit } = require('../src/harnesses/codex/codex-git.cjs');

test('detectCodexGit handles missing cwd, non-git cwd, and git repos with/without remote', async t => {
  // 1. 无 cwd 或 cwd 为空
  const emptyRes = await detectCodexGit(async () => ({ thread: { cwd: '' } }), 'thread-1');
  assert.equal(emptyRes.status, 'checked');
  assert.equal(emptyRes.hasRepository, false);
  assert.equal(emptyRes.hasRemote, false);

  // 2. 普通临时文件夹（非 Git）
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-git-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const nonGitRes = await detectCodexGit(async () => ({ thread: { cwd: tempDir } }), 'thread-2');
  assert.equal(nonGitRes.hasRepository, false);
  assert.equal(nonGitRes.hasRemote, false);

  // 3. 初始化 Git 但未配置 remote
  const git = args => execFileSync('git', ['-C', tempDir, ...args], { stdio: 'pipe' });
  git(['init']);
  const noRemoteRes = await detectCodexGit(async () => ({ thread: { cwd: tempDir } }), 'thread-3');
  assert.equal(noRemoteRes.hasRepository, true);
  assert.equal(noRemoteRes.hasRemote, false);

  // 4. 配置 remote 后
  git(['remote', 'add', 'origin', 'https://github.com/example/repo.git']);
  const remoteRes = await detectCodexGit(async () => ({ thread: { cwd: tempDir } }), 'thread-4');
  assert.equal(remoteRes.hasRepository, true);
  assert.equal(remoteRes.hasRemote, true);

  // 5. 异常情况回退
  const failRes = await detectCodexGit(async () => { throw new Error('app server down'); }, 'thread-5');
  assert.equal(failRes.status, 'unknown');
  assert.equal(failRes.hasRemote, false);
});
