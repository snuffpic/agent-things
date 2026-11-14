'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ManualStatusStore } = require('./manual-status-store.cjs');
const { generateCardArtifact } = require('./antigravity-card.cjs');
const { resolveAntigravityTitle } = require('./harnesses/antigravity/antigravity-title.cjs');
const { readConfiguredLang, getUi, formatSessionMarkdownSummary } = require('./i18n.cjs');

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
  const lang = readConfiguredLang({ dataDir: path.dirname(statePath) });
  const { t } = getUi(lang);
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
    ? t('unrecordedSummary')
    : (progressData?.state === 'completed' || progressData?.progress === 100
      ? t('mdStateDone')
      : (progressData?.progress != null ? `${progressData.progress}%` : t('mdStateUnstarted')));
  const total = progressData?.totalTasks || 0;
  const done = progressData?.completedTasks || 0;
  const tasksText = total > 0 ? t('totalsPattern', { done, total }) : t('mdTasksEmpty');
  const noteText = progressData?.note ? `\n- **${t('mdNotesLabel')}**：${progressData.note}`.replace('：', lang === 'en' ? ': ' : '：') : '';
  const summaryText = isEmptySession ? t('unrecordedSummary') : (progressData?.summary || '');

  // 生成卡片工件（空会话时不分析、不建任务、不写账本）
  const resolvedBrainDir = path.basename(artifactDir) === conversationId
    ? path.dirname(artifactDir)
    : path.join(os.homedir(), '.gemini/antigravity/brain');
  const sessionTitle = resolveAntigravityTitle(conversationId, {
    brainDir: resolvedBrainDir,
    fallback: t('defaultSessionTitle'),
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
    lang,
  });

  const mdColon = lang === 'en' ? ': ' : '：';
  const userMarkdown = `${cardResult.embedTag}\n\n**${t('mdProgressHeading')}${mdColon}${stateText}**\n- **${t('mdTasksOverview')}**${mdColon}${tasksText}${noteText}\n- **${t('mdQuickActionsLabel')}**${mdColon}${t('mdQuickActionsText')}`;

  return {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: t('hookPresentedMessage'),
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
