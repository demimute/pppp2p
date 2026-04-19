const { test, expect } = require('@playwright/test');

test('compare -> mark remove -> execute remove -> undo', async ({ page }) => {
  await page.goto('/');

  await page.getByPlaceholder(/输入文件夹路径/).fill('/tmp/dedup-test');
  await page.getByRole('button', { name: '加载路径' }).click();
  await page.getByRole('button', { name: /开始分析/ }).click();

  await expect(page.getByText(/已找到 1 组相似照片/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeVisible();

  const removableThumb = page.getByRole('button', { name: /^img1\.png, 相似度 100\.0%$/ });
  await removableThumb.click();

  await expect(page.getByText('对比视图')).toBeVisible();
  await page.getByRole('button', { name: /标记移除/ }).click();
  await expect(page.getByText(/1 张待移除/)).toBeVisible();

  await page.getByRole('button', { name: /执行移除 \(1张\)/ }).click();
  await expect(page.getByRole('heading', { name: '确认移除' })).toBeVisible();

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /确认移除 1 张/ }).click();

  await expect(page.getByText(/已移除 1 张照片/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /撤销/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^img1\.png, 相似度 100\.0%$/ })).toHaveCount(0);

  await page.getByRole('button', { name: /撤销/ }).click();
  await expect(page.getByText(/已恢复 1 张照片/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=/已撤销/').first()).toBeVisible();
});
