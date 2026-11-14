/**
 * Agent Things UI Sidecar Backend (main.mjs)
 * 1:1 官方 UI 扩展插件守护后端
 */

import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 预填充环境变量防崩溃
process.env.ANTIGRAVITY_LS_ADDRESS = process.env.ANTIGRAVITY_LS_ADDRESS || 'http://127.0.0.1:0';
process.env.ANTIGRAVITY_CSRF_TOKEN = process.env.ANTIGRAVITY_CSRF_TOKEN || 'things-local-token';
process.env.ANTIGRAVITY_SIDECAR_WEB_PORT = process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || '0';

let SidecarApp, Response;
try {
  const sdk = await import('sidecar_sdk');
  SidecarApp = sdk.SidecarApp;
  Response = sdk.Response;
} catch (_) {
  const localSdkPath = join(homedir(), '.gemini/config/node_modules/sidecar_sdk/index.mjs');
  const sdk = await import(pathToFileURL(localSdkPath).href);
  SidecarApp = sdk.SidecarApp;
  Response = sdk.Response;
}

const DEFAULT_STATE_FILE = join(homedir(), '.gemini/antigravity/session-status/manual-state.json');
const CREDENTIAL_FILE = `${DEFAULT_STATE_FILE}.http.json`;
const DEFAULT_SUMMARY_DB = join(homedir(), '.gemini/antigravity/conversation_summaries.db');
const DEFAULT_BRAIN_DIR = join(homedir(), '.gemini/antigravity/brain');
const titleCache = new Map();

function sanitizeConvId(convId) {
  const cleanId = String(convId || '').trim().replace(/^local:/, '');
  if (!cleanId || basename(cleanId) !== cleanId || cleanId === '.' || cleanId === '..') return null;
  return cleanId;
}

