const { test, expect } = require('@playwright/test');

test.describe('Person Disambiguation UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Select dual strategy by default
    await expect(page.getByRole('button', { name: /双保险/ })).toBeVisible();
  });

  test('dual strategy selected by default', async ({ page }) => {
    const dualButton = page.getByRole('button', { name: /双保险/ });
    await expect(dualButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('person disambiguation controls visible for dual strategy', async ({ page }) => {
    // The person disambiguation section should be visible
    await expect(page.getByText('🧑 人物判别')).toBeVisible();
    await expect(page.getByText(/减少不同人物误判为同组/)).toBeVisible();
  });

  test('person disambiguation toggle works', async ({ page }) => {
    const toggle = page.getByTestId('person-enhance-toggle');
    const initialState = await toggle.getAttribute('aria-pressed');

    await toggle.click();

    const newState = await toggle.getAttribute('aria-pressed');
    expect(newState).not.toBe(initialState);
  });

  test('person disambiguation weight slider is accessible when enabled', async ({ page }) => {
    // Slider should exist and be interactive (different-person suppression slider)
    const slider = page.locator('input[type="range"]').last();
    await expect(slider).toBeVisible();

    // Move the slider
    const box = await slider.boundingBox();
    if (box) {
      await slider.fill('0.8');
      await expect(slider).toHaveValue('0.8');
    }
  });

  test('person disambiguation disabled state updates toggle state', async ({ page }) => {
    const enhanceCard = page.locator('div').filter({ has: page.getByText('🧑 人物判别') }).first();
    const toggle = page.getByTestId('person-enhance-toggle');
    await toggle.click();

    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Controls should still be visible but dimmed
    await expect(enhanceCard.getByText('不同人物强抑制')).toBeVisible();
  });

  test('pose refinement is shown as built-in guidance instead of a separate slider', async ({ page }) => {
    const enhanceCard = page.locator('div').filter({ has: page.getByText('🧑 人物判别') }).first();
    await expect(enhanceCard).toBeVisible();
    await expect(enhanceCard.getByText('弱').first()).toBeVisible();
    await expect(enhanceCard.getByText('同人姿态精细判定')).toBeVisible();
    await expect(enhanceCard.getByText('系统内置规则')).toBeVisible();
    await expect(enhanceCard.getByText(/当前不提供单独调节/)).toBeVisible();
  });

  test('strategy description reflects person disambiguation for dual', async ({ page }) => {
    const dualCard = page.getByRole('button', { name: /双保险/ });
    await expect(dualCard).toContainText('人物身份判别');
    await expect(dualCard).toContainText('姿态细化');
  });
});
