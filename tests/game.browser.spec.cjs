const { test, expect } = require('@playwright/test');
const { gotoGame } = require('./browser.helpers.cjs');

test('menu starts playable canvas and pause/resume flow is interactive', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html');
  await expect(page.locator('#startBtn')).toBeVisible();
  const position = await page.locator('#startBtn').boundingBox();
  expect(position).not.toBeNull();
  expect(position.width).toBeGreaterThan(100);
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
  const result = await page.evaluate(() => {
    const touch = new Touch({ identifier: 1, target: canvas, clientX: 180, clientY: 270 });
    canvas.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], targetTouches: [touch], changedTouches: [touch], bubbles: true }));
    const active = touchStick.id === 1 && touchStick.originX === 180;
    canvas.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [touch], bubbles: true }));
    return { active, ended: touchStick.id === null };
  });
  expect(result).toEqual({ active: true, ended: true });
});

test('Odak 2.3 joystick drag moves the core and an ability tap does not stop it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'real multi-touch is checked in mobile Chromium');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoGame(page, '/index.html');
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
  await page.evaluate(() => {
    enemies = []; enemyProjectiles = []; nextBossTime = 9999;
    player.invulnTimer = 99; player.xpToNext = 1e9;
    player.x = player.lastPos.x = 30; player.y = player.lastPos.y = worldHeight * .45;
  });
  const nova = await page.locator('#novaBtn').boundingBox();
  expect(nova).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const stick = (x, y) => ({ x, y, id: 1 });
  const tap = { x: nova.x + nova.width / 2, y: nova.y + nova.height / 2, id: 2 };
  const y = 300;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick(60, y)] });
  for (let dx = 10; dx <= 70; dx += 10)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [stick(60 + dx, y)] });
  const x0 = await page.evaluate(() => player.x);
  await page.waitForTimeout(450);
  const beforeTap = await page.evaluate(() => player.x);
  expect(beforeTap).toBeGreaterThan(x0);
  // Second finger taps EMP while the first keeps holding the stick.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [stick(130, y), tap] });
  // CDP lists the released points on touchEnd: only the EMP finger lifts.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [tap] });
  await page.waitForTimeout(150);
  const afterTap = await page.evaluate(() => ({ x: player.x, id: touchStick.id, emp: player.novaCooldown > 0 }));
  await page.waitForTimeout(400);
  const later = await page.evaluate(() => player.x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [stick(130, y)] });
  expect(afterTap.emp).toBe(true);
  expect(afterTap.id).not.toBeNull();
  expect(afterTap.x).toBeGreaterThan(beforeTap);
  expect(later).toBeGreaterThan(afterTap.x + 40);
  await expect.poll(() => page.evaluate(() => touchStick.id)).toBeNull();
  expect(errors).toEqual([]);
});

test('portable JSON backup can be downloaded and restored through the menu', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html?perf=1');
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
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html');
  await expect(page.locator('[data-neon-contract]')).toHaveCount(4);
  await expect(page.locator('#neonContractOptions')).toContainText('USTALIK 0/3');
  await expect.poll(() => page.evaluate(() => Object.keys(window.getNeonContractMastery()).length)).toBe(4);
});

test('real browser game-over, menu return and restart remain fully navigable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html');
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
  await gotoGame(page,'/index.html?perf=1');
  await page.locator('#startBtn').click();
  await page.evaluate(() => {
    // This isolated browser fixture ignores damage, not the production game rules.
    // A stationary player otherwise dies during the soak on narrow mobile viewports.
    player.takeDamage = () => {};
    player.hp = player.maxHp;
    // Isolated performance soak must not randomly pause at a level-up modal.
    // Keep orb pickup and XP bookkeeping active; raise ONLY this fixture's goal.
    player.xpToNext = 1_000_000_000;
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
  await gotoGame(page,'/index.html',{waitUntil:'networkidle'});
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


test('gold-only bastion can be deployed via the combat HUD without opening upgrade cards', async ({ page }) => {
 const errors=[];
 page.on('pageerror', err=>errors.push(err.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{
   player.takeDamage=()=>{};
   wave=8; nextBossTime=500; totalGold=500;
   player.x=worldWidth/2;player.y=worldHeight/2;
   updateHUD();
 });
 await expect(page.locator('#bastionBtn')).toBeEnabled();
 await page.locator('#bastionBtn').click();
 await expect(page.locator('#bastionStatus')).toContainText('s');
 const state=await page.evaluate(()=>({
   gold:totalGold, deployed:!!bastion, position: bastion?{x:bastion.x,y:bastion.y}:null,
   upgrades:player.upgradeCounts, used:window.getNeonBastionStatus().uses,
   modal:document.getElementById('upgradeModal').classList.contains('hidden')
 }));
 expect(state.gold).toBe(430);
 expect(state.deployed).toBe(true);
 expect(state.used).toBe(1);
 expect(state.modal).toBe(true);
 expect(Object.keys(state.upgrades)).toHaveLength(0);
 await page.keyboard.press('q');
 expect(await page.evaluate(()=>totalGold)).toBe(430);
 expect(errors).toEqual([]);
});


test('Phase Echo upgrade produces a visible tactical decoy after dash without spending gold', async ({page})=>{
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const before=await page.evaluate(()=>{
   player.upgradeCounts.phase_echo=1;
   player.refreshBuildTraits();
   player.takeDamage=()=>{};
   nextBossTime=500;
   enemies=[new Enemy(player.x+30,player.y,'SWARM')];
   const gold=totalGold;
   player.triggerDash();
   player.update(.2);
   return {gold,deployed:window.getNeonPhaseEcho().deployed,active:window.getNeonPhaseEcho().active,
     redirected:getPhaseEchoTarget(enemies[0])!==null,card:player.upgradeCounts.phase_echo};
 });
 expect(before.deployed).toBe(1);
 expect(before.active).toBe(1);
 expect(before.redirected).toBe(true);
 expect(before.card).toBe(1);
 expect(await page.evaluate(()=>totalGold)).toBe(before.gold);
 expect(errors).toEqual([]);
});


test('Circuit Weaver closes a drawn loop in Chromium, hits enclosed enemy and leaves gold unchanged', async ({page})=>{
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   player.upgradeCounts.circuit_weaver=3;
   player.refreshBuildTraits();
   player.takeDamage=()=>{};
   const initialGold=totalGold;
   const target=new Enemy(360,260,'TANK');
   target.hp=target.maxHp=1000;
   enemies=[target];
   player.x=300;player.y=200;recordCircuitWeaverMotion(player,0,false);
   const route=[];
   for(let n=1;n<=6;n++)route.push([300+n*20,200]);
   for(let n=1;n<=6;n++)route.push([420,200+n*20]);
   for(let n=1;n<=6;n++)route.push([420-n*20,320]);
   for(let n=1;n<=6;n++)route.push([300,320-n*20]);
   for(const [x,y] of route){player.x=x;player.y=y;totalTime+=.07;recordCircuitWeaverMotion(player,20,false);}
   const result=window.getNeonCircuitWeaver();
   return {initialGold,afterGold:totalGold,targetHp:target.hp,stats:result,
     otherModules:player.upgradeCounts.phase_echo||0};
 });
 expect(result.initialGold).toBe(result.afterGold);
 expect(result.targetHp).toBeLessThan(1000);
 expect(result.stats.closures).toBe(1);
 expect(result.stats.pulseHits).toBe(1);
 expect(result.stats.fieldActive).toBe(true);
 expect(result.otherModules).toBe(0);
 expect(errors).toEqual([]);
});


test('arena chapters change visual HUD identity and rift teleports without spending gold',async({page})=>{
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const steps=await page.evaluate(()=>{
   player.takeDamage=()=>{};
   nextBossTime=500;
   wave=6;updateArenaChapter(.02);updateArenaChapterHud();
   const first={badge:document.getElementById('arenaChapterBadge').textContent,
     mode:document.getElementById('hud').getAttribute('data-arena-chapter')};
   wave=9;updateArenaChapter(.02);updateArenaChapterHud();
   const second={badge:document.getElementById('arenaChapterBadge').textContent,
     mode:document.getElementById('hud').getAttribute('data-arena-chapter')};
   wave=12;updateArenaChapter(.02);updateArenaChapterHud();
   const third={badge:document.getElementById('arenaChapterBadge').textContent,
     mode:document.getElementById('hud').getAttribute('data-arena-chapter')};
   const nodes=getRiftCenters();
   player.x=nodes[0].x;player.y=nodes[0].y;
   const gold=totalGold;
   updateArenaChapter(.02);
   return {first,second,third,warps:getArenaChapterSnapshot().riftWarps,
     playerAtExit:Math.abs(player.x-nodes[1].x)<1,
     gold,afterGold:totalGold};
 });
 expect(steps.first).toEqual({badge:expect.stringContaining('DÖKÜMHANE'),mode:'FOUNDRY'});
 expect(steps.second).toEqual({badge:expect.stringContaining('BAHÇE'),mode:'GARDEN'});
 expect(steps.third).toEqual({badge:expect.stringContaining('YARIK'),mode:'RIFT'});
 expect(steps.warps).toBe(1);
 expect(steps.playerAtExit).toBe(true);
 expect(steps.afterGold).toBe(steps.gold);
 await expect(page.locator('#arenaChapterAnnouncement')).toBeVisible();
 expect(errors).toEqual([]);
});


test('M5.18 chapter chip shows terrain status only while the chapter is dangerous',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 // Fixture: skip the 5 s entry announcement so the chip itself is on screen.
 const enter=w=>page.evaluate(w=>{nextBossTime=500;wave=w;updateArenaChapter(.02);
   chapterAnnounceUntil=0;updateArenaChapterHud();},w);
 await page.evaluate(()=>{totalTime=23.7;});
 await enter(6);
 const chip=page.locator('#arenaChapterChip');
 const status=page.locator('#arenaChapterStatus');
 await expect(chip).toBeVisible();
 await expect(chip).toContainText('DÖKÜMHANE');
 await expect(status).toBeVisible();
 await expect(status).toContainText('ISI YÜKLENİYOR');
 await page.evaluate(()=>{totalTime+=1.55;updateArenaChapterHud();});
 await expect(status).toContainText('RAYLARDAN KAÇ');
 await expect(status).toBeVisible();
 await enter(9);
 await expect(status).toHaveText(/İYON DOLDUR/);
 await expect(status).toBeHidden();
 await expect(chip).toBeVisible();
 await enter(12);
 await expect(status).toHaveText(/İKİ GEÇİT AKTİF/);
 await expect(status).toBeHidden();
 await expect(chip).toBeVisible();
 expect(errors).toEqual([]);
});



