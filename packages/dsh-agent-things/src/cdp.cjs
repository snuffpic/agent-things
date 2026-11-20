'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CDP_PORT = 39222;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// The endpoint can run code inside Codex, so never follow a target to anywhere but this machine.
function assertLoopback(url, port = CDP_PORT) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'ws:' || !LOOPBACK_HOSTS.has(parsed.hostname) || Number(parsed.port) !== port) {
    throw new Error(`CDP must use a loopback WebSocket on port ${port}`);
  }
  return parsed;
}

function isMainWindow(target) {
  if (target?.type !== 'page' || typeof target.webSocketDebuggerUrl !== 'string') return false;
  try {
    const url = new URL(target.url || '');
    return url.protocol === 'app:' && !/overlay|detached/i.test(decodeURIComponent(url.pathname + url.search + url.hash));
  } catch {
    return false;
  }
}

async function listTargets(port = CDP_PORT, timeoutMs = 3000) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error('CDP unavailable');
  return response.json();
}

class CdpSession {
  constructor(target, port = CDP_PORT) {
    this.target = target;
    this.port = port;
    this.pending = new Map();
    this.serial = 0;
    this.socket = null;
    this.onBinding = null;
  }

  async connect() {
    const ws = new WebSocket(assertLoopback(this.target.webSocketDebuggerUrl, this.port));
    this.socket = ws;
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.method === 'Runtime.bindingCalled') this.onBinding?.(message.params);
      const request = this.pending.get(message?.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error || message.result?.exceptionDetails) request.reject(new Error(
        message.error?.message || message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text
      ));
      else request.resolve(message.result);
    });
    ws.addEventListener('close', () => this.rejectPending());
    ws.addEventListener('error', () => this.rejectPending());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP handshake timed out'));
      }, 4000);
      const finish = fn => {
        clearTimeout(timer);
        fn();
      };
      ws.addEventListener('open', () => finish(resolve), { once: true });
      ws.addEventListener('error', () => finish(() => reject(new Error('CDP unavailable'))), { once: true });
      ws.addEventListener('close', () => finish(() => reject(new Error('CDP closed'))), { once: true });
    });
    await this.request('Runtime.enable');
  }

  request(method, params = {}, timeoutMs = 5000) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP disconnected'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP request timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  evaluate(expression) {
    return this.request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  }

  rejectPending() {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CDP disconnected'));
    }
    this.pending.clear();
  }

  close() {
    this.rejectPending();
    this.socket?.close();
    this.socket = null;
  }
}

module.exports = { CDP_PORT, CdpSession, assertLoopback, isMainWindow, listTargets };
