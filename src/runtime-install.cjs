'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { verifyBridgeBundle } = require('./native-bridge.cjs');
const PACKAGE_VERSION = require('../package.json').version;

const COMPONENT_ID = 'agent-things';
const MANAGED_MARKER_FILE = '.agent-things-managed.json';
const INSTALLED_COMPONENTS_FILE = 'installed-components.json';

function getTransactionFile(dataDir) {
  return path.join(dataDir, 'installation-transaction.json');
}

function getInstalledComponentsFile(dataDir) {
  return path.join(dataDir, INSTALLED_COMPONENTS_FILE);
}

function writeTransactionAtomic(txFile, tx) {
  const dir = path.dirname(txFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `tx-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(tx, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, txFile);
  try {
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch (_) {}
}

/**
 * 统一归属核验规则：安装覆盖与卸载使用同一套规则。
 * 明确区分三条互斥路径：
 * 1. 正常受管 (Strict Managed)：受管标记与外部登记严格强一致匹配
 * 2. 历史纳管 (Legacy Adoptable)：未带标记的历史开发版已知骨架结构
 * 3. 登记修复 (Registry Repair)：受管标记存在且有效，但外部登记缺失/损坏；默认拒绝，仅在显式修复授权时放行
 * 4. 未知目录 (Unrecognized)：坚决拒绝，杜绝无端覆盖与误删
 */
function verifyPluginOwnership(pluginDir, dataDir, options = {}) {
  if (!fs.existsSync(pluginDir)) {
    return { allowed: true, reason: 'not_exists' };
  }

  // 1. 优先核验版本化受管标记
  const markerFile = path.join(pluginDir, MANAGED_MARKER_FILE);
  if (fs.existsSync(markerFile)) {
    let marker = null;
    try {
      marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    } catch (_) {
      return { allowed: false, path: 'corrupted', reason: 'corrupted_marker' };
    }

    if (!marker || marker.version !== 1 || marker.componentId !== COMPONENT_ID || marker.managed !== true) {
      return { allowed: false, path: 'mismatched', reason: 'unrecognized_component' };
    }

    // 强制核验 installId：必须是非空有效字符串，缺失或伪造直接拒绝
    if (!marker.installId || typeof marker.installId !== 'string' || !marker.installId.trim()) {
      return { allowed: false, path: 'corrupted', reason: 'missing_install_id' };
    }

    // 校验 plugin.json 描述文件（若存在，名称必须匹配 things）
    const pJson = path.join(pluginDir, 'plugin.json');
    if (fs.existsSync(pJson)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pJson, 'utf8'));
        if (parsed && parsed.name && parsed.name !== 'things') {
          return { allowed: false, path: 'mismatched', reason: 'plugin_name_mismatch' };
        }
      } catch (_) {
        return { allowed: false, path: 'corrupted', reason: 'corrupted_plugin_json' };
      }
    }

    // 校验外部登记文件
    const regFile = getInstalledComponentsFile(dataDir);
    let reg = null;
    let regCorrupted = false;
    if (fs.existsSync(regFile)) {
      try {
        reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
      } catch (_) {
        regCorrupted = true;
      }
    }

    // 路径 3A：外部登记文件损坏
    if (regCorrupted) {
      if (options.allowRepair === true) {
        return { allowed: true, path: 'repair', reason: 'registry_corrupted_repair_authorized', details: { marker, regFile } };
      }
      return { allowed: false, path: 'repair', reason: 'registry_corrupted', canRepair: true, details: { marker, regFile } };
    }

    // 路径 3B：外部登记文件不存在
    if (!reg || !fs.existsSync(regFile)) {
      if (options.allowRepair === true) {
        return { allowed: true, path: 'repair', reason: 'registry_missing_repair_authorized', details: { marker } };
      }
      return { allowed: false, path: 'repair', reason: 'registry_missing', canRepair: true, details: { marker } };
    }

    // 路径 3C：外部登记存在，但缺少组件登记条目
    const comp = reg.components && reg.components.antigravity_plugin;
    if (!comp || !comp.installId) {
      if (options.allowRepair === true) {
        return { allowed: true, path: 'repair', reason: 'component_not_registered_repair_authorized', details: { marker, reg } };
      }
      return { allowed: false, path: 'repair', reason: 'component_not_registered', canRepair: true, details: { marker, reg } };
    }

    // 冲突：外部登记记录了不同的 installId
    if (comp.installId !== marker.installId) {
      return {
        allowed: false,
        path: 'managed',
        reason: 'install_id_mismatch',
        details: { markerInstallId: marker.installId, regInstallId: comp.installId },
      };
    }

    // 路径 1：正常受管插件，强一致匹配通过
    return { allowed: true, path: 'managed', reason: 'managed_plugin', details: marker };
  }

  // 2. 路径 2：首次纳管流程（无受管标记，核验未带标记的历史/开发版已知特征）
  const pJson = path.join(pluginDir, 'plugin.json');
  const indexHtml = path.join(pluginDir, 'sidecars/things_board/index.html');
  const logoSvg = path.join(pluginDir, 'assets/logo.svg');
  if (fs.existsSync(pJson)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(pJson, 'utf8'));
      if (parsed.name === 'things' && fs.existsSync(indexHtml) && fs.existsSync(logoSvg)) {
        return { allowed: true, path: 'adoptable', reason: 'legacy_adoptable', isAdoptable: true, details: parsed };
      }
    } catch (_) {}
  }

  // 3. 其它未知目录或第三方插件：坚决拒绝操作
  return { allowed: false, path: 'unrecognized', reason: 'unrecognized_plugin' };
}

/**
 * 独立的显式登记修复操作：必须在用户明确授权下调用。
 * 修复前自动备份原始登记与插件证据，登记损坏时保护其他组件信息。
 */
function repairPluginRegistry(dataDir, homeDirectory, options = {}) {
  const home = homeDirectory || process.env.HOME || os.homedir();
  const agyPluginDir = path.join(home, '.gemini/config/plugins/things');
  const ownership = verifyPluginOwnership(agyPluginDir, dataDir);

  if (ownership.path !== 'repair' || !ownership.canRepair) {
    throw new Error(`当前目录无法执行登记修复（原因：${ownership.reason}）`);
  }

  const marker = ownership.details && ownership.details.marker;
  if (!marker || !marker.installId) {
    throw new Error('受管标记缺失有效 installId，拒绝执行登记修复以防数据篡改');
  }

  const regFile = getInstalledComponentsFile(dataDir);
  let existingComponents = {};

  if (fs.existsSync(regFile)) {
    // 修复前留存原始登记备份
    const bakFile = `${regFile}.bak_${Date.now()}`;
    try { fs.copyFileSync(regFile, bakFile); } catch (_) {}

    try {
      const parsed = JSON.parse(fs.readFileSync(regFile, 'utf8'));
      if (parsed && typeof parsed.components === 'object' && parsed.components !== null) {
        existingComponents = { ...parsed.components };
      }
    } catch (_) {
      try { fs.copyFileSync(regFile, `${regFile}.corrupted.${Date.now()}`); } catch (_) {}
    }
  }

  // 增量合并登记，保留其他组件
  existingComponents.antigravity_plugin = {
    componentId: COMPONENT_ID,
    target: agyPluginDir,
    installId: marker.installId,
    packageVersion: marker.packageVersion || PACKAGE_VERSION,
    repairedAt: new Date().toISOString(),
  };

  const regData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    components: existingComponents,
  };

  writeTransactionAtomic(regFile, regData);
  return { success: true, repaired: true, installId: marker.installId };
}

function rollbackTransaction(tx) {
  if (!tx || !Array.isArray(tx.targets)) return;
  for (const targetInfo of [...tx.targets].reverse()) {
    const { target, stagePath, backupPath, existed, step } = targetInfo;
    const targetExists = fs.existsSync(target);
    const backupExists = backupPath && fs.existsSync(backupPath);
    const stageExists = stagePath && fs.existsSync(stagePath);

    if (existed) {
      const effectiveStep = step || (targetInfo.swapped || tx.stage === 'swapped' ? 'swap_done' : 'init');
      // 原本存在的目标：按实际操作阶段精准回滚
      if (effectiveStep === 'init' || effectiveStep === 'staged') {
        // 本次事务尚未移走正式目录，正式目录保持原状，绝不使用历史或外部备份覆盖！
      } else if (effectiveStep === 'prepare_backup') {
        // 关键边界：旧目录成功移走但 backup_done 尚未落盘即中断
        // 若 target 已消失且 backupPath 存在，必须将本次唯一备份还原回 target
        if (!targetExists && backupExists) {
          fs.renameSync(backupPath, target);
        }
        // 若 target 存在，说明尚未执行 rename 或已在先前回滚中还原成功，幂等安全
      } else if (effectiveStep === 'backup_done' || effectiveStep === 'prepare_swap') {
        // 目录已备份到 backupPath
        if (backupExists) {
          if (targetExists) {
            fs.rmSync(target, { recursive: true, force: true });
          }
          fs.renameSync(backupPath, target);
        }
        // 若 backupExists 为 false 且 targetExists 为 true，说明先前回滚尝试已完成移回，幂等安全
      } else if (effectiveStep === 'swap_done') {
        // 正式目录已被新版本占用：先清理新版本，再将 backupPath 还原回 target
        if (backupExists) {
          if (targetExists) {
            fs.rmSync(target, { recursive: true, force: true });
          }
          fs.renameSync(backupPath, target);
        }
        // 若 backupExists 为 false 且 targetExists 为 true，说明先前回滚已将备份还原回 target，幂等安全
      }
    } else {
      // 原本不存在的目标（首次安装）：恢复为不存在
      if (targetExists) {
        fs.rmSync(target, { recursive: true, force: true });
      }
      if (backupExists) {
        fs.rmSync(backupPath, { recursive: true, force: true });
      }
    }

    if (stageExists) {
      fs.rmSync(stagePath, { recursive: true, force: true });
    }
  }
}

/**
 * 可靠的事务提交状态探测器：在执行任何撤销/恢复前确认提交结果。
 * 返回 { exists: boolean, corrupted: boolean, committed: boolean, stage: string|null, tx?: any, error?: string }
 */
function checkCommitStatus(dataDir) {
  const file = getTransactionFile(dataDir);
  if (!fs.existsSync(file)) {
    return { exists: false, corrupted: false, committed: false, stage: null };
  }
  try {
    const content = fs.readFileSync(file, 'utf8');
    const tx = JSON.parse(content);
    if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
      return { exists: true, corrupted: true, committed: false, stage: null, error: '日志不是有效JSON对象' };
    }
    return {
      exists: true,
      corrupted: false,
      committed: tx.stage === 'committed',
      stage: tx.stage || null,
      tx,
    };
  } catch (err) {
    return { exists: true, corrupted: true, committed: false, stage: null, error: err.message };
  }
}

/**
 * 统一的幂等提交完成器（Finalizer）
 * 顺序：增量更新组件登记落盘 -> 幂等清理备份与暂存 -> 移除事务日志
 * 严格门禁：
 * - 外部登记文件若存在，必须为有效 JSON 且结构合法（包含对象类型的 components 字段）；
 * - 登记文件损坏或结构无效时，坚决停止收尾并保留已提交事务现场供独立修复，绝不静默覆盖；
 * - 仅当登记文件完全不存在时，才按首次安装规则建立全新登记。
 */
function finalizeCommit(dataDir, tx, txFile, targetPaths = []) {
  // 1. 增量更新外部组件登记：保留未参与本次事务的其他组件
  const regFile = getInstalledComponentsFile(dataDir);
  let existingComponents = {};

  if (fs.existsSync(regFile)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(regFile, 'utf8'));
    } catch (parseErr) {
      tx.finalizeError = `外部组件登记文件格式损坏: ${parseErr.message}`;
      try { writeTransactionAtomic(txFile, tx); } catch (_) {}
      throw new Error(`外部组件登记文件损坏 (${regFile})，为保护现有登记已停止提交收尾，请执行登记修复操作：${parseErr.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.components !== 'object' || parsed.components === null || Array.isArray(parsed.components)) {
      tx.finalizeError = '外部组件登记文件结构无效（components 字段缺失或类型错误）';
      try { writeTransactionAtomic(txFile, tx); } catch (_) {}
      throw new Error(`外部组件登记文件结构无效 (${regFile})，为保护现有登记已停止提交收尾，请执行登记修复操作以核查并恢复数据`);
    }

    existingComponents = { ...parsed.components };
  }

  for (const t of tx.targets || []) {
    existingComponents[t.name] = {
      componentId: COMPONENT_ID,
      target: t.target,
      installId: tx.installId,
      updatedAt: new Date().toISOString(),
    };
  }

  const regData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    components: existingComponents,
  };

  try {
    writeTransactionAtomic(regFile, regData);
  } catch (regErr) {
    // 登记落盘失败：保留已提交事务供恢复，绝不删除事务日志！
    tx.finalizeError = `组件登记落盘失败: ${regErr.message}`;
    try { writeTransactionAtomic(txFile, tx); } catch (_) {}
    throw new Error(`安装提交已完成，但更新组件登记失败，收尾待恢复：${regErr.message}`);
  }

  // 2. 幂等清理备份与暂存目录
  for (const t of tx.targets || []) {
    if (t.backupPath && fs.existsSync(t.backupPath)) fs.rmSync(t.backupPath, { recursive: true, force: true });
    if (t.stagePath && fs.existsSync(t.stagePath)) fs.rmSync(t.stagePath, { recursive: true, force: true });
  }
  for (const p of targetPaths) {
    const backup = `${p}.previous`;
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  }

  // 3. 收尾全部完成，移除事务日志
  fs.rmSync(txFile, { force: true });
  return { committed: true, finalized: true };
}