test('M5.19 contested garden and warned rift pursuit have readable HUD in Chromium',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   wave=9;nextBossTime=500;updateArenaChapter(.02);
   const n=getGardenCenters()[0];
   player.x=n.x;player.y=n.y;
   enemies=[new Enemy(n.x+12,n.y+12,'SHOOTER')];
   updateArenaChapter(.2);updateArenaChapterHud();
   const garden=document.getElementById('arenaChapterStatus').textContent;
   wave=12;updateArenaChapter(.02);
   const nodes=getRiftCenters();
   player.x=nodes[0].x;player.y=nodes[0].y;
   enemies=[new Enemy(nodes[0].x+10,nodes[0].y+8,'ASSASSIN')];
   updateArenaChapter(.02);updateArenaChapter(.02);updateArenaChapterHud();
   return {garden,rift:document.getElementById('arenaChapterStatus').textContent,
     pursuit:getArenaChapterSnapshot().riftPursuit,
     gold:totalGold};
 });
 expect(result.garden).toContain('İYON BASKISI');
 expect(result.rift).toContain('YARIK TAKİPÇİSİ');
 expect(result.pursuit?.remaining).toBeGreaterThan(0);
 expect(result.gold).toBe(50);
 expect(errors).toEqual([]);
});


test('M5.20 three signature operations display unique stage callouts in Chromium',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const stages=await page.evaluate(()=>{
   nextBossTime=1000;
   const result={};
   for(const [w,id] of [[7,'FOUNDRY'],[10,'GARDEN'],[13,'RIFT']]){
     wave=w;waveTimer=2;enemies=[new Enemy(360,300,'SHOOTER')];
     updateArenaChapter(.02);updateArenaChapterHud();
     const banner=document.getElementById('arenaShowcaseBanner');
     result[id]={name:banner.textContent,hidden:banner.classList.contains('hidden'),
       telemetry:getArenaChapterSnapshot().showcase,gold:totalGold};
   }
   return result;
 });
 expect(stages.FOUNDRY.name).toContain('KIZIL MAKAS');
 expect(stages.GARDEN.name).toContain('İYON KOROSU');
 expect(stages.RIFT.name).toContain('FAZ KISKACI');
 expect(Object.values(stages).every(x=>!x.hidden&&x.telemetry?.id)).toBe(true);
 expect(Object.values(stages).every(x=>x.gold===50)).toBe(true);
 await expect(page.locator('#arenaShowcaseBanner')).toBeVisible();
 expect(errors).toEqual([]);
});


test('M5.21 Echo Hunter visibly announces stationary, moving and dashing player reads',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   const poolBefore=UPGRADES_POOL.map(u=>u.id).join();
   const setupHunter=()=>{
     startNewGame();
     wave=10;waveTimer=2;nextBossTime=5000;totalTime=100;
     enemies=[new Enemy(70,70,'SHOOTER')];
     updateNemesis(.02);
   };
   setupHunter();
   updateNemesisHud();
   const initial={label:document.getElementById('nemesisBanner').textContent,
     hidden:document.getElementById('nemesisBanner').classList.contains('hidden')};
   totalTime=101.65;updateNemesis(.02);updateNemesisHud();
   const lock={kind:getNemesisSnapshot().attack?.kind,
     label:document.getElementById('nemesisBanner').textContent};
   setupHunter();
   for(let i=0;i<9;i++){totalTime+=.2;player.x+=30;updateNemesis(.02);}
   updateNemesisHud();
   const trail={kind:getNemesisSnapshot().attack?.kind,
     label:document.getElementById('nemesisBanner').textContent};
   setupHunter();
   totalTime=100.6;player.isDashing=true;updateNemesis(.02);
   player.isDashing=false;totalTime=101.7;updateNemesis(.02);
   updateNemesisHud();
   const cross={kind:getNemesisSnapshot().attack?.kind,
     label:document.getElementById('nemesisBanner').textContent};
   return {initial,lock,trail,cross,gold:totalGold,poolSame:UPGRADES_POOL.map(u=>u.id).join()===poolBefore};
 });
 expect(result.initial.hidden).toBe(false);
 expect(result.initial.label).toContain('YANKI AVCISI');
 expect(result.lock).toMatchObject({kind:'LOCK',label:expect.stringContaining('SABİT NOKTA')});
 expect(result.trail).toMatchObject({kind:'TRAIL',label:expect.stringContaining('HAREKET İZİ')});
 expect(result.cross).toMatchObject({kind:'CROSS',label:expect.stringContaining('ÇAPRAZ KİLİT')});
 expect(result.gold).toBe(50);
 expect(result.poolSame).toBe(true);
 await expect(page.locator('#nemesisBanner')).toBeVisible();
 expect(errors).toEqual([]);
});


