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
