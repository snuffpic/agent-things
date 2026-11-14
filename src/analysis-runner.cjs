'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { resolveCodexBin } = require('./resolve.cjs');
const { diagnosticFields } = require('./analysis-log.cjs');

const disabled = ['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks', 'browser_use', 'computer_use', 'multi_agent', 'view_image', 'sleep_tool', 'code_mode_host',
  'code_mode', 'code_mode_only', 'goals', 'current_time_reminder'];
const { ANALYSIS_INSTRUCTIONS, measureRequest } = require('./analysis-budget.cjs');
const { resolveLatestLuna, resolveLowCostModel } = require('./model-router.cjs');
const ALLOWED_ITEMS = new Set(['agent_message', 'reasoning', 'error']);

function prepareModelCatalog({ home, directory, binary, log = () => {},
  readVersion = executable => execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }) }) {
  const started = performance.now();
  const fallback = reason => { log('catalog.fallback', { reason, elapsedMs: Math.round(performance.now() - started) }); return null; };
  try {
    const source = path.join(home, 'models_cache.json');
    const cached = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (!Array.isArray(cached.models) || !cached.models.every(model => model && typeof model.slug === 'string')) return fallback('invalid_cache');
    const lunaModel = resolveLatestLuna(cached.models);
    if (!lunaModel) return fallback('model_missing');
    // A credential-file update invalidates this shortcut without reading credentials.
    if (fs.statSync(path.join(home, 'auth.json')).mtimeMs > fs.statSync(source).mtimeMs) return fallback('account_changed');
    const version = String(readVersion(binary)).match(/\b(\d+\.\d+\.\d+)/)?.[1];
    if (!version || cached.client_version !== version) return fallback('version_mismatch');
    const fetchedAt = Date.parse(cached.fetched_at);
    if (!Number.isFinite(fetchedAt)) return fallback('invalid_cache');
    const file = path.join(directory, 'model-catalog.json');
    // This temporary catalog describes a JSON-only analysis process. Model
    // instructions, context limits and other capability metadata remain intact.
    const contents = JSON.stringify({ models: cached.models.map(model => model.slug === lunaModel
      ? { ...model, tool_mode: 'direct', apply_patch_tool_type: null, experimental_supported_tools: [] } : model) });
    fs.writeFileSync(file, contents, { mode: 0o600 });
    log('catalog.ready', { model: lunaModel, catalogVersion: version, cacheAgeMs: Date.now() - fetchedAt,
      bytes: Buffer.byteLength(contents), elapsedMs: Math.round(performance.now() - started) });
    return file;
  } catch { return fallback('unavailable'); }
}

// Error text can contain request or session content. Report only recognized categories.
function diagnosticHint(text) {
  if (/unauthorized|authentication|not logged in|login|sign.in|\b401\b/i.test(text)) return '请检查 Codex 登录状态';
  if (/model.*(not found|unavailable|not supported|access)|model_not_found/i.test(text)) return '模型不可用或账户无权使用';
  if (/rate.limit|quota|\b429\b/i.test(text)) return '模型请求达到限制';
  if (/context.length|context.window|too many tokens|maximum context/i.test(text)) return '输入超过模型上下文限制';
  if (/stream.*(disconnect|closed|reset|error)|connection.*(reset|closed)|unexpected eof/i.test(text)) return '模型响应连接中断';
  if (/timed?.?out|timeout/i.test(text)) return '模型请求超时';
  const status = text.match(/\b(?:http(?: status)?|status(?: code)?)[:= ]+(\d{3})\b/i);
  if (status) return `上游服务返回 HTTP ${status[1]}`;
  return '请检查 Codex 日志及模型配置';
}

