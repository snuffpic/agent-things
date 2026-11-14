'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function extractVersionNumbers(slug) {
  const match = String(slug).match(/(\d+(?:\.\d+)*)/);
  return match ? match[1].split('.').map(Number) : [0];
}

function resolveLatestLuna(models) {
  if (!Array.isArray(models)) return null;
  const candidates = models.filter(m => m && typeof m.slug === 'string' && /luna/i.test(m.slug));
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const va = extractVersionNumbers(a.slug);
    const vb = extractVersionNumbers(b.slug);
    const len = Math.max(va.length, vb.length);
    for (let i = 0; i < len; i++) {
      const na = va[i] || 0;
      const nb = vb[i] || 0;
      if (na !== nb) return nb - na; // 降序，最高版本排在第一位
    }
    return b.slug.localeCompare(a.slug);
  });

  return candidates[0].slug;
}

function resolveLowCostModel(host = 'codex', { codexHome = path.join(os.homedir(), '.codex') } = {}) {
  if (process.env.SESSION_STATUS_MODEL) {
    return process.env.SESSION_STATUS_MODEL;
  }

  const normalizedHost = String(host || '').toLowerCase();

  if (normalizedHost.includes('antigravity') || normalizedHost.includes('gemini')) {
    return process.env.GEMINI_MODEL || 'gemini-3.8-flash-low';
  }

  if (normalizedHost.includes('claude') || normalizedHost.includes('anthropic')) {
    return process.env.CLAUDE_MODEL || 'claude-3-5-haiku-latest';
  }

  // Codex 宿主：动态从 models_cache.json 获取当前最高版本 Luna
  try {
    const cacheFile = path.join(codexHome, 'models_cache.json');
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const latestLuna = resolveLatestLuna(data?.models);
      if (latestLuna) return latestLuna;
    }
  } catch { /* 回退至默认 */ }

  return 'gpt-6-luna';
}

module.exports = {
  extractVersionNumbers,
  resolveLatestLuna,
  resolveLowCostModel,
};
