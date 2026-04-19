const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: [
    {
      command: 'DEDUP_BACKEND_PORT=18765 DEDUP_BACKEND_DEBUG=0 python3.11 backend/app.py',
      url: 'http://127.0.0.1:18765/api/history',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'npx vite --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:18765',
      },
    },
  ],
});