test('M5.22 keyboard C and touch Prism Riposte deflect a real projectile in Chromium',async({page,isMobile})=>{
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 // Freeze the live loop for the whole test: under parallel load real frames
 // could otherwise land the shot or change state between evaluate steps.
 await page.evaluate(()=>{
   window.__m522Update=updateGame;updateGame=()=>{};
   totalTime=10;nextBossTime=500;
   const shot=new EnemyProjectile(player.x+72,player.y,-360,0,6,25);
   enemyProjectiles=[shot];enemies=[];
 });
 await page.keyboard.press('c');
 const result=await page.evaluate(()=>{
   const wasActive=getNeonPrismGuard().active;
   const hp=player.hp;
   window.__m522Update(.016);
   updatePrismGuardHud();
   const state=getNeonPrismGuard();
   return {wasActive,hp,afterHp:player.hp,state,
     shots:bullets.filter(b=>b.prismRiposte).length,
     label:document.getElementById('prismStatus').textContent};
 });
 expect(result.wasActive).toBe(true);
 expect(result.state.stats.deflected).toBe(1);
 expect(result.state.stats.shotsReturned).toBe(1);
 expect(result.shots).toBe(1);
 expect(result.afterHp).toBe(result.hp);
 expect(result.label).toContain('KARŞILA');
 await expect(page.locator('#prismBtn')).toBeVisible();
 await page.evaluate(()=>{totalTime+=8.6;updatePrismGuard();updatePrismGuardHud();});
 // Odak 2.3: phones fire on pointerdown; the trailing click must not double-fire.
 if(isMobile) await page.locator('#prismBtn').tap();
 else await page.locator('#prismBtn').click();
 expect(await page.evaluate(()=>getNeonPrismGuard().stats.activations)).toBe(2);
 await page.evaluate(()=>{updateGame=window.__m522Update;});
 expect(errors).toEqual([]);
});


test('M5.22 all four touch combat controls fit the phone viewport without overlap',async({page,isMobile})=>{
 test.skip(!isMobile,'phone-only combat command geometry');
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const ids=['bastionBtn','novaBtn','prismBtn','dashBtn'];
 const positions=await page.evaluate(ids=>({
   width:window.innerWidth,
   buttons:ids.map(id=>{
     const rect=document.getElementById(id).getBoundingClientRect();
     return {id,x:rect.x,right:rect.right,width:rect.width,height:rect.height};
   })
 }),ids);
 for(const item of positions.buttons){
   expect(item.width).toBeGreaterThan(35);
   expect(item.height).toBeGreaterThan(30);
   expect(item.x).toBeGreaterThanOrEqual(-1);
   expect(item.right).toBeLessThanOrEqual(positions.width+1);
 }
 for(let i=1;i<positions.buttons.length;i++)
   expect(positions.buttons[i].x).toBeGreaterThanOrEqual(
     positions.buttons[i-1].right-1);
});


test('M5.23 upgrade cards prioritize readable type and responsive one/two/three-column layout',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await page.evaluate(()=>triggerLevelUp());
 await expect(page.locator('#upgradeCardsContainer .upgrade-card')).toHaveCount(3);
 await page.evaluate(()=>document.fonts.ready);
 for(const [width,height,expectedColumns] of [[360,740,1],[768,1024,2],[1024,768,2],[1440,900,3]]){
   await page.setViewportSize({width,height});
   const result=await page.evaluate(()=>{
     const modal=document.getElementById('upgradeModal');
     const cards=[...document.querySelectorAll('#upgradeCardsContainer .upgrade-card')];
     const cols=getComputedStyle(document.getElementById('upgradeCardsContainer')).gridTemplateColumns
       .split(' ').filter(Boolean).length;
     return {cols,overflow:modal.scrollWidth-modal.clientWidth,
       cards:cards.map(card=>{
         const r=card.getBoundingClientRect();
         const desc=card.querySelector('.upgrade-card-desc');
         const footer=card.querySelector('.upgrade-card-footer');
         const title=card.querySelector('.upgrade-card-name');
         const rarity=card.querySelector('.upgrade-rarity-title');
         const role=card.querySelector('.upgrade-role-label');
         const parts=[desc,footer,title,rarity,role];
         const ranges=parts.map(node=>({
           font:parseFloat(getComputedStyle(node).fontSize),
           bottom:node.getBoundingClientRect().bottom,
           right:node.getBoundingClientRect().right,
           left:node.getBoundingClientRect().left,
           scrollWidth:node.scrollWidth,clientWidth:node.clientWidth
         }));
         return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,
           width:r.width,height:r.height,parts:ranges};
       })};
   });
   expect(result.cols, 'column count at '+width).toBe(expectedColumns);
   expect(result.overflow, 'horizontal overflow at '+width).toBeLessThanOrEqual(3);
   for(const card of result.cards){
     expect(card.left).toBeGreaterThanOrEqual(-2);
     expect(card.right).toBeLessThanOrEqual(width+2);
     expect(card.width).toBeGreaterThan(230);
     expect(card.parts[0].font).toBeGreaterThanOrEqual(16);
     expect(card.parts[1].font).toBeGreaterThanOrEqual(13);
     expect(card.parts[2].font).toBeGreaterThanOrEqual(21);
     expect(card.parts[3].font).toBeGreaterThanOrEqual(12);
     expect(card.parts[4].font).toBeGreaterThanOrEqual(12);
     for(const part of card.parts){
       expect(part.bottom, 'text clipped vertically at '+width).toBeLessThanOrEqual(card.bottom+2);
       expect(part.left, 'text clipped left at '+width).toBeGreaterThanOrEqual(card.left-1);
       expect(part.right, 'text clipped right at '+width).toBeLessThanOrEqual(card.right+1);
       expect(part.scrollWidth-part.clientWidth,'text overflows at '+width).toBeLessThanOrEqual(2);
     }
   }
 }
 expect(errors).toEqual([]);
});

test('M5.23 longest evolution and synergy text stays inside natural-height cards on phones',async({page})=>{
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{
   triggerLevelUp();
   const upg=UPGRADES_POOL.find(x=>x.id==='circuit_weaver');
   const rarity=RARITIES.find(r=>r.id==='LEGENDARY');
   const presentation=getUpgradeCardPresentation(upg,rarity,2);
   const card=document.querySelector('#upgradeCardsContainer .upgrade-card');
   card.setAttribute('data-role','evolution');
   card.setAttribute('data-rarity','LEGENDARY');
   card.innerHTML=renderUpgradeCardMarkup(upg,rarity,2,0,presentation,[{
     name:'Rezonans Senkronizasyonu',
     desc:'Hareket hâlindeyken oluşan devre ile enerji akışını birleştirerek düşman baskısını dağıtır.'
   }]);
 });
 for(const [width,height] of [[320,568],[375,667],[768,740],[1280,800]]){
   await page.setViewportSize({width,height});
   const result=await page.evaluate(()=>{
     const card=document.querySelector('#upgradeCardsContainer .upgrade-card');
     const last=card.querySelector('.upgrade-card-footer');
     const bonus=card.querySelector('.upgrade-evolution-benefit');
     const synergy=card.querySelector('.upgrade-synergy-benefit');
     const modal=document.getElementById('upgradeModal');
     const cr=card.getBoundingClientRect();
     return {cardLeft:cr.left,cardRight:cr.right,cardBottom:cr.bottom,
       footerBottom:last.getBoundingClientRect().bottom,
       bonusBottom:bonus.getBoundingClientRect().bottom,
       synergyBottom:synergy.getBoundingClientRect().bottom,
       synergyFont:parseFloat(getComputedStyle(synergy).fontSize),
       bonusFont:parseFloat(getComputedStyle(bonus).fontSize),
       horizontalOverflow:modal.scrollWidth-modal.clientWidth};
   });
   expect(result.cardLeft).toBeGreaterThanOrEqual(-2);
   expect(result.cardRight).toBeLessThanOrEqual(width+2);
   expect(result.footerBottom).toBeLessThanOrEqual(result.cardBottom+2);
   expect(result.bonusBottom).toBeLessThanOrEqual(result.cardBottom+2);
   expect(result.synergyBottom).toBeLessThanOrEqual(result.cardBottom+2);
   expect(result.horizontalOverflow).toBeLessThanOrEqual(3);
   expect(result.bonusFont).toBeGreaterThanOrEqual(14);
   expect(result.synergyFont).toBeGreaterThanOrEqual(14);
   await page.locator('#upgradeCardsContainer .upgrade-card').first().scrollIntoViewIfNeeded();
   await expect(page.locator('#upgradeCardsContainer .upgrade-card').first()).toBeVisible();
 }
 await page.keyboard.press('1');
 await expect(page.locator('#upgradeModal')).toBeHidden();
});


