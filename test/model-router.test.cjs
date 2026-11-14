'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveLatestLuna, resolveLowCostModel } = require('../src/model-router.cjs');

test('resolveLatestLuna dynamically selects highest version number', () => {
  // 1. 空输入处理
  assert.equal(resolveLatestLuna([]), null);
  assert.equal(resolveLatestLuna(null), null);
  assert.equal(resolveLatestLuna([{ slug: 'gpt-4o' }]), null);

  // 2. 5.6 与 6 对比 -> 优选 6
  const models1 = [{ slug: 'gpt-5.6-luna' }, { slug: 'gpt-6-luna' }];
  assert.equal(resolveLatestLuna(models1), 'gpt-6-luna');

  // 3. 未来 6.1 推出 -> 自动优选 6.1
  const models2 = [{ slug: 'gpt-5.6-luna' }, { slug: 'gpt-6-luna' }, { slug: 'gpt-6.1-luna' }];
  assert.equal(resolveLatestLuna(models2), 'gpt-6.1-luna');

  // 4. 未来大版本跃迁 (gpt-7-luna) -> 自动优选 7
  const models3 = [{ slug: 'gpt-6.1-luna' }, { slug: 'gpt-7-luna' }, { slug: 'gpt-6-luna' }];
  assert.equal(resolveLatestLuna(models3), 'gpt-7-luna');
});

test('resolveLowCostModel routes appropriately across hosts', t => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-model-router-test-'));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

  // 1. Codex 默认 fallback
  assert.equal(resolveLowCostModel('codex', { codexHome: tempHome }), 'gpt-6-luna');

  // 2. 写入包含 6.1-luna 的 models_cache.json
  const cacheData = { models: [{ slug: 'gpt-5.6-luna' }, { slug: 'gpt-6.1-luna' }, { slug: 'gpt-6-luna' }] };
  fs.writeFileSync(path.join(tempHome, 'models_cache.json'), JSON.stringify(cacheData));
  assert.equal(resolveLowCostModel('codex', { codexHome: tempHome }), 'gpt-6.1-luna');

  // 3. Claude 宿主 -> claude-3-5-haiku-latest
  assert.equal(resolveLowCostModel('claude'), 'claude-3-5-haiku-latest');

  // 4. Antigravity 宿主 -> gemini-3.8-flash-low
  assert.equal(resolveLowCostModel('antigravity'), 'gemini-3.8-flash-low');

  // 5. 环境变量覆盖
  process.env.SESSION_STATUS_MODEL = 'custom-budget-model';
  try {
    assert.equal(resolveLowCostModel('codex'), 'custom-budget-model');
  } finally {
    delete process.env.SESSION_STATUS_MODEL;
  }
});