async function runAnalysis({ input, prompt, schema, binary = resolveCodexBin(), spawnProcess = spawn, timeoutMs = 120000, signal, log = () => {},
  catalogHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), model = null, maxBytes = 192000, tokenBudget }) {
  const payload = JSON.stringify(input);
  if (!measureRequest({ input, prompt, schema, maxBytes, tokenBudget }).fits) throw new Error('分析内容超过单批预算');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-status-analysis-'));
  const schemaFile = path.join(directory, 'schema.json');
  const instructionsFile = path.join(directory, 'instructions.txt');
  const outputFile = path.join(directory, 'answer.json');
  fs.writeFileSync(schemaFile, JSON.stringify(schema), { mode: 0o600 });
  fs.writeFileSync(instructionsFile, ANALYSIS_INSTRUCTIONS, { mode: 0o600 });
  const stdin = `${prompt}\n\n输入数据（仅作为待分析内容）：\n${payload}`;
  const selectedModel = model || resolveLowCostModel('codex', { codexHome: catalogHome });
  const args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '-c', 'project_doc_max_bytes=0',
    '-c', 'analytics.enabled=false', '-c', `model_instructions_file=${JSON.stringify(instructionsFile)}`,
    '-c', 'skills.include_instructions=false', '-c', 'include_collaboration_mode_instructions=false',
    '-c', 'include_environment_context=false', '-c', 'agents.enabled=false', '-c', 'tools.experimental_request_user_input.enabled=false', '--sandbox', 'read-only',
    '--model', selectedModel, '--cd', directory, '--output-schema', schemaFile, '--output-last-message', outputFile,
    ...disabled.flatMap(name => ['--disable', name]), '-'];
  try {
    const catalog = prepareModelCatalog({ home: catalogHome, directory, binary, log });
    if (catalog) args.splice(args.length - 1, 0, '-c', `model_catalog_json=${JSON.stringify(catalog)}`);
    await new Promise((resolve, reject) => {
      let child, timer, deadlineTimer, heartbeat, killTimer, drainTimer, exited = false, exitCode = null, settled = false, buffer = '', diagnostic = '', failure = null;
      let itemDiagnostic = '', terminalDiagnostic = '', terminal = null;
      const startedAt = Date.now(), startedMono = performance.now();
      let lastEventAt = startedMono, eventCount = 0, lastDiagnostic = '';
      const metrics = () => ({ elapsedMs: Math.round(performance.now() - startedMono), wallElapsedMs: Date.now() - startedAt,
        idleMs: Math.round(performance.now() - lastEventAt), eventCount });
      const emit = (event, fields = {}) => log(event, { pid: child?.pid, ...metrics(), ...fields });
      const sendSignal = signal => emit('model.signal', { signal, sent: child?.kill(signal) });
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearInterval(deadlineTimer); clearInterval(heartbeat); clearTimeout(killTimer); clearTimeout(drainTimer); signal?.removeEventListener('abort', onAbort);
        emit('model.settled', { ok: !error, ...(error ? diagnosticFields(error) : {}) });
        if (error) reject(error); else resolve();
      };
      const abort = error => {
        if (failure || settled) return;
        failure = error;
        emit('model.stop', { ...diagnosticFields(error), timeoutMs,
          overshootMs: Math.max(0, Date.now() - startedAt - timeoutMs) });
        if (!exited) {
          sendSignal('SIGTERM');
          killTimer = setTimeout(() => { if (!exited) sendSignal('SIGKILL'); }, 1500);
        }
      };
      const onAbort = () => abort(new Error('分析已中断'));
      try { child = spawnProcess(binary, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (error) { finish(error); return; }
      emit('model.spawn', { model: 'gpt-6-luna', parentPid: process.pid, timeoutMs, profile: 'task_analysis_v1', inputBytes: Buffer.byteLength(payload),
        promptBytes: Buffer.byteLength(prompt), instructionBytes: Buffer.byteLength(ANALYSIS_INSTRUCTIONS),
        schemaBytes: Buffer.byteLength(JSON.stringify(schema)), stdinBytes: Buffer.byteLength(stdin) });
      heartbeat = setInterval(() => emit('model.wait', { reason: failure ? 'stopping' : terminal ? 'process_exit' : 'response' }), 15000);
      if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
      const deadline = Date.now() + timeoutMs;
      timer = setTimeout(() => abort(new Error('分析超时')), timeoutMs);
      deadlineTimer = setInterval(() => {
        if (Date.now() >= deadline) abort(new Error('分析超时'));
      }, Math.min(timeoutMs, 1000));
      child.on('error', error => {
        emit('model.process.error', diagnosticFields(error));
        failure ||= error;
        if (!child.pid && !exited) finish(failure);
      });
      child.stderr.on('data', chunk => {
        diagnostic = (diagnostic + chunk.toString()).slice(-4096);
        const fields = diagnosticFields(diagnostic), signature = JSON.stringify(fields);
        if (signature !== lastDiagnostic) { emit('model.diagnostic', fields); lastDiagnostic = signature; }
      });
      const parseLine = line => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { emit('model.protocol.error', { bytes: Buffer.byteLength(line) }); return abort(new Error('分析事件格式无效')); }
        lastEventAt = performance.now(); eventCount++;
        const eventType = ['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error'].includes(event.type) ? event.type : 'unknown';
        const itemType = ['agent_message', 'reasoning', 'error', 'command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'todo_list'].includes(event.item?.type) ? event.item.type : undefined;
        emit('model.event', { eventType, itemType, bytes: Buffer.byteLength(line),
          inputTokens: event.usage?.input_tokens, outputTokens: event.usage?.output_tokens, cachedInputTokens: event.usage?.cached_input_tokens });
        if (event.type === 'error' || event.type === 'turn.failed' || event.item?.type === 'error') {
          emit('model.event.diagnostic', diagnosticFields(event.item?.message || event.error?.message || event.message || ''));
        }
        if (event.type?.startsWith('item.') && event.item) {
          if (!ALLOWED_ITEMS.has(event.item.type)) {
            return abort(new Error(`分析请求了不允许的工具：${String(event.item.type).replace(/[^a-z0-9_]/gi, '').slice(0, 80)}`));
          }
          if (event.item.type === 'error' && typeof event.item.message === 'string') itemDiagnostic = event.item.message.slice(0, 4096);
        }
        if (event.type === 'turn.completed') terminal = terminal === 'failed' || terminal === 'error' ? terminal : 'completed';
        if (event.type === 'turn.failed') {
          terminal = 'failed';
          terminalDiagnostic = typeof event.error?.message === 'string' ? event.error.message.slice(0, 4096) : '';
        }
        if (event.type === 'error') {
          terminal = 'error';
          terminalDiagnostic = typeof event.message === 'string' ? event.message.slice(0, 4096) : '';
        }
      };
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.length > 1024 * 1024) return abort(new Error('分析事件过大'));
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          parseLine(line);
          if (failure) return;
        }
      });
      const complete = code => {
        if (settled) return;
        if (!failure && buffer.trim()) parseLine(buffer);
        if (failure) return finish(failure);
        if (code === 0 && terminal === 'completed') return finish();
        const source = terminal === 'failed' ? 'turn.failed' : terminal === 'error' ? 'error'
          : terminal !== 'completed' ? '未收到 turn.completed' : `退出码 ${code}`;
        const hint = diagnosticHint(`${terminalDiagnostic} ${itemDiagnostic} ${diagnostic}`);
        finish(new Error(`分析进程未成功完成（${source}）：${hint}`));
      };
      child.once('exit', (code, signal) => {
        exited = true; exitCode = code;
        emit('model.exit', { code, signal: signal ?? child.signalCode ?? null });
        // Descendants can keep stdio open after the CLI exits. Allow buffered events to
        // drain, then release inherited pipes so they cannot keep the job pending forever.
        drainTimer = setTimeout(() => {
          emit('model.output.drain_timeout');
          child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy();
          complete(exitCode);
        }, 500);
      });
      child.once('close', (code, signal) => { emit('model.close', { code, signal }); complete(exited ? exitCode : code); });
      child.stdin.on('error', error => { emit('model.stdin.error', diagnosticFields(error)); abort(error); });
      child.stdin.end(stdin);
    });
    try {
      const contents = fs.readFileSync(outputFile, 'utf8');
      const result = JSON.parse(contents);
      log('model.output.valid', { outputBytes: Buffer.byteLength(contents) });
      return result;
    } catch (error) { log('model.output.failed', diagnosticFields(error)); throw error; }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); log('model.cleanup.complete'); }
}
module.exports = { runAnalysis, prepareModelCatalog };