function readTitleFromSummaryDb(cleanId, dbPath) {
  if (!dbPath || !existsSync(dbPath)) return null;
  try {
    const escapedId = cleanId.replace(/'/g, "''");
    const sql = `SELECT title, preview FROM conversation_summaries WHERE conversation_id = '${escapedId}' LIMIT 1;`;
    const stdout = execFileSync('sqlite3', ['-json', dbPath, sql], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rows = JSON.parse(stdout || '[]');
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const text = String(rows[0].title || rows[0].preview || '').replace(/\s+/g, ' ').trim();
    return text || null;
  } catch (_) {
    return null;
  }
}

function readTitleFromBrainTranscript(cleanId, brainDir) {
  if (!brainDir) return null;
  const logsDir = join(brainDir, cleanId, '.system_generated', 'logs');
  for (const name of ['transcript.jsonl', 'transcript_full.jsonl']) {
    const filePath = join(logsDir, name);
    if (!existsSync(filePath)) continue;
    try {
      const fd = openSync(filePath, 'r');
      let head = '';
      try {
        const buf = Buffer.allocUnsafe(65536);
        const readBytes = readSync(fd, buf, 0, buf.length, 0);
        head = buf.toString('utf8', 0, readBytes);
      } finally {
        closeSync(fd);
      }
      for (const line of head.split('\n')) {
        if (!line.trim()) continue;
        let step;
        try { step = JSON.parse(line); } catch (_) { continue; }
        if (step?.type !== 'USER_INPUT' || typeof step.content !== 'string') continue;
        const m = step.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
        const cleaned = (m ? m[1] : step.content).replace(/\s+/g, ' ').trim();
        if (!cleaned || /^\s*\/things(?:\s|$)/i.test(cleaned)) continue;
        const chars = Array.from(cleaned);
        return chars.length <= 48 ? cleaned : `${chars.slice(0, 48).join('')}...`;
      }
    } catch (_) {}
  }
  return null;
}

function resolveConversationTitle(convId) {
  const cleanId = sanitizeConvId(convId);
  if (!cleanId) return null;
  const dbPath = process.env.ANTIGRAVITY_SUMMARY_DB || DEFAULT_SUMMARY_DB;
  const brainDir = process.env.ANTIGRAVITY_BRAIN_DIR || DEFAULT_BRAIN_DIR;
  const cacheKey = `${dbPath}\0${brainDir}\0${cleanId}`;
  const now = Date.now();
  const cached = titleCache.get(cacheKey);
  if (cached && now - cached.ts <= 5000) return cached.value;

  const title = readTitleFromSummaryDb(cleanId, dbPath) || readTitleFromBrainTranscript(cleanId, brainDir) || null;
  if (title) {
    if (titleCache.size >= 256) {
      const firstKey = titleCache.keys().next().value;
      if (firstKey !== undefined) titleCache.delete(firstKey);
    }
    titleCache.set(cacheKey, { value: title, ts: now });
  }
  return title;
}

function getCredentials() {
  try {
    if (existsSync(CREDENTIAL_FILE)) {
      return JSON.parse(readFileSync(CREDENTIAL_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('[things_board] Failed to read credentials:', err.message);
  }
  return null;
}

function requestDaemon(path, method = 'GET', body = null, timeoutMs = 2500) {
  const creds = getCredentials();
  if (!creds || !creds.port || !creds.token) {
    return Promise.reject(new Error('守护进程凭据文件未就绪'));
  }

  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: creds.port,
        path: path,
        method: method,
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${creds.token}`,
          ...(postData
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
              }
            : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
              reject(new Error(`响应 JSON 解析失败: ${err.message}`));
            }
          } else {
            let msg = `HTTP ${res.statusCode}`;
            try {
              const errJson = JSON.parse(raw);
              if (errJson.error) msg += `: ${errJson.error}`;
            } catch (_) {
              if (raw) msg += `: ${raw.slice(0, 100)}`;
            }
            reject(new Error(msg));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求守护进程超时'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function readLocalState() {
  try {
    if (existsSync(DEFAULT_STATE_FILE)) {
      return JSON.parse(readFileSync(DEFAULT_STATE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('[things_board] Failed to read local manual-state.json:', err.message);
  }
  return { version: 1, revision: 0, records: {}, analysis: {} };
}

const app = new SidecarApp();

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

// 签发 SSE 票据
app.api(
  '/api/ticket',
  async (params) => {
    const convId = (params?.conversationId || app.config?.conversationId || '').trim();
    const creds = getCredentials();
    if (!creds?.port) {
      return new Response(JSON.stringify({ error: '守护进程未就绪' }), { contentType: 'application/json', status: 500 });
    }
    try {
      const res = await requestDaemon('/session/ticket', 'POST', { conversationId: convId });
      return {
        ok: true,
        ticket: res.ticket,
        origin: `http://127.0.0.1:${creds.port}`,
      };
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { contentType: 'application/json', status: 500 });
    }
  },
  'GET'
);

// 获取指定会话的完整账本进度（包含任务列表与来源引用）
function getSessionFromState(convId) {
  const fullState = readLocalState();
  const rawId = String(convId || '').trim();
  const cleanId = rawId.replace(/^local:/, '');
  const key = Object.keys(fullState.records || {}).find(k => {
    try {
      const [h, id] = JSON.parse(k);
      return h === 'local' && String(id).replace(/^local:/, '') === cleanId;
    } catch (_) { return false; }
  }) || JSON.stringify(['local', cleanId]);

  const record = fullState.records?.[key] || null;
  const analysisObj = fullState.analysis?.[key] || null;
  const ledger = analysisObj?.ledger || null;
  const sources = analysisObj?.sources || {};

  const tasks = (ledger?.tasks || []).map(task => {
    const ref = task.evidenceRefs?.find(r => sources[r]?.turnId);
    return {
      ...task,
      source: ref ? sources[ref] : undefined,
    };
  });

  const progress = typeof record?.progress === 'number'
    ? record.progress
    : (typeof ledger?.percent === 'number' ? ledger.percent : null);
  const state = record?.state || (progress === 100 ? 'completed' : (progress > 0 ? 'unfinished' : 'unstarted'));
  const summary = ledger?.summary || record?.note || '';
  const resolvedTitle = record?.title || resolveConversationTitle(cleanId) || null;

  return (record || analysisObj) ? {
    conversationId: cleanId,
    progress,
    state,
    note: record?.note || summary,
    summary,
    tasks,
    totalTasks: tasks.length,
    completedTasks: tasks.filter(t => t.status === 'done').length,
    revision: record?.revision || fullState.revision || 0,
    updatedAt: record?.updatedAt || Date.now(),
    title: resolvedTitle,
  } : null;
}

// 获取当前会话快照
app.api(
  '/api/session',
  async (params) => {
    const convId = (params?.conversationId || app.config?.conversationId || '').trim();
    if (!convId) {
      return new Response(JSON.stringify({ error: '缺少会话标识' }), { contentType: 'application/json', status: 400 });
    }
    try {
      const session = getSessionFromState(convId);
      const title = session?.title || resolveConversationTitle(convId) || null;
      return {
        ok: true,
        session,
        title,
      };
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { contentType: 'application/json', status: 500 });
    }
  },
  'GET'
);

