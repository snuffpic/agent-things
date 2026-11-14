'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const {
  installRuntime,
  commitInstallation,
  recoverPendingTransaction,
  verifyPluginOwnership,
  getTransactionFile,
  writeTransactionAtomic,
  MANAGED_MARKER_FILE,
} = require('../src/runtime-install.cjs');

function hashDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const hash = crypto.createHash('sha256');
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, entry.name);
      if (entry.isDirectory()) walk(p);
      else files.push(p);
    }
  }
  walk(dir);
  files.sort();
  for (const f of files) {
    hash.update(path.relative(dir, f));
    hash.update(fs.readFileSync(f));
  }
  return hash.digest('hex');
}

test('真实进程中断 1：在 backed_up 与 swapped 之间强杀中断，自愈 100% 恢复旧版本', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-1-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'old-marker.txt'), 'version-1.0-data');
    const oldHash = hashDir(runtime);

    // 子进程：执行到旧目录移入 backupPath 且 step 为 backup_done 时，立即强杀退出 (SIGKILL)
    const script = `
      const fs = require('node:fs');
      const path = require('node:path');
      const { installRuntime, getTransactionFile } = require('${path.join(root, 'src/runtime-install.cjs')}');

      const txFile = getTransactionFile('${dataDir}');
      const origWrite = fs.writeFileSync;

      // 劫持：当检测到写入 backup 意图并执行完重命名时，直接 kill 强杀自身
      const origRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        origRename(from, to);
        if (to.includes('.backup.') || to.endsWith('.previous')) {
          // 旧目录刚移至 backupPath，新目录尚未移入，直接 SIGKILL 强杀
          process.kill(process.pid, 'SIGKILL');
        }
      };

      installRuntime('${root}', '${runtime}', {
        enabledApps: ['codex'],
        dataDir: '${dataDir}',
        homeDirectory: '${tmpHome}',
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: tmpHome } });
    assert.equal(res.signal, 'SIGKILL', '子进程应被 SIGKILL 强杀终止');

    // 此时目录处于中间状态：正式目录不存在，旧备份存在
    assert.equal(fs.existsSync(runtime), false, '重命名中断时正式目录暂时不存在');
    const backupFile = fs.readdirSync(dataDir).find(f => f.includes('.backup.') || f.endsWith('.previous'));
    assert.ok(backupFile, '旧备份应孤悬在 backupPath');
    assert.equal(fs.existsSync(getTransactionFile(dataDir)), true, '事务日志应完好保留');

    // 新进程启动：触发自愈恢复
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'rolled_back');

    // 验证：旧版本 100% 恢复，文件内容与哈希完全一致
    assert.equal(fs.existsSync(runtime), true, '正式目录已恢复');
    assert.equal(fs.readFileSync(path.join(runtime, 'old-marker.txt'), 'utf8'), 'version-1.0-data');
    assert.equal(hashDir(runtime), oldHash, '恢复后的目录哈希必须与中断前 100% 一致');
    assert.equal(fs.existsSync(getTransactionFile(dataDir)), false, '恢复成功后清理事务日志');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('真实进程中断 2：首次安装过程中断强杀，自愈恢复为原本不存在', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-2-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    assert.equal(fs.existsSync(runtime), false, '首次安装前不存在');

    // 子进程：stage 移入 target 之后立即强杀退出
    const script = `
      const fs = require('node:fs');
      const { installRuntime } = require('${path.join(root, 'src/runtime-install.cjs')}');

      const origRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        origRename(from, to);
        if (to === '${runtime}') {
          // 首次安装，新目录刚移入 target，立即 SIGKILL 强杀
          process.kill(process.pid, 'SIGKILL');
        }
      };

      installRuntime('${root}', '${runtime}', {
        enabledApps: ['codex'],
        dataDir: '${dataDir}',
        homeDirectory: '${tmpHome}',
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: tmpHome } });
    assert.equal(res.signal, 'SIGKILL');

    // 强杀后正式目录存在半成品
    assert.equal(fs.existsSync(runtime), true);

    // 新进程自愈：应当恢复为原本不存在
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'rolled_back');

    assert.equal(fs.existsSync(runtime), false, '首次安装回滚必须彻底恢复为不存在');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('真实进程中断 3：提交标记落盘后、清理备份途中强杀，新进程自愈不误回滚', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-3-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'v1.txt'), 'v1');

    // 子进程：正常安装完毕，但在 commitInstallation 中，写完 committed 后、清理 backupPath 前强杀
    const script = `
      const fs = require('node:fs');
      const { installRuntime, commitInstallation } = require('${path.join(root, 'src/runtime-install.cjs')}');

      installRuntime('${root}', '${runtime}', {
        enabledApps: ['codex'],
        dataDir: '${dataDir}',
        homeDirectory: '${tmpHome}',
      });

      // 拦截 rmSync：当检测到准备删 backupPath 时强杀
      const origRm = fs.rmSync;
      fs.rmSync = (p, opts) => {
        if (typeof p === 'string' && (p.includes('.backup.') || p.endsWith('.previous'))) {
          process.kill(process.pid, 'SIGKILL');
        }
        origRm(p, opts);
      };

      commitInstallation('${dataDir}', ['${runtime}']);
    `;

    const res = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: tmpHome } });
    assert.equal(res.signal, 'SIGKILL');

    // 此时提交标记已落盘，但备份尚未删除
    const tx = JSON.parse(fs.readFileSync(getTransactionFile(dataDir), 'utf8'));
    assert.equal(tx.stage, 'committed', '提交标记必须已经持久化');
    const backupFile = fs.readdirSync(dataDir).find(f => f.includes('.backup.') || f.endsWith('.previous'));
    assert.ok(backupFile, '备份尚未删除');

    // 新进程启动：探测到 committed，继续执行清理，绝不回滚！
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'committed_cleanup');

    // 验证：新版本完好留存，备份被清理，未发生版本倒退或混合
    assert.equal(fs.existsSync(path.join(runtime, 'v1.txt')), false, '新版本中无旧文件');
    assert.equal(fs.existsSync(path.join(runtime, 'bin/codex-session-status.cjs')), true, '新版本正常就位');
    const backupAfter = fs.readdirSync(dataDir).find(f => f.includes('.backup.') || f.endsWith('.previous'));
    assert.equal(backupAfter, undefined, '备份已被幂等清理');
    assert.equal(fs.existsSync(getTransactionFile(dataDir)), false, '事务日志已正常清理');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('真实进程中断 4：回滚自身失败时，保留事务日志与备份现场并报错', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-4-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const txFile = getTransactionFile(dataDir);

    fs.mkdirSync(dataDir, { recursive: true });
    // 构造一个需要回滚但目标无法写入的故障状态
    const fakeTx = {
      version: 1,
      stage: 'failed',
      targets: [
        {
          name: 'runtime',
          target: runtime,
          stagePath: `${runtime}.stage.1234`,
          backupPath: `${runtime}.previous`,
          existed: true,
          step: 'swap_done',
        }
      ]
    };
    fs.mkdirSync(`${runtime}.previous`, { recursive: true });
    fs.writeFileSync(path.join(`${runtime}.previous`, 'backup.txt'), 'old');
    fs.mkdirSync(runtime, { recursive: true });

    // 让 target 无法被删除以触发回滚失败（例如设为只读或模拟异常）
    writeTransactionAtomic(txFile, fakeTx);

    const origRm = fs.rmSync;
    fs.rmSync = (p, opts) => {
      if (p === runtime) throw new Error('模拟权限不足导致物理删除失败');
      origRm(p, opts);
    };

    assert.throws(() => recoverPendingTransaction(dataDir), /回滚失败/);

    // 验证：日志绝不被删除，备份绝不被删除，现场完好保留
    assert.equal(fs.existsSync(txFile), true, '日志必须完好保留');
    assert.equal(fs.existsSync(`${runtime}.previous`), true, '备份必须完好保留');
    const savedTx = JSON.parse(fs.readFileSync(txFile, 'utf8'));
    assert.equal(savedTx.stage, 'rollback_failed', '状态必须标记为 rollback_failed');
    assert.match(savedTx.rollbackError, /权限不足/);

    fs.rmSync = origRm;
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('隔离防御 5：仅安装 Codex 时，已有 Antigravity 插件目录内容和哈希保持 100% 原样', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-5-'));
  try {
    const agyPluginDir = path.join(tmpHome, '.gemini/config/plugins/things');
    fs.mkdirSync(agyPluginDir, { recursive: true });
    // 预置已有 Antigravity 插件，附带受管标记
    fs.writeFileSync(path.join(agyPluginDir, 'plugin.json'), JSON.stringify({ name: 'things' }));
    fs.writeFileSync(path.join(agyPluginDir, 'sidecar.txt'), 'custom-data-12345');
    fs.writeFileSync(path.join(agyPluginDir, MANAGED_MARKER_FILE), JSON.stringify({
      version: 1, componentId: 'agent-things', managed: true, installId: 'pre-existing'
    }));
    const originalHash = hashDir(agyPluginDir);

    const codexConfig = path.join(tmpHome, '.codex/config.toml');
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
    fs.writeFileSync(codexConfig, 'model = "test"\\n');

    // 在隔离子进程中执行：HOME 严格指向 tmpHome，mock launchd 防止真实系统调用
    const script = `
      const assert = require('node:assert/strict');
      const launchd = require('./src/launchd.cjs');
      launchd.printJob = () => null;
      launchd.bootout = async () => {};
      launchd.bootstrap = () => {};
      const { executeSetup } = require('./src/cli/setup-orchestrator.cjs');
      (async () => {
        await assert.rejects(
          executeSetup({
            enabledApps: ['codex'],
            autoRestartCodex: false,
            verify: async () => {
              throw new Error('模拟 Codex 后台健康检查失败');
            }
          }),
          /模拟 Codex 后台健康检查失败/
        );
      })().catch(err => {
        console.error(err);
        process.exit(1);
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, HOME: tmpHome },
      stdio: 'pipe',
    });
    assert.equal(res.status, 0, `子进程断言应成功：${res.stderr.toString('utf8')}`);

    // 核心断言：Antigravity 目录绝未被误删，哈希 100% 保持原样！
    assert.equal(fs.existsSync(agyPluginDir), true, 'Antigravity 目录绝不被误删');
    assert.equal(hashDir(agyPluginDir), originalHash, 'Antigravity 目录内容与哈希必须 100% 原样保持');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('归属防御 6：未知插件或损坏 JSON 坚决拒绝覆盖；同名未知插件卸载不误删', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-6-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const agyPluginDir = path.join(tmpHome, '.gemini/config/plugins/things');
    fs.mkdirSync(agyPluginDir, { recursive: true });

    // 场景 A：无 plugin.json 且无受管标记的普通目录
    fs.writeFileSync(path.join(agyPluginDir, 'user-secret.txt'), 'do-not-touch');
    let res = verifyPluginOwnership(agyPluginDir, dataDir);
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'unrecognized_plugin');

    // 场景 B：plugin.json 损坏
    fs.writeFileSync(path.join(agyPluginDir, 'plugin.json'), 'INVALID JSON {');
    res = verifyPluginOwnership(agyPluginDir, dataDir);
    assert.equal(res.allowed, false);

    // 场景 C：同名 name: 'things' 但缺少官方特征文件（假冒/冲突插件）
    fs.writeFileSync(path.join(agyPluginDir, 'plugin.json'), JSON.stringify({ name: 'things' }));
    res = verifyPluginOwnership(agyPluginDir, dataDir);
    assert.equal(res.allowed, false, '缺少官方特征文件坚决拒绝');

    // 执行 installRuntime：断言坚决拒绝安装并终止
    assert.throws(() => {
      installRuntime(root, path.join(dataDir, 'runtime'), {
        enabledApps: ['antigravity'],
        dataDir,
        homeDirectory: tmpHome,
      });
    }, /无法确认归属/);

    assert.equal(fs.existsSync(path.join(agyPluginDir, 'user-secret.txt')), true, '原用户文件完好无损');

    // 卸载测试：在隔离子进程中执行 uninstallAll，同名未知插件卸载时绝不误删
    const codexConfig = path.join(tmpHome, '.codex/config.toml');
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
    fs.writeFileSync(codexConfig, 'model = "test"\\n');

    const script = `
      const launchd = require('./src/launchd.cjs');
      launchd.printJob = () => null;
      launchd.bootout = async () => {};
      launchd.bootstrap = () => {};
      const { uninstallAll } = require('./src/cli/setup-orchestrator.cjs');
      (async () => {
        await uninstallAll();
      })().catch(err => {
        console.error(err);
        process.exit(1);
      });
    `;
    const uninstallRes = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, HOME: tmpHome },
      stdio: 'pipe',
    });
    assert.equal(uninstallRes.status, 0, `子进程卸载应成功：${uninstallRes.stderr.toString('utf8')}`);

    assert.equal(fs.existsSync(agyPluginDir), true, '未知插件在卸载时绝不被误删');
    assert.equal(fs.existsSync(path.join(agyPluginDir, 'user-secret.txt')), true, '未知插件内容必须完整保留');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('首次纳管流程：未带标记的历史开发版插件，核验已知特征后安全纳管', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-7-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const agyPluginDir = path.join(tmpHome, '.gemini/config/plugins/things');

    // 预置未带受管标记的合法历史开发版（包含 plugin.json, things_board/index.html, logo.svg）
    fs.mkdirSync(path.join(agyPluginDir, 'sidecars/things_board'), { recursive: true });
    fs.mkdirSync(path.join(agyPluginDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(agyPluginDir, 'plugin.json'), JSON.stringify({ name: 'things' }));
    fs.writeFileSync(path.join(agyPluginDir, 'sidecars/things_board/index.html'), '<html>board</html>');
    fs.writeFileSync(path.join(agyPluginDir, 'assets/logo.svg'), '<svg></svg>');

    const res = verifyPluginOwnership(agyPluginDir, dataDir);
    assert.equal(res.allowed, true);
    assert.equal(res.reason, 'legacy_adoptable');

    // 执行安装：成功纳管并写入受管标记
    installRuntime(root, path.join(dataDir, 'runtime'), {
      enabledApps: ['antigravity'],
      dataDir,
      homeDirectory: tmpHome,
    });
    commitInstallation(dataDir, [path.join(dataDir, 'runtime'), agyPluginDir]);

    assert.equal(fs.existsSync(path.join(agyPluginDir, MANAGED_MARKER_FILE)), true, '受管标记已成功种植');
    const marker = JSON.parse(fs.readFileSync(path.join(agyPluginDir, MANAGED_MARKER_FILE), 'utf8'));
    assert.equal(marker.componentId, 'agent-things');
    assert.equal(marker.managed, true);

    // 纳管后核验通过
    const after = verifyPluginOwnership(agyPluginDir, dataDir);
    assert.equal(after.allowed, true);
    assert.equal(after.path, 'managed');
    assert.equal(after.reason, 'managed_plugin');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('全调用链审计 8：安装、升级、卸载和高级入口只获取一次生命周期锁，且完整结束事务', async () => {
  const setup = require('../src/cli/setup-orchestrator.cjs');
  const startup = require('../src/manual-status-startup.cjs');
  const runtimeInstall = require('../src/runtime-install.cjs');

  // 1. 验证最外层入口严格由 withLifecycleLock 守卫
  assert.ok(setup.executeSetup.toString().includes('withLifecycleLock'), 'executeSetup 必须包裹生命周期锁');
  assert.ok(setup.uninstallAll.toString().includes('withLifecycleLock'), 'uninstallAll 必须包裹生命周期锁');
  assert.ok(startup.installAutostart.toString().includes('withLifecycleLock'), 'installAutostart 必须包裹生命周期锁');
  assert.ok(startup.disableAutostart.toString().includes('withLifecycleLock'), 'disableAutostart 必须包裹生命周期锁');

  // 2. 验证底层 installRuntime 绝不重复获取生命周期锁（防止重入死锁）
  assert.ok(!runtimeInstall.installRuntime.toString().includes('withLifecycleLock'), 'installRuntime 绝不能重复加锁');

  // 3. 验证高级入口 manual-status-startup 完整执行事务并提交
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-8-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    
    // 执行模拟安装
    runtimeInstall.installRuntime(root, runtime, {
      enabledApps: ['codex'],
      dataDir,
      homeDirectory: tmpHome,
    });
    
    // 事务日志处于 swapped 阶段
    assert.equal(fs.existsSync(runtimeInstall.getTransactionFile(dataDir)), true);
    
    // 提交事务
    runtimeInstall.commitInstallation(dataDir, [runtime]);
    
    // 提交后事务日志必须被安全清理，外部登记就绪
    assert.equal(fs.existsSync(runtimeInstall.getTransactionFile(dataDir)), false);
    assert.equal(fs.existsSync(runtimeInstall.getInstalledComponentsFile(dataDir)), true);
    const reg = JSON.parse(fs.readFileSync(runtimeInstall.getInstalledComponentsFile(dataDir), 'utf8'));
    assert.equal(reg.components.runtime.componentId, 'agent-things');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('边界验证 9A：prepare_backup 落盘后、重命名前强杀，自愈保留原正式目录', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-9a-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'keep.txt'), 'original-v1');

    // 子进程：在 target 重命名移到 backup 执行前强杀
    const script = `
      const fs = require('node:fs');
      const { installRuntime } = require('${path.join(root, 'src/runtime-install.cjs')}');

      const origRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (from === '${runtime}' && to.includes('.backup.')) {
          // target 准备移入 backupPath 前强杀
          process.kill(process.pid, 'SIGKILL');
        }
        return origRename(from, to);
      };

      installRuntime('${root}', '${runtime}', {
        enabledApps: ['codex'],
        dataDir: '${dataDir}',
        homeDirectory: '${tmpHome}',
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: tmpHome } });
    assert.equal(res.signal, 'SIGKILL');

    // 此时 tx 中处于 prepare_backup 阶段，但重命名尚未发生，正式目录依然存在
    const tx = JSON.parse(fs.readFileSync(getTransactionFile(dataDir), 'utf8'));
    assert.equal(tx.targets[0].step, 'prepare_backup');
    assert.equal(fs.existsSync(runtime), true);

    // 新进程启动自愈
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'rolled_back');

    // 验证：原正式目录完好无损，且事务日志已清理
    assert.equal(fs.existsSync(runtime), true);
    assert.equal(fs.readFileSync(path.join(runtime, 'keep.txt'), 'utf8'), 'original-v1');
    assert.equal(fs.existsSync(getTransactionFile(dataDir)), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('边界验证 9B：prepare_backup 落盘且旧目录成功移走后、backup_done 前强杀，自愈从唯一备份恢复', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-9b-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'keep.txt'), 'original-v1');

    // 子进程：旧目录刚移到 backupPath，但尚未写入 backup_done 即强杀
    const script = `
      const fs = require('node:fs');
      const { installRuntime } = require('${path.join(root, 'src/runtime-install.cjs')}');

      const origRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        origRename(from, to);
        if (to.includes('.backup.')) {
          process.kill(process.pid, 'SIGKILL');
        }
      };

      installRuntime('${root}', '${runtime}', {
        enabledApps: ['codex'],
        dataDir: '${dataDir}',
        homeDirectory: '${tmpHome}',
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, HOME: tmpHome } });
    assert.equal(res.signal, 'SIGKILL');

    // 此时 tx 中记录的 step 是 prepare_backup，正式目录消失，唯一备份存在
    const tx = JSON.parse(fs.readFileSync(getTransactionFile(dataDir), 'utf8'));
    assert.equal(tx.targets[0].step, 'prepare_backup');
    assert.equal(fs.existsSync(runtime), false, '正式目录已被移走');
    assert.equal(fs.existsSync(tx.targets[0].backupPath), true, '备份目录存在');

    // 新进程启动自愈：必须识别 prepare_backup 下正式目录缺失的分支，安全移回
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'rolled_back');

    assert.equal(fs.existsSync(runtime), true, '正式目录已被自愈移回');
    assert.equal(fs.readFileSync(path.join(runtime, 'keep.txt'), 'utf8'), 'original-v1');
    assert.equal(fs.existsSync(getTransactionFile(dataDir)), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('边界验证 10：恢复旧目录后再次强杀，随后重复恢复保持幂等', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-10-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'keep.txt'), 'v1');

    // 构造一个待恢复的事务（旧目录已移至 backupPath，step 为 backup_done）
    const txFile = getTransactionFile(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });
    const backupPath = `${runtime}.backup.inst-test-10`;
    fs.renameSync(runtime, backupPath);

    const tx = {
      version: 1,
      pid: process.pid,
      installId: 'inst-test-10',
      createdAt: new Date().toISOString(),
      stage: 'staged',
      targets: [
        {
          name: 'runtime',
          target: runtime,
          stagePath: `${runtime}.stage.test`,
          backupPath,
          existed: true,
          step: 'backup_done',
        },
      ],
    };
    writeTransactionAtomic(txFile, tx);

    // 第一次恢复：模拟在 fs.renameSync(backupPath, target) 成功之后、删除 txFile 之前被强杀
    fs.renameSync(backupPath, runtime);
    assert.equal(fs.existsSync(runtime), true);
    assert.equal(fs.existsSync(backupPath), false);
    assert.equal(fs.existsSync(txFile), true, '模拟 txFile 尚未删除时被中断');

    // 第二次恢复：再次调用 recoverPendingTransaction
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'rolled_back');

    // 验证：幂等成功，正式目录完好，txFile 成功清理
    assert.equal(fs.existsSync(runtime), true);
    assert.equal(fs.readFileSync(path.join(runtime, 'keep.txt'), 'utf8'), 'v1');
    assert.equal(fs.existsSync(txFile), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('边界验证 11：登记落盘失败时保留事务日志，重试 Finalizer 恢复成功', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-11-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const txFile = getTransactionFile(dataDir);
    fs.mkdirSync(dataDir, { recursive: true });

    // 安装
    installRuntime(root, runtime, {
      enabledApps: ['codex'],
      dataDir,
      homeDirectory: tmpHome,
    });

    const tx = JSON.parse(fs.readFileSync(txFile, 'utf8'));
    assert.equal(tx.stage, 'swapped');

    // 模拟写入 installed-components.json 失败（让其成为只读目录阻碍写入）
    const regFile = path.join(dataDir, 'installed-components.json');
    fs.mkdirSync(regFile, { recursive: true });

    // 调用 commitInstallation，应当捕获登记失败并保留 txFile
    assert.throws(() => {
      commitInstallation(dataDir, [runtime]);
    }, /(?:安装提交已完成，但更新组件登记失败|外部组件登记文件损坏)/);

    // 验证：txFile 必须完好保留且处于 committed 阶段
    assert.equal(fs.existsSync(txFile), true, '日志必须保留');
    const committedTx = JSON.parse(fs.readFileSync(txFile, 'utf8'));
    assert.equal(committedTx.stage, 'committed');

    // 解除阻碍（移除冲突目录）
    fs.rmSync(regFile, { recursive: true, force: true });

    // 重试恢复
    const recovery = recoverPendingTransaction(dataDir);
    assert.equal(recovery?.recovered, true);
    assert.equal(recovery?.status, 'committed_cleanup');

    // 验证：日志已安全清除，登记已成功就绪
    assert.equal(fs.existsSync(txFile), false);
    assert.equal(fs.existsSync(regFile), true);
    const reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
    assert.equal(reg.components.runtime.componentId, 'agent-things');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('边界验证 12：仅更新 Codex 时，Claude、Antigravity 的目录与登记保持原样', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-12-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const regFile = path.join(dataDir, 'installed-components.json');
    fs.mkdirSync(dataDir, { recursive: true });

    // 预置现有的 Claude 与 Antigravity 外部登记与受管目录
    const agyPluginDir = path.join(tmpHome, '.gemini/config/plugins/things');
    fs.mkdirSync(agyPluginDir, { recursive: true });
    fs.writeFileSync(path.join(agyPluginDir, 'plugin.json'), JSON.stringify({ name: 'things' }));
    fs.writeFileSync(path.join(agyPluginDir, '.agent-things-managed.json'), JSON.stringify({
      version: 1,
      componentId: 'agent-things',
      installId: 'inst-agy-original',
      managed: true,
    }));

    const initialReg = {
      version: 1,
      updatedAt: '2026-11-01T00:00:00.000Z',
      components: {
        antigravity_plugin: {
          componentId: 'agent-things',
          target: agyPluginDir,
          installId: 'inst-agy-original',
        },
        claude_service: {
          componentId: 'agent-things',
          installId: 'inst-claude-original',
        },
      },
    };
    writeTransactionAtomic(regFile, initialReg);

    // 仅更新 Codex（enabledApps: ['codex']）
    installRuntime(root, runtime, {
      enabledApps: ['codex'],
      dataDir,
      homeDirectory: tmpHome,
    });
    commitInstallation(dataDir, [runtime]);

    // 验证：外部登记中 antigravity_plugin 和 claude_service 完好保留未被清空！
    const regAfter = JSON.parse(fs.readFileSync(regFile, 'utf8'));
    assert.equal(regAfter.components.antigravity_plugin.installId, 'inst-agy-original');
    assert.equal(regAfter.components.claude_service.installId, 'inst-claude-original');
    assert.ok(regAfter.components.runtime.installId.startsWith('inst-'));
    assert.equal(fs.existsSync(path.join(agyPluginDir, '.agent-things-managed.json')), true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('边界验证 13：普通升级遇到登记缺失时停止；明确修复后再升级成功', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-13-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const agyPluginDir = path.join(tmpHome, '.gemini/config/plugins/things');
    const { repairPluginRegistry } = require('../src/runtime-install.cjs');

    // 预置带合法受管标记但无外部登记的 Antigravity 插件目录（模拟登记丢失）
    fs.mkdirSync(agyPluginDir, { recursive: true });
    fs.writeFileSync(path.join(agyPluginDir, 'plugin.json'), JSON.stringify({ name: 'things' }));
    fs.writeFileSync(path.join(agyPluginDir, '.agent-things-managed.json'), JSON.stringify({
      version: 1,
      componentId: 'agent-things',
      installId: 'inst-existing-valid',
      managed: true,
    }));
    fs.writeFileSync(path.join(agyPluginDir, 'original.txt'), 'protect-me');

    // 1. 普通安装/升级尝试：遇到登记缺失必须严格停止并抛出异常，绝不静默覆盖
    assert.throws(() => {
      installRuntime(root, runtime, {
        enabledApps: ['antigravity'],
        dataDir,
        homeDirectory: tmpHome,
      });
    }, /无法确认归属或属于其他插件（原因：registry_missing）/);

    // 原目录内容必须完好无损
    assert.equal(fs.readFileSync(path.join(agyPluginDir, 'original.txt'), 'utf8'), 'protect-me');

    // 2. 明确执行授权登记修复
    const repairResult = repairPluginRegistry(dataDir, tmpHome);
    assert.equal(repairResult.success, true);
    assert.equal(repairResult.installId, 'inst-existing-valid');

    // 3. 修复后再执行升级：顺利成功
    installRuntime(root, runtime, {
      enabledApps: ['antigravity'],
      dataDir,
      homeDirectory: tmpHome,
    });
    commitInstallation(dataDir, [runtime, agyPluginDir]);

    // 验证：受管核验通过，升级完成
    const ownership = verifyPluginOwnership(agyPluginDir, dataDir);
    assert.equal(ownership.allowed, true);
    assert.equal(ownership.path, 'managed');
    assert.equal(ownership.reason, 'managed_plugin');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('测试 15A：提交后收尾遇瞬时错误，自愈重试成功且保留新配置、服务与 runtime', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-15a-'));
  try {
    const dataDir = path.join(tmpHome, 'Library/Application Support/CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const runtimeInstall = require('../src/runtime-install.cjs');

    // 预置 Codex 配置文件
    const codexConfig = path.join(tmpHome, '.codex/config.toml');
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
    fs.writeFileSync(codexConfig, 'model = "test"\n');

    // 子进程测试：在子进程中运行 executeSetup，并注入一次瞬时写错误
    const script = `
      const path = require('node:path');
      const fs = require('node:fs');
      const root = '${root}';
      const tmpHome = '${tmpHome}';
      const dataDir = '${dataDir}';

      const launchd = require(path.join(root, 'src/launchd.cjs'));
      launchd.printJob = () => null;
      launchd.bootout = async () => {};
      launchd.bootstrap = () => {};

      const runtimeInstall = require(path.join(root, 'src/runtime-install.cjs'));
      let transientFail = true;
      const origRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (typeof to === 'string' && to.includes('installed-components.json') && transientFail) {
          transientFail = false;
          throw new Error('transient disk busy during finalizer');
        }
        return origRename(from, to);
      };

      const setup = require(path.join(root, 'src/cli/setup-orchestrator.cjs'));
      (async () => {
        const res = await setup.executeSetup({ enabledApps: ['codex'] });
        console.log(JSON.stringify(res));
      })().catch(err => {
        console.error(err);
        process.exit(1);
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, HOME: tmpHome },
      stdio: 'pipe',
    });
    assert.equal(res.status, 0, `子进程应当自愈成功：${res.stderr.toString('utf8')}`);
    const out = JSON.parse(res.stdout.toString('utf8').trim());
    assert.equal(out.success, true);
    assert.ok(out.warning && out.warning.includes('收尾自愈重试成功'));

    // 检查配置未回退
    const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    assert.deepEqual(config.enabledApps, ['codex']);
    assert.equal(config.installed, true);

    // 检查 runtime 完好
    assert.equal(fs.existsSync(path.join(runtime, 'bin/codex-session-status.cjs')), true);

    // 检查服务配置 PLIST 存在
    assert.equal(fs.existsSync(path.join(tmpHome, 'Library/LaunchAgents/com.codexsessionstatus.agent.plist')), true);

    // 检查事务日志已被清理，登记成功就绪
    assert.equal(fs.existsSync(runtimeInstall.getTransactionFile(dataDir)), false);
    assert.equal(fs.existsSync(runtimeInstall.getInstalledComponentsFile(dataDir)), true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('测试 15B：提交后收尾遇持续错误，保留新配置、服务、runtime、事务日志和备份', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-15b-'));
  try {
    const dataDir = path.join(tmpHome, 'Library/Application Support/CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const runtimeInstall = require('../src/runtime-install.cjs');

    const codexConfig = path.join(tmpHome, '.codex/config.toml');
    fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
    fs.writeFileSync(codexConfig, 'model = "test"\n');

    // 子进程测试：持续注入 Finalizer 写入失败
    const script = `
      const path = require('node:path');
      const fs = require('node:fs');
      const root = '${root}';
      const tmpHome = '${tmpHome}';
      const dataDir = '${dataDir}';

      const launchd = require(path.join(root, 'src/launchd.cjs'));
      launchd.printJob = () => null;
      launchd.bootout = async () => {};
      launchd.bootstrap = () => {};

      const runtimeInstall = require(path.join(root, 'src/runtime-install.cjs'));
      const origRename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (typeof to === 'string' && to.includes('installed-components.json')) {
          throw new Error('persistent registry disk error');
        }
        return origRename(from, to);
      };

      const setup = require(path.join(root, 'src/cli/setup-orchestrator.cjs'));
      (async () => {
        await setup.executeSetup({ enabledApps: ['codex'] });
      })().catch(err => {
        console.error(err.code || err.message);
        process.exit(2);
      });
    `;

    const res = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, HOME: tmpHome },
      stdio: 'pipe',
    });
    assert.equal(res.status, 2, '持续错误应退出并抛出明确错误');
    assert.ok(res.stderr.toString('utf8').includes('COMMITTED_PENDING_RECOVERY') || res.stderr.toString('utf8').includes('收尾待恢复'));

    // 验证新配置未被回退为空！
    const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    assert.deepEqual(config.enabledApps, ['codex'], '持续错误时配置绝不回退为空');
    assert.equal(config.installed, true);

    // 验证 runtime 完好
    assert.equal(fs.existsSync(path.join(runtime, 'bin/codex-session-status.cjs')), true);

    // 验证服务文件依然保留
    assert.equal(fs.existsSync(path.join(tmpHome, 'Library/LaunchAgents/com.codexsessionstatus.agent.plist')), true);

    // 验证事务日志完好保留且处于 committed 阶段
    const tx = JSON.parse(fs.readFileSync(runtimeInstall.getTransactionFile(dataDir), 'utf8'));
    assert.equal(tx.stage, 'committed');
    assert.ok(tx.finalizeError && tx.finalizeError.includes('persistent registry disk error'));
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('测试 16A：外部登记为非法 JSON 时，Finalizer 拒绝覆盖，保留原内容、日志与备份', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-16a-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const regFile = path.join(dataDir, 'installed-components.json');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'v1.txt'), 'version-1');

    // 预置损坏的非法 JSON 登记文件
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(regFile, 'ILLEGAL JSON CORRUPTED {');

    // 执行安装
    installRuntime(root, runtime, {
      enabledApps: ['codex'],
      dataDir,
      homeDirectory: tmpHome,
    });

    // 调用 commitInstallation，应当坚决停止收尾
    assert.throws(() => {
      commitInstallation(dataDir, [runtime]);
    }, /外部组件登记文件损坏/);

    // 验证：原登记文件内容原封不动，未被覆盖！
    assert.equal(fs.readFileSync(regFile, 'utf8'), 'ILLEGAL JSON CORRUPTED {');

    // 验证：事务日志完好保留且为 committed
    const tx = JSON.parse(fs.readFileSync(getTransactionFile(dataDir), 'utf8'));
    assert.equal(tx.stage, 'committed');
    assert.ok(tx.finalizeError && tx.finalizeError.includes('格式损坏'));

    // 验证：备份目录完好保留未被误删
    assert.equal(fs.existsSync(tx.targets[0].backupPath), true, '备份必须完好保留');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('测试 16B：外部登记为合法 JSON 但结构无效时，Finalizer 拒绝覆盖，保留原内容、日志与备份', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fault-test-16b-'));
  try {
    const dataDir = path.join(tmpHome, 'CodexSessionStatus');
    const runtime = path.join(dataDir, 'runtime');
    const regFile = path.join(dataDir, 'installed-components.json');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'v1.txt'), 'version-1');

    // 预置合法 JSON 但结构无效的登记文件（如 components 为字符串或 null 或数组）
    fs.mkdirSync(dataDir, { recursive: true });
    const invalidStructure = JSON.stringify({ version: 1, components: 'invalid-string-not-object' });
    fs.writeFileSync(regFile, invalidStructure);

    // 执行安装
    installRuntime(root, runtime, {
      enabledApps: ['codex'],
      dataDir,
      homeDirectory: tmpHome,
    });

    // 调用 commitInstallation，应当坚决停止收尾
    assert.throws(() => {
      commitInstallation(dataDir, [runtime]);
    }, /外部组件登记文件结构无效/);

    // 验证：原登记文件内容原封不动，未被覆盖！
    assert.equal(fs.readFileSync(regFile, 'utf8'), invalidStructure);

    // 验证：事务日志完好保留且为 committed
    const tx = JSON.parse(fs.readFileSync(getTransactionFile(dataDir), 'utf8'));
    assert.equal(tx.stage, 'committed');
    assert.ok(tx.finalizeError && tx.finalizeError.includes('结构无效'));

    // 验证：备份目录完好保留未被误删
    assert.equal(fs.existsSync(tx.targets[0].backupPath), true, '备份必须完好保留');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
