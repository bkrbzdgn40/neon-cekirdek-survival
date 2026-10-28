const { test, expect } = require('@playwright/test');

test('menu starts playable canvas and pause/resume flow is interactive', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#startBtn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.graphicsQuality)).toBe('high');
  await expect.poll(() => page.evaluate(() => typeof window.getNeonRunDiagnostics)).toBe('function');
  const canvas = page.locator('#gameCanvas');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate(el => el.width > 0 && el.height > 0)).toBe(true);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#pauseBtn').click();
  await expect(page.locator('#pauseModal')).toBeVisible();
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#pauseModal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('upgrade cards and keyboard selection work in a real browser', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#startBtn')).toBeVisible();
  await page.locator('#startBtn').click();
  await page.evaluate(() => triggerLevelUp());
  await expect(page.locator('#upgradeModal')).toBeVisible();
  await expect(page.locator('#upgradeCardsContainer button')).toHaveCount(3);
  await page.keyboard.press('1');
  await expect(page.locator('#upgradeModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => gameState)).toBe('PLAYING');
  expect(errors).toEqual([]);
});

test('mobile touchscreen controls and menu viewport stay usable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch interaction is checked in mobile Chromium');
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#startBtn')).toBeVisible();
  const position = await page.locator('#startBtn').boundingBox();
  expect(position).not.toBeNull();
  expect(position.width).toBeGreaterThan(100);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
  const result = await page.evaluate(() => {
    const touch = new Touch({ identifier: 1, target: canvas, clientX: 180, clientY: 270 });
    canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true }));
    const active = mouse.active && mouse.x > 0 && mouse.y > 0;
    canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touch], bubbles: true }));
    return { active, ended: !mouse.active };
  });
  expect(result).toEqual({ active: true, ended: true });
});

test('portable JSON backup can be downloaded and restored through the menu', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#backupExportBtn')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backupExportBtn').click()
  ]);
  expect(download.suggestedFilename()).toBe('neon-cekirdek-kayit.json');
  const fs = require('node:fs');
  const saved = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(saved.format).toBe('neon-cekirdek-progress');
  await page.evaluate(() => { totalGold = 888; saveMetaProgress(); });
  await expect(page.locator('#menuGoldText')).toHaveText('888');
  await page.locator('#backupImportInput').setInputFiles({
    name: 'neon-cekirdek-kayit.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved))
  });
  await expect(page.locator('#backupStatusText')).toHaveText('YEDEK GERİ YÜKLENDİ');
  await expect(page.locator('#menuGoldText')).toHaveText('50');
  expect(errors).toEqual([]);
});

test('game start and pause remain operable if every external CDN is unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https:\/\/(?!127\.0\.0\.1)/, route => route.abort());
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#startBtn')).toBeVisible();
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await page.locator('#pauseBtn').click();
  await expect(page.locator('#pauseModal')).toBeVisible();
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#pauseModal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('small, tablet and wide viewports keep the launch action horizontally reachable', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  for (const [width, height] of [[360, 740], [768, 1024], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const start = page.locator('#startBtn');
    await expect(start).toBeVisible();
    const rect = await start.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect.width).toBeGreaterThan(60);
    expect(rect.x).toBeGreaterThanOrEqual(-2);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 2);
    const scroll = await page.locator('#startModal').evaluate(node => ({
      content: node.scrollWidth, client: node.clientWidth
    }));
    expect(scroll.content, `horizontal overflow in viewport ${width}x${height}`)
      .toBeLessThanOrEqual(scroll.client + 3);
  }
});

test('a short real-time combat sample renders frames and advances game time', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html?perf=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#startBtn')).toBeVisible();
  await page.locator('#startBtn').click();
  await page.waitForTimeout(4000);
  const sample = await page.evaluate(() => ({
    snapshot: window.getNeonPerformanceSnapshot(),
    totalTime,
    gameState,
    activeEnemies: enemies.length
  }));
  expect(sample.gameState).toBe('PLAYING');
  expect(sample.totalTime).toBeGreaterThan(1);
  expect(sample.snapshot.frame.sampleCount).toBeGreaterThan(5);
  expect(sample.snapshot.canvasWidth).toBeGreaterThan(0);
  expect(sample.snapshot.canvasHeight).toBeGreaterThan(0);
  expect(sample.activeEnemies).toBeLessThanOrEqual(160);
  expect(errors).toEqual([]);
});
