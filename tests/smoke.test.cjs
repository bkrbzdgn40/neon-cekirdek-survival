const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
const gameCode = scripts.at(-1)?.[1];

function setup(stored = {}) {
  const nodes = new Map();
  const noop = () => {};
  function element() {
    return {
      classList: { add: noop, remove: noop, toggle: noop },
      style: {}, textContent: '', innerHTML: '',
      addEventListener: noop, appendChild: noop, setAttribute: noop,
      getContext: () => new Proxy({}, { get: () => noop }),
      querySelector: () => element(),
      getAttribute: () => '',
    };
  }
  const document = {
    documentElement: { clientWidth: 1280, clientHeight: 720 },
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    querySelectorAll: () => [],
    createElement: element,
    addEventListener: noop,
  };
  const window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener: noop };
  const storage = {
    getItem: (key) => stored[key] ?? null,
    setItem: (key, value) => { stored[key] = value; },
  };
  const sandbox = {
    window, document, localStorage: storage, console: { warn: noop, log: console.log },
    Math, Set, Date, performance: { now: () => 0 },
    requestAnimationFrame: noop, setTimeout: noop,
  };
  vm.createContext(sandbox);
  vm.runInContext(gameCode, sandbox, { timeout: 4000 });
  sandbox.window.onload();
  const run = (script) => vm.runInContext(script, sandbox, { timeout: 4000 });
  return { run, stored };
}

test('single-file game JavaScript is syntactically valid', () => {
  assert.ok(gameCode?.includes('class Player'));
  assert.doesNotThrow(() => new vm.Script(gameCode));
});

test('initial menu loads and meta progress persists across reloads', () => {
  const a = setup();
  assert.equal(a.run('totalGold'), 50);
  a.run('totalGold=345; savedHighScore=3500; savedMaxWave=17; metaUpgrades.baseDamage=4; saveMetaProgress()');
  const b = setup(a.stored);
  assert.equal(b.run('totalGold'), 345);
  assert.equal(b.run('savedHighScore'), 3500);
  assert.equal(b.run('savedMaxWave'), 17);
  assert.equal(b.run('metaUpgrades.baseDamage'), 4);
});

test('malformed or out-of-range save data does not break initialisation', () => {
  const key = 'neonCekirdek.meta.v1';
  assert.equal(setup({ [key]: '{invalid json' }).run('totalGold'), 50);
  const data = { version: 1, gold: -999, highScore: 200, maxWave: 0,
    upgrades: { baseDamage: 200, defibrillator: 999, greed: '8' } };
  const s = setup({ [key]: JSON.stringify(data) });
  assert.equal(s.run('totalGold'), 50);
  assert.equal(s.run('savedMaxWave'), 1);
  assert.equal(s.run('metaUpgrades.baseDamage'), 10);
  assert.equal(s.run('metaUpgrades.defibrillator'), 3);
  assert.equal(s.run('metaUpgrades.greed'), 0);
});

test('weighted enemy pool varies early waves; late HP growth is bounded', () => {
  const { run } = setup();
  assert.equal(run('pickEnemyTypeForWave(1, 0.1)'), 'SWARM');
  assert.equal(run('pickEnemyTypeForWave(1, 0.9)'), 'SPLITTER');
  assert.equal(run('pickEnemyTypeForWave(2, 0.99)'), 'DASHER');
  run('startNewGame(); wave=30');
  const hp = run("new Enemy(0,0,'SWARM').maxHp");
  assert.ok(hp > 300 && hp < 600, `wave 30 SWARM HP: ${hp}`);
  run('enemies = Array(160).fill({dead:false}); spawnEnemy(false)');
  assert.equal(run('enemies.length'), 160);
});

test('boss cooldown starts after last boss dies', () => {
  const { run } = setup();
  run('startNewGame(); totalTime=55; spawnBossEncounter()');
  assert.equal(run('nextBossTime'), Infinity);
  run('for (const b of [...activeBosses]) { b.hp=1; b.takeDamage(10000); }');
  assert.equal(run('activeBosses.length'), 0);
  assert.ok(run('nextBossTime-totalTime') >= 42);
});

