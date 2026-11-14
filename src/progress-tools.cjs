'use strict';
const { sessionView } = require('./session-view.cjs');
const { requireGitRemote } = require('./analysis-git.cjs');
const { normalizeProjectPath } = require('./project-path.cjs');
const { filterSessionStatuses } = require('./session-status-filter.cjs');
const taskSchema = {
  type: 'object',
  properties: {
    knownTaskId: { type: ['string', 'null'] }, title: { type: 'string' },
    summary: { type: 'string', maxLength: 20, description: '列表短总结，最多20个字符，中文、英文、数字与标点均计数。概括任务动作和对象。' },
    status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'needs_verification', 'done'] },
    evidenceRefs: { type: 'array', items: { type: 'string' } },
    source: { type: 'object', description: '原始用户提问或最终答复中的连续原文，由服务验证并关联实际消息位置。', properties: { locator: { type: 'string', minLength: 10, maxLength: 240 }, turnId: { type: 'string' }, itemId: { type: 'string' } }, required: ['locator'], additionalProperties: false },
  },
  required: ['knownTaskId', 'title', 'status'], additionalProperties: false,
};
const identity = { project_path: { type: 'string' }, conversation_id: { type: 'string', minLength: 1 }, expected_revision: { type: 'integer', minimum: 0 } };
const tools = [
  { name: 'clear_session_progress', description: '立即清除指定会话的进度、全部已完成及剩余任务、备注和进展记录。先读取当前版本再清除。', inputSchema: { type: 'object', properties: identity, required: ['conversation_id', 'expected_revision'], additionalProperties: false } },
  { name: 'get_session_progress', description: '读取会话当前记录、任务清单、任务计算进度与版本。', inputSchema: { type: 'object', properties: identity, required: ['conversation_id'] } },
  { name: 'update_session_progress', description: '记录人工指定的百分比和备忘。自动分析任务时请使用 update_session_tasks，同步任务并由程序计算比例。', inputSchema: {
    type: 'object', properties: { ...identity, state: { type: 'string', enum: ['unstarted', 'unfinished', 'completed', 'pushed'] }, progress: { type: 'integer', minimum: 0, maximum: 100 }, note: { type: 'string', maxLength: 4000 } }, required: ['conversation_id', 'state', 'progress'],
  } },
  { name: 'update_session_tasks', description: '首次创建或增量更新任务清单。首次 expected_revision=0、新任务 knownTaskId=null；每项任务 summary 最多20个字符。已有记录先读取版本，提交新增或变化项，保留其余任务。', inputSchema: {
    type: 'object', properties: { ...identity, summary: { type: 'string', maxLength: 4000 }, tasks: { type: 'array', items: taskSchema }, removedTaskIds: { type: 'array', items: { type: 'string' } } }, required: ['conversation_id', 'expected_revision', 'summary', 'tasks', 'removedTaskIds'],
  } },
  { name: 'list_all_session_statuses', description: '按实际工程身份、最近25条或全局汇总查询会话。', inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['current_project', 'recent_25', 'all_projects'] }, current_session_id: { type: 'string' }, project_path: { type: 'string' } } } },
];

async function callProgressTool(store, name, args, { projectGit = async () => ({ hasRemote: false }), resolveProjects = async () => ({}), resolveSources = async () => { throw new Error('当前宿主未提供消息来源解析'); }, onChange = () => {} } = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数无效');
  if (name === 'list_all_session_statuses') {
    const marked = store.snapshot().records;
    const missing = Object.keys(marked).filter(key => marked[key].state && !marked[key].projectPath && !marked[key].projectResolved);
    if (missing.length && store.enrichProjects(await resolveProjects(missing))) await onChange();
    const snapshot = store.snapshot();
    const records = Object.fromEntries(Object.entries(snapshot.records).map(([key, record]) => [key, { ...record, ledger: store.data.analysis?.[key]?.ledger }]));
    return filterSessionStatuses({ records, scope: args.scope || 'current_project', currentSessionId: args.current_session_id || '', projectPath: args.project_path });
  }
  if (name === 'update_session_tasks' && !Number.isInteger(args.expected_revision)) throw new Error('任务更新需要提供读取时的版本');
  const key = store.resolveKey(args.conversation_id);
  if (name === 'clear_session_progress') {
    if (!Number.isInteger(args.expected_revision) || args.expected_revision < 0) throw new Error('清除进度需要提供读取时的版本');
    store.update({ key, expectedRevision: args.expected_revision, record: null });
    await onChange();
    return { cleared: true, key, revision: store.snapshot().records[key].revision, tasks: [], progress: null, session: sessionView(store, key) };
  }
  if (name === 'get_session_progress') {
    const previous = store.snapshot().records[key];
    if (previous?.state && !previous.projectPath && !previous.projectResolved) {
      const projects = await resolveProjects([key]);
      if (store.enrichProjects(projects)) await onChange();
    }
    const progress = store.getProgress(key);
    const record = store.snapshot().records[key];
    return progress ? { ...progress, session: sessionView(store, key) } : (record?.state === null ? { key, cleared: true, revision: record.revision, tasks: [], progress: null, session: sessionView(store, key) } : null);
  }
  if (!['update_session_progress', 'update_session_tasks'].includes(name)) throw new Error('未知工具');
  const previous = store.snapshot().records[key];
  const expectedRevision = args.expected_revision ?? previous?.revision ?? 0;
  let git;
  if ((name === 'update_session_progress' && args.state === 'pushed') || name === 'update_session_tasks') {
    git = await projectGit(key);
  }
  if (args.state === 'pushed') requireGitRemote(git);
  if (name === 'update_session_tasks') {
    const taskSources = args.tasks.some(task => task.source) ? await resolveSources(key, args.tasks) : [];
    const projectPath = normalizeProjectPath(git?.projectKnown ? git.projectPath : git?.projectPath || (previous?.projectSource === 'host' ? previous.projectPath : args.project_path || previous?.projectPath));
    store.applyTaskDelta({ key, expectedRevision, taskSources, delta: { summary: args.summary, tasks: args.tasks, removedTaskIds: args.removedTaskIds }, projectGit: { ...git, projectPath } });
  } else {
    store.update({ key, expectedRevision, record: { state: args.state, progress: args.progress, note: args.note || '' }, projectPath: args.project_path || git?.projectPath });
  }
  await onChange();
  return { ...store.getProgress(key), session: sessionView(store, key, { projectGit: git }) };
}

module.exports = { tools, callProgressTool };
