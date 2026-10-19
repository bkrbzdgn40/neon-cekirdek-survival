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
      addEventListener: noop, appendChild: noop,
       _attrs: {}, setAttribute(key, value) { this._attrs[key] = value; },
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
    Math: Object.create(Math), Set, Date, performance: { now: () => 0 },
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

test('elite supply chests have a short anti-burst cooldown rather than a minute quota',()=>{
  const {run}=setup();
  const r=JSON.parse(run("(()=>{startNewGame();wave=20;Math.random=()=>0;for(let t=0;t<180;t++){totalTime=t;combatDirector.registerChestDrop('elite',100,100);lootChests.length=0;}return JSON.stringify({drops:combatDirector.stats.chestDrops.elite,kills:combatDirector.stats.eliteKills,denied:combatDirector.stats.chestDenied,next:combatDirector.getNextEliteChestChance()});})()"));
  assert.equal(r.kills,180);
  assert.equal(r.drops,36);
  assert.ok(r.denied.cooldown>0);
  assert.equal(r.next,.06);
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


test('M2.3 two bosses share a cooldown for ordinary attack salvos', () => {
  const { run } = setup();
  const data=JSON.parse(run(`(() => {
    startNewGame(); totalTime=90;
    const a=new Enemy(150,150,'BOSS_DESTROYER');
    const b=new Enemy(250,250,'BOSS_PRISM');
    activeBosses=[a,b];
    const first=combatDirector.allowBossAttack(a,'regular');
    const second=combatDirector.allowBossAttack(b,'regular');
    totalTime+=0.96;
    const third=combatDirector.allowBossAttack(b,'regular');
    return JSON.stringify({first,second,third,deferred:combatDirector.stats.bossAttacksDeferred});
  })()`));
  assert.deepEqual(data,{first:true,second:false,third:true,deferred:1});
});

test('M2.3 phase warnings are serialized across three simultaneous bosses', () => {
  const { run } = setup();
  const data=JSON.parse(run(`(() => {
    startNewGame(); totalTime=100;
    const bosses=['BOSS_DESTROYER','BOSS_PRISM','BOSS_VOID'].map(t=>new Enemy(200,200,t));
    activeBosses=bosses;
    for(const boss of bosses) {
      boss.hp=boss.maxHp*0.67;
      boss.updateBossPhases(0.01,1,0);
    }
    const delays=bosses.map(b=>b.bossSpecial.delay);
    const initialShots=enemyProjectiles.length;
    for(let i=0;i<190;i++) {
      totalTime+=0.05;
      for(const boss of bosses) boss.updateBossPhases(0.05,1,0);
    }
    return JSON.stringify({delays,initialShots,
      attacks:combatDirector.stats.bossSpecialAttacks,
      shots:enemyProjectiles.length,phases:bosses.map(b=>b.bossPhase)});
  })()`));
  assert.equal(data.initialShots,0);
  assert.ok(data.delays[1]>data.delays[0]+1.5 && data.delays[2]>data.delays[1]+1.5);
  assert.equal(data.attacks,3);
  assert.equal(data.shots,13);
  assert.deepEqual(data.phases,[2,2,2]);
});

test('M2.3 direct damage past both boss thresholds still queues both phases', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame();totalTime=85;
    const boss=new Enemy(120,120,'BOSS_DESTROYER');
    boss.hp=boss.maxHp*0.2;
    boss.updateBossPhases(0.02,100,0);
    const first=boss.bossPhase;
    totalTime+=2;
    boss.updateBossPhases(1.5,100,0);
    const afterFirst=boss.bossPhase;
    totalTime+=.05;
    boss.updateBossPhases(.05,100,0);
    const second=boss.bossPhase;
    totalTime+=2;
    boss.updateBossPhases(1.5,100,0);
    return JSON.stringify({first,afterFirst,second,attacks:boss.bossSpecialCount,
      tracked:combatDirector.stats.bossSpecialAttacks});
  })()`));
  assert.equal(state.first,2);
  assert.equal(state.afterFirst,2);
  assert.equal(state.second,3);
  assert.equal(state.attacks,2);
  assert.equal(state.tracked,2);
});

test('M2.3 event offer occurs only in safe director windows and resets each run', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame(); wave=8; totalTime=150;
    nextBossTime=500;combatDirector.nextArenaAt=0;
    combatDirector.update(.016);
    const first=combatDirector.activeArenaEvent?.kind;
    const metrics=window.getNeonRunDiagnostics();
    startNewGame();
    return JSON.stringify({first,offers:metrics.arenaOffered,
      newEvent:combatDirector.activeArenaEvent,newOffers:combatDirector.stats.arenaOffered});
  })()`));
  assert.equal(state.first,'RELAY');
  assert.equal(state.offers,1);
  assert.equal(state.newEvent,null);
  assert.equal(state.newOffers,0);
});

test('M2.3 relay rewards XP and overdrive only after sustained optional capture', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame();wave=7;totalTime=150;nextBossTime=500;combatDirector.nextArenaAt=0;
    combatDirector.update(.01);
    const evt=combatDirector.activeArenaEvent;
    const initialXp=player.xp,initialOverdrive=player.overdrive;
    player.x=evt.x;player.y=evt.y;
    evt.update(1.2);
    player.x+=130;evt.update(.5);
    const incomplete=!evt.dead;
    player.x=evt.x;evt.update(2.5);
    return JSON.stringify({incomplete,dead:evt.dead,initialXp,xp:player.xp,
      initialOverdrive,overdrive:player.overdrive,completed:combatDirector.stats.arenaCompleted,
      remaining:combatDirector.activeArenaEvent});
  })()`));
  assert.equal(state.incomplete,true);
  assert.equal(state.dead,true);
  assert.ok(state.xp>state.initialXp);
  assert.ok(state.overdrive>state.initialOverdrive);
  assert.equal(state.completed,1);
  assert.equal(state.remaining,null);
});

test('M2.3 vault requires sufficient HP and charges at most once, with balanced reward', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame();wave=8;totalTime=150;nextBossTime=500;
    combatDirector.arenaEventIndex=1;combatDirector.nextArenaAt=0;
    combatDirector.update(.01);
    const evt=combatDirector.activeArenaEvent;
    player.x=evt.x;player.y=evt.y;player.hp=20;
    evt.update(.2);const declined=evt.committed;
    player.hp=80;
    evt.update(.2);const afterCommit=player.hp;
    evt.update(.5);const afterRepeat=player.hp;
    evt.update(4);
    return JSON.stringify({kind:evt.kind,declined,afterCommit,afterRepeat,
      finalHp:player.hp,gold:sessionGold,completed:combatDirector.stats.arenaCompleted});
  })()`));
  assert.equal(state.kind,'VAULT');
  assert.equal(state.declined,false);
  assert.equal(state.afterCommit,68);
  assert.equal(state.afterRepeat,68);
  assert.equal(state.finalHp,74);
  assert.equal(state.gold,44);
  assert.equal(state.completed,1);
});

test('M2.3 boss warning cancels risky event and refunds charged HP', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame();wave=8;totalTime=150;nextBossTime=500;
    combatDirector.arenaEventIndex=1;combatDirector.nextArenaAt=0;
    combatDirector.update(.01);
    const evt=combatDirector.activeArenaEvent;
    player.hp=92;player.x=evt.x;player.y=evt.y;
    evt.update(.2);
    const paid=player.hp;
    nextBossTime=totalTime+10;
    combatDirector.update(.01);
    return JSON.stringify({paid,refunded:player.hp,
      gone:combatDirector.activeArenaEvent,cancelled:combatDirector.stats.arenaCancelled,
      completed:combatDirector.stats.arenaCompleted});
  })()`));
  assert.equal(state.paid,80);
  assert.equal(state.refunded,92);
  assert.equal(state.gone,null);
  assert.equal(state.cancelled,1);
  assert.equal(state.completed,0);
});

test('M2.3 unclaimed event expires without reward, penalty or extra threats', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame();wave=6;totalTime=150;nextBossTime=500;
    combatDirector.nextArenaAt=0;combatDirector.update(.01);
    const evt=combatDirector.activeArenaEvent;
    const gold=totalGold,hp=player.hp,tokens=combatDirector.tokens;
    evt.update(20);
    return JSON.stringify({expired:evt.dead,remaining:combatDirector.activeArenaEvent,
      expiredCount:combatDirector.stats.arenaExpired,goldBefore:gold,goldAfter:totalGold,
      hpBefore:hp,hpAfter:player.hp,threatTokens:tokens});
  })()`));
  assert.equal(state.expired,true);
  assert.equal(state.remaining,null);
  assert.equal(state.expiredCount,1);
  assert.equal(state.goldAfter,state.goldBefore);
  assert.equal(state.hpAfter,state.hpBefore);
});

test('M2.3 optional arena event renders using mock canvas without error', () => {
  const { run }=setup();
  const state=JSON.parse(run(`(() => {
    startNewGame();wave=8;totalTime=150;nextBossTime=500;
    combatDirector.nextArenaAt=0;combatDirector.update(.01);
    combatDirector.activeArenaEvent.draw(ctx);
    drawOffscreenIndicators();
    return JSON.stringify({kind:combatDirector.activeArenaEvent.kind,offered:combatDirector.stats.arenaOffered});
  })()`));
  assert.equal(state.kind,'RELAY');
  assert.equal(state.offered,1);
});


test('M3.1 five original evolutions remain among all eleven, with four recipes', () => {
  const { run } = setup();
  const info = JSON.parse(run(`(() => JSON.stringify({
    evolutions: Object.keys(EVOLUTION_DEFS),
    synergies: SYNERGY_DEFS.map(s=>({id:s.id,modules:s.modules})),
    upgrades: UPGRADES_POOL.map(u=>u.id)
  }))()`));
  assert.equal(info.evolutions.length,11);
  for(const id of ['multishot','homing','lightning','orbital','pierce_ricochet']) {
    assert.ok(info.evolutions.includes(id));
  }
  assert.equal(info.synergies.length,4);
  for(const id of info.evolutions) assert.ok(info.upgrades.includes(id));
  for(const s of info.synergies) {
    assert.equal(s.modules.length,2);
    assert.ok(s.modules.every(id=>info.upgrades.includes(id)));
  }
});

test('M3.1 third tier upgrades unlock distinct rail projectile, not generic damage buff', () => {
  const { run }=setup();
  const r=JSON.parse(run(`(() => {
    startNewGame();
    const u=UPGRADES_POOL.find(u=>u.id==='multishot');
    u.apply(player,RARITIES[0]);u.apply(player,RARITIES[0]);
    player.upgradeCounts.multishot=2;player.refreshBuildTraits();
    const beforeDamage=player.damage;
    gameState='LEVEL_UP';currentUpgradeChoices=[{upg:u,rarity:RARITIES[0]}];
    selectUpgradeOption(0);
    const damageRatio=player.damage/beforeDamage;
    enemies.push(new Enemy(player.x+110,player.y,'SWARM'));
    player.shotCounter=3; player.autoShoot();
    return JSON.stringify({evolved:[...player.evolutions],damageRatio,
      rails:bullets.filter(b=>b.evoRail).length,railPierce:bullets.find(b=>b.evoRail)?.pierce,
      railSize:bullets.find(b=>b.evoRail)?.radius,
      snapshot:window.getNeonBuildSnapshot().effects.railShots});
  })()`));
  assert.deepEqual(r.evolved,['multishot']);
  assert.ok(r.damageRatio>1.07 && r.damageRatio<1.09);
  assert.equal(r.rails,1);
  assert.equal(r.railSize,9);
  assert.ok(r.railPierce>=3);
  assert.equal(r.snapshot,1);
});

test('M3.1 live synergy pairs unlock only when both reach level two', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts.multishot=2;
    player.upgradeCounts.homing=1;
    player.refreshBuildTraits();
    const before=[...player.synergies];
    const preview=newSynergiesForUpgrade(player.upgradeCounts,'homing').map(s=>s.id);
    const u=UPGRADES_POOL.find(u=>u.id==='homing');
    gameState='LEVEL_UP';currentUpgradeChoices=[{upg:u,rarity:RARITIES[0]}];
    selectUpgradeOption(0);
    const after=[...player.synergies];
    enemies.push(new Enemy(player.x+120,player.y,'SWARM'));
    player.shotCounter=1; player.autoShoot();
    return JSON.stringify({before,preview,after,missiles:bullets.filter(b=>b.isHoming).length});
  })()`));
  assert.deepEqual(x.before,[]);
  assert.deepEqual(x.preview,['swarm_guidance']);
  assert.deepEqual(x.after,['swarm_guidance']);
  assert.equal(x.missiles,1);
});

test('M3.1 cluster missile creates two bounded non-recursive fragments on hit', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const target=new Enemy(player.x+100,player.y,'TANK');
    enemies.push(target);
    player.upgradeCounts.homing=3;player.refreshBuildTraits();
    player.homingMissiles=1;player.shotCounter=2;player.autoShoot();
    const missile=bullets.find(b=>b.isHoming);
    const count=spawnClusterFragments(missile,target);
    const again=spawnClusterFragments(missile,target);
    const fragments=bullets.filter(b=>b!==missile && b.isHoming);
    return JSON.stringify({evolved:player.evolutions.has('homing'),payload:missile.clusterPayload,
      count,again,fragments:fragments.length,
      protected:fragments.every(b=>b.hitIds.has(target.id) && !b.clusterPayload),
      stats:player.buildStats.clusterBursts});
  })()`));
  assert.equal(x.evolved,true);
  assert.equal(x.payload,true);
  assert.equal(x.count,2);
  assert.equal(x.again,0);
  assert.equal(x.fragments,2);
  assert.equal(x.protected,true);
  assert.equal(x.stats,1);
});

test('M3.1 cluster payload integrates with indexed projectile collision', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.fireTimer=100;
    const target=new Enemy(player.x+80,player.y,'TANK');target.speed=0;
    enemies.push(target);
    const missile=new Bullet(target.x,target.y,0,0,10,6,1,0,true,true);
    missile.clusterPayload=true;
    bullets.push(missile);
    updateGame(.016);
    return JSON.stringify({bursts:player.buildStats.clusterBursts,
      fragments:bullets.filter(b=>b.isHoming && b!==missile).length,dead:missile.dead,
      targetHp:target.hp,maxHp:target.maxHp});
  })()`));
  assert.equal(x.bursts,1);
  assert.equal(x.fragments,2);
  assert.equal(x.dead,true);
  assert.ok(x.targetHp<x.maxHp);
});

test('M3.1 evolved critical lightning arcs to a second enemy deterministically', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.chainLightning=1;player.upgradeCounts.lightning=3;player.refreshBuildTraits();
    const a=new Enemy(200,200,'TANK'),b=new Enemy(300,200,'TANK');
    enemies.push(a,b);
    const before=b.hp;
    a.takeDamage(10,0,0,true,true);
    return JSON.stringify({before,after:b.hp,arcs:player.buildStats.arcSurges,
      bolts:lightningBolts.length});
  })()`));
  assert.ok(x.after<x.before);
  assert.equal(x.arcs,1);
  assert.equal(x.bolts,1);
});