// 代理交互操作 (analyze, save, update, clear)
app.api(
  '/api/action',
  async (body) => {
    const convId = (body?.conversationId || '').trim();
    const action = body?.action;
    const payload = body?.payload || {};
    const key = JSON.stringify(['local', convId]);

    if (!convId || !action) {
      return new Response(JSON.stringify({ error: '缺少会话标识或操作类型' }), { contentType: 'application/json', status: 400 });
    }

    try {
      if (action === 'analyze') {
        const res = await requestDaemon('/rpc', 'POST', {
          requestId: `tb-act-${Date.now()}`,
          type: 'analyze',
          key,
        });
        return res;
      } else if (action === 'update' || action === 'save') {
        const res = await requestDaemon('/rpc', 'POST', {
          requestId: `tb-act-${Date.now()}`,
          type: 'update',
          key,
          expectedRevision: payload.expectedRevision,
          record: payload.record,
        });
        return res;
      } else if (action === 'clear') {
        const res = await requestDaemon('/rpc', 'POST', {
          requestId: `tb-act-${Date.now()}`,
          type: 'clear',
          key,
          expectedRevision: payload.expectedRevision,
        });
        return res;
      } else {
        return new Response(JSON.stringify({ error: `未知操作: ${action}` }), { contentType: 'application/json', status: 400 });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { contentType: 'application/json', status: 500 });
    }
  },
  'POST'
);

