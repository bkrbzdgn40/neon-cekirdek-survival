'use strict';
// M5.28 · Authentic render capture. Images are emitted by the actual game
// canvas/DOM. Scenarios are deterministic REVIEW FIXTURES, not a natural run.
// Never publish unreviewed captures as player-session footage.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const out = path.resolve(process.cwd(), 'press-capture');
const manifest = [];
const fixture = 'Engine-rendered, scripted scenario. Not footage of an organic playthrough.';
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  fs.mkdirSync(out, { recursive: true });
});

test.afterAll(() => {
  const info = {
    schema: 'neon-capture/v1',
    build_sha: process.env.GITHUB_SHA || 'local-unverified',
    created_at: new Date().toISOString(),
    renderer: 'actual game Canvas 2D + DOM, Chromium',
    provenance: fixture,
    approved_for_publication: false,
    device: 'Playwright emulated viewport, not a real physical device',
    captures: manifest
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(info, null, 2) + '\n');
  const cards = manifest.map(c =>
    `<figure><img loading="lazy" alt="${c.title}" src="${c.file}"><figcaption><strong>${c.title}</strong> · ${c.description}</figcaption></figure>`).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Neon Çekirdek · Unapproved gameplay evidence</title><style>body{margin:0;background:#081326;color:#e6faff;font:16px/1.6 system-ui;padding:clamp(12px,4vw,42px)}h1{letter-spacing:-.04em}p{max-width:74ch;color:#bed4e2}.warning{color:#ffcea1}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:24px}figure{margin:0;border:1px solid #4a627b;background:#0e2134}img{display:block;width:100%;height:auto}figcaption{padding:14px}strong{color:#88f5f1}</style><h1>NEON ÇEKİRDEK · REAL RENDER REVIEW</h1><p class="warning">Unapproved evidence. Captured from the real game using explicitly staged automated scenarios, not an organic play session. Do not describe these as validated store screenshots or actual player footage.</p><p>Build: ${info.build_sha} · ${info.created_at} · Screenshot source: Chromium + actual Canvas and DOM. View the attached manifest.json before publication.</p><main>${cards}</main></html>`;
  fs.writeFileSync(path.join(out, 'contact-sheet.html'), html);
});

async function boot(page) {
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/index.html', {waitUntil: 'domcontentloaded'});
  await expect(page.locator('#startBtn')).toBeVisible();
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
  await page.evaluate(() => {
    nextBossTime = 9000;
    totalTime = 105;
    wave = 10;
    score = 26540;
    screenShake = 0;
    applyGraphicsQuality('high', false);
    player.hp = player.maxHp;
    updateHUD();
    // Reproducible placement uses the game's real constructors in Chromium.
    window.__captureSpawnPack=()=>{
      const specs=[
        ['SWARM',-260,-135],['SHOOTER',230,-135],
        ['SHIELD_BEARER',-240,105],['DASHER',245,145],
        ['ASSASSIN',290,15],['TANK',-110,205],
        ['SNIPER',-340,15],['SPLITTER',80,-230]
      ];
      for(const [type,dx,dy] of specs){
        const x=Math.max(55,Math.min(worldWidth-55,player.x+dx));
        const y=Math.max(55,Math.min(worldHeight-55,player.y+dy));
        spawnEnemy(false,type,false,{x,y});
      }
    };
  });
  return errors;
}
async function still(page, name, title, description, errors, check) {
  await page.evaluate(() => { screenShake = 0; updateHUD(); renderGame(); });
  if (check) await check();
  const file = `${name}.png`;
  const dest = path.join(out, file);
  const png = await page.screenshot({
    path: dest, fullPage: false, animations: 'disabled',
    caret: 'hide', type: 'png'
  });
  expect(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);
  expect(png.length, 'Rendered screenshot should contain real visual detail').toBeGreaterThan(18000);
  expect(errors).toEqual([]);
  manifest.push({file,title,description,viewport:page.viewportSize(),bytes:png.length});
}

test('real active combat and cockpit screenshot', async ({page}) => {
  const errors=await boot(page);
  const count=await page.evaluate(() => {
    window.__captureSpawnPack();
    player.autoShoot();
    return enemies.length;
  });
  expect(count).toBeGreaterThanOrEqual(7);
  await still(page,'01-combat','Active arena combat',
    'Live engine, tactical enemies and the Combat Cockpit. Scripted placement for review.', errors);
});

test('real volatile reactor and visible fuse screenshot', async ({page}) => {
  const errors=await boot(page);
  const x=await page.evaluate(()=>{
    window.__captureSpawnPack();
    const d=spawnFieldDevice('CAPACITOR',player.x+177,player.y+45);
    triggerFieldDevice(d,'shot');
    updateFieldDeviceHud();
    return {state:d.state,source:d.source,fuse:d.fuse};
  });
  expect(x.state).toBe('armed');
  expect(x.source).toBe('shot');
  await still(page,'02-reactor','Volatile reactor · risk and warning',
    'Actual armed reactor with blast telegraph; triggered by scripted fixture.', errors,
    async()=>expect(page.locator('#fieldDeviceBadge')).toBeVisible());
});

test('real graviton field and crowd-control screenshot', async ({page}) => {
  const errors=await boot(page);
  const x=await page.evaluate(()=>{
    window.__captureSpawnPack();
    const d=spawnFieldDevice('GRAVITON',player.x+167,player.y+55);
    triggerFieldDevice(d,'nova');
    updateFieldDeviceHud();
    return {state:d.state,seconds:d.effect};
  });
  expect(x.state).toBe('field');expect(x.seconds).toBeGreaterThan(3);
  await still(page,'03-graviton','Graviton · tactical enemy control',
    'Actual active graviton field, with existing enemies rendered by the live engine.', errors,
    async()=>expect(page.locator('#fieldDeviceBadge')).toBeVisible());
});

test('real boss encounter and boss HUD screenshot', async ({page}) => {
  const errors=await boot(page);
  const info=await page.evaluate(()=>{
    enemies=[];
    spawnBossEncounter();
    for(let i=0;i<activeBosses.length;i++){
      activeBosses[i].x=player.x+235+i*55;
      activeBosses[i].y=player.y-105+i*45;
    }
    return {bosses:activeBosses.length,name:activeBosses[0]?.type};
  });
  expect(info.bosses).toBeGreaterThan(0);
  await still(page,'04-boss','Boss encounter · readable threat identity',
    'Real boss actor, actual game boss HUD; actor position staged inside the viewport.', errors,
    async()=>expect(page.locator('#bossHudContainer')).toBeVisible());
});

test('real upgrade-choice and readable rarity screenshot', async ({page}) => {
  const errors=await boot(page);
  await page.evaluate(()=>triggerLevelUp());
  await expect(page.locator('#upgradeModal')).toBeVisible();
  await expect(page.locator('#upgradeCardsContainer button')).toHaveCount(3);
  await still(page,'05-upgrades','Module choices · real UI',
    'Actual level-up choices generated by the game. Rarities vary across captures.', errors);
});

test('real mobile combat layout screenshot', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  const errors=await boot(page);
  const result=await page.evaluate(()=>{
    window.__captureSpawnPack();
    return {playing:gameState==='PLAYING',enemies:enemies.length};
  });
  expect(result.playing).toBe(true);
  expect(result.enemies).toBeGreaterThanOrEqual(7);
  await still(page,'06-mobile','Mobile combat HUD',
    'Real game at an emulated 390×844 Chromium viewport, not a physical device.', errors,
    async()=>expect(page.locator('#dashBtn')).toBeVisible());
});
