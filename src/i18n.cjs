'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPresentation } = require('./ui-foundation.cjs');

const SUPPORTED_LANGS = ['zh', 'en'];
const configCache = new Map();

function normalizeLang(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === 'zh' || /^zh(?:[-_]|$)/.test(trimmed)) return 'zh';
  if (trimmed === 'en' || /^en(?:[-_]|$)/.test(trimmed)) return 'en';
  return null;
}

function localeToSupportedLang(locale) {
  if (typeof locale !== 'string') return null;
  const trimmed = locale.trim();
  if (!trimmed || /^(?:c|posix)(?:\.|$)|^utf-?8$/i.test(trimmed)) return null;
  if (/^zh(?:[-_.]|$)/i.test(trimmed)) return 'zh';
  if (/^[a-z]{2,3}(?:[-_.@]|$)/i.test(trimmed)) return 'en';
  return null;
}

function readMacOsDefault(key) {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('/usr/bin/defaults', ['read', '-g', key], {
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { return null; }
}

// System UI language (System Settings → Language & Region → Preferred Languages).
function readAppleLanguage() {
  const out = readMacOsDefault('AppleLanguages');
  if (!out) return null;
  const first = out.match(/"([^"]+)"/)?.[1] || out.split(/[\r\n,()]+/).map(s => s.trim()).find(Boolean);
  return localeToSupportedLang(first);
}

// Region setting; Terminal derives LANG from it, so it says little about the UI language.
function readAppleLocale() {
  const out = readMacOsDefault('AppleLocale');
  return out ? localeToSupportedLang(out.trim()) : null;
}

function langFromEnv(env, keys) {
  for (const key of keys) {
    const raw = env?.[key];
    if (!raw) continue;
    for (const part of String(raw).split(':')) {
      const mapped = localeToSupportedLang(part);
      if (mapped) return mapped;
    }
  }
  return null;
}

// Priority: explicit override, explicit LC_ALL / LC_MESSAGES, the macOS UI language, then
// LANG / LANGUAGE (Terminal sets LANG from the region, not the UI language), the region and Intl.
function detectSystemLang(env = process.env, { readDefaults = true, appleLanguage = readAppleLanguage, appleLocale = readAppleLocale } = {}) {
  const override = normalizeLang(env?.AGENT_THINGS_LANG);
  if (override) return override;

  const explicit = langFromEnv(env, ['LC_ALL', 'LC_MESSAGES']);
  if (explicit) return explicit;

  if (readDefaults) {
    const uiLang = appleLanguage();
    if (uiLang) return uiLang;
  }

  const fromLang = langFromEnv(env, ['LANG', 'LANGUAGE']);
  if (fromLang) return fromLang;

  if (readDefaults) {
    const regionLang = appleLocale();
    if (regionLang) return regionLang;
  }

  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const mapped = localeToSupportedLang(intlLocale);
    if (mapped) return mapped;
  } catch {}

  return 'en';
}

function getDataDir(env = process.env) {
  const home = env?.HOME || os.homedir();
  return path.join(home, 'Library', 'Application Support', 'CodexSessionStatus');
}

function resolveConfigPath({ file, dataDir, homeDirectory, env = process.env } = {}) {
  if (file) return file;
  if (env?.SESSION_STATUS_CONFIG) return env.SESSION_STATUS_CONFIG;
  if (dataDir) {
    const base = path.basename(dataDir);
    if (base === 'CodexSessionStatus') return path.join(dataDir, 'config.json');
    const siblingConfig = path.join(dataDir, 'config.json');
    if (fs.existsSync(siblingConfig)) return siblingConfig;
  }
  if (homeDirectory) {
    return path.join(homeDirectory, 'Library', 'Application Support', 'CodexSessionStatus', 'config.json');
  }
  return path.join(getDataDir(env), 'config.json');
}

function readConfiguredLang(options = {}) {
  const env = options.env || process.env;
  const envLang = normalizeLang(env?.AGENT_THINGS_LANG);
  if (envLang) return envLang;

  const fallback = normalizeLang(options.fallback) || 'zh';
  const configFile = resolveConfigPath(options);
  try {
    const stat = fs.statSync(configFile);
    const cached = configCache.get(configFile);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.lang || fallback;
    }
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const lang = normalizeLang(parsed?.lang);
    configCache.set(configFile, { mtimeMs: stat.mtimeMs, lang });
    return lang || fallback;
  } catch {
    configCache.delete(configFile);
    return fallback;
  }
}

function getUi(lang = readConfiguredLang()) {
  return createPresentation(normalizeLang(lang) || 'zh');
}

function formatSessionMarkdownSummary({ lang = readConfiguredLang(), progressData = null, embedTag = '' } = {}) {
  const ui = getUi(lang);
  const s = ui.strings;
  const isEmptySession = progressData == null;
  const stateText = isEmptySession
    ? s.unrecordedSummary
    : (progressData?.state === 'completed' || progressData?.progress === 100
      ? s.mdStateDone
      : (progressData?.progress != null ? `${progressData.progress}%` : s.mdStateUnstarted));
  const total = progressData?.totalTasks || 0;
  const done = progressData?.completedTasks || 0;
  const tasksText = total > 0 ? ui.t('totalsPattern', { done, total }) : s.mdTasksEmpty;
  const noteText = progressData?.note
    ? (ui.lang === 'zh' ? `\n- **${s.mdNotesLabel}**：${progressData.note}` : `\n- **${s.mdNotesLabel}**: ${progressData.note}`)
    : '';
  const summaryText = isEmptySession ? s.unrecordedSummary : (progressData?.summary || '');
  const sep = ui.lang === 'zh' ? '：' : ': ';
  const userMarkdown = `${embedTag}\n\n**${s.mdProgressHeading}${sep}${stateText}**\n- **${s.mdTasksOverview}**${sep}${tasksText}${noteText}\n- **${s.mdQuickActionsLabel}**${sep}${s.mdQuickActionsText}`;
  return { stateText, tasksText, summaryText, userMarkdown };
}

module.exports = {
  SUPPORTED_LANGS,
  normalizeLang,
  detectSystemLang,
  getDataDir,
  resolveConfigPath,
  readConfiguredLang,
  getUi,
  formatSessionMarkdownSummary,
};
