const { test, expect } = require('@playwright/test');

test('debug analyze network', async ({ page }) => {
  const requests = [];
  const failures = [];
  const responses = [];

  page.on('request', (req) => {
    if (req.url().includes('/api/')) {
      requests.push({ url: req.url(), method: req.method(), postData: req.postData() });
    }
  });

  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/')) {
      failures.push({ url: req.url(), method: req.method(), error: req.failure()?.errorText || 'unknown' });
    }
  });

  page.on('response', async (res) => {
    if (res.url().includes('/api/')) {
      let body = null;
      try {
        body = await res.text();
      } catch (_) {}
      responses.push({ url: res.url(), status: res.status(), body });
    }
  });

  await page.goto('/');
  await page.getByPlaceholder(/输入文件夹路径/).fill('/tmp/dedup-test');
  await page.getByRole('button', { name: '加载路径' }).click();
  await page.getByRole('button', { name: /开始分析/ }).click();
  await page.waitForTimeout(5000);

  console.log('REQUESTS=' + JSON.stringify(requests, null, 2));
  console.log('RESPONSES=' + JSON.stringify(responses, null, 2));
  console.log('FAILURES=' + JSON.stringify(failures, null, 2));

  await expect.soft(page.locator('body')).toContainText(/Failed to fetch|已找到|没有发现符合当前策略的相似组/);
});
