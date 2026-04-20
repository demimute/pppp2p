import React, { useState, useEffect } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

function ConfirmDialog({ open, groups, stats, onConfirm, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmed(false);
    }
  }, [open]);

  // Get images marked for removal
  const toRemoveImages = groups
    ? groups.flatMap(g => g.members.filter(m => m.to_remove)) || []
    : [];

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div 
        className="modal-content max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              确认移除
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Warning message */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
            <div className="flex gap-3">
              <span className="text-2xl">🚨</span>
              <div>
                <p className="font-medium text-yellow-800 dark:text-yellow-200">
                  即将移除 {stats?.to_remove || 0} 张照片
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                  文件将被移动到「照片-已去重」文件夹，撤销后可恢复。
                </p>
              </div>
            </div>
          </div>

          {/* Preview grid */}
          {toRemoveImages.length > 0 && (
            <div className="mb-6">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                预览将要移除的照片：
              </p>
              <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto">
                {toRemoveImages.slice(0, 24).map((img, index) => (
                  <div 
                    key={index}
                    className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden relative"
                  >
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg opacity-30">🖼️</span>
                    </div>
                    <img
                      src={toPreviewUrl(img.path || img.name)}
                      alt={img.name}
                      className="absolute inset-0 w-full h-full object-cover opacity-60"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                ))}
                {toRemoveImages.length > 24 && (
                  <div className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                    <span className="text-sm text-gray-500">
                      +{toRemoveImages.length - 24}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Confirmation checkbox */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              我确认已备份重要照片，同意执行移除操作
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <button
            onClick={onCancel}
            className="btn btn-secondary"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!confirmed}
            className="btn btn-danger"
          >
            确认移除 {stats?.to_remove || 0} 张
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
