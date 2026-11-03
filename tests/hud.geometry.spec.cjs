'use strict';
// Odak 0.1 · HUD geometry measurement.
// Measures how much of the screen stays free for play once the combat HUD is
// up, plus overlapping HUD items, overflowing text and too-small touch targets.
// Results go to the console and test-results/hud-metrics.json.
const { test, expect } = require('@playwright/test');
const { gotoGame } = require('./browser.helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');

// Single source of truth for the HUD targets (Faz 2 tightens the HUD to these).
const HUD_THRESHOLDS = {
  freePlayPct: { portrait: 70, landscape: 65, desktop: 80 },
  overlaps: 0,
  overflows: 0,
  smallTargets: 0,
  minTouchTarget: 44
};

const VIEWPORTS = [
  { name: 'iphone-se-portrait', width: 320, height: 568, kind: 'portrait', touch: true, deviceScaleFactor: 2 },
  { name: 'iphone-13-portrait', width: 390, height: 664, kind: 'portrait', touch: true, deviceScaleFactor: 3 },
  { name: 'iphone-13-landscape', width: 750, height: 342, kind: 'landscape', touch: true, deviceScaleFactor: 3 },
  { name: 'desktop-1280', width: 1280, height: 800, kind: 'desktop', touch: false, deviceScaleFactor: 1 },
  { name: 'desktop-1366', width: 1366, height: 768, kind: 'desktop', touch: false, deviceScaleFactor: 1 }
];

const SETTLE_MS = 4000;
const METRICS_FILE = path.resolve(__dirname, '..', 'test-results', 'hud-metrics.json');