test('purchased free revives can be used after the second revival', () => {
  const { run } = setup();
  run("startNewGame(); reviveCountUsed=2; paidRevivesUsed=2; player.freeRevives=3; totalGold=0; showRevivePromptOrGameOver()");
  assert.equal(run('gameState'), 'REVIVE_PROMPT');
  run('executePlayerRevive()');
  assert.equal(run('gameState'), 'PLAYING');
  assert.equal(run('player.freeRevives'), 2);
});


test('spatial grid includes every geometric collision and rejects distant bullets', () => {
  const { run } = setup();
  const result = JSON.parse(run(`(() => {
    let seed = 42;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    bullets = Array.from({length: 400}, (_, i) => ({
      x: rand() * 1280, y: rand() * 720, radius: i === 0 ? 60 : 2 + rand() * 8,
      dead: i % 37 === 0 && i !== 0
    }));
    buildBulletCollisionGrid();
    let missing = 0, candidateTotal = 0, duplicateCount = 0;
    for (let n = 0; n < 160; n++) {
      const x = rand() * 1280, y = rand() * 720;
      const radius = n % 10 === 0 ? 52 : 10 + rand() * 16;
      const candidateIndices = getNearbyBulletIndices(x, y, radius);
      const choices = new Set(candidateIndices);
      candidateTotal += choices.size;
      duplicateCount += candidateIndices.length - choices.size;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (b.dead) continue;
        const dx = x - b.x, dy = y - b.y, hitRadius = radius + b.radius;
        if (dx * dx + dy * dy < hitRadius * hitRadius && !choices.has(i)) missing++;
      }
    }
    return JSON.stringify({ missing, duplicateCount, candidateTotal, bruteChecks: bullets.length * 160 });
  })()`));
  assert.equal(result.missing, 0, 'No real collision may be filtered out by the grid');
  assert.equal(result.duplicateCount, 0, 'A bullet in one grid cell must be visited once');
  assert.ok(result.candidateTotal < result.bruteChecks * 0.4,
    `Broad-phase candidates: ${result.candidateTotal}/${result.bruteChecks}`);
});

test('indexed projectile collisions still damage a stationary enemy', () => {
  const { run } = setup();
  const hit = JSON.parse(run(`(() => {
    startNewGame();
    player.fireTimer = 500;
    const target = new Enemy(player.x + 60, player.y, 'SWARM');
    target.speed = 0;
    enemies.push(target);
    const shot = new Bullet(target.x, target.y, 0, 0, 20, 7, 1, 0);
    bullets.push(shot);
    updateGame(0.016);
    return JSON.stringify({ hp: target.hp, maxHp: target.maxHp, dead: shot.dead });
  })()`));
  assert.ok(hit.hp < hit.maxHp);
  assert.equal(hit.dead, true);
});

test('visual budgets cap particle and text objects without removing new feedback', () => {
  const { run } = setup();
  const counts = JSON.parse(run(`(() => {
    particles = []; floatingTexts = [];
    for (let i = 0; i < 1200; i++) {
      emitParticle({ life: 1 });
      createFloatingText(0, 0, 'label_' + i);
    }
    return JSON.stringify({ particles: particles.length, texts: floatingTexts.length,
      lastText: floatingTexts.at(-1).text });
  })()`));
  assert.equal(counts.particles, 420);
  assert.equal(counts.texts, 110);
  assert.equal(counts.lastText, 'label_1199');
});

test('HUD updates at controlled frequency rather than every simulation frame', () => {
  const { run } = setup();
  run('startNewGame(); updateGame(0.025); updateGame(0.025); updateGame(0.025)');
  assert.ok(run('hudRefreshAccumulator') > 0.07);
  run('updateGame(0.025)');
  assert.ok(run('hudRefreshAccumulator') < 0.03);
});


