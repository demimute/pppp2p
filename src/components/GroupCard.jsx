import React, { useState, useCallback } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

const SCENE_LABELS = {
  screenshot: '截图',
  burst: '连拍',
  chat: '聊天图片',
};

function GroupCard({ group, groupIndex, onClick, onToggleRemove, onApplyGroupAction }) {
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
  const defaultWinner = visibleMembers.find((member) => member.name === group.winner);
  const toRemoveCount = visibleMembers.filter((member) => member.to_remove).length;

  return (
    <div className="overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <span className="rounded-full bg-gray-900 px-2.5 py-1 text-xs font-semibold text-white dark:bg-white dark:text-gray-900">第 {groupIndex + 1} 组</span>
        {sceneLabel && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{sceneLabel}</span>}
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">{visibleMembers.length} 张</span>
        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">移除 {toRemoveCount}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">默认保留：{defaultWinner ? formatFileSize(defaultWinner.size || group.winner_size || 0) : '—'}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApplyGroupAction?.(group.id, 'keep_all')}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            全部保留
          </button>
          <button
            type="button"
            onClick={() => onApplyGroupAction?.(group.id, 'remove_all')}
            className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/20"
          >
            全部移除
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {visibleMembers.map((member, index) => {
            const isMarkedForRemoval = member.to_remove;
            const isHovered = hoveredIndex === index;

            return (
              <button
                key={member.name}
                type="button"
                className={`relative overflow-hidden rounded-[18px] border bg-gray-50 text-left transition border-gray-200 dark:border-gray-800 ${isHovered ? 'scale-[1.02] shadow-lg' : ''}`}
                onClick={() => onClick(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                aria-label={`${member.name}，当前状态${isMarkedForRemoval ? '移除' : '保留'}`}
              >
                <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-30">🖼️</span>
                  </div>
                  <img
                    src={toPreviewUrl(member.path || member.name)}
                    alt={member.name}
                    className={`absolute inset-0 h-full w-full object-cover ${brokenImages[member.name] ? 'hidden' : ''}`}
                    loading="lazy"
                    onError={() => setBrokenImages((prev) => ({ ...prev, [member.name]: true }))}
                  />

                  <span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[10px] font-semibold text-white ${isMarkedForRemoval ? 'bg-red-500' : 'bg-emerald-500'}`}>
                    {isMarkedForRemoval ? '移除' : '保留'}
                  </span>
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-full bg-gray-900/70 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-gray-900 dark:bg-white/20 dark:hover:bg-white/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleRemove?.(group.id, member.name);
                    }}
                  >
                    切换
                  </button>
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate text-xs font-medium text-gray-900 dark:text-white">{member.name}</p>
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
