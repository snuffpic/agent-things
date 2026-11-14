'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { CdpSession, listTargets } = require('../../cdp.cjs');
const { installClaudeHost } = require('./claude-host-helper.cjs');
const execute = promisify(execFile);
const APP = '/Applications/Claude.app';
const REQUIREMENT = 'identifier "com.anthropic.claudefordesktop" and anchor apple generic and certificate leaf[subject.OU] = "Q6L2SF6YDW"';

async function verifyClaudeProcess(pid, run) {
  const { stdout } = await run('/bin/ps', ['-p', String(pid), '-o', 'uid=,comm='], { timeout: 2000 });
  const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
  if (!match || Number(match[1]) !== process.getuid() || match[2] !== `${APP}/Contents/MacOS/Claude`) throw new Error('连接目标属于其他进程，未确认 Claude 身份');
  await run('/usr/bin/codesign', ['--verify', '--strict', `-R=${REQUIREMENT}`, APP], { timeout: 5000 });
}

async function inspectorOwner({ execute: run = execute } = {}) {
  let output;
  try { output = (await run('/usr/sbin/lsof', ['-t', '-nP', '-iTCP:9229', '-sTCP:LISTEN'], { timeout: 2000 })).stdout; }
  catch (error) { if (error.code === 1) return null; throw error; }
  const pids = [...new Set(output.trim().split(/\s+/))];
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) throw new Error('调试端口归属不明确');
  const pid = Number(pids[0]);
  await verifyClaudeProcess(pid, run);
  return pid;
}

class ClaudeInjector {
  constructor({ stateFile, root = path.resolve(__dirname, '../../..'), run = execute } = {}) {
    this.stateFile = stateFile; this.root = root; this.run = run;
    this.attachedPid = null; this.busy = false; this.status = { state: 'waiting' };
  }
  async scan() {
    if (this.busy) return this.status;
    this.busy = true;
    try {
      const heartbeatFile = path.join(path.dirname(this.stateFile), 'attachment-host.json');
      if (!this.attachedPid && fs.existsSync(heartbeatFile)) {
        const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
        if (Number.isInteger(heartbeat.pid) && !heartbeat.stopped && Date.now() - heartbeat.checkedAt < 5000) {
          try { await verifyClaudeProcess(heartbeat.pid, this.run); this.attachedPid = heartbeat.pid; }
          catch { /* The old host may have exited during a client update. */ }
        }
      }
      if (this.attachedPid) {
        if (fs.existsSync(heartbeatFile)) {
          const heartbeat = JSON.parse(fs.readFileSync(heartbeatFile, 'utf8'));
          if (heartbeat.pid === this.attachedPid && !heartbeat.stopped && Date.now() - heartbeat.checkedAt < 5000) {
            return this.status = { state: heartbeat.error ? 'error' : 'attached', pid: this.attachedPid,
              mounted: (heartbeat.views || []).reduce((count, view) => count + (view.mounted || 0), 0), ...(heartbeat.error ? { error: heartbeat.error } : {}) };
          }
        }
        try {
          const { stdout } = await this.run('/bin/ps', ['-p', String(this.attachedPid), '-o', 'comm='], { timeout: 2000 });
          if (stdout.trim() === `${APP}/Contents/MacOS/Claude`) return this.status;
        } catch { /* The previously attached app exited. */ }
        this.attachedPid = null;
      }
      const pid = await inspectorOwner({ execute: this.run });
      if (!pid) return this.status = { state: 'manual-debugger-required' };
      const targets = await listTargets(9229, 2000);
      if (targets.length !== 1 || targets[0].type !== 'node' || await inspectorOwner({ execute: this.run }) !== pid) throw new Error('Claude 调试目标已变化');
      const session = new CdpSession(targets[0], 9229);
      try {
        await session.connect();
        const response = await session.evaluate(`(() => {
          if(process.pid!==${pid})throw new Error('Claude 进程身份已变化');
          return (${installClaudeHost.toString()})(${JSON.stringify({ root: this.root, credentialFile: `${this.stateFile}.http.json` })});
        })()`);
        if (!response.result?.value?.installed) throw new Error('Claude 插件加载失败');
        this.attachedPid = pid;
        this.status = { state: 'attached', pid };
      } finally {
        try {
          if (session.socket?.readyState === WebSocket.OPEN) await session.evaluate(`(() => {
            const {Menu}=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
            const clear=menu=>{for(const item of menu?.items??[]){if(item.label==='Enable Main Process Debugger')item.checked=false;if(item.submenu)clear(item.submenu);}};
            clear(Menu.getApplicationMenu());setTimeout(()=>process.getBuiltinModule('inspector').close(),150);return true;
          })()`);
        } finally { session.close(); }
      }
      return this.status;
    } catch (error) { this.status = { state: 'error', error: error.message }; return this.status; }
    finally {
      this.busy = false;
      const file = path.join(path.dirname(this.stateFile), 'attachment.json');
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ ...this.status, checkedAt: new Date().toISOString() }), { mode: 0o600 }); fs.renameSync(temporary, file);
    }
  }
}
module.exports = { ClaudeInjector, inspectorOwner, APP };
