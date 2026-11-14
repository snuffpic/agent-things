'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startWatcher } = require('../src/startup/watch.cjs');
test('native application launch wakes the scanner without restarting an existing client', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-wake-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge');
  fs.writeFileSync(bridge, `#!${process.execPath}\nif(process.argv[2]==='watch'){console.log(JSON.stringify({event:'NSWorkspaceDidLaunchApplicationNotification',pid:123}));setInterval(()=>{},1000)}else{console.log(JSON.stringify({apps:[],inputStamp:0,inputIdleMs:0}))}\n`, { mode: 0o700 });
  let wake, wakeCount = 0;
  const awakened = new Promise(resolve => { wake = resolve; });
  const watcher = startWatcher({ root, settings: { app: '/fixture.app', allowClientRestart: false }, log: () => {}, onLaunch: () => { wakeCount++; wake(); } });
  t.after(() => watcher.stop());
  await Promise.race([awakened, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('Launch did not wake scanner')), 3000); timeout.unref(); })]);
  watcher.stop();
  await watcher.exited;
  assert.equal(wakeCount, 1);
});

test('the watcher resumes a persisted accepted quit when its process later exits', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-late-exit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const old = { key: 'old-process', pid: 42, launchedAt: Date.now() - 60000 };
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({
    lastAttemptAt: Date.now() - 60000,
    pendingHandoff: { app: old, inputStamp: 7, expiresAt: Date.now() - 60000 },
  }));
  fs.writeFileSync(path.join(root, 'apps.json'), JSON.stringify([old]));
  const bridge = path.join(root, 'bridge');
  fs.writeFileSync(bridge, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const root = __dirname, file = path.join(root, 'apps.json');
const mode = process.argv[2];
const emit = data => console.log(JSON.stringify(data));
if (mode === 'watch') {
  emit({event:'NSWorkspaceDidLaunchApplicationNotification'});
  setTimeout(() => {
    fs.writeFileSync(file, '[]');
    emit({event:'NSWorkspaceDidTerminateApplicationNotification'});
  }, 150);
  setInterval(() => {}, 1000);
} else if (mode === 'snapshot') {
  emit({apps:JSON.parse(fs.readFileSync(file)),inputStamp:7,inputIdleMs:0,frontmostPid:1});
} else if (mode === 'launch') {
  fs.writeFileSync(path.join(root, 'launched'), 'once');
  emit({launched:true,key:'debug-process',pid:43});
} else if (mode === 'show') {
  emit({shown:false});
} else {
  throw Error('Unexpected bridge operation: ' + mode);
}
`, { mode: 0o700 });
  let complete;
  const recovered = new Promise(resolve => { complete = resolve; });
  const watcher = startWatcher({ root, settings: { app: '/fixture.app', allowClientRestart: true },
    log: message => { if (message.startsWith('startup: reopened ')) complete(); } });
  t.after(() => watcher.stop());
  await Promise.race([recovered, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Pending handoff was not recovered')), 3000);
    timer.unref();
  })]);
  watcher.stop();
  await watcher.exited;
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json')));
  assert.equal(state.event, 'reopened');
  assert.equal(state.pendingHandoff, null);
  assert.equal(state.lastAttemptAt, 0);
  assert.equal(fs.readFileSync(path.join(root, 'launched'), 'utf8'), 'once');
});