function recoverPendingTransaction(dataDir) {
  const file = getTransactionFile(dataDir);
  if (!fs.existsSync(file)) return null;
  let tx;
  try {
    tx = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // 日志损坏：绝不删除日志和现场，停止并抛出明确错误
    throw new Error(`检测到损坏的未完成安装事务日志 (${file})，为防止数据损坏已停止恢复，请保留现场进行人工核查：${err.message}`);
  }
  if (!tx || tx.version !== 1) {
    throw new Error(`未完成事务日志格式无效 (${file})，已停止恢复以保留现场`);
  }

  // 若提交标记已落盘：统一执行幂等提交收尾（补写登记 + 幂等清理），绝不触发回滚
  if (tx.stage === 'committed') {
    finalizeCommit(dataDir, tx, file, []);
    return { recovered: true, status: 'committed_cleanup' };
  }

  try {
    rollbackTransaction(tx);
    fs.rmSync(file, { force: true });
    return { recovered: true, status: 'rolled_back' };
  } catch (rollbackErr) {
    // 回滚失败：保留日志并标记状态，绝不删除日志和现场
    tx.stage = 'rollback_failed';
    tx.rollbackError = rollbackErr.message;
    try { writeTransactionAtomic(file, tx); } catch (_) {}
    throw new Error(`未完成事务回滚失败，已保留事务日志与备份目录：${rollbackErr.message}`);
  }
}