test('M3.1 evolved orbitals pulse on interval and keep old direct contacts', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const target=new Enemy(player.x+75,player.y,'TANK');target.speed=0;
    enemies.push(target);
    player.upgradeCounts.orbital=3;player.refreshBuildTraits();player.orbitals=1;
    player.evolutionPulseTimer=.01;
    const before=target.hp;
    player.update(.05);
    return JSON.stringify({before,after:target.hp,pulses:player.buildStats.orbitalPulses,
      cooldown:player.evolutionPulseTimer,orbitals:player.orbitals});
  })()`));
  assert.ok(x.after<x.before);
  assert.equal(x.pulses,1);
  assert.ok(x.cooldown>5);
  assert.equal(x.orbitals,1);
});

test('M3.1 evolved ricochet retargets and applies capped bounce damage', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const target=new Enemy(worldWidth-250,worldHeight/2+80,'TANK');
    enemies.push(target);
    const shell=new Bullet(worldWidth-6,worldHeight/2,180,0,20,5,2,3);
    shell.prismEvolved=true;
    shell.update(.1);
    return JSON.stringify({vx:shell.vx,vy:shell.vy,damage:shell.damage,
      bounces:player.buildStats.prismBounces,remaining:shell.ricochet});
  })()`));
  assert.ok(x.vx<0 && x.vy>0);
  assert.equal(x.damage,24);
  assert.equal(x.remaining,2);
  assert.equal(x.bounces,1);
});

test('M3.1 shield orbital synergy counters one blocked hit and shortens recharge', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const target=new Enemy(player.x+65,player.y,'TANK');target.speed=0;enemies.push(target);
    player.upgradeCounts.orbital=2;player.upgradeCounts.aegis_shield=2;player.refreshBuildTraits();
    player.hasShield=true;player.shieldActive=true;player.shieldMaxCooldown=10;
    const hp=target.hp;
    player.takeDamage(40);
    const before=player.shieldCooldown;
    player.update(.5);
    return JSON.stringify({synergy:[...player.synergies],blockedHp:player.hp,
      targetBefore:hp,targetAfter:target.hp,shieldActive:player.shieldActive,
      initialCooldown:before,remaining:player.shieldCooldown,
      pulses:player.buildStats.aegisPulses});
  })()`));
  assert.ok(x.synergy.includes('orbital_aegis'));
  assert.equal(x.blockedHp,100);
  assert.ok(x.targetAfter<x.targetBefore);
  assert.equal(x.shieldActive,false);
  assert.ok(x.remaining<9.5);
  assert.equal(x.pulses,1);
});

test('M3.1 crit plus prism synergy adds precisely one pierce and ricochet', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.critChance=1;
    player.upgradeCounts.pierce_ricochet=2;player.upgradeCounts.crit_mastery=2;
    player.refreshBuildTraits();
    player.pierce=2;player.ricochet=1;
    enemies.push(new Enemy(player.x+90,player.y,'TANK'));
    const originalRandom=Math.random;
    Math.random=()=>0;
    try { player.autoShoot(); } finally { Math.random=originalRandom; }
    const b=bullets[0];
    return JSON.stringify({synergy:player.synergies.has('prism_optics'),
      crit:b.isCrit,pierce:b.pierce,ricochet:b.ricochet});
  })()`));
  assert.equal(x.synergy,true);
  assert.equal(x.crit,true);
  assert.equal(x.pierce,3);
  assert.equal(x.ricochet,2);
});

test('M3.1 upgrade offers one level-two evolution when available and resets next run', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts.homing=2;player.refreshBuildTraits();
    populateUpgradeCards();
    const offered=currentUpgradeChoices.map(x=>x.upg.id);
    player.upgradeCounts.homing=3;player.refreshBuildTraits();
    const pre=window.getNeonBuildSnapshot();
    startNewGame();
    const post=window.getNeonBuildSnapshot();
    return JSON.stringify({offered,evolutions:pre.evolutions,after:post});
  })()`));
  assert.ok(x.offered.includes('homing'));
  assert.deepEqual(x.evolutions,['homing']);
  assert.deepEqual(x.after.evolutions,[]);
  assert.deepEqual(x.after.synergies,[]);
  assert.deepEqual(x.after.modules,{});
});


test('M3.1 ionic guidance guarantees chain on main missile impact', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.fireTimer=100;
    const a=new Enemy(player.x+110,player.y,'TANK');
    const b=new Enemy(player.x+185,player.y,'TANK');
    a.speed=0;b.speed=0;enemies.push(a,b);
    player.upgradeCounts.homing=2;player.upgradeCounts.lightning=2;
    player.refreshBuildTraits();player.chainLightning=1;
    const missile=new Bullet(a.x,a.y,0,0,12,6,1,0,true,true);
    missile.forceChain=player.synergies.has('ionic_guidance');
    bullets.push(missile);
    const before=b.hp;
    updateGame(.016);
    return JSON.stringify({enabled:missile.forceChain,arc:lightningBolts.length,
      before,after:b.hp,dead:missile.dead});
  })()`));
  assert.equal(x.enabled,true);
  assert.equal(x.arc,1);
  assert.ok(x.after<x.before);
  assert.equal(x.dead,true);
});

test('M3.1 cluster fragments respect hard projectile allocation ceiling', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const target=new Enemy(player.x+80,player.y,'TANK');
    bullets=Array.from({length:259},()=>new Bullet(30,30,0,0,1,3,1,0));
    const payload=new Bullet(50,50,1,0,10,6,1,0,true,true);
    payload.clusterPayload=true;
    const blocked=spawnClusterFragments(payload,target);
    const underCap=bullets.length;
    bullets.length=258;
    const emitted=spawnClusterFragments(payload,target);
    return JSON.stringify({blocked,underCap,emitted,atCap:bullets.length});
  })()`));
  assert.equal(x.blocked,0);
  assert.equal(x.underCap,259);
  assert.equal(x.emitted,2);
  assert.equal(x.atCap,260);
});


test('M3.2 all eleven modules now have unique third-tier evolutions', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => JSON.stringify({
    names:UPGRADES_POOL.map(u=>u.id),evolutions:Object.keys(EVOLUTION_DEFS),
    missing:UPGRADES_POOL.filter(u=>!EVOLUTION_DEFS[u.id]).map(u=>u.id)
  }))()`));
  assert.equal(x.names.length,11);
  assert.equal(x.evolutions.length,11);
  assert.deepEqual(x.missing,[]);
});

test('M3.2 reactor rhythm fires two bounded flank shots every fifth salvo', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts.firerate=3;player.refreshBuildTraits();
    enemies.push(new Enemy(player.x+100,player.y,'TANK'));
    for(let i=0;i<5;i++)player.autoShoot();
    const pulses=bullets.filter(b=>b.reactorPulse);
    return JSON.stringify({pulses:pulses.length,bursts:player.buildStats.reactorBursts,
      damage:pulses.map(b=>b.damage),base:player.damage,
      total:bullets.length});
  })()`));
  assert.equal(x.pulses,2);
  assert.equal(x.bursts,1);
  assert.ok(x.damage.every(v=>v===x.base*.5));
  assert.equal(x.total,7);
});

test('M3.2 cyber overdrive clears only nearby projectiles once per activation', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.upgradeCounts.overdrive_boost=3;player.refreshBuildTraits();
    for(let i=0;i<20;i++)enemyProjectiles.push(new EnemyProjectile(player.x+20,player.y+20,0,0,5,10));
    const remote=new EnemyProjectile(player.x+360,player.y,0,0,5,10);
    enemyProjectiles.push(remote);
    player.addOverdrive(200);
    const cleared=enemyProjectiles.filter(b=>b.dead).length;
    player.addOverdrive(200);
    return JSON.stringify({cleared,remoteDead:remote.dead,active:player.overdriveActive,
      discharges:player.buildStats.overdriveDischarges});
  })()`));
  assert.equal(x.cleared,12);
  assert.equal(x.remoteDead,false);
  assert.equal(x.active,true);
  assert.equal(x.discharges,1);
});

test('M3.2 weakpoint critical mark increases real noncrit damage but cannot stack', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();totalTime=10;
    player.upgradeCounts.crit_mastery=3;player.refreshBuildTraits();
    const target=new Enemy(150,150,'TANK');
    target.takeDamage(10,0,0,true,false);
    const marked=target.weakpointUntil>totalTime;
    const afterCrit=target.hp;
    target.takeDamage(10,0,0,false,false);
    const boostedDamage=afterCrit-target.hp;
    target.takeDamage(10,0,0,true,false);
    const counter=player.buildStats.weakpointMarks;
    totalTime=14;
    const afterExpire=target.hp;
    target.takeDamage(10,0,0,false,false);
    return JSON.stringify({marked,boostedDamage,counter,normalDamage:afterExpire-target.hp});
  })()`));
  assert.equal(x.marked,true);
  assert.ok(Math.abs(x.boostedDamage-11.2)<.001);
  assert.equal(x.counter,1);
  assert.ok(Math.abs(x.normalDamage-10)<.001);
});

test('M3.2 blood reactor heals once per five non-boss kills with cooldown', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();totalTime=10;
    player.hp=40;player.upgradeCounts.vampiric=3;player.refreshBuildTraits();
    for(let i=0;i<5;i++)new Enemy(120+i*8,120,'SWARM').die();
    const first=player.hp;
    for(let i=0;i<5;i++)new Enemy(120+i*8,120,'SWARM').die();
    const blocked=player.hp, stored=player.bloodReactorKills;
    totalTime=15;new Enemy(200,200,'SWARM').die();
    return JSON.stringify({first,blocked,stored,after:player.hp,
      heals:player.buildStats.bloodReactorHeals});
  })()`));
  assert.equal(x.first,48);
  assert.equal(x.blocked,48);
  assert.equal(x.stored,5);
  assert.equal(x.after,56);
  assert.equal(x.heals,2);
});

test('M3.2 aegis evolution counters only one blocked hit with at most three homing bolts', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.upgradeCounts.aegis_shield=3;player.refreshBuildTraits();
    player.hasShield=true;player.shieldActive=true;
    for(let i=0;i<5;i++)enemies.push(new Enemy(player.x+65+i*18,player.y,'TANK'));
    const beforeHp=player.hp;player.takeDamage(25);
    player.takeDamage(25);
    return JSON.stringify({hp:player.hp,beforeHp,active:player.shieldActive,
      bolts:bullets.filter(b=>b.isHoming).length,deflections:player.buildStats.aegisDeflections});
  })()`));
  assert.equal(x.hp,x.beforeHp);
  assert.equal(x.active,false);
  assert.equal(x.bolts,3);
  assert.equal(x.deflections,3);
});

test('M3.2 kinetic evolution triggers a cooldown-limited post-dash vortex and orb magnet', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();totalTime=10;
    player.upgradeCounts.kinetic_magnet=3;player.refreshBuildTraits();
    const target=new Enemy(player.x+260,player.y,'TANK');
    enemies.push(target);
    const orb=new EnergyOrb(player.x+250,player.y,10,false);
    orbs.push(orb);
    const hp=target.hp;
    player.triggerDash();player.update(.20);
    const first=player.buildStats.kineticVortices;
    player.isDashing=true;player.dashTimer=.01;player.update(.02);
    return JSON.stringify({first,pulses:player.buildStats.kineticVortices,
      magnet:orb.magnetized,hit:target.hp<hp,readyAt:player.kineticVortexReadyAt});
  })()`));
  assert.equal(x.first,1);
  assert.equal(x.pulses,1);
  assert.equal(x.magnet,true);
  assert.equal(x.hit,true);
  assert.equal(x.readyAt,14);
});

test('M3.2 build stat normalization caps runaway high-rarity stacking', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    for(let n=0;n<16;n++) {
      for(const id of ['multishot','firerate','homing','crit_mastery','kinetic_magnet','vampiric']) {
        UPGRADES_POOL.find(u=>u.id===id).apply(player,RARITIES[3]);
      }
    }
    normalizePlayerBuildPower(player);
    return JSON.stringify({damage:player.damage,crit:player.critChance,
      delay:player.fireDelay,multi:player.multishot,missiles:player.homingMissiles,
      speed:player.speed,magnet:player.magnetRadius,heal:player.vampiricHeal});
  })()`));
  assert.ok(x.damage<=240 && x.crit<=.60 && x.delay>=.12);
  assert.ok(x.multi<=7 && x.missiles<=5 && x.speed<=470);
  assert.ok(x.magnet<=280 && x.heal<=12);
});

test('M3.2 full-tier modules never appear again in upgrade draft', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.upgradeCounts.homing=3;
    player.upgradeCounts.firerate=2;
    player.refreshBuildTraits();
    populateUpgradeCards();
    return JSON.stringify({choices:currentUpgradeChoices.map(c=>c.upg.id),
      fire:currentUpgradeChoices.find(c=>c.upg.id==='firerate')?.upg.id});
  })()`));
  assert.equal(x.choices.includes('homing'),false);
  assert.equal(x.fire,'firerate');
});

test('M3.2 fully completed 33-tier run does not open an empty choice dialog', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    for(const u of UPGRADES_POOL)player.upgradeCounts[u.id]=3;
    player.refreshBuildTraits();
    player.hp=player.maxHp-40;
    triggerLevelUp();
    return JSON.stringify({state:gameState,hp:player.hp,max:player.maxHp,
      evolutions:player.evolutions.size,choices:currentUpgradeChoices.length});
  })()`));
  assert.equal(x.state,'PLAYING');
  assert.equal(x.hp,x.max-20);
  assert.equal(x.evolutions,11);
});

test('M3.2 build guide reports active traits, near goals and correct counts', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts.multishot=3;
    player.upgradeCounts.homing=1;
    player.upgradeCounts.orbital=2;
    player.upgradeCounts.aegis_shield=2;
    player.refreshBuildTraits();
    updateModulesDock();
    const guide=getBuildGuideModel(player);
    const snapshot=window.getNeonBuildSnapshot();
    return JSON.stringify({guide,summary:document.getElementById('buildGuideLabel').textContent,
      included:snapshot.guide.totalTiers===guide.totalTiers});
  })()`));
  assert.equal(x.guide.totalModules,4);
  assert.equal(x.guide.totalTiers,8);
  assert.ok(x.guide.evolutions.includes('Odak Rayı'));
  assert.ok(x.guide.synergies.includes('Savunma Matrisi'));
  assert.ok(x.guide.nextEvolutions.some(e=>e.name==='Küme Roketleri' && e.missing===2));
  assert.ok(x.summary.includes('1 EVRİM / 1 SİNERJİ'));
  assert.equal(x.included,true);
});

test('M3.2 new run resets evolution cooldowns, counters and build guide', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts.firerate=3;player.refreshBuildTraits();
    player.buildStats.reactorBursts=5;player.kineticVortexReadyAt=50;
    startNewGame();
    return JSON.stringify({evolutions:[...player.evolutions],
      burst:player.buildStats.reactorBursts,readyAt:player.kineticVortexReadyAt,
      guide:getBuildGuideModel(player)});
  })()`));
  assert.deepEqual(x.evolutions,[]);
  assert.equal(x.burst,0);
  assert.equal(x.readyAt,0);
  assert.equal(x.guide.totalModules,0);
});


test('M3.2 cleared enemy projectiles cannot damage player on next simulation frame', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame(); player.upgradeCounts.overdrive_boost=3; player.refreshBuildTraits();
    const shot = new EnemyProjectile(player.x,player.y,0,0,8,90);
    enemyProjectiles.push(shot);
    const hp=player.hp;
    player.addOverdrive(200);
    updateGame(.016);
    return JSON.stringify({dead:shot.dead,remaining:enemyProjectiles.length,
      initialHp:hp,afterHp:player.hp,discharges:player.buildStats.overdriveDischarges});
  })()`));
  assert.equal(x.dead,true);
  assert.equal(x.remaining,0);
  assert.equal(x.initialHp,x.afterHp);
  assert.equal(x.discharges,1);
});


