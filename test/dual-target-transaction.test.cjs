'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  installRuntime,
  recoverPendingTransaction,
  commitInstallation,
  getTransactionFile,
} = require('../src/runtime-install.cjs');

test('双目标可恢复安装事务：按需部署、中断自愈、首次安装清理与保护未知插件', async (t) => {
  const root = path.resolve(__dirname, '..');
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-tx-test-'));
  const dataDir = path.join(tempHome, 'data');
  const runtime = path.join(dataDir, 'runtime');
  const agyPluginDir = path.join(tempHome, '.gemini/config/plugins/things');

  t.after(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  // 1. 仅勾选 Codex 时，绝不触碰 Antigravity 插件目录
  installRuntime(root, runtime, {
    enabledApps: ['codex'],
    dataDir,
    homeDirectory: tempHome,
  });
  commitInstallation(dataDir, [runtime, agyPluginDir]);
  assert.ok(fs.existsSync(runtime), 'runtime 必须已部署');
  assert.equal(fs.existsSync(agyPluginDir), false, '仅勾选 codex 时绝不能部署 antigravity 插件');
  assert.equal(fs.existsSync(getTransactionFile(dataDir)), false, '成功提交后事务日志必须被清除');

  // 2. 勾选 Antigravity 时，双目标同时成功部署
  installRuntime(root, runtime, {
    enabledApps: ['codex', 'antigravity'],
    dataDir,
    homeDirectory: tempHome,
  });
  commitInstallation(dataDir, [runtime, agyPluginDir]);
  assert.ok(fs.existsSync(runtime));
  assert.ok(fs.existsSync(agyPluginDir), '勾选 antigravity 时插件必须已部署');
  assert.ok(fs.existsSync(path.join(agyPluginDir, 'plugin.json')), '插件目录必须包含 plugin.json');
  assert.ok(fs.existsSync(path.join(agyPluginDir, 'sidecars/things_board/index.html')), '插件目录必须包含前端看板页面');

  // 3. 模拟中断恢复（Crash Recovery）：若进程在 swapped 阶段断电，下次启动必须自动自愈回滚
  const marker = path.join(runtime, 'version-marker.txt');
  fs.writeFileSync(marker, 'stable-v1', 'utf8');

  // 制造一个模拟在 swapped 状态的未完成事务
  const pid = process.pid;
  const fakeTx = {
    version: 1,
    pid,
    createdAt: new Date().toISOString(),
    stage: 'swapped',
    targets: [
      {
        name: 'runtime',
        target: runtime,
        stagePath: `${runtime}.stage.${pid}`,
        backupPath: `${runtime}.previous`,
        existed: true,
        swapped: true,
      },
    ],
  };
  // 模拟原子替换完成但未 committed：将原带 marker 的 runtime 移到 .previous，放一个新目录
  fs.renameSync(runtime, `${runtime}.previous`);
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'new-incomplete-file.txt'), 'corrupt');
  fs.writeFileSync(getTransactionFile(dataDir), JSON.stringify(fakeTx, null, 2) + '\n');

  // 此时下次运行 recoverPendingTransaction
  const recoveryResult = recoverPendingTransaction(dataDir);
  assert.equal(recoveryResult.status, 'rolled_back');
  assert.ok(fs.existsSync(runtime));
  assert.equal(fs.readFileSync(marker, 'utf8'), 'stable-v1', '崩溃未完成事务必须恢复原 runtime 内容');
  assert.equal(fs.existsSync(path.join(runtime, 'new-incomplete-file.txt')), false, '新未完成文件必须被清理');
  assert.equal(fs.existsSync(getTransactionFile(dataDir)), false, '自愈后事务文件必须清除');

  // 4. 首次安装失败场景：原本不存在的目标，回滚后恢复至“原本不存在”的状态
  const firstInstallTarget = path.join(dataDir, 'first-install-target');
  const fakeFirstTx = {
    version: 1,
    pid,
    createdAt: new Date().toISOString(),
    stage: 'swapped',
    targets: [
      {
        name: 'first_target',
        target: firstInstallTarget,
        stagePath: `${firstInstallTarget}.stage.${pid}`,
        backupPath: `${firstInstallTarget}.previous`,
        existed: false, // 首次安装，原本不存在
        swapped: true,
      },
    ],
  };
  fs.mkdirSync(firstInstallTarget, { recursive: true });
  fs.writeFileSync(path.join(firstInstallTarget, 'partial.txt'), 'incomplete');
  fs.writeFileSync(getTransactionFile(dataDir), JSON.stringify(fakeFirstTx, null, 2) + '\n');

  recoverPendingTransaction(dataDir);
  assert.equal(fs.existsSync(firstInstallTarget), false, '首次安装失败回滚必须恢复至原本不存在状态');

  // 5. 归属校验：若已有 things 目录属于未知自定义插件，拒绝覆盖以保护用户数据
  const unknownPluginJson = path.join(agyPluginDir, 'plugin.json');
  fs.writeFileSync(unknownPluginJson, JSON.stringify({ name: 'custom-user-plugin-do-not-overwrite' }) + '\n');

  assert.throws(() => {
    installRuntime(root, runtime, {
      enabledApps: ['codex', 'antigravity'],
      dataDir,
      homeDirectory: tempHome,
    });
  }, /属于其他插件/);
  assert.equal(JSON.parse(fs.readFileSync(unknownPluginJson, 'utf8')).name, 'custom-user-plugin-do-not-overwrite', '未知插件内容必须被完整保护');
});
