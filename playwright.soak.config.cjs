const base = require('./playwright.config.cjs');
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  ...base,
  testMatch: '**/*.soak.spec.cjs',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  projects: [{name:'soak-desktop-chromium',use:{...devices['Desktop Chrome'],viewport:{width:1280,height:800}}}]
});
