const { test, expect } = require('@playwright/test');

const TEST_DIR = '/tmp/dedup-test-multigroup';

async function runAnalysis(page) {
  await page.goto('/');
  await page.getByPlaceholder(/输入文件夹路径/).fill(TEST_DIR);
  await page.getByRole('button', { name: '加载路径' }).click();
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });
}

async function removeMarked(page) {
  const removeButton = page.getByRole('button', { name: /执行移除/ });
  await expect(removeButton).toBeVisible();
  await expect(removeButton).toBeEnabled();
  await removeButton.click();
  await expect(page.getByRole('heading', { name: '确认移除' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /确认移除/ }).click();
  await expect(page.getByText(/已移除/)).toBeVisible({ timeout: 30000 });
}

test('repeated remove and undo keep history stack consistent', async ({ page }) => {
  await runAnalysis(page);
  await removeMarked(page);

  const undoButton = page.getByRole('button', { name: /撤销/ });
  await expect(undoButton).toBeVisible();
  await undoButton.click();
  await expect(page.getByText(/已恢复/)).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible({ timeout: 30000 });

  await removeMarked(page);
  await expect(page.getByText(/已移除/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=/\\d{2}:\\d{2}: 已撤销/').first()).toBeVisible();

  await page.getByRole('button', { name: /撤销/ }).click();
  await expect(page.getByText(/已恢复/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=/\\d{2}:\\d{2}: 已撤销/').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeVisible();
});
