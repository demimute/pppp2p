import React, { useState, useEffect, useCallback, useRef } from 'react';
import FolderSelector from './components/FolderSelector.jsx';
import GroupGrid from './components/GroupGrid.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { useApi } from './hooks/useApi.js';

const MODES = {
  quick: {
    id: 'quick',
    label: '快速',
    summary: '优先快出结果，适合先扫一遍。',
    strategy: 'phash',
    threshold: 8,
  },
  standard: {
    id: 'standard',
    label: '标准',
    summary: '默认推荐，兼顾误并和漏并。',
    strategy: 'dual',
    dualThreshold: { clip: 0.92, phash: 10 },
    personEnhance: { enabled: true, weight: 0.55, diffThreshold: 0.8 },
  },
  strict: {
    id: 'strict',
    label: '严格',
    summary: '更谨慎，优先减少误并。',
    strategy: 'dual',
    dualThreshold: { clip: 0.94, phash: 8 },
    personEnhance: { enabled: true, weight: 0.85, diffThreshold: 0.88 },
  },
};

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const [selectedFolder, setSelectedFolder] = useState(null);
  const [imageCount, setImageCount] = useState(0);
  const [selectedMode, setSelectedMode] = useState('standard');
  const [groups, setGroups] = useState([]);
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  const [stats, setStats] = useState({ total_groups: 0, to_remove: 0, to_keep: 0 });
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [undoFeedback, setUndoFeedback] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pythonReady, setPythonReady] = useState(false);
  const [backendState, setBackendState] = useState({ running: false, source: 'unknown', message: '后端状态未知' });
  const [analysisProgress, setAnalysisProgress] = useState({ active: false, percent: 0, stage: '' });
  const [comparePanel, setComparePanel] = useState({ open: false, group: null, selectedIndex: 0 });
  const [confirmDialog, setConfirmDialog] = useState({ open: false });
  const [history, setHistory] = useState([]);
  const [isRemoving, setIsRemoving] = useState(false);

  const { post, get, error } = useApi();

  useEffect(() => {
    const initBackendState = async () => {
      if (!window.electronAPI) {
        setPythonReady(true);
        return;
      }

      window.electronAPI.onPythonReady((payload) => {
        setPythonReady(Boolean(payload?.running ?? true));
        setBackendState(payload || { running: true, source: 'managed', message: '内置后端已启动' });
      });

      window.electronAPI.onMenuSelectFolder(async () => {
        handleSelectFolder();
      });

      const status = await window.electronAPI.getPythonStatus();
      setBackendState(status || { running: false, source: 'unknown', message: '后端状态未知' });
      if (status?.running) {
        setPythonReady(true);
      }
    };

    initBackendState();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    const result = await get('/api/history');
    if (result?.history) {
      setHistory(result.history);
    }
  };

  const handleSelectFolder = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.selectFolder();
    if (!result.canceled && result.folder) {
      setSelectedFolder(result.folder);
      await scanFolder(result.folder);
    }
  };

  const handleDrop = async (folderPath) => {
    setSelectedFolder(folderPath);
    await scanFolder(folderPath);
  };

  const handleClearFolder = () => {
    setSelectedFolder(null);
    setImageCount(0);
    setGroups([]);
    setStats({ total_groups: 0, to_remove: 0, to_keep: 0 });
    setAnalysisMessage('');
    setUndoFeedback(null);
    closeComparePanel();
  };

  const scanFolder = async (folder) => {
    const result = await post('/api/scan', { folder });
    if (result) {
      setImageCount(result.total || 0);
      setAnalysisMessage(`已加载 ${result.total || 0} 张图片`);
    }
  };

  const closeComparePanel = useCallback(() => {
    setComparePanel({ open: false, group: null, selectedIndex: 0 });
  }, []);

  const handleStartAnalysis = async () => {
    if (!selectedFolder) return;

    closeComparePanel();
    const mode = MODES[selectedMode];

    setIsAnalyzing(true);
    setAnalysisMessage('');
    setAnalysisProgress({ active: true, percent: 5, stage: '准备分析...' });

    try {
      setAnalysisProgress({ active: true, percent: 15, stage: '扫描照片...' });
      const scanResult = await post('/api/scan', { folder: selectedFolder });
      const images = scanResult?.images?.map((img) => img.name) || [];

      if (mode.strategy === 'dual') {
        setAnalysisProgress({ active: true, percent: 40, stage: '提取视觉特征...' });
        await post('/api/embed', { folder: selectedFolder, images });
        setAnalysisProgress({ active: true, percent: 65, stage: '计算感知哈希...' });
        await post('/api/hash', { folder: selectedFolder, images });
      } else if (mode.strategy === 'phash') {
        setAnalysisProgress({ active: true, percent: 60, stage: '计算感知哈希...' });
        await post('/api/hash', { folder: selectedFolder, images });
      }

      setAnalysisProgress({ active: true, percent: 85, stage: '计算相似分组...' });
      const result = await post('/api/groups', {
        folder: selectedFolder,
        strategy: mode.strategy,
        threshold: mode.strategy === 'dual' ? mode.dualThreshold.clip : mode.threshold,
        clip_threshold: mode.strategy === 'dual' ? mode.dualThreshold.clip : undefined,
        phash_threshold: mode.strategy === 'dual' ? mode.dualThreshold.phash : undefined,
        enhanced_persona: mode.personEnhance?.enabled,
        identity_penalty_strength: mode.personEnhance?.weight,
        identity_diff_threshold: mode.personEnhance?.diffThreshold,
        loose_threshold: 0.85,
      });

      if (result) {
        const nextGroups = result.groups || [];
        const nextStats = result.stats || { total_groups: 0, to_remove: 0, to_keep: 0 };
        setGroups(nextGroups);
        setStats(nextStats);
        setAnalysisProgress({ active: true, percent: 100, stage: '分析完成' });
        setAnalysisMessage(
          nextGroups.length > 0
            ? `已找到 ${nextStats.total_groups} 组相似照片，建议移除 ${nextStats.to_remove} 张`
            : '没有发现符合当前模式的相似组'
        );
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setAnalysisProgress({ active: false, percent: 0, stage: '' });
      setAnalysisMessage('分析失败，请检查后端状态或目录权限');
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => {
        setAnalysisProgress((prev) => prev.percent === 100 ? { active: false, percent: 0, stage: '' } : prev);
      }, 600);
    }
  };

  const handleGroupClick = (group, index) => {
    setComparePanel({ open: true, group, selectedIndex: index });
  };

  const handleCompareAction = (action) => {
    const { group, selectedIndex } = comparePanel;
    if (!group) return;

    const isWinnerSelection = group.winner === group.members?.[selectedIndex]?.name;
    const willBeMarked = action === 'remove' && !isWinnerSelection;
    let nextSelectedIndex = selectedIndex;
    let shouldClosePanel = false;

    setGroups((prev) => {
      let statsDelta = null;
      const nextGroups = prev.map((g) => {
        if (g.id !== group.id) return g;

        const wasMarked = !!g.members?.[selectedIndex]?.to_remove;
        if (wasMarked !== willBeMarked) {
          statsDelta = willBeMarked ? 1 : -1;
        }

        const nextMembers = g.members.map((m, i) => (
          i === selectedIndex ? { ...m, to_remove: willBeMarked } : m
        ));

        if (selectedIndex < nextMembers.length - 1) {
          nextSelectedIndex = selectedIndex + 1;
        } else {
          shouldClosePanel = true;
        }

        return { ...g, members: nextMembers };
      });

      if (statsDelta !== null) {
        setStats((prevStats) => ({
          ...prevStats,
          to_remove: Math.max(0, prevStats.to_remove + statsDelta),
          to_keep: Math.max(0, prevStats.to_keep - statsDelta),
        }));
      }

      return nextGroups;
    });

    if (isWinnerSelection && action === 'remove') {
      setUndoFeedback({ type: 'error', message: '最优项不能标记为移除，请至少保留 1 张。' });
    }

    if (shouldClosePanel) {
      closeComparePanel();
      return;
    }

    setComparePanel((prev) => ({ ...prev, selectedIndex: nextSelectedIndex }));
  };

  const handleCompareSkip = () => {
    const { group, selectedIndex } = comparePanel;
    if (!group) return;
    if (selectedIndex < group.members.length - 1) {
      setComparePanel((prev) => ({ ...prev, selectedIndex: prev.selectedIndex + 1 }));
    } else {
      closeComparePanel();
    }
  };

  const handleCompareNavigate = (index) => {
    setComparePanel((prev) => ({ ...prev, selectedIndex: index }));
  };

  const handlePromoteOptimal = (memberName) => {
    if (!memberName || !comparePanel.group) return;

    setGroups((prev) => prev.map((g) => {
      if (g.id !== comparePanel.group.id) return g;
      return {
        ...g,
        winner: memberName,
        winner_size: g.members.find((m) => m.name === memberName)?.size || g.winner_size,
        members: g.members.map((m) => ({ ...m, to_remove: m.name === memberName ? false : m.to_remove })),
      };
    }));

    setComparePanel((prev) => ({
      ...prev,
      group: {
        ...prev.group,
        winner: memberName,
        winner_size: prev.group.members.find((m) => m.name === memberName)?.size || prev.group.winner_size,
        members: prev.group.members.map((m) => ({ ...m, to_remove: m.name === memberName ? false : m.to_remove })),
      },
    }));
  };

  const handleUndo = async () => {
    const targetFolder = selectedFolder || history[0]?.folder;
    if (!targetFolder) return;

    setUndoFeedback(null);
    const result = await post('/api/undo', { folder: targetFolder });

    if (result?.success) {
      setUndoFeedback({ type: 'success', message: `已恢复 ${result.restored ?? 0} 张照片` });
      await fetchHistory();

      if (selectedFolder === targetFolder) {
        closeComparePanel();
        setGroups((prev) => prev.map((g) => ({
          ...g,
          members: g.members.map((m) => ({ ...m, to_remove: false })),
        })));
        await handleStartAnalysis();
      }
    } else {
      setUndoFeedback({
        type: 'error',
        message: result?.error || '撤销失败，无可恢复的操作',
      });
    }
  };

  const handleExecuteRemove = async () => {
    if (!selectedFolder || isRemoving) return;

    const moves = groups
      .flatMap((g) => g.members)
      .filter((m) => m.to_remove)
      .map((m) => ({ name: m.name, action: 'remove' }));

    if (moves.length === 0) {
      setUndoFeedback({ type: 'error', message: '当前没有待移除的照片' });
      return;
    }

    setIsRemoving(true);
    try {
      const result = await post('/api/move', {
        folder: selectedFolder,
        moves,
        strategy: MODES[selectedMode].strategy,
      });

      if (result?.success) {
        setUndoFeedback({ type: 'success', message: `已移除 ${result.moved ?? moves.length} 张照片` });
        setConfirmDialog({ open: false });
        await fetchHistory();
        await handleStartAnalysis();
      } else {
        setUndoFeedback({ type: 'error', message: result?.error || '移除失败' });
      }
    } finally {
      setIsRemoving(false);
    }
  };

  const openRemoveConfirm = () => {
    const toRemove = groups.flatMap((g) => g.members).filter((m) => m.to_remove);
    if (toRemove.length === 0) {
      setUndoFeedback({ type: 'error', message: '当前没有待移除的照片' });
      return;
    }
    setConfirmDialog({ open: true });
  };

  const reviewedGroups = groups.filter((group) => (group.members || []).some((member) => member.to_remove)).length;
  const currentMode = MODES[selectedMode];
  const latestEntry = history[0];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.08),_transparent_28%),linear-gradient(180deg,#f7fafc_0%,#eef2f7_100%)] text-gray-900 dark:bg-gray-950 dark:text-white">
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-6 lg:px-6">
        <aside className="w-full lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:w-[360px] lg:flex-shrink-0">
          <div className="flex h-full flex-col rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-gray-800 dark:bg-gray-900/85">
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">DedupStudio</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">照片去重工作台</h1>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                先选文件夹，再开始分析。系统会默认给出保留建议，你只需要在少数组里纠正即可。
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200/80 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-950/50">
              <FolderSelector
                selectedFolder={selectedFolder}
                imageCount={imageCount}
                onSelect={handleSelectFolder}
                onDrop={handleDrop}
                onClear={handleClearFolder}
              />
            </div>

            <div className="mt-5 rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">分析模式</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">默认标准；只有结果太松或太严时再切模式。</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {Object.values(MODES).map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setSelectedMode(mode.id)}
                    className={`rounded-2xl border px-3 py-3 text-left transition ${selectedMode === mode.id ? 'border-sky-500 bg-sky-500 text-white shadow-lg shadow-sky-500/20' : 'border-gray-200 bg-gray-50 hover:border-sky-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-sky-700'}`}
                  >
                    <div className="text-sm font-semibold">{mode.label}</div>
                    <div className={`mt-1 text-[11px] leading-4 ${selectedMode === mode.id ? 'text-sky-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      {mode.summary}
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={handleStartAnalysis}
                disabled={!selectedFolder || isAnalyzing || !pythonReady}
                className="btn btn-primary mt-4 w-full py-3 text-base"
              >
                {isAnalyzing ? '分析中...' : '开始分析'}
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">相似组</p>
                <p className="mt-1 text-2xl font-semibold">{stats.total_groups || 0}</p>
              </div>
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">建议移除</p>
                <p className="mt-1 text-2xl font-semibold text-red-500">{stats.to_remove || 0}</p>
              </div>
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">预计保留</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-500">{stats.to_keep || 0}</p>
              </div>
              <div className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
                <p className="text-xs text-gray-500 dark:text-gray-400">已确认组</p>
                <p className="mt-1 text-2xl font-semibold">{reviewedGroups}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-950/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">当前状态</p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{analysisMessage || '准备开始'}</p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">后端：{backendState.message}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${pythonReady ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                  {pythonReady ? '就绪' : '未就绪'}
                </span>
              </div>
              {analysisProgress.active && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{analysisProgress.stage}</span>
                    <span>{analysisProgress.percent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-full rounded-full bg-sky-500 transition-all duration-300" style={{ width: `${analysisProgress.percent}%` }} />
                  </div>
                </div>
              )}
              {undoFeedback && (
                <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${undoFeedback.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'}`}>
                  {undoFeedback.message}
                </div>
              )}
              {error && (
                <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="mt-auto pt-5">
              <div className="rounded-[24px] border border-gray-200/80 bg-gray-950 p-4 text-white shadow-[0_20px_50px_rgba(15,23,42,0.22)] dark:border-gray-800">
                <p className="text-sm font-semibold">最后一步</p>
                <p className="mt-1 text-sm text-gray-300">确认分组后统一执行清理，系统会把照片移到“已去重”文件夹。</p>
                <button
                  onClick={openRemoveConfirm}
                  disabled={!selectedFolder || stats.to_remove === 0 || isRemoving}
                  className="mt-4 w-full rounded-2xl bg-white px-4 py-3 text-base font-semibold text-gray-950 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRemoving ? '处理中...' : `执行清理${stats.to_remove ? ` (${stats.to_remove})` : ''}`}
                </button>
                {latestEntry && !latestEntry.undone && (
                  <button
                    onClick={handleUndo}
                    className="mt-3 w-full rounded-2xl border border-white/15 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    撤销上一次清理
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="rounded-[30px] border border-white/70 bg-white/85 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
            <div className="mb-6 flex flex-col gap-3 border-b border-gray-200 pb-5 dark:border-gray-800 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">Workflow</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">逐组确认，少做决定</h2>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  默认相信系统建议。只在你觉得不对的组里打开详情，改一下保留项就行。
                </p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300">
                当前模式：<span className="font-semibold text-gray-900 dark:text-white">{currentMode.label}</span>
                <span className="mx-2 text-gray-300 dark:text-gray-700">•</span>
                {currentMode.summary}
              </div>
            </div>

            <GroupGrid
              groups={groups}
              onGroupClick={handleGroupClick}
              selectedStrategy={MODES[selectedMode].strategy}
            />
          </div>
        </main>
      </div>

      <ComparePanel
        open={comparePanel.open}
        group={comparePanel.group}
        selectedIndex={comparePanel.selectedIndex}
        folder={selectedFolder}
        onClose={closeComparePanel}
        onAction={handleCompareAction}
        onSkip={handleCompareSkip}
        onNavigate={handleCompareNavigate}
        onPromoteOptimal={handlePromoteOptimal}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        groups={groups}
        stats={stats}
        onConfirm={handleExecuteRemove}
        onCancel={() => setConfirmDialog({ open: false })}
      />
    </div>
  );
}

export default App;
