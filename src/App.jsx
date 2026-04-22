import React, { useState, useEffect, useCallback, useRef } from 'react';
import GroupGrid from './components/GroupGrid.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { useApi } from './hooks/useApi.js';

const MODES = {
  quick: {
    id: 'quick',
    label: '快速',
    strategy: 'phash',
    threshold: 8,
  },
  standard: {
    id: 'standard',
    label: '标准',
    strategy: 'dual',
    dualThreshold: { clip: 0.92, phash: 10 },
    personEnhance: { enabled: true, weight: 0.55, diffThreshold: 0.8 },
  },
  strict: {
    id: 'strict',
    label: '严格',
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

  const [selectedFolder, setSelectedFolder] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [imageCount, setImageCount] = useState(0);
  const [selectedMode, setSelectedMode] = useState('standard');
  const [showModeTuning, setShowModeTuning] = useState(false);
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

  const closeComparePanel = useCallback(() => {
    setComparePanel({ open: false, group: null, selectedIndex: 0 });
  }, []);

  const scanFolder = async (folder) => {
    const result = await post('/api/scan', { folder });
    if (result) {
      setSelectedFolder(folder);
      setManualPath(folder);
      setImageCount(result.total || 0);
      setAnalysisMessage(result.total ? `已加载 ${result.total} 张` : '文件夹为空');
    }
  };

  const handleSelectFolder = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.selectFolder();
    if (!result.canceled && result.folder) {
      await scanFolder(result.folder);
    }
  };

  const handleDropPath = async (path) => {
    if (!path?.trim()) return;
    await scanFolder(path.trim());
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    await handleDropPath(manualPath);
  };

  const handleStartAnalysis = async () => {
    if (!selectedFolder) return;

    closeComparePanel();
    const mode = MODES[selectedMode];

    setIsAnalyzing(true);
    setAnalysisMessage('');
    setAnalysisProgress({ active: true, percent: 5, stage: '准备分析' });

    try {
      setAnalysisProgress({ active: true, percent: 15, stage: '扫描照片' });
      const scanResult = await post('/api/scan', { folder: selectedFolder });
      const images = scanResult?.images?.map((img) => img.name) || [];

      if (mode.strategy === 'dual') {
        setAnalysisProgress({ active: true, percent: 40, stage: '提取特征' });
        await post('/api/embed', { folder: selectedFolder, images });
        setAnalysisProgress({ active: true, percent: 65, stage: '计算哈希' });
        await post('/api/hash', { folder: selectedFolder, images });
      } else if (mode.strategy === 'phash') {
        setAnalysisProgress({ active: true, percent: 60, stage: '计算哈希' });
        await post('/api/hash', { folder: selectedFolder, images });
      }

      setAnalysisProgress({ active: true, percent: 85, stage: '生成分组' });
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
        setAnalysisProgress({ active: true, percent: 100, stage: '完成' });
        setAnalysisMessage(nextGroups.length > 0 ? `找到 ${nextStats.total_groups} 组` : '没有找到相似组');
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setAnalysisProgress({ active: false, percent: 0, stage: '' });
      setAnalysisMessage('分析失败');
    } finally {
      setIsAnalyzing(false);
      setTimeout(() => {
        setAnalysisProgress((prev) => prev.percent === 100 ? { active: false, percent: 0, stage: '' } : prev);
      }, 500);
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

    setGroups((prev) => {
      let statsDelta = null;
      return prev.map((g) => {
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
        }

        if (statsDelta !== null) {
          setStats((prevStats) => ({
            ...prevStats,
            to_remove: Math.max(0, prevStats.to_remove + statsDelta),
            to_keep: Math.max(0, prevStats.to_keep - statsDelta),
          }));
        }

        return { ...g, members: nextMembers };
      });
    });

    if (isWinnerSelection && action === 'remove') {
      setUndoFeedback({ type: 'error', message: '保留项不能直接移除' });
      return;
    }

    setComparePanel((prev) => ({
      ...prev,
      selectedIndex: nextSelectedIndex,
      group: groupsRef.current.find((g) => g.id === group.id) || prev.group,
    }));
  };

  const handleCompareSkip = () => {
    const { group, selectedIndex } = comparePanel;
    if (!group) return;
    if (selectedIndex < group.members.length - 1) {
      setComparePanel((prev) => ({ ...prev, selectedIndex: prev.selectedIndex + 1 }));
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

    setStats((prevStats) => {
      const nextGroups = groupsRef.current.map((g) => {
        if (g.id !== comparePanel.group.id) return g;
        return {
          ...g,
          winner: memberName,
          members: g.members.map((m) => ({ ...m, to_remove: m.name === memberName ? false : m.to_remove })),
        };
      });
      const toRemove = nextGroups.flatMap((g) => g.members).filter((m) => m.to_remove).length;
      return { ...prevStats, to_remove: toRemove, to_keep: Math.max(imageCount - toRemove, 0) };
    });
  };

  const handleUndo = async () => {
    const targetFolder = selectedFolder || history[0]?.folder;
    if (!targetFolder) return;

    setUndoFeedback(null);
    const result = await post('/api/undo', { folder: targetFolder });

    if (result?.success) {
      setUndoFeedback({ type: 'success', message: `已恢复 ${result.restored ?? 0} 张` });
      await fetchHistory();
      if (selectedFolder === targetFolder) {
        await handleStartAnalysis();
      }
    } else {
      setUndoFeedback({ type: 'error', message: result?.error || '撤销失败' });
    }
  };

  const handleExecuteRemove = async () => {
    if (!selectedFolder || isRemoving) return;

    const moves = groups
      .flatMap((g) => g.members)
      .filter((m) => m.to_remove)
      .map((m) => ({ name: m.name, action: 'remove' }));

    if (moves.length === 0) {
      setUndoFeedback({ type: 'error', message: '没有待移除照片' });
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
        setUndoFeedback({ type: 'success', message: `已移除 ${result.moved ?? moves.length} 张` });
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
      setUndoFeedback({ type: 'error', message: '没有待移除照片' });
      return;
    }
    setConfirmDialog({ open: true });
  };

  const latestEntry = history[0];

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-gray-900 dark:bg-gray-950 dark:text-white">
      <div className="mx-auto max-w-[1500px] px-4 py-4 lg:px-6">
        <header className="rounded-[24px] border border-gray-200 bg-white px-4 py-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex items-center gap-3 xl:min-w-[150px]">
              <div className="rounded-2xl bg-gray-950 px-3 py-2 text-sm font-semibold tracking-[0.18em] text-white dark:bg-white dark:text-gray-950">PPPP2P</div>
              <button onClick={handleSelectFolder} className="btn btn-secondary whitespace-nowrap">选择文件夹</button>
            </div>

            <form onSubmit={handleManualSubmit} className="flex min-w-0 flex-1 gap-2">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="输入或粘贴文件夹路径"
                className="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:bg-white dark:border-gray-800 dark:bg-gray-950 dark:focus:border-sky-700"
              />
              <button type="submit" className="btn btn-secondary whitespace-nowrap">加载路径</button>
              <button type="button" onClick={handleStartAnalysis} disabled={!selectedFolder || isAnalyzing || !pythonReady} className="btn btn-primary whitespace-nowrap">
                {isAnalyzing ? '分析中' : '开始分析'}
              </button>
              <button type="button" onClick={openRemoveConfirm} disabled={!selectedFolder || stats.to_remove === 0 || isRemoving} className="btn btn-danger whitespace-nowrap">
                执行清理
              </button>
              <button type="button" onClick={handleUndo} disabled={!latestEntry || latestEntry.undone} className="btn btn-secondary whitespace-nowrap">
                撤销
              </button>
            </form>
          </div>

          <div className="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-700 dark:text-gray-200">{selectedFolder ? '已选' : '未选择'}</span>
              {selectedFolder ? `：${selectedFolder}` : ''}
              {imageCount ? ` · ${imageCount} 张` : ''}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {Object.values(MODES).map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setSelectedMode(mode.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${selectedMode === mode.id ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}`}
                >
                  {mode.label}
                </button>
              ))}
              <button
                onClick={() => setShowModeTuning((prev) => !prev)}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-gray-500 transition hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                微调
              </button>
            </div>
          </div>

          {showModeTuning && (
            <div className="mt-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
              当前只保留 3 个模式入口：快速 / 标准 / 严格。更细参数先折叠，避免首页变复杂。
            </div>
          )}
        </header>

        <section className="mt-3 rounded-[22px] border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>{analysisMessage || '等待分析'}</span>
            <span className="text-gray-400">|</span>
            <span>{stats.total_groups || 0} 组</span>
            <span>{stats.to_remove || 0} 张待移除</span>
            <span>{stats.to_keep || 0} 张保留</span>
            <span className={`${pythonReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{backendState.message}</span>
            {analysisProgress.active && <span>{analysisProgress.stage} {analysisProgress.percent}%</span>}
            {undoFeedback && <span className={undoFeedback.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>{undoFeedback.message}</span>}
            {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          </div>
        </section>

        <main className="mt-4">
          <GroupGrid groups={groups} onGroupClick={handleGroupClick} />
        </main>
      </div>

      <ComparePanel
        open={comparePanel.open}
        group={groups.find((g) => g.id === comparePanel.group?.id) || comparePanel.group}
        selectedIndex={comparePanel.selectedIndex}
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
