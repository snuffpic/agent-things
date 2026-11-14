'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { CdpSession, listTargets } = require('../../cdp.cjs');

class AntigravityInjector {
  constructor(credentials, { allowOrigin = () => {} } = {}) {
    this.credentials = credentials;
    this.allowOrigin = allowOrigin;
    this.sessions = new Map();
    this.scanning = false;
    this.stopped = false;
  }

  async scan() {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      const portFile = path.join(os.homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort');
      if (!fs.existsSync(portFile)) return;
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      const targets = (await listTargets(port, 800)).filter(target => {
        if (target.type !== 'page') return false;
        const url = new URL(target.url);
        if (url.protocol === 'vscode-file:' && url.hostname === 'vscode-app') return true;
        return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && /^\/(?:c\/|$)/.test(url.pathname);
      });
      const live = new Set(targets.map(target => target.id));
      for (const [id, entry] of this.sessions) if (!live.has(id)) { entry.session.close(); this.sessions.delete(id); }
      const root = path.resolve(__dirname, '../..');
      const connection = {
        origin: `http://127.0.0.1:${this.credentials.port}`,
        token: this.credentials.token,
        brainDir: path.resolve(os.homedir(), '.gemini', 'antigravity', 'brain'),
      };
      const sessionStatusPath = fs.existsSync(path.join(root, 'src', 'session-status.js'))
        ? path.join(root, 'src', 'session-status.js')
        : path.join(root, 'session-status.js');
      const source = `window.__agentThingsConnection = ${JSON.stringify(connection)};\n` +
        fs.readFileSync(path.join(__dirname, 'antigravity-harness.js'), 'utf8') + '\n' + fs.readFileSync(sessionStatusPath, 'utf8');
      const version = crypto.createHash('sha256').update(source).digest('hex');
      for (const target of targets) {
        if (this.stopped) break;
        const origin = new URL(target.url).origin;
        if (origin !== 'null') this.allowOrigin(origin);
        let entry = this.sessions.get(target.id);
        if (!entry) {
          const session = new CdpSession(target, port);
          entry = { session }; this.sessions.set(target.id, entry);
          try { await session.connect(); }
          catch (error) { session.close(); this.sessions.delete(target.id); throw error; }
          if (this.stopped) { session.close(); this.sessions.delete(target.id); break; }
        }
        try {
          const { result } = await entry.session.evaluate(`(() => {
            window.__agentThingsConnection = ${JSON.stringify(connection)};
            const old = window.__codexSessionStatus;
            if (old?.status().version === ${JSON.stringify(version)}) return true;
            const saved = old?.exportForReload?.();
            if (saved?.busy) return false;
            const load = new Function(${JSON.stringify(source)} + '\\nreturn installCodexSessionStatus;');
            old?.destroy();
            try { load()(${JSON.stringify(version)}, saved); }
            catch (error) {
              ${entry.source ? `new Function(${JSON.stringify(entry.source)} + '\\nreturn installCodexSessionStatus;')()(${JSON.stringify(entry.version)}, saved);` : ''}
              throw error;
            }
            return true;
          })()`);
          if (result.value) { entry.source = source; entry.version = version; }
        } catch (error) {
          entry.session.close(); this.sessions.delete(target.id); throw error;
        }
      }
    } finally { this.scanning = false; }
  }

  async stop() {
    this.stopped = true;
    const entries = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(entries.map(async entry => {
      try {
        if (entry.version) await entry.session.evaluate(`(() => {
          const current = window.__codexSessionStatus;
          if (current?.status().version === ${JSON.stringify(entry.version)}) current.destroy();
        })()`);
      } catch { /* The window may already have closed. */ }
      finally { entry.session.close(); }
    }));
  }
}

module.exports = { AntigravityInjector };
