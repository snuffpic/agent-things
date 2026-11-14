'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createPresentation } = require('../src/ui-foundation.cjs');

function buildSharedUi() {
  const target = path.join(__dirname, '../mods/agent-things-ui/hooks/foundation.js');
  const source = `// Generated from src/ui-foundation.cjs. Edit the shared source.\nconst presentation = (${createPresentation.toString()})();\nexport const { labels, colors, taskLabels, layout, accent, progressValue, progressState, draftTransition, analysisDisabled } = presentation;\n`;
  fs.writeFileSync(target, source);
}
if (require.main === module) buildSharedUi();
module.exports = { buildSharedUi };
