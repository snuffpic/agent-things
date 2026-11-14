'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

function readRendererResource({ harnessFile, rendererFile }) {
  const installedFoundation = path.join(path.dirname(rendererFile), 'ui-foundation.cjs');
  const foundation = fs.readFileSync(fs.existsSync(installedFoundation) ? installedFoundation : path.join(__dirname, 'ui-foundation.cjs'), 'utf8');
  const browserSource = `(() => { const module = { exports: {} }; ${foundation}\nglobalThis.__agentThingsPresentation = module.exports.createPresentation(); })();`;
  const localFile = path.join(path.dirname(harnessFile), 'codex-local-card.js');
  const localSource = path.basename(harnessFile) === 'codex-harness.js' && fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : '';
  const source = localSource + '\n' + browserSource + '\n' + fs.readFileSync(harnessFile, 'utf8') + '\n' + fs.readFileSync(rendererFile, 'utf8');
  return { source, version: crypto.createHash('sha256').update(source).digest('hex') };
}

module.exports = { readRendererResource };
