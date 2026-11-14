'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tryAcquirePidLock } = require('./state-file-lock.cjs');
const { progressError } = require('./progress-error.cjs');
async function withLifecycleLock(directory, operation) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'installation.lock');
  if (!tryAcquirePidLock(file)) throw progressError('SERVICE_STOPPING', '安装、升级或卸载正在执行，请稍后重试');
  try { return await operation(); }
  finally { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.unlinkSync(file); }
}
module.exports = { withLifecycleLock };
