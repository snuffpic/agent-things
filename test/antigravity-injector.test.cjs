'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { AntigravityInjector } = require('../src/harnesses/antigravity/antigravity-injector.cjs');
test('stopping injector destroys its own renderer before closing CDP and preserves a replacement renderer', async () => {
  for (const version of ['own', 'replacement']) {
    const events = [];
    const injector = new AntigravityInjector({ port: 0, token: 'test' });
    injector.sessions.set('window', { version: 'own', session: {
      evaluate: async code => vm.runInNewContext(code, { window: { __codexSessionStatus: { status: () => ({ version }), destroy: () => events.push('destroy') } } }),
      close: () => events.push('close'),
    } });
    await injector.stop();
    assert.deepEqual(events, version === 'own' ? ['destroy', 'close'] : ['close']);
    assert.equal(injector.sessions.size, 0);
  }
});
