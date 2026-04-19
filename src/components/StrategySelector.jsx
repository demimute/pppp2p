import React from 'react';

function StrategySelector({ strategies, selected, onSelect }) {
  const icons = {
    clip: '🧠',
    phash: '🔐',
    filesize: '📊',
    dual: '🛡️',
  };

  const labels = {
    clip: 'CLIP视觉',
    phash: '感知哈希',
    filesize: '文件大小',
    dual: '双保险',
  };

  const descriptions = {
    clip: '基于CLIP ViT-B/32视觉嵌入',
    phash: '基于pHash感知哈希算法',
    filesize: '按文件大小完全相同分组',
    dual: 'CLIP 与 pHash 双阈值同时满足',
  };

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        选择策略
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {strategies.map((strategy) => {
          const isSelected = selected === strategy.id;
          return (
            <button
              key={strategy.id}
              onClick={() => onSelect(strategy.id)}
              aria-pressed={isSelected}
              className={`
                relative p-4 rounded-xl border-2 text-left transition-all duration-200
                ${isSelected
                  ? 'border-primary bg-primary/10 dark:bg-primary/15 shadow-md shadow-primary/10 ring-2 ring-primary/20 ring-offset-2 dark:ring-offset-gray-900'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                }
              `}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-2xl">{icons[strategy.id]}</span>
                <div className={`
                  w-5 h-5 rounded-full border-2 flex items-center justify-center shadow-sm
                  ${isSelected 
                    ? 'border-primary bg-primary ring-2 ring-primary/30 ring-offset-2 dark:ring-offset-gray-800' 
                    : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
                  }
                `}>
                  {isSelected && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
              {isSelected && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-primary rounded-b-xl" />
              )}
              <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                {labels[strategy.id]}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {descriptions[strategy.id]}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default StrategySelector;
