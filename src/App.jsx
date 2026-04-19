import React, { useState, useEffect, useCallback, useRef } from 'react';
import FolderSelector from './components/FolderSelector.jsx';
import StrategySelector from './components/StrategySelector.jsx';
import ThresholdSlider from './components/ThresholdSlider.jsx';
import GroupGrid from './components/GroupGrid.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import { useApi } from './hooks/useApi.js';

const STRATEGIES = [
  { id: 'dual', name: '双保险', desc: 'CLIP ≥ 0.92 且 pHash ≤ 10 + 人物身份判别与姿态细化', threshold: null },
  { id: 'clip', name: 'CLIP视觉', desc: '基于CLIP ViT-B/32视觉嵌入', threshold: { min: 0.80, max: 0.99, default: 0.93, step: 0.01 } },
  { id: 'phash', name: '感知哈希', desc: '基于pHash感知哈希算法', threshold: { min: 0, max: 20, default: 10, step: 1, unit: 'Hamming距离' } },
  { id: 'filesize', name: '文件大小', desc: '按文件大小完全相同分组', threshold: null },
];

function App() {
  // Dark mode
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

  // App state
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [imageCount, setImageCount] = useState(0);
  const [selectedStrategy, setSelectedStrategy] = useState('dual');
  const [threshold, setThreshold] = useState(0.93);
  const [dualThreshold, setDualThreshold] = useState({ clip: 0.92, phash: 10 });
  const [groups, setGroups] = useState([]);
  // Keep a ref to current groups so handleCompareAction can read fresh state in callbacks
  const groupsRef = useRef(groups);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  const [stats, setStats] = useState({ total_groups: 0, to_remove: 0, to_keep: 0 });
  const [intelligence, setIntelligence] = useState(null);
  // Person enhancement for dual strategy: { enabled: boolean, weight: number 0-1 }
  const [personEnhance, setPersonEnhance] = useState({ enabled: true, weight: 0.5 });
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [undoFeedback, setUndoFeedback] = useState(null); // {type: 'error'|'success', message: string}
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pythonReady, setPythonReady] = useState(false);
  const [backendState, setBackendState] = useState({ running: false, source: 'unknown', message: '后端状态未知' });

  // Compare panel state
  const [comparePanel, setComparePanel] = useState({ open: false, group: null, selectedIndex: 0 });

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState({ open: false, group: null });

  // History state
  const [history, setHistory] = useState([]);
  const [isRemoving, setIsRemoving] = useState(false);

  const { post, get, loading, error } = useApi();

  // Listen for python ready
  useEffect(() => {
    const initBackendState = async () => {
      if (!window.electronAPI) {
        // Plain Vite dev mode: backend is expected to be started separately.
        setPythonReady(true);
        return;
      }

      window.electronAPI.onPythonReady((payload) => {
        console.log('Python backend ready', payload);
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
    const strategyConfig = STRATEGIES.find((s) => s.id === selectedStrategy);
    if (strategyConfig?.threshold) {
      setThreshold(strategyConfig.threshold.default);
    } else if (selectedStrategy === 'dual') {
      setDualThreshold({ clip: 0.92, phash: 10 });
    }
    setAnalysisMessage('');
    setIntelligence(null);
  }, [selectedStrategy]);

  // Fetch history on mount
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

  const scanFolder = async (folder) => {
    const result = await post('/api/scan', { folder });
    if (result) {
      setImageCount(result.total || 0);
      setAnalysisMessage(`已扫描 ${result.total || 0} 张图片`);
    }
  };

  const handleStartAnalysis = async ({ overrideThreshold } = {}) => {
    if (!selectedFolder) return;

    closeComparePanel();

    setIsAnalyzing(true);
    setAnalysisMessage('');
    try {
      const currentStrategy = STRATEGIES.find((s) => s.id === selectedStrategy);
      const thresholdValue = selectedStrategy === 'dual'
        ? {
            clip: overrideThreshold?.clip ?? dualThreshold.clip,
            phash: overrideThreshold?.phash ?? dualThreshold.phash,
          }
        : (typeof overrideThreshold === 'number' ? overrideThreshold : threshold ?? currentStrategy?.threshold?.default);

      const scanResult = await post('/api/scan', { folder: selectedFolder });
      const images = scanResult?.images?.map((img) => img.name) || [];

      if (selectedStrategy === 'clip' || selectedStrategy === 'dual') {
        await post('/api/embed', { folder: selectedFolder, images });
      }
      if (selectedStrategy === 'phash' || selectedStrategy === 'dual') {
        await post('/api/hash', { folder: selectedFolder, images });
      }

      const result = await post('/api/groups', {
        folder: selectedFolder,
        strategy: selectedStrategy,
        threshold: selectedStrategy === 'dual' ? thresholdValue.clip : thresholdValue,
        clip_threshold: selectedStrategy === 'dual' ? thresholdValue.clip : undefined,
        phash_threshold: selectedStrategy === 'dual' ? thresholdValue.phash : undefined,
        enhanced_persona: selectedStrategy === 'dual' ? personEnhance.enabled : undefined,
        identity_penalty_strength: selectedStrategy === 'dual'
          ? Number(personEnhance.weight ?? 0.5)
          : undefined,
        loose_threshold: 0.85,
      });

      if (result) {
        const nextGroups = result.groups || [];
        const nextStats = result.stats || { total_groups: 0, to_remove: 0, to_keep: 0 };
        setGroups(nextGroups);
        setStats(nextStats);
        setIntelligence(result.intelligence || null);
        setAnalysisMessage(
          nextGroups.length > 0
            ? `已找到 ${nextStats.total_groups} 组相似照片，待移除 ${nextStats.to_remove} 张`
            : '没有发现符合当前策略的相似组'
        );
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setAnalysisMessage('分析失败，请检查后端状态或目录权限');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleThresholdChange = (newThreshold) => {
    if (selectedStrategy === 'dual') {
      setDualThreshold(newThreshold);
    } else {
      setThreshold(newThreshold);
    }
    // Note: threshold-only change does NOT trigger re-analysis.
    // The ThresholdSlider shows locally-computed estimates.
    // Clear stale analysis message so user isn't misled.
    setAnalysisMessage('');
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

    setGroups(prev => {
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
      setUndoFeedback({ type: 'error', message: 'Winner 不能标记为移除，请保留至少 1 张照片' });
    }

    if (shouldClosePanel) {
      closeComparePanel();
      return;
    }

    setComparePanel((prev) => ({ ...prev, selectedIndex: nextSelectedIndex }));
  };

  const handleCompareSkip = () => {
    const { group, selectedIndex } = comparePanel;
    if (selectedIndex < group.members.length - 1) {
      setComparePanel(prev => ({ ...prev, selectedIndex: prev.selectedIndex + 1 }));
    } else {
      setComparePanel({ open: false, group: null, selectedIndex: 0 });
    }
  };

  const handleCompareNavigate = (index) => {
    setComparePanel(prev => ({ ...prev, selectedIndex: index }));
  };

  const applyAlternativeThreshold = async (altThreshold) => {
    if (selectedStrategy === 'dual') {
      return;
    }

    setThreshold(altThreshold);
    setAnalysisMessage(`已切换到备选阈值 ${altThreshold}，正在重新分析...`);
    await handleStartAnalysis({ overrideThreshold: altThreshold });
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
      // Undo failed (e.g., nothing to undo, or backend error)
      setUndoFeedback({
        type: 'error',
        message: result?.error || '撤销失败，无可恢复的操作',
      });
    }
  };

  const handleExecuteRemove = async () => {
    if (!selectedFolder || isRemoving) return;

    const moves = groups
      .flatMap(g => g.members)
      .filter(m => m.to_remove)
      .map(m => ({ name: m.name, action: 'remove' }));

    if (moves.length === 0) {
      setAnalysisMessage('当前没有已标记为移除的照片');
      setConfirmDialog({ open: false, group: null });
      return;
    }

    const removedNames = new Set(moves.map((move) => move.name));

    setIsRemoving(true);
    setAnalysisMessage('正在执行移除...');

    try {
      const strategyThreshold = selectedStrategy === 'dual' ? dualThreshold.clip : threshold;
      const result = await post('/api/move', {
        folder: selectedFolder,
        strategy: selectedStrategy,
        threshold: strategyThreshold,
        moves,
      });

      if (result?.success) {
        const nextGroups = groups
          .map((group) => {
            const remainingMembers = group.members.filter((member) => !removedNames.has(member.name));
            if (remainingMembers.length < 2) {
              return null;
            }

            const nextWinner = remainingMembers.some((member) => member.name === group.winner)
              ? group.winner
              : remainingMembers[0].name;

            return {
              ...group,
              winner: nextWinner,
              winner_size: remainingMembers.find((member) => member.name === nextWinner)?.size || group.winner_size,
              members: remainingMembers.map((member) => ({ ...member, to_remove: false })),
            };
          })
          .filter(Boolean);

        const remainingImageCount = Math.max(0, imageCount - moves.length);
        const remainingMarked = nextGroups.reduce(
          (count, group) => count + group.members.filter((member) => member.to_remove).length,
          0,
        );

        setGroups(nextGroups);
        setStats({
          total_groups: nextGroups.length,
          to_remove: remainingMarked,
          to_keep: Math.max(0, remainingImageCount - remainingMarked),
        });
        setImageCount(remainingImageCount);
        setConfirmDialog({ open: false, group: null });
        closeComparePanel();
        setUndoFeedback({ type: 'success', message: `已移除 ${result.moved ?? moves.length} 张照片` });
        setAnalysisMessage(
          nextGroups.length > 0
            ? `已找到 ${nextGroups.length} 组相似照片，待移除 ${remainingMarked} 张`
            : '没有发现符合当前策略的相似组'
        );
        await fetchHistory();
      } else {
        setUndoFeedback({ type: 'error', message: result?.error || '执行移除失败' });
        setAnalysisMessage(result?.error || '执行移除失败');
      }
    } catch (err) {
      setUndoFeedback({ type: 'error', message: err.message || '执行移除失败' });
      setAnalysisMessage(err.message || '执行移除失败');
    } finally {
      setIsRemoving(false);
    }
  };

  const closeComparePanel = () => {
    setComparePanel({ open: false, group: null, selectedIndex: 0 });
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center">
            <span className="text-white text-lg">🔍</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">DedupStudio</h1>
          <span
            className={`badge ${pythonReady ? (backendState.source === 'external' ? 'badge-warning' : 'badge-success') : 'badge-warning'}`}
            title={backendState.message}
          >
            {pythonReady
              ? backendState.source === 'external'
                ? '已接管现有后端'
                : '内置后端已就绪'
              : '后端启动中...'}
          </span>
        </div>
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title={darkMode ? '切换到浅色模式' : '切换到深色模式'}
        >
          {darkMode ? (
            <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-6">
        {/* Folder Selector */}
        <FolderSelector
          selectedFolder={selectedFolder}
          imageCount={imageCount}
          onSelect={handleSelectFolder}
          onDrop={handleDrop}
          onClear={() => {
            setSelectedFolder(null);
            setImageCount(0);
            setGroups([]);
            setStats({ total_groups: 0, to_remove: 0, to_keep: 0 });
            setIntelligence(null);
            setAnalysisMessage('');
            setConfirmDialog({ open: false, group: null });
            closeComparePanel();
          }}
        />

        {/* Strategy Selector */}
        <StrategySelector
          strategies={STRATEGIES}
          selected={selectedStrategy}
          onSelect={setSelectedStrategy}
        />

        {/* Threshold Slider (only for CLIP and pHash) */}
        {(selectedStrategy === 'clip' || selectedStrategy === 'phash' || selectedStrategy === 'dual') && (
          <ThresholdSlider
            key={`threshold-${selectedStrategy}`}
            strategy={selectedStrategy}
            value={selectedStrategy === 'dual' ? dualThreshold : threshold}
            onChange={handleThresholdChange}
            stats={stats}
          />
        )}

        {/* Person Disambiguation Controls - shown only for dual strategy */}
        {selectedStrategy === 'dual' && (
          <div className="mb-6 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl p-5 border border-purple-200 dark:border-purple-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                  🧑 人物判别
                </h3>
                <p className="text-xs text-purple-500 dark:text-purple-400 mt-1">
                  减少不同人物误判为同组 &bull; 同人后再结合动作姿态细化判定
                </p>
              </div>
              <button
                onClick={() => setPersonEnhance(prev => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                  personEnhance.enabled ? 'bg-purple-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
                aria-pressed={personEnhance.enabled}
                data-testid="person-enhance-toggle"
              >
                <span
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
                    personEnhance.enabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Two-phase controls - only when enabled */}
            <div className={personEnhance.enabled ? '' : 'opacity-50 pointer-events-none'}>

              {/* Different-person suppression */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-purple-600 dark:text-purple-300">不同人物强抑制</span>
                  <span className="text-sm font-bold text-purple-600 dark:text-purple-300">
                    {personEnhance.weight < 0.3 ? '弱' : personEnhance.weight < 0.7 ? '中' : '强'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={personEnhance.weight}
                  onChange={(e) => setPersonEnhance(prev => ({ ...prev, weight: parseFloat(e.target.value) }))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #a855f7 0%, #6366f1 50%, #8b5cf6 100%)`,
                  }}
                  aria-label="不同人物强抑制强度"
                />
                <div className="flex justify-between text-xs text-purple-400 mt-1">
                  <span>弱</span>
                  <span>中</span>
                  <span>强</span>
                </div>
              </div>

              {/* Same-person pose refinement is automatic until Phase 2 is implemented */}
              <div className="rounded-lg border border-dashed border-purple-200 bg-white/70 px-4 py-3 dark:border-purple-800/70 dark:bg-slate-900/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-purple-600 dark:text-purple-300">同人姿态精细判定</span>
                  <span className="text-xs text-purple-400">
                    {personEnhance.enabled ? '系统内置规则' : '需开启判别'}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  当前不提供单独调节。仅在已判定为同一人物后，系统才会自动参考姿态接近度做细化判断。
                </p>
                <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  这一步只用于同人后的细排，不会单独放行异人入组。
                </div>
              </div>

            </div>

            <p className="mt-3 text-xs text-purple-400 dark:text-purple-500">
              💡 人物身份判别引擎在两张图都含人物时判断是否为同一人。不同人时强降分，同一人时结合姿态信号细化判定，避免误合并。
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => handleStartAnalysis()}
            disabled={!selectedFolder || isAnalyzing || !pythonReady}
            className="btn btn-primary flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <span className="spinner"></span>
                <span>分析中...</span>
              </>
            ) : (
              <>
                <span>🚀</span>
                <span>开始分析</span>
              </>
            )}
          </button>
          
          {groups.length > 0 && (
            <button
              onClick={() => setConfirmDialog({ open: true, group: null })}
              disabled={stats.to_remove === 0 || isRemoving}
              className="btn btn-danger flex items-center gap-2"
            >
              <span>🗑️</span>
              <span>{isRemoving ? '移除中...' : `执行移除 (${stats.to_remove}张)`}</span>
            </button>
          )}
        </div>

        <div className={`mt-6 rounded-xl border px-4 py-3 text-sm ${pythonReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'}`}>
          后端状态：{backendState.message}
        </div>

        {(analysisMessage || error) && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300'}`}>
            {error || analysisMessage}
          </div>
        )}

        {undoFeedback && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${undoFeedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300' : 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300'}`}>
            {undoFeedback.type === 'error' ? '⚠️ ' : '✓ '}{undoFeedback.message}
          </div>
        )}

        {intelligence && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className="text-xs text-gray-500 dark:text-gray-400">推荐阈值</div>
                <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {selectedStrategy === 'dual'
                    ? `${dualThreshold.clip.toFixed(2)} / ${Math.round(dualThreshold.phash)}`
                    : intelligence.recommended_threshold}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className="text-xs text-gray-500 dark:text-gray-400">建议策略</div>
                <div className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
                  {selectedStrategy === 'dual' && personEnhance.enabled
                    ? '双保险 + 人物身份判别'
                    : (intelligence.suggested_strategy || 'clip')}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <div className="text-xs text-gray-500 dark:text-gray-400">推荐原因</div>
                <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {selectedStrategy === 'dual'
                    ? personEnhance.enabled
                      ? `双保险 + 人物身份判别（抑制强度 ${Math.round(personEnhance.weight * 100)}%），CLIP 与 pHash 双阈值同时满足，同时启用人物身份甄别与姿态细化。`
                      : '双保险要求 CLIP 相似度与 pHash 距离两条阈值同时满足，适合对误删更敏感的场景。'
                    : intelligence.reason}
                </div>
              </div>
            </div>
            {selectedStrategy !== 'dual' && intelligence.alternatives && intelligence.alternatives.length > 0 && (
              <details className="mt-3 rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
                <summary className="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
                  备选阈值方案 ({intelligence.alternatives.length} 个)
                </summary>
                <div className="border-t border-gray-100 dark:border-gray-700 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-700/50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">阈值</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">组数</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">预估移除</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">平均组大小</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {intelligence.alternatives.map((alt, i) => (
                        <tr
                          key={i}
                          onClick={() => applyAlternativeThreshold(alt.threshold)}
                          className={`cursor-pointer transition-colors ${alt.threshold === threshold ? 'bg-primary/10 dark:bg-primary/20' : alt.threshold === intelligence.recommended_threshold ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`}
                        >
                          <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{alt.threshold}{alt.threshold === threshold ? ' · 当前' : ''}</td>
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{alt.group_count}</td>
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{alt.to_remove}</td>
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{alt.avg_group_size}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}

        {/* Group Grid */}
        {groups.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              相似组预览 ({groups.length} 组)
            </h2>
            <GroupGrid
              groups={groups}
              onGroupClick={handleGroupClick}
              selectedStrategy={selectedStrategy}
            />
          </div>
        )}
      </main>

      {/* History Panel */}
      <HistoryPanel
        history={history}
        onUndo={handleUndo}
      />

      {/* Compare Panel */}
      <ComparePanel
        open={comparePanel.open}
        group={comparePanel.group}
        selectedIndex={comparePanel.selectedIndex}
        folder={selectedFolder}
        onClose={closeComparePanel}
        onAction={handleCompareAction}
        onSkip={handleCompareSkip}
        onNavigate={handleCompareNavigate}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDialog.open}
        groups={groups}
        stats={stats}
        onConfirm={handleExecuteRemove}
        onCancel={() => setConfirmDialog({ open: false, group: null })}
      />
    </div>
  );
}

export default App;
