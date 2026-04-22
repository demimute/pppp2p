import React, { useState, useEffect } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

function ConfirmDialog({ open, groups, stats, title = '确认移除', onConfirm, onCancel }) {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmed(false);
    }
  }, [open]);

  const toRemoveImages = groups
    ? groups.flatMap((g) => g.members.filter((m) => m.to_remove)) || []
    : [];

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          </div>
          <button onClick={onCancel} className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
            <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <div className="flex gap-3">
              <span className="text-2xl">🚨</span>
              <div>
                <p className="font-medium text-yellow-800 dark:text-yellow-200">即将移除 {stats?.to_remove || 0} 张照片</p>
                <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">文件将被移动到「照片-已去重」文件夹，撤销后可恢复。</p>
              </div>
            </div>
          </div>

          {toRemoveImages.length > 0 && (
            <div className="mb-6">
              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">预览将要移除的照片：</p>
              <div className="grid max-h-48 grid-cols-6 gap-2 overflow-y-auto">
                {toRemoveImages.slice(0, 24).map((img, index) => (
                  <div key={index} className="relative aspect-square overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-700">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-lg opacity-30">🖼️</span>
                    </div>
                    <img
                      src={toPreviewUrl(img.path || img.name)}
                      alt={img.name}
                      className="absolute inset-0 h-full w-full object-cover opacity-60"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                ))}
                {toRemoveImages.length > 24 && (
                  <div className="flex aspect-square items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                    <span className="text-sm text-gray-500">+{toRemoveImages.length - 24}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">我确认已备份重要照片，同意执行移除操作</span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-800/50">
          <button onClick={onCancel} className="btn btn-secondary">取消</button>
          <button onClick={onConfirm} disabled={!confirmed} className="btn btn-danger">确认移除 {stats?.to_remove || 0} 张</button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
