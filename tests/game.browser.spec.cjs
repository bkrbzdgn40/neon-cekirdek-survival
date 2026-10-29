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


test('gold-only bastion can be deployed via the combat HUD without opening upgrade cards', async ({ page }) => {
 const errors=[];
 page.on('pageerror', err=>errors.push(err.message));
 await page.goto('/index.html', {waitUntil:'domcontentloaded'});
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
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
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
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
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
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#startBtn').click();
 const steps=await page.evaluate(()=>{
   player.takeDamage=()=>{};
   nextBossTime=500;
   wave=4;updateArenaChapter(.02);updateArenaChapterHud();
   const first={badge:document.getElementById('arenaChapterBadge').textContent,
     mode:document.getElementById('hud').getAttribute('data-arena-chapter')};
   wave=7;updateArenaChapter(.02);updateArenaChapterHud();
   const second={badge:document.getElementById('arenaChapterBadge').textContent,
     mode:document.getElementById('hud').getAttribute('data-arena-chapter')};
   wave=10;updateArenaChapter(.02);updateArenaChapterHud();
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


test('M5.18 mobile displays chapter status through warning, garden and rift',async({page,isMobile})=>{
 test.skip(!isMobile,'mobile-only terrain HUD visibility');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{nextBossTime=500;wave=4;totalTime=23.7;updateArenaChapter(.02);updateArenaChapterHud();});
 const mobile=page.locator('#arenaChapterMobile');
 await expect(mobile).toBeVisible();
 await expect(mobile).toContainText('DÖKÜMHANE');
 await expect(mobile).toContainText('ISI YÜKLENİYOR');
 await page.evaluate(()=>{totalTime+=1.55;updateArenaChapter(.02);updateArenaChapterHud();});
 await expect(mobile).toContainText('RAYLARDAN KAÇ');
 await page.evaluate(()=>{wave=7;updateArenaChapter(.02);updateArenaChapterHud();});
 await expect(mobile).toContainText('İYON DOLDUR');
 await page.evaluate(()=>{wave=10;updateArenaChapter(.02);updateArenaChapterHud();});
 await expect(mobile).toContainText('İKİ GEÇİT AKTİF');
 expect(errors).toEqual([]);
});


test('M5.19 contested garden and warned rift pursuit have readable HUD in Chromium',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   wave=7;nextBossTime=500;updateArenaChapter(.02);
   const n=getGardenCenters()[0];
   player.x=n.x;player.y=n.y;
   enemies=[new Enemy(n.x+12,n.y+12,'SHOOTER')];
   updateArenaChapter(.2);updateArenaChapterHud();
   const garden=document.getElementById('arenaChapterStatus').textContent;
   wave=10;updateArenaChapter(.02);
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
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#startBtn').click();
 const stages=await page.evaluate(()=>{
   nextBossTime=1000;
   const result={};
   for(const [w,id] of [[5,'FOUNDRY'],[8,'GARDEN'],[11,'RIFT']]){
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
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#startBtn').click();
 const result=await page.evaluate(()=>{
   const setupHunter=()=>{
     startNewGame();
     wave=7;waveTimer=2;nextBossTime=5000;totalTime=100;
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
   return {initial,lock,trail,cross,gold:totalGold,modules:UPGRADES_POOL.length};
 });
 expect(result.initial.hidden).toBe(false);
 expect(result.initial.label).toContain('YANKI AVCISI');
 expect(result.lock).toMatchObject({kind:'LOCK',label:expect.stringContaining('SABİT NOKTA')});
 expect(result.trail).toMatchObject({kind:'TRAIL',label:expect.stringContaining('HAREKET İZİ')});
 expect(result.cross).toMatchObject({kind:'CROSS',label:expect.stringContaining('ÇAPRAZ KİLİT')});
 expect(result.gold).toBe(50);
 expect(result.modules).toBe(13);
 await expect(page.locator('#nemesisBanner')).toBeVisible();
 expect(errors).toEqual([]);
});


test('M5.22 keyboard C and touch Prism Riposte deflect a real projectile in Chromium',async({page})=>{
 const errors=[];page.on('pageerror',err=>errors.push(err.message));
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
 await page.locator('#startBtn').click();
 await page.evaluate(()=>{
   totalTime=10;nextBossTime=500;
   const shot=new EnemyProjectile(player.x+72,player.y,-360,0,6,25);
   enemyProjectiles=[shot];enemies=[];
 });
 await page.keyboard.press('c');
 const result=await page.evaluate(()=>{
   const wasActive=getNeonPrismGuard().active;
   const hp=player.hp;
   updateGame(.016);
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
 await page.locator('#prismBtn').click();
 expect(await page.evaluate(()=>getNeonPrismGuard().stats.activations)).toBe(2);
 expect(errors).toEqual([]);
});


test('M5.22 all four touch combat controls fit the phone viewport without overlap',async({page,isMobile})=>{
 test.skip(!isMobile,'phone-only combat command geometry');
 await page.goto('/index.html',{waitUntil:'domcontentloaded'});
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