// Runs inside the page. Kept self-contained because it is serialized.
function collectHudGeometry(minTarget) {
  const hud = document.getElementById('hud');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';

  const isVisible = el => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const hasOwnText = el => [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  const label = el => {
    if (el.id) return '#' + el.id;
    const cls = [...el.classList].filter(c => !c.includes(':') && !c.includes('[')).slice(0, 2).join('.');
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (text ? ` "${text}"` : '');
  };
  const box = el => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const round = n => Math.round(n * 10) / 10;

  const visible = [...hud.querySelectorAll('*')].filter(isVisible);
  const topDeck = hud.querySelector('.hud-top-deck');
  const commandDeck = hud.querySelector('.hud-command-deck');

  // Vertical band between the top block and the bottom block. The deck
  // wrappers are flex boxes stretched by #hud, so only their content counts.
  const topItems = visible.filter(el => el !== topDeck && topDeck.contains(el));
  const bottomItems = visible.filter(el => el !== commandDeck && commandDeck.contains(el));
  const topEdge = topItems.length ? Math.max(...topItems.map(el => el.getBoundingClientRect().bottom)) : 0;
  const bottomEdge = bottomItems.length ? Math.min(...bottomItems.map(el => el.getBoundingClientRect().top)) : vh;
  const bandHeight = Math.max(0, bottomEdge - topEdge);

  // Narrow HUD items reaching into that band act as side columns.
  let leftEdge = 0;
  let rightEdge = vw;
  const sideItems = [];
  for (const el of visible) {
    const r = el.getBoundingClientRect();
    if (r.bottom <= topEdge + 1 || r.top >= bottomEdge - 1 || r.width >= vw / 2) continue;
    if ((r.left + r.right) / 2 < vw / 2) leftEdge = Math.max(leftEdge, r.right);
    else rightEdge = Math.min(rightEdge, r.left);
    sideItems.push(label(el));
  }
  const bandWidth = Math.max(0, rightEdge - leftEdge);

  const textItems = visible.filter(hasOwnText);
  const interactive = visible.filter(el => el.matches(INTERACTIVE) && getComputedStyle(el).pointerEvents !== 'none');
  const items = [...new Set([...textItems, ...interactive])];

  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w >= 2 && h >= 2) overlaps.push({ a: label(a), b: label(b), width: round(w), height: round(h) });
    }
  }

  const overflows = visible
    .filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
    .map(el => ({ el: label(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

  const smallTargets = interactive
    .map(el => ({ el: label(el), ...box(el) }))
    .filter(t => t.width < minTarget || t.height < minTarget)
    .map(t => ({ el: t.el, width: round(t.width), height: round(t.height) }));

  return {
    viewport: { width: vw, height: vh },
    gameState: typeof gameState === 'undefined' ? null : gameState,
    visibleTextCount: textItems.length,
    topEdge: round(topEdge),
    bottomEdge: round(bottomEdge),
    leftEdge: round(leftEdge),
    rightEdge: round(rightEdge),
    verticalGapPct: round((bandHeight / vh) * 100),
    freePlayPct: round(((bandWidth * bandHeight) / (vw * vh)) * 100),
    sideItems,
    overlaps,
    overflows,
    smallTargets
  };
}

async function measureViewport(browser, baseURL, vp) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    isMobile: vp.touch,
    hasTouch: vp.touch
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await gotoGame(page,'/index.html');
    await expect(page.locator('#startBtn')).toBeVisible();
    await page.locator('#startBtn').click();
    await expect(page.locator('#hud')).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    const geometry = await page.evaluate(collectHudGeometry, HUD_THRESHOLDS.minTouchTarget);
    if (!vp.touch) geometry.smallTargets = [];
    return { name: vp.name, kind: vp.kind, touch: vp.touch, ...geometry, pageErrors: errors };
  } finally {
    await context.close();
  }
}

async function measureAll(browser, baseURL) {
  const results = [];
  for (const vp of VIEWPORTS) results.push(await measureViewport(browser, baseURL, vp));
  return results;
}

function thresholdFailures(m) {
  const failures = [];
  const minFree = HUD_THRESHOLDS.freePlayPct[m.kind];
  if (m.freePlayPct < minFree) failures.push(`${m.name}: freePlayPct ${m.freePlayPct} < ${minFree}`);
  if (m.overlaps.length > HUD_THRESHOLDS.overlaps) failures.push(`${m.name}: ${m.overlaps.length} overlapping pairs`);
  if (m.overflows.length > HUD_THRESHOLDS.overflows) failures.push(`${m.name}: ${m.overflows.length} overflowing items`);
  if (m.smallTargets.length > HUD_THRESHOLDS.smallTargets) failures.push(`${m.name}: ${m.smallTargets.length} touch targets < ${HUD_THRESHOLDS.minTouchTarget}px`);
  return failures;
}

test.describe('HUD geometry', () => {
  test.describe.configure({ timeout: 120_000 });

  test('measures free play area, overlaps, overflow and touch targets', async ({ browser }, testInfo) => {
    const results = await measureAll(browser, testInfo.project.use.baseURL);
    const report = {
      schema: 'neon-hud-metrics/v1',
      created_at: new Date().toISOString(),
      settle_ms: SETTLE_MS,
      thresholds: HUD_THRESHOLDS,
      viewports: results.map(m => ({ ...m, failures: thresholdFailures(m) }))
    };
    fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
    fs.writeFileSync(METRICS_FILE, JSON.stringify(report, null, 2) + '\n');

    console.log('\nHUD geometry (' + path.relative(process.cwd(), METRICS_FILE) + ')');
    console.table(results.map(m => ({
      viewport: `${m.name} ${m.viewport.width}x${m.viewport.height}`,
      visibleText: m.visibleTextCount,
      verticalGapPct: m.verticalGapPct,
      freePlayPct: m.freePlayPct,
      overlaps: m.overlaps.length,
      overflows: m.overflows.length,
      smallTargets: m.smallTargets.length
    })));

    // Only sanity checks here; the targets live in the fixme test below.
    for (const m of results) {
      expect(m.gameState, `${m.name} should be in combat`).toBe('PLAYING');
      expect(m.pageErrors, `${m.name} page errors`).toEqual([]);
      expect(Number.isFinite(m.freePlayPct)).toBe(true);
      expect(m.freePlayPct).toBeGreaterThanOrEqual(0);
      expect(m.freePlayPct).toBeLessThanOrEqual(100);
    }
  });

  // Current HUD misses most targets; remove fixme once Faz 2 lands.
  test.fixme('HUD meets free-area, overlap, overflow and touch-target thresholds', async ({ browser }, testInfo) => {
    const results = await measureAll(browser, testInfo.project.use.baseURL);
    expect(results.flatMap(thresholdFailures)).toEqual([]);
  });
});
