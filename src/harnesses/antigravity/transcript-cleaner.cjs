'use strict';
const fs = require('node:fs');

/**
 * Antigravity 专属日志清洗器 (Transcript Cleaner)
 * 专门处理 Antigravity 专有的 ~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl 格式。
 * 遵循 Codex 清洗法则：丢弃所有工具原始输出、后台调试日志与中间步骤，仅提取用户请求与智能体面向用户的正式回答。
 */

function safeTruncateText(text, max = 20000) {
  if (typeof text !== 'string' || text.length <= max) return text;
  const half = Math.floor((max - 50) / 2);
  return `${text.slice(0, half)}\n\n[...内容过长已截断...]\n\n${text.slice(-half)}`;
}

function cleanUserRequestText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let text = rawText.trim();
  // 1. 优先提取用户发送的请求正文
  const reqMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  if (reqMatch) {
    text = reqMatch[1].trim();
  }
  // 2. 剥离环境注入元数据、上下文摘要信封
  text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '').trim();
  text = text.replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/g, '').trim();
  return text;
}

function isFinalAgentResponse(step) {
  if (!step || typeof step !== 'object') return false;
  // 丢弃工具原始输出（GENERIC）、系统消息、检查点等
  if (step.type !== 'PLANNER_RESPONSE') return false;
  // 丢弃包含 tool_calls 的中间准备/调度步骤
  if (Array.isArray(step.tool_calls) && step.tool_calls.length > 0) return false;
  // 必须具备面向用户的正式答复文本
  const text = (step.content || '').trim();
  return text.length > 0;
}

function parseTranscriptSteps(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  const steps = [];
  for (const [index, line] of lines.entries()) {
    try { steps.push(JSON.parse(line)); }
    catch (error) {
      if (index === lines.length - 1 && !content.endsWith('\n')) break;
      throw new Error(`会话日志第 ${index + 1} 行格式无效`);
    }
  }
  return steps;
}

function timestampInSeconds(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function convertStepsToTurns(steps) {
  const turns = [];
  let currentTurn = null;
  let turnIndex = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isUserInput = step.type === 'USER_INPUT' || step.source === 'USER_EXPLICIT';

    if (isUserInput) {
      if (currentTurn && currentTurn.items.length) {
        turns.push(currentTurn);
      }
      turnIndex++;
      const timeMs = timestampInSeconds(step.created_at);
      currentTurn = {
        id: String(turnIndex),
        status: 'completed',
        startedAt: timeMs,
        completedAt: timeMs,
        itemsView: 'full',
        items: []
      };

      const userText = cleanUserRequestText(step.content || '');
      currentTurn.items.push({
        id: `u_${step.step_index ?? i}`,
        type: 'userMessage',
        content: [{ type: 'text', text: userText }]
      });
    } else if (isFinalAgentResponse(step)) {
      if (!currentTurn) {
        turnIndex++;
        currentTurn = {
          id: String(turnIndex),
          status: 'completed',
          startedAt: timestampInSeconds(step.created_at),
          completedAt: timestampInSeconds(step.created_at),
          itemsView: 'full',
          items: []
        };
      }
      if (step.created_at) {
        currentTurn.completedAt = timestampInSeconds(step.created_at);
      }
      const agentText = (step.content || '').trim();
      currentTurn.items.push({
        id: `a_${step.step_index ?? i}`,
        type: 'agentMessage',
        phase: 'final_answer',
        text: agentText
      });
    }
  }

  if (currentTurn && currentTurn.items.length) {
    turns.push(currentTurn);
  }

  return turns;
}

module.exports = {
  safeTruncateText,
  cleanUserRequestText,
  isFinalAgentResponse,
  parseTranscriptSteps,
  convertStepsToTurns,
};