test('M5.24 Neon Motion reacts to live dash, Nova and Overdrive with distinct canvas motifs',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const x=await page.evaluate(()=>{
   nextBossTime=5000;graphicsQuality='high';totalTime=10;
   player.dashDir={x:1,y:0};
   player.triggerDash();
   updateGame(.04);
   player.triggerNova();
   player.addOverdrive(200);
   const before=window.getNeonMotionFx();
   renderGame();
   const after=window.getNeonMotionFx();
   return {before,after,gold:totalGold};
 });
 expect(x.before.byKind.DASH).toBeGreaterThan(0);
 expect(x.before.byKind.NOVA).toBe(1);
 expect(x.before.byKind.OVERDRIVE).toBe(1);
 expect(x.before.active).toBeLessThanOrEqual(64);
 expect(x.after.drawn).toBeGreaterThan(0);
 expect(x.gold).toBe(50);
 expect(errors).toEqual([]);
});

test('M5.24 all three graphics profiles cap motion drawing under sustained effect storms',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const values=await page.evaluate(()=>{
   nextBossTime=5000;
   const out={};
   for(const quality of ['high','medium','low']){
     graphicsQuality=quality;
     resetMotionFx();
     for(let frame=0;frame<120;frame++){
       motionFxFrameCount=0;
       for(let i=0;i<15;i++)emitMotionFx('PRISM',player.x,player.y);
       updateMotionFx(.016);
     }
     renderGame();
     const snapshot=getNeonMotionFx();
     out[quality]={active:snapshot.active,limit:snapshot.limit,
       perFrame:snapshot.perFrame,peak:snapshot.highWater,
       dropped:snapshot.capDropped+snapshot.frameDropped,drawn:snapshot.drawn};
   }
   return out;
 });
 for(const [quality,value] of Object.entries(values)){
   expect(value.active,quality).toBeLessThanOrEqual(value.limit);
   expect(value.peak,quality).toBeLessThanOrEqual(value.limit);
   expect(value.dropped,quality).toBeGreaterThan(100);
   expect(value.drawn,quality).toBeGreaterThan(0);
 }
 expect(values.low.limit).toBeLessThan(values.high.limit);
 expect(errors).toEqual([]);
});

test('M5.24 reduced motion keeps boss/wave readability but avoids repeated dash and ambient animation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.emulateMedia({reducedMotion:'reduce'});
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   nextBossTime=5000;
   const dash=emitMotionFx('DASH',player.x,player.y);
   const kill=emitMotionFx('KILL',player.x,player.y);
   const boss=emitMotionFx('BOSS',player.x,player.y);
   const wave=emitMotionFx('WAVE',player.x,player.y);
   const s=getNeonMotionFx();
   renderGame();
   return {dash,kill,boss,wave,s,preference:PREFERS_REDUCED_VFX_MOTION};
 });
 expect(result.preference).toBe(true);
 expect(result.dash).toBe(false);
 expect(result.kill).toBe(false);
 expect(result.boss).toBe(true);
 expect(result.wave).toBe(true);
 expect(result.s.active).toBe(2);
 expect(errors).toEqual([]);
});


test('M5.25 cockpit fits 320–1440px without covering command controls or losing readable gauges',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{nextBossTime=5000;updateHUD();});
 for(const [width,height] of [[320,568],[360,740],[390,844],[768,800],[1024,768],[1440,900]]){
   await page.setViewportSize({width,height});
   const v=await page.evaluate(()=>{
     const box=el=>{const r=el.getBoundingClientRect();
       return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
     const rect=id=>box(document.getElementById(id));
     const always=[document.querySelector('.hud-health-track'),document.querySelector('.hud-meter-xp'),
       document.getElementById('timeText'),document.getElementById('pauseBtn')].map(box);
     const skills=['bastionBtn','novaBtn','prismBtn','dashBtn'].map(rect);
     const font=el=>parseFloat(getComputedStyle(el).fontSize);
     return {always,skills,
       fonts:[font(document.getElementById('hpText')),font(document.querySelector('.hud-meter-level'))],
       row:document.querySelector('.hud-status-row').getBoundingClientRect().bottom,
       command:document.querySelector('.hud-action-bay').getBoundingClientRect().top,
       overflow:document.documentElement.scrollWidth-innerWidth};
   });
   expect(v.overflow, 'horizontal overflow at '+width).toBeLessThanOrEqual(3);
   for(const item of [...v.always,...v.skills]){
     expect(item.left, 'item left at '+width).toBeGreaterThanOrEqual(-2);
     expect(item.right,'item right at '+width).toBeLessThanOrEqual(width+2);
     expect(item.width).toBeGreaterThan(0);
   }
   expect(v.row,'top HUD overlaps action bay at '+width).toBeLessThan(v.command);
   for(const button of v.skills)expect(button.height).toBeGreaterThanOrEqual(43);
   for(const size of v.fonts)expect(size).toBeGreaterThanOrEqual(11);
   for(let i=1;i<v.skills.length;i++){
     expect(v.skills[i].left,'combat skills overlap at '+width)
       .toBeGreaterThanOrEqual(v.skills[i-1].right-2);
   }
 }
 expect(errors).toEqual([]);
});

test('M5.25 damage and boss state change cockpit hierarchy, progress bars remain accessible',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const r=await page.evaluate(()=>{
   nextBossTime=5000;
   updateHUD();
   const initial=document.getElementById('hud').dataset.vital;
   player.hp=player.maxHp*.2;
   updateHUD();
   const critical=document.getElementById('hud').dataset.vital;
   const hp=document.getElementById('hpBar');
   const hpAria={role:hp.getAttribute('role'),value:hp.getAttribute('aria-valuenow')};
   const s=['dashBtn','novaBtn','prismBtn'].map(id=>document.getElementById(id).dataset.ready);
   const arch=new Enemy(player.x+140,player.y,'BOSS_DESTROYER');
   activeBosses.push(arch);
   updateHUD();
   const boss=document.getElementById('hud').dataset.combatAlert;
   const color=getComputedStyle(document.querySelector('.hud-clock')).borderTopColor;
   return {initial,critical,hpAria,s,boss,color};
 });
 expect(r.initial).toBe('steady');
 expect(r.critical).toBe('critical');
 expect(r.hpAria).toEqual({role:'progressbar',value:'20'});
 expect(r.s).toEqual(['true','true','true']);
 expect(r.boss).toBe('boss');
 expect(r.color).toBe('rgba(255, 98, 138, 0.8)');
 expect(errors).toEqual([]);
});

test('M5.25 reduced-motion and low graphics keep HUD legible without decorative animation cost',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const r=await page.evaluate(()=>{
   player.hp=player.maxHp*.15;updateHUD();
   const first=getComputedStyle(document.querySelector('.hud-vitals')).animationName;
   applyGraphicsQuality('low',false);
   const slot=getComputedStyle(document.getElementById('dashBtn'));
   const title=getComputedStyle(document.getElementById('timeText'));
   return {animation:first,shadow:slot.boxShadow,font:parseFloat(title.fontSize)};
 });
 expect(r.animation).toBe('none');
 expect(r.shadow).toBe('none');
 expect(r.font).toBeGreaterThanOrEqual(14);
});


