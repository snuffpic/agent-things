'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { resolveAntigravityTitle } = require('../src/harnesses/antigravity/antigravity-title.cjs');
const { AntigravityService } = require('../src/harnesses/antigravity/antigravity-service.cjs');
const { processHookInput } = require('../src/antigravity-hook.cjs');

function createMockSummaryDb(dbPath, rows = []) {
  execFileSync('sqlite3', [
    dbPath,
    'CREATE TABLE conversation_summaries (conversation_id text PRIMARY KEY, title text, preview text, project_id text, workspace_uris text);',
  ]);
  for (const r of rows) {
    const id = String(r.conversation_id).replace(/'/g, "''");
    const title = String(r.title || '').replace(/'/g, "''");
    const preview = String(r.preview || '').replace(/'/g, "''");
    execFileSync('sqlite3', [
      dbPath,
      `INSERT INTO conversation_summaries VALUES ('${id}', '${title}', '${preview}', 'outside-of-project', '');`,
    ]);
  }
}

test('resolveAntigravityTitle reads title from db, falls back to transcript and default', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-title-test-'));
  try {
    const dbPath = path.join(tmpDir, 'conversation_summaries.db');
    const brainDir = path.join(tmpDir, 'brain');
    createMockSummaryDb(dbPath, [
      { conversation_id: 'conv-music', title: 'AI Music Prompt Generation From MP3', preview: '' },
      { conversation_id: 'conv-preview', title: '', preview: 'Preview Based Title' },
    ]);

    assert.equal(
      resolveAntigravityTitle('conv-music', { dbPath, brainDir, cache: false }),
      'AI Music Prompt Generation From MP3',
    );
    assert.equal(
      resolveAntigravityTitle(JSON.stringify(['local', 'conv-preview']), { dbPath, brainDir, cache: false }),
      'Preview Based Title',
    );

    // 仅存在 transcript.jsonl 时从首条非 /things 用户输入提取
    const logsDir = path.join(brainDir, 'conv-transcript', '.system_generated', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(logsDir + '/transcript.jsonl', [
      JSON.stringify({ type: 'USER_INPUT', content: '<USER_REQUEST>\n/things\n</USER_REQUEST>' }),
      JSON.stringify({ type: 'USER_INPUT', content: '<USER_REQUEST>\n分析微信缓存数据库结构与索引\n</USER_REQUEST>' }),
    ].join('\n') + '\n');

    assert.equal(
      resolveAntigravityTitle('conv-transcript', { dbPath, brainDir, cache: false }),
      '分析微信缓存数据库结构与索引',
    );
    assert.equal(
      resolveAntigravityTitle('conv-missing', { dbPath, brainDir, fallback: '当前会话', cache: false }),
      '当前会话',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AntigravityService snapshot & render_things_card carry real conversation title', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-service-title-'));
  const dbPath = path.join(tmpDir, 'conversation_summaries.db');
  const brainDir = path.join(tmpDir, 'brain');
  const convId = 'e70bdcf9-251f-4a62-9093-1c806c203678';
  createMockSummaryDb(dbPath, [
    { conversation_id: convId, title: 'AI Music Prompt Generation From MP3' },
  ]);

  const service = new AntigravityService({
    port: 0,
    stateFile: path.join(tmpDir, 'state.json'),
    brainDir,
    dbPath,
  });

  try {
    const port = await service.start();
    const token = service.http.credentials.token;

    // 1. Snapshot includes resolved title
    const snap = service.getSessionSnapshot(convId);
    assert.equal(snap.title, 'AI Music Prompt Generation From MP3');

    // 2. render_things_card writes real title into things-card.html
    const toolRes = await fetch(`http://127.0.0.1:${port}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'render_things_card',
        args: { conversation_id: convId, artifact_dir: path.join(brainDir, convId) },
      }),
    });
    assert.equal(toolRes.status, 200);
    const html = fs.readFileSync(path.join(brainDir, convId, 'things-card.html'), 'utf8');
    assert.ok(html.includes('AI Music Prompt Generation From MP3'));
    assert.ok(!html.includes('<h2 class="title" id="cardTitle" title="Agent Things 会话任务进度">Agent Things 会话任务进度</h2>'));
  } finally {
    await service.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('antigravity-hook uses resolved title from ANTIGRAVITY_SUMMARY_DB', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hook-title-'));
  const prevEnv = process.env.ANTIGRAVITY_SUMMARY_DB;
  try {
    const dbPath = path.join(tmpDir, 'conversation_summaries.db');
    const convId = 'conv-real-hook';
    const artifactDir = path.join(tmpDir, convId);
    fs.mkdirSync(artifactDir, { recursive: true });
    createMockSummaryDb(dbPath, [
      { conversation_id: convId, title: '真实会话标题测试' },
    ]);
    process.env.ANTIGRAVITY_SUMMARY_DB = dbPath;

    processHookInput(JSON.stringify({
      lastUserInput: '/things',
      conversationId: convId,
      artifactDirectoryPath: artifactDir,
    }));

    const html = fs.readFileSync(path.join(artifactDir, 'things-card.html'), 'utf8');
    assert.ok(html.includes('真实会话标题测试'));
    assert.ok(!html.includes('Agent Things 会话任务进度'));
  } finally {
    if (prevEnv === undefined) delete process.env.ANTIGRAVITY_SUMMARY_DB;
    else process.env.ANTIGRAVITY_SUMMARY_DB = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('things_board main.mjs & index.html remove hardcoded Agent Things title and handle empty/changed session titles', () => {
  const mainSrc = fs.readFileSync(path.resolve(__dirname, '../src/plugins/things/sidecars/things_board/main.mjs'), 'utf8');
  const htmlSrc = fs.readFileSync(path.resolve(__dirname, '../src/plugins/things/sidecars/things_board/index.html'), 'utf8');
  assert.ok(mainSrc.includes('resolveConversationTitle'));
  assert.ok(mainSrc.includes('title: session?.title || resolveConversationTitle(convId) || null') || mainSrc.includes('resolveConversationTitle(convId)'));
  assert.ok(!/<h2[^>]*id="cardTitle"[^>]*>Agent Things 会话任务进度<\/h2>/.test(htmlSrc));
  assert.ok(!htmlSrc.includes('"title":"Agent Things 会话任务进度"'));
  assert.ok(htmlSrc.includes('applyCardTitle('));
  assert.ok(htmlSrc.includes('resetToEmptySession(data?.title)'));
});
