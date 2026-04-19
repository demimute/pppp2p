import React, { useState, useEffect } from 'react';

const CONFIG = {
  clip: { min: 0.80, max: 0.99, step: 0.01, default: 0.93, label: '相似度', recommended: 0.93, marks: ['0.80', '0.90', '0.95', '0.99'] },
  phash: { min: 0, max: 20, step: 1, default: 10, label: 'Hamming距离', recommended: 10, inverted: true, marks: ['0', '5', '10', '20'] },
  dualClip: { min: 0.80, max: 0.99, step: 0.01, default: 0.92, label: 'CLIP相似度', recommended: 0.92, marks: ['0.80', '0.88', '0.92', '0.99'] },
  dualPHash: { min: 0, max: 20, step: 1, default: 10, label: 'pHash距离', recommended: 10, inverted: true, marks: ['0', '5', '10', '20'] },
};

function estimateStats(stats, currentValue, cfg) {
  if (!stats || !stats.total_groups) {
    return { to_remove: 0, to_keep: 0, groups: 0 };
  }

  const diff = Math.abs(currentValue - cfg.default);
  const factor = diff / (cfg.max - cfg.min);
  const toRemove = Math.max(0, Math.round(stats.to_remove * (1 - factor * 0.5)));

  return {
    to_remove: toRemove,
    to_keep: Math.max(0, stats.to_keep + (stats.to_remove - toRemove)),
    groups: Math.max(0, Math.round(stats.total_groups * (1 + factor * 0.3))),
  };
}

function renderSliderBlock({ cfg, value, onChange, formatter }) {
  const recommendationLeft = ((cfg.recommended - cfg.min) / (cfg.max - cfg.min)) * 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          阈值 ({cfg.label})
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-primary">{formatter(value)}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            ({cfg.min} ~ {cfg.max})
          </span>
        </div>
      </div>

      <div className="relative mb-4">
        <input
          type="range"
          min={cfg.min}
          max={cfg.max}
          step={cfg.step}
          value={value}
          onChange={onChange}
          className="w-full"
        />
        <div
          className="absolute top-6 transform -translate-x-1/2"
          style={{ left: `${recommendationLeft}%` }}
        >
          <div className="w-0.5 h-3 bg-yellow-500 absolute -top-3 left-1/2 transform -translate-x-1/2" />
          <span className="text-xs text-yellow-600 dark:text-yellow-400 whitespace-nowrap mt-1 block text-center">
            推荐
          </span>
        </div>
      </div>

      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mb-4 px-1">
        {cfg.marks.map((mark) => (
          <span key={mark}>{mark}</span>
        ))}
      </div>
    </div>
  );
}

function ThresholdSlider({ strategy, value, onChange, stats }) {
  const isDual = strategy === 'dual';
  const resolvedSingleValue = typeof value === 'number'
    ? value
    : CONFIG[strategy]?.default ?? CONFIG.clip.default;
  const resolvedDualValue = {
    clip: typeof value?.clip === 'number' ? value.clip : CONFIG.dualClip.default,
    phash: typeof value?.phash === 'number' ? value.phash : CONFIG.dualPHash.default,
  };
  const [localValue, setLocalValue] = useState(isDual ? resolvedDualValue : resolvedSingleValue);

  useEffect(() => {
    setLocalValue(isDual ? resolvedDualValue : resolvedSingleValue);
  }, [isDual, resolvedDualValue.clip, resolvedDualValue.phash, resolvedSingleValue]);

  if (isDual) {
    const clipValue = localValue?.clip ?? CONFIG.dualClip.default;
    const phashValue = localValue?.phash ?? CONFIG.dualPHash.default;
    const clipEstimate = estimateStats(stats, clipValue, CONFIG.dualClip);
    const phashEstimate = estimateStats(stats, phashValue, CONFIG.dualPHash);
    const estimated = {
      to_remove: Math.min(clipEstimate.to_remove, phashEstimate.to_remove),
      to_keep: Math.max(clipEstimate.to_keep, phashEstimate.to_keep),
      groups: Math.min(clipEstimate.groups, phashEstimate.groups) || stats.total_groups || 0,
    };

    return (
      <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
        <div className="space-y-6">
          {renderSliderBlock({
            cfg: CONFIG.dualClip,
            value: clipValue,
            onChange: (e) => {
              const nextValue = { clip: parseFloat(e.target.value), phash: phashValue };
              setLocalValue(nextValue);
              onChange(nextValue);
            },
            formatter: (current) => current.toFixed(2),
          })}

          {renderSliderBlock({
            cfg: CONFIG.dualPHash,
            value: phashValue,
            onChange: (e) => {
              const nextValue = { clip: clipValue, phash: parseInt(e.target.value, 10) };
              setLocalValue(nextValue);
              onChange(nextValue);
            },
            formatter: (current) => Math.round(current),
          })}
        </div>

        <div className="grid grid-cols-3 gap-3 mt-2">
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
            <p className="text-xs text-red-600 dark:text-red-400 mb-1">预估移除</p>
            <p className="text-xl font-bold text-red-600 dark:text-red-400">{estimated.to_remove || stats.to_remove || 0}</p>
            <p className="text-xs text-red-500 dark:text-red-500">张</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
            <p className="text-xs text-green-600 dark:text-green-400 mb-1">预估保留</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{estimated.to_keep || stats.to_keep || 0}</p>
            <p className="text-xs text-green-500 dark:text-green-500">张</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
            <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">分组数</p>
            <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{estimated.groups || stats.total_groups || 0}</p>
            <p className="text-xs text-blue-500 dark:text-blue-500">组</p>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          💡 双保险要求同时满足 CLIP相似度大于等于阈值，且 pHash距离小于等于阈值，两条条件一起通过才会进入相似组。
        </p>
      </div>
    );
  }

  const cfg = CONFIG[strategy] || CONFIG.clip;
  const estimated = estimateStats(stats, localValue ?? cfg.default, cfg);

  return (
    <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      {renderSliderBlock({
        cfg,
        value: localValue ?? cfg.default,
        onChange: (e) => {
          const nextValue = parseFloat(e.target.value);
          setLocalValue(nextValue);
          onChange(nextValue);
        },
        formatter: (current) => (strategy === 'clip' ? current.toFixed(2) : Math.round(current)),
      })}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 text-center">
          <p className="text-xs text-red-600 dark:text-red-400 mb-1">预估移除</p>
          <p className="text-xl font-bold text-red-600 dark:text-red-400">{estimated.to_remove || stats.to_remove || 0}</p>
          <p className="text-xs text-red-500 dark:text-red-500">张</p>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
          <p className="text-xs text-green-600 dark:text-green-400 mb-1">预估保留</p>
          <p className="text-xl font-bold text-green-600 dark:text-green-400">{estimated.to_keep || stats.to_keep || 0}</p>
          <p className="text-xs text-green-500 dark:text-green-500">张</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
          <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">分组数</p>
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{estimated.groups || stats.total_groups || 0}</p>
          <p className="text-xs text-blue-500 dark:text-blue-500">组</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        💡 {strategy === 'clip' ? '阈值越高越严格，只保留最相似的图片' : 'Hamming距离越小越严格，10为推荐值'}
      </p>
    </div>
  );
}

export default ThresholdSlider;
