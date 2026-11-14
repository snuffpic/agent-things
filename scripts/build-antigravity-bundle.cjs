'use strict';
const fs = require('node:fs');
const path = require('node:path');

function buildBundle() {
  const root = path.resolve(__dirname, '..');
  const harnessPath = path.join(root, 'src/harnesses/antigravity/antigravity-harness.js');
  const panelPath = path.join(root, 'src/session-status.js');
  const outDir = path.join(root, 'outputs');
  const outFile = path.join(outDir, 'antigravity-session-status.js');

  const harnessCode = fs.readFileSync(harnessPath, 'utf8');
  const panelCode = fs.readFileSync(panelPath, 'utf8');

  const combined = `// Antigravity Session Status Bundle (Auto-generated)
// Zero-friction embedded panel for Antigravity

${harnessCode}

${panelCode}

`;

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, combined, 'utf8');
  console.log(`✅ Built bundle: ${outFile} (${Buffer.byteLength(combined)} bytes)`);

  return outFile;
}

if (require.main === module) {
  buildBundle();
}

module.exports = { buildBundle };
