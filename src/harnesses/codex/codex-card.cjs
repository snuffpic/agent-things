'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { withStateFileLock } = require('../../state-file-lock.cjs');
const { requestProgressHttp } = require('../../local-progress-http.cjs');
const { createCardEvents } = require('./codex-card-events.cjs');
const { browserSource } = require('../../ui-foundation.cjs');

const { sessionView, PROTOCOL_VERSION } = require('../../session-view.cjs');
const { errorDetails } = require('../../progress-error.cjs');
const { readConfiguredLang, getUi } = require('../../i18n.cjs');

const uri = 'ui://agent-things/codex-progress';
function getCardTools(lang = readConfiguredLang()) {
  const en = lang === 'en';
  const id = {
    type: 'string',
    description: en ? 'Real CODEX_THREAD_ID of the current Codex chat' : 'Codex 当前聊天的真实 CODEX_THREAD_ID',
  };
  const properties = { conversation_id: id };
  const cardProperties = { ...properties, card_token: { type: 'string', pattern: '^[a-f0-9]{64}$' } };
  return [
    { name: 'open_session_card',
      description: en
        ? 'Open the Agent Things session progress card inline in the current Codex conversation. Read only.'
        : 'Open the Agent Things session progress card inline in the current Codex conversation. Read only. 在 Codex 信息流打开当前会话的进度卡片。',
      inputSchema: { type: 'object', properties: { ...properties, title: { type: 'string', maxLength: 160 } }, additionalProperties: false },
      annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri: uri, visibility: ['model'] }, 'openai/ui': { preferredModelDisplayMode: 'inline' } } },
    { name: 'read_session_card',
      description: en
        ? 'Read card status, Git info, version updates, or wait for session changes'
        : '读取卡片状态、Git 信息、版本或等待会话变更',
      inputSchema: { type: 'object', properties: { ...cardProperties, action: { enum: ['analysis-state', 'project-git', 'app-update-info', 'watch-state'] }, cursor: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, required: ['conversation_id', 'card_token', 'action'], additionalProperties: false },
      annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['app'] } } },
    { name: 'change_session_card',
      description: en
        ? 'Save, clear, analyze, locate source, or upgrade based on card actions'
        : '按卡片上的用户操作保存、清除、分析或升级',
      inputSchema: { type: 'object', properties: { ...cardProperties, action: { enum: ['update', 'analyze', 'locate-source', 'app-update-start'] },
        source: { type: 'object', properties: { turnId: { type: 'string' }, itemId: { type: 'string' } }, required: ['turnId', 'itemId'], additionalProperties: false },
        expectedRevision: { type: 'integer', minimum: 0 }, record: { type: ['object', 'null'] } }, required: ['conversation_id', 'card_token', 'action'], additionalProperties: false },
      _meta: { ui: { visibility: ['app'] } } },
  ];
}
const tools = getCardTools();
const resource = {
  descriptor: { uri, name: 'Agent Things · Progress', mimeType: 'text/html;profile=mcp-app' },
  read() {
    const lang = readConfiguredLang();
    const { t } = getUi(lang);
    const renderer = fs.readFileSync(path.join(__dirname, '../../session-status.js'), 'utf8');
    const bridge = fs.readFileSync(path.join(__dirname, 'codex-card-bridge.js'), 'utf8');
    const htmlLang = lang === 'en' ? 'en' : 'zh-CN';
    return `<!doctype html><html lang="${htmlLang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark;color:light-dark(#576374,#a0a6ad);background:transparent}body{margin:0;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#progress-card:empty{display:none}</style><body style="margin:0"><main id="progress-card" aria-live="polite">${t('loadingTitle')}</main><script>window.__agentThingsVersion = ${JSON.stringify(require('../../../package.json').version)};window.__agentThingsLang = ${JSON.stringify(lang)};\n${browserSource}\n${renderer}\n${bridge}</script></body></html>`;
  },
};

function cardAnalysisState(store, key) {
  const { revision, analysis, timeline } = store.analysisState(key);
  const tasks = analysis?.ledger?.tasks || [];
  const sources = {};
  for (const task of tasks) {
    for (const ref of task.evidenceRefs || []) {
      const source = analysis.sources?.[ref];
      if (source?.turnId) sources[ref] = { turnId: source.turnId, itemId: source.itemId, locator: source.locator };
    }
  }
  return { revision, analysis: analysis ? { ledger: { tasks }, sources } : null,
    timeline: timeline.map(({ source, status, stage, requestedAt, progress, record, error }) =>
      ({ source, status, stage, requestedAt, progress, record: record && { progress: record.progress }, error })),
  };
}

function cardState(store, key, lang = readConfiguredLang({ dataDir: store.file ? path.dirname(store.file) : undefined })) {
  const state = store.snapshot();
  return { session: sessionView(store, key, { capabilities: { locate: true }, lang }), snapshot: { revision: state.revision, lang, records: Object.hasOwn(state.records, key) ? { [key]: state.records[key] } : {} },
    analysisState: cardAnalysisState(store, key), lang };
}