test('orb compaction preserves separate XP/gold identities and exact totals', () => {
  const { run } = setup();
  const totals = JSON.parse(run(`(() => {
    startNewGame();
    for (let i = 0; i < 400; i++) emitEnergyOrb(250, 200, 5, false);
    for (let i = 0; i < 320; i++) emitEnergyOrb(260, 210, 1, true);
    return JSON.stringify({
      visible: orbs.length,
      max: MAX_ACTIVE_ORBS,
      xp: orbs.filter(o => !o.isGold).reduce((n, o) => n + o.value, 0),
      xpCount: orbs.filter(o => !o.isGold).reduce((n, o) => n + o.count, 0),
      goldCount: orbs.filter(o => o.isGold).reduce((n, o) => n + o.count, 0),
      maxStack: Math.max(...orbs.map(o => o.count))
    });
  })()`));
  assert.ok(totals.visible <= totals.max + 1, 'At most one overflow slot per reward type');
  assert.equal(totals.xp, 2000);
  assert.equal(totals.xpCount, 400);
  assert.equal(totals.goldCount, 320);
  assert.ok(totals.maxStack > 1);
});

test('stacked XP pickup credits every original orb and maintains quest progress', () => {
  const { run } = setup();
  const info = JSON.parse(run(`(() => {
    startNewGame();
    for (let i = 0; i < 400; i++) emitEnergyOrb(300, 300, 8, false);
    const stack = orbs.find(o => o.count > 1);
    activeQuest = { type:'ORBS', target:1000, progress:0, rewardGold:1, desc:'collect' };
    const sum = stack.value, count = stack.count;
    player.x = stack.x; player.y = stack.y;
    stack.update(0.016);
    return JSON.stringify({ dead:stack.dead, count, sum, xp:player.xp,
      xpToNext:player.xpToNext, level:player.level, progress:activeQuest.progress,
      finite:Number.isFinite(stack.x) && Number.isFinite(stack.y) });
  })()`));
  assert.equal(info.dead, true);
  assert.equal(info.finite, true, 'Exact center magnet contact must not create NaN coordinates');
  assert.equal(info.progress, info.count);
  assert.equal(info.level, 2);
  assert.equal(info.xp + 125, info.sum);
});

test('stacked gold grants all original pickups and writes storage once per frame', () => {
  const { run } = setup();
  const info = JSON.parse(run(`(() => {
    startNewGame();
    for (let i=0; i<300; i++) emitEnergyOrb(300, 300, 1, true);
    player.x=300; player.y=300;
    localStorage.calls=0;
    const save = localStorage.setItem;
    localStorage.setItem = function(key,value) { this.calls++; save(key,value); };
    updateGame(0.016);
    return JSON.stringify({ gold:totalGold, earned:sessionGold,
      storageWrites:localStorage.calls, remaining:orbs.length });
  })()`));
  assert.equal(info.gold, 650);
  assert.equal(info.earned, 600);
  assert.equal(info.storageWrites, 1);
  assert.equal(info.remaining, 0);
});

test('multiple earned levels are offered sequentially after upgrade selection', () => {
  const { run } = setup();
  const status = JSON.parse(run(`(() => {
    startNewGame();
    player.gainXp(3000);
    const firstLevel = player.level;
    selectUpgradeOption(0);
    return JSON.stringify({firstLevel, nextLevel:player.level, state:gameState, xp:player.xp});
  })()`));
  assert.equal(status.firstLevel, 2);
  assert.equal(status.nextLevel, 3);
  assert.equal(status.state, 'LEVEL_UP');
  assert.ok(status.xp > 0);
});

test('frequent laser, pickup and explosion calls reuse SFX rate budgets', () => {
  const { run } = setup();
  const counts = JSON.parse(run(`(() => {
    const engine = new SoundEngine();
    let voices = 0;
    let clock = 10;
    const param = { setValueAtTime(){}, exponentialRampToValueAtTime(){} };
    const node = () => ({frequency:param,gain:param,connect(){},start(){voices++;},stop(){}});
    engine.ctx = {
      get currentTime(){return clock;},
      createOscillator:node, createGain:node, destination:{}
    };
    for (let i=0;i<20;i++) {
      engine.playLaser();
      engine.playOrbPickup();
      engine.playExplosion();
    }
    const first = voices;
    clock += 0.1;
    engine.playLaser();
    engine.playOrbPickup();
    engine.playExplosion();
    return JSON.stringify({first, voices});
  })()`));
  assert.equal(counts.first, 3);
  assert.equal(counts.voices, 6);
});


