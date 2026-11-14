'use strict';
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { resolveCodexBin } = require('./resolve.cjs');
const { diagnosticFields } = require('./analysis-log.cjs');

class AnalysisAppServer {
  constructor({ binary = resolveCodexBin(), spawnProcess = spawn, timeoutMs = 30000, log = () => {} } = {}) {
    this.log = log;
    this.child = spawnProcess(binary, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
    log('app_server.spawn', { pid: this.child.pid, parentPid: process.pid });
    this.pending = new Map(); this.serial = 0; this.closed = false; this.timeoutMs = timeoutMs;
    this.exited = new Promise(resolve => this.child.once('close', (code, signal) => {
      log('app_server.close', { pid: this.child.pid, code, signal }); resolve();
    }));
    let lastDiagnostic = '';
    this.child.stderr?.on('data', chunk => {
      const fields = diagnosticFields(chunk.toString().slice(-4096));
      const signature = JSON.stringify(fields);
      if (signature !== lastDiagnostic) { log('app_server.diagnostic', fields); lastDiagnostic = signature; }
    });
    this.lines = readline.createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { log('rpc.protocol.error', { bytes: Buffer.byteLength(line) }); return; }
      const pending = this.pending.get(message.id);
      if (!pending) { if (message.id != null) log('rpc.unmatched', { rpcId: message.id, bytes: Buffer.byteLength(line) }); return; }
      this.pending.delete(message.id); clearTimeout(pending.timer);
      log(message.error ? 'rpc.failed' : 'rpc.complete', { method: pending.method, rpcId: message.id,
        elapsedMs: Date.now() - pending.startedAt, bytes: Buffer.byteLength(line), code: message.error?.code,
        ...(message.error ? diagnosticFields(message.error.message) : {}) });
      if (message.error) pending.reject(new Error(`App Server 请求失败（${pending.method}，${Date.now() - pending.startedAt} 毫秒${Number.isInteger(message.error.code) ? `，错误码 ${message.error.code}` : ''}）`));
      else pending.resolve(message.result);
    });
    const fail = () => {
      this.closed = true;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`App Server 已退出（${pending.method}，${Date.now() - pending.startedAt} 毫秒）`)); }
      this.pending.clear();
    };
    this.child.on('error', error => { log('app_server.error', diagnosticFields(error)); fail(); });
    this.child.on('exit', (code, signal) => { log('app_server.exit', { pid: this.child.pid, code, signal }); fail(); });
    this.child.stdin.on('error', error => { log('app_server.stdin.error', diagnosticFields(error)); fail(); });
  }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('App Server 已退出'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      this.log('rpc.start', { method, rpcId: id, timeoutMs: this.timeoutMs });
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`App Server 请求超时（${method}，${Date.now() - startedAt} 毫秒）`);
        error.code = 'APP_SERVER_TIMEOUT';
        this.log('rpc.timeout', { method, rpcId: id, elapsedMs: Date.now() - startedAt, timeoutMs: this.timeoutMs });
        reject(error);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method, startedAt });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'codex_session_status', version: '1' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  }
  close() {
    if (this.closing) return this.closing;
    this.lines.close();
    if (!this.closed) this.log('app_server.signal', { pid: this.child.pid, signal: 'SIGTERM', sent: this.child.kill('SIGTERM') });
    const timer = setTimeout(() => this.log('app_server.signal', { pid: this.child.pid, signal: 'SIGKILL', sent: this.child.kill('SIGKILL') }), 1500);
    this.closing = this.exited.finally(() => clearTimeout(timer));
    return this.closing;
  }
}
module.exports = { AnalysisAppServer };