test('M3.2 full auto fire never pushes player projectiles past shared cap', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.multishot=7;player.homingMissiles=5;player.fireDelay=.12;
    for(const id of ['multishot','firerate','homing']) player.upgradeCounts[id]=3;
    player.refreshBuildTraits();
    enemies.push(new Enemy(player.x+100,player.y,'TANK'));
    bullets=Array.from({length:257},()=>new Bullet(50,50,0,0,1,4,1,0));
    player.shotCounter=19;
    player.autoShoot();
    return JSON.stringify({shots:bullets.length,cap:MAX_PLAYER_PROJECTILES,
      rails:player.buildStats.railShots,reactor:player.buildStats.reactorBursts});
  })()`));
  assert.equal(x.cap,260);
  assert.ok(x.shots<=x.cap);
  assert.equal(x.shots,260);
});


test('M4.1 primary UI uses compact control cards and has no redundant parenthetical labels', () => {
  const oldLabels = [
    'Mod: Hibrit (Fare + WASD)', 'KESKİN NİŞANCI (SNIPER)',
    'SİBER LABORATUVAR (KALICI GÜÇLENDİRME)', '(EVRİM!)',
    'CANLI ARENA SİMÜLASYONU: AKTİF', 'SİBER CİNNET! ('
  ];
  for(const label of oldLabels) assert.equal(html.includes(label),false,label);
  for(const label of ['id="tabProtocolContent"','WASD · OK TUŞLARI','BOŞLUK · SOL TIK',
    'E · SAĞ TIK','M · KONTROL MODU','id="buildGuidePanel"']) {
    assert.ok(html.includes(label),label);
  }
});

test('M4.1 all basic HUD values and quest progress remain available with short copy', () => {
  const { run }=setup();
  const a=JSON.parse(run(`(() => {
    startNewGame();updateHUD();
    const dom=(id)=>document.getElementById(id).textContent;
    return JSON.stringify({quest:dom('questHudText'),mom:dom('momentumText'),
      overdrive:dom('overdriveText'),level:dom('levelText'),
      hp:dom('hpText'),mode:dom('ctrlModeText'),score:dom('scoreText')});
  })()`));
  assert.match(a.quest,/^(AV|KÜRE|KOMBO) · \d+\/\d+ · \+\d+$/);
  assert.match(a.mom,/^MOMENTUM · %\d+$/);
  assert.match(a.overdrive,/^CİNNET · %\d+$/);
  assert.equal(a.level,1);
  assert.match(a.hp,/\d+\/\d+/);
  assert.doesNotMatch(a.mode,/\(/);
  assert.equal(a.score,'0');
});

test('M4.1 quiet warning sound has a per-category cooldown and respects mute', () => {
  const { run }=setup();
  const a=JSON.parse(run(`(() => {
    const sound=new SoundEngine();let clock=10,voices=0;
    const param={setValueAtTime(){},exponentialRampToValueAtTime(){}};
    const osc=()=>({frequency:param,connect(){},start(){voices++;},stop(){}});
    const gain=()=>({gain:param,connect(){}});
    sound.ctx={get currentTime(){return clock;},createOscillator:osc,
      createGain:gain,destination:{}};
    sound.playThreatCue('boss');
    sound.playThreatCue('boss');
    const throttled=voices;
    sound.playThreatCue('raid');
    const independent=voices;
    clock+=1.51;
    sound.playThreatCue('boss');
    const later=voices;
    sound.enabled=false;sound.playThreatCue('event');
    return JSON.stringify({throttled,independent,later,muted:voices});
  })()`));
  assert.equal(a.throttled,2);
  assert.equal(a.independent,4);
  assert.equal(a.later,6);
  assert.equal(a.muted,6);
});

test('M4.1 boss pre-warning audio is dispatched once per encounter, not every frame', () => {
  const { run }=setup();
  const a=JSON.parse(run(`(() => {
    startNewGame();let count=0;
    audio.playThreatCue=()=>{count++;};
    totalTime=52;nextBossTime=55;
    updateGame(.016);updateGame(.016);updateGame(.016);
    return JSON.stringify({count,last:combatDirector.lastBossCueEncounter,
      encounter:bossEncounterCount,warning:document.getElementById('bossWarningText').textContent});
  })()`));
  assert.equal(a.count,1);
  assert.equal(a.last,1);
  assert.equal(a.encounter,0);
  assert.equal(a.warning,'BOSS YAKLAŞIYOR');
});

test('M4.1 raid and optional event sound cues are tied to actual starts', () => {
  const { run }=setup();
  const a=JSON.parse(run(`(() => {
    startNewGame();const cues=[];
    audio.playThreatCue=(x)=>cues.push(x);
    wave=7;totalTime=29;nextBossTime=150;combatDirector.tokens=12;
    combatDirector.update(.016);
    const pending=!!combatDirector.pendingEncounter;
    combatDirector.update(.016);
    const raidCount=cues.filter(x=>x==='raid').length;
    combatDirector.pendingEncounter=null;
    combatDirector.nextEncounterAt=500;
    combatDirector.nextArenaAt=0;
    totalTime=150;nextBossTime=500;
    combatDirector.update(.016);
    return JSON.stringify({pending,raidCount,event:combatDirector.activeArenaEvent?.kind,
      eventCues:cues.filter(x=>x==='event').length});
  })()`));
  assert.equal(a.pending,true);
  assert.equal(a.raidCount,1);
  assert.equal(a.event,'RELAY');
  assert.equal(a.eventCues,1);
});

test('M4.1 threat and background art render safely and do not affect combat states', () => {
  const { run }=setup();
  const a=JSON.parse(run(`(() => {
    startNewGame();const before=player.hp;
    const shot=new EnemyProjectile(player.x+50,player.y,0,0,7,10,'#00f3ff');
    shot.draw(ctx);
    drawBackgroundGrid();
    wave=7;totalTime=29;nextBossTime=150;combatDirector.tokens=12;
    combatDirector.update(.016);
    drawSpecialEncounterWarning();
    drawOffscreenIndicators();
    return JSON.stringify({before,after:player.hp,warning:!!combatDirector.pendingEncounter});
  })()`));
  assert.equal(a.before,a.after);
  assert.equal(a.warning,true);
});

test('M4.1 selected chassis badges and mode labels stay short', () => {
  const { run }=setup();
  const a=JSON.parse(run(`(() => {
    toggleControlMode();const keyboard=document.getElementById('ctrlModeText').textContent;
    toggleControlMode();const hybrid=document.getElementById('ctrlModeText').textContent;
    return JSON.stringify({keyboard,hybrid});
  })()`));
  assert.equal(a.keyboard,'KLAVYE · M');
  assert.equal(a.hybrid,'HİBRİT · M');
});


test('M4.2 menu exposes unique chassis controls, details and six mechanic cards', () => {
  for (const cls of ['VANGUARD','PHANTOM','TITAN'])
    assert.equal((html.match(new RegExp('data-chassis="' + cls + '"','g'))||[]).length,1);
  for (const id of ['tabProtocolContent','menuChassisDetail','menuChassisDetailTitle',
    'menuChassisAdvice','menuChassisDifficulty','menuCorePreviewDot',
    'menuLoadoutSummary','startBtn','tabCodexContent'])
    assert.equal((html.match(new RegExp('id="' + id + '"','g'))||[]).length,1,id);
  for (const label of ['HAREKET','ATILIM','EMP NOVA','MOMENTUM',
    'SİBER CİNNET','DEFİBRİLATÖR','M · KONTROL MODU'])
    assert.ok(html.includes(label),label);
  assert.equal((html.match(/class="menu-protocol-v2 rounded-xl/g)||[]).length,6);
});

test('M4.2 selected chassis displays accurate contextual advantages', () => {
  const {run}=setup();
  const result=JSON.parse(run(`(() => {
    const data={};
    for(const chassis of ['VANGUARD','PHANTOM','TITAN']){
      selectedChassis=chassis; updateMenuCounters();
      const get=(id)=>document.getElementById(id).textContent;
      data[chassis]={title:get('menuChassisDetailTitle'),desc:get('menuChassisDetail'),
        advice:get('menuChassisAdvice'),difficulty:get('menuChassisDifficulty'),
        metrics:document.getElementById('menuLoadoutSummary').innerHTML};
    }
    return JSON.stringify(data);
  })()`));
  assert.match(result.VANGUARD.desc,/%12/);
  assert.match(result.PHANTOM.desc,/%15/);
  assert.match(result.PHANTOM.desc,/15 yüzde puanı/);
  assert.match(result.PHANTOM.desc,/%20/);
  assert.match(result.TITAN.desc,/50 ek can/);
  assert.match(result.TITAN.desc,/kalkan/);
  assert.ok(result.VANGUARD.metrics.includes('2 diriliş hakkı'));
  assert.ok(result.PHANTOM.metrics.includes('19%'));
  assert.ok(result.TITAN.metrics.includes('150 toplam can'));
  for(const state of Object.values(result)){
    assert.doesNotMatch(state.desc,/\([^)]*\)/);
    assert.match(state.advice,/ÖNERİ/);
    assert.match(state.difficulty,/ZORLUK/);
  }
});

test('M4.2 displayed HP and revives equal actual new-run player stats', () => {
  const {run}=setup();
  const result=JSON.parse(run(`(() => {
    const data={};
    for(const chassis of ['VANGUARD','PHANTOM','TITAN']){
      selectedChassis=chassis;updateMenuCounters();startNewGame();
      data[chassis]={hp:player.maxHp,revives:player.freeRevives,
        damage:player.damage,crit:player.critChance,
        shield:player.hasShield,orbitals:player.orbitals,
        display:document.getElementById('menuLoadoutSummary').innerHTML};
    }
    return JSON.stringify(data);
  })()`));
  for(const data of Object.values(result)){
    assert.ok(data.display.includes(data.hp+' toplam can'));
    assert.ok(data.display.includes(data.revives+' diriliş hakkı'));
  }
  assert.equal(result.TITAN.shield,true);
  assert.equal(result.TITAN.orbitals,1);
  assert.ok(result.PHANTOM.crit>result.VANGUARD.crit);
  assert.ok(result.VANGUARD.damage>result.PHANTOM.damage);
});

test('M4.2 keeps previous game and menu entry points intact', () => {
  for(const id of ['openShopFromMenuBtn','tabProtocolBtn','tabCodexBtn',
    'tabCodexContent','startBtn','selectedChassisBadge','menuHighScore',
    'menuMaxWave','menuGoldText','shopGoldBalance'])
    assert.equal((html.match(new RegExp('id="' + id + '"','g'))||[]).length,1,id);
  for(const anchor of ['function startNewGame()','class CombatDirector',
    'const EVOLUTION_DEFS','playThreatCue'])
    assert.ok(html.includes(anchor),anchor);
});

test('M4.2 restores scrolling and removes redundant footer status', () => {
  const tag=html.match(/<div id="startModal"[^>]+>/)?.[0]||'';
  assert.ok(tag.includes('overflow-y-auto'));
  assert.equal(tag.includes('lg:overflow-hidden'),false);
  assert.equal(html.includes('100% DİNAMİK TAM EKRAN ARAYÜZ AKTİF'),false);
  assert.ok(html.includes('xl:grid-cols-3 gap-2.5 items-stretch'));
});


test('M4.2.1 menu dashboard uses natural-height balanced columns', () => {
  const dashboard=html.match(/<main id="preflightDashboard"[^>]*>/)?.[0]||'';
  assert.ok(dashboard.includes('items-start'));
  assert.equal(dashboard.includes('flex-1'),false);
  assert.equal(dashboard.includes('items-stretch'),false);
  const mainHeader=html.match(/<div id="startModal"[^>]*>[\s\S]{0,250}/)?.[0]||'';
  assert.ok(mainHeader.includes('justify-center'));
  assert.ok(html.includes('#preflightDashboard > section {height:auto;min-height:0;}'));
});

test('M4.2.1 readiness metrics appear once in the right-side preflight above Start', () => {
  const a=html.indexOf('class="lg:col-span-7 flex flex-col');
  const metrics=html.indexOf('id="preflightReadiness"');
  const start=html.indexOf('id="startBtn"');
  const left=html.indexOf('class="lg:col-span-5 flex flex-col');
  assert.ok(left>0 && a>left);
  assert.ok(metrics>a && start>metrics);
  assert.equal((html.match(/id="menuLoadoutSummary"/g)||[]).length,1);
  for(const id of ['menuHighScore','menuMaxWave','selectedChassisBadge',
    'menuChassisDetail','tabProtocolContent','tabCodexContent','openShopFromMenuBtn'])
    assert.equal((html.match(new RegExp('id="' + id + '"','g'))||[]).length,1,id);
});

test('M4.2.1 stat calculations still update after relocating readiness panel', () => {
  const {run}=setup();
  const values=JSON.parse(run(`(() => {
    const info={};
    metaUpgrades.baseDamage=2;metaUpgrades.maxHp=1;metaUpgrades.defibrillator=1;
    for(const chassis of ['VANGUARD','PHANTOM','TITAN']){
      selectedChassis=chassis;updateMenuCounters();startNewGame();
      info[chassis]={hp:player.maxHp,revives:player.freeRevives,
        summary:document.getElementById('menuLoadoutSummary').innerHTML};
    }
    return JSON.stringify(info);
  })()`));
  for(const state of Object.values(values)) {
    assert.ok(state.summary.includes(state.hp+' toplam can'));
    assert.ok(state.summary.includes(state.revives+' diriliş hakkı'));
  }
  assert.ok(values.TITAN.hp>values.VANGUARD.hp);
  assert.ok(values.VANGUARD.revives>values.PHANTOM.revives);
});

test('M4.2.1 both dashboard tabs and all game entry points are still wired', () => {
  for(const name of ['tabProtocolBtn','tabCodexBtn','tabProtocolContent',
    'tabCodexContent','startBtn','openShopFromMenuBtn'])
    assert.equal((html.match(new RegExp('id="' + name + '"','g'))||[]).length,1,name);
  assert.ok(html.includes("tabProtocolContent.classList.remove('hidden')"));
  assert.ok(html.includes("tabCodexContent.classList.remove('hidden')"));
  assert.ok(html.includes('overflow-y-auto'));
  assert.equal(html.includes('lg:h-[100dvh]'),false);
});


test('M4.2.2 desktop menu fits an overflowing viewport without vertical scrolling', () => {
  const {run}=setup();
  const data=JSON.parse(run(`(() => {
    window.innerWidth=1650;window.innerHeight=927;
    const modal=document.getElementById('startModal');
    const shell=document.getElementById('startMenuShell');
    modal.clientHeight=927;shell.scrollHeight=1080;
    fitStartMenuToViewport();
    return JSON.stringify({overflow:modal.style.overflowY,transform:shell.style.transform});
  })()`));
  assert.equal(data.overflow,'hidden');
  assert.match(data.transform,/^scale\(0\.85\d+\)$/);
});

test('M4.2.2 desktop menu avoids scaling if its content fits naturally', () => {
  const {run}=setup();
  const data=JSON.parse(run(`(() => {
    window.innerWidth=1650;window.innerHeight=927;
    const modal=document.getElementById('startModal');
    const shell=document.getElementById('startMenuShell');
    modal.clientHeight=927;shell.scrollHeight=860;
    fitStartMenuToViewport();
    return JSON.stringify({overflow:modal.style.overflowY,transform:shell.style.transform});
  })()`));
  assert.equal(data.overflow,'hidden');
  assert.equal(data.transform,'');
});

test('M4.2.2 mobile and very short windows preserve access to full content', () => {
  const {run}=setup();
  const data=JSON.parse(run(`(() => {
    const modal=document.getElementById('startModal');
    const shell=document.getElementById('startMenuShell');
    modal.clientHeight=720;shell.scrollHeight=1090;
    window.innerWidth=390;window.innerHeight=720;
    fitStartMenuToViewport();
    const mobile={overflow:modal.style.overflowY,transform:shell.style.transform};
    window.innerWidth=1600;window.innerHeight=620;
    fitStartMenuToViewport();
    const short={overflow:modal.style.overflowY,transform:shell.style.transform};
    window.innerWidth=1600;window.innerHeight=720;
    fitStartMenuToViewport();
    const tooTall={overflow:modal.style.overflowY,transform:shell.style.transform};
    return JSON.stringify({mobile,short,tooTall});
  })()`));
  assert.equal(data.mobile.overflow,'auto');
  assert.equal(data.mobile.transform,'');
  assert.equal(data.short.overflow,'auto');
  assert.equal(data.tooTall.overflow,'auto');
});

test('M4.2.2 explanations remain available as six native accessible tip disclosures', () => {
  assert.equal((html.match(/class="menu-protocol-tip"/g)||[]).length,6);
  assert.equal((html.match(/<summary>İPUCU<\/summary>/g)||[]).length,6);
  assert.ok(html.includes('Yakındaki hedeflere otomatik ateş edersin'));
  assert.ok(html.includes('Köşeye sıkıştığında güvenli alan açar'));
  assert.ok(html.includes('Kritik boss anları için gücü zamanlamak önemli'));
  assert.ok(html.includes('prefers-reduced-motion'));
});

test('M4.2.2 fit refreshes after tab switches, returns and delayed font loading', () => {
  for (const anchor of ['function fitStartMenuToViewport()', 'function scheduleMenuFit()',
    'window.addEventListener(\'resize\', scheduleMenuFit)',
    'document.fonts.ready.then(scheduleMenuFit)',
    'menuObserver.observe(document.getElementById(\'startMenuShell\'))',
    'class="menu-protocol-tip"', '#startMenuShell > footer, #menuRunSteps {display:none;}'])
    assert.ok(html.includes(anchor),anchor);
  assert.equal((html.match(/scheduleMenuFit\(\);/g)||[]).length>=3,true);
});


test('M4.3.1 arena palette has distinct beats and prioritizes boss danger over Overdrive', () => {
  const {run}=setup();
  const p=JSON.parse(run(`(() => JSON.stringify({
    buildup:getArenaAtmosphereProfile('BUILDUP',false),
    pressure:getArenaAtmosphereProfile('PRESSURE',false),
    crisis:getArenaAtmosphereProfile('CRISIS',false),
    boss:getArenaAtmosphereProfile('BOSS',true),
    warning:getArenaAtmosphereProfile('WARNING',false),
    recovery:getArenaAtmosphereProfile('RECOVERY',false),
    overdrive:getArenaAtmosphereProfile('PRESSURE',true)
  }))()`));
  assert.equal(p.boss.id,'danger');
  assert.equal(p.warning.id,'danger');
  assert.equal(p.overdrive.id,'overdrive');
  assert.ok(p.crisis.strength>p.pressure.strength);
  assert.ok(p.recovery.strength<p.buildup.strength);
  assert.notEqual(p.crisis.color,p.boss.color);
  assert.notEqual(p.overdrive.color,p.pressure.color);
});

test('M4.3.1 arena draws cosmetic phase motifs without changing game state', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();wave=12;totalTime=43;
    combatDirector.update(.02);
    const before={hp:player.hp,kills,enemies:enemies.length,tokens:combatDirector.tokens};
    drawBackgroundGrid();drawArenaAtmosphere();drawSpecialEncounterWarning();
    const after={hp:player.hp,kills,enemies:enemies.length,tokens:combatDirector.tokens};
    return JSON.stringify({before,after});
  })()`));
  assert.deepEqual(x.after,x.before);
});

