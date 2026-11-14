'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');
const { detectAntigravityGit } = require('../src/harnesses/antigravity/antigravity-git.cjs');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');

test('antigravity-git: detects git repository with remote from project database', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-git-test-'));
  const dbPath = path.join(tempDir, 'conversation_summaries.db');
  const threadId = 'test-git-session-1';
  const repoDir = path.join(tempDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  execSync('git init', { cwd: repoDir, stdio: 'ignore' });
  execSync('git remote add origin https://example.com/repo.git', { cwd: repoDir, stdio: 'ignore' });

  // 初始化测试 sqlite db
  const { pathToFileURL } = require('node:url');
  const repoUri = pathToFileURL(repoDir).href;
  execSync(`sqlite3 "${dbPath}" 'CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, project_id text, workspace_uris text);'`);
  execSync(`sqlite3 "${dbPath}" "INSERT INTO conversation_summaries VALUES ('${threadId}', 'proj-123', '[\\"${repoUri}\\"]');"`);

  const res = await detectAntigravityGit(threadId, { dbPath });
  assert.equal(res.status, 'checked');
  assert.equal(res.hasRepository, true);
  assert.equal(res.hasRemote, true);
  assert.equal(res.detectedPath, repoDir);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('antigravity-git: defaults to hasRemote false when session is outside-of-project', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-git-test-'));
  const dbPath = path.join(tempDir, 'conversation_summaries.db');
  const threadId = 'test-plain-session-2';

  // 模拟 outside-of-project 的普通会话
  execSync(`sqlite3 "${dbPath}" 'CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, project_id text, workspace_uris text);'`);
  execSync(`sqlite3 "${dbPath}" "INSERT INTO conversation_summaries VALUES ('${threadId}', 'outside-of-project', '');"`);

  const res = await detectAntigravityGit(threadId, { dbPath });
  assert.equal(res.status, 'checked');
  assert.equal(res.hasRepository, false);
  assert.equal(res.hasRemote, false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('antigravity-git: defaults to hasRemote false when session declares no active workspace', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-git-test-'));
  const threadId = 'test-no-ws-session';
  const brainDir = path.join(tempDir, threadId, '.system_generated', 'logs');
  fs.mkdirSync(brainDir, { recursive: true });

  fs.writeFileSync(
    path.join(brainDir, 'transcript.jsonl'),
    JSON.stringify({ content: '<user_information>\nThe user does not have any active workspace.\n</user_information>' }) + '\n',
    'utf8'
  );

  const res = await detectAntigravityGit(threadId, { dbPath: '/nonexistent.db', brainDir: tempDir });
  assert.equal(res.status, 'checked');
  assert.equal(res.hasRemote, false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
