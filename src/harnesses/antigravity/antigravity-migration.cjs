'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { withStateFileLock } = require('../../state-file-lock.cjs');
const { ManualStatusStore } = require('../../manual-status-store.cjs');

/**
 * 合并一对 Antigravity 会话键 (旧键 legacyKey 与规范键 canonicalKey)
 * 严格按照时间轴中实际完成的 analysis 事件判定发生序号，而非使用 record.actionSequence 或缺失的 item.actionSequence
 */
function mergeSessionPair(legacyKey, canonicalKey, stateData, report = { unresolvedAnalyses: [] }) {
  const legacyRecord = stateData.records?.[legacyKey];
  const canonicalRecord = stateData.records?.[canonicalKey];

  // 1. 查找最大的有效清除序列号（严禁与时间戳比较，必须使用 actionSequence）
  const legacyClearedSeq = legacyRecord?.clearedAtSequence || 0;
  const canonicalClearedSeq = canonicalRecord?.clearedAtSequence || 0;
  const maxClearedSeq = Math.max(legacyClearedSeq, canonicalClearedSeq);

  // 2. 处理当前状态记录（手动记录）
  let finalRecord = null;
  const compareRecords = (a, b) => ((b?.actionSequence || 0) - (a?.actionSequence || 0))
    || ((b?.revision || 0) - (a?.revision || 0)) || ((b?.updatedAt || 0) - (a?.updatedAt || 0));
  const records = [legacyRecord, canonicalRecord].filter(Boolean);
  
  // 找出所有在清除边界之后的活跃记录
  const activeRecords = records.filter(r => (r.actionSequence || 0) > maxClearedSeq && r.state !== null);
  
  if (activeRecords.length > 0) {
    // 手动保存会推进 actionSequence，取最大的最新有效记录
    activeRecords.sort(compareRecords);
    finalRecord = { ...activeRecords[0] };
    if (maxClearedSeq > 0) finalRecord.clearedAtSequence = maxClearedSeq;
  } else {
    // 两个键都已被清除，或原本就为空
    if (maxClearedSeq > 0) {
      const highestSeq = Math.max(legacyRecord?.actionSequence || 0, canonicalRecord?.actionSequence || 0, maxClearedSeq);
      finalRecord = {
        state: null,
        actionSequence: highestSeq,
        clearedAtSequence: maxClearedSeq,
        revision: Math.max(legacyRecord?.revision || 0, canonicalRecord?.revision || 0),
        updatedAt: Math.max(legacyRecord?.updatedAt || 0, canonicalRecord?.updatedAt || 0, Date.now()),
      };
    } else if (records.length > 0) {
      records.sort(compareRecords);
      finalRecord = { ...records[0] };
    }
  }

  // 3. 处理 Analysis & Ledger
  // 真实落盘结构为 { checkpoint, sources, ledger, projectGit }，自身不含 actionSequence！
  // 核心逻辑：从 timeline 中找到与该 key 关联的实际 completed 分析事件，以事件的 actionSequence 作为其实际完成序号
  const rawTimeline = stateData.timeline || [];
  
  function findAnalysisActionSequence(key) {
    const events = rawTimeline.filter(e => e.key === key && e.source === 'analysis' && e.status === 'completed');
    if (events.length === 0) return null; // 无法从时间轴找到完成事件佐证
    events.sort((a, b) => (b.actionSequence || 0) - (a.actionSequence || 0));
    return events[0].actionSequence || 0;
  }

  let finalAnalysis = null;
  const legacyAnalysis = stateData.analysis?.[legacyKey];
  const canonicalAnalysis = stateData.analysis?.[canonicalKey];
  const analyses = [
    legacyAnalysis ? { item: legacyAnalysis, key: legacyKey } : null,
    canonicalAnalysis ? { item: canonicalAnalysis, key: canonicalKey } : null,
  ].filter(Boolean).sort((a, b) => compareRecords(stateData.records?.[a.key], stateData.records?.[b.key]));

  let bestAnalysisSeq = -1;

  for (const { item, key } of analyses) {
    const eventSeq = findAnalysisActionSequence(key);

    if (eventSeq === null) {
      // 无法可靠证明该分析是在清除前还是清除后产生
      if (maxClearedSeq > 0) {
        // 如果该会话发生过清除，且无法证明此分析在清除之后完成，绝不能静默选它
        report.unresolvedAnalyses.push({
          key,
          reason: '分析对象缺少时间轴完成事件佐证，存在于清除边界会话中，已保留在备份中并在迁移中安全剔除',
          analysisSummary: item.ledger?.summary || '',
        });
        continue;
      } else {
        // 若从未被清除过，且当前尚未选定分析，则作为备选
        if (!finalAnalysis) {
          finalAnalysis = structuredClone(item);
          bestAnalysisSeq = 0;
        }
        continue;
      }
    }

    // 与清除序号对比：严格发生在清除边界之后的合法分析才予以保留
    if (maxClearedSeq > 0 && eventSeq <= maxClearedSeq) {
      continue;
    }

    if (eventSeq > bestAnalysisSeq) {
      bestAnalysisSeq = eventSeq;
      finalAnalysis = structuredClone(item);
    }
  }

  // 检查点连续性校验：对齐生产 commitCheckpoint 真实结构
  // 校验 turnHashes、versions（prompt/schema/ledger）与 extractorVersion
  if (finalAnalysis) {
    const checkpoint = finalAnalysis.checkpoint;
    let isConsistent = true;
    if (checkpoint) {
      if (!Array.isArray(checkpoint.turnHashes) || !checkpoint.versions?.prompt || !checkpoint.extractorVersion) {
        isConsistent = false;
      }
    }
    if (!isConsistent) {
      delete finalAnalysis.checkpoint;
    }
  }

  // 4. 处理 Timeline 事件（去重并保留清除边界之后的事件）
  const combinedTimeline = [];
  const eventSeen = new Set();

  for (const event of rawTimeline) {
    if (event.key === legacyKey || event.key === canonicalKey) {
      if (maxClearedSeq > 0 && (event.actionSequence || 0) <= maxClearedSeq) {
        continue;
      }
      // 事件身份去重（同一毫秒内但 actionSequence 不同的两次操作均保留）
      const eventId = `${event.actionSequence || 0}:${event.source || ''}:${event.status || ''}:${event.requestedAt || 0}`;
      if (!eventSeen.has(eventId)) {
        eventSeen.add(eventId);
        const cloned = structuredClone(event);
        cloned.key = canonicalKey;
        combinedTimeline.push(cloned);
      }
    } else {
      combinedTimeline.push(event);
    }
  }

  // 5. 应用合并结果
  if (stateData.records) {
    delete stateData.records[legacyKey];
    if (finalRecord) {
      stateData.records[canonicalKey] = finalRecord;
    } else {
      delete stateData.records[canonicalKey];
    }
  }

  if (stateData.analysis) {
    delete stateData.analysis[legacyKey];
    if (finalAnalysis) {
      stateData.analysis[canonicalKey] = finalAnalysis;
    } else {
      delete stateData.analysis[canonicalKey];
    }
  }

  stateData.timeline = combinedTimeline;
}

