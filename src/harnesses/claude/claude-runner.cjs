'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { getAnalysisInstructions } = require('../../analysis-budget.cjs');
const { readConfiguredLang } = require('../../i18n.cjs');

function resolveClaudeBin() {
  const root = path.join(os.homedir(), 'Library/Application Support/Claude/claude-code');
  if (fs.existsSync(root)) {
    const versions = fs.readdirSync(root).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => {
      const x = a.split('.').map(Number), y = b.split('.').map(Number);
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
    });
    for (const version of versions) for (const build of fs.readdirSync(path.join(root, version))) {
      const file = path.join(root, version, build, 'claude.app/Contents/MacOS/claude');
      if (fs.existsSync(file)) return file;
    }
  }
  for (const file of [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) if (fs.existsSync(file)) return file;
  throw new Error('未找到 Claude Code 运行时，请先在 Claude 中启动一次 Code 会话');
}

async function runClaudeAnalysis({ input, prompt, schema, signal, log = () => {}, binary = resolveClaudeBin(), model = 'haiku', timeoutMs = 120000, lang = readConfiguredLang(), instructions }) {
  const en = lang === 'en';
  const activeInstructions = instructions || getAnalysisInstructions(lang);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-things-claude-'));
  const settings = { disableAllHooks: true, enabledPlugins: {} };
  const args = ['--print', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
    '--disable-slash-commands', '--setting-sources', '', '--settings', JSON.stringify(settings), '--system-prompt', `${prompt}\n${activeInstructions}`];
  const started = performance.now();
  log('model.spawn', { model, profile: 'claude_cli_no_tools_v1', inputBytes: Buffer.byteLength(JSON.stringify(input)), lang });
  try {
    return await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error(en ? 'Analysis aborted' : '分析已中断')); return; }
      const child = spawn(binary, args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDECODE: '', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } });
      let stdout = '', stderr = '', failure = null, forceStop;
      const stop = error => {
        failure ||= error; child.kill('SIGTERM');
        if (!forceStop) forceStop = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1500);
      };
      const abort = () => stop(new Error(en ? 'Analysis aborted' : '分析已中断'));
      const timer = setTimeout(() => stop(new Error(en ? 'Claude analysis request timed out' : 'Claude 分析请求超时')), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) stop(new Error(en ? 'Claude analysis output too large' : 'Claude 分析输出过大')); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); });
      child.stdin.end(JSON.stringify(input));
      child.once('error', error => { failure ||= error; });
      child.once('close', code => {
        clearTimeout(timer); clearTimeout(forceStop); signal?.removeEventListener('abort', abort);
        log('model.settled', { model, elapsedMs: Math.round(performance.now() - started), ok: !failure && code === 0 });
        if (failure) { reject(failure); return; }
        if (code !== 0) {
          reject(new Error(/auth|login|credential|401/i.test(stderr)
            ? (en ? 'Claude analysis runtime not logged in; sign in to Claude Code first' : 'Claude 分析运行时未登录，请先完成 Claude Code 登录')
            : (en ? 'Claude analysis runtime failed; check login and model access' : 'Claude 分析运行时返回错误，请检查登录与模型权限')));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (result.is_error) throw new Error(en ? 'Claude failed to complete structured analysis; check model access and quota' : 'Claude 未完成结构化分析，请检查模型权限与额度');
          const value = result.structured_output || (typeof result.result === 'string' ? JSON.parse(result.result) : null);
          if (!value || typeof value !== 'object') throw new Error(en ? 'Claude did not return structured analysis output' : 'Claude 未返回结构化分析结果');
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

module.exports = { runClaudeAnalysis, resolveClaudeBin };