test('M4.3.1 projectile visuals distinguish six families without damage changes', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    const variants=[
      {evoRail:true},{reactorPulse:true},{prismEvolved:true},
      {isHoming:true,clusterPayload:true},{isHoming:true},
      {isCrit:true},{}
    ];
    const kinds=variants.map(x=>getProjectileVisualStyle(x).type);
    const same=getProjectileVisualStyle({evoRail:true})===getProjectileVisualStyle({evoRail:true});
    return JSON.stringify({kinds,same});
  })()`));
  assert.deepEqual(x.kinds,['rail','reactor','prism','missile','missile','critical','plasma']);
  assert.equal(x.same,true,'Paint recipes must be cached, not allocated per shot');
});

test('M4.3.1 impact frame budget preserves slots for critical hits', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const common=new Bullet(100,100,20,0,9,5,1,0);
    const critical=new Bullet(100,100,20,0,9,6,1,0,true,false);
    const target={radius:18,isBoss:false};
    const result=[];
    for(let i=0;i<8;i++)result.push(emitWeaponImpact(common,target));
    const important=[emitWeaponImpact(critical,target),emitWeaponImpact(critical,target),
      emitWeaponImpact(critical,target)];
    return JSON.stringify({result,important,count:weaponImpacts.length,
      budget:weaponImpactFrameCount,types:weaponImpacts.map(e=>e.type)});
  })()`));
  assert.equal(x.result.filter(Boolean).length,5);
  assert.deepEqual(x.important,[true,true,false]);
  assert.equal(x.count,7);
  assert.equal(x.budget,7);
  assert.deepEqual(x.types.slice(-2),['critical','critical']);
});

test('M4.3.1 impact pool caps at 56 and makes room for an important hit', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const n=new Bullet(100,100,1,0,10,4,1,0);
    const c=new Bullet(100,100,1,0,10,4,1,0,true);
    const target={radius:12,isBoss:false};
    for(let i=0;i<56;i++)weaponImpacts.push({
      x:0,y:0,type:'plasma',color:'#fff',core:'#fff',duration:.1,life:.1,radius:11,angle:0
    });
    const normal=emitWeaponImpact(n,target);
    const crit=emitWeaponImpact(c,target);
    return JSON.stringify({normal,crit,size:weaponImpacts.length,
      latest:weaponImpacts[weaponImpacts.length-1].type});
  })()`));
  assert.equal(x.normal,false);
  assert.equal(x.crit,true);
  assert.equal(x.size,56);
  assert.equal(x.latest,'critical');
});

test('M4.3.1 actual projectile collision creates impact without changing hit damage', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.fireTimer=100;
    const e=new Enemy(player.x+90,player.y,'TANK');e.speed=0;
    enemies.push(e);
    const b=new Bullet(e.x,e.y,0,0,15,5,1,0,false,false);
    bullets.push(b);
    const hp=e.hp;
    updateGame(.016);
    return JSON.stringify({lost:hp-e.hp,impacts:weaponImpacts.length,
      style:weaponImpacts[0]?.type,dead:b.dead});
  })()`));
  assert.equal(x.lost,15);
  assert.equal(x.impacts,1);
  assert.equal(x.style,'plasma');
  assert.equal(x.dead,true);
});

test('M4.3.1 visual impact lifetime and new run cleanup stay bounded', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const b=new Bullet(120,130,20,0,12,5,1,0,true);
    emitWeaponImpact(b,{radius:16});
    const before=weaponImpacts.length;
    updateGame(.30);
    const expired=weaponImpacts.length;
    emitWeaponImpact(b,{radius:16});
    startNewGame();
    return JSON.stringify({before,expired,cleared:weaponImpacts.length,
      frame:weaponImpactFrameCount});
  })()`));
  assert.equal(x.before,1);
  assert.equal(x.expired,0);
  assert.equal(x.cleared,0);
  assert.equal(x.frame,0);
});

test('M4.3.1 dense bullet field uses compact draw mode', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    bullets=Array.from({length:151},(_,i)=>new Bullet(50+i,50,20,0,8,4,1,0));
    const seen=[];
    const old=Bullet.prototype.draw;
    Bullet.prototype.draw=function(ctx,compact){seen.push(compact);};
    try{renderGame();}finally{Bullet.prototype.draw=old;}
    return JSON.stringify({count:seen.length,compact:seen.every(Boolean)});
  })()`));
  assert.equal(x.count,151);
  assert.equal(x.compact,true);
});

test('M4.3.1 rendering effects is safe for all weapon types and electric bolts', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const types=[
      {evoRail:true},{reactorPulse:true},{prismEvolved:true},
      {isHoming:true,clusterPayload:true},{isHoming:true},{isCrit:true},{}
    ];
    for(const values of types){
      const b=new Bullet(100,150,100,15,8,4,2,1,!!values.isCrit,!!values.isHoming);
      Object.assign(b,values);b.draw(ctx);
    }
    lightningBolts.push({x1:60,y1:90,x2:130,y2:120,life:.1});
    weaponImpacts.push({x:110,y:110,duration:.2,life:.15,radius:12,
      type:'rail',color:'#fff',core:'#fff',angle:0});
    renderGame();
    return JSON.stringify({bullets:bullets.length,impacts:weaponImpacts.length,
      lightning:lightningBolts.length});
  })()`));
  assert.equal(x.impacts,1);
  assert.equal(x.lightning,1);
});


test('M4.3.1.1 electric arcs have bounded segments, preserved endpoints and moving charge', () => {
  const {run}=setup();
  const data=JSON.parse(run(`(() => {
    startNewGame(); totalTime=12;
    emitLightningArc(10,30,180,115,true);
    const arc=lightningBolts[0];
    const first=getLightningArcPoints(arc,12);
    const second=getLightningArcPoints(arc,12.04);
    return JSON.stringify({count:first.length,segments:arc.segments,charged:arc.charged,
      first:first[0],last:first[first.length-1],
      changed:first.slice(1,-1).some((p,i)=>p.x!==second[i+1].x||p.y!==second[i+1].y),
      maxLife:arc.duration,life:arc.life});
  })()`));
  assert.equal(data.charged,true);
  assert.ok(data.segments>=4 && data.segments<=7);
  assert.equal(data.count,data.segments+1);
  assert.deepEqual(data.first,{x:10,y:30});
  assert.deepEqual(data.last,{x:180,y:115});
  assert.equal(data.changed,true);
  assert.equal(data.maxLife,data.life);
});

test('M4.3.1.1 repeated chain arcs never exceed 32 while preserving newest bolts', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    for(let i=0;i<70;i++)emitLightningArc(i,0,i+40,60,i%2===0);
    const last=lightningBolts[lightningBolts.length-1];
    drawLightningArcs();
    return JSON.stringify({count:lightningBolts.length,cap:MAX_LIGHTNING_ARCS,
      oldest:lightningBolts[0].x1,newest:last.x1,charged:last.charged});
  })()`));
  assert.equal(x.cap,32);
  assert.equal(x.count,32);
  assert.equal(x.oldest,38);
  assert.equal(x.newest,69);
  assert.equal(x.charged,false);
});

test('M4.3.1.1 actual chain lightning uses charged animated arcs but identical damage', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.chainLightning=1;
    player.upgradeCounts.lightning=3;player.refreshBuildTraits();
    const a=new Enemy(200,200,'TANK'),b=new Enemy(280,200,'TANK');
    enemies.push(a,b);
    const initial=b.hp;
    a.takeDamage(10,0,0,true,true);
    const arc=lightningBolts[0];
    drawLightningArcs();
    return JSON.stringify({before:initial,after:b.hp,arcCount:lightningBolts.length,
      charged:arc.charged,segments:arc.segments,from:arc.x1,to:arc.x2});
  })()`));
  assert.ok(x.after<x.before);
  assert.equal(x.arcCount,1);
  assert.equal(x.charged,true);
  assert.ok(x.segments>=4);
  assert.equal(x.from,200);
  assert.equal(x.to,280);
});

test('M4.3.1.1 rocket exhaust history is capped and driven by actual movement', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const missile=new Bullet(150,190,280,0,13,6,1,0,true,true);
    const target=new Enemy(330,270,'TANK');enemies.push(target);
    for(let i=0;i<24;i++)missile.update(.02);
    const history=missile.exhaustTrail;
    missile.draw(ctx);
    missile.draw(ctx,true);
    return JSON.stringify({trail:history.length,first:history[0],last:history.at(-1),
      pos:{x:missile.x,y:missile.y},age:missile.visualAge,
      lock:missile.visualLockDistance,heading:Math.atan2(missile.vy,missile.vx)});
  })()`));
  assert.ok(x.trail>1&&x.trail<=9);
  assert.ok(x.last.x>x.first.x);
  assert.ok(x.last.y>x.first.y);
  assert.ok(x.age>0);
  assert.ok(Number.isFinite(x.lock));
  assert.ok(x.heading>0);
});

test('M4.3.1.1 non-homing bullets do not allocate persistent exhaust histories', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const a=new Bullet(100,100,100,0,10,5,1,0,false,false);
    const b=new Bullet(100,100,100,0,10,5,1,0,true,true);
    a.update(.05);b.update(.05);
    return JSON.stringify({regular:a.exhaustTrail,rocketHistory:b.exhaustTrail.length,
      fragment:b.clusterFragment});
  })()`));
  assert.equal(x.regular,null);
  assert.ok(x.rocketHistory<=9);
  assert.equal(x.fragment,false);
});

test('M4.3.1.1 cluster split fragments are visually distinct without recursive payload', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const target=new Enemy(280,280,'TANK');
    const missile=new Bullet(280,280,100,0,20,6,1,0,true,true);
    missile.clusterPayload=true;
    const emitted=spawnClusterFragments(missile,target);
    const history=bullets.map(b=>({fragment:b.clusterFragment,payload:b.clusterPayload,
      radius:b.radius,homing:b.isHoming}));
    for(const shot of bullets)shot.draw(ctx);
    return JSON.stringify({emitted,history});
  })()`));
  assert.equal(x.emitted,2);
  assert.equal(x.history.length,2);
  assert.ok(x.history.every(v=>v.fragment&&v.homing&&!v.payload));
});

test('M4.3.1.1 rocket firing adds visual-only twin muzzle flash with decay', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();player.homingMissiles=1;player.shotCounter=2;
    enemies.push(new Enemy(player.x+170,player.y,'TANK'));
    player.autoShoot();
    const atLaunch=player.missileLaunchFlash;
    player.draw(ctx);player.update(.08);
    return JSON.stringify({atLaunch,after:player.missileLaunchFlash,
      missiles:bullets.filter(b=>b.isHoming).length});
  })()`));
  assert.equal(x.atLaunch,1);
  assert.ok(x.after<x.atLaunch&&x.after>0);
  assert.equal(x.missiles,1);
});

test('M4.3.1.1 impact presentation tracks cluster and boss without altering damage', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const missile=new Bullet(160,160,120,0,12,6,1,0,true,true);
    missile.clusterPayload=true;
    const registered=emitWeaponImpact(missile,{radius:40,isBoss:true});
    const item=weaponImpacts[0];
    drawWeaponImpacts();
    return JSON.stringify({registered,count:weaponImpacts.length,type:item.type,
      boss:item.boss,cluster:item.cluster,radius:item.radius,
      originalDamage:missile.damage,healthAffected:player.hp===player.maxHp});
  })()`));
  assert.equal(x.registered,true);
  assert.equal(x.type,'missile');
  assert.equal(x.boss,true);
  assert.equal(x.cluster,true);
  assert.equal(x.radius,20.8);
  assert.equal(x.originalDamage,12);
  assert.equal(x.healthAffected,true);
});

