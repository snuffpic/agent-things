'use strict';
const { AnalysisAppServer } = require('../../analysis-app-server.cjs');
const { detectCodexGit } = require('./codex-git.cjs');
const { resolveTaskSources } = require('../../task-provenance.cjs');
const { inspectGit } = require('../../analysis-git.cjs');
const { requestBudget } = require('../../request-budget.cjs');
const { normalizeProjectPath } = require('../../project-path.cjs');

function createCodexProgressContext({ store, timeoutMs = 5000, makeServer = () => new AnalysisAppServer({ timeoutMs }), probe = inspectGit } = {}) {
  const withServer = async (operation, { signal } = {}) => {
    const budget = requestBudget({ timeoutMs, signal });
    let server;
    try {
      server = makeServer();
      return await budget.run(async () => {
        server.timeoutMs = budget.remaining();
        await server.initialize();
        return operation((method, params) => {
          server.timeoutMs = budget.remaining();
          return server.request(method, params);
        }, budget.signal);
      });
    } finally { budget.dispose(); await server?.close(); }
  };
  const gitRequests = new Map();
  const checkProject = (cwd, signal) => {
    signal?.throwIfAborted();
    let job = gitRequests.get(cwd);
    if (!job || job.controller.signal.aborted) {
      job = { controller: new AbortController(), waiting: 0 };
      const current = job;
      job.promise = Promise.resolve().then(() => probe(cwd, { signal: current.controller.signal })).finally(() => {
        if (gitRequests.get(cwd) === current) gitRequests.delete(cwd);
      });
      gitRequests.set(cwd, job);
    }
    job.waiting++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', abort);
        if (--job.waiting === 0) job.controller.abort();
        callback(value);
      };
      const abort = () => finish(reject, signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      job.promise.then(value => finish(resolve, value), error => finish(reject, error));
      if (signal?.aborted) abort();
    });
  };
  return {
    async projectGit(key, options = {}) {
      const record = store?.snapshot().records[key];
      if (record?.projectSource === 'host' && record.projectPath) return {
        ...await checkProject(record.projectPath, options.signal), projectKnown: true, projectPath: record.projectPath, checkedAt: Date.now(),
      };
      const git = await withServer((request, signal) => detectCodexGit(request, JSON.parse(key)[1].replace(/^local:/, ''), cwd => checkProject(cwd, signal)), options);
      if (git.projectKnown && store) store.enrichProjects({ [key]: git.projectPath });
      return git;
    },
    resolveSources: (key, tasks, options = {}) => withServer(request => resolveTaskSources(request, key, tasks, options), options),
    async resolveProjects(keys) {
      const local = keys.filter(key => { const [host, id] = JSON.parse(key); return host === 'local' && /^[0-9a-f-]{36}$/i.test(id.replace(/^local:/, '')); });
      if (!local.length) return {};
      return withServer(async request => {
        const projects = {};
        for (const key of local) {
          try {
            const result = await request('thread/read', { threadId: JSON.parse(key)[1].replace(/^local:/, ''), includeTurns: false });
            const cwd = result?.thread?.cwd;
            projects[key] = cwd ? normalizeProjectPath(cwd) : null;
          } catch (error) {
            if (error.code === 'APP_SERVER_TIMEOUT') throw error;
            // Deleted/imported chats can retain a mark after host metadata disappears.
          }
        }
        return projects;
      });
    },
  };
}

module.exports = { createCodexProgressContext };