test('M5.26 capacitor has a real on-screen warning, delayed detonation and visual feedback',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const r=await page.evaluate(()=>{
   nextBossTime=5000;totalTime=20;player.invulnTimer=0;player.hasShield=false;
   const d=spawnFieldDevice('CAPACITOR',player.x+145,player.y);
   updateHUD();const idle=document.getElementById('fieldDeviceBadge').textContent;
   const visible=getComputedStyle(document.getElementById('fieldDeviceBadge')).display;
   triggerFieldDevice(d,'shot');updateFieldDevices(.1);updateHUD();
   const warning=document.getElementById('fieldDeviceBadge').textContent;
   const hp=player.hp;
   renderGame();
   updateFieldDevices(.5);updateHUD();renderGame();
   return {idle,visible,warning,hp,afterHp:player.hp,stats:window.getNeonFieldDevices().stats,
     now:window.getNeonFieldDevices().devices.length};
 });
 expect(r.idle).toContain('REAKTÖR');
 expect(r.visible).not.toBe('none');
 expect(r.warning).toContain('PATLAYACAK');
 expect(r.warning).toContain('UZAKLAŞ');
 expect(r.stats.blasts).toBe(1);
 expect(r.now).toBe(0);
 expect(r.hp).toBeGreaterThan(r.afterHp);
 expect(errors).toEqual([]);
});

test('M5.26 graviton field changes true enemy simulation speed and renders at all quality tiers',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const r=await page.evaluate(()=>{
   nextBossTime=5000;
   const d=spawnFieldDevice('GRAVITON',player.x+115,player.y);
   const enemy=new Enemy(d.x+20,d.y,'SWARM');enemy.speed=160;
   triggerFieldDevice(d,'nova');const scale=getFieldEnemyTimeScale(enemy);
   const screens={};
   for(const quality of ['high','medium','low']){
     graphicsQuality=quality;
     renderGame();
     updateFieldDeviceHud();
     screens[quality]={state:window.getNeonFieldDevices().devices[0].state,
       color:getComputedStyle(document.getElementById('fieldDeviceBadge')).color,
       label:document.getElementById('fieldDeviceBadge').textContent};
   }
   return {scale,screens,stats:window.getNeonFieldDevices().stats};
 });
 expect(r.scale).toBe(.55);
 for(const state of Object.values(r.screens)){
   expect(state.state).toBe('field');
   expect(state.label).toContain('YAVAŞ');
 }
 expect(r.stats.gravityFields).toBe(1);
 expect(errors).toEqual([]);
});

test('M5.26 engineering warnings fit small mobile HUD without blocking touch abilities',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{
   nextBossTime=5000;
   const d=spawnFieldDevice('CAPACITOR',player.x,player.y+100);
   triggerFieldDevice(d,'shot');updateHUD();
 });
 for(const [width,height] of [[320,568],[360,740],[768,900],[1440,900]]){
   await page.setViewportSize({width,height});
   const x=await page.evaluate(()=>{
     const chip=document.getElementById('fieldDeviceBadge');
     const rect=chip.getBoundingClientRect();
     const dash=document.getElementById('dashBtn').getBoundingClientRect();
     return {left:rect.left,right:rect.right,bottom:rect.bottom,
       font:parseFloat(getComputedStyle(chip).fontSize),
       dashTop:dash.top,dashH:dash.height,
       scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
   });
   expect(x.left).toBeGreaterThanOrEqual(-2);
   expect(x.right).toBeLessThanOrEqual(width+2);
   expect(x.font).toBeGreaterThanOrEqual(10);
   expect(x.bottom,'warning must not overlap controls at '+width).toBeLessThan(x.dashTop);
   expect(x.dashH).toBeGreaterThanOrEqual(44);
   expect(x.scrollWidth-x.viewport).toBeLessThanOrEqual(3);
 }
 expect(errors).toEqual([]);
});

test('Odak 0.2 ?wave=10 starts the real game directly at wave 10',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html?wave=10');
 await page.locator('#startBtn').click();
 await expect(page.locator('#waveText')).toHaveText('10');
 const state=await page.evaluate(()=>({wave,totalTime,nextBossTime,unlockAll:window.NEON_UNLOCK_ALL===true}));
 expect(state.wave).toBe(10);
 expect(state.totalTime).toBeGreaterThanOrEqual(144);
 expect(state.nextBossTime).toBe(199);
 expect(state.unlockAll).toBe(true); // gotoGame adds ?unlock=all next to ?wave=10
 expect(errors).toEqual([]);
});

test('Odak 1.3 first run without unlocks shows only the core HUD',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html',{unlockAll:false});
 await expect(page.locator('#startBtn')).toBeVisible();
 await expect(page.locator('#neonContractPanel')).toBeHidden();
 await page.locator('#startBtn').click();
 await expect(page.locator('#hud')).toBeVisible();
 for(const id of ['dashBtn','pauseBtn','waveText','timeText','hpBar'])
   await expect(page.locator('#'+id),id+' should stay visible').toBeVisible();
 await expect(page.locator('#pauseModal #scoreText')).toHaveCount(1);
 await expect(page.locator('#xpBar').locator('xpath=..')).toBeVisible();
 for(const id of ['novaBtn','prismBtn','bastionBtn','questHudBox','arenaChapterChip','activeContractBadge'])
   await expect(page.locator('#'+id),id+' should be hidden').toBeHidden();
 await expect(page.locator('#momentumBar').locator('xpath=..')).toBeHidden();
 await expect(page.locator('#overdriveBar').locator('xpath=..')).toBeHidden();
 expect(await page.evaluate(()=>unlockLevel)).toBe(0);
 expect(errors).toEqual([]);
});

test('Odak 1.3 a locked first run plays 3 minutes without errors or locked systems',async({page,isMobile})=>{
 test.skip(!!isMobile,'one simulated 180 s run is enough');
 test.setTimeout(120_000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html',{unlockAll:false});
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   // Fixture: invulnerable pilot, auto-picks the first card. Rules stay real.
   player.takeDamage=()=>{};
   // Steps spent in a modal add no game time, so run until 180 s of play.
   const dt=1/60;let levelUps=0;
   for(let step=0;totalTime<180&&step<200*60;step++){
     if(gameState==='LEVEL_UP'){selectUpgradeOption(0);levelUps++;}
     updateGame(dt);
     if(step%20===0)renderGame();
   }
   return {gameState,totalTime,wave,levelUps,conduits:conduitZones.length,
     fieldDevices:fieldDevices.length,arenaOffered:combatDirector.stats.arenaOffered,
     nemesis:!!nemesis,quest:window.getNeonQuestSnapshot(),overdrive:player.overdrive,
     momentum:player.momentum,contract:activeContractId,chapter:chapterIdForWave(wave)};
 });
 expect(result.totalTime).toBeGreaterThanOrEqual(179);
 expect(result.wave).toBeGreaterThanOrEqual(11);
 expect(['PLAYING','LEVEL_UP']).toContain(result.gameState);
 expect(result).toMatchObject({conduits:0,fieldDevices:0,arenaOffered:0,nemesis:false,
   quest:null,overdrive:0,momentum:0,contract:'STANDARD',chapter:null});
 expect(errors).toEqual([]);
});

test('Odak 1.4 reaching wave 3 on a clean save opens EMP and Quests and spotlights EMP next run',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html',{unlockAll:false});
 await expect(page.locator('#startBtn')).toBeVisible();
 await expect(page.locator('#startModal [data-system="emp"]')).toBeHidden();
 await expect(page.locator('#menuUnlockHint')).toHaveText("Yeni protokol: Dalga 3'e ulaşınca açılır.");
 await page.locator('#startBtn').click();
 await expect(page.locator('#novaBtn')).toBeHidden();
 await page.evaluate(()=>{wave=3;triggerGameOver();});
 const block=page.locator('#reportUnlockBlock');
 await expect(block).toBeVisible();
 await expect(block).toContainText('YENİ PROTOKOL AÇILDI');
 await expect(block).toContainText('EMP Nova');
 await expect(block).toContainText('Görevler');
 await page.locator('#restartBtn').click();
 const nova=page.locator('#novaBtn');
 await expect(nova).toBeVisible();
 await expect(nova).toHaveClass(/system-spotlight/);
 expect(await nova.evaluate(el=>getComputedStyle(el).animationName)).toBe('system-spotlight-pulse');
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await nova.evaluate(el=>{const s=getComputedStyle(el);return [s.animationName,s.outlineStyle];}))
   .toEqual(['none','solid']);
 await page.evaluate(()=>{totalTime+=20;updateHUD();});
 await expect(nova).not.toHaveClass(/system-spotlight/);
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(page.locator('#startModal [data-system="emp"]')).toBeVisible();
 await expect(page.locator('#menuUnlockHint')).toHaveText("Yeni protokol: Dalga 5'e ulaşınca açılır.");
 expect(errors).toEqual([]);
});