test('M4.3.1.1 charged critical, rail and rocket paint without new collisions', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const bullet=new Bullet(210,210,180,0,25,8,2,1,true,false);
    const rail=new Bullet(240,240,260,0,30,10,2,0);
    rail.evoRail=true;
    const missile=new Bullet(270,270,130,0,15,6,1,0,true,true);
    bullet.draw(ctx);rail.draw(ctx);missile.draw(ctx);
    emitWeaponImpact(bullet,{radius:18});
    emitWeaponImpact(rail,{radius:30,isBoss:true});
    emitWeaponImpact(missile,{radius:20,isBoss:false});
    drawWeaponImpacts();
    return JSON.stringify({types:weaponImpacts.map(i=>i.type),count:weaponImpacts.length,
      shots:bullets.length,enemyShots:enemyProjectiles.length});
  })()`));
  assert.deepEqual(x.types,['critical','rail','missile']);
  assert.equal(x.count,3);
  assert.equal(x.shots,0);
  assert.equal(x.enemyShots,0);
});

test('M4.3.1.1 new run resets arc and impact visuals with no persistent state', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();emitLightningArc(0,0,100,100,true);
    emitWeaponImpact(new Bullet(0,0,100,0,12,5,1,0,true),{radius:20});
    const before={arcs:lightningBolts.length,impacts:weaponImpacts.length,seed:lightningArcSequence};
    startNewGame();
    const after={arcs:lightningBolts.length,impacts:weaponImpacts.length,seed:lightningArcSequence};
    return JSON.stringify({before,after});
  })()`));
  assert.deepEqual(x.before,{arcs:1,impacts:1,seed:1});
  assert.deepEqual(x.after,{arcs:0,impacts:0,seed:0});
});


test('M4.3.2.1 has four non-overlapping boss visual identities', () => {
  const {run}=setup();
  const profiles=JSON.parse(run('JSON.stringify(BOSS_ARCHETYPES.map(x=>BOSS_VISUALS[x.type]))'));
  assert.equal(profiles.length,4);
  assert.equal(new Set(profiles.map(p=>p.silhouette)).size,4);
  assert.equal(new Set(profiles.map(p=>p.color)).size,4);
});
test('M4.3.2.1 boss silhouettes render for all phases without modifying radius', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const values=[];for(const a of BOSS_ARCHETYPES){const b=new Enemy(200,200,a.type);const radius=b.radius;for(let p=1;p<=3;p++){b.bossPhase=p;b.bossHitFlash=1;b.bossEntranceAge=.35;b.draw(ctx);}values.push(b.radius===radius);}return JSON.stringify(values);})()"));
  assert.deepEqual(x,[true,true,true,true]);
});
test('M4.3.2.1 boss collapse VFX has a cap, expires and resets across runs', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();for(let i=0;i<6;i++){const b=new Enemy(200,200,'BOSS_VOID');b.hp=1;b.die();}const cap=bossDeathVfx.length;for(let i=0;i<12;i++)updateGame(.1);const expiry=bossDeathVfx.length;const b=new Enemy(150,150,'BOSS_TITAN');b.die();startNewGame();return JSON.stringify({cap,expiry,reset:bossDeathVfx.length});})()"));
  assert.deepEqual(x,{cap:3,expiry:0,reset:0});
});
test('M4.3.2.1 multi boss HUD keeps aggregate HP and individual phase chips', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const a=new Enemy(100,100,'BOSS_DESTROYER'),b=new Enemy(200,200,'BOSS_PRISM');a.hp=a.maxHp*.5;b.hp=b.maxHp*.25;a.bossPhase=2;b.bossPhase=3;activeBosses=[a,b];updateHUD();return JSON.stringify({name:document.getElementById('bossNameText').textContent,phase:document.getElementById('bossPhaseText').textContent,chips:document.getElementById('bossIdentityStrip').innerHTML,percent:parseFloat(document.getElementById('bossHpBar').style.width),hp:document.getElementById('bossHpText').textContent});})()"));
  assert.match(x.name,/ÇOKLU BOSS/);
  assert.equal(x.phase,'FAZLAR AYRI');
  assert.match(x.chips,/YIKICI · F2/);
  assert.match(x.chips,/PRİZMA · F3/);
  assert.ok(x.percent>0 && x.percent<100);
  assert.match(x.hp,/ \/ /);
});
test('M4.3.2.1 boss kill effects do not delay score or director recovery', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();spawnBossEncounter();const b=activeBosses[0];b.hp=1;b.takeDamage(10000,0,0,false,false);return JSON.stringify({dead:b.dead,alive:activeBosses.length,fx:bossDeathVfx.length,kills:combatDirector.stats.bossKills,after:nextBossTime>totalTime});})()"));
  assert.equal(x.dead,true);
  assert.equal(x.alive,0);
  assert.equal(x.fx,1);
  assert.equal(x.kills,1);
  assert.equal(x.after,true);
});


test('M4.3.2.2 shares real volley counts, spread and color across four bosses', () => {
  const {run}=setup();
  const result=JSON.parse(run("(()=>{startNewGame();const rows=[];for(const a of BOSS_ARCHETYPES){const config=BOSS_PHASE_VOLLEYS[a.type];const boss=new Enemy(220,220,a.type);for(const phase of [2,3]){enemyProjectiles=[];const n=fireBossPhaseAttack(boss,.25,phase);rows.push({type:a.type,phase,n,configured:phase===3?config.count3:config.count2,firstAngle:Math.atan2(enemyProjectiles[0].vy,enemyProjectiles[0].vx),expect:.25-(n-1)/2*config.spread,color:enemyProjectiles[0].color,baseColor:config.color});}}return JSON.stringify(rows);})()"));
  assert.equal(result.length,8);
  for (const r of result) {
    assert.equal(r.n,r.configured);
    assert.ok(Math.abs(r.firstAngle-r.expect)<1e-9);
    assert.equal(r.color,r.baseColor);
  }
});
test('M4.3.2.2 active/queued phase warnings are never visually conflated', () => {
  const {run}=setup();
  const rows=JSON.parse(run("(()=>{startNewGame();const b=new Enemy(300,300,'BOSS_PRISM');b.bossSpecial={angle:1.2,phase:3,delay:2,timer:1.35};const queued=getBossAttackVisualState(b);b.bossSpecial.delay=0;const active=getBossAttackVisualState(b);b.bossSpecial.timer=.6;const progressed=getBossAttackVisualState(b);return JSON.stringify({queued,active,progressed});})()"));
  assert.equal(rows.queued.kind,'queued');
  assert.equal(rows.queued.progress,0);
  assert.equal(rows.active.kind,'phase');
  assert.equal(rows.active.progress,0);
  assert.equal(rows.active.angle,1.2);
  assert.ok(rows.progressed.progress>0 && rows.progressed.progress<1);
});
test('M4.3.2.2 Titan charge and Prism aim use existing combat timing only', () => {
  const {run}=setup();
  const r=JSON.parse(run("(()=>{startNewGame();const t=new Enemy(200,200,'BOSS_TITAN');t.state='CHARGE';t.actionTimer=.35;t.dashTargetAngle=.8;const titan=getBossAttackVisualState(t);const p=new Enemy(250,250,'BOSS_PRISM');p.actionTimer=.4;p.aimAngle=-.5;const prism=getBossAttackVisualState(p);return JSON.stringify({titan,prism,timer:t.actionTimer,aim:p.aimAngle});})()"));
  assert.equal(r.titan.kind,'charge');
  assert.equal(r.titan.angle,.8);
  assert.equal(r.prism.kind,'aim');
  assert.equal(r.prism.angle,-.5);
  assert.equal(r.timer,.35);
  assert.equal(r.aim,-.5);
});
test('M4.3.2.2 three simultaneous telegraphs render without creating damage', () => {
  const {run}=setup();
  const r=JSON.parse(run("(()=>{startNewGame();const bosses=['BOSS_DESTROYER','BOSS_TITAN','BOSS_VOID'].map(t=>new Enemy(300,300,t));activeBosses=bosses;bosses.forEach((b,i)=>{b.bossSpecial={angle:i*.8,phase:3,delay:i*2,timer:1.35};b.bossPhaseFlash=.7;});const original=JSON.stringify(bosses.map(b=>({hp:b.hp,phase:b.bossPhase,delay:b.bossSpecial.delay,timer:b.bossSpecial.timer})));const shots=enemyProjectiles.length;drawBossArenaPresence(ctx);drawBossAttackTelegraphs(ctx);return JSON.stringify({same:original===JSON.stringify(bosses.map(b=>({hp:b.hp,phase:b.bossPhase,delay:b.bossSpecial.delay,timer:b.bossSpecial.timer}))),shotsBefore:shots,shotsAfter:enemyProjectiles.length});})()"));
  assert.equal(r.same,true);
  assert.equal(r.shotsAfter,r.shotsBefore);
});
test('M4.3.2.2 phase resonance expires while original boss attack scheduling remains intact', () => {
  const {run}=setup();
  const r=JSON.parse(run("(()=>{startNewGame();const b=new Enemy(100,100,'BOSS_DESTROYER');b.hp=b.maxHp*.68;b.updateBossPhases(.01,100,0);const special=b.bossSpecial;const first=b.bossPhaseFlash;for(let i=0;i<15;i++){b.bossPhaseFlash=Math.max(0,b.bossPhaseFlash-.05);}return JSON.stringify({phase:b.bossPhase,first,end:b.bossPhaseFlash,same:special===b.bossSpecial,timer:b.bossSpecial.timer});})()"));
  assert.equal(r.phase,2);
  assert.equal(r.first,.7);
  assert.equal(r.end,0);
  assert.equal(r.same,true);
  assert.ok(Math.abs(r.timer-1.14)<1e-9);
});


test('M4.3.2.3 detail tiers react to projectile pressure without altering bullet lists', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const high=getBossFxQuality();bullets=new Array(110).fill(null);const middle=getBossFxQuality();bullets=new Array(250).fill(null);const low=getBossFxQuality();return JSON.stringify({high,middle,low,count:bullets.length});})()"));
  assert.deepEqual(x,{high:2,middle:1,low:0,count:250});
});

test('M4.3.2.3 hit accent follows incoming direction and throttles repeated hits', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();totalTime=5;const boss=new Enemy(280,280,'BOSS_DESTROYER');const original=boss.hp;boss.takeDamage(17,100,0,true,false);const first={angle:boss.bossHitAngle,crit:boss.bossHitAccentCrit,age:boss.bossHitAccentAge,next:boss.bossNextAccentAt};boss.takeDamage(9,0,100,false,false);return JSON.stringify({first,age:boss.bossHitAccentAge,angle:boss.bossHitAngle,health:original-boss.hp,projectiles:enemyProjectiles.length});})()"));
  assert.equal(x.first.angle,0);
  assert.equal(x.first.crit,true);
  assert.equal(x.first.age,.22);
  assert.equal(x.age,.22);
  assert.equal(x.angle,0);
  assert.equal(x.health,26);
  assert.equal(x.projectiles,0);
});

test('M4.3.2.3 cosmetic timers decay and all four boss identities still draw', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const rows=[];for(const a of BOSS_ARCHETYPES){const b=new Enemy(200,200,a.type);b.bossHitAccentAge=.22;b.bossVolleyRecoil=.25;b.bossPhaseFlash=.7;b.bossHitAccentCrit=true;b.hp=b.maxHp*.32;b.bossPhase=3;const radius=b.radius;b.draw(ctx);b.update(.10);rows.push({radiusSame:b.radius===radius,accent:b.bossHitAccentAge,recoil:b.bossVolleyRecoil,flash:b.bossPhaseFlash});}return JSON.stringify(rows);})()"));
  assert.equal(x.length,4);
  for(const v of x){assert.equal(v.radiusSame,true);assert.ok(v.accent<.22);assert.ok(v.recoil<.25);assert.ok(v.flash<.7);}
});

test('M4.3.2.3 low detail collapse draws fewer fragments without touching score or loot', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const boss=new Enemy(240,240,'BOSS_PRISM');boss.hp=1;boss.die();const fx=bossDeathVfx[0],reward=combatDirector.stats.chestDrops.boss,scoreBefore=score;let fills=0;const spy=new Proxy({}, {get:(_,k)=> k==='fill'?()=>{fills++}:()=>{}});drawBossDeathVfx(spy,fx);const full=fills;bullets=new Array(260).fill(null);fills=0;drawBossDeathVfx(spy,fx);return JSON.stringify({full,low:fills,reward,unchangedScore:score===scoreBefore,life:fx.duration});})()"));
  assert.equal(x.full,4);
  assert.equal(x.low,2);
  assert.equal(x.reward,1);
  assert.equal(x.unchangedScore,true);
  assert.ok(x.life<=.85);
});

test('M4.3.2.3 offscreen boss sprite culling preserves active phase telegraph', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const b=new Enemy(-900,220,'BOSS_TITAN');activeBosses=[b];b.bossSpecial={angle:0,phase:2,delay:0,timer:.6};let strokes=0;const spy=new Proxy({}, {get:(_,k)=>k==='stroke'?()=>{strokes++}:()=>{}});b.draw(spy);const sprite=strokes;drawBossAttackTelegraphs(spy);return JSON.stringify({sprite,telegraph:strokes,shots:enemyProjectiles.length,timer:b.bossSpecial.timer});})()"));
  assert.equal(x.sprite,0);
  assert.ok(x.telegraph>0);
  assert.equal(x.shots,0);
  assert.equal(x.timer,.6);
});

test('M4.3.2.3 visual-only volley recoil resets after a fresh game', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const boss=new Enemy(180,180,'BOSS_VOID');const before=fireBossPhaseAttack(boss,0,2),recoil=boss.bossVolleyRecoil;startNewGame();const fresh=new Enemy(180,180,'BOSS_VOID');return JSON.stringify({before,recoil,after:fresh.bossVolleyRecoil,deathFx:bossDeathVfx.length});})()"));
  assert.equal(x.before,5);
  assert.equal(x.recoil,.25);
  assert.equal(x.after,0);
  assert.equal(x.deathFx,0);
});


test('M4.3.2.3 genuine phase transition renews resonance before it decays', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const b=new Enemy(150,150,'BOSS_DESTROYER');b.bossPhaseFlash=.2;b.hp=b.maxHp*.68;b.updateBossPhases(.01,1,0);const renewed=b.bossPhaseFlash;const phase=b.bossPhase;b.update(.05);return JSON.stringify({renewed,after:b.bossPhaseFlash,phase});})()"));
  assert.equal(x.phase,2);
  assert.equal(x.renewed,.7);
  assert.ok(x.after<.7);
});


test('M4.3.3 separates equipment, utility and third-tier evolution independently from rarity', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{const card=(id,tier,r)=>getUpgradeCardPresentation(UPGRADES_POOL.find(u=>u.id===id),RARITIES.find(z=>z.id===r),tier);return JSON.stringify({weapon:card('homing',1,'RARE'),module:card('vampiric',0,'COMMON'),evo:card('homing',2,'EPIC'),legendaryEvo:card('homing',2,'LEGENDARY'),all:UPGRADES_POOL.map(u=>card(u.id,0,'COMMON').role)});})()"));
  assert.equal(x.weapon.role,'weapon');
  assert.equal(x.module.role,'module');
  assert.equal(x.evo.role,'evolution');
  assert.equal(x.evo.isLegendary,false);
  assert.equal(x.legendaryEvo.role,'evolution');
  assert.equal(x.legendaryEvo.isLegendary,true);
  assert.equal(x.all.length,11);
});

