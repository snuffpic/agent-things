'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function visualWidth(line) {
  let width = 0;
  for (const ch of String(line || '')) {
    width += /[^\x00-\xff]/.test(ch) ? 14 : 7;
  }
  return width;
}

function loadPresentation() {
  const foundationFile = fs.readFileSync(
    path.join(__dirname, '../mods/agent-things-ui/hooks/foundation.js'),
    'utf8',
  );
  const foundation = vm.runInNewContext(
    foundationFile.replace('export const {', 'const {') + '\npresentation;',
  );
  const presFile = fs.readFileSync(
    path.join(__dirname, '../mods/agent-things-ui/hooks/presentation.js'),
    'utf8',
  );
  const stripped = presFile
    .replace(/^import\s+\{[^}]+\}\s+from\s+['"]\.\/foundation\.js['"];?\s*/m, '')
    .replace(/^export\s+\{[^}]+\};?\s*/gm, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ');
  return vm.runInNewContext(
    `${stripped}\n({ CONTENT_WIDTH, NOTE_LINE_WIDTH, wrapText, preview });`,
    {
      labels: foundation.labels,
      colors: foundation.colors,
      taskLabels: foundation.taskLabels,
      layout: foundation.layout,
      accent: foundation.accent,
    },
  );
}

test('claude presentation wraps continuous CJK note within card width without triggering 查看全部 under 3 lines', async () => {
  const { NOTE_LINE_WIDTH, wrapText, preview } = await loadPresentation();
  const note = '思考显示已推送；待验收新包与真钥匙串冷启动';

  const wrapped = wrapText(note);
  const lines = wrapped.split('\n');
  assert.equal(lines.length, 2, '21个连续中文字符应在卡片内宽限制下自动换为2行');
  for (const line of lines) {
    assert.ok(visualWidth(line) <= NOTE_LINE_WIDTH, `行 "${line}" 视觉宽度不得超过 ${NOTE_LINE_WIDTH}`);
  }
  assert.equal(lines.join(''), note, '换行后不应丢失或损坏任何字符');
  assert.equal(preview(note), wrapped, '未超3行时 preview 应与 wrapText 一致，避免误显查看全部');
});

test('claude presentation truncates >3 wrapped lines with ellipsis while keeping every line inside width', async () => {
  const { NOTE_LINE_WIDTH, wrapText, preview } = await loadPresentation();
  const longNote = '第一部分进度已经全部完成并且通过本地验证，接下来需要检查真机签名与钥匙串冷启动，同时核对跨会话跳转和历史消息加载逻辑是否还有遗漏。';

  const fullWrapped = wrapText(longNote);
  const clipped = preview(longNote);
  const clippedLines = clipped.split('\n');

  assert.ok(fullWrapped.split('\n').length > 3);
  assert.equal(clippedLines.length, 3, 'preview 最多保留3行');
  assert.ok(clipped.endsWith('…'), '超3行预览末尾应以省略号收尾');
  assert.notEqual(clipped, fullWrapped, '超3行时应触发查看全部按钮');
  for (const line of clippedLines) {
    assert.ok(visualWidth(line) <= NOTE_LINE_WIDTH, `截断后行 "${line}" 宽度不得超过 ${NOTE_LINE_WIDTH}`);
  }
});

test('claude presentation wraps mixed CJK and English words cleanly without splitting English tokens', async () => {
  const { NOTE_LINE_WIDTH, wrapText } = await loadPresentation();
  const text = '如需启用侧栏插件，请打开「开发者 → Enable Main Process Debugger」。';

  const lines = wrapText(text).split('\n');
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.ok(visualWidth(line) <= NOTE_LINE_WIDTH, `混合文本行 "${line}" 不得超出宽度`);
  }
  for (const word of ['Enable', 'Main', 'Process', 'Debugger']) {
    assert.ok(lines.some((line) => line.includes(word)), `英文词 "${word}" 不应被从中间劈开`);
  }
});

test('claude presentation preserves explicit newlines and short notes', async () => {
  const { wrapText, preview } = await loadPresentation();
  const multi = '第一行\n第二行';
  assert.equal(wrapText(multi), multi);
  assert.equal(preview(multi), multi);
});
