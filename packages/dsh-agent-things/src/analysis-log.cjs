'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Only diagnostic metadata can cross this boundary; arbitrary text is discarded.
const FIELDS = new Set(('runId threadId hostId actionSequence requestId requestType stage method model rpcId attempt batch batches ' +
  'pid parentPid code signal elapsedMs wallElapsedMs jobElapsedMs jobWallElapsedMs idleMs timeoutMs overshootMs bytes inputBytes outputBytes promptBytes instructionBytes schemaBytes stdinBytes profile throughTurnId ' +
  'estimatedTokens rawBytes compactBytes turnCount eventCount totalTasks completedTasks percent eventType itemType diagnostic component hasRemote ' +
  'httpStatus systemCode ok sent revision resourceVersion catalogVersion cacheAgeMs inputTokens outputTokens cachedInputTokens promptVersion schemaVersion ledgerVersion reason').split(' '));

function diagnosticFields(value) {
  const text = typeof value === 'string' ? value : String(value?.message || '');
  const diagnostic = /已有分析|already.*(?:running|pending)/i.test(text) ? 'already_running'
    : /unauthorized|authentication|not logged in|login|sign.in|\b401\b/i.test(text) ? 'authentication'
    : /rate.limit|quota|usage.limit|\b429\b/i.test(text) ? 'rate_limit'
    : /code.mode.*(disabled|unavailable)/i.test(text) ? 'code_mode_disabled'
    : /model.*(not found|unavailable|not supported|access)|model_not_found/i.test(text) ? 'model_unavailable'
    : /context.length|context.window|too many tokens/i.test(text) ? 'context_limit'
    : /dns|ENOTFOUND|name resolution/i.test(text) ? 'dns'
    : /certificate|\bTLS\b|\bSSL\b/i.test(text) ? 'tls'
    : /timed?.?out|timeout|超时/i.test(text) ? 'timeout'
    : /connection|disconnect|unexpected eof|ECONNRESET|EPIPE/i.test(text) ? 'connection'
    : /中断|abort/i.test(text) ? 'cancelled' : 'other';
  const result = { diagnostic };
  const status = text.match(/\b(?:http(?: status)?|status(?: code)?)[:= ]+(\d{3})\b/i);
  if (status) result.httpStatus = Number(status[1]);
  if (/codex_models_manager|available models|list_models/i.test(text)) result.component = 'model_catalog';
  else if (/codex_core_plugins|plugin catalog|featured plugin/i.test(text)) result.component = 'plugin_catalog';
  if (/^(?:E[A-Z0-9_]+|APP_SERVER_TIMEOUT)$/.test(value?.code || '')) result.systemCode = value.code;
  return result;
}

function createAnalysisLog(file, { maxBytes = 2 * 1024 * 1024, backups = 3 } = {}) {
  let warned = false;
  return (event, fields = {}) => {
    if (!/^[a-z][a-z0-9_.]{0,79}$/.test(event)) return;
    const entry = { time: new Date().toISOString(), event, processId: process.pid };
    for (const [key, value] of Object.entries(fields)) {
      if (!FIELDS.has(key)) continue;
      if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) entry[key] = value;
      else if (typeof value === 'string' && /^[A-Za-z0-9_./:-]{1,120}$/.test(value)) entry[key] = value;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const line = JSON.stringify(entry) + '\n';
      if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > maxBytes) {
        for (let i = backups; i >= 1; i--) {
          const from = i === 1 ? file : `${file}.${i - 1}`;
          const to = `${file}.${i}`;
          if (fs.existsSync(to)) fs.unlinkSync(to);
          if (fs.existsSync(from)) fs.renameSync(from, to);
        }
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
    } catch (error) {
      if (!warned) { warned = true; console.error(`分析诊断日志写入失败（${diagnosticFields(error).systemCode || 'UNKNOWN'}）`); }
    }
  };
}

module.exports = { createAnalysisLog, diagnosticFields };