test('M4.3.3 reserves gold styling for legendary while orbital icon stays neutral on all other rarities', () => {
  assert.match(html,/\.upgrade-card\[data-rarity="LEGENDARY"\]/);
  assert.match(html,/@keyframes upgrade-legendary-glow/);
  const {run}=setup();
  const x=JSON.parse(run("(()=>{const u=UPGRADES_POOL.find(u=>u.id==='orbital');return JSON.stringify(RARITIES.map(r=>{const p=getUpgradeCardPresentation(u,r,0);return {id:r.id,markup:renderUpgradeCardMarkup(u,r,0,0,p,[])};}));})()"));
  for(const card of x){
    assert.doesNotMatch(card.markup,/#ffe600|#eab308|text-yellow|animate-bounce/);
    assert.match(card.markup,/upgrade-weapon-scan/);
    assert.equal(card.markup.includes('✦ EFSANEVİ'),card.id==='LEGENDARY');
  }
});

test('M4.3.3 legendary evolution keeps purple transformation and golden rarity simultaneously', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{const u=UPGRADES_POOL.find(u=>u.id==='multishot'),v=UPGRADES_POOL.find(u=>u.id==='vampiric'),r=RARITIES[3];const e=getUpgradeCardPresentation(u,r,2),w=getUpgradeCardPresentation(u,r,0),m=getUpgradeCardPresentation(v,RARITIES[0],0);return JSON.stringify({e:renderUpgradeCardMarkup(u,r,2,0,e,[]),w:renderUpgradeCardMarkup(u,r,0,1,w,[]),m:renderUpgradeCardMarkup(v,RARITIES[0],0,2,m,[])});})()"));
  assert.match(x.e,/upgrade-evolution-orbit/);
  assert.match(x.e,/Odak Rayı/);
  assert.match(x.e,/EFSANEVİ/);
  assert.doesNotMatch(x.e,/upgrade-weapon-scan/);
  assert.match(x.w,/upgrade-weapon-brackets/);
  assert.match(x.w,/upgrade-weapon-scan/);
  assert.match(x.m,/SİSTEM MODÜLÜ/);
  assert.doesNotMatch(x.m,/upgrade-evolution-orbit/);
});

test('M4.3.3 live modal draws 3 classified choices with preserved numeric shortcuts', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();for(const u of UPGRADES_POOL)player.upgradeCounts[u.id]=3;player.upgradeCounts.homing=2;player.upgradeCounts.multishot=0;player.upgradeCounts.vampiric=0;const box=document.getElementById('upgradeCardsContainer'),cards=[];box.appendChild=c=>cards.push(c);const saved=rollRarity;let k=0;rollRarity=()=>[RARITIES[0],RARITIES[3],RARITIES[2]][k++];try{populateUpgradeCards();}finally{rollRarity=saved;}return JSON.stringify({ids:currentUpgradeChoices.map(c=>c.upg.id),cards:cards.map(c=>({role:c._attrs['data-role'],rarity:c._attrs['data-rarity'],shortcut:c._attrs['aria-keyshortcuts'],markup:c.innerHTML}))});})()"));
  assert.equal(x.ids.length,3);
  assert.ok(x.ids.includes('homing'));
  assert.deepEqual(x.cards.map(c=>c.shortcut),['1','2','3']);
  assert.deepEqual(new Set(x.cards.map(c=>c.role)),new Set(['evolution','weapon','module']));
  assert.ok(x.cards.some(c=>c.rarity==='LEGENDARY'));
  assert.ok(x.cards.some(c=>c.markup.includes('EVRİMİ AÇ')));
});

test('M4.3.3 selection grants unchanged level-three evolution and rarity power', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.homing=2;player.refreshBuildTraits();gameState='LEVEL_UP';const r=RARITIES[1],u=UPGRADES_POOL.find(u=>u.id==='homing'),before=player.homingMissiles;currentUpgradeChoices=[{upg:u,rarity:r}];selectUpgradeOption(0);return JSON.stringify({tier:player.upgradeCounts.homing,evolution:player.evolutions.has('homing'),missiles:player.homingMissiles,before,state:gameState,rarity:r.id});})()"));
  assert.equal(x.tier,3);
  assert.equal(x.evolution,true);
  assert.ok(x.missiles>x.before);
  assert.equal(x.state,'PLAYING');
  assert.equal(x.rarity,'RARE');
});

test('M4.3.3 reduced motion covers all animations and keyboard/reroll flows remain wired', () => {
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?upgrade-evolution-orbit[\s\S]*?upgrade-weapon-scan\{animation:none!important/);
  assert.match(html,/card\.setAttribute\('aria-keyshortcuts',String\(idx\+1\)\)/);
  assert.match(html,/else if \(e\.code === 'KeyR'\)/);
  assert.match(html,/function triggerLevelUp\(\)/);
  assert.match(html,/function selectUpgradeOption\(index\)/);
});


test('M4.3.3.1 four distinct rarity identities use green, electric blue, pink and gold', () => {
  const expectations = [
    ['COMMON','#55f7a7','#0d332a'],
    ['RARE','#67b9ff','#112952'],
    ['EPIC','#ff78e4','#401547'],
    ['LEGENDARY','#ffe283','#422809']
  ];
  for(const [id,accent] of expectations){
    assert.ok(html.includes('.upgrade-card.upgrade-card[data-rarity="'+id+'"]'),id+' selector is missing');
    assert.ok(html.includes('--rarity-ink:'+accent),id+' identity is missing');
  }
  assert.match(html,/--rarity-dark:#0a342b/);
  assert.match(html,/#0d332a/);
  assert.match(html,/#112952/);
  assert.match(html,/#401547/);
  assert.match(html,/#ffd24b/);
});

test('M4.3.3.1 markup provides distinct icons and explicit rarity names for all four drops', () => {
  const {run}=setup();
  const rows=JSON.parse(run("(()=>{const u=UPGRADES_POOL.find(v=>v.id==='homing');return JSON.stringify(RARITIES.map(r=>{const motif=UPGRADE_RARITY_MOTIFS[r.id];const p=getUpgradeCardPresentation(u,r,0);const html=renderUpgradeCardMarkup(u,r,0,0,p,[]);return {id:r.id,icon:motif.icon,tag:motif.tag,markup:html};}));})()"));
  assert.equal(rows.length,4);
  assert.equal(new Set(rows.map(r=>r.icon)).size,4);
  for(const row of rows) {
    assert.ok(row.markup.includes(row.icon),row.id);
    assert.ok(row.markup.includes(row.tag),row.id);
    assert.ok(row.markup.includes('upgrade-rarity-band'),row.id);
    assert.ok(row.markup.includes('upgrade-rarity-crown'),row.id);
    assert.ok(row.markup.includes('upgrade-rarity-gem'),row.id);
    assert.ok(row.markup.includes('upgrade-weapon-scan'),row.id);
    assert.equal(row.markup.includes('✦ EFSANEVİ'),row.id==='LEGENDARY');
  }
});

test('M4.3.3.1 rarity is independent of evolution and weapon roles for every tier', () => {
  const {run}=setup();
  const rows=JSON.parse(run("(()=>{const weapon=UPGRADES_POOL.find(u=>u.id==='homing'),system=UPGRADES_POOL.find(u=>u.id==='vampiric');return JSON.stringify(RARITIES.map(r=>{const e=getUpgradeCardPresentation(weapon,r,2),w=getUpgradeCardPresentation(weapon,r,0),m=getUpgradeCardPresentation(system,r,0);return {rarity:r.id,ev:e.role,weapon:w.role,utility:m.role,evolutionMarkup:renderUpgradeCardMarkup(weapon,r,2,0,e,[]),weaponMarkup:renderUpgradeCardMarkup(weapon,r,0,0,w,[])};}));})()"));
  for(const x of rows){
    assert.equal(x.ev,'evolution');
    assert.equal(x.weapon,'weapon');
    assert.equal(x.utility,'module');
    assert.match(x.evolutionMarkup,/upgrade-evolution-orbit/);
    assert.match(x.evolutionMarkup,/Küme Roketleri/);
    assert.doesNotMatch(x.evolutionMarkup,/upgrade-weapon-scan/);
    assert.match(x.weaponMarkup,/upgrade-weapon-brackets/);
    assert.match(x.weaponMarkup,/upgrade-weapon-scan/);
    assert.ok(x.evolutionMarkup.includes('upgrade-rarity-gem'));
  }
});

test('M4.3.3.1 legacy rarity odds and module power remain unchanged', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();return JSON.stringify({rarities:RARITIES.map(r=>[r.id,r.weight,r.mult]),modules:UPGRADES_POOL.length,evolutions:Object.keys(EVOLUTION_DEFS).length,tier:MAX_MODULE_TIER});})()"));
  assert.deepEqual(data.rarities,[['COMMON',48,1],['RARE',30,1.35],['EPIC',15,1.75],['LEGENDARY',7,2.3]]);
  assert.equal(data.modules,11);
  assert.equal(data.evolutions,11);
  assert.equal(data.tier,3);
});

test('M4.3.3.1 additional animation is disabled by reduced motion and clipped for small screens', () => {
  assert.match(html,/@keyframes upgrade-epic-ambient/);
  assert.match(html,/@keyframes upgrade-color-swish/);
  assert.match(html,/\.upgrade-card\[data-rarity="EPIC"\] \.upgrade-rarity-crown,/);
  assert.match(html,/\.upgrade-card:hover \.upgrade-icon/);
  assert.match(html,/\.upgrade-card\{min-height:282px!important;padding-top:22px!important/);
  assert.match(html,/\.upgrade-card\{[\s\S]*?overflow:hidden/);
  assert.match(html,/animation:none!important/);
});


test('M4.3.3.2 complementary icon palette differs for each rarity', () => {
  const css=html.slice(html.indexOf('/* M4.3.3.2:'),html.indexOf('/* M4.2: content-density'));
  const expected=[
    ['COMMON','#ffae70','255,174,112'],
    ['RARE','#e3a6ff','227,166,255'],
    ['EPIC','#8af4ff','138,244,255'],
    ['LEGENDARY','#fff8e6','255,248,230']
  ];
  assert.equal(new Set(expected.map(x=>x[1])).size,4);
  for(const [rarity,color,rgb] of expected) {
    const key='.upgrade-card.upgrade-card[data-rarity="'+rarity+'"] {';
    const block=css.split(key)[1]?.split('}')[0];
    assert.ok(block,rarity+' selector missing');
    assert.ok(block.includes('--rarity-contrast:'+color),rarity+' contrast missing');
    assert.ok(block.includes('--rarity-contrast-rgb:'+rgb),rarity+' glow missing');
  }
  assert.ok(!expected.slice(0,3).some(x=>/#ffd|#ffe|#ffcf/.test(x[1])),'gold must stay legendary-only');
});

test('M4.3.3.2 accent applies to upgrade and badge icons, next tier, CTA arrow and top band', () => {
  const css=html.slice(html.indexOf('/* M4.3.3.2:'),html.indexOf('/* M4.2: content-density'));
  for(const selector of [
    '.upgrade-card .upgrade-icon i',
    '.upgrade-card .upgrade-rarity-gem i',
    '.upgrade-card .upgrade-tier-step.next',
    '.upgrade-card .upgrade-card-footer i',
    '.upgrade-card .upgrade-rarity-band'
  ]) {
    assert.ok(css.includes(selector),selector+' missing');
  }
  assert.match(css,/\.upgrade-card \.upgrade-icon i \{[\s\S]*?color:var\(--rarity-contrast\)/);
  assert.match(css,/\.upgrade-card \.upgrade-tier-step.next \{[\s\S]*?background:var\(--rarity-contrast\)/);
  assert.match(css,/\.upgrade-card \.upgrade-card-footer i \{[\s\S]*?color:var\(--rarity-contrast\)/);
  assert.match(css,/\.upgrade-card \.upgrade-rarity-band \{[\s\S]*?var\(--rarity-contrast\)/);
});

test('M4.3.3.2 evolution and weapon overlays persist for every rarity with unchanged choices', () => {
  const {run}=setup();
  const models=JSON.parse(run("(()=>{const w=UPGRADES_POOL.find(u=>u.id==='homing');return JSON.stringify(RARITIES.map(r=>{const e=getUpgradeCardPresentation(w,r,2),v=getUpgradeCardPresentation(w,r,0);return {rarity:r.id,evolution:renderUpgradeCardMarkup(w,r,2,0,e,[]),weapon:renderUpgradeCardMarkup(w,r,0,1,v,[])};}));})()"));
  assert.equal(models.length,4);
  for(const model of models) {
    assert.match(model.evolution,/upgrade-evolution-orbit/);
    assert.match(model.evolution,/EVRİMİ AÇ/);
    assert.match(model.weapon,/upgrade-weapon-scan/);
    assert.match(model.weapon,/SİLAHI GÜÇLENDİR/);
  }
});

test('M4.3.3.2 original rarity odds and keyboard/reduced-motion safeguards remain intact', () => {
  const {run}=setup();
  const odds=JSON.parse(run("JSON.stringify(RARITIES.map(({id,weight,mult})=>({id,weight,mult})))"));
  assert.deepEqual(odds.map(x=>x.weight),[48,30,15,7]);
  assert.deepEqual(odds.map(x=>x.mult),[1,1.35,1.75,2.3]);
  assert.match(html,/card\.setAttribute\('aria-keyshortcuts',String\(idx\+1\)\)/);
  assert.match(html,/else if \(e\.code === 'KeyR'\)/);
  const css=html.slice(html.indexOf('/* M4.3.3.2:'),html.indexOf('/* M4.2: content-density'));
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.upgrade-card \.upgrade-icon i \{transition:none!important;\}/);
});


test('M4.4.1 four audio states are classified by explicit priority', () => {
  const {run}=setup();
  const phases=JSON.parse(run("JSON.stringify([getCombatMusicPhase(false,0,false),getCombatMusicPhase(false,0,true),getCombatMusicPhase(false,2,false),getCombatMusicPhase(false,2,true),getCombatMusicPhase(true,2,true)])"));
  assert.deepEqual(phases,['NORMAL','APPROACH','BOSS','BOSS','OVERDRIVE']);
  const profiles=JSON.parse(run("JSON.stringify(Object.fromEntries(Object.entries(ADAPTIVE_MUSIC_PROFILES).map(([key,p])=>[key,p.beat])))"));
  assert.ok(profiles.NORMAL>profiles.APPROACH && profiles.APPROACH>profiles.BOSS && profiles.BOSS>profiles.OVERDRIVE);
});

test('M4.4.1 music timing, transition reset and voice count remain bounded', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{const a=new SoundEngine(),notes=[];a.ctx={currentTime:10,state:'running'};a.playBassPulse=(f,p)=>notes.push(['bass',a.musicPhase,f,p.beat]);a.playMusicAccent=(f,p)=>notes.push(['accent',a.musicPhase,f,p.accentGain]);a.updateMusic(.016,true,false,0,false);for(let i=0;i<12;i++)a.updateMusic(.27,true,false,0,false);const normal=notes.filter(x=>x[1]==='NORMAL').length;a.updateMusic(.016,true,false,0,true);a.updateMusic(.016,true,false,1,false);a.updateMusic(.016,true,true,1,false);const step=a.musicStep,phase=a.musicPhase;return JSON.stringify({normal,states:notes.slice(-3).map(x=>x[1]),phase,step,max:notes.length,oneTransitionBeat:notes.slice(-1)[0][3]});})()"));
  assert.equal(x.phase,'OVERDRIVE');
  assert.equal(x.step,1);
  assert.deepEqual(x.states,['APPROACH','BOSS','OVERDRIVE']);
  assert.ok(x.normal>=12 && x.normal<=14);
  assert.ok(x.max<=20);
  assert.equal(x.oneTransitionBeat,.155);
});

test('M4.4.1 music and sound toggles are independent and paused music emits no notes', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{const a=new SoundEngine(),notes=[];a.ctx={currentTime:2,state:'running'};a.playBassPulse=(f)=>notes.push(f);a.playMusicAccent=()=>{};a.enabled=false;a.updateMusic(.02,true);const onlyMusic=notes.length;a.musicEnabled=false;a.enabled=true;a.updateMusic(.3,true);const musicOff=notes.length;a.updateMusic(.3,false);const paused=notes.length;a.musicEnabled=true;a.updateMusic(.02,true,false,1,false);return JSON.stringify({onlyMusic,musicOff,paused,resumed:notes.length,phase:a.musicPhase});})()"));
  assert.equal(x.onlyMusic,1);
  assert.equal(x.musicOff,1);
  assert.equal(x.paused,1);
  assert.equal(x.resumed,2);
  assert.equal(x.phase,'BOSS');
});

test('M4.4.1 global SFX budget preserves boss warnings and remains time-window bounded', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{const a=new SoundEngine();let t=5;a.ctx={get currentTime(){return t;}};const low=[];for(let i=0;i<30;i++)low.push(a.allowSfx('low-'+i,0));const first=low.filter(Boolean).length;const important=a.allowSfx('cue-boss',1.5,true);const blocked=a.allowSfx('after-full',0);t+=.13;const next=a.allowSfx('after-full',0);return JSON.stringify({first,important,blocked,next,count:a.sfxWindowCount});})()"));
  assert.equal(x.first,9);
  assert.equal(x.important,true);
  assert.equal(x.blocked,false);
  assert.equal(x.next,true);
  assert.equal(x.count,1);
});

test('M4.4.1 game loop routes genuine boss approach, boss and overdrive into audio', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();const seen=[];audio.updateMusic=(dt,active,overdrive,count,approach)=>seen.push({active,overdrive,count,approach});totalTime=52;nextBossTime=55;updateGame(.016);const warn=seen.at(-1);const b=new Enemy(150,180,'BOSS_TITAN');activeBosses=[b];totalTime=53;nextBossTime=Infinity;updateGame(.016);const boss=seen.at(-1);player.overdriveActive=true;updateGame(.016);const over=seen.at(-1);return JSON.stringify({warn,boss,over});})()"));
  assert.equal(x.warn.active,true);
  assert.equal(x.warn.approach,true);
  assert.equal(x.warn.count,0);
  assert.equal(x.boss.count,1);
  assert.equal(x.boss.approach,false);
  assert.equal(x.over.overdrive,true);
});

