'use strict';
const readline = require('node:readline');
const { errorDetails } = require('./progress-error.cjs');
const { getTools } = require('./progress-tools.cjs');
const { readConfiguredLang } = require('./i18n.cjs');

function serveMcp({ name, callTool, tools, extraTools = [], resource, onClose = () => {}, input = process.stdin, output = process.stdout }) {
  const controllers = new Map();
  const resolveTools = () => {
    const lang = readConfiguredLang();
    const base = typeof tools === 'function' ? tools(lang) : (tools || getTools(lang));
    const extra = typeof extraTools === 'function' ? extraTools(lang) : extraTools;
    return { lang, base, extra, catalog: [...base, ...extra] };
  };
  const send = response => output.write(JSON.stringify({ jsonrpc: '2.0', ...response }) + '\n');
  const fail = (id, code, message) => send({ id, error: { code, message } });
  const rl = readline.createInterface({ input, terminal: false });
  rl.on('line', async line => {
    let msg;
    try { msg = JSON.parse(line); }
    catch { fail(null, -32700, 'Parse error'); return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      fail(null, -32600, 'Invalid Request'); return;
    }
    if (!Object.hasOwn(msg, 'id')) {
      if (msg.method === 'notifications/cancelled') controllers.get(msg.params?.requestId)?.abort();
      return;
    }
    const { id, method, params = {} } = msg;
    if (!(typeof id === 'string' || typeof id === 'number' && Number.isFinite(id)) || !params || typeof params !== 'object' || Array.isArray(params)) {
      fail(null, -32600, 'Invalid Request'); return;
    }
    if (method === 'initialize') {
      const versions = ['2025-06-18', '2025-03-26', '2024-11-05'];
      send({ id, result: { protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: { tools: {}, ...(resource ? { resources: {} } : {}) }, serverInfo: { name, version: require('../package.json').version } } });
    } else if (method === 'ping') send({ id, result: {} });
    else if (method === 'tools/list') send({ id, result: { tools: resolveTools().catalog } });
    else if (resource && method === 'resources/list') send({ id, result: { resources: [resource.descriptor] } });
    else if (resource && method === 'resources/templates/list') send({ id, result: { resourceTemplates: [] } });
    else if (resource && method === 'resources/read') {
      if (params.uri !== resource.descriptor.uri) { fail(id, -32602, 'Unknown resource'); return; }
      try { send({ id, result: { contents: [{ ...resource.descriptor, text: resource.read() }] } }); }
      catch (error) { fail(id, -32603, error.message); }
    }
    else if (method === 'tools/call') {
      const { lang, extra, catalog } = resolveTools();
      if (!catalog.some(tool => tool.name === params.name)) { fail(id, -32601, 'Tool not found'); return; }
      const controller = new AbortController();
      controllers.set(id, controller);
      try {
        const value = await callTool(params.name, params.arguments || {}, params._meta, { signal: controller.signal });
        const result = extra.some(tool => tool.name === params.name) ? value
          : { content: [{ type: 'text', text: value == null ? (lang === 'en' ? 'No progress recorded for this session yet.' : '该会话暂无记录。') : JSON.stringify(value) }] };
        send({ id, result });
      } catch (error) {
        send({ id, result: { isError: true, structuredContent: { errorInfo: errorDetails(error, undefined, lang) }, content: [{ type: 'text', text: error.message }] } });
      } finally { controllers.delete(id); }
    } else fail(id, -32601, 'Method not found');
  });
  rl.once('close', () => {
    for (const controller of controllers.values()) controller.abort();
    Promise.resolve(onClose()).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
  });
  return rl;
}

module.exports = { serveMcp };
