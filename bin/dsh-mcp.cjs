#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function resolveRuntimeRoot() {
  const srcDir = path.resolve(__dirname, '../src');
  if (fs.existsSync(path.join(srcDir, 'mcp-stdio.cjs'))) return srcDir;
  throw new Error('Agent Things DeepSeek runtime files not found');
}

const runtimeRoot = resolveRuntimeRoot();
const { callProgressTool } = require(path.join(runtimeRoot, 'progress-tools.cjs'));
const { serveMcp } = require(path.join(runtimeRoot, 'mcp-stdio.cjs'));
const { readConfiguredLang } = require(path.join(runtimeRoot, 'i18n.cjs'));
const { DshStatusStore, resolveDefaultDshStateFile } = require(path.join(runtimeRoot, 'harnesses/deepseek/dsh-service.cjs'));

async function callViaBridge(bridgeFile, stateFile, name, args) {
  if (!fs.existsSync(bridgeFile)) return null;
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(bridgeFile, 'utf8'));
  } catch {
    return null;
  }
  if (!creds || creds.service !== 'agent-things-dsh' || !Number.isInteger(creds.port) || typeof creds.token !== 'string') {
    return null;
  }
  if (stateFile) {
    const expectedId = crypto.createHash('sha256').update(path.resolve(stateFile)).digest('hex');
    if (creds.stateId && creds.stateId !== expectedId) return null;
  }

  let res;
  try {
    res = await fetch(`http://127.0.0.1:${creds.port}/tools`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, args }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }

  const data = await res.json();
  if (!res.ok || data?.error) {
    throw Object.assign(new Error(data?.error || `DSH bridge returned HTTP ${res.status}`), data?.errorInfo || {});
  }
  return data.result;
}

function main() {
  const stateFile = path.resolve(process.env.AGENT_THINGS_DSH_STATE || resolveDefaultDshStateFile());
  const bridgeFile = path.resolve(process.env.AGENT_THINGS_DSH_BRIDGE || path.join(path.dirname(stateFile), 'bridge.json'));

  serveMcp({
    name: 'agent-things-dsh',
    callTool: async (name, args = {}) => {
      const bridged = await callViaBridge(bridgeFile, stateFile, name, args);
      if (bridged !== null) return bridged;
      const store = new DshStatusStore(stateFile);
      const lang = args?.lang || readConfiguredLang({ dataDir: path.dirname(stateFile) });
      return callProgressTool(store, name, args, { lang });
    },
  });
}

if (require.main === module) {
  main();
}

module.exports = { main, callViaBridge };
