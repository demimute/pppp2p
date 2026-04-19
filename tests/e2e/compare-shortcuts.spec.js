const { test, expect } = require('@playwright/test');
const { openFirstComparison } = require('./helpers');

async function openComparison(page) {
  await openFirstComparison(page, '/tmp/dedup-test');
  const panelHeading = page.getByRole('heading', { name: '对比视图' });
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

  await page.locator('[aria-label*="相似度"]').first().click();
  const reopenedHeading = page.getByRole('heading', { name: '对比视图' });
  await expect(reopenedHeading).toBeVisible();
  await reopenedHeading.click();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '对比视图' })).toBeHidden();
});
