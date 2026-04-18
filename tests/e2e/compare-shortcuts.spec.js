const { test, expect } = require('@playwright/test');

async function openComparison(page) {
  await page.goto('/');
  await page.getByPlaceholder(/输入文件夹路径/).fill('/tmp/dedup-test');
  await page.getByRole('button', { name: '加载路径' }).click();
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到 1 组相似照片/)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /^img1\.png, 相似度 100\.0%$/ }).click();
  const panelHeading = page.getByRole('heading', { name: '对比视图' });
  await expect(panelHeading).toBeVisible();
  await panelHeading.click();
}

test('compare panel keyboard shortcuts work end-to-end', async ({ page }) => {
  await openComparison(page);

  await page.keyboard.press('ArrowLeft');
  await expect(page.getByText(/图片 1 \/ 2/)).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/图片 2 \/ 2/)).toBeVisible();

  await page.keyboard.press('k');
  await expect(page.getByRole('button', { name: /执行移除 \(0张\)/ })).toBeDisabled();

  await page.keyboard.press('r');
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeEnabled();
  await expect(page.getByText(/1 张待移除/)).toBeVisible();

  await page.keyboard.press('s');
  await expect(page.getByRole('heading', { name: '对比视图' })).toBeHidden();

  await page.getByRole('button', { name: /^img1\.png, 相似度 100\.0%$/ }).click();
  const reopenedHeading = page.getByRole('heading', { name: '对比视图' });
  await expect(reopenedHeading).toBeVisible();
  await reopenedHeading.click();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '对比视图' })).toBeHidden();
});