function commitInstallation(dataDir, targetPaths = []) {
  const txFile = getTransactionFile(dataDir);
  if (fs.existsSync(txFile)) {
    let tx = null;
    try {
      tx = JSON.parse(fs.readFileSync(txFile, 'utf8'));
    } catch (err) {
      throw new Error(`无法确认事务状态：事务日志文件损坏 (${err.message})`);
    }

    if (!tx || typeof tx !== 'object' || Array.isArray(tx)) {
      throw new Error('无法确认事务状态：事务日志格式无效');
    }

    if (tx.version === 1) {
      // 1. 提交标记原子落盘持久化
      tx.stage = 'committed';
      tx.committedAt = new Date().toISOString();
      writeTransactionAtomic(txFile, tx);

      // 2. 统一执行提交收尾
      finalizeCommit(dataDir, tx, txFile, targetPaths);
      return { success: true, committed: true, finalized: true };
    }
    fs.rmSync(txFile, { force: true });
  }

  for (const p of targetPaths) {
    const backup = `${p}.previous`;
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
  }
  return { success: true, committed: true, finalized: true };
}

function stageRuntime(source, stage, installId) {
  for (const directory of ['src', 'bin', 'skills', 'native', 'mods']) {
    const srcDir = path.join(source, directory);
    if (!fs.existsSync(srcDir)) continue;
    fs.cpSync(srcDir, path.join(stage, directory), {
      recursive: true,
      filter: file => !/\.bak(?:_|$)|\.log$|\.DS_Store$/.test(path.basename(file)) && !['tests', 'test', 'evals', 'node_modules'].includes(path.basename(file)),
    });
  }
  fs.mkdirSync(path.join(stage, 'scripts'), { recursive: true });
  for (const name of ['setup-antigravity-service.cjs', 'setup-claude-service.cjs', 'build-codex-bundle.cjs', 'build-antigravity-bundle.cjs', 'build-shared-ui.cjs']) {
    const scriptFile = path.join(source, 'scripts', name);
    if (fs.existsSync(scriptFile)) {
      fs.copyFileSync(scriptFile, path.join(stage, 'scripts', name));
    }
  }
  for (const name of ['LICENSE', 'NOTICE', 'package.json']) {
    const docFile = path.join(source, name);
    if (fs.existsSync(docFile)) {
      fs.copyFileSync(docFile, path.join(stage, name));
    }
  }
  // 写入受管标记
  const marker = {
    version: 1,
    componentId: COMPONENT_ID,
    packageVersion: PACKAGE_VERSION,
    installId,
    managed: true,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(stage, MANAGED_MARKER_FILE), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
  execFileSync(process.execPath, [path.join(stage, 'bin/codex-session-status.cjs'), 'help'], { stdio: 'pipe', timeout: 5000 });
}

function stageAntigravityPlugin(source, stage, installId) {
  const pluginSrc = path.join(source, 'src/plugins/things');
  if (!fs.existsSync(pluginSrc)) {
    throw new Error('安装包缺少 Antigravity 插件源码 (src/plugins/things)');
  }
  fs.cpSync(pluginSrc, stage, {
    recursive: true,
    filter: file => !/\.bak(?:_|$)|\.log$|\.DS_Store$/.test(path.basename(file)) && !['tests', 'test', 'evals', 'node_modules'].includes(path.basename(file)),
  });
  const pJson = path.join(stage, 'plugin.json');
  if (!fs.existsSync(pJson)) {
    throw new Error('Antigravity 插件缺少 plugin.json 元数据描述');
  }
  // 写入受管标记
  const marker = {
    version: 1,
    componentId: COMPONENT_ID,
    packageVersion: PACKAGE_VERSION,
    installId,
    managed: true,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(stage, MANAGED_MARKER_FILE), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
}

function installRuntime(source, runtime, options = {}) {
  // 契约收紧：必须显式指定应用，禁止无意识默认包含 antigravity
  const enabledApps = Array.isArray(options.enabledApps) ? options.enabledApps : ['codex'];
  const dataDir = options.dataDir || path.dirname(runtime);
  const homeDirectory = options.homeDirectory || process.env.HOME || os.homedir();

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  recoverPendingTransaction(dataDir);

  const txFile = getTransactionFile(dataDir);
  const pid = process.pid;
  const installId = `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const targets = [];
  targets.push({
    name: 'runtime',
    target: runtime,
    stagePath: `${runtime}.stage.${pid}`,
    backupPath: `${runtime}.backup.${installId}`,
    existed: fs.existsSync(runtime),
    step: 'init',
    stageFn: (sDir) => stageRuntime(source, sDir, installId),
  });

  const agyPluginDir = path.join(homeDirectory, '.gemini/config/plugins/things');
  const agyPluginSrc = path.join(source, 'src/plugins/things');

  if (enabledApps.includes('antigravity') && fs.existsSync(agyPluginSrc)) {
    // 统一归属核验门禁
    const ownership = verifyPluginOwnership(agyPluginDir, dataDir, { action: 'install' });
    if (!ownership.allowed) {
      throw new Error(`已有目录 ${agyPluginDir} 无法确认归属或属于其他插件（原因：${ownership.reason}），已终止安装以保护用户数据`);
    }
    targets.push({
      name: 'antigravity_plugin',
      target: agyPluginDir,
      stagePath: `${agyPluginDir}.stage.${pid}`,
      backupPath: `${agyPluginDir}.backup.${installId}`,
      existed: fs.existsSync(agyPluginDir),
      step: 'init',
      stageFn: (sDir) => stageAntigravityPlugin(source, sDir, installId),
    });
  }

  const tx = {
    version: 1,
    pid,
    installId,
    createdAt: new Date().toISOString(),
    stage: 'init',
    targets: targets.map(({ name, target, stagePath, backupPath, existed, step }) => ({
      name, target, stagePath, backupPath, existed, step,
    })),
  };
  writeTransactionAtomic(txFile, tx);

  try {
    // 阶段 1：暂存构建
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      fs.rmSync(t.stagePath, { recursive: true, force: true });
      fs.mkdirSync(t.stagePath, { recursive: true });
      t.stageFn(t.stagePath);
      t.step = 'staged';
      tx.targets[i].step = 'staged';
    }
    tx.stage = 'staged';
    writeTransactionAtomic(txFile, tx);

    // 阶段 2：细粒度原子重命名（区分意图与完成）
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];

      // 步 2.1：准备备份
      tx.targets[i].step = 'prepare_backup';
      writeTransactionAtomic(txFile, tx);

      fs.rmSync(t.backupPath, { recursive: true, force: true });
      if (t.existed) {
        fs.renameSync(t.target, t.backupPath);
      }

      // 步 2.2：备份完成
      tx.targets[i].step = 'backup_done';
      writeTransactionAtomic(txFile, tx);

      // 步 2.3：准备替换正式位置
      tx.targets[i].step = 'prepare_swap';
      writeTransactionAtomic(txFile, tx);

      fs.renameSync(t.stagePath, t.target);

      // 步 2.4：替换完成
      tx.targets[i].step = 'swap_done';
      writeTransactionAtomic(txFile, tx);
    }

    tx.stage = 'swapped';
    writeTransactionAtomic(txFile, tx);
    // 替换完成，保持 backupPath 留存，由外层整体成功后 commitInstallation 清理
  } catch (error) {
    tx.stage = 'failed';
    tx.error = error.message;
    try { writeTransactionAtomic(txFile, tx); } catch (_) {}
    try {
      rollbackTransaction(tx);
      fs.rmSync(txFile, { force: true });
    } catch (rbErr) {
      tx.stage = 'rollback_failed';
      tx.rollbackError = rbErr.message;
      try { writeTransactionAtomic(txFile, tx); } catch (_) {}
      throw new Error(`安装失败 (${error.message})，且回滚失败：${rbErr.message}`);
    }
    throw error;
  }
}

function prepareStartup(source, directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const bridge = path.join(directory, 'bridge');
  const temporary = `${bridge}.building`;
  try {
    fs.copyFileSync(verifyBridgeBundle(source), temporary);
    fs.chmodSync(temporary, 0o755);
    const version = JSON.parse(execFileSync(temporary, ['version'], { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }));
    if (version.protocol !== 1) throw new Error('启动桥协议不匹配，请重新获取安装包');
    fs.renameSync(temporary, bridge);
  } finally { fs.rmSync(temporary, { force: true }); }
  const settings = path.join(directory, 'autostart.json');
  if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({ app: '/Applications/ChatGPT.app', allowClientRestart: true }) + '\n', { mode: 0o600 });
}

module.exports = {
  COMPONENT_ID,
  MANAGED_MARKER_FILE,
  INSTALLED_COMPONENTS_FILE,
  installRuntime,
  prepareStartup,
  commitInstallation,
  recoverPendingTransaction,
  rollbackTransaction,
  writeTransactionAtomic,
  verifyPluginOwnership,
  repairPluginRegistry,
  checkCommitStatus,
  finalizeCommit,
  getTransactionFile,
  getInstalledComponentsFile,
};
