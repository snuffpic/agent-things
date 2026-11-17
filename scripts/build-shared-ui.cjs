'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createPresentation } = require('../src/ui-foundation.cjs');

function buildSharedUi() {
  const target = path.join(__dirname, '../mods/agent-things-ui/hooks/foundation.js');
  const source = `// Generated from src/ui-foundation.cjs. Edit the shared source.\nconst presentation = (${createPresentation.toString()})();\nexport const { lang, labels, colors, taskLabels, strings, locales, layout, accent, claudeCodeThemes, normalizeHexColor, resolveAccentPalette, t, format, forLang, formatDate, progressValue, progressState, draftTransition, analysisDisabled } = presentation;\n`;
  fs.writeFileSync(target, source);

  const sidecarI18nTarget = path.join(__dirname, '../src/plugins/things/sidecars/things_board/ui-i18n.mjs');
  const sidecarSource = `// Generated from src/ui-foundation.cjs. Edit the shared source.\nexport const createPresentation = ${createPresentation.toString()};\nexport function getUiForLang(lang) {\n  const base = createPresentation(lang);\n  return base.forLang ? { ...base, ...base.forLang(lang) } : base;\n}\n`;
  fs.writeFileSync(sidecarI18nTarget, sidecarSource);

  const claudeHarnessTarget = path.join(__dirname, '../src/harnesses/claude/claude-harness.js');
  if (fs.existsSync(claudeHarnessTarget)) {
    const startTag = '// <generated-presentation-fallback>';
    const endTag = '// </generated-presentation-fallback>';
    const block = `${startTag}\nif (typeof globalThis !== 'undefined' && !globalThis.__agentThingsPresentation) {\n  globalThis.__agentThingsPresentation = (${createPresentation.toString()})(globalThis.__agentThingsLang);\n}\n${endTag}\n`;
    let existing = fs.readFileSync(claudeHarnessTarget, 'utf8');
    const startIdx = existing.indexOf(startTag);
    if (startIdx >= 0) existing = existing.slice(0, startIdx).replace(/\s+$/, '\n');
    else existing = existing.replace(/\s+$/, '\n');
    fs.writeFileSync(claudeHarnessTarget, `${existing}\n${block}`);
  }
}
if (require.main === module) buildSharedUi();
module.exports = { buildSharedUi };
