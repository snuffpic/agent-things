'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The bundled bridge serializes PID inspection/replacement with a kernel file lock.
// A dead owner is reclaimed; a live owner is never expired by elapsed time.
function withStateFileLock(file, operation) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.write-lock`;
  const deadline = performance.now() + 3000;
  const delay = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    if (tryAcquirePidLock(lock)) break;
    if (performance.now() >= deadline) throw new Error('账本正由其他进程更新，请稍后重试');
    Atomics.wait(delay, 0, 0, 15);
  }
  try { return operation(); }
  finally { fs.unlinkSync(lock); }
}

let bridge;
function tryAcquirePidLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  bridge ||= require('./native-bridge.cjs').verifyBridgeBundle(path.resolve(__dirname, '..'));
  const result = spawnSync(bridge, ['claim-lock', file, String(process.pid)], { encoding: 'utf8', timeout: 1000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('本机进程锁不可用，请重新同步安装组件');
  return JSON.parse(result.stdout).acquired === true;
}
module.exports = { withStateFileLock, tryAcquirePidLock };
