const { test, expect } = require('@playwright/test');

test.describe('Person Enhancement UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Select dual strategy by default
    await expect(page.getByRole('button', { name: /双保险/ })).toBeVisible();
  });

  test('dual strategy selected by default', async ({ page }) => {
    const dualButton = page.getByRole('button', { name: /双保险/ });
    await expect(dualButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('person enhancement controls visible for dual strategy', async ({ page }) => {
    // The person enhancement section should be visible
    await expect(page.getByText('🧑 人物增强')).toBeVisible();
    await expect(page.getByText(/优先保留或移除包含人物的相似组/)).toBeVisible();
  });

  test('person enhancement toggle works', async ({ page }) => {
    const toggle = page.getByTestId('person-enhance-toggle');
    const initialState = await toggle.getAttribute('aria-pressed');

    await toggle.click();

    const newState = await toggle.getAttribute('aria-pressed');
    expect(newState).not.toBe(initialState);
  });

  test('person enhancement weight slider is accessible when enabled', async ({ page }) => {
    // Slider should exist and be interactive
    const slider = page.locator('input[type="range"]').last();
    await expect(slider).toBeVisible();

    // Move the slider
    const box = await slider.boundingBox();
    if (box) {
      await slider.fill('0.8');
      await expect(slider).toHaveValue('0.8');
    }
  });

  test('person enhancement disabled state updates toggle state', async ({ page }) => {
    const enhanceCard = page.locator('div').filter({ has: page.getByText('🧑 人物增强') }).first();
    const toggle = page.getByTestId('person-enhance-toggle');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(enhanceCard.getByText('权重调节')).toBeVisible();
  });

  test('intelligence card label logic is wired for person enhance', async ({ page }) => {
    const enhanceCard = page.locator('div').filter({ has: page.getByText('🧑 人物增强') }).first();
    await expect(enhanceCard).toBeVisible();
    await expect(enhanceCard.getByText('均衡').first()).toBeVisible();
    await expect(enhanceCard.getByText('保留人物')).toBeVisible();
    await expect(enhanceCard.getByText('移除人物')).toBeVisible();
  });

  test('strategy description mentions person enhance for dual', async ({ page }) => {
    const dualCard = page.getByRole('button', { name: /双保险/ });
    await expect(dualCard).toContainText('人物增强');
  });
});