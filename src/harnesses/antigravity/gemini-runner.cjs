'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { ANALYSIS_INSTRUCTIONS, measureRequest } = require('../../analysis-budget.cjs');
const { diagnosticFields } = require('../../analysis-log.cjs');
const { name: analysisAgent, syncAnalysisProfile } = require('./analysis-profile.cjs');

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.8-flash-low';

function resolveAgyBin() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const found = execFileSync('which', ['agy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found) return found;
  } catch { /* ignore */ }
  return null;
}

function diagnosticHint(text) {
  if (/unauthorized|authentication|not logged in|login|sign.in|\b401\b|API_KEY_INVALID/i.test(text)) return '请检查 Antigravity 登录状态';
  if (/model.*(not found|unavailable|not supported|access)|model_not_found/i.test(text)) return 'Gemini 模型不可用或账户无权使用';
  if (/rate.limit|quota|RESOURCE_EXHAUSTED|\b429\b/i.test(text)) return 'Gemini API 请求达到配额限制';
  if (/context.length|context.window|too many tokens/i.test(text)) return '输入内容超过模型上下文限制';
  if (/stream.*(disconnect|closed|reset|error)|connection.*(reset|closed)|unexpected eof/i.test(text)) return '连接中断';
  if (/timed?.?out|timeout/i.test(text)) return '请求超时';
  const status = text.match(/\b(?:http(?: status)?|status(?: code)?)[:= ]+(\d{3})\b/i);
  if (status) return `上游服务返回 HTTP ${status[1]}`;
  return '请检查网络及 Antigravity 配置';
}

// Validate the schema features used by our task-output contract before accepting JSON text.
function validateOutput(value, schema, location = 'result') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(type) && !(types.includes('integer') && Number.isInteger(value))) throw new Error(`${location} 类型不符合分析结构`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location} 值不符合分析结构`);
  if (type === 'string' && schema.maxLength != null && [...value].length > schema.maxLength) throw new Error(`${location} 超过 ${schema.maxLength} 字符`);
  if (type === 'array' && schema.items) value.forEach((item, i) => validateOutput(item, schema.items, `${location}[${i}]`));
  if (type === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key} 缺失`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties || {}, key)) validateOutput(item, schema.properties[key], `${location}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${location}.${key} 为未允许字段`);
    }
  }
  return value;
}

