'use strict';
const fs = require('node:fs');
const path = require('node:path');

function normalizeProjectPath(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('工程路径应为绝对路径');
  try { return fs.realpathSync.native(value); }
  catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return path.resolve(value);
    throw error;
  }
}

module.exports = { normalizeProjectPath };
