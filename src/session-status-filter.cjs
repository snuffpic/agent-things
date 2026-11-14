'use strict';
const { normalizeProjectPath } = require('./project-path.cjs');

/**
 * 根据作用域安全过滤会话状态记录，防止 Token 上下文膨胀。
 *
 * @param {Object} options
 * @param {Object} options.records - store snapshot 中的记录字典
 * @param {string} [options.scope='current_project'] - 'current_project' | 'recent_25' | 'all_projects'
 * @param {string} [options.currentSessionId] - 当前会话 ID
 * @param {Function} [options.getProjectKey] - 提取会话所属项目的函数，默认基于 hostId 与 cwd/path
 * @returns {Object} 结构化过滤结果
 */
function filterSessionStatuses({ records = {}, scope = 'current_project', currentSessionId = '', projectPath = '', getProjectKey = null }) {
  const entries = Object.entries(records).filter(([, record]) => record?.state).map(([rawKey, rec]) => {
    const safeRec = rec || {};
    let host = 'local', threadId = rawKey;
    try {
      const parsed = JSON.parse(rawKey);
      if (Array.isArray(parsed)) {
        host = parsed[0];
        threadId = parsed[1];
      }
    } catch { /* 兼容纯字符串 key */ }

    const cleanThreadId = String(threadId).replace(/^local:/, '');
    const projectKey = getProjectKey ? getProjectKey(rawKey, safeRec) : (safeRec.projectPath ? normalizeProjectPath(safeRec.projectPath) : safeRec.projectKey || null);

    return {
      key: rawKey,
      host,
      threadId: cleanThreadId,
      projectKey,
      state: safeRec.state || 'unstarted',
      progress: typeof safeRec.progress === 'number' ? safeRec.progress : null,
      note: safeRec.note ? String(safeRec.note).slice(0, 1000) : '',
      revision: safeRec.revision || 0,
      updatedAt: safeRec.updatedAt || safeRec.createdAt || 0,
      hasTasks: Boolean(safeRec.ledger?.tasks?.length),
      taskSummary: safeRec.ledger ? {
        total: safeRec.ledger.tasks?.length || 0,
        done: safeRec.ledger.tasks?.filter(t => t.status === 'done').length || 0,
        remaining: safeRec.ledger.tasks?.filter(t => t.status !== 'done').length || 0,
      } : null,
    };
  });

  // 1. 最近 25 个独立活跃会话
  if (scope === 'recent_25') {
    const sorted = [...entries].sort((a, b) => (b.updatedAt || b.revision) - (a.updatedAt || a.revision)).slice(0, 25);
    return {
      scope: 'recent_25',
      totalCount: entries.length,
      returnedCount: sorted.length,
      sessions: sorted.map(s => ({
        threadId: s.threadId,
        state: s.state,
        progress: s.progress,
        note: s.note,
        updatedAt: s.updatedAt,
        taskSummary: s.taskSummary,
      })),
    };
  }

  // 2. 全量项目概览（聚合统计，避免详细展开）
  if (scope === 'all_projects') {
    const projectsMap = new Map();
    for (const item of entries) {
      const pKey = item.projectKey || '独立会话';
      if (!projectsMap.has(pKey)) {
        projectsMap.set(pKey, {
          projectName: pKey,
          totalSessions: 0,
          completedSessions: 0,
          unfinishedSessions: 0,
          pushedSessions: 0,
          averageProgress: 0,
          progressSum: 0,
          sessionsWithProgress: 0,
        });
      }
      const pStats = projectsMap.get(pKey);
      pStats.totalSessions += 1;
      if (item.state === 'completed') pStats.completedSessions += 1;
      else if (item.state === 'pushed') pStats.pushedSessions += 1;
      else if (item.state === 'unfinished') pStats.unfinishedSessions += 1;

      if (typeof item.progress === 'number') {
        pStats.progressSum += item.progress;
        pStats.sessionsWithProgress += 1;
      }
    }

    const projectOverviews = [...projectsMap.values()].map(p => ({
      projectName: p.projectName,
      totalSessions: p.totalSessions,
      completed: p.completedSessions + p.pushedSessions,
      inProgress: p.unfinishedSessions,
      averageProgress: p.sessionsWithProgress > 0 ? Math.round(p.progressSum / p.sessionsWithProgress) : 0,
    }));

    return {
      scope: 'all_projects',
      projectCount: projectOverviews.length,
      totalSessions: entries.length,
      projects: projectOverviews,
    };
  }

  // 3. 当前项目（默认推荐，Token 占用最低）
  const cleanCurrentId = String(currentSessionId || '').replace(/^local:/, '');
  const current = entries.find(entry => entry.key === currentSessionId || entry.host === 'local' && entry.threadId === cleanCurrentId);
  const targetProjectKey = projectPath ? normalizeProjectPath(projectPath) : current?.projectKey || null;
  const filtered = targetProjectKey
    ? entries.filter(entry => entry.projectKey === targetProjectKey)
    : entries.filter(entry => entry === current);

  return {
    scope: 'current_project',
    projectKey: targetProjectKey || '当前上下文工程',
    returnedCount: filtered.length,
    sessions: filtered.map(s => ({
      threadId: s.threadId,
      state: s.state,
      progress: s.progress,
      note: s.note,
      updatedAt: s.updatedAt,
      taskSummary: s.taskSummary,
    })),
  };
}

module.exports = {
  filterSessionStatuses,
};
