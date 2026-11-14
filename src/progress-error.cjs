'use strict';
const messages = {
  INVALID_ARGUMENT: '请求参数无效', SESSION_MISMATCH: '会话身份不匹配', REVISION_CONFLICT: '此会话已在其他窗口更新，请重新确认',
  REQUEST_TIMEOUT: '请求超时，请重试', HOST_UNAVAILABLE: '宿主连接不可用，请检查插件状态', SOURCE_NOT_FOUND: '未找到来源消息',
  CAPABILITY_UNAVAILABLE: '当前入口暂不支持此操作', ANALYSIS_FAILED: '分析失败，请查看分析记录',
  SERVICE_STOPPING: '后台正在停止，请稍后重试', REQUEST_CANCELLED: '请求已取消', PROTOCOL_MISMATCH: '插件版本已更新，请重新连接宿主 MCP',
};
const retry = new Set(['REQUEST_TIMEOUT', 'HOST_UNAVAILABLE', 'ANALYSIS_FAILED', 'SERVICE_STOPPING']);
function progressError(code, message = messages[code], retryable = retry.has(code)) {
  return Object.assign(new Error(message), { code, retryable });
}
function errorDetails(error, fallback = 'HOST_UNAVAILABLE') {
  const code = Object.hasOwn(messages, error?.code) ? error.code
    : ['APP_SERVER_TIMEOUT', 'ETIMEDOUT', 'TimeoutError'].includes(error?.code || error?.name) ? 'REQUEST_TIMEOUT'
    : error?.name === 'AbortError' ? 'REQUEST_CANCELLED' : fallback;
  // Unclassified errors may contain host responses, user text or credentials.
  return { code, message: Object.hasOwn(messages, error?.code) ? error.message : messages[code], retryable: retry.has(code) };
}
module.exports = { progressError, errorDetails };
