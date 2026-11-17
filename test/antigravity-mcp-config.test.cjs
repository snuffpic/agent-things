'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installAntigravityMcp, disableAntigravityMcp } = require('../src/antigravity-mcp-config.cjs');
test('Antigravity installation updates its entry, keeps other servers and uninstall removes only owned entries', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ other: true, mcpServers: { unrelated: { command: 'keep' }, 'session-status': { command: 'node', args: ['/old/antigravity-session-status.cjs'] } } }));
  installAntigravityMcp({ file, scriptPath: '/new/antigravity-session-status.cjs' });
  let config = JSON.parse(fs.readFileSync(file));
  assert.equal(Object.keys(config.mcpServers).length, 2);
  assert.deepEqual(config.mcpServers['session-status'].args, ['/new/antigravity-session-status.cjs']);
  assert.equal(config.mcpServers['session-status'].tools.render_things_card.eager, true);
  disableAntigravityMcp({ file });
  config = JSON.parse(fs.readFileSync(file));
  assert.deepEqual(config, { other: true, mcpServers: { unrelated: { command: 'keep' } } });
  fs.writeFileSync(file, '{bad');
  assert.throws(() => installAntigravityMcp({ file, scriptPath: '/new/antigravity-session-status.cjs' }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
});

test('Antigravity installation syncs unified config/mcp_config.json only when present and enables eager render_things_card', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const legacyFile = path.join(home, '.gemini/antigravity/mcp_config.json');
  const unifiedFile = path.join(home, '.gemini/config/mcp_config.json');

  // 1. Without unified config present, only legacy file is created/updated
  installAntigravityMcp({ homeDirectory: home, scriptPath: '/runtime/bin/antigravity-session-status.cjs' });
  assert.equal(fs.existsSync(legacyFile), true);
  assert.equal(fs.existsSync(unifiedFile), false);
  const legacyOnly = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  assert.equal(legacyOnly.mcpServers.session_status.tools.render_things_card.eager, true);

  // 2. When unified config exists (with older session-status path & extra tools), both files stay synced
  fs.mkdirSync(path.dirname(unifiedFile), { recursive: true });
  fs.writeFileSync(unifiedFile, JSON.stringify({
    mcpServers: {
      unrelated: { command: 'npx' },
      'session-status': {
        command: 'node',
        args: ['/old-repo/bin/antigravity-session-status.cjs'],
        tools: { get_session_progress: { eager: false } },
      },
    },
  }));

  installAntigravityMcp({ homeDirectory: home, scriptPath: '/runtime/bin/antigravity-session-status.cjs' });
  const unified = JSON.parse(fs.readFileSync(unifiedFile, 'utf8'));
  assert.equal(unified.mcpServers.unrelated.command, 'npx');
  assert.deepEqual(unified.mcpServers['session-status'].args, ['/runtime/bin/antigravity-session-status.cjs']);
  assert.equal(unified.mcpServers['session-status'].tools.get_session_progress.eager, false);
  assert.equal(unified.mcpServers['session-status'].tools.render_things_card.eager, true);

  // 3. Disable removes owned entries from both files while keeping unrelated entries intact
  disableAntigravityMcp({ homeDirectory: home });
  assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')).mcpServers, {});
  assert.deepEqual(JSON.parse(fs.readFileSync(unifiedFile, 'utf8')).mcpServers, { unrelated: { command: 'npx' } });
});
