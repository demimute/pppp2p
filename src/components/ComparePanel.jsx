import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { toPreviewUrl } from '../utils/fileUrl.js';

function ComparePanel({ open, group, selectedIndex, onClose, onAction, onSkip, onNavigate, onPromoteOptimal }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setZoom(1);
  }, [selectedIndex, open]);

  const adjustZoom = useCallback((delta) => {
    setZoom((prev) => {
      const next = prev + delta;
      return Math.min(5, Math.max(0.4, Number(next.toFixed(2))));
    });
  }, []);

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

  const selectedImage = useMemo(() => group?.members?.[selectedIndex], [group, selectedIndex]);
  const winnerImage = useMemo(() => group?.members?.find((m) => m.name === group?.winner), [group]);

  if (!open || !group || !selectedImage || !winnerImage) {
    return null;
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const canPromote = selectedImage?.name !== group.winner;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
        <div className="flex h-[96vh] w-full max-w-[1680px] flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <button onClick={() => onPromoteOptimal?.(selectedImage?.name)} disabled={!canPromote} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50">
              设为保留项
            </button>
            <button onClick={() => onAction('keep')} className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-gray-50 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800">
              保留
            </button>
            <button onClick={() => onAction('remove')} disabled={!canPromote} className="rounded-2xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-950/20">
              移除
            </button>
            <button onClick={onSkip} className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              下一张
            </button>
            <div className="mx-2 h-6 w-px bg-gray-200 dark:bg-gray-800" />
            <button onClick={() => adjustZoom(-0.25)} className="rounded-full border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">-</button>
            <span className="text-sm text-gray-500 dark:text-gray-400">{Math.round(zoom * 100)}%</span>
            <button onClick={() => adjustZoom(0.25)} className="rounded-full border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">+</button>
            <button onClick={() => setZoom(1)} className="rounded-2xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              还原
            </button>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {selectedIndex + 1} / {group.members.length} · {selectedImage.name}
              </div>
              <button onClick={onClose} className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-h-0 flex-col border-b border-gray-200 dark:border-gray-800 2xl:border-b-0 2xl:border-r">
              <div
                className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#e9eef7] p-2 dark:bg-black"
                onWheel={(e) => {
                  e.preventDefault();
                  adjustZoom(e.deltaY > 0 ? -0.12 : 0.12);
                }}
              >
                <img
                  src={toPreviewUrl(selectedImage.path || selectedImage.name)}
                  alt={selectedImage.name}
                  className="max-h-full max-w-full origin-center rounded-lg object-contain transition-transform duration-100"
                  style={{ transform: `scale(${zoom})` }}
                  onDoubleClick={() => setZoom((prev) => prev === 1 ? 2 : 1)}
                  onError={(e) => { e.target.style.opacity = '0'; }}
                />
              </div>

              <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>当前：{selectedImage.name}</span>
                  <span>{formatFileSize(selectedImage.size)}</span>
                  <span>{selectedImage.similarity !== undefined ? `${(selectedImage.similarity * 100).toFixed(1)}%` : '—'}</span>
                  <span>{selectedImage.person_identity_state === 'same' ? '同人' : selectedImage.person_identity_state === 'different' ? '异人' : selectedImage.person_identity_state === 'uncertain' ? '待定' : '未判定'}</span>
                </div>
                <div className="grid grid-cols-5 gap-2 md:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
                  {group.members.map((member, index) => {
                    const isActive = index === selectedIndex;
                    const isWinner = member.name === group.winner;
                    return (
                      <button
                        key={member.name}
                        type="button"
                        onClick={() => onNavigate(index)}
                        className={`relative overflow-hidden rounded-[16px] border transition ${isActive ? 'border-sky-500 shadow-[0_0_0_3px_rgba(14,165,233,0.16)]' : isWinner ? 'border-emerald-500' : 'border-gray-200 dark:border-gray-800'}`}
                      >
                        <div className="relative aspect-square bg-gray-100 dark:bg-gray-800">
                          <img src={toPreviewUrl(member.path || member.name)} alt={member.name} className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.target.style.opacity = '0'; }} />
                          {isWinner && <span className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">保留</span>}
                          {member.to_remove && <span className="absolute right-1.5 top-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">移除</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <aside className="hidden min-h-0 flex-col bg-white dark:bg-gray-950 2xl:flex">
              <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
                <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <div className="text-xs text-emerald-700 dark:text-emerald-300">当前保留项</div>
                  <div className="mt-1 truncate text-sm font-semibold text-emerald-700 dark:text-emerald-300">{winnerImage.name}</div>
                  <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{formatFileSize(winnerImage.size)}</div>
                </div>
              </div>

              <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">
                鼠标滚轮缩放，双击快速放大，左右方向键切图。
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

export default ComparePanel;
