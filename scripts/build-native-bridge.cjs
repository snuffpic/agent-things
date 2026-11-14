'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { verifyBridgeBundle } = require('../src/native-bridge.cjs');

function buildNativeBridge() {
  if (process.platform !== 'darwin') throw new Error('请在 macOS 上构建启动桥，需要 Xcode Command Line Tools');
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'native/session-status-bridge.swift');
  // Keep the exact signed executable when the source has not changed. Its code
  // identity is also the user's macOS Accessibility permission identity.
  try {
    const existing = verifyBridgeBundle(root);
    execFileSync('/usr/bin/xcrun', ['lipo', existing, '-verify_arch', 'arm64', 'x86_64'], { stdio: 'pipe', timeout: 5000 });
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', existing], { stdio: 'pipe', timeout: 5000 });
    const version = JSON.parse(execFileSync(existing, ['version'], { encoding: 'utf8', timeout: 5000 }));
    if (version.protocol === 1) {
      console.log('Reusing verified universal startup bridge'); return;
    }
  } catch { /* Changed or absent artifacts need a new build. */ }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-things-bridge-'));
  const architectures = ['arm64', 'x86_64'];
  const options = { stdio: 'pipe', timeout: 180000 };
  try {
    for (const architecture of architectures) {
      execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', `${architecture}-apple-macos11.0`, source,
        '-o', path.join(directory, architecture)], options);
    }
    const binary = path.join(directory, 'bridge');
    execFileSync('/usr/bin/xcrun', ['lipo', '-create', ...architectures.map(architecture => path.join(directory, architecture)), '-output', binary], options);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', '--identifier', 'com.agent-things.session-status-bridge', binary], options);
    execFileSync('/usr/bin/xcrun', ['lipo', binary, '-verify_arch', ...architectures], options);
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', binary], options);
    const version = JSON.parse(execFileSync(binary, ['version'], { ...options, encoding: 'utf8', timeout: 5000 }));
    if (version.protocol !== 1) throw new Error('构建产物启动桥协议不匹配');
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const manifest = { protocol: 1, architectures, minimumMacOS: '11.0', sourceSha256: hash(source), sha256: hash(binary), capabilities: version.capabilities };
    const output = path.join(root, 'native/bin');
    fs.mkdirSync(output, { recursive: true });
    fs.chmodSync(binary, 0o755);
    fs.copyFileSync(binary, path.join(output, 'bridge'));
    fs.writeFileSync(path.join(output, 'bridge.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Built universal startup bridge: ${architectures.join(' + ')}, ${fs.statSync(binary).size} bytes`);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

if (require.main === module) {
  try { buildNativeBridge(); }
  catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
}
module.exports = { buildNativeBridge };
