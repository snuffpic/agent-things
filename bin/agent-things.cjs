#!/usr/bin/env node
'use strict';
const { main } = require('./codex-session-status.cjs');

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
