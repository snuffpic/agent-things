'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readRendererResource } = require('../src/renderer-resource.cjs');

function buildCodexBundle() {
  const root = path.resolve(__dirname, '..');
  const harnessPath = path.join(root, 'src/harnesses/codex/codex-harness.js');
  const panelPath = path.join(root, 'src/session-status.js');
  const outDir = path.join(root, 'outputs');
  const outFile = path.join(outDir, 'codex-session-status.js');

  const { source } = readRendererResource({ harnessFile: harnessPath, rendererFile: panelPath });

  const combined = `// Agent Things Codex Bundle (Auto-generated)
// Things 3 task manager and session progress overlay for Codex

${source}
`;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, combined, 'utf8');
  console.log(`✅ Built Codex bundle: ${outFile} (${Buffer.byteLength(combined)} bytes)`);
  return outFile;
}

if (require.main === module) {
  buildCodexBundle();
}

module.exports = { buildCodexBundle };