test('M4.4.1 original boss cues and audio controls preserve category behavior', () => {
  assert.match(html,/audio\.playThreatCue\('boss'\)/);
  assert.match(html,/audio\.playThreatCue\('phase'\)/);
  assert.match(html,/audio\.playThreatCue\('raid'\)/);
  assert.match(html,/this\.allowSfx\('cue-' \+ kind, 1\.5, true\)/);
  assert.match(html,/audio\.musicEnabled = !audio\.musicEnabled/);
  assert.match(html,/audio\.enabled = !audio\.enabled/);
  assert.match(html,/title="Adaptif Savaş Müziği \(aç\/kapat\)"/);
});


test('M4.4.2 audio family is derived from real projectile flags', () => {
  const {run}=setup();
  const names=JSON.parse(run("(()=>{const b=new Bullet(0,0,1,0,4,5,1,0),n=[];n.push(getWeaponSoundFamily(b));b.prismEvolved=true;n.push(getWeaponSoundFamily(b));b.isHoming=true;n.push(getWeaponSoundFamily(b));b.clusterPayload=true;n.push(getWeaponSoundFamily(b));b.clusterFragment=true;n.push(getWeaponSoundFamily(b));b.reactorPulse=true;n.push(getWeaponSoundFamily(b));b.evoRail=true;n.push(getWeaponSoundFamily(b));return JSON.stringify(n);})()"));
  assert.deepEqual(names,['plasma','prism','missile','cluster','cluster','reactor','rail']);
});

test('M4.4.2 unique firing, impact and boss envelopes have bounded frequencies and amplitude', () => {
  const {run}=setup();
  const data=JSON.parse(run("JSON.stringify({fire:WEAPON_SFX,hit:HIT_SFX,boss:BOSS_DEATH_SFX})"));
  assert.deepEqual(Object.keys(data.fire),['plasma','prism','reactor','rail','missile','cluster','arc']);
  assert.deepEqual(Object.keys(data.boss),['BOSS_DESTROYER','BOSS_TITAN','BOSS_VOID','BOSS_PRISM']);
  assert.equal(new Set(Object.values(data.boss).map(x=>x.start)).size,4);
  for(const channel of Object.values(data)){
    for(const cue of Object.values(channel)){
      assert.ok(cue.start>=45 && cue.start<=1000);
      assert.ok(cue.end>=45 && cue.end<=1000);
      assert.ok(cue.gain>0 && cue.gain<=.09);
      assert.ok(cue.length>=.05 && cue.length<=.65);
      assert.ok(cue.lowpass<=1000);
    }
  }
});

test('M4.4.2 shot salvo chooses actual missile and rail and produces only one shot sound', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();enemies=[new Enemy(player.x+130,player.y,'TANK')];const names=[];audio.playWeaponFire=kind=>names.push(kind);player.critChance=0;player.autoShoot();player.homingMissiles=1;player.shotCounter=2;player.autoShoot();player.evolutions.add('multishot');player.shotCounter=3;player.autoShoot();return JSON.stringify({names,missile:player.homingMissiles,railShots:player.buildStats.railShots});})()"));
  assert.deepEqual(data.names,['plasma','missile','rail']);
  assert.equal(data.missile,1);
  assert.equal(data.railShots,1);
});

test('M4.4.2 actual bullet collision triggers matching sound without affecting damage', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();player.fireTimer=100;const e=new Enemy(player.x+90,player.y,'TANK');e.speed=0;enemies=[e];const b=new Bullet(e.x,e.y,0,0,16,6,1,0,false,true);bullets=[b];const calls=[];audio.playWeaponHit=(type,crit,boss)=>calls.push([type,crit,boss]);const hp=e.hp;updateGame(.016);return JSON.stringify({damage:hp-e.hp,calls,dead:b.dead});})()"));
  assert.equal(data.damage,16);
  assert.deepEqual(data.calls,[['missile',false,false]]);
  assert.equal(data.dead,true);
});

test('M4.4.2 shared low-priority impact budget and mute limit audio voices', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{const a=new SoundEngine();let now=5,voices=0;const param={setValueAtTime(){},exponentialRampToValueAtTime(){}};a.ctx={get currentTime(){return now;},createOscillator:()=>({frequency:param,connect(){},start(){voices++},stop(){}}),createGain:()=>({gain:param,connect(){}}),createBiquadFilter:()=>({frequency:param,connect(){}}),destination:{}};for(let i=0;i<12;i++)a.playWeaponHit('rail',false);const limited=voices;now+=.07;a.playWeaponHit('missile',false);const later=voices;a.enabled=false;now+=.08;a.playWeaponHit('plasma',true);return JSON.stringify({limited,later,muted:voices});})()"));
  assert.deepEqual(data,{limited:1,later:2,muted:2});
});

test('M4.4.2 each boss death has own cue and avoids extra regular explosion', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();const heard=[],bursts=[];audio.playBossDeath=kind=>heard.push(kind);audio.playExplosion=big=>bursts.push(big);for(const type of ['BOSS_DESTROYER','BOSS_TITAN','BOSS_VOID','BOSS_PRISM']){const b=new Enemy(player.x+190,player.y,type);b.hp=1;b.takeDamage(9000,0,0,false,false);}return JSON.stringify({heard,bursts,bossKills:combatDirector.stats.bossKills,fx:bossDeathVfx.length});})()"));
  assert.deepEqual(data.heard,['BOSS_DESTROYER','BOSS_TITAN','BOSS_VOID','BOSS_PRISM']);
  assert.equal(data.bursts.length,0);
  assert.equal(data.bossKills,4);
  assert.ok(data.fx<=3);
});

test('M4.4.2 successfully executed revive uses restorative cue instead of jackpot', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();gameState='REVIVE_PROMPT';let revived=0,jackpots=0;audio.playRevive=()=>revived++;audio.playJackpot=()=>jackpots++;const before=player.freeRevives;executePlayerRevive();return JSON.stringify({revived,jackpots,state:gameState,before,after:player.freeRevives,invulnerable:player.invulnTimer});})()"));
  assert.equal(data.revived,1);
  assert.equal(data.jackpots,0);
  assert.equal(data.state,'PLAYING');
  assert.equal(data.after,data.before-1);
  assert.equal(data.invulnerable,3.5);
});

test('M4.4.2 audio is optional and music / SFX switches stay independent', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{const a=new SoundEngine();a.playWeaponFire('rail');a.playWeaponHit('missile');a.playBossDeath('BOSS_TITAN');a.playRevive();return JSON.stringify({ctx:a.ctx,enabled:a.enabled,music:a.musicEnabled});})()"));
  assert.deepEqual(data,{ctx:null,enabled:true,music:true});
  assert.match(html,/audio\.musicEnabled = !audio\.musicEnabled/);
  assert.match(html,/audio\.enabled = !audio\.enabled/);
});


test('M5.1 boss jackpot keeps original rewards while elite support uses a softer profile',()=>{
  const {run}=setup();
  const data=JSON.parse(run("JSON.stringify({boss:getChestRewardProfile('boss',20,1000,1),elite:getChestRewardProfile('elite',20,1000,1),config:CHEST_ECONOMY})"));
  assert.deepEqual(data.boss,{goldHeal:{gold:142,heal:30},overdriveXp:{charge:55,xp:450},bulletNova:{shots:24,charge:30}});
  assert.deepEqual(data.elite,{goldHeal:{gold:74,heal:18},overdriveXp:{charge:32,xp:280},bulletNova:{shots:12,charge:18}});
  assert.deepEqual(data.config.eliteDropChances,[.65,.38,.22,.12,.06]);
  assert.equal(data.config.eliteCooldownSeconds,5);
  assert.equal(data.config.resetSeconds,60);
});

test('M5.1.1 successful elite drops lower their chance without enforcing two-per-minute',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();const c=combatDirector;const timeline=[];Math.random=()=>0;for(let t=1;t<=180;t++){totalTime=t;c.registerChestDrop('elite',player.x,player.y);if(lootChests.length){timeline.push(t);lootChests.length=0;}}return JSON.stringify({timeline,denied:c.stats.chestDenied,kills:c.stats.eliteKills,next:c.getNextEliteChestChance()});})()"));
  assert.equal(a.kills,180);
  assert.equal(a.timeline.length,36);
  for(let i=1;i<a.timeline.length;i++) assert.ok(a.timeline[i]-a.timeline[i-1]>=5);
  assert.ok(a.denied.cooldown>0);
  assert.equal(a.next,.65);
});

test('M5.1 no-collected elite chests cannot crowd out boss guarantee',()=>{
  const {run}=setup();
  const d=JSON.parse(run("(()=>{startNewGame();lootChests=[0,1,2,3].map(()=>new LootChest(10,10,'elite'));combatDirector.onBossEncounter();const first=combatDirector.registerChestDrop('boss',player.x,player.y),again=combatDirector.registerChestDrop('boss',player.x,player.y);totalTime=200;const elite=combatDirector.registerChestDrop('elite',player.x,player.y);return JSON.stringify({first,again,elite,sources:lootChests.map(c=>c.source),denied:combatDirector.stats.chestDenied.groundCap});})()"));
  assert.equal(d.first,true);
  assert.equal(d.again,false);
  assert.equal(d.elite,false);
  assert.deepEqual(d.sources,['elite','elite','elite','elite','boss']);
  assert.equal(d.denied,1);
});

test('M5.1 actual chest gold and healing are tracked by source with no double counting',()=>{
  const {run}=setup();
  const d=JSON.parse(run("(()=>{startNewGame();wave=20;player.hp=40;player.maxHp=150;Math.random=()=>0;const start=totalGold;const c=new LootChest(player.x,player.y,'elite');c.update(.016);const e=window.getNeonEconomySnapshot();const gold1=totalGold-start;const heal1=player.hp;const b=new LootChest(player.x,player.y,'boss');b.update(.016);const s=window.getNeonEconomySnapshot();return JSON.stringify({gold1,heal1,finalGold:totalGold-start,elite:e.chestRewards.elite,boss:s.chestRewards.boss,tracked:s.goldTracked,session:s.goldSession,opened:s.chestOpened});})()"));
  assert.equal(d.gold1,74);
  assert.equal(d.heal1,58);
  assert.equal(d.finalGold,216);
  assert.equal(d.elite.gold,74);
  assert.equal(d.elite.heal,18);
  assert.equal(d.boss.gold,142);
  assert.equal(d.boss.heal,30);
  assert.equal(d.tracked,d.session);
  assert.equal(d.opened.goldHeal,2);
});

test('M5.1 source-aware nova opens with a shared projectile cap; boss remains stronger',()=>{
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();wave=10;Math.random=()=>.99;bullets=[];new LootChest(player.x,player.y,'elite').update(.016);const elite=bullets.length;bullets=[];new LootChest(player.x,player.y,'boss').update(.016);const boss=bullets.length;bullets=new Array(MAX_PLAYER_PROJECTILES-4).fill({dead:false});new LootChest(player.x,player.y,'boss').update(.016);const capped=bullets.length;return JSON.stringify({elite,boss,capped,max:MAX_PLAYER_PROJECTILES,stats:combatDirector.stats.chestRewards});})()"));
  assert.equal(data.elite,12);
  assert.equal(data.boss,24);
  assert.equal(data.capped,data.max);
  assert.equal(data.stats.elite.shots,12);
  assert.equal(data.stats.boss.shots,28);
});

test('M5.1 gold ledger separates quest, orb and arena sources without touching save math',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();const start=totalGold;activeQuest={type:'KILLS',target:1,progress:0,rewardGold:31,desc:'X'};advanceQuest('KILLS',1);const quest=window.getNeonEconomySnapshot().goldBySource.quests;const o=new EnergyOrb(player.x,player.y,0,true);o.count=2;o.update(.016);const g=window.getNeonEconomySnapshot();return JSON.stringify({quest,ledger:g.goldBySource,total:totalGold-start,tracked:g.goldTracked,session:g.goldSession});})()"));
  assert.equal(a.quest,31);
  assert.ok(a.ledger.orbs>0);
  assert.equal(a.ledger.quests,31);
  assert.equal(a.tracked,a.session);
  assert.equal(a.total,a.tracked);
});

test('M5.1 diagnostics return defensive copies and reset all economy counters per run',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();totalTime=65;combatDirector.registerChestDrop('boss',player.x,player.y);const x=window.getNeonEconomySnapshot();const diag=window.getNeonRunDiagnostics();x.chestDrops.boss=999;diag.chestRewards.boss.opened=999;const untouched=window.getNeonEconomySnapshot();startNewGame();return JSON.stringify({untouched:untouched.chestDrops.boss,rewards:untouched.chestRewards.boss.opened,fresh:window.getNeonEconomySnapshot(),oldSeconds:x.timeSeconds});})()"));
  assert.equal(a.untouched,1);
  assert.equal(a.rewards,0);
  assert.equal(a.oldSeconds,65);
  assert.deepEqual(a.fresh.chestDrops,{elite:0,boss:0});
  assert.deepEqual(a.fresh.chestDenied,{cooldown:0,groundCap:0,roll:0});
  assert.equal(a.fresh.goldTracked,0);
});

