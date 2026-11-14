'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ManualStatusStore } = require('./manual-status-store.cjs');
const { generateCardArtifact } = require('./antigravity-card.cjs');
const { resolveAntigravityTitle } = require('./harnesses/antigravity/antigravity-title.cjs');

function extractUserInput(raw) {
  if (typeof raw !== 'string') return '';
  const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  return (match ? match[1] : raw).trim();
}

function isThingsCommand(input) {
  const cleaned = extractUserInput(input);
  return /^\s*\/things(?:\s|$)/i.test(cleaned);
}

function processHookInput(rawInput) {
  let payload = {};
  try {
    payload = JSON.parse(rawInput);
  } catch (_) {
    return {};
  }

  const lastUserInput = payload.lastUserInput;
  if (!isThingsCommand(lastUserInput)) {
    return {};
  }

  const conversationId = payload.conversationId || 'default';
  const artifactDir = payload.artifactDirectoryPath || path.join(os.homedir(), '.gemini/antigravity/brain', conversationId);

  // 读取本地状态
  const statePath = path.join(os.homedir(), '.gemini/antigravity/session-status/manual-state.json');
  let progressData = null;
  if (fs.existsSync(statePath)) {
    try {
      const store = new ManualStatusStore(statePath);
      progressData = store.getProgress(conversationId);
    } catch (_) {}
  }

  // 读取连接凭据
  const credPath = path.join(os.homedir(), '.gemini/antigravity/session-status/manual-state.json.http.json');
  let connection = null;
  if (fs.existsSync(credPath)) {
    try {
      connection = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    } catch (_) {}
  }

  const isEmptySession = progressData == null;
  const stateText = isEmptySession
    ? '尚未记录进展'
    : (progressData?.state === 'completed' || progressData?.progress === 100
      ? '全部完成 (100%)'
      : (progressData?.progress != null ? `${progressData.progress}%` : '未开始'));
  const total = progressData?.totalTasks || 0;
  const done = progressData?.completedTasks || 0;
  const tasksText = total > 0 ? `已完成 ${done} / ${total} 项任务` : '暂无任务清单';
  const noteText = progressData?.note ? `\n- **会话备注**：${progressData.note}` : '';
  const summaryText = isEmptySession ? '尚未记录进展' : (progressData?.summary || '');

  // 生成卡片工件（空会话时不分析、不建任务、不写账本）
  const resolvedBrainDir = path.basename(artifactDir) === conversationId
    ? path.dirname(artifactDir)
    : path.join(os.homedir(), '.gemini/antigravity/brain');
  const sessionTitle = resolveAntigravityTitle(conversationId, {
    brainDir: resolvedBrainDir,
    fallback: '当前会话',
  });

  const cardResult = generateCardArtifact({
    conversationId,
    brainDir: artifactDir,
    artifactDir,
    record: isEmptySession ? null : {
      state: progressData.state,
      progress: progressData.progress,
      note: progressData.note,
      source: progressData.source,
      updatedAt: progressData.updatedAt,
    },
    tasks: isEmptySession ? [] : (progressData?.tasks || []),
    summary: summaryText,
    revision: progressData?.revision || 0,
    connection,
    title: sessionTitle,
  });

  const userMarkdown = `${cardResult.embedTag}\n\n**当前会话任务进度：${stateText}**\n- **任务总览**：${tasksText}${noteText}\n- **快捷交互**：可在卡片中点击“手动调整”滑动调整进度或修改备注，或点击“更新进度”开始自动分析。`;

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: '已呈现当前会话任务进度卡片',
          metadata: {
            user_markdown: userMarkdown,
          },
        },
      },
    ],
    terminationBehavior: 'terminate',
  };
}

function runCli() {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
  });
  process.stdin.on('end', () => {
    const output = processHookInput(buffer);
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  });
}

if (require.main === module) {
  runCli();
}

module.exports = {
  extractUserInput,
  isThingsCommand,
  processHookInput,
};
