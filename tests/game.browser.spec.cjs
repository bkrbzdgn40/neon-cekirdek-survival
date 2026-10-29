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

test('special encounter telegraph exposes tactical role hint before spawn', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#startBtn').click();
  await page.evaluate(() => {
    wave = 8;
    totalTime = 40;
    nextBossTime = 500;
    enemies = [];
    combatDirector.encounterIndex = 2;
    combatDirector.nextEncounterAt = 0;
    combatDirector.tokens = 14;
    combatDirector.update(0.02);
  });
  await expect.poll(() => page.evaluate(() => combatDirector.pendingEncounter?.type)).toBe('ESCORT');
  await expect(page.locator('#tacticalHintBadge')).toContainText('KALKAN');
  await page.evaluate(() => combatDirector.update(1.7));
  await expect.poll(() => page.evaluate(() => enemies.some(enemy => enemy.tacticalRole === 'payload'))).toBe(true);
  expect(errors).toEqual([]);
});

test('neon contract cards expose persistent mastery counters in the menu', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-neon-contract]')).toHaveCount(4);
  await expect(page.locator('#neonContractOptions')).toContainText('USTALIK 0/3');
  await expect.poll(() => page.evaluate(() => Object.keys(window.getNeonContractMastery()).length)).toBe(4);
});

test('real browser game-over, menu return and restart remain fully navigable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#startBtn').click();
  await page.evaluate(() => triggerGameOver());
  await expect(page.locator('#gameOverModal')).toBeVisible();
  await page.locator('#backToMenuBtn').click();
  await expect(page.locator('#gameOverModal')).toBeHidden();
  await expect(page.locator('#startModal')).toBeVisible();
  await page.locator('#startBtn').click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => gameState)).toBe('PLAYING');
  expect(errors).toEqual([]);
});

test('Canvas produces nonblank pixels in menu and active combat', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => {
    const node = document.querySelector('#gameCanvas');
    if (!node || !node.width || !node.height) return 0;
    const { data } = node.getContext('2d').getImageData(0, 0, node.width, node.height);
    let lit = 0;
    const stride = Math.max(4, Math.floor(data.length / 128 / 4) * 4);
    for (let i = 0; i < data.length; i += stride) {
      if (data[i] + data[i+1] + data[i+2] > 60) lit++;
    }
    return lit;
  })).toBeGreaterThan(0);
  await page.locator('#startBtn').click();
  await expect.poll(() => page.evaluate(() => {
    const node = document.querySelector('#gameCanvas');
    const { data } = node.getContext('2d').getImageData(0, 0, node.width, node.height);
    let lit = 0;
    const stride = Math.max(4, Math.floor(data.length / 128 / 4) * 4);
    for (let i = 0; i < data.length; i += stride) {
      if (data[i] + data[i+1] + data[i+2] > 60) lit++;
    }
    return lit;
  })).toBeGreaterThan(0);
});

test('extended browser game loop avoids runtime errors and stays within entity budgets', async ({ page }) => {
  test.setTimeout(45_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html?perf=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#startBtn').click();
  await page.evaluate(() => {
    // This isolated browser fixture ignores damage, not the production game rules.
    // A stationary player otherwise dies during the soak on narrow mobile viewports.
    player.takeDamage = () => {};
    player.hp = player.maxHp;
    nextBossTime = Infinity;
  });
  await page.waitForTimeout(12_000);
  const result = await page.evaluate(() => ({
    gameState, elapsed: totalTime, diagnostics: window.getNeonPerformanceSnapshot(),
    enemies: enemies.length, bullets: bullets.length, orbs: orbs.length, particles: particles.length
  }));
  expect(result.gameState).toBe('PLAYING');
  expect(result.elapsed).toBeGreaterThan(8);
  expect(result.diagnostics.frame.sampleCount).toBeGreaterThan(20);
  expect(result.diagnostics.frame.p95Ms).toBeGreaterThan(0);
  expect(result.enemies).toBeLessThanOrEqual(160);
  expect(result.bullets).toBeLessThanOrEqual(260);
  expect(result.orbs).toBeLessThanOrEqual(240);
  expect(result.particles).toBeLessThanOrEqual(420);
  expect(errors).toEqual([]);
});

test('self-hosted assets preserve responsive layout and fonts without any external requests', async ({ page, isMobile }) => {
  const external = [];
  page.on('request', request => {
    if (/^https?:\/\//.test(request.url()) &&
        !request.url().startsWith('http://127.0.0.1:8765/')) external.push(request.url());
  });
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto('/index.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#startBtn')).toBeVisible();
  const info = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector('#preflightDashboard')).display,
    orbitronLoaded: document.fonts.check('700 20px Orbitron'),
    bodyFont: getComputedStyle(document.body).fontFamily,
    iconFont: getComputedStyle(document.querySelector('.fa-solid')).fontFamily
  }));
  expect(info.grid).toBe(isMobile ? 'flex' : 'grid');
  expect(info.orbitronLoaded).toBe(true);
  expect(info.bodyFont).toContain('Rajdhani');
  expect(info.iconFont).toContain('Font Awesome');
  expect(external).toEqual([]);
});