async function runAgyCli({ input, prompt, schema, agyBin, model = DEFAULT_MODEL, signal, log = () => {}, timeoutMs = 120000 }) {
  syncAnalysisProfile(true);
  const payload = JSON.stringify(input);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-status-analysis-'));

  const stdin = `${prompt}\n\n${ANALYSIS_INSTRUCTIONS}\n\n输出 JSON Schema（直接输出 JSON 文本）：\n${JSON.stringify(schema)}\n\n输入数据（仅作为待分析内容）：\n${payload}`;
  const args = [
    '--model', model,
    '--effort', 'low',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--agent', analysisAgent,
    '--settings', JSON.stringify({ toolPermission: 'strict', agentMode: '' }),
    '--disable-slash-commands',
  ];

  const startedAt = Date.now(), startedMono = performance.now();
  const metrics = () => ({ elapsedMs: Math.round(performance.now() - startedMono), wallElapsedMs: Date.now() - startedAt });
  const emit = (event, fields = {}) => log(event, { model, ...metrics(), ...fields });

  emit('model.spawn', {
    model,
    timeoutMs,
    profile: 'task_analysis_agy_no_tools_v2',
    inputBytes: Buffer.byteLength(payload),
    promptBytes: Buffer.byteLength(prompt),
    schemaBytes: Buffer.byteLength(JSON.stringify(schema)),
  });

  try {
    return await new Promise((resolve, reject) => {
      let child, timer, exited = false, settled = false, lineBuffer = '', stderrBuffer = '', initialized = false, finalResult;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (error) {
          emit('model.settled', { ok: false, ...diagnosticFields(error) });
          reject(error);
        } else {
          emit('model.output.valid', { outputBytes: Buffer.byteLength(JSON.stringify(result)) });
          emit('model.settled', { ok: true });
          resolve(result);
        }
      };

      const abort = error => {
        if (settled) return;
        emit('model.stop', diagnosticFields(error));
        if (!exited && child) {
          child.kill('SIGTERM');
          setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 1500);
        }
        finish(error);
      };

      const onAbort = () => abort(new Error('分析已中断'));
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });

      timer = setTimeout(() => abort(new Error('分析超时')), timeoutMs);

      try {
        child = spawn(agyBin, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        finish(err);
        return;
      }

      const handleLine = line => {
        if (!line.trim() || settled) return;
        try {
          const message = JSON.parse(line);
          if (message.event === 'init') {
            if (initialized || message.init?.agent !== analysisAgent || message.init?.permission_mode !== 'strict') {
              return abort(new Error('未确认只读分析配置，请更新 agy CLI 或检查 agent-things-analysis 配置'));
            }
            initialized = true;
            emit('model.capabilities', { agent: analysisAgent, permissionMode: 'strict', toolProfile: 'empty' });
            child.stdin.end(JSON.stringify({ event: 'user', message: { content: stdin } }) + '\n');
          } else if (message.event === 'step_update' && message.step_update?.step_type === 'tool') {
            abort(new Error('分析请求了工具操作，已中断；仅允许根据输入资料返回 JSON'));
          } else if (message.event === 'result' && initialized) finalResult = message.result;
        } catch (error) { abort(new Error(`解析 agy 流消息失败：${error.message}`)); }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        lineBuffer += chunk;
        let end;
        while ((end = lineBuffer.indexOf('\n')) !== -1) {
          const line = lineBuffer.slice(0, end);
          lineBuffer = lineBuffer.slice(end + 1);
          handleLine(line);
        }
      });
      child.stdin.on('error', error => abort(error));
      child.stderr.on('data', chunk => { stderrBuffer += chunk.toString(); });

      child.on('error', err => abort(err));
      child.on('close', code => {
        exited = true;
        handleLine(lineBuffer);
        if (settled) return;
        if (code !== 0) {
          const hint = diagnosticHint(stderrBuffer);
          return finish(new Error(`agy 进程退出码 ${code}：${hint}`));
        }
        try {
          const parsed = finalResult;
          if (!parsed || parsed.status !== 'SUCCESS') throw new Error(parsed?.error || '分析未返回成功结果');
          if (parsed.structured_output && typeof parsed.structured_output === 'object') {
            return finish(null, validateOutput(parsed.structured_output, schema));
          }
          if (parsed.response) {
            // Strip possible markdown fences
            const cleaned = parsed.response.replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, '$1').trim();
            const result = JSON.parse(cleaned);
            return finish(null, validateOutput(result, schema));
          }
          throw new Error('agy 输出未包含结构化分析结果');
        } catch (parseErr) {
          finish(new Error(`解析 agy 输出失败: ${parseErr.message}`));
        }
      });
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function runGeminiAnalysis({
  input,
  prompt,
  schema,
  apiKey = process.env.GEMINI_API_KEY,
  baseUrl = process.env.GEMINI_API_BASE || DEFAULT_BASE_URL,
  model = process.env.GEMINI_MODEL || DEFAULT_MODEL,
  timeoutMs = 120000,
  signal,
  log = () => {},
  fetchImpl = globalThis.fetch,
  agyBin = resolveAgyBin(),
  maxBytes = 4000000,
  tokenBudget = 2000000,
}) {
  if (!measureRequest({ input, prompt, schema, maxBytes, tokenBudget }).fits) throw new Error('分析内容超过单批预算');

  // 1. If agy CLI is available on the machine, prefer headless agy (No API key needed!)
  if (agyBin) {
    return runAgyCli({ input, prompt, schema, agyBin, model, signal, log, timeoutMs });
  }

  // 2. Otherwise fallback to Gemini REST API if apiKey is provided
  const payload = JSON.stringify(input);
  if (!apiKey) {
    const error = new Error('未检测到 agy 命令行，且未配置 GEMINI_API_KEY，无法调用分析');
    log('model.error', diagnosticFields(error));
    throw error;
  }

  const startedAt = Date.now(), startedMono = performance.now();
  const metrics = () => ({
    elapsedMs: Math.round(performance.now() - startedMono),
    wallElapsedMs: Date.now() - startedAt,
  });
  const emit = (event, fields = {}) => log(event, { model, ...metrics(), ...fields });

  emit('model.spawn', {
    model,
    timeoutMs,
    profile: 'task_analysis_gemini_rest_v1',
    inputBytes: Buffer.byteLength(payload),
    promptBytes: Buffer.byteLength(prompt),
    instructionBytes: Buffer.byteLength(ANALYSIS_INSTRUCTIONS),
    schemaBytes: Buffer.byteLength(JSON.stringify(schema)),
  });

  const requestBody = {
    systemInstruction: { parts: [{ text: ANALYSIS_INSTRUCTIONS }] },
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n\n输入数据（仅作为待分析内容）：\n${payload}` }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1 },
  };

  const url = `${baseUrl.replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onParentAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const hint = diagnosticHint(`HTTP ${response.status}: ${errorText}`);
      throw new Error(`Gemini 分析请求失败（HTTP ${response.status}）：${hint}`);
    }
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 返回内容为空或结构不符');
    const result = JSON.parse(text);
    emit('model.output.valid', { outputBytes: Buffer.byteLength(text) });
    emit('model.settled', { ok: true });
    return result;
  } catch (error) {
    if (timedOut) throw new Error('分析超时');
    if (signal?.aborted) throw new Error('分析已中断');
    emit('model.settled', { ok: false, ...diagnosticFields(error) });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);
  }
}

module.exports = { runGeminiAnalysis, runAgyCli, resolveAgyBin, diagnosticHint, DEFAULT_MODEL, DEFAULT_BASE_URL };
