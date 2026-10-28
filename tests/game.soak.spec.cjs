const { test, expect } = require('@playwright/test');

test('extended stationary desktop combat stays alive and within budgets @soak', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html?perf=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#startBtn').click();
  await page.evaluate(() => {
    // Benchmark fixture: ignore only player damage while using the real Director.
    player.takeDamage = () => {};
    wave = 16;
    totalTime = 240;
    nextBossTime = Infinity;
    combatDirector.nextEncounterAt = 0;
  });
  const duration = Math.max(15_000, Math.min(120_000,
    Number(process.env.NEON_SOAK_MS) || 25_000));
  await page.waitForTimeout(duration);
  const result = await page.evaluate(() => ({
    state: gameState,
    seconds: totalTime,
    performance: window.getNeonPerformanceSnapshot(),
    history: window.getNeonPerformanceHistory(),
    entities: {
      enemies: enemies.length, bullets: bullets.length, enemyProjectiles: enemyProjectiles.length,
      orbs: orbs.length, particles: particles.length
    }
  }));
  await page.screenshot({ path: 'test-results/soak-final.png' });
  expect(result.state).toBe('PLAYING');
  expect(result.seconds).toBeGreaterThan(240 + duration / 1000 * .45);
  expect(result.performance.frame.sampleCount).toBeGreaterThan(30);
  expect(result.performance.frame.p95Ms).toBeGreaterThan(0);
  expect(result.performance.canvasWidth).toBeGreaterThan(0);
  expect(result.history.length).toBeGreaterThan(2);
  expect(result.entities.enemies).toBeLessThanOrEqual(160);
  expect(result.entities.bullets).toBeLessThanOrEqual(260);
  expect(result.entities.orbs).toBeLessThanOrEqual(240);
  expect(result.entities.particles).toBeLessThanOrEqual(420);
  expect(errors).toEqual([]);
});