async function triggerHostLocate(convId, source) {
  try {
    const portFile = join(homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort');
    if (!existsSync(portFile)) {
      return { located: false, message: '未检测到 Antigravity DevTools 端口' };
    }
    const port = Number(readFileSync(portFile, 'utf-8').split('\n')[0]);
    if (!port) {
      return { located: false, message: 'Antigravity DevTools 端口无效' };
    }

    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) {
      return { located: false, message: '无法连接 Antigravity 调试接口' };
    }
    const targets = await res.json();
    const pageTargets = targets.filter(
      (t) => t.type === 'page' && typeof t.url === 'string' && t.webSocketDebuggerUrl && !t.url.startsWith('devtools://')
    );
    const mainTarget =
      (convId && pageTargets.find((t) => t.url.includes(convId))) ||
      pageTargets.find((t) => t.url.includes('/c/')) ||
      pageTargets.find((t) => t.url.includes('workbench')) ||
      pageTargets[0];
    if (!mainTarget?.webSocketDebuggerUrl) {
      return { located: false, message: '未找到活动的 Antigravity 会话页面' };
    }

    const code = `(async () => {
      const convId = ${JSON.stringify(convId || '')};
      const source = ${JSON.stringify(source || {})};
      if (window.__sessionStatusHarness && typeof window.__sessionStatusHarness.locate === 'function') {
        const res = await window.__sessionStatusHarness.locate({
          entry: convId ? { threadId: convId } : {},
          source,
          analysisMessage: {},
        });
        if (res && typeof res === 'object') {
          const located = res.located !== undefined ? Boolean(res.located) : Boolean(res.ok);
          return {
            located,
            method: res.method || 'harness',
            conversationId: res.conversationId || convId,
            message: res.message || (located ? '已跳转并定位到会话来源' : '未找到对应会话消息'),
          };
        }
        return { located: Boolean(res), method: 'harness', message: res ? '已跳转并定位到会话来源' : '未找到对应会话消息' };
      }

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const normalize = (value) => String(value || '')
        .replace(/\\\`\\\`\\\`[\\s\\S]*?\\\`\\\`\\\`/g, (m) => m.replace(/\\\`\\\`\\\`[\\w-]*\\n?/g, ''))
        .replace(/\\\`([^\\\`]+)\\\`/g, '$1')
        .replace(/(\\*\\*|__)(.*?)\\1/g, '$2')
        .replace(/\\s+/g, ' ')
        .trim()
        .toLowerCase();

      if (convId && !location.href.includes(convId)) {
        const navLink = document.querySelector(\`a[href*="\${convId}"], [data-conversation-id="\${convId}"]\`);
        if (navLink) {
          navLink.click();
          await sleep(450);
        }
      }

      const turnNum = Number(source?.turnId);
      const turnIdx = Number.isInteger(turnNum) && turnNum > 0 ? turnNum - 1 : null;
      const quote = normalize(source?.locator || '');

      const findEl = () => {
        const main = document.querySelector('main') || document.body;
        if (!main) return null;
        if (quote) {
          const steps = [...main.querySelectorAll('[data-testid="user-input-step"], [data-testid="agent-response"]')];
          const stepHit = steps.find((node) => normalize(node.textContent || '').includes(quote));
          if (stepHit) {
            const inner = [...stepHit.querySelectorAll('p, li, pre, code, blockquote, [data-content-search-unit-key], [data-testid="user-message-bubble"]')];
            return inner.find((n) => normalize(n.textContent || '').includes(quote) && ![...n.children].some((c) => normalize(c.textContent || '').includes(quote))) || stepHit;
          }
          const generic = [...main.querySelectorAll('p, li, pre, [data-step-id], [data-content-search-unit-key]')];
          const genHit = generic.find((n) => normalize(n.textContent || '').includes(quote) && ![...n.children].some((c) => normalize(c.textContent || '').includes(quote)));
          if (genHit) return genHit;
        }
        if (turnIdx !== null) {
          return main.querySelectorAll('[data-testid="user-input-step"]')[turnIdx] || null;
        }
        return null;
      };

      const highlight = (el) => {
        const box = el.querySelector?.('[data-testid="user-message-bubble"]') || el;
        box.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const po = box.style.outline, ps = box.style.boxShadow, pt = box.style.transition;
        box.style.transition = 'all 0.25s ease';
        box.style.outline = '2px solid #0169cc';
        box.style.boxShadow = '0 0 0 4px rgba(1, 105, 204, 0.25), 0 8px 24px rgba(1, 105, 204, 0.35)';
        setTimeout(() => {
          box.style.outline = po;
          box.style.boxShadow = ps;
          box.style.transition = pt;
        }, 3500);
      };

      let target = findEl();
      if (!target && turnIdx !== null) {
        const directTurn = document.querySelector(\`[data-testid="conversation-navigator-turn"][data-turn-index="\${turnIdx}"]\`);
        if (directTurn) {
          directTurn.click();
          await sleep(450);
          target = findEl();
        }
      }
      if (!target) {
        for (let i = 0; i < 20; i++) {
          const olderBtn = [...document.querySelectorAll('button')].find((b) => {
            const label = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '');
            return /Load older messages/i.test(label) && !b.disabled;
          });
          if (!olderBtn) break;
          olderBtn.click();
          await sleep(250);
          target = findEl();
          if (target) break;
        }
      }
      if (!target) {
        return { located: false, method: 'fallback', message: '未在当前或历史消息中找到对应来源' };
      }
      highlight(target);
      return { located: true, method: 'fallback', message: '已跳转并定位到会话来源' };
    })()`;

    const ws = new WebSocket(mainTarget.webSocketDebuggerUrl);
    const result = await new Promise((resolve) => {
      let settled = false;
      const done = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        resolve(payload);
      };
      const timer = setTimeout(() => {
        done({ located: false, message: '定位会话来源超时' });
      }, 15000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression: code, awaitPromise: true, returnByValue: true },
        }));
      });
      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data || ''));
          if (msg.id !== 1) return;
          if (msg.error || msg.result?.exceptionDetails) {
            const detail = msg.error?.message || msg.result?.exceptionDetails?.text || '执行定位脚本失败';
            done({ located: false, message: detail });
            return;
          }
          const val = msg.result?.result?.value;
          if (val && typeof val === 'object') {
            done({
              located: Boolean(val.located),
              method: val.method || 'cdp',
              conversationId: val.conversationId || convId,
              message: val.message || (val.located ? '已跳转并定位到会话来源' : '未找到对应会话消息'),
            });
          } else {
            done({ located: Boolean(val), message: val ? '已跳转并定位到会话来源' : '未找到对应会话消息' });
          }
        } catch (parseErr) {
          done({ located: false, message: parseErr.message || '解析定位响应失败' });
        }
      });
      ws.addEventListener('error', (err) => {
        done({ located: false, message: err?.message || 'CDP WebSocket 连接失败' });
      });
    });
    return result;
  } catch (err) {
    console.warn('[things_board] triggerHostLocate notice:', err.message);
    return { located: false, message: err.message || '定位执行异常' };
  }
}

// 会话内定位跳转
app.api(
  '/api/locate',
  async (body) => {
    const convId = (body?.conversationId || app.config?.conversationId || '').trim();
    const source = body?.source || {};
    const result = await triggerHostLocate(convId, source);
    return {
      ok: true,
      located: Boolean(result?.located),
      success: Boolean(result?.located),
      message: result?.message || (result?.located ? '已跳转并定位到会话来源' : '未找到对应会话消息'),
      method: result?.method || null,
      conversationId: result?.conversationId || convId,
    };
  },
  'POST'
);

app.run().catch((err) => {
  console.error('[things_board] Failed to run sidecar:', err);
});