test('extended-run reward stress stays bounded without discarding 6000 drops', () => {
  const { run } = setup();
  const snapshot = JSON.parse(run(`(() => {
    startNewGame();
    for (let i=0; i<6000; i++) {
      emitEnergyOrb(100 + (i % 80) * 9, 100 + (i % 60) * 7,
        i % 2 === 0 ? 3 : 0, i % 2 === 1);
    }
    return JSON.stringify({
      objects:orbs.length,
      count:orbs.reduce((n,o)=>n+o.count,0),
      xp:orbs.filter(o=>!o.isGold).reduce((n,o)=>n+o.value,0),
      gold:orbs.filter(o=>o.isGold).reduce((n,o)=>n+o.count,0)
    });
  })()`));
  assert.ok(snapshot.objects <= 241);
  assert.equal(snapshot.count, 6000);
  assert.equal(snapshot.xp, 9000);
  assert.equal(snapshot.gold, 3000);
});


test('director cycles through preparation, pressure, crisis and recovery', () => {
  const { run } = setup();
  const p = JSON.parse(run(`(() => {
    const phase = (t, bosses=0, bossAt=1000, respite=-Infinity) =>
      getDirectorProfile(t, 5, bosses, bossAt, respite, 1).phase;
    return JSON.stringify({
      opening:phase(0), pressure:phase(15), crisis:phase(40), recovery:phase(56),
      warning:phase(53,0,55), boss:phase(54,2,55),
      postBoss:phase(64,0,120,70), newCycle:phase(65)
    });
  })()`));
  assert.deepEqual(p, {opening:'BUILDUP',pressure:'PRESSURE',crisis:'CRISIS',
    recovery:'RECOVERY',warning:'WARNING',boss:'BOSS',
    postBoss:'RECOVERY',newCycle:'BUILDUP'});
});

test('director threat is reduced when HP critical and increases with wave and crisis', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const profile=(t,w,hp)=>getDirectorProfile(t,w,0,1000,-Infinity,hp);
    return JSON.stringify({
      low:profile(20,12,.20).tokenRate, healthy:profile(20,12,1).tokenRate,
      early:profile(20,1,1).tokenRate, late:profile(20,20,1).tokenRate,
      crisis:profile(40,12,1).tokenRate, recovery:profile(54,12,1).tokenRate,
      peakCap:profile(40,12,1).cap, recoveryCap:profile(54,12,1).cap
    });
  })()`));
  assert.ok(x.low < x.healthy && x.low > 0);
  assert.ok(x.early < x.late);
  assert.ok(x.crisis > x.healthy && x.healthy > x.recovery);
  assert.ok(x.recoveryCap < x.peakCap && x.peakCap <= 160);
});

test('theme weights alter composition without spawning inaccessible types', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const sample = (wave,theme) => {
      const counts = {};
      for (let i=0;i<1000;i++) {
        const type = pickEnemyTypeForWave(wave,(i+.5)/1000,theme);
        counts[type] = (counts[type] || 0) + 1;
      }
      return counts;
    };
    return JSON.stringify({ surge:sample(15,'SURGE'), siege:sample(15,'SIEGE'),
      hunt:sample(15,'HUNT'), waveOne:sample(1,'HUNT'),
      noCredits:pickEnemyTypeForWave(10,.5,'HUNT',.3) });
  })()`));
  assert.ok(x.surge.SWARM > x.siege.SWARM);
  assert.ok(x.siege.TANK > x.surge.TANK);
  assert.ok(x.hunt.SNIPER > x.surge.SNIPER);
  assert.deepEqual(Object.keys(x.waveOne).sort(), ['SPLITTER','SWARM']);
  assert.equal(x.noCredits, null);
});

