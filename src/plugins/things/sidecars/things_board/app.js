/**
 * Things UI Aux Pane Frontend (app.js)
 */

(function () {
  'use strict';

  const i18nData = window.__agentThingsI18n || {};
  let activeLang = (window.__agentThingsLang || i18nData.lang || (navigator.language && navigator.language.toLowerCase().startsWith('en') ? 'en' : 'zh')) === 'en' ? 'en' : 'zh';
  const fallbackStrings = {
    zh: {
      labels: { unstarted: '尚未开始', unfinished: '有遗留事项', completed: '全部完成', pushed: '全部完成并已推送' },
      noSessionBadge: '无会话',
      offlineBadge: '离线',
      totalsPattern: '已完成 {done} / {total} 项任务',
      savingBtn: '保存中…',
      saveBtn: '保存记录',
      conflictBanner: '保存冲突：内容已被其他入口修改。当前草稿已保留。',
      conflictShortToast: '保存冲突，已保留当前草稿',
      savedFeedback: '✓ 保存成功',
      saveFailedPrefix: '保存失败: ',
      clearConfirm: '确定要清除本会话的任务进度和记录吗？',
      clearedFeedback: '✓ 已清空进度',
      clearFailedPrefix: '清除失败: ',
    },
    en: {
      labels: { unstarted: 'Not started', unfinished: 'Remaining items', completed: 'Completed', pushed: 'Completed & pushed' },
      noSessionBadge: 'No session',
      offlineBadge: 'Offline',
      totalsPattern: '{done} of {total} tasks done',
      savingBtn: 'Saving...',
      saveBtn: 'Save',
      conflictBanner: 'Save conflict: updated elsewhere. Your draft has been kept.',
      conflictShortToast: 'Save conflict, draft kept',
      savedFeedback: '✓ Saved',
      saveFailedPrefix: 'Save failed: ',
      clearConfirm: 'Clear progress and task records for this session?',
      clearedFeedback: '✓ Cleared',
      clearFailedPrefix: 'Clear failed: ',
    },
  };
  function str(key, vars) {
    const loc = (i18nData.locales && i18nData.locales[activeLang]) || i18nData.strings || fallbackStrings[activeLang];
    const tmpl = loc[key] !== undefined ? loc[key] : (fallbackStrings[activeLang][key] !== undefined ? fallbackStrings[activeLang][key] : key);
    if (!vars) return tmpl;
    return String(tmpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
  }
  function getStateLabels() {
    const loc = (i18nData.locales && i18nData.locales[activeLang]) || null;
    return (loc && loc.labels) || i18nData.labels || fallbackStrings[activeLang].labels;
  }

  const getConversationId = () => {
    return (
      window.sidecar?.conversationId ||
      new URLSearchParams(window.location.search).get('conversationId') ||
      ''
    );
  };

  const convId = getConversationId();

  // State
  let session = null;
  let isEditMode = false;
  let isFormDirty = false;
  let isSaving = false;
  let currentFilter = 'all';
  let pollTimer = null;

  // Form draft state
  let draftState = 'unstarted';
  let draftProgress = 0;
  let draftNote = '';

  // Elements
  const headerStateBadge = document.getElementById('headerStateBadge');
  const btnToggleMode = document.getElementById('btnToggleMode');
  const iconEdit = document.getElementById('iconEdit');
  const iconCloseEdit = document.getElementById('iconCloseEdit');
  const overviewPanel = document.getElementById('overviewPanel');
  const editPanel = document.getElementById('editPanel');
  const heroPercent = document.getElementById('heroPercent');
  const heroFraction = document.getElementById('heroFraction');
  const heroFill = document.getElementById('heroFill');
  const noteCard = document.getElementById('noteCard');
  const noteContent = document.getElementById('noteContent');
  const taskList = document.getElementById('taskList');
  const tasksEmpty = document.getElementById('tasksEmpty');
  const filterTabs = document.getElementById('filterTabs');
  const countAll = document.getElementById('countAll');
  const countTodo = document.getElementById('countTodo');
  const countDone = document.getElementById('countDone');

  // Edit elements
  const conflictBanner = document.getElementById('conflictBanner');
  const conflictText = document.getElementById('conflictText');
  const stateChips = document.getElementById('stateChips');
  const inputProgressSlider = document.getElementById('inputProgressSlider');
  const inputProgressNum = document.getElementById('inputProgressNum');
  const inputNote = document.getElementById('inputNote');
  const btnSave = document.getElementById('btnSave');
  const btnCancelEdit = document.getElementById('btnCancelEdit');
  const btnClear = document.getElementById('btnClear');
  const toast = document.getElementById('toast');

  function showToast(message, durationMs = 2000) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.add('hidden');
    }, durationMs);
  }

  async function apiFetch(url, options = {}) {
    if (window.sidecar?.fetch) {
      return window.sidecar.fetch(url, options);
    }
    return fetch(url, options);
  }

  async function loadSession() {
    if (!convId) {
      headerStateBadge.textContent = str('noSessionBadge');
      return;
    }

    try {
      const res = await apiFetch(`/api/session?conversationId=${encodeURIComponent(convId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.lang === 'en' || data?.lang === 'zh') activeLang = data.lang;
      session = data;
      renderOverview();
      if (!isEditMode) {
        initDraftFromSession();
      }
    } catch (err) {
      console.warn('[things_board] Failed to load session:', err.message);
      headerStateBadge.textContent = str('offlineBadge');
    }
  }

  function initDraftFromSession() {
    if (!session) return;
    draftState = session.state || 'unstarted';
    draftProgress = typeof session.progress === 'number' ? session.progress : 0;
    draftNote = session.note || '';

    // Update form controls
    syncChipsUI();
    if (inputProgressSlider) inputProgressSlider.value = draftProgress;
    if (inputProgressNum) inputProgressNum.value = draftProgress;
    if (inputNote) inputNote.value = draftNote;
    isFormDirty = false;
    if (conflictBanner) conflictBanner.classList.add('hidden');
  }

  function syncChipsUI() {
    const buttons = stateChips.querySelectorAll('.chip-btn');
    buttons.forEach((btn) => {
      if (btn.getAttribute('data-state') === draftState) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  function renderOverview() {
    if (!session) return;

    // Header State Badge
    const stateLabels = getStateLabels();
    const state = session.state || 'unstarted';
    headerStateBadge.textContent = stateLabels[state] || state;
    headerStateBadge.className = 'badge badge-state ' + (state ? `state-${state}` : '');

    // Hero Progress
    const progress = typeof session.progress === 'number' ? session.progress : 0;
    heroPercent.textContent = `${progress}%`;
    heroFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;

    const total = session.totalTasks || 0;
    const completed = session.completedTasks || 0;
    heroFraction.textContent = str('totalsPattern', { done: completed, total });

    // Note Card
    if (session.note && session.note.trim()) {
      noteContent.textContent = session.note.trim();
      noteCard.classList.remove('hidden');
    } else {
      noteCard.classList.add('hidden');
    }

    // Filter counts
    const allTasks = session.tasks || [];
    const todoTasks = allTasks.filter((t) => t.status !== 'done');
    const doneTasks = allTasks.filter((t) => t.status === 'done');

    countAll.textContent = allTasks.length;
    countTodo.textContent = todoTasks.length;
    countDone.textContent = doneTasks.length;

    // Filtered tasks
    let filtered = allTasks;
    if (currentFilter === 'todo') filtered = todoTasks;
    else if (currentFilter === 'done') filtered = doneTasks;

    if (filtered.length === 0) {
      taskList.innerHTML = '';
      tasksEmpty.classList.remove('hidden');
    } else {
      tasksEmpty.classList.add('hidden');
      renderTaskList(filtered);
    }
  }

  function renderTaskList(tasks) {
    taskList.innerHTML = '';
    tasks.forEach((task) => {
      const item = document.createElement('div');
      item.className = 'task-item' + (task.status === 'done' ? ' is-done' : '');

      let iconHtml = '';
      if (task.status === 'done') {
        iconHtml = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>`;
      } else if (task.status === 'blocked') {
        iconHtml = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>`;
      } else {
        iconHtml = `
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="9"></circle>
          </svg>`;
      }

      item.innerHTML = `
        <div class="task-status-icon ${task.status}">${iconHtml}</div>
        <div class="task-details">
          <div class="task-title">${escapeHtml(task.title)}</div>
          ${task.summary ? `<div class="task-summary">${escapeHtml(task.summary)}</div>` : ''}
        </div>
      `;
      taskList.appendChild(item);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setEditMode(active) {
    isEditMode = active;
    if (active) {
      initDraftFromSession();
      overviewPanel.classList.add('hidden');
      editPanel.classList.remove('hidden');
      iconEdit.classList.add('hidden');
      iconCloseEdit.classList.remove('hidden');
    } else {
      editPanel.classList.add('hidden');
      overviewPanel.classList.remove('hidden');
      iconCloseEdit.classList.add('hidden');
      iconEdit.classList.remove('hidden');
    }
  }

  // Event Listeners
  btnToggleMode?.addEventListener('click', () => {
    setEditMode(!isEditMode);
  });

  btnCancelEdit?.addEventListener('click', () => {
    setEditMode(false);
  });

  filterTabs?.addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    const filter = tab.getAttribute('data-filter');
    if (filter === currentFilter) return;

    filterTabs.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = filter;
    renderOverview();
  });

  stateChips?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip-btn');
    if (!chip) return;
    draftState = chip.getAttribute('data-state');
    syncChipsUI();
    isFormDirty = true;
  });

  inputProgressSlider?.addEventListener('input', (e) => {
    draftProgress = parseInt(e.target.value, 10) || 0;
    if (inputProgressNum) inputProgressNum.value = draftProgress;
    isFormDirty = true;
  });

  inputProgressNum?.addEventListener('input', (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val)) val = 0;
    if (val < 0) val = 0;
    if (val > 100) val = 100;
    draftProgress = val;
    if (inputProgressSlider) inputProgressSlider.value = draftProgress;
    isFormDirty = true;
  });

  inputNote?.addEventListener('input', (e) => {
    draftNote = e.target.value;
    isFormDirty = true;
  });

  btnSave?.addEventListener('click', async () => {
    if (isSaving || !session) return;
    try {
      isSaving = true;
      btnSave.disabled = true;
      btnSave.textContent = str('savingBtn');

      const payload = {
        type: 'update',
        conversationId: convId,
        expectedRevision: session.revision,
        record: {
          state: draftState,
          progress: draftProgress,
          note: draftNote,
        },
      };

      const res = await apiFetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        const errJson = await res.json();
        conflictText.textContent = errJson.error || str('conflictBanner');
        conflictBanner.classList.remove('hidden');
        showToast(str('conflictShortToast'));
        return;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      showToast(str('savedFeedback'));
      isFormDirty = false;
      await loadSession();
      setEditMode(false);
    } catch (err) {
      showToast(`${str('saveFailedPrefix')}${err.message}`);
    } finally {
      isSaving = false;
      btnSave.disabled = false;
      btnSave.textContent = str('saveBtn');
    }
  });

  btnClear?.addEventListener('click', async () => {
    if (isSaving || !session) return;
    if (!confirm(str('clearConfirm'))) return;

    try {
      isSaving = true;
      btnClear.disabled = true;
      const payload = {
        type: 'clear',
        conversationId: convId,
        expectedRevision: session.revision,
      };

      const res = await apiFetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      showToast(str('clearedFeedback'));
      isFormDirty = false;
      await loadSession();
      setEditMode(false);
    } catch (err) {
      showToast(`${str('clearFailedPrefix')}${err.message}`);
    } finally {
      isSaving = false;
      btnClear.disabled = false;
    }
  });

  // Polling loop
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      // Avoid overwriting draft during edit
      if (!isEditMode && !isFormDirty && document.visibilityState === 'visible') {
        loadSession();
      }
    }, 3500);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isEditMode) {
      loadSession();
    }
  });

  // Init
  loadSession();
  startPolling();
})();
