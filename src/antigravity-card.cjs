'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const colors = {
  unstarted: '#9098a2',
  unfinished: '#c89b38',
  completed: '#548eea',
  pushed: '#a17be3',
};

const labels = {
  unstarted: '尚未开始',
  unfinished: '有遗留事项',
  completed: '全部完成',
  pushed: '全部完成并已推送',
};

const taskLabels = {
  todo: '待开始',
  in_progress: '进行中',
  blocked: '受阻',
  needs_verification: '待验收',
  done: '已完成',
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function renderSvgRing(progress, state, loading = false) {
  const color = colors[state] || colors.unstarted;
  const radius = 10;
  const strokeWidth = 1.6;
  const hasProgress = progress !== null && progress !== undefined && Number.isFinite(progress);
  const progVal = hasProgress ? Math.max(0, Math.min(100, progress)) : 0;

  let piePath = '';
  if (hasProgress && progVal > 0) {
    const angle = (progVal / 100) * Math.PI * 2;
    const x = (12 + 7.4 * Math.sin(angle)).toFixed(2);
    const y = (12 - 7.4 * Math.cos(angle)).toFixed(2);
    piePath = progVal === 100
      ? `<path d="M12 4.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8" fill="${color}" class="progress-pie"/>`
      : `<path d="M12 12L12 4.6A7.4 7.4 0 ${progVal > 50 ? 1 : 0} 1 ${x} ${y}Z" fill="${color}" class="progress-pie"/>`;
  }

  const isHundred = progVal === 100;
  const fontSize = isHundred ? '5.8px' : '6.4px';
  const letterSpacing = isHundred ? '-0.3px' : '-0.2px';
  const textVal = hasProgress ? `${progVal}%` : '—';

  return `
    <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" style="overflow:visible">
      <circle cx="12" cy="12" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${hasProgress ? '1' : '0.85'}"/>
      ${piePath}
      <text x="12" y="12.4" text-anchor="middle" dominant-baseline="middle" fill="${color}" class="${hasProgress ? '' : 'progress-unknown'}" style="font:600 ${fontSize} -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:${letterSpacing};font-variant-numeric:tabular-nums">${textVal}</text>
    </svg>
  `.trim();
}

function renderAntigravityCardHtml({
  title = '当前会话',
  conversationId = '',
  record = null,
  tasks = [],
  summary = '',
  revision = 0,
  connection = null,
} = {}) {
  const state = record?.state || (record?.progress === 100 ? 'completed' : record?.progress > 0 ? 'unfinished' : 'unstarted');
  const progress = record?.progress ?? null;
  const note = record?.note || '';
  const stateColor = colors[state] || colors.unstarted;
  const stateLabel = labels[state] || labels.unstarted;
  const sourceLabel = record?.source === 'analysis' ? '自动分析' : '手动调整';
  const updatedDate = record?.updatedAt ? new Date(record.updatedAt) : new Date();
  const timestampStr = `${updatedDate.getMonth() + 1}/${updatedDate.getDate()} ${String(updatedDate.getHours()).padStart(2, '0')}:${String(updatedDate.getMinutes()).padStart(2, '0')}`;

  const allTasks = Array.isArray(tasks) ? tasks : [];
  const uncompletedTasks = allTasks.filter(t => t.status !== 'done');
  const completedTasks = allTasks.filter(t => t.status === 'done');
  const totalCount = allTasks.length;
  const doneCount = completedTasks.length;
  const totalsText = totalCount > 0 ? `已完成 ${doneCount} / ${totalCount} 项任务` : '暂无任务统计';
  const summaryText = summary || record?.note || '';

  const configJson = JSON.stringify({
    origin: connection?.origin || 'http://127.0.0.1:29888',
    conversationId,
    title,
    loadToken: connection?.loadToken || null,
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} · 任务进展</title>
  <style>
    :root {
      --accent: #0169cc;
      --accent-hover: #005bb3;
      --ink: #e6edf3;
      --secondary: #a0a6ad;
      --muted: #828c96;
      --note: #bbc3ca;
      --track: #ffffff12;
      --line: #ffffff14;
      --input-border: #ffffff18;
      --input-bg: #ffffff03;
      --hover: #ffffff09;
      --selected: #ffffff10;
      --source-bg: #ffffff0a;
      --number-line: #ffffff25;
      --thumb: #e6edf3;
      --thumb-edge: #ffffff30;
      --danger: #ef7777;
      --error: #f7ad86;
      --panel-bg: #0e1318;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      color-scheme: dark;
    }
    * {
      box-sizing: border-box;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    *::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    button, input, textarea {
      font: inherit;
      color: inherit;
    }
    button {
      cursor: pointer;
    }
    [hidden] {
      display: none !important;
    }

    body {
      margin: 0;
      padding: 0;
      background: transparent;
      display: flex;
      justify-content: flex-start;
      color: var(--ink);
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .shell {
      position: relative;
      width: 340px;
      max-width: 100%;
      max-height: none;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--panel-bg);
      border: 1px solid #ffffff1c;
      border-radius: 20px;
      box-shadow: 0 16px 54px rgba(0, 0, 0, 0.35);
      padding: 16px 20px 14px;
    }
    .shell:hover {
      --panel-bg: #1f242a;
    }

    .title-heading {
      display: flex;
      flex: none;
      align-items: flex-start;
      gap: 10px;
      margin-right: 34px;
      border-radius: 5px;
      outline-offset: 4px;
      cursor: default;
      transition: max-height 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease, transform 0.22s ease, margin 0.22s ease;
      max-height: 60px;
      opacity: 1;
      transform: translateY(0);
      overflow: visible;
    }
    .shell.is-scrolled .title-heading {
      height: 0;
      min-height: 0;
      max-height: 0;
      opacity: 0;
      visibility: hidden;
      margin: 0;
      padding: 0;
      transform: translateY(-20px);
      overflow: hidden;
      pointer-events: none;
    }
    .open-pane {
      position: absolute;
      right: 13px;
      top: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--secondary);
      transition: color 0.12s, background 0.12s, opacity 0.18s ease, transform 0.22s ease;
      z-index: 5;
    }
    .open-pane:hover,
    .open-pane:focus-visible {
      color: var(--ink);
      background: var(--hover);
    }
    .open-pane:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    .open-pane:disabled {
      opacity: 0.55;
      cursor: wait;
    }
    .open-pane-tip {
      position: absolute;
      right: calc(100% + 6px);
      top: 50%;
      transform: translateY(-50%);
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--panel-bg);
      color: var(--ink);
      border: 1px solid var(--line);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
      font-size: 11px;
      line-height: 1.4;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.08s, visibility 0s;
      z-index: 20;
    }
    .open-pane:is(:hover, :focus-visible) .open-pane-tip {
      opacity: 1;
      visibility: visible;
      transition-delay: 0.15s;
    }
    .shell.is-scrolled .open-pane {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(-20px);
    }
    h2.title {
      font-size: 24px;
      font-weight: 650;
      line-height: 1.3;
      letter-spacing: -0.5px;
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      overflow: hidden;
      color: var(--ink);
    }

    .title-progress {
      display: flex;
      flex: none;
      width: 32px;
      height: 32px;
      margin-top: 1px;
    }
    .title-progress svg {
      width: 32px;
      height: 32px;
      display: block;
    }
    .title-progress text {
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: none;
    }
    .title-progress text.progress-unknown {
      opacity: 1;
    }
    .title-heading:hover .progress-pie,
    .title-heading:focus-visible .progress-pie {
      opacity: 0;
    }
    .title-heading:hover text,
    .title-heading:focus-visible text {
      opacity: 1;
    }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
      margin-top: 14px;
      scrollbar-width: none;
      -ms-overflow-style: none;
      transition: margin-top 0.22s ease;
    }
    .shell.is-scrolled .panel-body {
      margin-top: 0;
    }
    .panel-body::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .view {
      padding-bottom: 4px;
    }

    .status-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .status-block {
      transform: translateY(2px);
      min-width: 0;
      flex: 1;
    }
    .status-name {
      display: flex;
      align-items: center;
      gap: 7px;
      line-height: 18px;
      font-size: 13px;
      min-width: 0;
    }
    .status-name > span:last-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .state-dot {
      width: 10px;
      height: 10px;
      border: 1.5px solid;
      border-radius: 50%;
      flex: none;
      background: transparent !important;
    }
    .timestamp {
      font-size: 11px;
      line-height: 16px;
      color: var(--secondary);
      margin-top: 2px;
      margin-left: 17px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .score {
      display: flex;
      align-items: baseline;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      flex: none;
    }
    .score-number {
      font-size: 39px;
      font-weight: 550;
      letter-spacing: -1px;
      color: var(--ink);
    }
    .score-unit {
      font-size: 15px;
      color: var(--secondary);
      margin-left: 3px;
    }

    .meter {
      height: 4px;
      background: var(--track);
      border-radius: 3px;
      margin: 10px 0 8px;
      overflow: hidden;
    }
    .meter::after {
      content: "";
      display: block;
      height: 100%;
      width: ${progress != null ? Math.max(0, Math.min(100, progress)) : 0}%;
      background: ${stateColor};
      border-radius: inherit;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      color: var(--secondary);
    }
    .totals, .source-label {
      font-size: 11px;
      font-weight: 400;
      line-height: 16px;
    }
    .source-label {
      margin-left: auto;
      text-align: right;
      white-space: nowrap;
    }

    .summary-block {
      position: relative;
      margin: 10px 0;
      outline: none;
    }
    .overview-summary {
      font-size: 13px;
      line-height: 1.65;
      color: var(--note);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .summary-expand {
      position: absolute;
      right: 0;
      bottom: 0;
      border: 0;
      background: linear-gradient(to right, transparent, var(--panel-bg) 18px);
      padding: 0 0 0 22px;
      color: var(--secondary);
      font-size: 12px;
      line-height: 21.45px;
      white-space: nowrap;
      cursor: pointer;
    }
    .summary-expand:hover {
      color: inherit;
    }
    .summary-block.expanded .overview-summary {
      display: block;
      -webkit-line-clamp: unset;
    }
    .summary-block.expanded .summary-expand {
      position: static;
      display: block;
      margin-left: auto;
      padding-left: 0;
      background: none;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 17px;
      margin: 12px 0 14px;
    }
    .primary {
      border: 0;
      background: var(--accent);
      color: #fff;
      border-radius: 9px;
      padding: 9px 14px;
      font-weight: 550;
      min-height: 36px;
      font-size: 13px;
      transition: background 0.15s ease;
    }
    .primary:hover {
      background: var(--accent-hover);
      color: #fff;
    }
    .text-button, .clear, .back {
      border: 0;
      background: none;
      padding: 0;
      color: var(--secondary);
      font-size: 12px;
      cursor: pointer;
      transition: color 0.12s ease;
    }
    .text-button:hover, .back:hover {
      color: inherit;
    }
    .actions .clear {
      margin-left: auto;
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
      position: relative;
    }
    .actions .clear:hover {
      color: var(--danger);
    }
    .clear-tooltip {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      padding: 6px 9px;
      border-radius: 6px;
      background: var(--panel-bg);
      color: var(--secondary);
      border: 1px solid var(--line);
      font-size: 11px;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.08s, visibility 0s;
      white-space: nowrap;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      z-index: 10;
    }
    .clear:is(:hover, :focus-visible) .clear-tooltip {
      opacity: 1;
      visibility: visible;
      transition-delay: 0.1s;
    }

    .section-head {
      border-top: 1px solid var(--line);
      padding-top: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }
    .section-head h3 {
      font-size: 12px;
      font-weight: 550;
      margin: 0;
      color: var(--ink);
    }
    .remaining-toggle {
      border: 0;
      background: none;
      padding: 0;
    }
    .row-detail {
      font-size: 12px;
      font-weight: 400;
      line-height: 18px;
      color: var(--secondary);
      white-space: nowrap;
    }

    .task-row {
      position: relative;
      display: flex;
      gap: 9px;
      align-items: flex-start;
      padding: 9px 0;
      overflow: hidden;
      isolation: isolate;
    }
    .task-row:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: -1px;
    }
    .task-dot {
      width: 12px;
      height: 12px;
      border: 1.3px solid #c89b38;
      border-radius: 50%;
      margin-top: 4px;
      flex: none;
    }
    .task-row[data-status="done"] .task-dot {
      border-color: #548eea;
      background: rgba(84, 142, 234, 0.22);
    }
    .task-content {
      min-width: 0;
      flex: 1;
    }
    .task-title {
      font-size: 13px;
      line-height: 1.4;
      color: var(--ink);
      word-break: break-word;
    }
    .task-meta {
      font-size: 10px;
      color: var(--secondary);
      margin-top: 3px;
    }
    .task-source {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-left: 28px;
      background: linear-gradient(to right, transparent, var(--panel-bg) 25px);
      opacity: 0;
      pointer-events: none;
      transform: translateX(4px);
      transition: opacity 0.13s ease, transform 0.13s ease;
    }
    .task-source button {
      border: 0;
      border-radius: 6px;
      background: var(--source-bg);
      color: var(--ink);
      padding: 5px 7px;
      font-size: 11px;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .task-source button:hover {
      background: var(--hover);
    }
    .task-row:hover .task-source,
    .task-row:focus-within .task-source {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }
    @media (hover: none) {
      .task-source {
        opacity: 1;
        pointer-events: auto;
        transform: none;
      }
    }

    .empty {
      font-size: 12px;
      color: var(--secondary);
      padding: 8px 0;
      text-align: left;
    }

    .quiet-row {
      border: 0;
      border-top: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      background: none;
      color: inherit;
      padding: 10px 0;
      text-align: left;
      font-size: 12px;
      cursor: pointer;
      transition: color 0.15s ease;
    }
    .quiet-row span:last-child {
      color: var(--secondary);
    }
    .quiet-row:hover {
      color: var(--ink);
    }

    .overview-bottom {
      margin-top: 8px;
    }

    /* Views */
    .view-heading {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--panel-bg);
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0 10px;
      margin-bottom: 6px;
    }
    .view-heading h3 {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
      color: var(--ink);
    }
    .view-heading .back {
      font-size: 13px;
      font-weight: 500;
      color: var(--secondary);
      padding: 4px 8px;
      margin-right: -6px;
      border-radius: 6px;
      cursor: pointer;
      transition: color 0.12s, background 0.12s;
    }
    .view-heading .back:hover {
      color: var(--ink);
      background: var(--hover);
    }
    .view-heading::after {
      content: "";
      position: absolute;
      left: -20px;
      right: -20px;
      top: 100%;
      height: 20px;
      background: linear-gradient(to bottom, var(--panel-bg), transparent);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease-out, background 0.15s ease-out;
    }
    .shell.is-scrolled .view-heading::after {
      opacity: 1;
    }

    /* Edit View */
    .choices-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }
    .choice {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 9px;
      border: 0;
      border-radius: 7px;
      background: none;
      color: inherit;
      text-align: left;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .choice:hover {
      background: var(--hover);
    }
    .choice[aria-pressed="true"] {
      background: var(--selected);
    }
    .dot {
      width: 12px;
      height: 12px;
      border: 1.6px solid var(--mark);
      border-radius: 50%;
      flex: none;
    }
    .choice[aria-pressed="true"] .dot {
      background: var(--mark);
      box-shadow: inset 0 0 0 2px var(--panel-bg);
    }

    .progress-section {
      margin-top: 20px;
    }
    .progress-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .label {
      font-size: 11px;
      color: var(--secondary);
    }
    .number-wrap {
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--secondary);
    }
    .progress-number {
      appearance: textfield;
      color: var(--ink);
      width: 65px;
      padding: 2px 3px 4px;
      background: none;
      border: 0;
      border-bottom: 1px solid var(--number-line);
      font-size: 27px;
      font-weight: 550;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .progress-number::-webkit-inner-spin-button {
      appearance: none;
    }
    .range {
      position: relative;
      height: 51px;
      margin-top: 2px;
      --mark: ${stateColor};
    }
    .range-track {
      position: absolute;
      left: 7px;
      right: 7px;
      top: 10px;
      height: 4px;
      border-radius: 3px;
      background: linear-gradient(to right, var(--mark) var(--fill), var(--track) var(--fill));
      pointer-events: none;
    }
    .range-input {
      position: relative;
      appearance: none;
      width: 100%;
      height: 24px;
      background: transparent;
      margin: 0;
      display: block;
      padding: 0;
      cursor: pointer;
    }
    .range-input::-webkit-slider-runnable-track {
      height: 4px;
      background: transparent;
    }
    .range-input::-webkit-slider-thumb {
      appearance: none;
      width: 14px;
      height: 14px;
      margin-top: -5px;
      background: var(--thumb);
      border: 2px solid var(--panel-bg);
      border-radius: 50%;
      box-shadow: 0 0 0 1px var(--thumb-edge);
    }
    .range-nodes {
      position: absolute;
      left: 7px;
      right: 7px;
      top: 0;
      pointer-events: none;
    }
    .range-node {
      position: absolute;
      left: var(--at);
      top: 8px;
      width: 0;
      font-size: 10px;
      color: var(--secondary);
      font-variant-numeric: tabular-nums;
    }
    .range-node::before {
      content: "";
      display: block;
      width: 7px;
      height: 7px;
      transform: translateX(-50%);
      border-radius: 50%;
      background: var(--panel-bg);
      border: 1px solid var(--secondary);
      box-shadow: 0 0 0 1px var(--panel-bg);
    }
    .range-node-label {
      position: absolute;
      top: 19px;
      left: 0;
      transform: translateX(-50%);
    }
    .range-node:first-child .range-node-label {
      transform: none;
    }
    .range-node:last-child .range-node-label {
      transform: translateX(-100%);
    }
    .unknown-row {
      display: flex;
      justify-content: flex-end;
      margin: 2px 0 18px;
    }
    .unknown {
      font-size: 11px;
      color: var(--secondary);
      border: 0;
      background: none;
      padding: 0;
      cursor: pointer;
    }
    .unknown:hover {
      color: var(--ink);
    }

    .note-label {
      display: block;
      font-size: 11px;
      color: var(--secondary);
      margin-bottom: 8px;
    }
    textarea.note-input {
      display: block;
      width: 100%;
      resize: vertical;
      min-height: 66px;
      max-height: 140px;
      background: var(--input-bg);
      color: inherit;
      border: 1px solid var(--input-border);
      border-radius: 8px;
      padding: 9px;
      line-height: 1.6;
      font-size: 12px;
    }
    textarea.note-input:focus-visible {
      outline: none;
    }

    .edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: 18px;
      align-items: center;
      padding: 21px 0 16px;
    }

    .feedback-msg {
      font-size: 11px;
      color: var(--secondary);
      margin-top: 10px;
      text-align: right;
    }
    .feedback-msg.error {
      color: var(--error);
    }
    .feedback-msg.success {
      color: #548eea;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --ink: #22272e;
        --secondary: #576374;
        --muted: #667383;
        --note: #46515f;
        --track: #c3ccd6;
        --line: #dfe4ea;
        --input-border: #c7d0da;
        --input-bg: #f7f9fb;
        --hover: #f0f3f6;
        --selected: #e9edf2;
        --source-bg: #e9eef4;
        --number-line: #b6c1ce;
        --thumb: var(--accent);
        --thumb-edge: var(--accent);
        --danger: #bf2f3a;
        --error: #b13a2d;
        --panel-bg: #fff;
        color: var(--ink);
        color-scheme: light;
      }
      .shell {
        --panel-bg: #fff;
        border-color: #dfe4ea;
        box-shadow: none;
      }
      .shell:hover {
        --panel-bg: #f5f6f7;
      }
    }
  </style>
