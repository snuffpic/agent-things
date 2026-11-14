'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function inspectGit(cwd, { signal, timeoutMs = 2000, executeFile = execute } = {}) {
  if (typeof cwd !== 'string' || !cwd) return { status: 'unknown', hasRepository: false, hasRemote: false };
  const { requestBudget } = require('./request-budget.cjs');
  const budget = requestBudget({ timeoutMs, signal });
  try {
    const command = args => executeFile('git', ['-C', cwd, ...args], { timeout: Math.ceil(budget.remaining()), signal: budget.signal,
      maxBuffer: 65536, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } });
    return await budget.run(async () => {
      await command(['rev-parse', '--git-dir']);
      const { stdout } = await command(['remote']);
      return { status: 'checked', hasRepository: true, hasRemote: Boolean(stdout.trim()) };
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return { status: error.code === 128 ? 'checked' : 'unknown', hasRepository: false, hasRemote: false };
  } finally { budget.dispose(); }
}

async function readProjectGit(request, threadId, probe = inspectGit) {
  try {
    const result = await request('thread/read', { threadId, includeTurns: false });
    return { ...await probe(result?.thread?.cwd), projectPath: result?.thread?.cwd || null, projectKnown: true, checkedAt: Date.now() };
  } catch { return { status: 'unknown', hasRemote: false, checkedAt: Date.now() }; }
}
function requireGitRemote(git, lang) {
  const { readConfiguredLang } = require('./i18n.cjs');
  const { progressError } = require('./progress-error.cjs');
  const activeLang = lang || readConfiguredLang();
  const en = activeLang === 'en';
  if (git?.status === 'unknown') throw progressError('HOST_UNAVAILABLE', en ? 'Unable to inspect Git info right now, please retry' : '暂时无法检测 Git 信息，请重试', undefined, activeLang);
  if (!git?.hasRemote) throw progressError('INVALID_ARGUMENT', en ? 'Git remote is not configured for this project' : '此项目尚未配置 Git 远端', undefined, activeLang);
}
module.exports = { inspectGit, readProjectGit, requireGitRemote };
