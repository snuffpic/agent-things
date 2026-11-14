'use strict';
const crypto = require('node:crypto');
const STATES = new Set(['todo', 'in_progress', 'blocked', 'needs_verification', 'done']);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

function summarizeTasks(ledger) {
  const totalTasks = ledger.tasks.length;
  const completedTasks = ledger.tasks.filter(task => task.status === 'done').length;
  const remainingTasks = totalTasks - completedTasks;
  const known = totalTasks > 0;
  const percent = known ? Math.round(completedTasks * 100 / totalTasks) : null;
  return { totalTasks, completedTasks, remainingTasks, percent,
    remainingPercent: percent === null ? null : 100 - percent,
    basis: totalTasks ? `已完成 ${completedTasks}/${totalTasks} 项任务，剩余 ${remainingTasks} 项（${100 - percent}%）` : '暂无任务' };
}

function mergeAnalysis(previous, output, allowedRefs) {
  const keys = ['summary', 'tasks', 'removedTaskIds', ...(Object.hasOwn(output || {}, 'gitPush') ? ['gitPush'] : [])];
  if (!exactKeys(output, keys) || typeof output.summary !== 'string' || !Array.isArray(output.tasks) || !Array.isArray(output.removedTaskIds)) throw new Error('分析结果格式无效');
  const known = new Map((previous?.tasks || []).map(task => [task.id, task]));
  const removed = new Set();
  for (const id of output.removedTaskIds) {
    if (typeof id !== 'string' || !known.has(id) || removed.has(id)) throw new Error('移除任务标识无效');
    removed.add(id);
  }
  const seen = new Set(), changes = [];
  const refs = new Set(allowedRefs);
  let gitPush = previous?.gitPush;
  if (Object.hasOwn(output, 'gitPush')) {
    const value = output.gitPush;
    if (!exactKeys(value, ['status', 'evidenceRefs']) || !['unknown', 'not_pushed', 'pushed'].includes(value.status) ||
        !Array.isArray(value.evidenceRefs) || value.evidenceRefs.some(ref => typeof ref !== 'string' || !refs.has(ref)) ||
        (value.status === 'pushed' && !value.evidenceRefs.length)) throw new Error('推送状态或证据无效');
    gitPush = { status: value.status, evidenceRefs: [...new Set(value.evidenceRefs)] };
  }
  for (const [index, task] of output.tasks.entries()) {
    if (!exactKeys(task, ['knownTaskId', 'title', 'status', 'evidenceRefs', ...(Object.hasOwn(task, 'summary') ? ['summary'] : [])]) ||
        (task.knownTaskId !== null && typeof task.knownTaskId !== 'string') ||
        typeof task.title !== 'string' || !task.title.trim() || !STATES.has(task.status) || !Array.isArray(task.evidenceRefs) ||
        task.evidenceRefs.some(ref => typeof ref !== 'string' || !refs.has(ref))) throw new Error('任务结果或证据无效');
    if (Object.hasOwn(task, 'summary') && (typeof task.summary !== 'string' || !task.summary.trim() || [...task.summary].length > 20)) {
      const length = typeof task.summary === 'string' ? [...task.summary].length : 0;
      throw new Error(`第 ${index + 1} 项任务“${task.title}”的短总结无效：当前 ${length} 个字符，要求为1至20个字符，请修改该项 summary`);
    }
    if (task.knownTaskId !== null && (!known.has(task.knownTaskId) || seen.has(task.knownTaskId) || removed.has(task.knownTaskId))) throw new Error('任务标识冲突');
    const id = task.knownTaskId ?? crypto.randomUUID();
    seen.add(id);
    const summary = task.summary ?? (known.get(id)?.title === task.title ? known.get(id).summary : undefined);
    changes.push({ id, title: task.title, ...(summary ? { summary } : {}), status: task.status, evidenceRefs: [...new Set(task.evidenceRefs)] });
  }
  const result = new Map([...known].filter(([id]) => !removed.has(id)));
  for (const task of changes) result.set(task.id, task);
  const ledger = { summary: output.summary, tasks: [...result.values()], ...(gitPush ? { gitPush } : {}) };
  return { ...ledger, ...summarizeTasks(ledger) };
}
module.exports = { mergeAnalysis, summarizeTasks };
