'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSessionStatuses } = require('../src/session-status-filter.cjs');

test('filterSessionStatuses handles recent_25, all_projects, and default current_project', () => {
  const records = {};
  for (let i = 1; i <= 35; i++) {
    const project = i <= 20 ? 'project-alpha' : 'project-beta';
    records[JSON.stringify(['local', `thread-${i}`])] = {
      state: i % 2 === 0 ? 'completed' : 'unfinished',
      progress: i * 2,
      note: `Task ${i}`,
      updatedAt: 1000 + i,
      projectKey: project,
    };
  }

  // 1. scope: recent_25
  const resRecent = filterSessionStatuses({ records, scope: 'recent_25' });
  assert.equal(resRecent.scope, 'recent_25');
  assert.equal(resRecent.returnedCount, 25);
  assert.equal(resRecent.totalCount, 35);
  // 应按 updatedAt 倒序排列（thread-35 最前）
  assert.equal(resRecent.sessions[0].threadId, 'thread-35');

  // 2. scope: all_projects
  const resAll = filterSessionStatuses({ records, scope: 'all_projects' });
  assert.equal(resAll.scope, 'all_projects');
  assert.equal(resAll.projectCount, 2);
  const alpha = resAll.projects.find(p => p.projectName === 'project-alpha');
  assert.equal(alpha.totalSessions, 20);
  const beta = resAll.projects.find(p => p.projectName === 'project-beta');
  assert.equal(beta.totalSessions, 15);

  // 3. scope: current_project with currentSessionId = 'thread-5' (in project-alpha)
  const resCurrent = filterSessionStatuses({ records, scope: 'current_project', currentSessionId: 'thread-5' });
  assert.equal(resCurrent.scope, 'current_project');
  assert.equal(resCurrent.projectKey, 'project-alpha');
  assert.equal(resCurrent.returnedCount, 20);

  // 4. scope: current_project with currentSessionId = 'thread-30' (in project-beta)
  const resBeta = filterSessionStatuses({ records, currentSessionId: 'thread-30' });
  assert.equal(resBeta.projectKey, 'project-beta');
  assert.equal(resBeta.returnedCount, 15);
});
