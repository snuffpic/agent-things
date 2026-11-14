'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const http = require('node:http');
const { CodexService } = require('../src/harnesses/codex/codex-service.cjs');

function rendererFixture(source) {
  const window = { ready: false };
  const service = Object.create(CodexService.prototype);
  Object.assign(service, {
    resource: () => ({ version: 'test-version', source }),
    snapshot: () => ({ revision: 0 }), log: () => {}, onError: () => {},
    evaluate: async (_, expression) => ({ result: { value: vm.runInNewContext(expression, { window }) } }),
  });
  return { service, window, session: {} };
}

test('a transient renderer startup failure is retried with the same resource', async () => {
  const { service, window, session } = rendererFixture(`function installCodexSessionStatus(version) {
    if (!window.ready) throw new Error('host DOM not ready');
    window.__codexSessionStatus = { status: () => ({version, revision: 0}), receive() {} };
  }`);
  assert.equal(await service.updateRenderer(session), 'failed');
  window.ready = true;
  assert.equal(await service.updateRenderer(session), 'updated');
  assert.equal(window.__codexSessionStatus.status().version, 'test-version');
});

test('a syntactically invalid renderer is held until its resource changes', async () => {
  const { service, session } = rendererFixture('function {');
  assert.equal(await service.updateRenderer(session), 'failed');
  assert.equal(session.failedVersion, 'test-version');
  service.evaluate = async () => { throw new Error('invalid source should not execute again'); };
  assert.equal(await service.updateRenderer(session), 'failed');
});

test('one restarting window does not prevent another window attaching; later scans recover it', async t => {
  const targets = ['restarting', 'ready'].map(id => ({ id, type: 'page', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:1/'+id }));
  const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(targets)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let recovering = false;
  const errors = [];
  const service = Object.create(CodexService.prototype);
  Object.assign(service, { port: server.address().port, scanning: false, stopped: false, sessions: new Map(),
    onError: error => errors.push(error.message), updateRenderer: async () => 'current',
    attach: async target => {
      if (target.id === 'restarting' && !recovering) throw new Error('window navigating');
      return { close() {} };
    },
  });
  await service.scan();
  assert.equal(service.sessions.has('ready'), true);
  assert.equal(service.sessions.has('restarting'), false);
  assert.deepEqual(errors, ['window navigating']);
  recovering = true;
  await service.scan();
  assert.equal(service.sessions.size, 2);
});
