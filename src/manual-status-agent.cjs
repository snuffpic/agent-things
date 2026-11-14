'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { CodexService, BINDING, attachmentStatus } = require('./harnesses/codex/codex-service.cjs');

module.exports = {
  ManualStatusAgent: CodexService,
  CodexService,
  BINDING,
  attachmentStatus,
  renderer: () => fs.readFileSync(path.join(__dirname, 'session-status.js'), 'utf8'),
};
