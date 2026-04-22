import React, { useState, useCallback } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

const SCENE_LABELS = {
  screenshot: '截图',
  burst: '连拍',
  chat: '聊天图片',
};

function GroupCard({ group, groupIndex, onClick }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [brokenImages, setBrokenImages] = useState({});

  const handleKeyDown = useCallback((e, memberIndex) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(memberIndex);
    }
  }, [onClick]);

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const visibleMembers = (group.members || []).filter((member) => {
    if (!member?.name) return false;
    if (member.removed || member.hidden) return false;
    return !!(member.path || member.name);
  });

  if (visibleMembers.length < 2) {
    return null;
  }

  const sceneLabel = SCENE_LABELS[group.group_scene_type] || null;
  const winner = visibleMembers.find((member) => member.name === group.winner);
  const toRemoveCount = visibleMembers.filter((member) => member.to_remove).length;

  return (
    <div className="overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              第 {groupIndex + 1} 组
            </span>
            {sceneLabel && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {sceneLabel}
              </span>
            )}
            {toRemoveCount > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                建议移除 {toRemoveCount} 张
              </span>
            )}
          </div>
          <p className="mt-3 text-base font-semibold text-gray-900 dark:text-white">
            {visibleMembers.length} 张相似照片，建议保留 1 张
          </p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {winner ? `当前保留：${winner.name}` : '点击任意照片查看并调整保留项'}
          </p>
        </div>

        <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-gray-950/40 dark:text-gray-300">
          <div>保留项大小：<span className="font-semibold text-gray-900 dark:text-white">{winner ? formatFileSize(winner.size || group.winner_size || 0) : '—'}</span></div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">点击图片进入详情，改保留项或接受建议。</div>
        </div>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {visibleMembers.map((member, index) => {
            const isWinner = member.name === group.winner;
            const isMarkedForRemoval = member.to_remove;
            const isHovered = hoveredIndex === index;

            return (
              <button
                key={member.name}
                type="button"
                className={`relative overflow-hidden rounded-[22px] border bg-gray-50 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-gray-950/30 ${isWinner ? 'border-emerald-400 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]' : 'border-gray-200 dark:border-gray-800'} ${isMarkedForRemoval ? 'opacity-75' : ''} ${isHovered ? 'scale-[1.02] shadow-lg' : ''}`}
                onClick={() => onClick(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                aria-label={`${member.name}${isWinner ? '，当前保留项' : ''}`}
              >
                <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-30">{isWinner ? '✓' : '🖼️'}</span>
                  </div>
                  <img
                    src={toPreviewUrl(member.path || member.name)}
                    alt={member.name}
                    className={`absolute inset-0 h-full w-full object-cover ${brokenImages[member.name] ? 'hidden' : ''}`}
                    loading="lazy"
                    onError={() => setBrokenImages((prev) => ({ ...prev, [member.name]: true }))}
                  />

                  {isWinner && (
                    <div className="absolute left-2 top-2 rounded-full bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white">
                      保留
                    </div>
                  )}

                  {isMarkedForRemoval && (
                    <div className="absolute right-2 top-2 rounded-full bg-red-500 px-2 py-1 text-[11px] font-semibold text-white">
                      移除
                    </div>
                  )}
                </div>

                <div className="px-3 py-3">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{member.name}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatFileSize(member.size || 0)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default GroupCard;