test('director spends only available tokens and tracks actual enemy spawns', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=15; totalTime=37;
    combatDirector.update(.05);
    combatDirector.tokens=12;
    let success = 0;
    for(let i=0;i<70;i++) if(combatDirector.trySpawn()) success++;
    return JSON.stringify({ success, enemies:enemies.length, tracked:combatDirector.stats.spawned,
      tokens:combatDirector.tokens, max:combatDirector.profile.cap });
  })()`));
  assert.ok(x.success >= 1);
  assert.equal(x.enemies, x.success);
  assert.equal(x.tracked, x.success);
  assert.ok(x.tokens >= -0.000001 && x.tokens < 1.5);
  assert.ok(x.enemies <= x.max);
});

test('elite chests have cooldown, rolling per-minute ceiling and no unlimited drops', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=20;
    const c=combatDirector;
    for(let t=0;t<180;t++) {
      totalTime=t;
      c.registerChestDrop('elite',100,100);
      lootChests.length=0; // model the player collecting each reward
    }
    return JSON.stringify({ chests:c.stats.chestDrops.elite, kills:c.stats.eliteKills,
      window:c.eliteChestTimes.length, last:c.lastEliteChestAt });
  })()`));
  assert.equal(x.kills,180);
  assert.ok(x.chests >= 3 && x.chests <= 9, `Elite chests in 180 seconds: ${x.chests}`);
  assert.ok(x.window <= 3);
});

test('a multi-boss encounter guarantees only one chest and triggers recovery on clear', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=12; totalTime=111;
    combatDirector.onBossEncounter();
    const result = [combatDirector.registerChestDrop('boss',1,1),
      combatDirector.registerChestDrop('boss',2,2),
      combatDirector.registerChestDrop('boss',3,3)];
    combatDirector.onBossCleared();
    return JSON.stringify({ result, drops:combatDirector.stats.chestDrops.boss,
      chests:lootChests.length, encounters:combatDirector.stats.encounters,
      phase:getDirectorProfile(112,wave,0,150,combatDirector.afterBossUntil,1).phase });
  })()`));
  assert.deepEqual(x.result,[true,false,false]);
  assert.equal(x.drops,1);
  assert.equal(x.chests,1);
  assert.equal(x.encounters,1);
  assert.equal(x.phase,'RECOVERY');
});

test('chest opening records exactly one of three reward categories', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); const chest = new LootChest(player.x, player.y);
    chest.update(.016);
    return JSON.stringify({ dead:chest.dead,
      categories: Object.values(combatDirector.stats.chestOpened),
      gold:totalGold, state:gameState });
  })()`));
  assert.equal(x.dead,true);
  assert.equal(x.categories.reduce((sum,n)=>sum+n,0),1);
  assert.ok(x.categories.every(n=>n===0||n===1));
});

test('director state resets cleanly between runs and diagnostics stay read-only', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); combatDirector.stats.eliteKills=40;
    totalTime=100; combatDirector.tokens=0;
    const old=window.getNeonRunDiagnostics();
    startNewGame();
    const fresh=window.getNeonRunDiagnostics();
    return JSON.stringify({oldKills:old.eliteKills,newKills:fresh.eliteKills,
      newPhase:fresh.phase,tokens:fresh.threatTokens,oldTime:old.timeSeconds});
  })()`));
  assert.equal(x.oldKills,40);
  assert.equal(x.oldTime,100);
  assert.equal(x.newKills,0);
  assert.equal(x.newPhase,'BUILDUP');
  assert.equal(x.tokens,4);
});


test('M2.2 directional plans advertise the exact sides they will use', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const pincer = getSpecialEncounterPlan(7,'HUNT',0,0);
    const spear = getSpecialEncounterPlan(7,'SIEGE',3,1);
    const point = formationEdgePoint(3,1,3);
    return JSON.stringify({
      pincer:pincer.type, pincerSides:[...new Set(pincer.units.map(u=>u.side))].sort(),
      pincerCount:pincer.units.length,
      spear:spear.type, spearSides:[...new Set(spear.units.map(u=>u.side))],
      spearTypes:spear.units.map(u=>u.type), point,
      warning:pincer.warning
    });
  })()`));
  assert.equal(x.pincer,'PINCER');
  assert.deepEqual(x.pincerSides,[0,2]);
  assert.equal(x.pincerCount,4);
  assert.equal(x.spear,'SPEARHEAD');
  assert.deepEqual(x.spearSides,[3]);
  assert.ok(x.spearTypes.includes('SHIELD_BEARER'));
  assert.ok(x.point.x < 0 && x.point.y > 0);
  assert.ok(x.warning >= 1.5);
});