test('Odak 1.5 with ?unlock=all the first 60 s add at most two systems besides dash and fire',async({page,isMobile})=>{
 test.skip(!!isMobile,'one simulated run is enough');
 test.setTimeout(120_000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 const seen=await page.evaluate(()=>{
   // Fixture: invulnerable pilot, auto-picks the first card. Rules stay real.
   player.takeDamage=()=>{};
   const firstAt={};
   const mark=(id,on)=>{if(on&&!(id in firstAt))firstAt[id]=Math.round(totalTime*10)/10;};
   for(let step=0;step<240*60;step++){
     if(gameState==='LEVEL_UP')selectUpgradeOption(0);
     updateGame(1/60);
     if(step%20===0)renderGame();
     mark('conduits',conduitZones.length>0);
     mark('fieldDevices',fieldDevices.length>0);
     mark('chapters',!!arenaChapter);
     mark('arenaEvents',!!combatDirector.activeArenaEvent);
     mark('nemesis',!!nemesis);
   }
   return firstAt;
 });
 const early=Object.entries(seen).filter(([,t])=>t<=60);
 expect(early.length,JSON.stringify(seen)).toBeLessThanOrEqual(2);
 const times=Object.values(seen).sort((a,b)=>a-b);
 for(let i=1;i<times.length;i++)
   expect(times[i]-times[i-1],JSON.stringify(seen)).toBeGreaterThanOrEqual(59.9);
 expect(errors).toEqual([]);
});

// Odak 2.2 · desktop HUD diet acceptance.
for(const [width,height] of [[1280,800],[1366,768]]){
test('Odak 2.2 desktop HUD at '+width+'x'+height+' keeps one thin top row and 48 px ability icons',async({page,isMobile})=>{
 test.skip(!!isMobile,'desktop layout');
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height});
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 // Fixture: a calm moment; combo pinned as in the geometry note from Odak 0.1.
 const calm=await page.evaluate(()=>{
   nextBossTime=5000;combo=1;comboTimer=0;score=12345;resetContextualHud();updateHUD();
   const r=el=>el.getBoundingClientRect();
   const row=r(document.querySelector('.hud-status-row'));
   const bay=r(document.querySelector('.hud-action-bay'));
   const skills=['bastionBtn','novaBtn','prismBtn','dashBtn'].map(id=>{
     const b=r(document.getElementById(id));
     const key=document.querySelector('#'+id+' .skill-key');
     return {w:Math.round(b.width),h:Math.round(b.height),key:key.textContent,
       keyVisible:key.checkVisibility(),text:document.querySelector('#'+id+' .skill-text').checkVisibility()};
   });
   const shown=sel=>document.querySelector(sel).checkVisibility({opacityProperty:true});
   return {rowHeight:row.height,rowBottom:row.bottom,bayTop:bay.top,skills,
     context:['#hudScoreChip','#goldHudChip','#questHudBox','#comboContainer','#momentumMeter','#overdriveMeter','#arenaChapterChip'].map(shown),
     score:document.getElementById('hudScoreText').textContent,
     comboLow:document.getElementById('comboContainer').dataset.low,
     removed:['#directorPhaseText','#arenaChapterMobile','#questMobileText'].map(sel=>!!document.querySelector(sel)),
     inHud:['#scoreText','#ctrlToggleBtn','#musicToggleBtn','#soundToggleBtn','#fullscreenBtn','#buildGuidePanel','#activeContractBadge']
       .map(sel=>!!document.querySelector('#hud '+sel)),
     progress:['xpBar','hpBar','momentumBar','overdriveBar'].map(id=>document.getElementById(id).getAttribute('role'))};
 });
 expect(calm.rowHeight).toBeLessThanOrEqual(56);
 expect((calm.bayTop-calm.rowBottom)/height,'free play band').toBeGreaterThanOrEqual(0.80);
 expect(calm.skills.map(s=>[s.w,s.h])).toEqual([[48,48],[48,48],[48,48],[48,48]]);
 expect(calm.skills.map(s=>s.key)).toEqual(['Q','E','C','␣']);
 expect(calm.skills.every(s=>s.keyVisible&&!s.text)).toBe(true);
 // Odak 2.7b · desktop keeps score, gold, quest and combo on screen; the
 // gauges and the chapter chip stay contextual. A low combo is dimmed.
 expect(calm.context).toEqual([true,true,true,true,false,false,false]);
 expect(calm.score).toBe((12345).toLocaleString('tr-TR'));
 expect(calm.comboLow).toBe('true');
 expect(calm.removed).toEqual([false,false,false]);
 expect(calm.inHud).toEqual([false,false,false,false,false,false,false]);
 expect(calm.progress).toEqual(['progressbar','progressbar','progressbar','progressbar']);

 // One boss: a single bar of at most 40 px, no second per-boss bar.
 const boss=await page.evaluate(()=>{
   activeBosses=[new Enemy(player.x+300,player.y,'BOSS_DESTROYER')];
   document.getElementById('bossHudContainer').classList.remove('hidden');updateHUD();
   const one={h:document.getElementById('bossHudContainer').getBoundingClientRect().height,
     names:document.getElementById('bossIdentityStrip').children.length};
   activeBosses.push(new Enemy(player.x-300,player.y,'BOSS_PRISM'));updateHUD();
   const strip=document.getElementById('bossIdentityStrip');
   const chips=[...strip.children].map(c=>c.getBoundingClientRect().top);
   return {one,names:strip.children.length,oneLine:new Set(chips.map(Math.round)).size,
     meters:strip.querySelectorAll('.boss-id-meter').length};
 });
 expect(boss.one.h).toBeLessThanOrEqual(40);
 expect(boss.one.names).toBe(0);
 expect(boss.names).toBe(2);
 expect(boss.oneLine).toBe(1);
 expect(boss.meters).toBe(0);

 // Contextual items come and go with their state.
 const context=await page.evaluate(()=>{
   activeBosses=[];document.getElementById('bossHudContainer').classList.add('hidden');
   const shown=sel=>document.getElementById(sel).dataset.context;
   combo=6;comboTimer=2;totalGold+=10;player.overdrive=85;updateHUD();
   const on=['comboContainer','goldHudChip','overdriveMeter'].map(shown);
   combo=1;player.overdrive=0;totalTime+=2.1;updateHUD();
   const off=['comboContainer','goldHudChip','overdriveMeter'].map(shown);
   return {on,off};
 });
 expect(context.on).toEqual(['on','on','on']);
 expect(context.off).toEqual(['off','off','off']);

 // Settings moved to the pause menu and still work there.
 await page.keyboard.press('KeyP');
 await expect(page.locator('#pauseModal')).toBeVisible();
 for(const id of ['scoreText','ctrlToggleBtn','musicToggleBtn','soundToggleBtn','fullscreenBtn','buildGuidePanel'])
   await expect(page.locator('#pauseModal #'+id),id).toBeVisible();
 const music=await page.evaluate(()=>audio.musicEnabled);
 await page.locator('#musicToggleBtn').click();
 expect(await page.evaluate(()=>audio.musicEnabled)).toBe(!music);
 expect(errors).toEqual([]);
});
}

