const { test, expect } = require('@playwright/test');

async function loadFolder(page, folder = '/tmp/dedup-test') {
  const pathInput = page.getByPlaceholder(/输入文件夹路径/);
  await expect(pathInput).toBeVisible();
  await pathInput.fill(folder);
  await page.getByRole('button', { name: '加载路径' }).click();
  await expect(page.getByText(folder)).toBeVisible();
}

test('main workflow UI smoke', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('DedupStudio')).toBeVisible();
  await expect(page.getByText('选择策略')).toBeVisible();
  await expect(page.getByRole('button', { name: /CLIP视觉/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /感知哈希/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /双保险/ })).toBeVisible();

  await page.getByRole('button', { name: /感知哈希/ }).click();
  await expect(page.getByRole('heading', { name: /阈值 \(Hamming距离\)/ })).toBeVisible();

  await page.getByRole('button', { name: /CLIP视觉/ }).click();
  await expect(page.getByRole('button', { name: /开始分析/ })).toBeVisible();

  await loadFolder(page);
  await expect(page.getByRole('button', { name: /开始分析/ })).toBeEnabled();

  await page.getByRole('button', { name: /开始分析/ }).click();

  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });
});

test('switching strategy and re-running analysis keeps state consistent', async ({ page }) => {
  await page.goto('/');
  await loadFolder(page);

  const clipCard = page.getByRole('button', { name: /CLIP视觉/ });
  const dualCard = page.getByRole('button', { name: /双保险/ });
  const phashCard = page.getByRole('button', { name: /感知哈希/ });

  await clipCard.click();
  await expect(clipCard).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeVisible();

  await phashCard.click();
  await expect(phashCard).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /阈值 \(Hamming距离\)/ })).toBeVisible();
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeVisible();

  await dualCard.click();
  await expect(dualCard).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /阈值 \(CLIP相似度\)/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /阈值 \(pHash距离\)/ })).toBeVisible();
  await page.locator('input[type="range"]').first().fill('0.97');
  await page.locator('input[type="range"]').nth(1).fill('3');
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });

  await clipCard.click();
  await expect(page.getByRole('heading', { name: /阈值 \(相似度\)/ })).toBeVisible();
  await expect(clipCard).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: /相似组预览/ })).toBeVisible();
});
