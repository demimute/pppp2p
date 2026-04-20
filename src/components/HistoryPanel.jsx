import React from 'react';

function HistoryPanel({ history, onUndo }) {
  const formatTime = (timeStr) => {
    const date = new Date(timeStr);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const getStrategyLabel = (strategy) => {
    const labels = {
      clip: 'CLIP',
      phash: 'pHash',
      filesize: '文件',
      dual: '双保险',
    };
    return labels[strategy] || strategy;
  };

  if (!history || history.length === 0) {
    return null;
  }

  const latestEntry = history[0];

  return (
    <div className="sticky bottom-0 left-0 right-0 z-20 mt-6 bg-white/95 dark:bg-gray-800/95 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl py-3 px-4 shadow-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400 text-sm">最近操作</span>
          
          {latestEntry && (
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-1.5">
              {latestEntry.undone ? (
                <>
                  <span className="text-yellow-500">↩️</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {formatTime(latestEntry.time)}
                  </span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-sm text-yellow-600 dark:text-yellow-400">
                    已撤销
                  </span>
                </>
              ) : (
                <>
                  <span className="text-green-500">✓</span>
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {formatTime(latestEntry.time)}
                  </span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {getStrategyLabel(latestEntry.strategy)}
                  </span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                    移除 {latestEntry.removed} 张
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* History dropdown preview (optional, simplified here) */}
        {history.length > 1 && (
          <div className="text-xs text-gray-400 dark:text-gray-500">
            共 {history.length} 条记录
          </div>
        )}

        <div className="flex-1" />

        {/* Undo button */}
        {latestEntry && !latestEntry.undone && (
          <button
            onClick={onUndo}
            className="btn btn-secondary text-sm flex items-center gap-1"
          >
            <span>↩️</span>
            <span>撤销</span>
          </button>
        )}
      </div>

      {/* Expanded history list (optional hover/click expansion) */}
      {history.length > 1 && (
        <div className="mt-2 max-h-28 overflow-y-auto pt-2 border-t border-gray-100 dark:border-gray-700">
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 5).map((entry, index) => (
              <div 
                key={entry.id || index}
                className={`text-xs rounded px-2 py-1 ${entry.undone ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-400'}`}
              >
                {formatTime(entry.time)}: {entry.undone ? '已撤销' : `${getStrategyLabel(entry.strategy)} 移除 ${entry.removed} 张`}
              </div>
            ))}
            {history.length > 5 && (
              <div className="text-xs text-gray-400 dark:text-gray-500 px-2 py-1">
                ...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryPanel;
