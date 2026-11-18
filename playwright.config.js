const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { browserName: 'chromium', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined } },
  reporter: [['list'], ['html', {outputFolder: 'playwright-report', open: 'never'}]],
  // Run on local file URLs: no preview server or remote service is required.
});
