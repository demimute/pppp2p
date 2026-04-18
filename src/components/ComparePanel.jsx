import React, { useEffect, useCallback } from 'react';

function ComparePanel({ open, group, selectedIndex, folder, onClose, onAction, onSkip, onNavigate }) {
  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!open || !group) return;

    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowRight') {
      if (selectedIndex < group.members.length - 1) {
        onNavigate(selectedIndex + 1);
      }
    } else if (e.key === 'ArrowLeft') {
      if (selectedIndex > 0) {
        onNavigate(selectedIndex - 1);
      }
    } else if (e.key === 'k' || e.key === 'K') {
      // Keep
      onAction('keep');
    } else if (e.key === 'r' || e.key === 'R') {
      // Remove
      onAction('remove');
    } else if (e.key === 's' || e.key === 'S') {
      // Skip
      onSkip();
    }
  }, [open, group, selectedIndex, onClose, onAction, onSkip, onNavigate]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open || !group) {
    return null;
  }

  const selectedImage = group.members[selectedIndex];
  const winnerImage = group.members.find(m => m.name === group.winner);

  if (!selectedImage || !winnerImage) {
    return null;
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getSimilarityText = (member) => {
    if (member.similarity !== undefined) {
      return `${(member.similarity * 100).toFixed(1)}%`;
    }
    if (member.hamming_distance !== undefined) {
      return `Hamming距离: ${member.hamming_distance}`;
    }
    return 'Unknown';
  };

  const getSizeDeltaText = (currentSize, winnerSize) => {
    if (!currentSize || !winnerSize) return 'Unknown';

    const deltaBytes = Math.abs(currentSize - winnerSize);
    const deltaPercent = winnerSize > 0 ? (deltaBytes / winnerSize) * 100 : 0;

    // Show bytes only for very small differences (< 1KB)
    if (deltaBytes < 1024) {
      return `${deltaBytes} B`;
    }

    // For larger differences, show percentage (more meaningful for similarity comparison)
    // Use a short label to avoid semantic confusion
    return `${deltaPercent.toFixed(1)}%`;
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className={`
        fixed top-0 right-0 h-full w-1/2 min-w-[500px] max-w-[800px]
        bg-white dark:bg-gray-800 shadow-2xl z-50
        transform transition-transform duration-300 ease-in-out
        ${open ? 'translate-x-0' : 'translate-x-full'}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            对比视图
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col h-[calc(100%-130px)] p-6">
          {/* Image comparison */}
          <div className="flex-1 flex gap-4 mb-4">
            {/* Selected image */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-4xl opacity-30">🖼️</span>
                </div>
                <img
                  src={`file://${selectedImage?.path || selectedImage?.name}`}
                  alt="Selected"
                  className="absolute inset-0 w-full h-full object-contain"
                  onError={(e) => { e.target.style.opacity = '0'; }}
                />
                <div className="absolute top-2 left-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded">
                  选中
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {selectedImage?.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatFileSize(selectedImage?.size)}
                </p>
              </div>
            </div>

            {/* VS divider */}
            <div className="flex items-center">
              <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <span className="text-gray-500 font-bold">VS</span>
              </div>
            </div>

            {/* Winner image */}
            <div className="flex-1 flex flex-col">
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative ring-2 ring-green-500 ring-offset-2">
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-4xl opacity-30">✓</span>
                </div>
                <img
                  src={`file://${winnerImage?.path || winnerImage?.name}`}
                  alt="Winner"
                  className="absolute inset-0 w-full h-full object-contain"
                  onError={(e) => { e.target.style.opacity = '0'; }}
                />
                <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded">
                  ✓ Winner
                </div>
              </div>
              <div className="mt-2 text-center">
                <p className="text-sm font-medium text-green-600 dark:text-green-400 truncate">
                  {winnerImage?.name}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatFileSize(winnerImage?.size)}
                </p>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">相似度</span>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {getSimilarityText(selectedImage)}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">文件名</span>
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {selectedImage?.name}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">大小差异</span>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {getSizeDeltaText(selectedImage?.size, winnerImage?.size)}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation info */}
          <div className="text-center text-sm text-gray-500 dark:text-gray-400 mb-4">
            图片 {selectedIndex + 1} / {group.members.length}
            <span className="mx-2">•</span>
            <span className="text-gray-400">← → 键切换</span>
            <span className="mx-2">•</span>
            <span className="text-gray-400">K 保留 R 移除 S 跳过</span>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => onAction('keep')}
              className="flex-1 btn btn-success py-3 text-base"
            >
              ✓ 标记保留
            </button>
            <button
              onClick={() => onAction('remove')}
              disabled={selectedImage?.name === group.winner}
              className="flex-1 btn btn-danger py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              × 标记移除
            </button>
            <button
              onClick={onSkip}
              className="flex-1 btn btn-secondary py-3 text-base"
            >
              → 跳过
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ComparePanel;