test('incoming formations appear only after telegraph and spend actual threat tokens', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=7; totalTime=29; nextBossTime=150;
    combatDirector.tokens=12;
    combatDirector.update(.02);
    const warning = combatDirector.pendingEncounter?.warning;
    const before=enemies.length;
    const regularDuringWarning=combatDirector.trySpawn();
    combatDirector.update(1.1);
    const stillWaiting=enemies.length;
    combatDirector.update(.65);
    return JSON.stringify({ warning, before, regularDuringWarning, stillWaiting,
      after:enemies.length, tokens:combatDirector.tokens,
      pending:combatDirector.pendingEncounter,
      specials:combatDirector.stats.specialEncounters,
      units:combatDirector.stats.specialUnits, tracked:combatDirector.stats.spawned });
  })()`));
  assert.ok(x.warning >= 1.5);
  assert.equal(x.before,0);
  assert.equal(x.regularDuringWarning,false);
  assert.equal(x.stillWaiting,0);
  assert.ok(x.after >= 2 && x.after <= 4);
  assert.equal(x.pending,null);
  assert.equal(x.specials,1);
  assert.equal(x.units,x.after);
  assert.equal(x.tracked,x.after);
  assert.ok(x.tokens >= 0);
});

test('special encounter cannot begin during boss warning or recovery', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=9; totalTime=30; combatDirector.tokens=12;
    nextBossTime=34; combatDirector.update(.03);
    const bossImminent=combatDirector.pendingEncounter;
    nextBossTime=150; combatDirector.afterBossUntil=39;
    combatDirector.update(.03); const recovering=combatDirector.pendingEncounter;
    combatDirector.afterBossUntil=-Infinity;
    combatDirector.update(.03); const pending=!!combatDirector.pendingEncounter;
    combatDirector.onBossEncounter();
    return JSON.stringify({bossImminent,recovering,pending,
      afterCancel:combatDirector.pendingEncounter,cancelled:combatDirector.stats.specialCancelled});
  })()`));
  assert.equal(x.bossImminent,null);
  assert.equal(x.recovering,null);
  assert.equal(x.pending,true);
  assert.equal(x.afterCancel,null);
  assert.equal(x.cancelled,1);
});

test('a formation respects enemy cap and costs even if room runs out', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=12; totalTime=30;
    combatDirector.profile=getDirectorProfile(30,12,0,150,-Infinity,1);
    combatDirector.tokens=13;
    enemies=Array(combatDirector.profile.cap-2).fill({dead:false});
    combatDirector.pendingEncounter=getSpecialEncounterPlan(wave,'SURGE',1,0);
    const count=combatDirector.resolveSpecialEncounter();
    return JSON.stringify({count,cap:combatDirector.profile.cap,active:enemies.length,
      remaining:combatDirector.tokens,specialUnits:combatDirector.stats.specialUnits});
  })()`));
  assert.equal(x.count,2);
  assert.equal(x.active,x.cap);
  assert.ok(x.remaining >= 0 && x.remaining < 13);
  assert.equal(x.specialUnits,2);
});

test('boss enters second and final phase, each with a locked warning before attack', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=10;
    const boss=new Enemy(100,100,'BOSS_DESTROYER');
    boss.hp=boss.maxHp*.68;
    boss.updateBossPhases(.05,200,0);
    const phase2=boss.bossPhase, warning2=boss.bossSpecial?.timer;
    const initial=enemyProjectiles.length;
    boss.updateBossPhases(1.20,-200,0);
    const first=enemyProjectiles.length;
    boss.hp=boss.maxHp*.34;
    boss.updateBossPhases(.05,0,200);
    const phase3=boss.bossPhase, warning3=boss.bossSpecial?.timer;
    boss.updateBossPhases(1.40,0,-200);
    return JSON.stringify({phase2,warning2,initial,first,phase3,warning3,
      total:enemyProjectiles.length,attacks:boss.bossSpecialCount,
      tracked:combatDirector.stats.bossSpecialAttacks,remaining:boss.bossSpecial});
  })()`));
  assert.equal(x.phase2,2);
  assert.ok(x.warning2 >= 1);
  assert.equal(x.initial,0);
  assert.equal(x.first,5);
  assert.equal(x.phase3,3);
  assert.ok(x.warning3 >= 1.2);
  assert.equal(x.total,12);
  assert.equal(x.attacks,2);
  assert.equal(x.tracked,2);
  assert.equal(x.remaining,null);
});

