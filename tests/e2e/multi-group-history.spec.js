const { test, expect } = require('@playwright/test');

const TEST_DIR = '/tmp/dedup-test-multigroup';

async function loadAndAnalyze(page) {
  await page.goto('/');
  await page.getByPlaceholder(/输入文件夹路径/).fill(TEST_DIR);
  await page.getByRole('button', { name: '加载路径' }).click();
  await page.getByRole('button', { name: /开始分析/ }).click();
  await expect(page.getByText(/已找到/)).toBeVisible({ timeout: 30000 });
}

test('multi-group remove and undo keep visible state consistent', async ({ page }) => {
  await loadAndAnalyze(page);

  await expect(page.getByRole('heading', { name: /相似组预览/ })).toBeVisible();
  await expect(page.getByText(/第1组/)).toBeVisible();

  const removeButton = page.getByRole('button', { name: /执行移除/ });
  await expect(removeButton).toBeEnabled();

  await removeButton.click();
  await expect(page.getByRole('heading', { name: '确认移除' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /确认移除/ }).click();

  await expect(page.getByText(/已移除/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /撤销/ })).toBeVisible();
  await expect(page.getByText(/已找到|没有发现符合当前策略的相似组/)).toBeVisible();

  await page.getByRole('button', { name: /撤销/ }).click();
  await expect(page.getByText(/已恢复/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('已撤销', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeVisible();
});
