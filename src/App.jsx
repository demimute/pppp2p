import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import GroupGrid from './components/GroupGrid.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { useApi } from './hooks/useApi.js';

const MODE_PRESETS = {
  relaxed: {
    id: 'relaxed',
    label: '宽松',
    strategy: 'dual',
    threshold: 0.9,
    clipThreshold: 0.9,
    phashThreshold: 12,
    identityPenaltyStrength: 0.3,
    identityDiffThreshold: 0.72,
    looseThreshold: 0.8,
  },
  standard: {
    id: 'standard',
    label: '标准',
    strategy: 'dual',
    threshold: 0.92,
    clipThreshold: 0.92,
    phashThreshold: 10,
    identityPenaltyStrength: 0.55,
    identityDiffThreshold: 0.8,
    looseThreshold: 0.85,
  },
  strict: {
    id: 'strict',
    label: '严格',
    strategy: 'dual',
    threshold: 0.94,
    clipThreshold: 0.94,
    phashThreshold: 8,
    identityPenaltyStrength: 0.85,
    identityDiffThreshold: 0.88,
    looseThreshold: 0.88,
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function SliderControl({ label, value, min, max, step, onChange, format }) {
  return (
    <label className="flex min-w-[180px] flex-1 flex-col gap-1 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/80">
      <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>{label}</span>
        <span className="font-medium text-gray-700 dark:text-gray-200">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-sky-500 dark:bg-gray-800"
      />
    </label>
  );
}

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
  const [showModeTuning, setShowModeTuning] = useState(true);
  const [tuning, setTuning] = useState(MODE_PRESETS.standard);
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

  useEffect(() => {
    setTuning({ ...MODE_PRESETS[selectedMode] });
  }, [selectedMode]);

  const progressWidth = useMemo(() => `${analysisProgress.percent}%`, [analysisProgress.percent]);

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

  const handleTuningChange = (key, value) => {
    setTuning((prev) => ({ ...prev, [key]: value }));
  };

  const handleStartAnalysis = async () => {
    if (!selectedFolder) return;

    closeComparePanel();

    setIsAnalyzing(true);
    setAnalysisMessage('');
    setAnalysisProgress({ active: true, percent: 5, stage: '准备分析' });

    try {
      setAnalysisProgress({ active: true, percent: 15, stage: '扫描照片' });
      const scanResult = await post('/api/scan', { folder: selectedFolder });
      const images = scanResult?.images?.map((img) => img.name) || [];

      if (tuning.strategy === 'dual') {
        setAnalysisProgress({ active: true, percent: 40, stage: '提取特征' });
        await post('/api/embed', { folder: selectedFolder, images });
        setAnalysisProgress({ active: true, percent: 65, stage: '计算哈希' });
        await post('/api/hash', { folder: selectedFolder, images });
      }

      setAnalysisProgress({ active: true, percent: 85, stage: '生成分组' });
      const result = await post('/api/groups', {
        folder: selectedFolder,
        strategy: tuning.strategy,
        threshold: tuning.clipThreshold,
        clip_threshold: tuning.clipThreshold,
        phash_threshold: tuning.phashThreshold,
        enhanced_persona: true,
        identity_penalty_strength: tuning.identityPenaltyStrength,
        identity_diff_threshold: tuning.identityDiffThreshold,
        loose_threshold: tuning.looseThreshold,
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
      }, 800);
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

  const persistWinnerPreference = async (groupMembers, memberName) => {
    if (!selectedFolder || !groupMembers?.length || !memberName) return;
    await post('/api/preferences/winner', {
      folder: selectedFolder,
      members: groupMembers.map((m) => m.name),
      winner: memberName,
    });
  };

  const recalcStatsFromGroups = (nextGroups) => {
    const toRemove = nextGroups.flatMap((g) => g.members).filter((m) => m.to_remove).length;
    setStats((prevStats) => ({
      ...prevStats,
      to_remove: toRemove,
      to_keep: Math.max(imageCount - toRemove, 0),
    }));
  };

  const handleSetWinnerFromGrid = async (groupId, memberName) => {
    const targetGroup = groupsRef.current.find((g) => g.id === groupId);
    if (!targetGroup || !memberName) return;
    const nextGroups = groupsRef.current.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        winner: memberName,
        winner_size: g.members.find((m) => m.name === memberName)?.size || g.winner_size,
        members: g.members.map((m) => ({ ...m, to_remove: m.name === memberName ? false : m.to_remove })),
      };
    });
    setGroups(nextGroups);
    recalcStatsFromGroups(nextGroups);
    await persistWinnerPreference(targetGroup.members, memberName);
  };

  const handleToggleRemoveFromGrid = (groupId, memberName) => {
    const nextGroups = groupsRef.current.map((g) => {
      if (g.id !== groupId) return g;
      return {
        ...g,
        members: g.members.map((m) => {
          if (m.name !== memberName) return m;
          if (m.name === g.winner) return { ...m, to_remove: false };
          return { ...m, to_remove: !m.to_remove };
        }),
      };
    });
    setGroups(nextGroups);
    recalcStatsFromGroups(nextGroups);
  };

  const handlePromoteOptimal = async (memberName) => {
    if (!memberName || !comparePanel.group) return;
    await handleSetWinnerFromGrid(comparePanel.group.id, memberName);
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
        strategy: tuning.strategy,
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

          <div className="mt-3 flex flex-col gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-200">{selectedFolder ? '已选' : '未选择'}</span>
                {selectedFolder ? `：${selectedFolder}` : ''}
                {imageCount ? ` · ${imageCount} 张` : ''}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {Object.values(MODE_PRESETS).map((mode) => (
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
                  {showModeTuning ? '收起微调' : '展开微调'}
                </button>
              </div>
            </div>

            {showModeTuning && (
              <div className="flex flex-wrap gap-3">
                <SliderControl label="CLIP 阈值" value={tuning.clipThreshold} min={0.8} max={0.99} step={0.01} onChange={(value) => handleTuningChange('clipThreshold', clamp(value, 0.8, 0.99))} format={(value) => value.toFixed(2)} />
                <SliderControl label="Hash 阈值" value={tuning.phashThreshold} min={4} max={16} step={1} onChange={(value) => handleTuningChange('phashThreshold', clamp(value, 4, 16))} />
                <SliderControl label="人物惩罚" value={tuning.identityPenaltyStrength} min={0} max={1.2} step={0.05} onChange={(value) => handleTuningChange('identityPenaltyStrength', clamp(value, 0, 1.2))} format={(value) => value.toFixed(2)} />
                <SliderControl label="人物差异阈值" value={tuning.identityDiffThreshold} min={0.5} max={0.95} step={0.01} onChange={(value) => handleTuningChange('identityDiffThreshold', clamp(value, 0.5, 0.95))} format={(value) => value.toFixed(2)} />
                <SliderControl label="边缘并组" value={tuning.looseThreshold} min={0.7} max={0.95} step={0.01} onChange={(value) => handleTuningChange('looseThreshold', clamp(value, 0.7, 0.95))} format={(value) => value.toFixed(2)} />
              </div>
            )}

            {analysisProgress.active && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{analysisProgress.stage}</span>
                  <span>{analysisProgress.percent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div className="h-full rounded-full bg-sky-500 transition-all duration-300" style={{ width: progressWidth }} />
                </div>
              </div>
            )}
          </div>
        </header>

        <section className="mt-3 rounded-[22px] border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span>{analysisMessage || '等待分析'}</span>
            <span className="text-gray-400">|</span>
            <span>{stats.total_groups || 0} 组</span>
            <span>{stats.to_remove || 0} 张待移除</span>
            <span>{stats.to_keep || 0} 张保留</span>
            <span className={`${pythonReady ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{backendState.message}</span>
            {undoFeedback && <span className={undoFeedback.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>{undoFeedback.message}</span>}
            {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
          </div>
        </section>

        <main className="mt-4">
          <GroupGrid groups={groups} onGroupClick={handleGroupClick} onToggleRemove={handleToggleRemoveFromGrid} onSetWinner={handleSetWinnerFromGrid} />
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
