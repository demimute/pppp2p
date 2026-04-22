import React, { useEffect, useCallback } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

function ComparePanel({ open, group, selectedIndex, onClose, onAction, onSkip, onNavigate, onPromoteOptimal }) {
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
      onAction('keep');
    } else if (e.key === 'r' || e.key === 'R') {
      onAction('remove');
    } else if (e.key === 's' || e.key === 'S') {
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
  const winnerImage = group.members.find((m) => m.name === group.winner);

  if (!selectedImage || !winnerImage) {
    return null;
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getHintText = () => {
    if (selectedImage.name === group.winner) {
      return '这张是当前保留项。可以继续保留，或切到别的图片重新指定。';
    }
    return '如果这张更清晰、更完整，直接设为保留项；否则保持移除建议。';
  };

  const reviewedCount = group.members.filter((m) => m.to_remove).length;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/35" onClick={onClose} />

      <div className={`fixed right-0 top-0 z-50 h-full w-full max-w-[900px] transform bg-white shadow-2xl transition-transform duration-300 dark:bg-gray-900 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 px-6 py-5 dark:border-gray-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600 dark:text-sky-400">Review</p>
                <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">逐张确认这一组</h2>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  当前第 {selectedIndex + 1} / {group.members.length} 张，已建议移除 {reviewedCount} 张。
                </p>
              </div>
              <button onClick={onClose} className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[28px] border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/40">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">当前查看</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(selectedImage.size)}</span>
                  </div>
                  <div className="relative aspect-square overflow-hidden rounded-[22px] bg-gray-200 dark:bg-gray-800">
                    <img src={toPreviewUrl(selectedImage.path || selectedImage.name)} alt={selectedImage.name} className="absolute inset-0 h-full w-full object-contain" onError={(e) => { e.target.style.opacity = '0'; }} />
                  </div>
                  <p className="mt-3 truncate text-sm font-medium text-gray-900 dark:text-white">{selectedImage.name}</p>
                </div>

                <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white">当前保留项</span>
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">{formatFileSize(winnerImage.size)}</span>
                  </div>
                  <div className="relative aspect-square overflow-hidden rounded-[22px] bg-emerald-100 dark:bg-emerald-900/20">
                    <img src={toPreviewUrl(winnerImage.path || winnerImage.name)} alt={winnerImage.name} className="absolute inset-0 h-full w-full object-contain" onError={(e) => { e.target.style.opacity = '0'; }} />
                  </div>
                  <p className="mt-3 truncate text-sm font-medium text-emerald-700 dark:text-emerald-300">{winnerImage.name}</p>
                </div>
              </div>

              <div className="rounded-[28px] border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950/40">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">建议</p>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{getHintText()}</p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-gray-50 p-3 dark:bg-gray-900">
                    <p className="text-xs text-gray-500 dark:text-gray-400">相似度</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{selectedImage.similarity !== undefined ? `${(selectedImage.similarity * 100).toFixed(1)}%` : '—'}</p>
                  </div>
                  <div className="rounded-2xl bg-gray-50 p-3 dark:bg-gray-900">
                    <p className="text-xs text-gray-500 dark:text-gray-400">人物判别</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
                      {selectedImage.person_identity_state === 'same' ? '同人' :
                       selectedImage.person_identity_state === 'different' ? '异人' :
                       selectedImage.person_identity_state === 'uncertain' ? '待定' : '未判定'}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  <button onClick={() => onPromoteOptimal?.(selectedImage?.name)} disabled={selectedImage?.name === group.winner} className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-base font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
                    设为保留项
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => onAction('keep')} className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800">
                      保留这张
                    </button>
                    <button onClick={() => onAction('remove')} disabled={selectedImage?.name === group.winner} className="rounded-2xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/20">
                      保持移除
                    </button>
                  </div>
                  <button onClick={onSkip} className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
                    跳过，先看下一张
                  </button>
                </div>

                <div className="mt-6 rounded-2xl bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  快捷键：`← / →` 切换，`K` 保留，`R` 移除，`S` 跳过。
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-4 gap-3 md:grid-cols-6">
              {group.members.map((member, index) => {
                const isWinner = member.name === group.winner;
                const isActive = index === selectedIndex;
                return (
                  <button
                    key={member.name}
                    type="button"
                    onClick={() => onNavigate(index)}
                    className={`overflow-hidden rounded-[20px] border transition ${isActive ? 'border-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.16)]' : isWinner ? 'border-emerald-400' : 'border-gray-200 dark:border-gray-800'}`}
                  >
                    <div className="relative aspect-square bg-gray-100 dark:bg-gray-800">
                      <img src={toPreviewUrl(member.path || member.name)} alt={member.name} className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.target.style.opacity = '0'; }} />
                      {isWinner && <span className="absolute left-2 top-2 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white">保留</span>}
                      {member.to_remove && <span className="absolute right-2 top-2 rounded-full bg-red-500 px-2 py-1 text-[10px] font-semibold text-white">移除</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default ComparePanel;
