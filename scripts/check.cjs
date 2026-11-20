'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const dirs = ['src', 'bin', 'test', 'scripts'];
if (fs.existsSync(path.join(root, 'packages/dsh-agent-things/lib/index.js'))) {
  dirs.push('packages/dsh-agent-things');
}
const files = dirs.flatMap(dir => walk(path.join(root, dir))).filter(file => /\.(cjs|mjs|js)$/.test(file));
for (const file of files) {
  // This fixture is a browser ES module inside a CommonJS package.
  if (file.endsWith('app-shared-fixture.js')) execFileSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(file) });
  // DSH client bundle is a browser script inside a type=module bundle directory.
  else if (file.endsWith(path.join('dsh-agent-things', 'lib', 'client.js'))) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
  else execFileSync(process.execPath, ['--check', file]);
}
console.log(`Syntax OK: ${files.length} JavaScript files`);