test('four boss archetypes use distinct and bounded special volleys', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=11;
    const result={};
    for(const type of ['BOSS_DESTROYER','BOSS_TITAN','BOSS_VOID','BOSS_PRISM']) {
      const boss=new Enemy(180,180,type);
      const before=enemyProjectiles.length;
      const spawned=fireBossPhaseAttack(boss,0,2);
      result[type]={spawned,actual:enemyProjectiles.length-before};
    }
    const dead=new Enemy(180,180,'BOSS_VOID');
    dead.dead=true;
    result.dead=fireBossPhaseAttack(dead,0,3);
    return JSON.stringify(result);
  })()`));
  assert.deepEqual(Object.values(x).slice(0,4).map(v=>v.spawned),[5,3,5,3]);
  for(const item of Object.values(x).slice(0,4)) assert.equal(item.spawned,item.actual);
  assert.equal(x.dead,0);
});

test('special encounter counters and pending warnings clear on restart', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=8; totalTime=30; nextBossTime=150;
    combatDirector.tokens=12; combatDirector.update(.02);
    const before=window.getNeonRunDiagnostics();
    startNewGame();
    const after=window.getNeonRunDiagnostics();
    return JSON.stringify({before:before.pendingEncounter,
      after:after.pendingEncounter,units:after.specialUnits,
      specials:after.specialEncounters,bossAttacks:after.bossSpecialAttacks});
  })()`));
  assert.equal(x.before,'PINCER');
  assert.equal(x.after,null);
  assert.equal(x.units,0);
  assert.equal(x.specials,0);
  assert.equal(x.bossAttacks,0);
});

test('boss warning render and directional warning render are safe with canvas mock', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=6; totalTime=29; nextBossTime=150;
    combatDirector.tokens=12; combatDirector.update(.01);
    drawSpecialEncounterWarning();
    const boss=new Enemy(300,300,'BOSS_PRISM');
    boss.hp=boss.maxHp*.69;
    boss.updateBossPhases(.01,100,0);
    boss.draw(ctx);
    return JSON.stringify({ warning:!!combatDirector.pendingEncounter,
      bossWarning:!!boss.bossSpecial,phase:boss.bossPhase });
  })()`));
  assert.equal(x.warning,true);
  assert.equal(x.bossWarning,true);
  assert.equal(x.phase,2);
});


test('boss phase telegraph suppresses simultaneous regular attack', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave=7;
    const boss = new Enemy(player.x+220,player.y,'BOSS_DESTROYER');
    boss.hp=boss.maxHp*.68;
    boss.actionTimer=0;
    for(let i=0;i<14;i++) boss.update(.05);
    const before=enemyProjectiles.length;
    for(let i=0;i<12;i++) boss.update(.05);
    return JSON.stringify({ before,after:enemyProjectiles.length,
      phase:boss.bossPhase, specials:boss.bossSpecialCount,
      normalTimer:boss.actionTimer });
  })()`));
  assert.equal(x.before,0);
  assert.equal(x.phase,2);
  assert.equal(x.after,5);
  assert.equal(x.specials,1);
  assert.ok(x.normalTimer > 0);
});
