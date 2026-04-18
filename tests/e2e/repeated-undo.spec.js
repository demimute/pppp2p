const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = '/tmp/dedup-test';
const TEST_DIR = '/tmp/dedup-test-multigroup';
const DEDUP_DIR = '/tmp/dedup-test-multigroup-已去重';

function resetTestDir() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.rmSync(DEDUP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  for (const entry of fs.readdirSync(SOURCE_DIR)) {
    fs.copyFileSync(path.join(SOURCE_DIR, entry), path.join(TEST_DIR, entry));
  }

  const dupA = path.join(TEST_DIR, 'dup_a.png');
  fs.writeFileSync(dupA, 'group-two-a');
  fs.copyFileSync(dupA, path.join(TEST_DIR, 'dup_b.png'));
}

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

  const dialog = page.getByRole('heading', { name: '确认移除' });
  await expect(dialog).toBeVisible();

  const confirmCheckbox = page.getByRole('checkbox', { name: /我确认已备份重要照片/ });
  const confirmButton = page.getByRole('button', { name: /确认移除/ });

  for (let i = 0; i < 3; i += 1) {
    await confirmCheckbox.click();
    try {
      await expect(confirmCheckbox).toBeChecked({ timeout: 1000 });
      await expect(confirmButton).toBeEnabled({ timeout: 1000 });
      break;
    } catch (error) {
      if (i === 2) throw error;
    }
  }

  await confirmButton.click();
  await expect(page.getByText(/已移除/)).toBeVisible({ timeout: 30000 });
}

test('repeated remove and undo keep history stack consistent', async ({ page }) => {
  resetTestDir();
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
