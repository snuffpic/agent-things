'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createPresentation } = require('../src/ui-foundation.cjs');

function buildSharedUi() {
  const target = path.join(__dirname, '../mods/agent-things-ui/hooks/foundation.js');
  const source = `// Generated from src/ui-foundation.cjs. Edit the shared source.\nconst presentation = (${createPresentation.toString()})();\nexport const { lang, labels, colors, taskLabels, strings, locales, layout, accent, t, format, forLang, formatDate, progressValue, progressState, draftTransition, analysisDisabled } = presentation;\n`;
  fs.writeFileSync(target, source);

  const sidecarI18nTarget = path.join(__dirname, '../src/plugins/things/sidecars/things_board/ui-i18n.mjs');
  const sidecarSource = `// Generated from src/ui-foundation.cjs. Edit the shared source.\nexport const createPresentation = ${createPresentation.toString()};\nexport function getUiForLang(lang) {\n  const base = createPresentation(lang);\n  return base.forLang ? { ...base, ...base.forLang(lang) } : base;\n}\n`;
  fs.writeFileSync(sidecarI18nTarget, sidecarSource);
}
if (require.main === module) buildSharedUi();
module.exports = { buildSharedUi };