// Odak 2.4 · phone portrait HUD acceptance (real touch contexts).
for(const [width,height] of [[320,568],[390,664]]){
test('Odak 2.4 phone portrait HUD at '+width+'x'+height+' keeps one top row and a thumb arc',async({browser,isMobile},testInfo)=>{
 test.skip(!isMobile,'runs once, in the mobile project');
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,
   viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await expect(page.locator('#hud')).toBeVisible();
 await page.evaluate(()=>{
   updateGame=()=>{};
   combo=1;comboTimer=0;resetContextualHud();
   player.xp=player.xpToNext/2;player.momentum=100;player.overdrive=90;updateHUD();
   showContextual(document.getElementById('questHudBox'),9000);
 });
 // Contextual chips fade in for 0.22 s.
 await page.waitForTimeout(350);
 const r=await page.evaluate(()=>{
   const box=el=>el.getBoundingClientRect();
   const vis=el=>el.checkVisibility({opacityProperty:true,visibilityProperty:true});
   const row=['.hud-vitals','#xpMeter','.hud-clock','#pauseBtn'].map(s=>box(document.querySelector(s)));
   const skills=['bastionBtn','novaBtn','prismBtn','dashBtn'].map(id=>{
     const el=document.getElementById(id);const b=box(el);
     return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,w:b.width,h:b.height,
       round:getComputedStyle(el).borderRadius==='50%'};
   });
   const hints=[...document.querySelectorAll('#hud *')].filter(el=>vis(el)&&
     [...el.childNodes].some(n=>n.nodeType===3&&/\[|TIK|BOŞLUK|␣/.test(n.textContent)));
   const chips=[...document.querySelectorAll('#hud .hud-chip')].filter(vis).map(box);
   return {row,skills,hints:hints.length,
     // Status text stays for screen readers only (1 px clipped box).
     keysShown:[...document.querySelectorAll('#hud .skill-key,#hud .skill-text')].some(vis)||
       [...document.querySelectorAll('#hud .skill-status')].some(el=>box(el).width>1),
     momentum:vis(document.getElementById('momentumMeter')),
     phoneHidden:['hudScoreChip','goldHudChip','comboContainer'].map(id=>vis(document.getElementById(id))),
     cinnet:vis(document.getElementById('overdriveMeter')),
     cinnetBar:vis(document.getElementById('overdriveBar')),
     cinnetGlow:getComputedStyle(document.getElementById('overdriveMeter')).animationName,
     xpRing:document.getElementById('xpMeter').style.getPropertyValue('--xp'),
     xpBar:vis(document.getElementById('xpBar')),
     chipsBottom:Math.max(...chips.map(c=>c.bottom)),
     settingsInHud:['#ctrlToggleBtn','#musicToggleBtn','#soundToggleBtn','#buildGuidePanel']
       .some(sel=>!!document.querySelector('#hud '+sel))};
 });
 // One top row of at most 48 px: vitals, level ring, clock, pause.
 const rowTop=Math.min(...r.row.map(b=>b.top)),rowBottom=Math.max(...r.row.map(b=>b.bottom));
 expect(rowBottom-rowTop).toBeLessThanOrEqual(48);
 for(let i=1;i<r.row.length;i++) expect(r.row[i].left).toBeGreaterThanOrEqual(r.row[i-1].right-1);
 expect(r.row[3].width).toBeGreaterThanOrEqual(44);
 expect(r.xpBar).toBe(false);
 expect(Number(r.xpRing)).toBeCloseTo(50,0);
 // Momentum is gone; Cinnet is a glowing chip without a bar.
 expect(r.momentum).toBe(false);
 expect(r.phoneHidden).toEqual([false,false,false]);
 expect([r.cinnet,r.cinnetBar]).toEqual([true,false]);
 expect(['cinnet-ready','none']).toContain(r.cinnetGlow);
 // Round 56-64 px abilities on an arc that rises toward the right edge.
 for(const s of r.skills){
   expect(s.round).toBe(true);
   expect(s.w).toBeGreaterThanOrEqual(56);expect(s.w).toBeLessThanOrEqual(64);
   expect(s.left).toBeGreaterThanOrEqual(width*.2);
 }
 for(let i=1;i<r.skills.length;i++){
   expect(r.skills[i].left).toBeGreaterThanOrEqual(r.skills[i-1].right-1);
   expect(r.skills[i].top).toBeLessThan(r.skills[i-1].top);
 }
 expect(r.skills[3].right).toBeGreaterThan(width-16);
 // No keyboard or mouse hints, no settings in the combat HUD.
 expect([r.hints,r.keysShown,r.settingsInHud]).toEqual([0,false,false]);
 // Even with the quest chip line on, 70 % of the height stays free.
 const arcTop=Math.min(...r.skills.map(s=>s.top));
 expect((arcTop-Math.max(rowBottom,r.chipsBottom))/height).toBeGreaterThanOrEqual(.70);
 expect(errors).toEqual([]);
 }finally{await context.close();}
});
}

// Odak 2.5 · phone landscape HUD acceptance.
// 724x280: a TECNO CK6n in landscape with the address bar shown (Odak 2.7e).
for(const [width,height] of [[750,342],[568,320],[724,280]]){
test('Odak 2.5 phone landscape HUD at '+width+'x'+height+' keeps the bottom clear and abilities on the right edge',async({browser,isMobile},testInfo)=>{
 test.skip(!isMobile,'runs once, in the mobile project');
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,
   viewport:{width,height},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await expect(page.locator('#hud')).toBeVisible();
 // Landscape never shows the turn-sideways tip.
 await expect(page.locator('#rotateHint')).toBeHidden();
 await page.evaluate(()=>{
   updateGame=()=>{};combo=8;comboTimer=COMBO_MAX_TIME;player.overdrive=90;
   activeBosses=[new Enemy(player.x+300,player.y,'BOSS_DESTROYER')];
   document.getElementById('bossHudContainer').classList.remove('hidden');updateHUD();
   showContextual(document.getElementById('questHudBox'),9000);
 });
 await page.waitForTimeout(350);
 const r=await page.evaluate(()=>{
   const box=el=>el.getBoundingClientRect();
   const vis=el=>el.checkVisibility({opacityProperty:true,visibilityProperty:true})&&box(el).width>1;
   const left=['.hud-vitals','#xpMeter'].map(s=>box(document.querySelector(s)));
   const right=['.hud-clock','#pauseBtn'].map(s=>box(document.querySelector(s)));
   const skills=['bastionBtn','novaBtn','prismBtn','dashBtn'].map(id=>box(document.getElementById(id)));
   const wave=document.querySelector('.hud-clock-wave');
   const all=[...document.querySelectorAll('#hud *')].filter(vis);
   const low=all.filter(el=>box(el).bottom>innerHeight*.8&&!el.closest('.hud-command-deck'));
   return {left,right,skills,lowItems:low.length,
     wave:{box:box(wave),clock:box(document.querySelector('.hud-clock')),scroll:wave.scrollWidth,client:wave.clientWidth},
     overflows:all.filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+1).length,
     pageOverflow:document.documentElement.scrollWidth-innerWidth};
 });
 // Top left: compact vitals and level ring on one line of at most 36 px.
 const leftTop=Math.min(...r.left.map(b=>b.top)),leftBottom=Math.max(...r.left.map(b=>b.bottom));
 expect(leftBottom-leftTop).toBeLessThanOrEqual(36);
 expect(r.left[0].left).toBeLessThan(20);
 expect(r.left[1].left).toBeGreaterThanOrEqual(r.left[0].right-1);
 // Top right: clock and pause.
 expect(r.right[1].right).toBeGreaterThan(width-20);
 expect(r.right[0].right).toBeLessThanOrEqual(r.right[1].left+1);
 expect(r.right[1].width).toBeGreaterThanOrEqual(44);
 // DALGA is not clipped.
 expect(r.wave.scroll).toBeLessThanOrEqual(r.wave.client);
 expect(r.wave.box.left).toBeGreaterThanOrEqual(r.wave.clock.left);
 expect(r.wave.box.right).toBeLessThanOrEqual(r.wave.clock.right);
 expect(r.wave.box.top).toBeGreaterThanOrEqual(r.wave.clock.top);
 // A column of round abilities on the right edge, below the clock: 52 px
 // when there is room, shrinking to fit (never under 44 px) on short screens.
 for(const s of r.skills){
   if(height>=320) expect(Math.round(s.width)).toBe(52);
   else{expect(s.width).toBeGreaterThanOrEqual(44);expect(s.width).toBeLessThanOrEqual(52);}
   expect(s.right).toBeGreaterThan(width-20);
   expect(s.top).toBeGreaterThan(r.right[1].bottom);
 }
 for(let i=1;i<r.skills.length;i++){
   expect(Math.abs(r.skills[i].left-r.skills[0].left)).toBeLessThan(1);
   expect(r.skills[i].top).toBeGreaterThanOrEqual(r.skills[i-1].bottom-1);
 }
 // Nothing else sits along the bottom; no text overflows, even with boss + chips.
 expect([r.lowItems,r.overflows]).toEqual([0,0]);
 expect(r.pageOverflow).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
 }finally{await context.close();}
});
}

