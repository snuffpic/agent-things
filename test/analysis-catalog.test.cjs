'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareModelCatalog } = require('../src/analysis-runner.cjs');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'status-catalog-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, 'output'); fs.mkdirSync(directory);
  const auth = path.join(home, 'auth.json'), cache = path.join(home, 'models_cache.json');
  fs.writeFileSync(auth, 'intentionally-unreadable-as-json');
  fs.utimesSync(auth, new Date(0), new Date(0));
  const catalog = { fetched_at: '2026-01-01T00:00:00Z', client_version: '0.166.0', identity: 'cache-owner-metadata',
    models: [{ slug: 'gpt-6-luna', base_instructions: 'model instructions' }, { slug: 'another-model' }] };
  fs.writeFileSync(cache, JSON.stringify(catalog));
  const events = [];
  return { home, directory, auth, cache, catalog, events, binary: 'fake-codex',
    readVersion: () => 'codex-cli 0.166.0-alpha.5.1', log: (event, fields) => events.push({ event, ...fields }) };
}

test('catalog snapshot limits analysis tools while preserving model metadata and source files', t => {
  const options = fixture(t), before = fs.readFileSync(options.cache);
  const file = prepareModelCatalog(options);
  const models = JSON.parse(fs.readFileSync(file)).models;
  assert.deepEqual(models, [{ ...options.catalog.models[0], tool_mode: 'direct', apply_patch_tool_type: null, experimental_supported_tools: [] }, options.catalog.models[1]]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readFileSync(options.cache), before);
  assert.equal(fs.readFileSync(options.auth, 'utf8'), 'intentionally-unreadable-as-json');
  assert.equal(options.events[0].event, 'catalog.ready');
  assert.ok(options.events[0].cacheAgeMs > 300000);
  assert.equal(JSON.stringify(options.events).includes('cache-owner-metadata'), false);
});

test('unusable catalogs select the normal CLI path', async t => {
  const cases = [
    ['version_mismatch', o => { o.readVersion = () => 'codex-cli 0.167.0'; }],
    ['account_changed', o => fs.utimesSync(o.auth, new Date(Date.now() + 10000), new Date(Date.now() + 10000))],
    ['model_missing', o => { o.catalog.models = [{ slug: 'other' }]; fs.writeFileSync(o.cache, JSON.stringify(o.catalog)); }],
    ['invalid_cache', o => { o.catalog.models = [{}]; fs.writeFileSync(o.cache, JSON.stringify(o.catalog)); }],
    ['invalid_cache', o => { o.catalog.fetched_at = 'invalid'; fs.writeFileSync(o.cache, JSON.stringify(o.catalog)); }],
    ['unavailable', o => fs.rmSync(o.cache)],
    ['unavailable', o => fs.writeFileSync(o.cache, '{')],
    ['unavailable', o => fs.rmSync(o.auth)],
    ['unavailable', o => { o.readVersion = () => { throw new Error('version failure'); }; }],
  ];
  for (const [reason, modify] of cases) await t.test(reason, t => {
    const options = fixture(t); modify(options);
    assert.equal(prepareModelCatalog(options), null);
    assert.equal(options.events.at(-1).reason, reason);
    assert.equal(fs.existsSync(path.join(options.directory, 'model-catalog.json')), false);
  });
});

test('prepareModelCatalog dynamically picks newer luna version (e.g. gpt-6.1-luna)', t => {
  const options = fixture(t);
  options.catalog.models = [
    { slug: 'gpt-5.6-luna', base_instructions: 'old luna' },
    { slug: 'gpt-6.1-luna', base_instructions: 'newest luna' },
    { slug: 'gpt-6-luna', base_instructions: 'current luna' }
  ];
  fs.writeFileSync(options.cache, JSON.stringify(options.catalog));
  const file = prepareModelCatalog(options);
  assert.ok(file);
  const models = JSON.parse(fs.readFileSync(file)).models;
  const directModel = models.find(m => m.tool_mode === 'direct');
  assert.equal(directModel.slug, 'gpt-6.1-luna');
  assert.equal(options.events[0].model, 'gpt-6.1-luna');
});
