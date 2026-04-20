export function toPreviewUrl(filePath) {
  if (!filePath) return '';

  const normalized = filePath.replace(/\\/g, '/');

  if (typeof window !== 'undefined' && window.electronAPI) {
    return `local-file://${encodeURIComponent(normalized)}`;
  }

  return `file://${normalized}`;
}
