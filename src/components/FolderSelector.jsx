import React, { useState, useCallback, useEffect } from 'react';

function FolderSelector({ selectedFolder, imageCount, onSelect, onDrop, onClear }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [manualPath, setManualPath] = useState(selectedFolder || '');

  useEffect(() => {
    setManualPath(selectedFolder || '');
  }, [selectedFolder]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Get folder path from dropped file
      const path = files[0].path;
      if (path) {
        // Extract folder path (remove the filename)
        const folderPath = path.substring(0, path.lastIndexOf('/'));
        onDrop(folderPath);
      }
    }
  }, [onDrop]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleManualSubmit = useCallback((e) => {
    e.preventDefault();
    const value = manualPath.trim();
    if (value) {
      onDrop(value);
    }
  }, [manualPath, onDrop]);

  return (
    <div className="mb-6">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer
          ${isDragOver 
            ? 'border-primary bg-primary/5 dark:bg-primary/10' 
            : 'border-gray-300 dark:border-gray-600 hover:border-primary dark:hover:border-primary'
          }
        `}
        onClick={onSelect}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <span className="text-3xl">📁</span>
          </div>
          <div>
            <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
              选择照片文件夹
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              或拖拽文件夹到这里
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleManualSubmit} className="mt-4 flex gap-3">
        <input
          type="text"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          placeholder="或直接输入文件夹路径，例如 /Volumes/photo/照片"
          className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white"
        />
        <button type="submit" className="btn btn-secondary">加载路径</button>
      </form>

      {/* Selected folder info */}
      {selectedFolder && (
        <div className="mt-4 flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl">📂</span>
            <div className="min-w-0">
              <p className="text-sm text-gray-500 dark:text-gray-400">已选择</p>
              <p className="text-gray-900 dark:text-white font-medium truncate" title={selectedFolder}>
                {selectedFolder}
              </p>
              <p className="text-sm text-primary font-medium">
                共 {imageCount} 张图片
              </p>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="btn btn-secondary text-sm"
          >
            清除
          </button>
        </div>
      )}
    </div>
  );
}

export default FolderSelector;
