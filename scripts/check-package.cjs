'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-things-package-'));
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }));
  const names = new Set(pack.files.map(file => file.path));
  for (const name of names) assert.ok(!name.startsWith('docs/') && !/\.bak(?:_|$)/.test(name) && name !== 'MANUAL-STATUS.md', `Unexpected local material: ${name}`);
  for (const name of [
    'skills/things/SKILL.md',
    'skills/agent-things/SKILL.md',
    'src/ui-foundation.cjs',
    'mods/agent-things-ui/hooks/foundation.js',
    'src/plugins/things/plugin.json',
    'src/plugins/things/sidecars/things_board/index.html',
    'packages/dsh-agent-things/package.json',
    'packages/dsh-agent-things/README.md',
    'packages/dsh-agent-things/icon.svg',
    'packages/dsh-agent-things/cordis.patch.yml',
    'packages/dsh-agent-things/locale/en.json',
    'packages/dsh-agent-things/locale/zh.json',
    'packages/dsh-agent-things/docs/DETAIL.md',
    'packages/dsh-agent-things/docs/DETAIL.zh.md',
    'packages/dsh-agent-things/lib/index.js',
    'packages/dsh-agent-things/lib/client.js',
    'packages/dsh-agent-things/bin/dsh-mcp.cjs',
  ]) assert.ok(names.has(name), `Missing runtime file: ${name}`);
  execFileSync('tar', ['-xzf', path.join(temp, pack.filename), '-C', temp]);
  const unpacked = path.join(temp, 'package');
  const pkg = JSON.parse(fs.readFileSync(path.join(unpacked, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'agent-things');
  assert.ok(!pkg.private);
  const dshBundlePkg = JSON.parse(fs.readFileSync(path.join(unpacked, 'packages/dsh-agent-things/package.json'), 'utf8'));
  assert.equal(dshBundlePkg.version, pkg.version, 'DSH bundle version must match root package.json');
  for (const name of ['native/bin/bridge', 'native/bin/bridge.json', 'src/native-bridge.cjs']) assert.ok(names.has(name), `Missing native startup component: ${name}`);
  const bridge = require(path.join(unpacked, 'src/native-bridge.cjs')).verifyBridgeBundle(unpacked);
  execFileSync('/usr/bin/lipo', [bridge, '-verify_arch', 'arm64', 'x86_64'], { stdio: 'pipe' });
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', bridge], { stdio: 'pipe' });
  assert.equal(JSON.parse(execFileSync(bridge, ['version'], { encoding: 'utf8', timeout: 5000 })).protocol, 1);
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!pkg.scripts?.[name], `Unexpected lifecycle hook: ${name}`);
  const cli = path.join(unpacked, pkg.bin['agent-things']);
  assert.ok(fs.statSync(cli).mode & 0o111, 'CLI must be executable');
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /agent-things|codex-session-status/);
  execFileSync(process.execPath, ['--test', path.join(root, 'test/install-lifecycle.test.cjs')], { env: { ...process.env, AGENT_THINGS_INSTALL_ROOT: unpacked }, stdio: 'pipe', timeout: 60000 });
  execFileSync(process.execPath, [path.join(root, 'scripts/check-cli.cjs')], { env: { ...process.env, AGENT_THINGS_AUDIT_ROOT: unpacked }, stdio: 'pipe', timeout: 30000 });
  console.log(`Package OK: ${pack.filename}, ${names.size} files, ${pack.size} bytes`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