test('M5.1.1 deterministic 5/10/20/30-minute decaying-chance economy stress',()=>{
  const {run}=setup();
  const model=JSON.parse(run("(()=>{const horizons=[300,600,1200,1800],out=[];for(const horizon of horizons){startNewGame();let seed=731;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);const times=[];for(let sec=1;sec<=horizon;sec++){totalTime=sec;wave=1+Math.floor(sec/16);if(sec===55||sec>55&&(sec-55)%150===0){combatDirector.onBossEncounter();combatDirector.registerChestDrop('boss',player.x,player.y);}if(sec%6===0){const before=combatDirector.stats.chestDrops.elite;combatDirector.registerChestDrop('elite',player.x,player.y);if(combatDirector.stats.chestDrops.elite>before)times.push(sec);}for(const chest of lootChests){chest.x=player.x;chest.y=player.y;chest.update(.016);}lootChests.length=0;bullets=[];}const d=window.getNeonEconomySnapshot();const byMinute={};for(const time of times){const k=Math.floor(time/60);byMinute[k]=(byMinute[k]||0)+1;}out.push({minutes:horizon/60,elite:d.chestDrops.elite,boss:d.chestDrops.boss,opened:Object.values(d.chestOpened).reduce((s,x)=>s+x,0),onGround:d.onGround,tracked:d.goldTracked,session:d.goldSession,goldBySource:d.goldBySource,maxWindowDrops:Math.max(0,...Object.values(byMinute)),minGapOk:times.every((t,i)=>i===0||t-times[i-1]>=5),nextChance:d.nextEliteDropChance});}return JSON.stringify(out);})()"));
  assert.deepEqual(model.map(x=>x.minutes),[5,10,20,30]);
  for(const row of model){
    assert.ok(row.minGapOk,row.minutes+' minute spacing');
    assert.ok(row.maxWindowDrops<=10,row.minutes+' minute eligible attempt ceiling');
    assert.ok(row.elite>=Math.floor(row.minutes*.5),row.minutes+' minute needs meaningful rewards');
    assert.ok(row.elite<=row.minutes*10,row.minutes+' minute impossible volume');
    assert.equal(row.boss,Math.ceil((row.minutes*60-55)/150));
    assert.equal(row.opened,row.elite+row.boss);
    assert.equal(row.onGround,0);
    assert.equal(row.tracked,row.session);
    assert.equal(row.goldBySource.chests,row.session);
    assert.ok(row.nextChance>=.06 && row.nextChance<=.65);
  }
  console.log('M5.1.1 deterministic economy stress: '+JSON.stringify(model));
});


test('M5.1.1 actual first two boss encounters are solo and difficulty escalates smoothly',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();const counts=[],chests=[];for(let i=1;i<=6;i++){totalTime=i*100;spawnBossEncounter();counts.push(activeBosses.length);for(const b of [...activeBosses]){b.hp=1;b.takeDamage(9999,0,0,false,false);}chests.push(combatDirector.stats.chestDrops.boss);}return JSON.stringify({counts,chests,encounters:combatDirector.stats.encounters,kills:combatDirector.stats.bossKills,alive:activeBosses.length});})()"));
  assert.deepEqual(a.counts,[1,1,2,2,3,2]);
  assert.deepEqual(a.chests,[1,2,3,4,5,6]);
  assert.equal(a.encounters,6);
  assert.equal(a.kills,11);
  assert.equal(a.alive,0);
});

test('M5.1.1 elite drop chance decays only on success and resets on the minute',()=>{
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();const c=combatDirector;let roll=.64;Math.random=()=>roll;const a=[];for(const [time,r] of [[1,.64],[6,.40],[7,.37],[12,.21],[17,.11],[52,.05],[61,.64]]){totalTime=time;roll=r;const chance=c.getNextEliteChestChance();const ok=c.registerChestDrop('elite',0,0);a.push([time,chance,ok,c.getNextEliteChestChance()]);lootChests.length=0;}const d=window.getNeonEconomySnapshot();return JSON.stringify({cases:a,denied:d.chestDenied,window:d.eliteChanceWindow,count:d.eliteDropsInWindow,next:d.nextEliteDropChance});})()"));
  assert.deepEqual(data.cases,[[1,.65,true,.38],[6,.38,false,.38],[7,.38,true,.22],[12,.22,true,.12],[17,.12,true,.06],[52,.06,true,.06],[61,.65,true,.38]]);
  assert.equal(data.denied.roll,1);
  assert.equal(data.window,1);
  assert.equal(data.count,1);
  assert.equal(data.next,.38);
});

test('M5.1.1 60-second reset is based on game time, not boss or successful loot',()=>{
  const {run}=setup();
  const list=JSON.parse(run("(()=>{startNewGame();const c=combatDirector;Math.random=()=>0;const result=[];for(const time of [10,16,22,61,67,120,126]){totalTime=time;const before=c.getNextEliteChestChance();const dropped=c.registerChestDrop('elite',0,0);lootChests.length=0;result.push({time,before,dropped,window:c.getEliteChanceWindow()});}return JSON.stringify(result);})()"));
  assert.deepEqual(list.map(x=>x.before),[.65,.38,.22,.65,.38,.65,.38]);
  assert.ok(list.every(x=>x.dropped));
  assert.deepEqual(list.map(x=>x.window),[0,0,0,1,1,2,2]);
});

test('M5.1.1 chest inventory still limits uncollected elites, not the earned total',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();Math.random=()=>0;const c=combatDirector;const results=[];for(const time of [1,7,13,19,25]){totalTime=time;results.push(c.registerChestDrop('elite',10,10));}const denied=c.stats.chestDenied.groundCap,drop=c.stats.chestDrops.elite;lootChests.length=0;totalTime=31;const restored=c.registerChestDrop('elite',10,10);return JSON.stringify({results,denied,drop,restored,window:c.eliteDropsInWindow});})()"));
  assert.deepEqual(a.results,[true,true,true,true,false]);
  assert.equal(a.denied,1);
  assert.equal(a.drop,4);
  assert.equal(a.restored,true);
  assert.equal(a.window,5);
});

test('M5.1.1 post-boss recovery is four seconds and periodic lull stays active',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();totalTime=137;combatDirector.onBossCleared();const ends=combatDirector.afterBossUntil;const near=getDirectorProfile(140,6,0,400,ends,1);const resumed=getDirectorProfile(142,6,0,400,ends,1);const periodic=getDirectorProfile(54,6,0,400,-Infinity,1);return JSON.stringify({ends,near:near.phase,resumed:resumed.phase,periodic:{phase:periodic.phase,interval:periodic.interval,cap:periodic.cap,rate:periodic.tokenRate}});})()"));
  assert.equal(a.ends,141);
  assert.equal(a.near,'RECOVERY');
  assert.equal(a.resumed,'PRESSURE');
  assert.equal(a.periodic.phase,'RECOVERY');
  assert.equal(a.periodic.interval,.52);
  assert.equal(a.periodic.cap,100);
  assert.ok(a.periodic.rate>1);
});

test('M5.1.1 boss HP/speed values and one guaranteed boss reward stay unchanged',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();wave=10;const x=new Enemy(100,100,'BOSS_TITAN'),prior={hp:x.maxHp,speed:x.speed};const counts=[1,2,3,4,5,6].map(getBossCountForEncounter);combatDirector.onBossEncounter();const first=combatDirector.registerChestDrop('boss',0,0),second=combatDirector.registerChestDrop('boss',0,0);const y=new Enemy(100,100,'BOSS_TITAN');return JSON.stringify({prior,after:{hp:y.maxHp,speed:y.speed},counts,first,second});})()"));
  assert.deepEqual(a.prior,a.after);
  assert.deepEqual(a.counts,[1,1,2,2,3,2]);
  assert.equal(a.first,true);
  assert.equal(a.second,false);
});


test('M5.2 candidates unlock with waves and only include chain when equipped',()=>{
  const {run}=setup();
  const groups=JSON.parse(run("JSON.stringify([getQuestCandidates(1,false),getQuestCandidates(2,false),getQuestCandidates(3,false),getQuestCandidates(4,false),getQuestCandidates(4,true)])"));
  assert.deepEqual(groups[0],['KILLS','ORBS','COMBO']);
  assert.deepEqual(groups[1],['KILLS','ORBS','COMBO','NO_HIT','RESCUE']);
  assert.ok(groups[2].includes('DEFEND'));
  assert.ok(groups[3].includes('ELITE_HUNT'));
  assert.equal(groups[3].includes('CHAIN'),false);
  assert.ok(groups[4].includes('CHAIN'));
});

test('M5.2 chooser avoids repeating the last two missions and uses bounded random index',()=>{
  const {run}=setup();
  const data=JSON.parse(run("JSON.stringify([chooseQuestType(['KILLS','ORBS','COMBO','DEFEND'],['KILLS','ORBS'],0),chooseQuestType(['KILLS','ORBS','COMBO','DEFEND'],['KILLS','ORBS'],.99),chooseQuestType(['KILLS'],['KILLS'],1)])"));
  assert.deepEqual(data,['COMBO','DEFEND','KILLS']);
});

test('M5.2 rewards and quest history reset between runs and never double-count gold',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();const initial=window.getNeonQuestSnapshot();wave=6;generateNextQuest('KILLS');const gold=totalGold;const expected=activeQuest.rewardGold;advanceQuest('KILLS',activeQuest.target);const completed=window.getNeonQuestSnapshot(),ledger=combatDirector.getEconomySnapshot();startNewGame();const fresh=window.getNeonQuestSnapshot();return JSON.stringify({initial,expected,earned:totalGold-gold,completed,ledger:ledger.goldBySource.quests,fresh});})()"));
  assert.equal(a.initial.stats.offered,1);
  assert.equal(a.earned,a.expected);
  assert.equal(a.ledger,a.expected);
  assert.equal(a.completed.stats.completed,1);
  assert.equal(a.completed.stats.byType.KILLS,1);
  assert.equal(a.fresh.stats.completed,0);
  assert.equal(a.fresh.stats.offered,1);
  assert.equal(a.fresh.history.length,1);
});

test('M5.2 elite hunt completes only on actual elite enemy death',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();wave=4;generateNextQuest('ELITE_HUNT');const regular=new Enemy(player.x+180,player.y,'SWARM',false);regular.die();const before=activeQuest.progress;const elite=new Enemy(player.x+180,player.y,'SWARM',true);elite.die();return JSON.stringify({before,complete:questStats.byType.ELITE_HUNT||0,kills,eliteKills:combatDirector.stats.eliteKills});})()"));
  assert.equal(x.before,0);
  assert.equal(x.complete,1);
  assert.equal(x.kills,2);
  assert.equal(x.eliteKills,1);
});

test('M5.2 chain mission unlocks only after chain trait and requires a real jump',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();wave=6;player.chainLightning=1;player.evolutions.add('lightning');generateNextQuest('CHAIN');const a=new Enemy(200,200,'TANK'),b=new Enemy(310,200,'TANK');enemies=[a,b];a.takeDamage(5,0,0,true,true);const first=activeQuest.progress;const hp=b.hp;a.takeDamage(5,0,0,false,false);return JSON.stringify({first,second:activeQuest.progress,hit:hp<b.maxHp,complete:questStats.byType.CHAIN||0});})()"));
  assert.equal(x.first,1);
  assert.equal(x.second,1);
  assert.equal(x.hit,true);
  assert.equal(x.complete,0);
});

test('M5.2 no-hit mission advances only during active play and resets on real HP loss',()=>{
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();wave=2;generateNextQuest('NO_HIT');updateQuest(4);const safe=activeQuest.progress;gameState='PAUSED';updateQuest(7);const paused=activeQuest.progress;gameState='PLAYING';player.hasShield=true;player.shieldActive=true;player.invulnTimer=0;player.takeDamage(9);const shielded=activeQuest.progress;player.shieldActive=false;player.invulnTimer=0;player.takeDamage(9);return JSON.stringify({safe,paused,shielded,after:activeQuest.progress,hits:questStats.hitsReset});})()"));
  assert.equal(data.safe,4);
  assert.equal(data.paused,4);
  assert.equal(data.shielded,4);
  assert.equal(data.after,0);
  assert.equal(data.hits,1);
});

test('M5.2 flawless timer pays once at target without auto-finishing an idle mission',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();wave=2;generateNextQuest('NO_HIT');const target=activeQuest.target;gameState='PAUSED';updateQuest(target+2);const before=questStats.completed;gameState='PLAYING';for(let i=0;i<target*2;i++)updateQuest(.5);return JSON.stringify({before,after:questStats.completed,awarded:questStats.byType.NO_HIT||0,target});})()"));
  assert.equal(x.before,0);
  assert.equal(x.after,1);
  assert.equal(x.awarded,1);
});

test('M5.2 defense requires position and live enemy presence and loses progress outside',()=>{
  const {run}=setup();
  const d=JSON.parse(run("(()=>{startNewGame();wave=3;generateNextQuest('DEFEND');const q=activeQuest,old={x:player.x,y:player.y};player.x=q.point.x;player.y=q.point.y;updateQuest(2);const alone=q.progress;enemies=[{x:q.point.x+500,y:q.point.y+500,dead:false,isBoss:false}];updateQuest(2);const far=q.progress;enemies=[{x:q.point.x+35,y:q.point.y+30,dead:false,isBoss:false}];updateQuest(2);const inside=q.progress;player.x=old.x+500;player.y=old.y+500;updateQuest(1);const outside=q.progress;player.x=q.point.x;player.y=q.point.y;for(let i=0;i<20;i++)updateQuest(.25);return JSON.stringify({alone,far,inside,outside,completed:questStats.byType.DEFEND||0,point:q.point});})()"));
  assert.equal(d.alone,0);
  assert.equal(d.far,0);
  assert.equal(d.inside,2);
  assert.ok(d.outside<d.inside);
  assert.equal(d.completed,1);
  assert.ok(d.point.x>=65 && d.point.y>=65);
});

test('M5.2 rescue capsules require two distinct physical pickups and no double reward',()=>{
  const {run}=setup();
  const d=JSON.parse(run("(()=>{startNewGame();wave=2;generateNextQuest('RESCUE');const q=activeQuest,start={...q.point};player.x=start.x;player.y=start.y;updateQuest(.016);const mid={progress:q.progress,next:{...q.point}};updateQuest(.016);const still=q.progress;player.x=q.point.x;player.y=q.point.y;updateQuest(.016);return JSON.stringify({mid,still,complete:questStats.byType.RESCUE||0,stats:questStats.completed});})()"));
  assert.equal(d.mid.progress,1);
  assert.notDeepEqual(d.mid.next,undefined);
  assert.equal(d.still,1);
  assert.equal(d.complete,1);
  assert.equal(d.stats,1);
});

test('M5.2 quest world marker renders safely and stays absent outside active game',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();wave=3;generateNextQuest('DEFEND');const ctx={save(){},restore(){},setLineDash(){},beginPath(){},arc(){},fill(){},stroke(){},fillText(){}};drawQuestObjective(ctx);const live=activeQuest.point!=null;gameState='PAUSED';drawQuestObjective(ctx);return JSON.stringify({live,mobile:document.getElementById('questMobileText').textContent,description:document.getElementById('questMobileText').title});})()"));
  assert.equal(a.live,true);
  assert.match(a.mobile,/^SAVUN · 0\/5 · \+\d+$/);
  assert.match(a.description,/SİNYAL NOKTASINI SAVUN/);
});

test('M5.2 keeps original orb stack quest semantics and exposes defensive snapshot',()=>{
  const {run}=setup();
  const d=JSON.parse(run("(()=>{startNewGame();wave=2;generateNextQuest('ORBS');const q=activeQuest;advanceOrbQuestStacks(8);const actual=q.progress,s=window.getNeonQuestSnapshot();s.history[0]='INVALID';s.stats.completed=999;if(s.point)s.point.x=-10;return JSON.stringify({actual,after:activeQuest.progress,history:questHistory[0],stats:questStats.completed});})()"));
  assert.equal(d.actual,8);
  assert.equal(d.after,8);
  assert.notEqual(d.history,'INVALID');
  assert.equal(d.stats,0);
});

test('M5.2 second boss pre-warning now uses actual encounter count helper',()=>{
  assert.match(html,/const upcomingCount=getBossCountForEncounter\(bossEncounterCount\+1\);/);
  assert.match(html,/function getBossCountForEncounter/);
  const {run}=setup();
  assert.deepEqual(JSON.parse(run("JSON.stringify([1,2,3,4,5].map(getBossCountForEncounter))")),[1,1,2,2,3]);
});
