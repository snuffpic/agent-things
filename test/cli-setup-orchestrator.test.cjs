'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeConfig, readConfig, syncSkillFiles, syncAntigravityHooks } = require('../src/cli/setup-orchestrator.cjs');

test('writeConfig and readConfig roundtrip properly', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const sample = { lang: 'zh', enabledApps: ['codex', 'antigravity', 'claude', 'deepseek'], updatedAt: '2026-11-05T00:00:00.000Z' };
  writeConfig(sample, { file });
  const read = readConfig({ file });
  assert.equal(read.lang, 'zh');
  assert.deepEqual(read.enabledApps, ['codex', 'antigravity', 'claude', 'deepseek']);
});

test('syncSkillFiles writes skill to enabled apps including antigravity /things', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'status-skills-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const legacyCodex = path.join(home, '.codex/skills/agent-things/SKILL.md');
  const legacyAgy = path.join(home, '.gemini/config/skills/agent-things/SKILL.md');
  fs.mkdirSync(path.dirname(legacyCodex), { recursive: true });
  fs.mkdirSync(path.dirname(legacyAgy), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../skills/agent-things/SKILL.md'), legacyCodex);
  fs.copyFileSync(path.join(__dirname, '../skills/agent-things/SKILL.md'), legacyAgy);

  syncSkillFiles(['antigravity', 'codex', 'claude'], { homeDirectory: home });
  const antigravityThingsSkill = path.join(home, '.gemini/config/skills/things/SKILL.md');
  const antigravityChecklist = path.join(home, '.gemini/config/skills/things/checklist.md');
  const codexSkill = path.join(home, '.codex/skills/things/SKILL.md');
  const codexChecklist = path.join(path.dirname(codexSkill), 'checklist.md');
  const claudeSkill = path.join(home, '.claude/skills/agent-things/SKILL.md');

  assert.ok(fs.existsSync(antigravityThingsSkill), 'Antigravity /things slash command skill should exist');
  assert.ok(fs.existsSync(antigravityChecklist), 'Antigravity checklist should exist');
  assert.match(fs.readFileSync(antigravityThingsSkill, 'utf8'), /^---\nname: things\n/);
  assert.doesNotMatch(fs.readFileSync(antigravityChecklist, 'utf8'), /^---\nname:/);
  assert.match(fs.readFileSync(antigravityChecklist, 'utf8'), /update_session_tasks/);
  assert.match(fs.readFileSync(codexSkill, 'utf8'), /^---\nname: things\n/);
  assert.doesNotMatch(fs.readFileSync(codexChecklist, 'utf8'), /^---\nname:/);
  assert.match(fs.readFileSync(codexChecklist, 'utf8'), /update_session_tasks/);
  assert.match(fs.readFileSync(claudeSkill, 'utf8'), /user-invocable:\s*false/);
  assert.ok(!fs.existsSync(legacyCodex), 'Codex legacy agent-things should be unlinked');
  assert.ok(!fs.existsSync(legacyAgy), 'Antigravity legacy agent-things should be unlinked');

  // Disable antigravity and ensure skills are unlinked
  syncSkillFiles(['codex'], { homeDirectory: home });
  assert.ok(!fs.existsSync(antigravityThingsSkill), 'Antigravity /things skill should be removed');
  assert.ok(!fs.existsSync(antigravityChecklist), 'Antigravity checklist should be removed');
  assert.ok(!fs.existsSync(claudeSkill), 'Claude agent-things skill should be removed');
  syncSkillFiles([], { homeDirectory: home });
  assert.ok(!fs.existsSync(codexSkill));
  assert.ok(!fs.existsSync(codexChecklist));
});

test('syncAntigravityHooks installs, preserves foreign hooks and disables cleanly', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'status-hooks-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hooksFile = path.join(home, '.gemini/config/hooks.json');

  // Pre-seed an existing third-party hook
  fs.mkdirSync(path.dirname(hooksFile), { recursive: true });
  fs.writeFileSync(hooksFile, JSON.stringify({ 'other-guard': { enabled: true } }, null, 2));

  // Enable antigravity hooks
  syncAntigravityHooks(true, { homeDirectory: home });
  assert.ok(fs.existsSync(hooksFile));
  let parsed = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.ok(parsed['other-guard'], 'Third-party hook should be preserved');
  assert.ok(parsed['agent-things-instant-card'], 'Instant card hook should be installed');
  assert.equal(parsed['agent-things-instant-card'].enabled, true);
  assert.equal(parsed['agent-things-instant-card'].PreInvocation[0].type, 'command');

  // Disable antigravity hooks
  syncAntigravityHooks(false, { homeDirectory: home });
  parsed = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.ok(parsed['other-guard'], 'Third-party hook should still be preserved');
  assert.equal(parsed['agent-things-instant-card'], undefined, 'Instant card hook should be removed');
});

test('setup-antigravity-service install configures --watch-startup, Interactive ProcessType, and autostart.json', async t => {
  const vm = require('node:vm');
  const root = path.resolve(__dirname, '..');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-svc-data-'));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-svc-log-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });
  const written = [];
  const mockedLaunchd = {
    bootout: async label => written.push(['bootout', label]),
    writePlist: (plist, plistPath) => written.push(['writePlist', plist, plistPath]),
    bootstrap: plistPath => written.push(['bootstrap', plistPath]),
  };
  const mod = { exports: {} };
  const file = path.join(root, 'scripts/setup-antigravity-service.cjs');
  const source = fs.readFileSync(file, 'utf8').replace(/^#!.*\n/, '');
  const req = id => (id === '../src/launchd.cjs' ? mockedLaunchd : require(id.startsWith('.') ? path.resolve(path.dirname(file), id) : id));
  vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + source + '\n})')(req, mod, mod.exports, file, path.dirname(file));
  await mod.exports.install({ root, dataDir, logDir });

  assert.equal(fs.existsSync(path.join(dataDir, 'bridge')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(logDir, 'autostart.json'), 'utf8')), {
    app: '/Applications/Antigravity.app',
    port: 29222,
    allowClientRestart: true,
  });
  const writeCall = written.find(([op]) => op === 'writePlist');
  assert.ok(writeCall, 'writePlist should be called');
  const [, plist] = writeCall;
  assert.equal(plist.Label, 'com.antigravity.session-status');
  assert.equal(plist.ProcessType, 'Interactive');
  assert.deepEqual(plist.ProgramArguments.slice(1), [path.join(root, 'bin/antigravity-session-status.cjs'), '--daemon', '--watch-startup']);
});
