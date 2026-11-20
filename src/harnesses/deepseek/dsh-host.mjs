import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function resolveRuntimeRoots() {
  const candidates = [
    {
      cjsRoot: path.resolve(__dirname, '../src'),
      mcpBin: path.resolve(__dirname, '../bin/dsh-mcp.cjs'),
    },
    {
      cjsRoot: path.resolve(__dirname, '../..'),
      mcpBin: path.resolve(__dirname, '../../../bin/dsh-mcp.cjs'),
    },
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate.cjsRoot, 'harnesses/deepseek/dsh-service.cjs'))) {
      return candidate;
    }
  }
  throw new Error('Agent Things DeepSeek runtime modules could not be located');
}

export const name = 'agent-things';
export const inject = ['sessions', 'sessionPersistence', 'connection', 'commands', 'llm'];

export async function apply(ctx, config = {}) {
  const { cjsRoot, mcpBin } = resolveRuntimeRoots();
  const {
    DshService,
    listApiRouteSpecs,
    resolveDefaultDshStateFile,
  } = require(path.join(cjsRoot, 'harnesses/deepseek/dsh-service.cjs'));
  const { readConfiguredLang } = require(path.join(cjsRoot, 'i18n.cjs'));

  const dshHome = ctx.get?.('profileContext')?.homeDir || undefined;
  const stateFile = config?.stateFile || resolveDefaultDshStateFile({ dshHome });
  const resolveLang = () => config?.lang || readConfiguredLang({ dataDir: path.dirname(stateFile) });

  let service = null;
  let startupError = null;
  try {
    service = new DshService({
      ctx,
      stateFile,
      getLang: resolveLang,
    });
    await service.start({ enableBridge: fs.existsSync(mcpBin) });
    ctx.effect(() => () => service.stop(), 'agent-things: service lifecycle');
  } catch (error) {
    startupError = error;
    const message = error?.message || String(error);
    const logger = ctx.get?.('logger');
    if (typeof logger?.error === 'function') {
      logger.error(`agent-things: failed to initialize state store (${stateFile}), entering degraded mode (original file preserved): ${message}`);
    } else {
      console.error(`agent-things: failed to initialize state store (${stateFile}): ${message}`);
    }
    service = {
      stateFile,
      bridgeFile: path.join(path.dirname(stateFile), 'bridge.json'),
      handleSessionEvent: () => {},
      handleCommand: async () => ({
        kind: 'error',
        text: resolveLang() === 'en'
          ? `Agent Things is unavailable because state file could not be loaded (original file preserved): ${message}`
          : `Agent Things 状态文件读取失败，已保留原文件未作修改：${message}`,
      }),
      handleFetch: async () => new Response(JSON.stringify({
        error: message,
        errorInfo: {
          code: error?.code || 'STATE_FILE_ERROR',
          message,
          stateFile,
          recoverable: false,
        },
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
    };
  }

  if (!startupError) {
    ctx.on('session/event', (session, event) => {
      service.handleSessionEvent(session, event);
    });
  }

  const routeDisposers = [];
  for (const spec of listApiRouteSpecs(service)) {
    routeDisposers.push(ctx.connection.fetch.register(spec));
  }
  ctx.effect(() => () => {
    for (const dispose of routeDisposers) {
      try { dispose?.(); } catch { /* ignore */ }
    }
  }, 'agent-things: fetch routes');

  ctx.effect(() => ctx.commands.register({
    name: 'things',
    description: 'View or update Agent Things session progress, notes, and extracted tasks',
    input: { hint: '[analyze | 0-100 | done | clear | note]' },
    handler: invocation => service.handleCommand(invocation.agent.id, invocation.rawInput),
  }), 'agent-things: /things command');

  ctx.inject(['agentDefaultModel'], () => {
    // Kept active so resolveDshModelRoute finds ctx.agentDefaultModel when configured.
  });

  if (!startupError && fs.existsSync(mcpBin) && config?.enableMcp !== false) {
    ctx.inject(['mcpManager'], mcpCtx => {
      try {
        mcpCtx.mcpManager.register('agent_things', {
          transport: 'stdio',
          command: process.execPath,
          args: [mcpBin],
          env: {
            AGENT_THINGS_DSH_STATE: service.stateFile,
            AGENT_THINGS_DSH_BRIDGE: service.bridgeFile,
          },
        });
      } catch (error) {
        ctx.get?.('logger')?.warn?.(`agent-things: skipped auto MCP registration: ${error?.message || error}`);
      }
    });
  }
}