function loadCardSecret(file, lang = readConfiguredLang()) {
  const read = () => {
    const secret = fs.readFileSync(file);
    if (secret.length !== 32) throw new Error(lang === 'en' ? 'Invalid card authorization secret' : '卡片授权密钥无效');
    return secret;
  };
  try { return read(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return withStateFileLock(file, () => {
    if (fs.existsSync(file)) return read();
    const secret = randomBytes(32);
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, secret, { mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return secret;
  });
}

function createCodexCard({ store, request = (message, options) => requestProgressHttp(store.file, '/rpc', message, undefined, options) }) {
  let secret;
  const currentLang = () => (typeof store.lang === 'function' ? store.lang() : readConfiguredLang({ dataDir: store.file ? path.dirname(store.file) : undefined }));
  const cardToken = conversationId => {
    secret ||= loadCardSecret(`${store.file}.codex-card-key`, currentLang());
    return createHmac('sha256', secret).update(conversationId).digest();
  };
  const read = key => cardState(store, key, currentLang());
  const events = createCardEvents({ store, read });
  async function call(name, args, meta, options = {}) {
    const lang = currentLang();
    const { t } = getUi(lang);
    const en = lang === 'en';
    const hostId = meta?.thread_id || meta?.threadId;
    const conversationId = args.conversation_id || hostId;
    if (typeof conversationId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conversationId)) {
      throw new Error(en ? 'Please provide the real conversation ID of the current Codex chat' : '请提供当前 Codex 聊天的真实会话 ID');
    }
    if (hostId && hostId !== conversationId) {
      throw new Error(en ? 'Card does not match the current Codex chat' : '卡片与当前 Codex 聊天不匹配');
    }
    const opening = name === 'open_session_card';
    if (!opening && (typeof args.card_token !== 'string' || !/^[a-f0-9]{64}$/.test(args.card_token)
      || !timingSafeEqual(Buffer.from(args.card_token, 'hex'), cardToken(conversationId)))) {
      throw new Error(t('cardAuthUnavailable'));
    }
    const key = store.resolveKey(conversationId);
    const payload = { lang };
    let conflict, failure;
    if (name === 'open_session_card') {
      payload.conversationId = conversationId;
      payload.key = key;
      payload.title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) || t('fallbackShortTitle') : t('fallbackShortTitle');
    } else if (name === 'read_session_card' && args.action === 'watch-state') {
      return { content: [], structuredContent: await events.wait(key, args.cursor, options.signal) };
    } else if (name === 'read_session_card' && args.action === 'analysis-state') {
      // Reading the local ledger does not acquire execution ownership.
    } else {
      const action = args.action;
      if (name === 'read_session_card' && !['project-git', 'app-update-info'].includes(action)) {
        throw new Error(en ? 'Unknown card read action' : '未知卡片读取操作');
      }
      if (name === 'change_session_card' && !['update', 'analyze', 'locate-source', 'app-update-start'].includes(action)) {
        throw new Error(en ? 'Unknown card update action' : '未知卡片更新操作');
      }
      if (action === 'update' && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0 || !Object.hasOwn(args, 'record'))) {
        throw new Error(en ? 'Please save using the current record revision' : '请使用当前记录版本保存');
      }
      let result;
      try { result = await request({ protocolVersion: PROTOCOL_VERSION, type: action, key, expectedRevision: args.expectedRevision, record: args.record,
        ...(action === 'locate-source' ? { source: { turnId: args.source?.turnId, itemId: args.source?.itemId } } : {}) }, options); }
      catch (error) { result = { error: error.message, errorInfo: errorDetails(error, undefined, lang) }; }
      if (result.error) {
        failure = result.errorInfo;
        if (failure && failure.code !== 'REVISION_CONFLICT') throw Object.assign(new Error(result.error), failure);
        if (action !== 'update' || (store.snapshot().records[key]?.revision ?? 0) === args.expectedRevision) throw new Error(result.error);
        conflict = result.error;
      }
      for (const field of ['projectGit', 'updateInfo', 'navigation', 'session']) if (result[field]) payload[field] = result[field];
    }
    if (name === 'open_session_card' || ['analysis-state', 'update', 'analyze'].includes(args.action)) Object.assign(payload, read(key));
    const replyText = conflict || (opening ? (en ? 'Opened session progress card.' : '已打开会话进度。') : (en ? 'Updated card.' : '已更新卡片。'));
    return { ...(opening ? { _meta: { cardToken: cardToken(conversationId).toString('hex') } } : {}),
      ...(conflict ? { isError: true } : {}), content: [{ type: 'text', text: replyText }], structuredContent: { ...payload, ...(failure ? { errorInfo: failure } : {}) } };
  }
  return { call, stopEvents: () => events.close() };
}

module.exports = { tools, getCardTools, resource, createCodexCard };
