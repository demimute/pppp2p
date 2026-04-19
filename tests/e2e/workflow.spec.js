const { test, expect } = require('@playwright/test');
const { openFirstComparison } = require('./helpers');

test('compare -> mark remove -> execute remove -> undo', async ({ page }) => {
  await openFirstComparison(page, '/tmp/dedup-test');
  await expect(page.getByRole('button', { name: /执行移除/ })).toBeVisible();
  await page.getByRole('button', { name: /标记移除/ }).click();
  await expect(page.getByText(/1 张待移除/)).toBeVisible();

  await page.getByRole('button', { name: /执行移除 \(1张\)/ }).click();
  await expect(page.getByRole('heading', { name: '确认移除' })).toBeVisible();

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /确认移除 1 张/ }).click();

  await expect(page.getByText(/已移除\s+1\s+张照片/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /撤销/ })).toBeVisible();

  await page.getByRole('button', { name: /撤销/ }).click();
  await expect(page.getByText(/已恢复\s+1\s+张照片/)).toBeVisible({ timeout: 30000 });
  await expect(page.locator('text=/已撤销/').first()).toBeVisible();
});
