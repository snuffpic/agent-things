'use strict';
const path = require('node:path');
const { inspectGit, readProjectGit } = require('../../analysis-git.cjs');

async function detectCodexGit(request, threadId, probe = inspectGit) {
  try {
    const result = await request('thread/read', { threadId, includeTurns: false });
    const cwd = result?.thread?.cwd;
    if (!cwd || typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      return { status: 'checked', hasRepository: false, hasRemote: false, projectKnown: true, projectPath: null, checkedAt: Date.now() };
    }
    const gitInfo = await probe(cwd);
    return { ...gitInfo, projectPath: cwd, projectKnown: true, checkedAt: Date.now() };
  } catch (error) {
    if (['REQUEST_TIMEOUT', 'REQUEST_CANCELLED', 'APP_SERVER_TIMEOUT'].includes(error.code) || error.name === 'AbortError') throw error;
    return { status: 'unknown', hasRepository: false, hasRemote: false, checkedAt: Date.now() };
  }
}

module.exports = {
  detectCodexGit,
  inspectGit,
  readProjectGit,
};
