import React, { useState, useCallback } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

function GroupCard({ group, groupIndex, onClick, selectedStrategy }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [brokenImages, setBrokenImages] = useState({});

  const handleKeyDown = useCallback((e, memberIndex) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(memberIndex);
    }
  }, [onClick]);

  const getSimilarityLabel = (member, strategy) => {
    if (strategy === 'clip') {
      return `${(member.similarity * 100).toFixed(1)}%`;
    }
    if (strategy === 'phash') {
      return `距离 ${member.hamming_distance ?? 0}`;
    }
    if (strategy === 'dual') {
      return `${(member.similarity * 100).toFixed(1)}% · 距离 ${member.hamming_distance ?? 0}`;
    }
    return `${(member.similarity * 100).toFixed(1)}%`;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const visibleMembers = group.members.filter((member) => {
    if (!member?.name) return false;
    if (member.removed || member.hidden) return false;
    return !!(member.path || member.name);
  });

  if (visibleMembers.length < 2) {
    return null;
  }

  const toRemoveCount = visibleMembers.filter((member) => member.to_remove).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Group header */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="bg-primary/10 text-primary text-sm font-semibold px-2 py-0.5 rounded">
            第{groupIndex + 1}组
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {visibleMembers.length} 张相似
          </span>
          {group.winner_size && (
            <span className="text-xs text-gray-500 dark:text-gray-500">
              Winner: {formatFileSize(group.winner_size)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {toRemoveCount > 0 && (
            <span className="badge badge-danger">
              {toRemoveCount} 张待移除
            </span>
          )}
        </div>
      </div>

      {/* Thumbnails */}
      <div className="p-4">
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {visibleMembers.map((member, index) => {
            const isWinner = member.name === group.winner;
            const isMarkedForRemoval = member.to_remove;
            const isHovered = hoveredIndex === index;

            return (
              <div
                key={member.name}
                className={`
                  relative group rounded-lg overflow-hidden cursor-pointer
                  transition-all duration-200
                  ${isWinner ? 'ring-2 ring-green-500 ring-offset-2' : ''}
                  ${isMarkedForRemoval ? 'opacity-60' : ''}
                  ${isHovered ? 'scale-105 shadow-lg z-10' : ''}
                `}
                onClick={() => onClick(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                tabIndex={0}
                role="button"
                aria-label={`${member.name}, 相似度 ${getSimilarityLabel(member, selectedStrategy)}${isWinner ? ', Winner' : ''}`}
              >
                {/* Thumbnail */}
                <div className="aspect-square bg-gray-100 dark:bg-gray-700 relative overflow-hidden">
                  {/* Placeholder image */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl opacity-30">
                      {isWinner ? '✓' : '🖼️'}
                    </span>
                  </div>
                  {/* In real app, this would be an actual image */}
                  <img
                    src={toPreviewUrl(member.path || member.name)}
                    alt={member.name}
                    className={`absolute inset-0 w-full h-full object-cover ${brokenImages[member.name] ? 'hidden' : ''}`}
                    loading="lazy"
                    onError={() => {
                      setBrokenImages((prev) => ({ ...prev, [member.name]: true }));
                    }}
                  />

                  {/* Overlay on hover */}
                  <div className={`
                    absolute inset-0 bg-black/50 flex items-center justify-center
                    transition-opacity duration-200
                    ${isHovered ? 'opacity-100' : 'opacity-0'}
                  `}>
                    <span className="text-white text-xs">点击查看</span>
                  </div>

                  {/* Winner badge */}
                  {isWinner && (
                    <div className="absolute top-1 left-1 bg-green-500 text-white text-xs px-1.5 py-0.5 rounded font-medium">
                      ✓ Winner
                    </div>
                  )}

                  {/* Remove badge */}
                  {isMarkedForRemoval && (
                    <div className="absolute top-1 right-1 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded font-medium">
                      ×
                    </div>
                  )}

                  {/* Persona similarity badge - shown when dual/persona enhancement returns data */}
                  {member.persona_similarity !== undefined && member.persona_similarity > 0 && (
                    <div className="absolute bottom-1 left-1 bg-purple-500 text-white text-xs px-1 py-0.5 rounded font-medium opacity-80">
                      🧑 {Math.round(member.persona_similarity * 100)}%
                    </div>
                  )}
                </div>

                {/* Similarity label */}
                <div className="p-1.5 bg-gray-50 dark:bg-gray-700/50 text-center">
                  <span className={`
                    text-xs font-medium
                    ${isWinner ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}
                  `}>
                    {getSimilarityLabel(member, selectedStrategy)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default GroupCard;
