'use strict';
const { readConfiguredLang } = require('./i18n.cjs');

const messages = {
  zh: {
    INVALID_ARGUMENT: '请求参数无效',
    SESSION_MISMATCH: '会话身份不匹配',
    REVISION_CONFLICT: '此会话已在其他窗口更新，请重新确认',
    REQUEST_TIMEOUT: '请求超时，请重试',
    HOST_UNAVAILABLE: '宿主连接不可用，请检查插件状态',
    SOURCE_NOT_FOUND: '未找到来源消息',
    CAPABILITY_UNAVAILABLE: '当前入口暂不支持此操作',
    ANALYSIS_FAILED: '分析失败，请查看分析记录',
    SERVICE_STOPPING: '后台正在停止，请稍后重试',
    REQUEST_CANCELLED: '请求已取消',
    PROTOCOL_MISMATCH: '插件版本已更新，请重新连接宿主 MCP',
  },
  en: {
    INVALID_ARGUMENT: 'Invalid request arguments',
    SESSION_MISMATCH: 'Session identity mismatch',
    REVISION_CONFLICT: 'This session was updated in another window; please confirm again',
    REQUEST_TIMEOUT: 'Request timed out, please retry',
    HOST_UNAVAILABLE: 'Host connection unavailable; check plugin status',
    SOURCE_NOT_FOUND: 'Source message not found',
    CAPABILITY_UNAVAILABLE: 'This action is unavailable from the current entry point',
    ANALYSIS_FAILED: 'Analysis failed; check analysis logs',
    SERVICE_STOPPING: 'Background service is shutting down, please retry shortly',
    REQUEST_CANCELLED: 'Request cancelled',
    PROTOCOL_MISMATCH: 'Plugin updated; please reconnect the host MCP server',
  },
};

const retry = new Set(['REQUEST_TIMEOUT', 'HOST_UNAVAILABLE', 'ANALYSIS_FAILED', 'SERVICE_STOPPING']);

function getMessage(code, lang = readConfiguredLang()) {
  const dict = messages[lang === 'en' ? 'en' : 'zh'];
  return dict[code] || messages.zh[code];
}

function progressError(code, message, retryable = retry.has(code), lang = readConfiguredLang()) {
  const resolved = message || getMessage(code, lang);
  return Object.assign(new Error(resolved), { code, retryable });
}

function errorDetails(error, fallback = 'HOST_UNAVAILABLE', lang = readConfiguredLang()) {
  const dict = messages[lang === 'en' ? 'en' : 'zh'];
  const code = Object.hasOwn(dict, error?.code) ? error.code
    : ['APP_SERVER_TIMEOUT', 'ETIMEDOUT', 'TimeoutError'].includes(error?.code || error?.name) ? 'REQUEST_TIMEOUT'
    : error?.name === 'AbortError' ? 'REQUEST_CANCELLED' : fallback;
  // Unclassified errors may contain host responses, user text or credentials.
  return { code, message: Object.hasOwn(dict, error?.code) ? error.message : dict[code], retryable: retry.has(code) };
}

module.exports = { progressError, errorDetails, getMessage };