function migrateAntigravityKeys(stateData) {
  if (!stateData || typeof stateData !== 'object') return stateData;

  const records = stateData.records || {};
  const processedCleanIds = new Set();
  const report = {
    unresolvedAnalyses: [],
    migratedCleanIds: [],
  };

  const keys = new Set([...Object.keys(records), ...Object.keys(stateData.analysis || {}), ...(stateData.timeline || []).map(event => event.key)]);
  for (const rawKey of keys) {
    try {
      const parsed = JSON.parse(rawKey);
      if (Array.isArray(parsed) && parsed[0] === 'local') {
        const idStr = String(parsed[1]);
        const cleanId = idStr.replace(/^local:/, '');
        if (processedCleanIds.has(cleanId)) continue;
        processedCleanIds.add(cleanId);

        const legacyKey = JSON.stringify(['local', 'local:' + cleanId]);
        const canonicalKey = JSON.stringify(['local', cleanId]);

        if (records[legacyKey] || stateData.analysis?.[legacyKey] || stateData.timeline?.some(event => event.key === legacyKey)) {
          mergeSessionPair(legacyKey, canonicalKey, stateData, report);
          report.migratedCleanIds.push(cleanId);
        }
      }
    } catch (_) {}
  }

  return { data: stateData, report };
}

function executeMigration(stateFilePath) {
  if (!fs.existsSync(stateFilePath)) return { migrated: false, reason: '文件不存在' };

  return withStateFileLock(stateFilePath, () => {
    const raw = fs.readFileSync(stateFilePath, 'utf8');
    // Validate the persisted schema before touching an existing ledger.
    const data = new ManualStatusStore(stateFilePath).data;
    const { data: migratedData, report } = migrateAntigravityKeys(data);
    if (!report.migratedCleanIds.length) return { migrated: false, reason: '会话键已规范化' };

    migratedData.revision++;
    for (const id of report.migratedCleanIds) {
      const record = migratedData.records[JSON.stringify(['local', id])];
      if (record) record.revision = migratedData.revision;
    }
    const backupPath = `${stateFilePath}.bak_migrate_${Date.now()}_${process.pid}`;
    fs.writeFileSync(backupPath, raw, { mode: 0o600, flag: 'wx' });
    const tmp = `${stateFilePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(migratedData, null, 2) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, stateFilePath);
    } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }

    return {
      migrated: true,
      backupPath,
      report,
    };
  });
}

module.exports = {
  mergeSessionPair,
  migrateAntigravityKeys,
  executeMigration,
};