test('Odak 2.5 a phone held upright gets the turn-sideways tip once',async({browser,isMobile},testInfo)=>{
 test.skip(!isMobile,'touch phone only');
 const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,
   viewport:{width:390,height:664},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 try{
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await expect(page.locator('#rotateHint')).toBeVisible();
 await expect(page.locator('#rotateHint')).toContainText('yatay çevir');
 await expect(page.locator('#rotateHint')).toBeHidden({timeout:6000});
 await page.evaluate(()=>startNewGame());
 await page.waitForTimeout(200);
 await expect(page.locator('#rotateHint')).toBeHidden();
 }finally{await context.close();}
});

// Odak 2.7d · a really slow game loop lowers graphics by itself.
test('Odak 2.7d a slow device drops graphics to low during play and keeps it next launch',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html',{autoGraphics:true});
 await expect.poll(()=>page.evaluate(()=>graphicsQuality)).toBe('high');
 await page.locator('#startBtn').click();
 // Fixture: burn ~50 ms in every frame, like the 18 fps measured on a phone.
 await page.evaluate(()=>{player.hp=player.maxHp=1e9;
   const burn=()=>{const t=performance.now();while(performance.now()-t<50){}requestAnimationFrame(burn);};
   requestAnimationFrame(burn);});
 await expect.poll(()=>page.evaluate(()=>graphicsQuality),{timeout:15000}).toBe('low');
 expect(await page.evaluate(()=>[localStorage.getItem(GRAPHICS_AUTO_SAVE_KEY),
   localStorage.getItem(GRAPHICS_SAVE_KEY),document.getElementById('pauseGraphicsQuality').value]))
   .toEqual(['low',null,'low']);
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>graphicsQuality)).toBe('low');
 expect(errors).toEqual([]);
});

// Odak 2.7e · keyboard hints only where there is a keyboard.
test('Odak 2.7e touch screens get touch wording instead of keyboard hints',async({page,isMobile})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html');
 const shown=sel=>page.evaluate(sel=>[...document.querySelectorAll(sel)].some(el=>el.checkVisibility()),sel);
 // Menu: control cards and the shortcut footer.
 expect(await shown('#startModal .key-hint')).toBe(!isMobile);
 expect(await shown('#startModal .touch-hint')).toBe(!!isMobile);
 await page.locator('#startBtn').click();
 // Upgrade cards: [1] [2] [3] and the R reroll key are keyboard-only.
 await page.evaluate(()=>triggerLevelUp());
 await expect(page.locator('#upgradeCardsContainer .upgrade-card')).toHaveCount(3);
 expect(await shown('#upgradeModal .key-hint')).toBe(!isMobile);
 const footer=await page.locator('#upgradeCardsContainer .upgrade-card-footer').first().innerText();
 if(isMobile) expect(footer).not.toContain('[');
 else expect(footer).toContain('[ 1 ]');
 await page.evaluate(()=>selectUpgradeOption(0));
 // Revive prompt: no "BOŞLUK" on a touch screen.
 await page.evaluate(()=>{player.hp=0;showRevivePromptOrGameOver();});
 await expect(page.locator('#confirmReviveBtn')).toBeVisible();
 const revive=await page.locator('#confirmReviveBtn').innerText();
 expect(revive).toMatch(/DİRİL/);
 if(isMobile) expect(revive).not.toMatch(/BOŞLUK/);
 else expect(revive).toMatch(/BOŞLUK/);
 expect(errors).toEqual([]);
});

// Odak 3.1 · slot row and ATLA sit with the reroll button on every layout.
test('Odak 3.1 slot row and skip button fit the upgrade screen and ATLA resumes play',async({page,isMobile})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await gotoGame(page,'/index.html');
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{player.upgradeCounts={homing:1,firerate:1};triggerLevelUp();});
 await expect(page.locator('#upgradeCardsContainer .upgrade-card')).toHaveCount(3);
 const sizes=isMobile?[[412,839]]:[[1280,800],[1024,768],[360,740]];
 for(const [width,height] of sizes){
   if(!isMobile) await page.setViewportSize({width,height});
   const m=await page.evaluate(()=>{
     const modal=document.getElementById('upgradeModal');
     const row=document.getElementById('upgradeSlotRow').getBoundingClientRect();
     const skip=document.getElementById('skipUpgradeBtn').getBoundingClientRect();
     return {overflow:modal.scrollWidth-modal.clientWidth,rowH:row.height,rowW:row.width,
       slots:document.querySelectorAll('#upgradeSlotRow .upgrade-slot').length,
       filled:document.querySelectorAll('#upgradeSlotRow .upgrade-slot.filled').length,
       skipH:skip.height,skipW:skip.width};
   });
   expect(m.overflow,'overflow at '+width).toBeLessThanOrEqual(3);
   expect(m.slots).toBe(9);
   expect(m.filled).toBe(3);
   expect(m.rowH,'slot row stays thin at '+width).toBeLessThanOrEqual(64);
   expect(m.skipH).toBeGreaterThanOrEqual(44);
   expect(m.skipW).toBeGreaterThanOrEqual(44);
 }
 await expect(page.locator('#skipUpgradeText')).toHaveText('2');
 await page.locator('#skipUpgradeBtn').click();
 await expect(page.locator('#upgradeModal')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>[gameState,upgradeSkipsLeft])).toEqual(['PLAYING',1]);
 expect(errors).toEqual([]);
});

// Odak 3.2 · new weapons run in the real loop without page errors.
for(const weapon of ['mine_trail']){
 test(`Odak 3.2 ${weapon} fires in a real run without page errors`,async({page,isMobile})=>{
   test.skip(isMobile,'weapon loop is checked once on desktop');
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await gotoGame(page,'/index.html?seed=7');
   await page.locator('#startBtn').click();
   await page.evaluate(id=>{
     const upg=UPGRADES_POOL.find(u=>u.id===id);
     for(let i=0;i<3;i++){gameState='LEVEL_UP';currentUpgradeChoices=[{upg,rarity:RARITIES[0]}];selectUpgradeOption(0);}
     player.maxHp=player.hp=1e6;
   },weapon);
   await page.keyboard.down('KeyD');
   await page.waitForTimeout(900);
   await page.keyboard.up('KeyD');
   await page.keyboard.down('KeyS');
   await page.waitForTimeout(900);
   await page.keyboard.up('KeyS');
   const stats=await page.evaluate(()=>({tier:player.upgradeCounts.mine_trail,evo:player.evolutions.has('mine_trail'),
     drops:player.buildStats.mineDrops,state:gameState}));
   expect(stats.tier).toBe(3);
   expect(stats.evo).toBe(true);
   expect(stats.drops).toBeGreaterThan(0);
   expect(stats.state).toBe('PLAYING');
   expect(errors).toEqual([]);
 });
}
