'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { renderAntigravityCardHtml, generateCardArtifact, colors, labels, taskLabels } = require('../src/antigravity-card.cjs');

test('antigravity-card: renders baseline card html with progress and tasks', () => {
  const html = renderAntigravityCardHtml({
    title: '测试会话任务进度',
    conversationId: 'test-convo-123',
    record: {
      progress: 60,
      state: 'unfinished',
      note: '下一步是测试验收',
      source: 'analysis',
      updatedAt: 1793930000000,
    },
    tasks: [
      { id: '1', title: '完成基础组件实现', summary: '组件实现', status: 'done', source: { locator: '请完成组件' } },
      { id: '2', title: '编写单元测试', summary: '编写测试', status: 'in_progress', source: { locator: '需要覆盖测试' } },
      { id: '3', title: '用户交互验收', summary: '交互验收', status: 'todo' },
      { id: '4', title: '文档同步', summary: '文档同步', status: 'todo' },
      { id: '5', title: '样式校验', summary: '样式校验', status: 'todo' },
    ],
    summary: '已完成1项，剩余4项',
    revision: 12,
  });

  assert.ok(html.includes('测试会话任务进度'), '应包含标题');
  assert.ok(html.includes('60%') || html.includes('>60<'), '应包含进度数值');
  assert.ok(html.includes('已完成 1 / 5 项任务'), '应统计任务数量');
  assert.ok(html.includes('剩余任务 4'), '应包含剩余任务分组与数量');
  assert.ok(html.includes('已完成任务'), '应包含已完成分组');
  assert.ok(html.includes('查看全部 4 条 ›'), '超过3项未完成任务应提供查看全部按钮');
  assert.ok(html.includes('查看来源'), '带来源的任务应包含查看来源按钮');
  assert.ok(html.includes('data-source='), '查看来源按钮应包含序列化的 data-source 属性');
  assert.ok(html.includes('id="btnOpenPane"'), '应包含右上角在侧栏打开按钮');
  assert.ok(html.includes('aria-label="在侧栏打开"'), '在侧栏打开按钮应包含无障碍标签');
  assert.ok(html.includes('class="open-pane-tip"'), '在侧栏打开按钮应包含悬浮提示气泡');
  assert.ok(html.includes('onOpenPaneClick()'), '按钮应绑定 onOpenPaneClick 处理函数');
  assert.ok(html.includes('AGENT_THINGS_OPEN_PANE'), '脚本应支持通过宿主端口发送在侧栏打开指令');
  assert.ok(html.includes('OPEN_SIDECAR'), '脚本应支持无宿主注入时的原生 OPEN_SIDECAR 兜底');
  assert.ok(html.includes('onSourceClick(this)'), '按钮应挂载 onSourceClick 联动函数');
  assert.ok(html.includes('class="task-source"'), '任务行应包含右侧滑出的 task-source 跳转按钮容器');
  assert.ok(!html.includes('查看来源 ▾'), '不应保留旧的下拉展开来源按钮文案');
  assert.ok(!html.includes('class="source-quote"'), '不应再渲染内联展开的 source-quote 原文块');
  assert.ok(html.includes('AGENT_THINGS_LOCATE'), '脚本应包含跨窗口 postMessage 消息派发');
  assert.ok(html.includes('请完成组件'), 'data-source 中仍应包含序列化的来源定位信息');
  assert.ok(html.includes('title-heading:hover .progress-pie'), '标题栏应具备 Hover 渐隐饼图交互动效');
  assert.ok(html.includes('.title-progress text'), '标题圆环数字应支持渐隐渐现动效');
  assert.ok(html.includes('progress-pie'), '应包含纯净饼图扇区');
  assert.ok(html.includes('手动记录会话状态'), '应包含手动调整视图');
  assert.ok(html.includes('range-node-label">50'), '应包含滑块吸附节点');
  assert.ok(html.includes('清空进度'), '应包含清空进度按钮');
  assert.ok(html.includes('clear-tooltip'), '清除进度应包含悬浮提示气泡');
  assert.ok(html.includes('更新进度'), '应包含更新进度按钮');
  assert.ok(html.includes('保存记录'), '应包含保存记录按钮');
  assert.ok(html.includes('清除进度'), '应包含清除进度按钮');
});

test('antigravity-card: handles empty or null record gracefully', () => {
  const html = renderAntigravityCardHtml({
    title: '空记录会话',
    conversationId: 'empty-convo',
    record: null,
    tasks: [],
  });

  assert.ok(html.includes('空记录会话'));
  assert.ok(html.includes('尚未开始') || html.includes('尚未记录进展'));
  assert.ok(html.includes('暂无任务统计'));
  assert.ok(html.includes('点击更新进度，整理这次会话的任务'));
});

test('antigravity-card: generateCardArtifact writes file and returns embed tag', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-card-test-'));
  try {
    const res = generateCardArtifact({
      conversationId: 'test-art-convo',
      title: '工件测试',
      record: { progress: 100, state: 'completed' },
      tasks: [{ id: '1', title: '已完成任务', status: 'done' }],
      brainDir: tempDir,
    });

    assert.ok(fs.existsSync(res.path));
    assert.ok(res.embedTag.startsWith('<agent-embed src="file://'));
    assert.ok(res.embedTag.includes('things-card.html'));
    const content = fs.readFileSync(res.path, 'utf8');
    assert.ok(content.includes('工件测试'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
