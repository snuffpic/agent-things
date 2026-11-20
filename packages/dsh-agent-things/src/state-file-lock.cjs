'use strict';
const fs = require('node:fs');
const path = require('node:path');

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function reclaimStaleLock(lockFile, statBefore, verifyStale) {
  const guardFile = lockFile + '.reclaim';
  let guardFd;
  try {
    guardFd = fs.openSync(guardFile, 'wx', 0o600);
  } catch {
    try {
      const guardStat = fs.statSync(guardFile);
      if (Date.now() - guardStat.mtimeMs > 10000) {
        const staleGuard = guardFile + '.stale.' + process.pid + '.' + Date.now();
        try { fs.renameSync(guardFile, staleGuard); fs.unlinkSync(staleGuard); } catch {}
      }
    } catch {}
    return false;
  }
  try {
    const currentStat = fs.statSync(lockFile);
    if (statBefore && (currentStat.ino !== statBefore.ino || currentStat.dev !== statBefore.dev)) {
      return false;
    }
    if (typeof verifyStale === 'function' && !verifyStale(currentStat)) {
      return false;
    }
    const staleFile = lockFile + '.stale.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 6);
    fs.renameSync(lockFile, staleFile);
    try { fs.unlinkSync(staleFile); } catch {}
    return true;
  } catch {
    return false;
  } finally {
    try { fs.closeSync(guardFd); } catch {}
    try { fs.unlinkSync(guardFile); } catch {}
  }
}

function tryAcquirePidLock(lockFile, depth = 0) {
  if (depth > 3) return false;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  try {
    const fd = fs.openSync(lockFile, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch (err) {
    if (!err || err.code !== 'EEXIST') throw err;
    let statBefore = null;
    try {
      statBefore = fs.statSync(lockFile);
      const raw = fs.readFileSync(lockFile, 'utf8');
      const info = JSON.parse(raw);
      if (isPidAlive(info?.pid)) return false;
      const reclaimed = reclaimStaleLock(lockFile, statBefore, () => {
        try {
          const recheck = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          return !isPidAlive(recheck?.pid);
        } catch {
          return false;
        }
      });
      return reclaimed ? tryAcquirePidLock(lockFile, depth + 1) : false;
    } catch {
      try {
        const stat = statBefore || fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > 10000) {
          const reclaimed = reclaimStaleLock(lockFile, stat, curStat => Date.now() - curStat.mtimeMs > 10000);
          return reclaimed ? tryAcquirePidLock(lockFile, depth + 1) : false;
        }
      } catch {}
      return false;
    }
  }
}

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
  finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

module.exports = { withStateFileLock, tryAcquirePidLock };
