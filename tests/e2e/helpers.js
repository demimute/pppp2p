const { expect } = require('@playwright/test');

async function loadFolder(page, folder) {
  await page.goto('/');
  await page.getByPlaceholder(/输入文件夹路径/).fill(folder);
  await page.getByRole('button', { name: '加载路径' }).click();
  await expect(page.getByText(folder)).toBeVisible();

  const countSignals = [
    page.getByText(/已扫描\s+\d+\s+张图片/),
    page.getByText(/共\s+\d+\s+张图片/),
  ];
  await Promise.any(countSignals.map((locator) => locator.waitFor({ state: 'visible', timeout: 10000 })));
}

async function waitForAnalysisSettled(page) {
  await expect(
    page.getByText(/已找到.*组相似照片|没有发现符合当前策略的相似组|分析失败，请检查后端状态或目录权限|HTTP 403: Forbidden/)
  ).toBeVisible({ timeout: 30000 });
}

async function loadAndAnalyze(page, folder) {
  await loadFolder(page, folder);
  await page.getByRole('button', { name: /开始分析/ }).click();
  await waitForAnalysisSettled(page);
}

async function openFirstComparison(page, folder) {
  await loadAndAnalyze(page, folder);
  await expect(page.getByRole('heading', { name: /相似组预览/ })).toBeVisible();

  const removableThumbs = page.locator('[aria-label*="相似度"]:not([aria-label*="Winner"])');
  const removableCount = await removableThumbs.count();
  if (removableCount > 0) {
    await removableThumbs.first().click();
  } else {
    const thumbs = page.locator('[aria-label*="相似度"]');
    const count = await thumbs.count();
    if (count === 0) {
      throw new Error('No group thumbnails available after analysis');
    }
    await thumbs.first().click();
  }

  await expect(page.getByRole('heading', { name: '对比视图' })).toBeVisible();
}

module.exports = {
  loadFolder,
  waitForAnalysisSettled,
  loadAndAnalyze,
  openFirstComparison,
};