</head>
<body>
  <div class="shell" id="agentThingsCard">
    <button type="button" class="open-pane" id="btnOpenPane" aria-label="在侧栏打开" onclick="onOpenPaneClick()">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="6.65" y="8.15" width="14.7" height="11.7" rx="3" stroke="currentColor" stroke-width="1.3"></rect>
        <path d="M16.3 8.2V19.8" stroke="currentColor" stroke-width="1.3"></path>
      </svg>
      <span class="open-pane-tip" role="tooltip">在侧栏打开</span>
    </button>
    <div class="title-heading" tabindex="0">
      <span class="title-progress" id="titleProgress">
        ${renderSvgRing(progress, state)}
      </span>
      <h2 class="title" id="cardTitle" title="${escapeHtml(title)}">${escapeHtml(title)}</h2>
    </div>

    <div class="panel-body" id="panelBody">
      <!-- Overview View -->
      <div id="overviewView" class="view overview">
        <div class="status-line">
          <div class="status-block">
            <div class="status-name">
              <span class="state-dot" id="overviewDot" style="border-color:${stateColor};"></span>
              <span id="overviewStatusLabel">${escapeHtml(stateLabel)}</span>
            </div>
            <div class="timestamp" id="overviewTimestamp">${escapeHtml(timestampStr)}</div>
          </div>
          <div class="score">
            <span class="score-number" id="overviewScoreNumber">${progress != null ? progress : '—'}</span>
            <span class="score-unit" ${progress == null ? 'hidden' : ''}>%</span>
          </div>
        </div>

        <div class="meter" id="overviewMeter" style="--fill:${progress != null ? Math.max(0, Math.min(100, progress)) : 0}%; --mark:${stateColor};"></div>

        <div class="totals-row">
          <span class="totals" id="overviewTotals">${escapeHtml(totalsText)}</span>
          <span class="source-label">${escapeHtml(sourceLabel)}</span>
        </div>

        ${summaryText ? `
        <div class="summary-block" id="summaryBlock" tabindex="0">
          <div class="overview-summary" id="overviewSummary">${escapeHtml(summaryText)}</div>
          <button class="summary-expand" id="summaryExpand" onclick="toggleSummaryExpand()" hidden>查看全部</button>
        </div>
        ` : ''}

        <div class="actions">
          <button class="primary" id="btnAnalyze" onclick="onAnalyzeClick()">更新进度</button>
          <button class="text-button" onclick="switchToEdit()">手动调整</button>
          <button class="clear" aria-label="清除进度" onclick="onClearClick()">
            <span class="clear-tooltip" role="tooltip">立即清除进度与任务记录</span>
            清除进度
          </button>
        </div>

        <!-- Section Head -->
        <div class="section-head">
          <h3 id="remainingTasksHeading">剩余任务 ${uncompletedTasks.length}</h3>
          ${uncompletedTasks.length > 3 ? `
            <button class="text-button row-detail" id="btnToggleAllRemaining" onclick="toggleAllRemaining()">查看全部 ${uncompletedTasks.length} 条 ›</button>
          ` : ''}
        </div>

        <!-- Tasks list -->
        <div class="tasks-list" id="uncompletedTasksList">
          ${allTasks.length === 0 ? '<div class="empty">点击更新进度，整理这次会话的任务</div>'
            : uncompletedTasks.length === 0 ? '<div class="empty">暂无未完成任务</div>' : ''}
          ${uncompletedTasks.map((task, idx) => {
            const hasSource = Boolean(task.source?.locator || task.source?.turnId);
            return `
            <div class="task-row ${idx >= 3 ? 'remaining-hidden' : ''}" data-status="${escapeHtml(task.status)}" tabindex="0" ${idx >= 3 ? 'hidden' : ''}>
              <span class="task-dot"></span>
              <div class="task-content">
                <div class="task-title">${escapeHtml(task.title || task.summary || '未命名事项')}</div>
                <div class="task-meta">${escapeHtml(taskLabels[task.status] || task.status)}</div>
              </div>
              ${hasSource ? `
                <div class="task-source">
                  <button type="button" aria-label="查看来源：${escapeHtml(task.title || task.summary || '未命名事项')}" data-source="${escapeHtml(JSON.stringify(task.source))}" onclick="onSourceClick(this)">查看来源</button>
                </div>
              ` : ''}
            </div>
          `;
          }).join('')}
        </div>

        <!-- Bottom Rows (1:1 identical to sidebar) -->
        <div class="overview-bottom">
          <button class="quiet-row history-open" onclick="switchToHistory()">
            <span>已完成任务</span>
            <span class="row-detail" id="historyCount">${completedTasks.length} 条 ›</span>
          </button>
          <button class="quiet-row note-open" onclick="switchToEditNote()">
            <span>备注</span>
            <span class="row-detail" id="noteOpenLabel">${note ? '编辑' : '添加'}</span>
          </button>
        </div>
      </div>

      <!-- History View -->
      <div id="historyView" class="view history-view" hidden>
        <div class="view-heading">
          <h3>已完成任务</h3>
          <button class="back" onclick="switchToOverview()">‹ 返回</button>
        </div>
        <div class="history-list" id="historyList">
          ${completedTasks.length === 0 ? '<div class="empty">暂无已完成任务</div>' : ''}
          ${completedTasks.map((task) => {
            const hasSource = Boolean(task.source?.locator || task.source?.turnId);
            return `
            <div class="task-row" data-status="done" tabindex="0">
              <span class="task-dot"></span>
              <div class="task-content">
                <div class="task-title">${escapeHtml(task.title || task.summary || '已完成事项')}</div>
                <div class="task-meta">已完成</div>
              </div>
              ${hasSource ? `
                <div class="task-source">
                  <button type="button" aria-label="查看来源：${escapeHtml(task.title || task.summary || '已完成事项')}" data-source="${escapeHtml(JSON.stringify(task.source))}" onclick="onSourceClick(this)">查看来源</button>
                </div>
              ` : ''}
            </div>
          `;
          }).join('')}
        </div>
      </div>

      <!-- Edit View -->
      <div id="editView" class="view edit-view" hidden>
        <div class="view-heading">
          <h3>手动记录会话状态</h3>
          <button class="back" onclick="switchToOverview()">‹ 返回</button>
        </div>
        <div class="choices-list">
          ${Object.entries(labels).map(([key, label]) => `
            <button class="choice" id="choice-${key}" ${key === 'pushed' ? 'hidden' : ''} aria-pressed="${state === key ? 'true' : 'false'}" style="--mark:${colors[key]}" onclick="selectState('${key}')">
              <span class="dot"></span>
              <span>${escapeHtml(label)}</span>
            </button>
          `).join('')}
        </div>

        <div class="progress-section">
          <div class="progress-head">
            <label class="label" for="inputProgressNumber">进度</label>
            <div class="number-wrap">
              <input type="number" id="inputProgressNumber" class="progress-number" min="0" max="100" step="1" value="${progress != null ? progress : ''}" placeholder="—" aria-label="手动进度" oninput="onNumberInput(this.value)" onkeydown="onProgressKeyDown(event)">
              <span>%</span>
            </div>
          </div>

          <div class="range" id="rangeBox" style="--mark:${stateColor}; --fill:${progress != null ? Math.max(0, Math.min(100, progress)) : 0}%;">
            <div class="range-track"></div>
            <div class="range-nodes" aria-hidden="true">
              ${[0, 25, 50, 75, 100].map(val => `
                <span class="range-node" style="--at:${val}%;">
                  <span class="range-node-label">${val}</span>
                </span>
              `).join('')}
            </div>
            <input type="range" id="inputSlider" class="range-input" min="0" max="100" step="1" value="${progress != null ? progress : 0}" aria-label="拖动调整进度" onpointerdown="onSliderPointerDown()" onpointerup="onSliderPointerUp()" onpointercancel="onSliderPointerUp()" oninput="onSliderInput(this.value)">
          </div>

          <div class="unknown-row">
            <button type="button" class="unknown" onclick="onClearProgressClick()">清空进度</button>
          </div>
        </div>

        <label class="note-label" for="txtNote">备注</label>
        <textarea id="txtNote" class="note-input" maxlength="4000" placeholder="记下下一步要做的事…" aria-label="事项备注" oninput="markFormDirty()">${escapeHtml(note)}</textarea>

        <div id="conflictBox" class="conflict-box" style="display:none; margin: 10px 0; padding: 8px 12px; background: rgba(230, 80, 80, 0.12); border: 1px solid rgba(230, 80, 80, 0.35); border-radius: 6px; font-size: 12px; line-height: 1.5; color: var(--ink);">
          <div id="conflictMsg">保存冲突：内容已被其他入口修改。当前草稿已保留。</div>
          <div style="margin-top: 6px;">
            <button type="button" class="text-button" id="btnResolveConflict" style="color: var(--mark); text-decoration: underline; padding: 0;" onclick="resolveConflictKeepDraft()">读取最新版本并保留草稿</button>
          </div>
        </div>

        <div class="edit-actions">
          <button class="text-button" onclick="switchToOverview()">取消</button>
          <button class="primary" id="btnSaveRecord" onclick="onSaveRecord()">保存记录</button>
        </div>
      </div>
    </div>

    <div class="feedback-msg" id="feedbackMsg" role="status"></div>
  </div>

  <script>
    const colors = ${JSON.stringify(colors)};
    const labels = ${JSON.stringify(labels)};
    const taskLabels = ${JSON.stringify(taskLabels)};
    const conversationId = ${JSON.stringify(conversationId)};
    const connection = ${configJson};
    let currentRevision = ${Number(revision) || 0};
    let savedRevision = ${Number(revision) || 0};
    let draftBaseRevision = savedRevision;
    let isFormDirty = false;
    let currentState = ${JSON.stringify(state)};
    let currentProgress = ${progress != null ? Number(progress) : 'null'};
    let isDraggingSlider = false;
    let hostChannelPort = null;

    function resetScroll() {
      const panel = document.getElementById('panelBody');
      const shell = document.getElementById('agentThingsCard');
      if (panel) panel.scrollTop = 0;
      if (shell) shell.classList.remove('is-scrolled');
    }

    function showConflictNotice(msg) {
      const box = document.getElementById('conflictBox');
      const text = document.getElementById('conflictMsg');
      if (box && text) {
        text.textContent = msg || '保存冲突：内容已被其他入口修改。当前草稿已保留。';
        box.style.display = 'block';
      }
      showFeedback('保存失败：检测到版本冲突', true);
    }

    function hideConflictNotice() {
      const box = document.getElementById('conflictBox');
      if (box) box.style.display = 'none';
    }

    function resolveConflictKeepDraft() {
      draftBaseRevision = savedRevision;
      hideConflictNotice();
      showFeedback('基准版本已对齐最新状态，再次点击保存即可提交当前草稿。');
    }

    function switchToEdit() {
      resetScroll();
      draftBaseRevision = savedRevision;
      isFormDirty = false;
      hideConflictNotice();
      document.getElementById('overviewView').hidden = true;
      document.getElementById('historyView').hidden = true;
      document.getElementById('editView').hidden = false;
      clearFeedback();
    }

    function switchToEditNote() {
      switchToEdit();
      setTimeout(function() {
        const txt = document.getElementById('txtNote');
        if (txt) txt.focus();
      }, 50);
    }

    function switchToHistory() {
      resetScroll();
      document.getElementById('overviewView').hidden = true;
      document.getElementById('editView').hidden = true;
      document.getElementById('historyView').hidden = false;
      clearFeedback();
    }

    function switchToOverview() {
      resetScroll();
      document.getElementById('editView').hidden = true;
      document.getElementById('historyView').hidden = true;
      document.getElementById('overviewView').hidden = false;
      isFormDirty = false;
      hideConflictNotice();
      clearFeedback();
      checkSummaryOverflow();
    }

    function markFormDirty() {
      isFormDirty = true;
    }

    function selectState(stateKey, isRemoteSync = false) {
      if (!isRemoteSync) markFormDirty();
      currentState = stateKey;
      for (const key of Object.keys(labels)) {
        const btn = document.getElementById('choice-' + key);
        if (btn) btn.setAttribute('aria-pressed', String(key === stateKey));
      }
      if (!isRemoteSync) {
        if (stateKey === 'unstarted') {
          updateProgressVal(0);
        } else if (stateKey === 'completed' || stateKey === 'pushed') {
          updateProgressVal(100);
        }
      }
      updateRangeMark(colors[stateKey] || colors.unfinished);
    }

    function onNumberInput(val) {
      markFormDirty();
      const num = val === '' ? null : Number(val);
      if (num !== null && !isNaN(num)) {
        const clamped = Math.max(0, Math.min(100, Math.round(num)));
        updateProgressVal(clamped);
        const nextState = clamped === 100 ? (currentState === 'pushed' ? 'pushed' : 'completed')
          : (clamped === 0 && currentState === 'unstarted' ? 'unstarted' : 'unfinished');
        selectState(nextState);
      } else {
        updateProgressVal(null);
      }
    }

    function onProgressKeyDown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        onSaveRecord();
      }
    }

    function onSliderPointerDown() {
      isDraggingSlider = true;
    }

    function onSliderPointerUp() {
      isDraggingSlider = false;
    }

    function onSliderInput(val) {
      markFormDirty();
      const value = Number(val);
      const nearest = Math.round(value / 25) * 25;
      const snapped = (isDraggingSlider && Math.abs(value - nearest) <= 2) ? nearest : value;
      updateProgressVal(snapped);
      const nextState = snapped === 100 ? (currentState === 'pushed' ? 'pushed' : 'completed')
        : (snapped === 0 && currentState === 'unstarted' ? 'unstarted' : 'unfinished');
      selectState(nextState);
    }

    function onClearProgressClick() {
      updateProgressVal(null);
    }

    function updateProgressVal(val) {
      currentProgress = val;
      const slider = document.getElementById('inputSlider');
      const numberInput = document.getElementById('inputProgressNumber');
      const rangeBox = document.getElementById('rangeBox');
      if (slider) slider.value = val !== null ? val : 0;
      if (numberInput) numberInput.value = val !== null ? val : '';
      if (rangeBox) rangeBox.style.setProperty('--fill', (val !== null ? val : 0) + '%');
    }

    function updateRangeMark(markColor) {
      const rangeBox = document.getElementById('rangeBox');
      if (rangeBox) rangeBox.style.setProperty('--mark', markColor);
    }

    function toggleAllRemaining() {
      const hiddenRows = document.querySelectorAll('.remaining-hidden');
      const btn = document.getElementById('btnToggleAllRemaining');
      const isExpanded = btn?.getAttribute('data-expanded') === 'true';
      hiddenRows.forEach(function(row) { row.hidden = isExpanded; });
      if (btn) {
        btn.setAttribute('data-expanded', String(!isExpanded));
        const total = hiddenRows.length + 3;
        btn.textContent = isExpanded ? ('查看全部 ' + total + ' 条 ›') : '收起 ›';
      }
    }

    function toggleSummaryExpand() {
      const block = document.getElementById('summaryBlock');
      const btn = document.getElementById('summaryExpand');
      if (!block || !btn) return;
      const isExpanded = block.classList.toggle('expanded');
      btn.textContent = isExpanded ? '收起' : '查看全部';
    }

    function checkSummaryOverflow() {
      const summaryEl = document.getElementById('overviewSummary');
      const btn = document.getElementById('summaryExpand');
      if (summaryEl && btn) {
        btn.hidden = summaryEl.scrollHeight <= summaryEl.clientHeight + 2;
      }
    }

    function postWindowLocateRequest(source, { timeoutMs = 15000 } = {}) {
      return new Promise((resolve, reject) => {
        if (!window.parent || window.parent === window) {
          reject(new Error('当前环境不支持跳转来源'));
          return;
        }
        const nonce = 'loc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
        const timer = setTimeout(() => {
          pendingActions.delete(nonce);
          reject(new Error('定位来源超时，请在原会话中确认历史消息'));
        }, timeoutMs);
        pendingActions.set(nonce, { resolve, reject, timer });
        try {
          window.parent.postMessage({
            type: 'AGENT_THINGS_LOCATE',
            conversationId,
            nonce,
            source,
          }, '*');
        } catch (err) {
          clearTimeout(timer);
          pendingActions.delete(nonce);
          reject(err);
        }
      });
    }

    async function onSourceClick(button) {
      if (button) button.disabled = true;
      try {
        const sourceJson = button.getAttribute('data-source');
        if (!sourceJson) return;
        const source = JSON.parse(sourceJson);
        showFeedback('正在跳转到来源消息…');

        const result = hostChannelPort
          ? await postHostChannelRequest({
              type: 'AGENT_THINGS_LOCATE',
              source,
            }, { timeoutMs: 18000, errorLabel: '跳转来源消息超时' })
          : await postWindowLocateRequest(source);

        showFeedback(result?.message || '已跳转到会话来源');
      } catch (err) {
        showFeedback('跳转失败：' + (err.message || '未知错误'), true);
      } finally {
        if (button) button.disabled = false;
      }
    }

    function showFeedback(msg, isError = false) {
      const el = document.getElementById('feedbackMsg');
      if (!el) return;
      el.textContent = msg;
      el.className = 'feedback-msg ' + (isError ? 'error' : 'success');
      setTimeout(function() { if (el.textContent === msg) el.textContent = ''; }, 4000);
    }

    function clearFeedback() {
      const el = document.getElementById('feedbackMsg');
      if (el) el.textContent = '';
    }

    let sseSource = null;
    let sseReconnectTimer = null;
    let authTicket = null;
    let serviceOrigin = connection?.origin || null;
    const pendingActions = new Map();

    function postHostChannelRequest(message, { timeoutMs = 12000, errorLabel = '宿主桥响应超时' } = {}) {
      return new Promise((resolve, reject) => {
        if (!hostChannelPort) {
          reject(new Error('未建立安全宿主端口通道，无法执行操作'));
          return;
        }
        const nonce = 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
        const timer = setTimeout(() => {
          pendingActions.delete(nonce);
          reject(new Error(errorLabel));
        }, timeoutMs);

        pendingActions.set(nonce, { resolve, reject, timer });

        try {
          hostChannelPort.postMessage(Object.assign({}, message, {
            conversationId: conversationId,
            nonce: nonce,
          }));
        } catch (err) {
          clearTimeout(timer);
          pendingActions.delete(nonce);
          reject(err);
        }
      });
    }

    async function sendProxyAction(action, payload = {}) {
      if (!hostChannelPort) {
        try { await requestHostAuth(); } catch (_) {}
      }
      return postHostChannelRequest({
        type: 'AGENT_THINGS_ACTION_PROXY',
        action: action,
        payload: payload,
      });
    }

    function sendOpenPaneViaEmbedNative() {
      if (window.parent && window.parent !== window) {
        try {
          window.parent.postMessage({
            type: 'OPEN_SIDECAR',
            target: 'things/things_board',
          }, '*');
          return true;
        } catch (_) {}
      }
      return false;
    }

    async function onOpenPaneClick() {
      const btn = document.getElementById('btnOpenPane');
      if (btn && btn.disabled) return;
      try {
        if (btn) btn.disabled = true;
        clearFeedback();
        if (hostChannelPort) {
          try {
            await postHostChannelRequest({
              type: 'AGENT_THINGS_OPEN_PANE',
            }, { timeoutMs: 4500, errorLabel: '打开侧栏响应超时' });
            return;
          } catch (err) {
            if (err && err.isHostBusinessError) {
              throw err;
            }
            if (sendOpenPaneViaEmbedNative()) {
              return;
            }
            throw err;
          }
        }
        if (sendOpenPaneViaEmbedNative()) {
          return;
        }
        try { await requestHostAuth(); } catch (_) {}
        if (hostChannelPort) {
          await postHostChannelRequest({
            type: 'AGENT_THINGS_OPEN_PANE',
          }, { timeoutMs: 4500, errorLabel: '打开侧栏响应超时' });
          return;
        }
        throw new Error('当前环境不支持在侧栏打开');
      } catch (err) {
        showFeedback('打开侧栏失败: ' + (err?.message || '未知错误'), true);
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    function onIncomingHostMessage(data) {
      if (!data || typeof data !== 'object') return;

      if (data.type === 'AGENT_THINGS_AUTH_RESPONSE' && data.nonce) {
        const req = pendingActions.get(data.nonce);
        if (req) {
          clearTimeout(req.timer);
          pendingActions.delete(data.nonce);
          if (data.origin) serviceOrigin = data.origin;
          if (data.ticket) authTicket = data.ticket;
          req.resolve(data);
        }
        return;
      }

      if ((data.type === 'AGENT_THINGS_ACTION_RESULT' || data.type === 'AGENT_THINGS_LOCATE_RESULT') && data.nonce) {
        const req = pendingActions.get(data.nonce);
        if (req) {
          clearTimeout(req.timer);
          pendingActions.delete(data.nonce);
          const actionOk = data.success !== undefined ? Boolean(data.success) : Boolean(data.located);
          if (actionOk) {
            req.resolve(data.data || (data.message ? { message: data.message } : {}));
          } else {
            const err = new Error(data.error || data.message || '操作失败');
            err.isHostBusinessError = true;
            req.reject(err);
          }
        }
        return;
      }
    }

    function requestHostAuth() {
      return new Promise((resolve, reject) => {
        const nonce = 'auth-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
        const timer = setTimeout(() => {
          pendingActions.delete(nonce);
          if (hostChannelPort && !authTicket) {
            try { hostChannelPort.close(); } catch (_) {}
            hostChannelPort = null;
          }
          reject(new Error('申请订阅票据超时'));
        }, 8000);

        pendingActions.set(nonce, { resolve, reject, timer });

        try {
          // 若已有绑定的专属端口（后台重启换票场景），直接通过原端口原路发送换票请求，不重新广播替换端口
          if (hostChannelPort) {
            try {
              hostChannelPort.postMessage({
                type: 'AGENT_THINGS_AUTH_REQUEST',
                conversationId: conversationId,
                nonce: nonce,
              });
              return;
            } catch (_) {
              try { hostChannelPort.close(); } catch (_) {}
              hostChannelPort = null;
            }
          }

          // 首次握手：创建 MessageChannel 并在窗口上携带 loadToken 转移 port2
          if (typeof MessageChannel !== 'undefined') {
            const channel = new MessageChannel();
            hostChannelPort = channel.port1;
            hostChannelPort.onmessage = (event) => onIncomingHostMessage(event.data);
            window.parent.postMessage({
              type: 'AGENT_THINGS_AUTH_REQUEST',
              conversationId: conversationId,
              nonce: nonce,
              loadToken: (typeof window !== 'undefined' && window.__agentThingsLoadToken) ? window.__agentThingsLoadToken : (connection?.loadToken || null),
            }, '*', [channel.port2]);
          } else {
            clearTimeout(timer);
            pendingActions.delete(nonce);
            reject(new Error('宿主不支持 MessageChannel 安全端口通信'));
            return;
          }
        } catch (err) {
          clearTimeout(timer);
          pendingActions.delete(nonce);
          reject(err);
        }
      });
    }

    window.addEventListener('message', (event) => {
      try {
        onIncomingHostMessage(event.data);
      } catch (_) {}
    });

    async function onSaveRecord() {
      const btn = document.getElementById('btnSaveRecord');
      const noteVal = document.getElementById('txtNote')?.value ?? '';
      try {
        if (btn) btn.disabled = true;
        showFeedback('正在保存…');
        const reply = await sendProxyAction('update', {
          expectedRevision: draftBaseRevision,
          record: {
            state: currentState,
            progress: currentProgress,
            note: noteVal
          }
        });
        // 修复：sendProxyAction 已解包 data，调用方应读 reply.session.recordRevision
        const newRev = reply?.session?.recordRevision;
        if (typeof newRev === 'number') {
          savedRevision = newRev;
          draftBaseRevision = newRev;
          currentRevision = newRev;
        }
        isFormDirty = false;
        hideConflictNotice();
        showFeedback('✓ 保存成功');
        setTimeout(switchToOverview, 600);
      } catch (err) {
        const isConflict = err.message && (err.message.includes('其他窗口更新') || err.message.includes('版本已被') || err.message.includes('409') || err.message.includes('conflict') || err.message.includes('revision mismatch'));
        if (isConflict) {
          showConflictNotice('保存冲突：内容已被其他入口修改。当前草稿已保留。');
        } else {
          showFeedback('保存失败: ' + err.message, true);
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    }

    async function onClearClick() {
      if (!confirm('确定要清除本会话的任务进度和记录吗？')) return;
      try {
        showFeedback('正在清除…');
        const reply = await sendProxyAction('clear', {
          expectedRevision: draftBaseRevision,
        });
        const newRev = reply?.session?.recordRevision;
        if (typeof newRev === 'number') {
          savedRevision = newRev;
          draftBaseRevision = newRev;
          currentRevision = newRev;
        }
        isFormDirty = false;
        hideConflictNotice();
        showFeedback('✓ 已清空进度');
      } catch (err) {
        showFeedback('清除失败: ' + err.message, true);
      }
    }

    function handleRemoteSessionUpdate(payload) {
      if (!payload) return;
      const s = payload.session || payload;
      const effectiveProgress = typeof s.progress === 'number' ? s.progress : typeof s.progress?.progress === 'number' ? s.progress.progress : (typeof s === 'number' ? s : null);
      const effectiveState = s.state || s.progress?.state || (effectiveProgress === 100 ? 'completed' : (effectiveProgress > 0 ? 'unfinished' : 'unstarted'));
      const effectiveTasks = Array.isArray(s.tasks) ? s.tasks : (Array.isArray(s.progress?.tasks) ? s.progress.tasks : (s.analysis?.ledger?.tasks || []));
      const effectiveNote = s.note || s.progress?.note || '';
      const effectiveSummary = s.summary || s.progress?.summary || s.analysis?.ledger?.summary || '';
      const effectiveTitle = s.title || s.progress?.title || '';

      if (typeof s.recordRevision === 'number') savedRevision = Math.max(savedRevision, s.recordRevision);
      else if (typeof s.progress?.revision === 'number') savedRevision = Math.max(savedRevision, s.progress.revision);
      else if (typeof s.revision === 'number') savedRevision = Math.max(savedRevision, s.revision);

      // 若未处于草稿编辑中，基准版本与当前展示版本同步更新
      if (!isFormDirty) {
        currentRevision = savedRevision;
        draftBaseRevision = savedRevision;
      }

      const analyzing = Boolean(s.analyzing || s.analysisStatus?.status === 'pending');
      const analysisStatus = s.analysisStatus;
      const btnAnalyze = document.getElementById('btnAnalyze');
      if (btnAnalyze) {
        if (analyzing) {
          btnAnalyze.disabled = true;
          btnAnalyze.textContent = '正在分析…';
        } else {
          btnAnalyze.disabled = false;
          btnAnalyze.textContent = '更新进度';
          if (analysisStatus?.status === 'failed') {
            showFeedback('分析未完成: ' + (analysisStatus.error || '执行异常'), true);
          }
        }
      }

      // 仅在非 dirty 编辑态下将远端状态刷入表单与展示
      if (!isFormDirty) {
        applyFullProgressToUI({
          state: effectiveState,
          progress: effectiveProgress,
          tasks: effectiveTasks,
          note: effectiveNote,
          summary: effectiveSummary,
          title: effectiveTitle,
          revision: currentRevision,
        });
      }
    }

    function applyFullProgressToUI(data) {
      if (!data) return;
      currentRevision = data.revision ?? currentRevision;
      const nextState = data.state || (data.progress === 100 ? 'completed' : data.progress > 0 ? 'unfinished' : 'unstarted');
      const nextProgress = data.progress ?? null;

      if (!isFormDirty) {
        currentState = nextState;
        currentProgress = nextProgress;
        updateProgressVal(currentProgress);
        selectState(currentState, true);
        const noteInput = document.getElementById('txtNote');
        if (noteInput) noteInput.value = data.note || '';
        const noteOpenLabel = document.getElementById('noteOpenLabel');
        if (noteOpenLabel) noteOpenLabel.textContent = data.note ? '编辑' : '添加';
      }

      if (data.title && data.title !== '当前会话') {
        const titleEl = document.getElementById('cardTitle');
        if (titleEl) {
          titleEl.textContent = data.title;
          titleEl.title = data.title;
        }
      }

      const scoreEl = document.getElementById('overviewScoreNumber');
      if (scoreEl) scoreEl.textContent = currentProgress !== null ? currentProgress : '—';
      const scoreUnit = document.querySelector('.score-unit');
      if (scoreUnit) scoreUnit.hidden = currentProgress === null;

      const labelEl = document.getElementById('overviewStatusLabel');
      if (labelEl) labelEl.textContent = labels[currentState] || currentState;
      const dotEl = document.getElementById('overviewDot');
      if (dotEl) {
        dotEl.style.borderColor = colors[currentState] || colors.unstarted;
        dotEl.style.background = 'transparent';
      }

      const meterEl = document.getElementById('overviewMeter');
      if (meterEl) {
        const prog = currentProgress != null ? Math.max(0, Math.min(100, currentProgress)) : 0;
        meterEl.style.setProperty('--fill', prog + '%');
        meterEl.style.setProperty('--mark', colors[currentState] || colors.unstarted);
      }

      const totalCount = data.totalTasks ?? data.tasks?.length ?? 0;
      const doneCount = data.completedTasks ?? data.tasks?.filter(function(t) { return t.status === 'done'; }).length ?? 0;
      const totalsEl = document.getElementById('overviewTotals');
      if (totalsEl) {
        totalsEl.textContent = totalCount > 0 ? ('已完成 ' + doneCount + ' / ' + totalCount + ' 项任务') : '暂无任务统计';
      }

      const summaryText = data.summary || data.note || '';
      const summaryEl = document.getElementById('overviewSummary');
      if (summaryEl && summaryText) {
        summaryEl.textContent = summaryText;
      }
      checkSummaryOverflow();

      const titleProgress = document.getElementById('titleProgress');
      if (titleProgress) {
        const color = colors[currentState] || colors.unstarted;
        const hasProgress = currentProgress !== null && currentProgress !== undefined && Number.isFinite(currentProgress);
        const progVal = hasProgress ? Math.max(0, Math.min(100, currentProgress)) : 0;

        let piePath = '';
        if (hasProgress && progVal > 0) {
          const angle = (progVal / 100) * Math.PI * 2;
          const x = (12 + 7.4 * Math.sin(angle)).toFixed(2);
          const y = (12 - 7.4 * Math.cos(angle)).toFixed(2);
          piePath = progVal === 100
            ? '<path d="M12 4.6a7.4 7.4 0 1 1 0 14.8a7.4 7.4 0 1 1 0-14.8" fill="' + color + '" class="progress-pie"/>'
            : '<path d="M12 12L12 4.6A7.4 7.4 0 ' + (progVal > 50 ? 1 : 0) + ' 1 ' + x + ' ' + y + 'Z" fill="' + color + '" class="progress-pie"/>';
        }

        const isHundred = progVal === 100;
        const fontSize = isHundred ? '5.8px' : '6.4px';
        const letterSpacing = isHundred ? '-0.3px' : '-0.2px';

        titleProgress.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" style="overflow:visible">' +
          '<circle cx="12" cy="12" r="10" fill="none" stroke="' + color + '" stroke-width="1.6" opacity="' + (hasProgress ? '1' : '0.85') + '"/>' +
          piePath +
          '<text x="12" y="12.4" text-anchor="middle" dominant-baseline="middle" fill="' + color + '" class="' + (hasProgress ? '' : 'progress-unknown') + '" style="font:600 ' + fontSize + ' -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:' + letterSpacing + ';font-variant-numeric:tabular-nums">' + (hasProgress ? (progVal + '%') : '—') + '</text>' +
          '</svg>';
      }

      if (Array.isArray(data.tasks)) {
        const remaining = data.tasks.filter(function(t) { return t.status !== 'done'; });
        const completed = data.tasks.filter(function(t) { return t.status === 'done'; });

        const remainingHeading = document.getElementById('remainingTasksHeading');
        if (remainingHeading) remainingHeading.textContent = '剩余任务 ' + remaining.length;

        const toggleBtn = document.getElementById('btnToggleAllRemaining');
        if (toggleBtn) {
          toggleBtn.hidden = remaining.length <= 3;
          toggleBtn.textContent = '查看全部 ' + remaining.length + ' 条 ›';
          toggleBtn.setAttribute('data-expanded', 'false');
        }

        const historyCount = document.getElementById('historyCount');
        if (historyCount) historyCount.textContent = completed.length + ' 条 ›';

        const uncompletedList = document.getElementById('uncompletedTasksList');
        if (uncompletedList) {
          let html = '';
          if (data.tasks.length === 0) {
            html = '<div class="empty">点击更新进度，整理这次会话的任务</div>';
          } else if (remaining.length === 0) {
            html = '<div class="empty">暂无未完成任务</div>';
          }
          html += remaining.map(function(task, idx) {
            const hasSource = Boolean(task.source && (task.source.locator || task.source.turnId));
            const badge = taskLabels[task.status] || task.status;
            const titleText = task.title || task.summary || '未命名事项';
            return '<div class="task-row ' + (idx >= 3 ? 'remaining-hidden' : '') + '" data-status="' + escapeHtml(task.status) + '" tabindex="0" ' + (idx >= 3 ? 'hidden' : '') + '>' +
              '<span class="task-dot"></span>' +
              '<div class="task-content">' +
                '<div class="task-title">' + escapeHtml(titleText) + '</div>' +
                '<div class="task-meta">' + escapeHtml(badge) + '</div>' +
              '</div>' +
              (hasSource ? '<div class="task-source"><button type="button" aria-label="' + escapeHtml('查看来源：' + titleText) + '" data-source="' + escapeHtml(JSON.stringify(task.source)) + '" onclick="onSourceClick(this)">查看来源</button></div>' : '') +
            '</div>';
          }).join('');
          uncompletedList.innerHTML = html;
        }

        const historyList = document.getElementById('historyList');
        if (historyList) {
          let html = '';
          if (completed.length === 0) {
            html = '<div class="empty">暂无已完成任务</div>';
          }
          html += completed.map(function(task) {
            const hasSource = Boolean(task.source && (task.source.locator || task.source.turnId));
            const titleText = task.title || task.summary || '已完成事项';
            return '<div class="task-row" data-status="done" tabindex="0">' +
              '<span class="task-dot"></span>' +
              '<div class="task-content">' +
                '<div class="task-title">' + escapeHtml(titleText) + '</div>' +
                '<div class="task-meta">已完成</div>' +
              '</div>' +
              (hasSource ? '<div class="task-source"><button type="button" aria-label="' + escapeHtml('查看来源：' + titleText) + '" data-source="' + escapeHtml(JSON.stringify(task.source)) + '" onclick="onSourceClick(this)">查看来源</button></div>' : '') +
            '</div>';
          }).join('');
          historyList.innerHTML = html;
        }
      }

      if (hostChannelPort) {
        try {
          hostChannelPort.postMessage({
            type: 'AGENT_THINGS_CARD_UPDATED',
            conversationId: conversationId,
            progress: currentProgress,
            revision: currentRevision,
            state: currentState,
          });
        } catch (_) {}
      }
    }

    async function onAnalyzeClick() {
      const btn = document.getElementById('btnAnalyze');
      try {
        if (btn) {
          btn.disabled = true;
          btn.textContent = '正在分析…';
        }
        showFeedback('正在开始分析…');
        await sendProxyAction('analyze', {});
      } catch (err) {
        showFeedback('更新失败: ' + err.message, true);
        if (btn) {
          btn.disabled = false;
          btn.textContent = '更新进度';
        }
      }
    }

    async function initEventStream() {
      if (sseReconnectTimer) {
        clearTimeout(sseReconnectTimer);
        sseReconnectTimer = null;
      }
      if (sseSource) {
        try { sseSource.close(); } catch (_) {}
        sseSource = null;
      }

      try {
        const auth = await requestHostAuth();
        if (!auth?.ticket || !auth?.origin) {
          scheduleReconnect();
          return;
        }
        authTicket = auth.ticket;
        serviceOrigin = auth.origin;

        const sseUrl = auth.origin + '/session/events?id=' + encodeURIComponent(conversationId) + '&ticket=' + encodeURIComponent(auth.ticket);
        const es = new EventSource(sseUrl);
        sseSource = es;

        es.addEventListener('snapshot', function(ev) {
          try {
            const data = JSON.parse(ev.data);
            handleRemoteSessionUpdate(data);
          } catch (_) {}
        });

        es.addEventListener('change', function(ev) {
          try {
            const data = JSON.parse(ev.data);
            handleRemoteSessionUpdate(data);
          } catch (_) {}
        });

        es.onerror = function() {
          try { es.close(); } catch (_) {}
          sseSource = null;
          scheduleReconnect();
        };
      } catch (_) {
        scheduleReconnect();
      }
    }

    function scheduleReconnect() {
      if (sseReconnectTimer) return;
      sseReconnectTimer = setTimeout(function() {
        sseReconnectTimer = null;
        initEventStream();
      }, 2000);
    }

    function setupScrollListener() {
      const panel = document.getElementById('panelBody');
      const shell = document.getElementById('agentThingsCard');
      if (!panel || !shell) return;
      panel.addEventListener('scroll', function() {
        const isScrolled = panel.scrollTop > 8;
        shell.classList.toggle('is-scrolled', isScrolled);
      }, { passive: true });
    }

    function initCard() {
      checkSummaryOverflow();
      setupScrollListener();
      initEventStream();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCard);
    } else {
      initCard();
    }
  </script>
</body>
</html>`;
}

function getAntigravityHttpConnection(stateFile) {
  const file = stateFile || path.join(os.homedir(), '.gemini', 'antigravity', 'session-status', 'manual-state.json');
  const credsFile = `${file}.http.json`;
  if (!fs.existsSync(credsFile)) return null;
  try {
    const creds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    return {
      origin: `http://127.0.0.1:${creds.port}`,
    };
  } catch {
    return null;
  }
}

function generateCardArtifact({
  conversationId,
  title,
  record,
  tasks,
  summary,
  revision,
  brainDir,
  artifactDir,
  stateFile,
  loadToken = null,
  connection: passedConnection = null,
}) {
  const dir = brainDir || artifactDir || path.join(os.homedir(), '.gemini', 'antigravity', 'brain', conversationId);
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'things-card.html');
  const connection = passedConnection || getAntigravityHttpConnection(stateFile) || {};
  const token = loadToken || passedConnection?.loadToken || connection.loadToken || ('token-' + crypto.randomBytes(16).toString('hex'));
  connection.loadToken = token;
  const html = renderAntigravityCardHtml({
    title,
    conversationId,
    record,
    tasks,
    summary,
    revision,
    connection,
  });
  fs.writeFileSync(htmlPath, html, 'utf8');
  return {
    path: htmlPath,
    embedTag: `<agent-embed src="file://${htmlPath}"></agent-embed>`,
    loadToken: token,
  };
}

module.exports = {
  renderAntigravityCardHtml,
  generateCardArtifact,
  getAntigravityHttpConnection,
  colors,
  labels,
  taskLabels,
};
