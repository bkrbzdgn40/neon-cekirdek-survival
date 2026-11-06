const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { setup, html, pageHtml, gameCss, gameCode } = require('./harness.cjs');

// Odak 3.2 · one list for pool-size checks; a new upgrade is added here once.
const UPGRADE_IDS = ['circuit_weaver', 'mine_trail', 'phase_echo', 'multishot', 'firerate', 'orbital',
  'pierce_ricochet', 'homing', 'lightning', 'overdrive_boost', 'crit_mastery', 'vampiric',
  'aegis_shield', 'kinetic_magnet', 'boomerang_disc', 'shock_ring', 'coolant', 'collector'];

test('Odak 3.2 Mayın İzi tier rules, card and evolution are wired', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const u = UPGRADES_POOL.find(u => u.id === 'mine_trail');
    return JSON.stringify({ rules: MINE_TRAIL_RULES, max: MAX_TRAIL_MINES, kind: u.kind,
      evo: EVOLUTION_DEFS.mine_trail.name, fire: !!WEAPON_SFX.mine, hit: !!HIT_SFX.mine,
      style: PROJECTILE_VISUAL_STYLES.mine.type,
      label: getUpgradeCardPresentation(u, RARITIES[0], 0).label,
      desc: [u.getDesc(RARITIES[0]), u.getDesc(RARITIES[3])] });
  })()`));
  assert.equal(x.kind, 'weapon');
  assert.equal(x.label, 'SİLAH MODÜLÜ');
  assert.deepEqual(x.rules.maxMines, [0, 3, 4, 5]);
  assert.deepEqual(x.rules.dropDistance, [0, 300, 260, 220]);
  assert.deepEqual(x.rules.damageMult, [0, 0.35, 0.45, 0.6]);
  assert.ok(x.rules.blastRadius[1] < x.rules.blastRadius[3]);
  assert.equal(x.max, 6);
  assert.ok(x.rules.maxMines.every(n => n + x.rules.evolvedExtraMines <= x.max));
  assert.equal(x.evo, 'Zincir Mayın');
  assert.ok(x.fire && x.hit);
  assert.equal(x.style, 'mine');
  assert.doesNotMatch(x.desc[0], /Mayın hasarı/);
  assert.match(x.desc[1], /Mayın hasarı \+%19/);
});

test('Odak 3.2 Mayın İzi drops mines only while moving and keeps the tier cap', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const none = recordMineTrailMotion(player, 9999);
    gameState = 'LEVEL_UP';
    currentUpgradeChoices = [{ upg: UPGRADES_POOL.find(u => u.id === 'mine_trail'), rarity: RARITIES[0] }];
    selectUpgradeOption(0);
    const counts = [];
    const step = d => { player.x += d; recordMineTrailMotion(player, d); counts.push(trailMines.length); };
    for (let i = 0; i < 2; i++) step(100);          // 200 px < 300: nothing yet
    const beforeFirst = trailMines.length;
    step(100);                                       // 300 px: first mine
    for (let i = 0; i < 30; i++) step(100);
    const capped = trailMines.length;
    player.isDashing = true; const dashDrop = recordMineTrailMotion(player, 9999); player.isDashing = false;
    player.upgradeCounts.mine_trail = 3; player.refreshBuildTraits();
    for (let i = 0; i < 40; i++) step(100);
    return JSON.stringify({ none, beforeFirst, capped, dashDrop, evolvedCap: trailMines.length,
      drops: player.buildStats.mineDrops, xs: trailMines.map(m => Math.round(m.x)) });
  })()`));
  assert.equal(x.none, false);
  assert.equal(x.beforeFirst, 0);
  assert.equal(x.capped, 3);
  assert.equal(x.dashDrop, false);
  assert.equal(x.evolvedCap, 6);
  assert.ok(x.drops >= 20);
  // The oldest mine is recycled: the trail stays just behind the player.
  assert.deepEqual(x.xs, [...x.xs].sort((a, b) => a - b));
});

test('Odak 3.2 Mayın İzi arms, detonates near an enemy and chains at tier 3', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = []; nextBossTime = 9999;
    player.upgradeCounts.mine_trail = 1; player.refreshBuildTraits();
    dropTrailMine(player, 300, 300);
    const foe = new Enemy(310, 300, 'TANK'); foe.hp = foe.maxHp = 5000; enemies.push(foe);
    updateTrailMines();
    const unarmed = { mines: trailMines.length, hp: foe.hp };
    totalTime += MINE_TRAIL_RULES.armDelay + 0.01;
    updateTrailMines();
    const blast = { mines: trailMines.length, lost: 5000 - foe.hp, blasts: player.buildStats.mineBlasts };
    // Expired mines vanish without a blast.
    dropTrailMine(player, 900, 900);
    totalTime += MINE_TRAIL_RULES.lifetime + 1;
    updateTrailMines();
    const expired = { mines: trailMines.length, blasts: player.buildStats.mineBlasts };
    // Tier 3 evolution: one triggered mine sets off neighbours within 150 px.
    player.upgradeCounts.mine_trail = 3; player.refreshBuildTraits();
    foe.x = 500; foe.y = 500; foe.hp = 5000;
    dropTrailMine(player, 505, 500); dropTrailMine(player, 620, 500); dropTrailMine(player, 900, 500);
    totalTime += 1;
    updateTrailMines();
    return JSON.stringify({ unarmed, blast, expired, evo: player.evolutions.has('mine_trail'),
      left: trailMines.map(m => m.x), chains: player.buildStats.mineChains });
  })()`));
  assert.deepEqual(x.unarmed, { mines: 1, hp: 5000 });
  assert.equal(x.blast.mines, 0);
  assert.equal(x.blast.blasts, 1);
  assert.ok(x.blast.lost > 0);
  assert.deepEqual(x.expired, { mines: 0, blasts: 1 });
  assert.equal(x.evo, true);
  assert.deepEqual(x.left, [900]);
  assert.equal(x.chains, 1);
});

test('Odak 3.2 Mayın İzi draws without glow on low graphics', () => {
  const blurs = [];
  const ctx = new Proxy({}, { get: () => () => {},
    set: (_, k, v) => { if (k === 'shadowBlur') blurs.push(v); return true; } });
  const { run } = setup({}, { canvasContext: ctx });
  run(`startNewGame(); player.upgradeCounts.mine_trail = 2; dropTrailMine(player, 100, 100);
    totalTime += 1; graphicsQuality = 'high'`);
  run('drawTrailMines(ctx)');
  const high = blurs.splice(0);
  run(`graphicsQuality = 'low'; drawTrailMines(ctx)`);
  assert.ok(high.some(v => v > 0));
  assert.ok(blurs.length > 0 && blurs.every(v => v === 0));
});

test('Odak 3.2 Bumerang Disk tier rules, card and evolution are wired', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const u = UPGRADES_POOL.find(u => u.id === 'boomerang_disc');
    return JSON.stringify({ rules: BOOMERANG_RULES, max: MAX_BOOMERANG_DISCS, kind: u.kind,
      evo: EVOLUTION_DEFS.boomerang_disc.name, fire: !!WEAPON_SFX.disc, hit: !!HIT_SFX.disc,
      style: PROJECTILE_VISUAL_STYLES.disc.type,
      label: getUpgradeCardPresentation(u, RARITIES[0], 0).label, desc: u.getDesc(RARITIES[2]) });
  })()`));
  assert.equal(x.kind, 'weapon');
  assert.equal(x.label, 'SİLAH MODÜLÜ');
  assert.deepEqual(x.rules.cooldown, [0, 2.2, 1.9, 1.8]);
  assert.deepEqual(x.rules.range, [0, 260, 290, 320]);
  assert.deepEqual(x.rules.radius, [0, 14, 16, 18]);
  assert.equal(x.max, 4);
  assert.equal(x.evo, 'Ayna Disk');
  assert.ok(x.fire && x.hit);
  assert.equal(x.style, 'disc');
  assert.match(x.desc, /Disk hasarı \+%11/);
});

test('Odak 3.2 Bumerang Disk flies along movement, turns at range, hits again and is caught', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = []; nextBossTime = 9999;
    player.x = 300; player.y = 400; player.dashDir = { x: 1, y: 0 };
    player.upgradeCounts.boomerang_disc = 1; player.refreshBuildTraits();
    const foe = new Enemy(420, 400, 'TANK'); foe.hp = foe.maxHp = 5000; foe.speed = 0; enemies.push(foe);
    const hitsOnFoe = [];
    let maxDist = 0, turnedAt = null;
    const lastThrow = player.boomerangReadyAt;
    updateBoomerangDiscs(1 / 60);
    const thrown = { discs: boomerangDiscs.length, dx: boomerangDiscs[0].dx, cooldown: player.boomerangReadyAt - totalTime };
    for (let f = 0; f < 240 && boomerangDiscs.length; f++) {
      totalTime += 1 / 60;
      const before = foe.hp;
      updateBoomerangDiscs(1 / 60);
      if (foe.hp < before) hitsOnFoe.push(boomerangDiscs[0]?.returning ? 'back' : 'out');
      const d = boomerangDiscs[0];
      if (d) { maxDist = Math.max(maxDist, d.x - 300); if (d.returning && turnedAt === null) turnedAt = Math.round(d.x - 300); }
    }
    return JSON.stringify({ thrown, hitsOnFoe, maxDist: Math.round(maxDist), turnedAt,
      left: boomerangDiscs.length, stats: player.buildStats });
  })()`));
  assert.equal(x.thrown.discs, 1);
  assert.equal(x.thrown.dx, 1);
  assert.ok(Math.abs(x.thrown.cooldown - 2.2) < 1e-9);
  // One hit going out, one coming back: each leg hits a target once.
  assert.deepEqual(x.hitsOnFoe, ['out', 'back']);
  assert.ok(x.turnedAt >= 260 && x.turnedAt < 275, 'turns at range: ' + x.turnedAt);
  assert.equal(x.left, 0);
  assert.equal(x.stats.discThrows, 1);
  assert.equal(x.stats.discHits, 2);
  assert.equal(x.stats.discCatches, 1);
});

test('Odak 3.2 Bumerang Disk evolution throws a mirrored pair and respects the disc cap', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = [];
    player.dashDir = { x: 0, y: -1 };
    player.upgradeCounts.boomerang_disc = 3; player.refreshBuildTraits();
    updateBoomerangDiscs(1 / 60);
    const pair = boomerangDiscs.map(d => [d.dx, d.dy]);
    for (let i = 0; i < 10; i++) throwBoomerangDisc(player, 1, 0);
    const capped = boomerangDiscs.length;
    // A lost disc never lingers past its lifetime.
    player.x = -5000;
    for (let f = 0; f < 60 * 5; f++) { totalTime += 1 / 60; player.boomerangReadyAt = 1e9; updateBoomerangDiscs(1 / 60); }
    const afterLifetime = boomerangDiscs.length;
    player.upgradeCounts.boomerang_disc = 0;
    throwBoomerangDisc(player, 1, 0);
    return JSON.stringify({ evo: player.evolutions.has('boomerang_disc'), pair, capped, afterLifetime,
      noTier: boomerangDiscs.length });
  })()`));
  assert.equal(x.evo, true);
  assert.deepEqual(x.pair, [[0, -1], [0, 1]]);
  assert.equal(x.capped, 4);
  assert.equal(x.afterLifetime, 0);
  assert.equal(x.noTier, 0);
});

test('Odak 3.2 Şok Halkası tier rules, card and evolution are wired', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const u = UPGRADES_POOL.find(u => u.id === 'shock_ring');
    return JSON.stringify({ rules: SHOCK_RING_RULES, max: MAX_SHOCK_RINGS, kind: u.kind,
      evo: EVOLUTION_DEFS.shock_ring.name, fire: !!WEAPON_SFX.shock, hit: !!HIT_SFX.shock,
      style: PROJECTILE_VISUAL_STYLES.shock.type,
      label: getUpgradeCardPresentation(u, RARITIES[0], 0).label });
  })()`));
  assert.equal(x.kind, 'weapon');
  assert.equal(x.label, 'SİLAH MODÜLÜ');
  assert.deepEqual(x.rules.interval, [0, 3.2, 2.9, 2.6]);
  assert.deepEqual(x.rules.maxRadius, [0, 130, 145, 160]);
  assert.deepEqual(x.rules.damageMult, [0, 0.65, 0.85, 1.1]);
  assert.equal(x.max, 3);
  assert.equal(x.evo, 'Artçı Şok');
  assert.ok(x.fire && x.hit);
  assert.equal(x.style, 'shock');
});

test('Odak 3.2 Şok Halkası hits each enemy once per ring and harder near the core', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = []; nextBossTime = 9999;
    player.x = 500; player.y = 400;
    player.upgradeCounts.shock_ring = 1; player.refreshBuildTraits();
    const near = new Enemy(530, 400, 'TANK'), far = new Enemy(610, 400, 'TANK'), out = new Enemy(800, 400, 'TANK');
    for (const e of [near, far, out]) { e.hp = e.maxHp = 5000; enemies.push(e); }
    const lost = () => [near, far, out].map(e => Math.round(5000 - e.hp));
    updateShockRings();
    const first = { rings: shockRings.length, next: +(player.shockReadyAt - totalTime).toFixed(2) };
    for (let f = 0; f < 40; f++) { totalTime += 1 / 60; player.shockReadyAt = 1e9; updateShockRings(); }
    const once = lost();
    const left = shockRings.length;
    player.shockReadyAt = 0;
    updateShockRings();
    for (let f = 0; f < 40; f++) { totalTime += 1 / 60; player.shockReadyAt = 1e9; updateShockRings(); }
    return JSON.stringify({ first, once, left, twice: lost(), stats: player.buildStats });
  })()`));
  assert.deepEqual(x.first, { rings: 1, next: 3.2 });
  assert.equal(x.left, 0);
  assert.ok(x.once[0] > 0 && x.once[1] > 0, 'both enemies inside the ring are hit');
  assert.ok(x.once[0] > x.once[1] * 1.4, 'near enemy takes clearly more: ' + x.once);
  assert.equal(x.once[2], 0, 'outside the ring is untouched');
  x.twice.slice(0, 2).forEach((v, i) => assert.ok(Math.abs(v - x.once[i] * 2) <= 1, `ring twice: ${x.twice} vs ${x.once}`));
  assert.equal(x.stats.shockRings, 2);
  assert.equal(x.stats.shockHits, 4);
});

test('Odak 3.2 Şok Halkası evolution adds a delayed half-strength aftershock', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = []; nextBossTime = 9999;
    player.x = 500; player.y = 400;
    player.upgradeCounts.shock_ring = 3; player.refreshBuildTraits();
    const foe = new Enemy(540, 400, 'TANK'); foe.hp = foe.maxHp = 5000; enemies.push(foe);
    updateShockRings();
    const queued = shockRings.map(r => [r.scale, +(r.startAt - totalTime).toFixed(2)]);
    const hits = [];
    for (let f = 0; f < 60; f++) {
      totalTime += 1 / 60; player.shockReadyAt = 1e9;
      const before = foe.hp; updateShockRings();
      if (foe.hp < before) hits.push(Math.round(before - foe.hp));
    }
    for (let i = 0; i < 6; i++) emitShockRing(player);
    return JSON.stringify({ evo: player.evolutions.has('shock_ring'), queued, hits, capped: shockRings.length,
      after: player.buildStats.shockAftershocks });
  })()`));
  assert.equal(x.evo, true);
  assert.deepEqual(x.queued, [[1, 0], [0.5, 0.35]]);
  assert.equal(x.hits.length, 2);
  assert.ok(Math.abs(x.hits[1] - x.hits[0] / 2) <= 1, 'aftershock is half: ' + x.hits);
  assert.equal(x.capped, 3);
  assert.equal(x.after, 1);
});

test('Odak 3.2 pool holds 8 weapons (plasma + 7 slotted) and 10 passives', () => {
  const { run } = setup();
  const x = JSON.parse(run(`JSON.stringify({
    slotted: UPGRADES_POOL.filter(u => u.kind === 'weapon' && !u.upgradeOf).length,
    passive: UPGRADES_POOL.filter(u => u.kind === 'passive').length })`));
  assert.deepEqual(x, { slotted: 7, passive: 10 });
});

// Odak 4.3 · an EFSANEVİ pick cuts 16 % per tier (NADİR keeps the old 10 %).
test('Odak 3.2 Soğutucu cuts ability maxima and weapon/Prism cooldowns per tier by its rarity', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const base = { dash: player.dashMaxCooldown, nova: player.novaMaxCooldown, shield: player.shieldMaxCooldown,
      prism: getPrismCooldown() };
    const coolant = UPGRADES_POOL.find(u => u.id === 'coolant');
    const tiers = [];
    for (let i = 0; i < 3; i++) {
      gameState = 'LEVEL_UP'; currentUpgradeChoices = [{ upg: coolant, rarity: RARITIES[3] }]; selectUpgradeOption(0);
      tiers.push({ mult: +getCooldownMult().toFixed(4), dash: player.dashMaxCooldown, prism: getPrismCooldown() });
    }
    player.upgradeCounts.shock_ring = 1;
    player.shockReadyAt = 0; updateShockRings();
    const shockWait = player.shockReadyAt - totalTime;
    return JSON.stringify({ base, tiers, nova: player.novaMaxCooldown, shield: player.shieldMaxCooldown,
      shockWait: +shockWait.toFixed(4), label: getUpgradeCardPresentation(coolant, RARITIES[0], 0).label });
  })()`));
  const k = 0.84 ** 3;
  assert.deepEqual(x.tiers.map(t => t.mult), [0.84, 0.7056, +k.toFixed(4)]);
  assert.ok(Math.abs(x.tiers[2].dash - Math.max(0.8, x.base.dash * k)) < 1e-9);
  assert.ok(Math.abs(x.tiers[2].prism - x.base.prism * k) < 1e-9);
  assert.ok(Math.abs(x.nova - Math.max(4, x.base.nova * k)) < 1e-9);
  assert.ok(Math.abs(x.shield - Math.max(4, x.base.shield * k)) < 1e-9);
  assert.equal(x.shockWait, +(3.2 * k).toFixed(4));
  assert.equal(x.label, 'SİSTEM MODÜLÜ');
});

test('Odak 3.2 Soğutucu evolution trims EMP and Prism on every dash end', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts.coolant = 3; player.refreshBuildTraits();
    player.novaCooldown = 5; prismGuardReadyAt = totalTime + 4;
    player.isDashing = true; player.dashTimer = 0.001;
    player.update(1 / 60);
    return JSON.stringify({ evo: player.evolutions.has('coolant'), dashing: player.isDashing,
      nova: +player.novaCooldown.toFixed(2), prism: +(prismGuardReadyAt - totalTime).toFixed(2),
      cycles: player.buildStats.cryoCycles });
  })()`));
  assert.equal(x.evo, true);
  assert.equal(x.dashing, false);
  assert.ok(x.nova <= 4.01 && x.nova >= 3.9, 'nova ' + x.nova);
  assert.equal(x.prism, 3);
  assert.equal(x.cycles, 1);
});

test('Odak 3.2 Toplayıcı adds 15 % XP per tier and its evolution pulls every orb', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const pick = () => { player.xp = 0; player.xpToNext = 1e9; const o = new EnergyOrb(player.x, player.y, 20); o.update(1 / 60); return +player.xp.toFixed(4); };
    const gains = [pick()];
    for (let t = 1; t <= 3; t++) { player.upgradeCounts.collector = t; gains.push(pick()); }
    player.refreshBuildTraits();
    orbs = [new EnergyOrb(player.x + 600, player.y, 5), new EnergyOrb(player.x - 600, player.y, 5)];
    const pulls = [];
    for (let i = 0; i < 80; i++) {
      const o = new EnergyOrb(player.x, player.y, 1); o.update(1 / 60);
      if (player.buildStats.harvestPulls > pulls.length) pulls.push(i + 1);
    }
    return JSON.stringify({ gains, mult: player.xpMultiplier, pulls, far: orbs.map(o => o.magnetized),
      evo: player.evolutions.has('collector') });
  })()`));
  const m = x.mult;
  assert.deepEqual(x.gains, [20, 23, 26, 29].map(v => +(v * m).toFixed(4)));
  assert.equal(x.evo, true);
  assert.deepEqual(x.pulls, [40, 80]);
  assert.deepEqual(x.far, [true, true]);
});

test('Odak 3.5 salvo bullets and homing missiles take their damage from the tier table', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    rng = () => 0.99;
    enemies = [new Enemy(player.x + 200, player.y, 'TANK')];
    const rows = [];
    for (let t = 1; t <= 3; t++) {
      player.upgradeCounts = { multishot: t, homing: t };
      player.multishot = t + 1; player.homingMissiles = t;
      bullets = []; player.shotCounter = 2;
      player.autoShoot();
      const ratio = b => +(b.damage / player.damage).toFixed(4);
      rows.push({ shells: bullets.filter(b => !b.isHoming).map(ratio), missiles: bullets.filter(b => b.isHoming).map(ratio) });
    }
    player.upgradeCounts = {}; player.multishot = 1; player.homingMissiles = 0;
    bullets = []; player.autoShoot();
    return JSON.stringify({ rows, single: bullets.map(b => b.damage / player.damage), rules: LEGACY_WEAPON_RULES });
  })()`));
  const { salvoDamage } = x.rules.multishot, { missileDamage } = x.rules.homing;
  x.rows.forEach((row, i) => {
    const t = i + 1;
    assert.deepEqual(row.shells, Array(t + 1).fill(salvoDamage[t]));
    assert.deepEqual(row.missiles, Array(t).fill(missileDamage[t]));
  });
  assert.deepEqual(x.single, [1], 'a lone plasma bolt keeps full damage');
  assert.equal(salvoDamage[0], salvoDamage[1]);
  assert.equal(missileDamage[0], missileDamage[1]);
});

test('Odak 3.5 orbital contact, orbital pulse and lightning arcs follow the tier table', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = []; nextBossTime = 9999; rng = () => 0;
    const contact = [];
    for (let t = 0; t <= 3; t++) {
      player.upgradeCounts = t ? { orbital: t } : {}; player.orbitals = 1; player.orbitalSpeed = 0; player.fireTimer = 99;
      const s = player.getOrbitalPositions()[0];
      const foe = new Enemy(s.x, s.y, 'TANK'); foe.hp = foe.maxHp = 1e6; enemies = [foe];
      updateGame(1 / 60);
      contact.push(+((1e6 - foe.hp) / player.damage).toFixed(4));
    }
    enemies = [];
    player.upgradeCounts = { orbital: 3 }; player.refreshBuildTraits(); player.evolutionPulseTimer = 0;
    const near = new Enemy(player.x + 100, player.y, 'TANK'); near.hp = near.maxHp = 1e6; enemies = [near];
    player.update(1 / 60);
    const pulse = +((1e6 - near.hp) / player.damage).toFixed(4);
    const arcs = [];
    for (let t = 1; t <= 3; t++) {
      player.upgradeCounts = { lightning: t }; player.chainLightning = 1;
      const a = new Enemy(200, 200, 'TANK'), b = new Enemy(300, 200, 'TANK');
      for (const e of [a, b]) e.hp = e.maxHp = 1e6;
      enemies = [a, b];
      a.takeDamage(100, 0, 0, false, true, true);
      arcs.push(+((1e6 - b.hp) / (1e6 - a.hp)).toFixed(4));
    }
    return JSON.stringify({ contact, pulse, arcs, rules: LEGACY_WEAPON_RULES });
  })()`));
  const { contactDamage, pulseDamage } = x.rules.orbital;
  assert.deepEqual(x.contact, contactDamage.map(v => +v.toFixed(4)));
  assert.equal(x.pulse, pulseDamage);
  assert.deepEqual(x.arcs, x.rules.lightning.arcDamage.slice(1));
});

test('Odak 3.4 every new weapon pairs with a passive in a one-sentence synergy', () => {
  const { run } = setup();
  const x = JSON.parse(run(`JSON.stringify({ defs: SYNERGY_DEFS,
    kinds: Object.fromEntries(UPGRADES_POOL.map(u => [u.id, u.kind])) })`));
  assert.ok(x.defs.length >= 8);
  for (const weapon of ['mine_trail', 'boomerang_disc', 'shock_ring']) {
    assert.ok(x.defs.some(s => s.modules.includes(weapon) &&
      s.modules.some(id => x.kinds[id] === 'passive')), 'no passive pair for ' + weapon);
  }
  for (const s of x.defs) {
    assert.equal(s.modules.length, 2);
    assert.ok(s.modules.every(id => x.kinds[id]), 'unknown module in ' + s.id);
    assert.equal((s.desc.match(/\./g) || []).length, 1, 'one sentence: ' + s.id);
  }
  assert.equal(new Set(x.defs.map(s => s.id)).size, x.defs.length);
});

test('Odak 3.4 a card that completes a synergy shows it on the card', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts = { mine_trail: 2, kinetic_magnet: 1 };
    const box = document.getElementById('upgradeCardsContainer'), cards = [];
    box.appendChild = c => cards.push(c);
    const saved = shuffleInPlace;
    shuffleInPlace = items => items.sort((a, b) => (b.id === 'kinetic_magnet') - (a.id === 'kinetic_magnet'));
    try { populateUpgradeCards(); } finally { shuffleInPlace = saved; }
    const kinetic = cards[currentUpgradeChoices.findIndex(c => c.upg.id === 'kinetic_magnet')];
    gameState = 'LEVEL_UP';
    currentUpgradeChoices = [{ upg: UPGRADES_POOL.find(u => u.id === 'kinetic_magnet'), rarity: RARITIES[0] }];
    selectUpgradeOption(0);
    return JSON.stringify({ markup: kinetic?.innerHTML || '', active: player.synergies.has('mine_launcher') });
  })()`));
  assert.match(x.markup, /YENİ SİNERJİ:<\/strong> Mayın Fırlatıcı · Atılım bittiği yere üç mayın bırakır\./);
  assert.equal(x.active, true);
});

test('Odak 3.4 Mayın Fırlatıcı drops three mines where a dash ends', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const dashEnd = () => { player.isDashing = true; player.dashTimer = 0.001; player.update(1 / 60); };
    player.upgradeCounts = { mine_trail: 2, kinetic_magnet: 1 }; player.refreshBuildTraits();
    dashEnd();
    const without = trailMines.length;
    player.upgradeCounts.kinetic_magnet = 2; player.refreshBuildTraits();
    dashEnd();
    return JSON.stringify({ without, mines: trailMines.map(m => Math.round(Math.hypot(m.x - player.x, m.y - player.y))),
      drops: player.buildStats.launcherDrops });
  })()`));
  assert.equal(x.without, 0);
  assert.deepEqual(x.mines, [34, 34, 34]);
  assert.equal(x.drops, 3);
});

test('Odak 3.4 Sekme Disk bounces once to the nearest enemy before returning', () => {
  const { run } = setup();
  const trace = synergy => JSON.parse(run(`(() => {
    startNewGame();
    enemies = []; nextBossTime = 9999;
    player.x = 300; player.y = 400; player.dashDir = { x: 1, y: 0 };
    player.upgradeCounts = { boomerang_disc: 2, pierce_ricochet: ${synergy ? 2 : 1} }; player.refreshBuildTraits();
    const side = new Enemy(600, 540, 'TANK'); side.hp = side.maxHp = 5000; enemies.push(side);
    updateBoomerangDiscs(1 / 60);
    let bounced = false, maxY = 400;
    for (let f = 0; f < 240 && boomerangDiscs.length; f++) {
      totalTime += 1 / 60; player.boomerangReadyAt = 1e9; updateBoomerangDiscs(1 / 60);
      const d = boomerangDiscs[0]; if (d) maxY = Math.max(maxY, d.y);
    }
    return JSON.stringify({ hp: side.hp, maxY: Math.round(maxY), ricochets: player.buildStats.discRicochets,
      caught: player.buildStats.discCatches });
  })()`));
  const off = trace(false), on = trace(true);
  assert.equal(off.hp, 5000);
  assert.equal(off.ricochets, 0);
  assert.equal(on.ricochets, 1);
  assert.ok(on.hp < 5000, 'bounce reaches the side enemy');
  assert.ok(on.maxY > 480, 'disc leaves its straight line: ' + on.maxY);
  assert.equal(on.caught, 1);
});

test('Odak 3.4 Şok Kalkanı fires a ring when the shield breaks', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const breakShield = () => { player.hasShield = true; player.shieldActive = true; player.invulnTimer = 0; player.takeDamage(10); };
    player.upgradeCounts = { shock_ring: 2, aegis_shield: 1 }; player.refreshBuildTraits();
    player.shockReadyAt = 1e9;
    breakShield();
    const without = shockRings.length;
    player.upgradeCounts.aegis_shield = 2; player.refreshBuildTraits();
    breakShield();
    return JSON.stringify({ without, rings: shockRings.length, stat: player.buildStats.shieldShocks,
      hp: player.hp, max: player.maxHp });
  })()`));
  assert.equal(x.without, 0);
  assert.equal(x.rings, 1);
  assert.equal(x.stat, 1);
  assert.equal(x.hp, x.max, 'the shield still blocks the hit');
});

test('Odak 3.4 Hasat Uyduları pull XP orbs an orbital touches, never gold', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    player.upgradeCounts = { orbital: 2, collector: 2 }; player.orbitals = 1; player.refreshBuildTraits();
    const s = player.getOrbitalPositions()[0];
    orbs = [new EnergyOrb(s.x + 4, s.y, 5), new EnergyOrb(s.x - 4, s.y, 5, true), new EnergyOrb(player.x + 700, player.y, 5)];
    const pulled = harvestOrbsWithSatellites(player);
    const flags = orbs.map(o => o.magnetized);
    player.upgradeCounts.collector = 1; player.refreshBuildTraits();
    orbs = [new EnergyOrb(s.x + 4, s.y, 5)];
    return JSON.stringify({ pulled, flags, off: harvestOrbsWithSatellites(player) });
  })()`));
  assert.equal(x.pulled, 1);
  assert.deepEqual(x.flags, [true, false, false]);
  assert.equal(x.off, 0);
});

test('Odak 3.4 Buzlu Disk refunds dash cooldown on each catch', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    enemies = [];
    player.dashDir = { x: 1, y: 0 };
    player.upgradeCounts = { boomerang_disc: 2, coolant: 2 }; player.refreshBuildTraits();
    updateBoomerangDiscs(1 / 60);
    player.dashCooldown = 2;
    let frames = 0;
    while (boomerangDiscs.length && frames < 300) { totalTime += 1 / 60; frames++; player.boomerangReadyAt = 1e9; updateBoomerangDiscs(1 / 60); }
    return JSON.stringify({ dash: +player.dashCooldown.toFixed(2), refunds: player.buildStats.cryoDashRefunds });
  })()`));
  assert.equal(x.dash, 1.5);
  assert.equal(x.refunds, 1);
});

test('Odak 3.2 upgrade pool matches the shared id list', () => {
  const ids = JSON.parse(setup().run('JSON.stringify(UPGRADES_POOL.map(u => u.id))'));
  assert.deepEqual([...ids].sort(), [...UPGRADE_IDS].sort());
});

test('Odak 3.3 shared harness honours viewport size and a longer run timeout', () => {
  const small = setup({}, { unlockAll: false });
  const wide = setup({}, { unlockAll: false, width: 1366, height: 768, timeout: 20000 });
  const size = s => JSON.parse(s.run('JSON.stringify([window.innerWidth, document.documentElement.clientHeight])'));
  assert.deepEqual(size(small), [1280, 720]);
  assert.deepEqual(size(wide), [1366, 768]);
  assert.equal(wide.run('isSystemUnlocked("emp")'), false);
  // A 10 s simulated run fits in one call with the longer timeout.
  assert.equal(wide.run('startNewGame(); for (let f = 0; f < 600; f++) updateGame(1 / 60); Math.round(totalTime)'), 10);
});

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
  // Odak 4.4 · the lab sells one tier; 999 is garbage, so it is clamped with no refund.
  assert.equal(s.run('metaUpgrades.defibrillator'), 1);
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
  const r=JSON.parse(run("(()=>{startNewGame();wave=20;rng=()=>0;for(let t=0;t<180;t++){totalTime=t;combatDirector.registerChestDrop('elite',100,100);lootChests.length=0;}return JSON.stringify({drops:combatDirector.stats.chestDrops.elite,kills:combatDirector.stats.eliteKills,denied:combatDirector.stats.chestDenied,next:combatDirector.getNextEliteChestChance()});})()"));
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
    startNewGame();wave=7;totalTime=150;nextBossTime=500;
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


test('M3.1 five original evolutions remain among expanded twelve, with four recipes', () => {
  const { run } = setup();
  const info = JSON.parse(run(`(() => JSON.stringify({
    evolutions: Object.keys(EVOLUTION_DEFS),
    synergies: SYNERGY_DEFS.map(s=>({id:s.id,modules:s.modules})),
    upgrades: UPGRADES_POOL.map(u=>u.id)
  }))()`));
  assert.equal(info.evolutions.length,info.upgrades.length);
  for(const id of ['multishot','homing','lightning','orbital','pierce_ricochet']) {
    assert.ok(info.evolutions.includes(id));
  }
  // Odak 3.4: the four original recipes stay, five weapon/passive pairs join them.
  assert.equal(info.synergies.length,9);
  for(const id of ['swarm_guidance','ionic_guidance','orbital_aegis','prism_optics'])
    assert.ok(info.synergies.some(s=>s.id===id));
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
    const originalRandom=rng;
    rng=()=>0;
    try { player.autoShoot(); } finally { rng=originalRandom; }
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


test('M3.2 all thirteen modules have unique third-tier evolutions', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => JSON.stringify({
    names:UPGRADES_POOL.map(u=>u.id),evolutions:Object.keys(EVOLUTION_DEFS),
    missing:UPGRADES_POOL.filter(u=>!EVOLUTION_DEFS[u.id]).map(u=>u.id)
  }))()`));
  assert.equal(x.names.length,UPGRADE_IDS.length);
  assert.equal(x.evolutions.length,x.names.length);
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

test('M3.2 fully completed 39-tier run does not open an empty choice dialog', () => {
  const { run }=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    for(const u of UPGRADES_POOL)player.upgradeCounts[u.id]=3;
    player.refreshBuildTraits();
    player.hp=player.maxHp-40;
    triggerLevelUp();
    return JSON.stringify({state:gameState,hp:player.hp,max:player.maxHp,
      evolutions:player.evolutions.size,kinds:currentUpgradeChoices.map(c=>c.upg.kind)});
  })()`));
  // Odak 5.8: a full build gets a hand of overload cards instead of a silent heal.
  assert.equal(x.state,'LEVEL_UP');
  assert.equal(x.hp,x.max-40);
  assert.deepEqual(x.kinds,['overload','overload','overload']);
  assert.equal(x.evolutions,UPGRADE_IDS.length);
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
  // Odak 2.7e: key labels are checked per input type in the browser spec.
  for(const label of ['id="tabProtocolContent"','id="buildGuidePanel"']) {
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
  assert.equal(x.all.length,UPGRADE_IDS.length);
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
  const x=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts={orbital:3,lightning:3,homing:2,multishot:0,firerate:3,pierce_ricochet:3,crit_mastery:3,aegis_shield:3,vampiric:1};const box=document.getElementById('upgradeCardsContainer'),cards=[];box.appendChild=c=>cards.push(c);const saved=rollRarity;let k=0;rollRarity=()=>[RARITIES[0],RARITIES[3],RARITIES[2]][k++];try{populateUpgradeCards();}finally{rollRarity=saved;}return JSON.stringify({ids:currentUpgradeChoices.map(c=>c.upg.id),cards:cards.map(c=>({role:c._attrs['data-role'],rarity:c._attrs['data-rarity'],shortcut:c._attrs['aria-keyshortcuts'],markup:c.innerHTML}))});})()"));
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
  // Odak 3.1 · keys drive the real level-up flow (replaces source regexes).
  const { run, windowEvent } = setup();
  run('startNewGame(); totalGold = 999; triggerLevelUp()');
  const before = run('rerollCost');
  windowEvent('keydown', { code: 'KeyR' });
  assert.equal(run('rerollCost'), before + 10);
  assert.equal(run('gameState'), 'LEVEL_UP');
  const picked = run('currentUpgradeChoices[1].upg.id');
  windowEvent('keydown', { code: 'Digit2' });
  assert.equal(run('gameState'), 'PLAYING');
  assert.equal(run(`player.upgradeCounts[${JSON.stringify(picked)}]`), 1);
  run('triggerLevelUp()');
  windowEvent('keydown', { code: 'KeyX' });
  assert.equal(run('gameState'), 'PLAYING');
  assert.equal(run('upgradeSkipsLeft'), 1);
});

test('Odak 3.1 every upgrade has a kind; plasma holds weapon slot 1 and multishot takes no slot', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const kinds = {};
    for (const u of UPGRADES_POOL) kinds[u.id] = u.kind;
    const empty = getBuildSlots(player);
    player.upgradeCounts = { multishot: 2, homing: 1, vampiric: 1, firerate: 0 };
    return JSON.stringify({ kinds, limits: BUILD_SLOT_LIMITS, empty, slots: getBuildSlots(player) });
  })()`));
  assert.deepEqual(Object.keys(x.kinds).filter(id => x.kinds[id] === 'weapon').sort(),
    ['boomerang_disc', 'circuit_weaver', 'homing', 'lightning', 'mine_trail', 'multishot', 'orbital',
      'shock_ring']);
  assert.deepEqual(Object.keys(x.kinds).filter(id => x.kinds[id] === 'passive').sort(),
    ['aegis_shield', 'collector', 'coolant', 'crit_mastery', 'firerate', 'kinetic_magnet',
      'overdrive_boost', 'phase_echo', 'pierce_ricochet', 'vampiric']);
  assert.deepEqual(x.limits, { weapon: 4, passive: 5 });
  assert.deepEqual(x.empty, { weapon: ['plasma'], passive: [] });
  assert.deepEqual(x.slots, { weapon: ['plasma', 'homing'], passive: ['vampiric'] });
});

test('Odak 3.1 a full slot type only offers owned cards below tier 3', () => {
  const { run } = setup();
  const offered = JSON.parse(run(`(() => {
    startNewGame();
    // Weapons: plasma + homing, orbital, lightning = 4/4. Passives: 5/5.
    player.upgradeCounts = { homing: 1, orbital: 3, lightning: 2,
      firerate: 1, vampiric: 3, crit_mastery: 1, aegis_shield: 2, kinetic_magnet: 1 };
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      populateUpgradeCards();
      for (const c of currentUpgradeChoices) seen.add(c.upg.id);
    }
    return JSON.stringify([...seen].sort());
  })()`));
  assert.deepEqual(offered, ['aegis_shield', 'crit_mastery', 'firerate', 'homing',
    'kinetic_magnet', 'lightning', 'multishot']);
  // A free passive slot reopens unowned passives, but never a fifth weapon.
  const reopened = JSON.parse(run(`(() => {
    delete player.upgradeCounts.kinetic_magnet;
    return JSON.stringify(UPGRADES_POOL.filter(u => isUpgradeOfferable(u, player)).map(u => u.id).sort());
  })()`));
  assert.ok(reopened.includes('phase_echo') && reopened.includes('pierce_ricochet'));
  assert.ok(!reopened.includes('circuit_weaver'));
  // Everything owned is maxed and both types are full: no empty choice dialog.
  const done = JSON.parse(run(`(() => {
    player.upgradeCounts = { homing: 3, orbital: 3, lightning: 3, multishot: 3,
      firerate: 3, vampiric: 3, crit_mastery: 3, aegis_shield: 3, kinetic_magnet: 3 };
    player.hp = player.maxHp - 40;
    triggerLevelUp();
    return JSON.stringify({ state: gameState, kinds: currentUpgradeChoices.map(c => c.upg.kind) });
  })()`));
  // Odak 5.8: the dialog is never empty, overload cards fill it.
  assert.deepEqual(done, { state: 'LEVEL_UP', kinds: ['overload', 'overload', 'overload'] });
});

test('Odak 3.1 card label follows kind and the slot row shows filled and empty slots', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const label = id => getUpgradeCardPresentation(UPGRADES_POOL.find(u => u.id === id), RARITIES[0], 0).label;
    startNewGame();
    player.upgradeCounts = { homing: 1, firerate: 2 };
    triggerLevelUp();
    return JSON.stringify({ weapon: label('circuit_weaver'), passive: label('phase_echo'),
      multishot: label('multishot'), row: document.getElementById('upgradeSlotRow').innerHTML });
  })()`));
  assert.equal(x.weapon, 'SİLAH MODÜLÜ');
  assert.equal(x.multishot, 'SİLAH MODÜLÜ');
  assert.equal(x.passive, 'SİSTEM MODÜLÜ');
  const groups = x.row.split('upgrade-slot-group"').slice(1);
  assert.equal(groups.length, 2);
  const count = (s, re) => (s.match(re) || []).length;
  assert.equal(count(groups[0], /class="upgrade-slot( filled)?"/g), 4);
  assert.equal(count(groups[0], /upgrade-slot filled/g), 2);
  assert.match(groups[0], /fa-circle-dot/);
  assert.match(groups[0], /fa-rocket/);
  assert.equal(count(groups[1], /class="upgrade-slot( filled)?"/g), 5);
  assert.equal(count(groups[1], /upgrade-slot filled/g), 1);
  assert.match(groups[1], /aria-label="PASİF yuvası 1 \/ 5"/);
});

test('Odak 3.1 ATLA skips twice per run with a 15 % XP refund', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const out = [];
    for (let i = 0; i < 3; i++) {
      player.xp = 0;
      triggerLevelUp();
      const bar = player.xpToNext, tiers = JSON.stringify(player.upgradeCounts);
      const ok = skipUpgradeChoice();
      out.push({ ok, state: gameState, xp: player.xp, bar, tiersSame: tiers === JSON.stringify(player.upgradeCounts),
        left: upgradeSkipsLeft, label: document.getElementById('skipUpgradeText').textContent,
        disabled: document.getElementById('skipUpgradeBtn').disabled });
      if (gameState === 'LEVEL_UP') selectUpgradeOption(0);
    }
    startNewGame();
    return JSON.stringify({ out, fresh: upgradeSkipsLeft });
  })()`));
  for (const step of x.out.slice(0, 2)) {
    assert.equal(step.ok, true);
    assert.equal(step.state, 'PLAYING');
    assert.equal(step.xp, Math.round(step.bar * 0.15));
    assert.equal(step.tiersSame, true);
  }
  assert.deepEqual(x.out.map(s => s.left), [1, 0, 0]);
  assert.deepEqual(x.out.map(s => String(s.label)), ['2', '1', '0']);
  assert.equal(x.out[2].ok, false);
  assert.equal(x.out[2].disabled, true);
  assert.equal(x.out[2].state, 'LEVEL_UP');
  assert.equal(x.fresh, 2);
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
  assert.equal(data.modules,UPGRADE_IDS.length);
  assert.equal(data.evolutions,UPGRADE_IDS.length);
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
  assert.deepEqual(Object.keys(data.fire),['plasma','prism','reactor','rail','missile','cluster','arc','mine','disc','shock']);
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
  const a=JSON.parse(run("(()=>{startNewGame();const c=combatDirector;const timeline=[];rng=()=>0;for(let t=1;t<=180;t++){totalTime=t;c.registerChestDrop('elite',player.x,player.y);if(lootChests.length){timeline.push(t);lootChests.length=0;}}return JSON.stringify({timeline,denied:c.stats.chestDenied,kills:c.stats.eliteKills,next:c.getNextEliteChestChance()});})()"));
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
  const d=JSON.parse(run("(()=>{startNewGame();wave=20;player.hp=40;player.maxHp=150;rng=()=>0;const start=totalGold;const c=new LootChest(player.x,player.y,'elite');c.update(.016);const e=window.getNeonEconomySnapshot();const gold1=totalGold-start;const heal1=player.hp;const b=new LootChest(player.x,player.y,'boss');b.update(.016);const s=window.getNeonEconomySnapshot();return JSON.stringify({gold1,heal1,finalGold:totalGold-start,elite:e.chestRewards.elite,boss:s.chestRewards.boss,tracked:s.goldTracked,session:s.goldSession,opened:s.chestOpened});})()"));
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
  const data=JSON.parse(run("(()=>{startNewGame();wave=10;rng=()=>.99;bullets=[];new LootChest(player.x,player.y,'elite').update(.016);const elite=bullets.length;bullets=[];new LootChest(player.x,player.y,'boss').update(.016);const boss=bullets.length;bullets=new Array(MAX_PLAYER_PROJECTILES-4).fill({dead:false});new LootChest(player.x,player.y,'boss').update(.016);const capped=bullets.length;return JSON.stringify({elite,boss,capped,max:MAX_PLAYER_PROJECTILES,stats:combatDirector.stats.chestRewards});})()"));
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
  const model=JSON.parse(run("(()=>{const horizons=[300,600,1200,1800],out=[];for(const horizon of horizons){startNewGame();let seed=731;rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);const times=[];for(let sec=1;sec<=horizon;sec++){totalTime=sec;wave=1+Math.floor(sec/16);if(sec===55||sec>55&&(sec-55)%150===0){combatDirector.onBossEncounter();combatDirector.registerChestDrop('boss',player.x,player.y);}if(sec%6===0){const before=combatDirector.stats.chestDrops.elite;combatDirector.registerChestDrop('elite',player.x,player.y);if(combatDirector.stats.chestDrops.elite>before)times.push(sec);}for(const chest of lootChests){chest.x=player.x;chest.y=player.y;chest.update(.016);}lootChests.length=0;bullets=[];}const d=window.getNeonEconomySnapshot();const byMinute={};for(const time of times){const k=Math.floor(time/60);byMinute[k]=(byMinute[k]||0)+1;}out.push({minutes:horizon/60,elite:d.chestDrops.elite,boss:d.chestDrops.boss,opened:Object.values(d.chestOpened).reduce((s,x)=>s+x,0),onGround:d.onGround,tracked:d.goldTracked,session:d.goldSession,goldBySource:d.goldBySource,maxWindowDrops:Math.max(0,...Object.values(byMinute)),minGapOk:times.every((t,i)=>i===0||t-times[i-1]>=5),nextChance:d.nextEliteDropChance});}return JSON.stringify(out);})()"));
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


test('M5.3.1 first three boss encounters are solo with smooth escalation',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();const counts=[],chests=[];for(let i=1;i<=6;i++){totalTime=i*100;spawnBossEncounter();counts.push(activeBosses.length);for(const b of [...activeBosses]){b.hp=1;b.takeDamage(9999,0,0,false,false);}chests.push(combatDirector.stats.chestDrops.boss);}return JSON.stringify({counts,chests,encounters:combatDirector.stats.encounters,kills:combatDirector.stats.bossKills,alive:activeBosses.length});})()"));
  assert.deepEqual(a.counts,[1,1,1,2,3,2]);
  assert.deepEqual(a.chests,[1,2,3,4,5,6]);
  assert.equal(a.encounters,6);
  assert.equal(a.kills,10);
  assert.equal(a.alive,0);
});

test('M5.1.1 elite drop chance decays only on success and resets on the minute',()=>{
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();const c=combatDirector;let roll=.64;rng=()=>roll;const a=[];for(const [time,r] of [[1,.64],[6,.40],[7,.37],[12,.21],[17,.11],[52,.05],[61,.64]]){totalTime=time;roll=r;const chance=c.getNextEliteChestChance();const ok=c.registerChestDrop('elite',0,0);a.push([time,chance,ok,c.getNextEliteChestChance()]);lootChests.length=0;}const d=window.getNeonEconomySnapshot();return JSON.stringify({cases:a,denied:d.chestDenied,window:d.eliteChanceWindow,count:d.eliteDropsInWindow,next:d.nextEliteDropChance});})()"));
  assert.deepEqual(data.cases,[[1,.65,true,.38],[6,.38,false,.38],[7,.38,true,.22],[12,.22,true,.12],[17,.12,true,.06],[52,.06,true,.06],[61,.65,true,.38]]);
  assert.equal(data.denied.roll,1);
  assert.equal(data.window,1);
  assert.equal(data.count,1);
  assert.equal(data.next,.38);
});

test('M5.1.1 60-second reset is based on game time, not boss or successful loot',()=>{
  const {run}=setup();
  const list=JSON.parse(run("(()=>{startNewGame();const c=combatDirector;rng=()=>0;const result=[];for(const time of [10,16,22,61,67,120,126]){totalTime=time;const before=c.getNextEliteChestChance();const dropped=c.registerChestDrop('elite',0,0);lootChests.length=0;result.push({time,before,dropped,window:c.getEliteChanceWindow()});}return JSON.stringify(result);})()"));
  assert.deepEqual(list.map(x=>x.before),[.65,.38,.22,.65,.38,.65,.38]);
  assert.ok(list.every(x=>x.dropped));
  assert.deepEqual(list.map(x=>x.window),[0,0,0,1,1,2,2]);
});

test('M5.1.1 chest inventory still limits uncollected elites, not the earned total',()=>{
  const {run}=setup();
  const a=JSON.parse(run("(()=>{startNewGame();rng=()=>0;const c=combatDirector;const results=[];for(const time of [1,7,13,19,25]){totalTime=time;results.push(c.registerChestDrop('elite',10,10));}const denied=c.stats.chestDenied.groundCap,drop=c.stats.chestDrops.elite;lootChests.length=0;totalTime=31;const restored=c.registerChestDrop('elite',10,10);return JSON.stringify({results,denied,drop,restored,window:c.eliteDropsInWindow});})()"));
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
  assert.deepEqual(a.counts,[1,1,1,2,3,2]);
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

test('Odak 5.13 no-hit mission advances only during active play and fails on real HP loss',()=>{
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();wave=2;generateNextQuest('NO_HIT');const gold=totalGold;updateQuest(4);const safe=activeQuest.progress;gameState='PAUSED';updateQuest(7);const paused=activeQuest.progress;gameState='PLAYING';player.hasShield=true;player.shieldActive=true;player.invulnTimer=0;player.takeDamage(9);const shielded=activeQuest.progress;const offered=questStats.offered;player.shieldActive=false;player.invulnTimer=0;player.takeDamage(9);return JSON.stringify({safe,paused,shielded,failed:questStats.failed,byType:questStats.failedByType,next:activeQuest.type,nextProgress:activeQuest.progress,newOffers:questStats.offered-offered,completed:questStats.completed,goldGained:totalGold-gold});})()"));
  assert.equal(data.safe,4);
  assert.equal(data.paused,4);
  assert.equal(data.shielded,4,'a shield block is not a hit');
  assert.equal(data.failed,1);
  assert.deepEqual(data.byType,{NO_HIT:1});
  assert.notEqual(data.next,'NO_HIT','the failed mission is skipped');
  assert.equal(data.newOffers,1);
  assert.equal(data.completed,0);
  assert.equal(data.goldGained,0);
});

test('M5.2 flawless timer pays once at target without auto-finishing an idle mission',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();wave=2;generateNextQuest('NO_HIT');const target=activeQuest.target;gameState='PAUSED';updateQuest(target+2);const before=questStats.completed;gameState='PLAYING';for(let i=0;i<target*2;i++)updateQuest(.5);return JSON.stringify({before,after:questStats.completed,awarded:questStats.byType.NO_HIT||0,target});})()"));
  assert.equal(x.before,0);
  assert.equal(x.after,1);
  assert.equal(x.awarded,1);
});

test('Odak 3.9 defense fills while standing in the zone, faster with enemies near, and drains only outside',()=>{
  const {run}=setup();
  const d=JSON.parse(run("(()=>{startNewGame();wave=3;generateNextQuest('DEFEND');const q=activeQuest,old={x:player.x,y:player.y};player.x=q.point.x;player.y=q.point.y;updateQuest(2);const alone=q.progress;enemies=[{x:q.point.x+500,y:q.point.y+500,dead:false,isBoss:false}];updateQuest(2);const far=q.progress;enemies=[{x:q.point.x+35,y:q.point.y+30,dead:false,isBoss:false}];updateQuest(2);const inside=q.progress;player.x=old.x+500;player.y=old.y+500;updateQuest(1);const outside=q.progress;player.x=q.point.x;player.y=q.point.y;for(let i=0;i<20;i++)updateQuest(.25);return JSON.stringify({alone,far,inside,outside,completed:questStats.byType.DEFEND||0,point:q.point});})()"));
  // Early waves: enemies die before reaching the zone, so standing there must still count.
  assert.equal(d.alone,2);
  assert.equal(d.far,4);
  assert.ok(Math.abs(d.inside-7.2)<1e-9,'a nearby enemy speeds defense up 1.6x');
  assert.ok(Math.abs(d.outside-6.8)<1e-9,'leaving drains slowly');
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
  const a=JSON.parse(run("(()=>{startNewGame();wave=3;generateNextQuest('DEFEND');const ctx={save(){},restore(){},setLineDash(){},beginPath(){},arc(){},fill(){},stroke(){},fillText(){}};drawQuestObjective(ctx);const live=activeQuest.point!=null;gameState='PAUSED';drawQuestObjective(ctx);return JSON.stringify({live,mobile:document.getElementById('questHudText').textContent,description:document.getElementById('questHudText').title});})()"));
  assert.equal(a.live,true);
  assert.match(a.mobile,/^SAVUN · 0\/8 · \+\d+$/);
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
  assert.deepEqual(JSON.parse(run("JSON.stringify([1,2,3,4,5].map(getBossCountForEncounter))")),[1,1,1,2,3]);
});


test('M5.3 six kinds unlock by wave, preserving first RELAY and VAULT',()=>{
 const {run}=setup();
 const a=JSON.parse(run("JSON.stringify({early:[0,1,2].map(i=>chooseArenaEventKind(i,4)),six:[0,1,2,3,4,5].map(i=>chooseArenaEventKind(i,12)),w6:chooseArenaEventKind(2,6),w7:chooseArenaEventKind(3,7),w9:chooseArenaEventKind(4,9),all:ARENA_EVENT_SEQUENCE})"));
 assert.deepEqual(a.early,['RELAY','VAULT','RELAY']);
 assert.deepEqual(a.six,['RELAY','VAULT','STORM','REACTOR','CORRIDOR','ANOMALY']);
 assert.equal(a.w6,'STORM');assert.equal(a.w7,'REACTOR');assert.equal(a.w9,'CORRIDOR');
 assert.deepEqual(a.all,a.six);
});

test('M5.3 arena kinds have finite activation risks and bounded capture times',()=>{
 const {run}=setup();const specs=JSON.parse(run("JSON.stringify(ARENA_EVENT_SPECS)"));
 assert.equal(Object.keys(specs).length,6);
 for(const [name,x] of Object.entries(specs)){
  assert.ok(x.minWave>=4 && x.minWave<=11,name);
  assert.ok(x.duration>=3 && x.duration<=4.1,name);
  assert.ok(x.cost>=0 && x.cost<=12,name);
  assert.ok(x.label.length>12,name);
  assert.match(x.color,/^#[0-9a-f]{6}$/i);
 }
 assert.equal(specs.VAULT.cost,12);assert.equal(specs.REACTOR.cost,10);
});

test('M5.3 director rotates live six kinds without overlaps or repeated rewards',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=12;totalTime=150;nextBossTime=500;combatDirector.nextArenaAt=0;const kinds=[];for(let i=0;i<6;i++){combatDirector.update(.01);const e=combatDirector.activeArenaEvent;kinds.push(e?.kind);combatDirector.update(.01);e.update(18);combatDirector.nextArenaAt=0;}return JSON.stringify({kinds,offered:combatDirector.stats.arenaOffered,expired:combatDirector.stats.arenaExpired,active:combatDirector.activeArenaEvent,byKind:combatDirector.stats.arenaByKind});})()"));
 assert.deepEqual(a.kinds,['RELAY','VAULT','STORM','REACTOR','CORRIDOR','ANOMALY']);
 assert.equal(a.offered,6);assert.equal(a.expired,6);assert.equal(a.active,null);
 for(const kind of a.kinds)assert.equal(a.byKind[kind].offered,1);
});

test('M5.3 storm costs momentum on voluntary capture, not when ignored',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=8;totalTime=150;player.momentum=80;const e=new ArenaEvent('STORM',200,200);combatDirector.activeArenaEvent=e;const before={hp:player.hp,momentum:player.momentum,xp:player.xp};e.update(.5);const idle=player.momentum;player.x=200;player.y=200;e.update(1);const inside=player.momentum;e.update(2.6);return JSON.stringify({before,idle,inside,dead:e.dead,spent:e.momentumSpent,after:player.momentum,xp:player.xp,hp:player.hp,done:combatDirector.stats.arenaCompleted});})()"));
 assert.equal(a.idle,a.before.momentum);assert.equal(a.hp,a.before.hp);
 assert.ok(a.inside<a.idle);assert.ok(a.spent>20&&a.spent<40);
 assert.equal(a.dead,true);assert.ok(a.xp>a.before.xp);
 assert.ok(a.after>a.inside);assert.equal(a.done,1);
});

test('M5.3 damaged reactor pays 10 HP only once and rewards gold and haste',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=8;totalTime=150;const e=new ArenaEvent('REACTOR',player.x,player.y);combatDirector.activeArenaEvent=e;player.hp=80;const gold=sessionGold;e.update(.3);const one=player.hp;e.update(.3);const two=player.hp;e.update(3.3);return JSON.stringify({one,two,hp:player.hp,gold:sessionGold-gold,ledger:combatDirector.stats.goldBySource.arena,haste:player.hasteTimer,dead:e.dead,done:combatDirector.stats.arenaCompleted});})()"));
 assert.equal(a.one,70);assert.equal(a.two,70);assert.equal(a.hp,70);
 assert.equal(a.gold,49);assert.equal(a.ledger,49);
 assert.equal(a.haste,5);assert.equal(a.dead,true);assert.equal(a.done,1);
});

test('M5.3 reactor refuses low-HP activation and refunds boss cancellation',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=8;totalTime=150;nextBossTime=500;const e=new ArenaEvent('REACTOR',player.x,player.y);combatDirector.activeArenaEvent=e;player.hp=24;e.update(.5);const refused=!e.committed;player.hp=65;e.update(.5);const paid=player.hp;nextBossTime=totalTime+10;combatDirector.update(.01);return JSON.stringify({refused,paid,hp:player.hp,cancelled:combatDirector.stats.arenaCancelled,event:combatDirector.activeArenaEvent});})()"));
 assert.equal(a.refused,true);assert.equal(a.paid,55);
 assert.equal(a.hp,65);assert.equal(a.cancelled,1);assert.equal(a.event,null);
});

test('M5.3 corridor blocks a bounded number of shots only inside its lane',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=10;totalTime=150;const e=new ArenaEvent('CORRIDOR',player.x,player.y);combatDirector.activeArenaEvent=e;enemyProjectiles=[];for(let i=0;i<20;i++)enemyProjectiles.push(new EnemyProjectile(e.x,e.y,0,0,4,8));enemyProjectiles.push(new EnemyProjectile(e.x+200,e.y+150,0,0,4,8));e.update(.5);return JSON.stringify({blocked:e.projectilesBlocked,left:enemyProjectiles.length,outside:enemyProjectiles.some(b=>b.x===e.x+200)});})()"));
 assert.equal(a.blocked,8);assert.equal(a.left,13);assert.equal(a.outside,true);
});

test('M5.3 corridor offers one bounded Cinnet and momentum reward',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=10;totalTime=150;player.momentum=10;const e=new ArenaEvent('CORRIDOR',player.x,player.y);combatDirector.activeArenaEvent=e;const before=player.overdrive;e.update(4.2);const after=player.overdrive;e.update(1);return JSON.stringify({dead:e.dead,before,after,gainMult:player.overdriveGainMult,again:player.overdrive,momentum:player.momentum,done:combatDirector.stats.arenaCompleted});})()"));
 assert.equal(a.dead,true);assert.equal(a.after-a.before,38*a.gainMult);
 assert.equal(a.again,a.after);assert.equal(a.momentum,30);assert.equal(a.done,1);
});

test('M5.3 anomaly requires the ring rather than the unstable center',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=12;totalTime=150;const e=new ArenaEvent('ANOMALY',200,200);combatDirector.activeArenaEvent=e;player.x=200;player.y=200;e.update(1);const center=e.progress;player.x=250;e.update(2);const ring=e.progress;player.x=400;e.update(.5);const lost=e.progress;player.x=250;e.update(2.8);return JSON.stringify({center,ring,lost,dead:e.dead,invuln:player.invulnTimer,done:combatDirector.stats.arenaCompleted});})()"));
 assert.equal(a.center,0);assert.equal(a.ring,2);assert.ok(a.lost<a.ring);
 assert.equal(a.dead,true);assert.ok(a.invuln>=2.2);assert.equal(a.done,1);
});

test('M5.3 all unclaimed events expire without penalty',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{const out=[];for(const kind of ARENA_EVENT_SEQUENCE){startNewGame();totalTime=150;player.momentum=65;const e=new ArenaEvent(kind,15,15);combatDirector.activeArenaEvent=e;const x=[player.hp,sessionGold,player.overdrive,player.momentum];e.update(18);out.push({kind,same:JSON.stringify(x)===JSON.stringify([player.hp,sessionGold,player.overdrive,player.momentum]),expired:combatDirector.stats.arenaExpired,empty:combatDirector.activeArenaEvent===null});}return JSON.stringify(out);})()"));
 assert.equal(a.length,6);assert.ok(a.every(x=>x.same&&x.expired===1&&x.empty));
});

test('M5.3 per-kind diagnostics are copy-safe and reset on new run',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=12;totalTime=150;nextBossTime=500;combatDirector.arenaEventIndex=4;combatDirector.nextArenaAt=0;combatDirector.update(.01);const kind=combatDirector.activeArenaEvent.kind;combatDirector.activeArenaEvent.update(18);const snapshot=combatDirector.getDiagnostics();const original=snapshot.arenaByKind[kind].expired;snapshot.arenaByKind[kind].expired=999;const unchanged=combatDirector.getDiagnostics().arenaByKind[kind].expired;startNewGame();return JSON.stringify({kind,original,unchanged,fresh:combatDirector.getDiagnostics().arenaByKind,offers:combatDirector.stats.arenaOffered});})()"));
 assert.equal(a.kind,'CORRIDOR');assert.equal(a.original,1);assert.equal(a.unchanged,1);
 assert.deepEqual(a.fresh,{});assert.equal(a.offers,0);
});

test('M5.3 optional events never overlap imminent bosses or directional raids',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=12;totalTime=150;nextBossTime=160;combatDirector.nextArenaAt=0;combatDirector.update(.016);const boss=!!combatDirector.activeArenaEvent;nextBossTime=500;combatDirector.pendingEncounter={type:'RAID',warning:3};combatDirector.update(.016);const raid=!!combatDirector.activeArenaEvent;combatDirector.pendingEncounter=null;combatDirector.update(.016);return JSON.stringify({boss,raid,offered:combatDirector.activeArenaEvent?.kind});})()"));
 assert.equal(a.boss,false);assert.equal(a.raid,false);assert.equal(a.offered,'RELAY');
});

test('M5.3 six optional events and offscreen hints draw with bounded visuals',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();const kinds=[];for(const kind of ARENA_EVENT_SEQUENCE){const e=new ArenaEvent(kind,200,200);e.progress=e.required*.45;e.draw(ctx);combatDirector.activeArenaEvent=e;drawOffscreenIndicators();kinds.push(e.kind);}return JSON.stringify(kinds);})()"));
 assert.deepEqual(a,['RELAY','VAULT','STORM','REACTOR','CORRIDOR','ANOMALY']);
});


test('M5.3.1 boss color identity and opening order are deterministic',()=>{
 const {run}=setup();
 const s=JSON.parse(run("JSON.stringify({order:OPENING_BOSS_ORDER,arch:OPENING_BOSS_ORDER.map(t=>BOSS_ARCHETYPES.find(a=>a.type===t)).map(a=>({name:a.name,color:a.color})),visuals:OPENING_BOSS_ORDER.map(t=>BOSS_VISUALS[t].silhouette)})"));
 assert.deepEqual(s.order,['BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID']);
 assert.deepEqual(s.arch.map(x=>x.color),['#ff8800','#ff0055','#b000ff']);
 assert.ok(s.arch[0].name.includes('BEHEMOT'));
 assert.ok(s.arch[1].name.includes('YIKICI'));
 assert.ok(s.arch[2].name.includes('HİÇLİK'));
 assert.deepEqual(s.visuals,['armor','siege','spider']);
});

test('M5.3.1 first three real encounters are solo, unique and immune to RNG order',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{const results=[];for(const roll of [0,.5,.9999]){startNewGame();rng=()=>roll;const types=[],counts=[];for(let i=1;i<=3;i++){wave=i*3+1;totalTime=i*75;spawnBossEncounter();types.push(activeBosses[0].type);counts.push(activeBosses.length);for(const b of [...activeBosses]){b.hp=1;b.takeDamage(9000,0,0,false,false);}}results.push({types,counts,bossKills:combatDirector.stats.bossKills,chests:combatDirector.stats.chestDrops.boss});}return JSON.stringify(results);})()"));
 for(const x of s){
  assert.deepEqual(x.types,['BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID']);
  assert.deepEqual(x.counts,[1,1,1]);
  assert.equal(x.bossKills,3);assert.equal(x.chests,3);
 }
});

test('M5.3.1 boss health effective armor toughness and damage rise in natural wave examples',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();const out=[];for(const waveNum of [4,7,10]){wave=waveNum;totalTime=55+(out.length*65);spawnBossEncounter();const b=activeBosses[0];out.push({type:b.type,hp:b.maxHp,effective:b.maxHp/(b.type==='BOSS_TITAN'?.78:1),damage:b.damage});for(const x of [...activeBosses]){x.hp=1;x.takeDamage(9000,0,0,false,false);}}return JSON.stringify(out);})()"));
 assert.deepEqual(a.map(x=>x.type),['BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID']);
 for(let i=1;i<3;i++){
  assert.ok(a[i].hp>a[i-1].hp,'HP must increase');
  assert.ok(a[i].effective>a[i-1].effective,'armor-adjusted effective HP must increase');
  assert.ok(a[i].damage>a[i-1].damage,'damage must increase');
 }
});

test('M5.3.1 later multi-boss encounters preserve diversity and cyan Prism pool',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();const pool=getBossArchetypesForEncounter(4).map(b=>b.type);bossEncounterCount=3;wave=12;spawnBossEncounter();return JSON.stringify({count:activeBosses.length,types:activeBosses.map(b=>b.type),pool,sequence:[1,2,3,4,5,6,7].map(getBossCountForEncounter)});})()"));
 assert.deepEqual(a.sequence,[1,1,1,2,3,2,3]);
 assert.equal(a.count,2);assert.notEqual(a.types[0],a.types[1]);
 assert.deepEqual(a.pool,['BOSS_TITAN','BOSS_PRISM']);assert.notEqual(a.types[0],a.types[1]);
});

test('M5.3.1 new game resets boss order to orange armored Behemoth',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();wave=4;spawnBossEncounter();const initial=activeBosses[0].type;bossEncounterCount=3;startNewGame();const reset=bossEncounterCount;wave=4;spawnBossEncounter();return JSON.stringify({initial,reset,after:activeBosses[0].type,encounter:bossEncounterCount});})()"));
 assert.equal(a.initial,'BOSS_TITAN');assert.equal(a.reset,0);
 assert.equal(a.after,'BOSS_TITAN');assert.equal(a.encounter,1);
});

test('M5.3.1 original boss movement and defense mechanics remain in code',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=9;bossEncounterCount=2;return JSON.stringify(OPENING_BOSS_ORDER.map(type=>{const b=new Enemy(350,350,type);return {type,hp:b.maxHp,speed:b.speed,phase:b.bossPhase,timer:b.actionTimer};}));})()"));
 assert.deepEqual(x.map(b=>b.type),['BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID']);
 assert.ok(x.every(b=>b.hp>0&&b.speed>0&&b.phase===1&&b.timer===1.8));
 assert.match(html,/this\.type === 'BOSS_TITAN' && !isCrit/);
 assert.match(html,/this\.secondaryTimer <= 0 && \(!combatDirector \|\| combatDirector\.canBossReposition/);
});


test('M5.4 wave gates progressively unlock tactical formation families',()=>{
 const {run}=setup();
 const x=JSON.parse(run("JSON.stringify([3,7,8,9,10,12,13,20].map(w=>getSpecialEncounterKinds(w).map(p=>p.type)))"));
 assert.deepEqual(x[0],['PINCER','SPEARHEAD']);
 assert.deepEqual(x[1],['PINCER','SPEARHEAD','CORRIDOR']);
 assert.deepEqual(x[2],['PINCER','SPEARHEAD','ESCORT','CORRIDOR']);
 assert.equal(x[3].length,4);
 assert.deepEqual(x[4],['PINCER','SPEARHEAD','ESCORT','INTERCEPT','CORRIDOR']);
 assert.deepEqual(x[6],['PINCER','SPEARHEAD','ESCORT','INTERCEPT','CORRIDOR','BREACH','CROSSLOCK']);
 assert.deepEqual(x[7],[...x[6],'PINWHEEL']);
});

test('M5.4 invasion plans include visible attack roles, sides and exact threat costs',()=>{
 const {run}=setup();
 const x=JSON.parse(run("JSON.stringify([0,1,2,3,4,5,6].map(i=>getSpecialEncounterPlan(14,'SIEGE',1,i)).map(p=>({type:p.type,label:p.label,color:p.color,warning:p.warning,units:p.units,threatCost:p.threatCost,cost:p.units.reduce((v,u)=>v+ENEMY_THREAT_COST[u.type],0)})))"));
 assert.deepEqual(x.map(p=>p.type),['PINCER','SPEARHEAD','ESCORT','INTERCEPT','CORRIDOR','BREACH','CROSSLOCK']);
 assert.deepEqual(x[2].units.map(u=>u.type),['SWARM','SHIELD_BEARER','SNIPER','SWARM']);
 assert.deepEqual(x[3].units.map(u=>u.type),['DASHER','ASSASSIN','DASHER','SHOOTER']);
 assert.deepEqual(x[4].units.map(u=>u.type),['SHIELD_BEARER','SWARM','SHIELD_BEARER','SWARM']);
 assert.deepEqual(x[5].units.map(u=>u.type),['TANK','SPLITTER','GRAV_WELL','SWARM']);
 assert.deepEqual(x[6].units.map(u=>u.type),['SHOOTER','DASHER','SHOOTER','ASSASSIN']);
 assert.deepEqual([...new Set(x[3].units.map(u=>u.side))].sort(),[1,3]);
 for(const p of x){
  assert.ok(p.label.length>10);assert.match(p.color,/^#[0-9a-f]{6}$/i);
  assert.equal(p.warning,1.65);assert.ok(p.units.length<=4);
  assert.ok(p.units.every(u=>u.side>=0&&u.side<4&&u.slot<u.count));
  assert.ok(Math.abs(p.cost-p.threatCost)<.001);assert.ok(p.threatCost<=9);
 }
});

test('M5.4 new corridor and cross-lock patterns communicate distinct counterplay',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{const corridor=getSpecialEncounterPlan(8,'HUNT',0,3);const cross=getSpecialEncounterPlan(14,'HUNT',0,6);return JSON.stringify({corridor:{type:corridor.type,sides:corridor.units.map(u=>u.side),slots:corridor.units.map(u=>u.slot),roles:corridor.units.map(u=>u.type),cost:corridor.threatCost},cross:{type:cross.type,sides:[...new Set(cross.units.map(u=>u.side))].sort(),roles:cross.units.map(u=>u.type),cost:cross.threatCost}})})()"));
 assert.equal(x.corridor.type,'CORRIDOR');
 assert.deepEqual(x.corridor.sides,[0,0,2,2]);
 assert.deepEqual(x.corridor.slots,[0,2,0,2]);
 assert.deepEqual(x.corridor.roles,['SHIELD_BEARER','SWARM','SHIELD_BEARER','SWARM']);
 assert.ok(x.corridor.cost<=9);
 assert.equal(x.cross.type,'CROSSLOCK');
 assert.deepEqual(x.cross.sides,[0,1]);
 assert.deepEqual(x.cross.roles,['SHOOTER','DASHER','SHOOTER','ASSASSIN']);
 assert.ok(x.cross.cost<=9);
});

test('M5.4 Director gives each real formation a telegraph and spends only real spawn costs',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{const out=[];for(let i=0;i<7;i++){startNewGame();wave=14;totalTime=30;nextBossTime=500;combatDirector.encounterIndex=i;combatDirector.nextEncounterAt=0;combatDirector.tokens=14;combatDirector.update(.02);const p=combatDirector.pendingEncounter;const stopped=combatDirector.trySpawn();combatDirector.update(1.7);const d=combatDirector.getDiagnostics(),m=d.specialByKind[p.type];out.push({kind:p.type,stopped,spawned:enemies.length,offered:m.offered,resolved:m.resolved,units:m.units,spent:m.tokensSpent,cost:p.threatCost,old:d.specialEncounters});}return JSON.stringify(out);})()"));
 assert.deepEqual(a.map(x=>x.kind),['PINCER','SPEARHEAD','ESCORT','INTERCEPT','CORRIDOR','BREACH','CROSSLOCK']);
 for(const x of a){
  assert.equal(x.stopped,false);assert.equal(x.spawned,x.units);
  assert.ok(x.spawned>=3&&x.spawned<=4,x.kind);
  assert.equal(x.offered,1);assert.equal(x.resolved,1);
  assert.equal(x.spent,x.cost);assert.equal(x.old,1);
 }
});

test('M5.4 low budget and enemy cap continue to limit encounter spawning',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{const out=[];for(let i=2;i<=4;i++){startNewGame();wave=14;const p=getSpecialEncounterPlan(14,'HUNT',1,i);combatDirector.pendingEncounter=p;combatDirector.trackSpecialOffer(p);combatDirector.tokens=5;const amount=combatDirector.resolveSpecialEncounter();const stats=combatDirector.getDiagnostics().specialByKind[p.type];out.push({kind:p.type,amount,spawned:enemies.length,left:combatDirector.tokens,spent:stats.tokensSpent});}return JSON.stringify(out);})()"));
 for(const item of x){
  assert.equal(item.amount,item.spawned);
  assert.ok(item.amount>=1&&item.amount<4);
  assert.ok(item.left>=0);assert.ok(item.spent<=5);
 }
});

test('M5.4 imminent boss cancels a telegraphed encounter without any spawn or resource cost',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=14;totalTime=30;nextBossTime=500;combatDirector.tokens=14;combatDirector.encounterIndex=2;combatDirector.nextEncounterAt=0;combatDirector.update(.02);const p=combatDirector.pendingEncounter;nextBossTime=totalTime+6;combatDirector.update(.02);const stats=combatDirector.getDiagnostics();return JSON.stringify({kind:p.type,metric:stats.specialByKind[p.type],cancelled:stats.specialCancelled,spawn:enemies.length,pending:combatDirector.pendingEncounter});})()"));
 assert.equal(x.kind,'ESCORT');
 assert.equal(x.metric.offered,1);assert.equal(x.metric.cancelled,1);
 assert.equal(x.metric.units,0);assert.equal(x.metric.tokensSpent,0);
 assert.equal(x.cancelled,1);assert.equal(x.spawn,0);assert.equal(x.pending,null);
});

test('M5.4 boss start cancels a pending assault at most once',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=14;const p=getSpecialEncounterPlan(14,'HUNT',0,3);combatDirector.pendingEncounter=p;combatDirector.trackSpecialOffer(p);combatDirector.onBossEncounter();combatDirector.onBossEncounter();return JSON.stringify({cancelled:combatDirector.stats.specialByKind.INTERCEPT.cancelled,global:combatDirector.stats.specialCancelled,pending:combatDirector.pendingEncounter});})()"));
 assert.equal(x.cancelled,1);assert.equal(x.global,1);assert.equal(x.pending,null);
});

test('M5.4 telegraphed special formation names render without changing real enemy physics',()=>{
 const {run}=setup();
 assert.match(html,/ctx\.fillText\(plan\.label,worldWidth\/2/);
 const x=JSON.parse(run("(()=>{startNewGame();gameState='PLAYING';wave=14;combatDirector.pendingEncounter=getSpecialEncounterPlan(14,'HUNT',1,5);drawSpecialEncounterWarning();return JSON.stringify({type:combatDirector.pendingEncounter.type,name:combatDirector.pendingEncounter.label,sides:[...new Set(combatDirector.pendingEncounter.units.map(u=>u.side))]});})()"));
 assert.equal(x.type,'BREACH');assert.equal(x.name,'AĞIR HAT YARMA');
 assert.deepEqual(x.sides,[1,2]);
});

test('M5.4 all six late boss formations are named, diverse and have the same 2/3 boss cap',()=>{
 const {run}=setup();
 const x=JSON.parse(run("JSON.stringify([4,5,6,7,8,9,10,11].map(n=>({n,count:getBossCountForEncounter(n),plan:getBossEncounterPlan(n)})))"));
 assert.deepEqual(x.slice(0,6).map(p=>p.plan.id),['ARMOR_PRISM','VOID_CROSSFIRE','BREAKING_LINE','GRAVITY_NET','SIEGE_BEAMS','VOID_IRON']);
 for(const entry of x){
  assert.equal(entry.count,entry.plan.types.length,entry.n);
  assert.equal(new Set(entry.plan.types).size,entry.count);
  assert.ok(entry.plan.types.every(type=>['BOSS_DESTROYER','BOSS_TITAN','BOSS_VOID','BOSS_PRISM'].includes(type)));
 }
 assert.equal(x[6].plan.id,'ARMOR_PRISM');assert.equal(x[7].plan.id,'VOID_CROSSFIRE');
});

test('M5.4 first three fixed solo bosses are unaffected by late boss formations',()=>{
 const {run}=setup();
 const x=JSON.parse(run("JSON.stringify([1,2,3].map(n=>({count:getBossCountForEncounter(n),plan:getBossEncounterPlan(n)})))"));
 assert.deepEqual(x.map(y=>y.count),[1,1,1]);
 assert.deepEqual(x.map(y=>y.plan.types[0]),['BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID']);
 assert.deepEqual(x.map(y=>y.plan.id),['INTRO_1','INTRO_2','INTRO_3']);
});

test('M5.4 real late boss encounters keep one guaranteed chest per encounter and no duplicate type',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();bossEncounterCount=3;wave=14;const sets=[];for(let n=4;n<=9;n++){spawnBossEncounter();sets.push(activeBosses.map(b=>b.type));for(const b of [...activeBosses]){b.hp=1;b.takeDamage(9000,0,0,false,false);}}return JSON.stringify({sets,bossKills:combatDirector.stats.bossKills,chests:combatDirector.stats.chestDrops.boss,byPattern:combatDirector.stats.bossByPattern});})()"));
 assert.deepEqual(x.sets.map(s=>s.length),[2,3,2,3,2,3]);
 assert.ok(x.sets.every(s=>new Set(s).size===s.length));
 assert.equal(x.bossKills,15);assert.equal(x.chests,6);
 assert.equal(Object.keys(x.byPattern).length,6);
});

test('M5.4 late boss spawn still shares existing attack throttle and default phase',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=14;bossEncounterCount=3;spawnBossEncounter();const s=activeBosses.map(b=>({phase:b.bossPhase,hp:b.maxHp,speed:b.speed}));const a=combatDirector.allowBossAttack(activeBosses[0],'regular');const b=combatDirector.allowBossAttack(activeBosses[1],'regular');return JSON.stringify({s,a,b,deferred:combatDirector.stats.bossAttacksDeferred});})()"));
 assert.equal(x.s.length,2);assert.ok(x.s.every(b=>b.phase===1&&b.hp>0&&b.speed>0));
 assert.equal(x.a,true);assert.equal(x.b,false);assert.equal(x.deferred,1);
});

test('M5.4 formation and boss statistics are copy-safe and reset per run',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=14;totalTime=30;nextBossTime=500;combatDirector.encounterIndex=3;combatDirector.nextEncounterAt=0;combatDirector.tokens=14;combatDirector.update(.02);combatDirector.update(1.7);bossEncounterCount=3;spawnBossEncounter();const a=combatDirector.getDiagnostics();a.specialByKind.INTERCEPT.offered=999;a.bossByPattern.ARMOR_PRISM=999;const b=combatDirector.getDiagnostics();startNewGame();const c=combatDirector.getDiagnostics();return JSON.stringify({special:b.specialByKind.INTERCEPT.offered,boss:b.bossByPattern.ARMOR_PRISM,resetSpecial:c.specialByKind,resetBoss:c.bossByPattern,next:c.upcomingBossPattern});})()"));
 assert.equal(x.special,1);assert.equal(x.boss,1);
 assert.deepEqual(x.resetSpecial,{});assert.deepEqual(x.resetBoss,{});
 assert.equal(x.next,'INTRO_1');
});

test('M5.4 5/10/20/30-minute fixed-interval plan stress respects enemy/boss budgets',()=>{
 const {run}=setup();
 const x=JSON.parse(run("JSON.stringify([5,10,20,30].map(minutes=>{const w=Math.floor(minutes*60/16)+1;const plans=Array.from({length:Math.floor(minutes*60/39)},(_,i)=>getSpecialEncounterPlan(w,'HUNT',i%4,i));const bossPlans=Array.from({length:Math.floor(minutes*60/55)},(_,i)=>getBossEncounterPlan(i+1));return {minutes,types:[...new Set(plans.map(p=>p.type))],maxUnits:Math.max(...plans.map(p=>p.units.length)),maxThreat:Math.max(...plans.map(p=>p.threatCost)),maxBoss:Math.max(...bossPlans.map(p=>p.types.length)),unique:bossPlans.every(p=>new Set(p.types).size===p.types.length)};}))"));
 assert.deepEqual(x.map(i=>i.minutes),[5,10,20,30]);
 for(const p of x){
  assert.ok(p.maxUnits<=4);assert.ok(p.maxThreat<=9);
  assert.ok(p.maxBoss<=3);assert.equal(p.unique,true);
 }
 console.log('M5.4 fixed-interval plan stress, not real playtime: '+JSON.stringify(x));
});

test('multi-boss HUD exposes individual identity, phase and health rows',()=>{
 const {run}=setup();
 const htmlRows=run(`renderBossIdentityRows([
   {id:11,bossName:'ALPHA',bossVisual:{tag:'TITAN'},bossPhase:2,hp:500,maxHp:1000,color:'#ff8800'},
   {id:12,bossName:'BETA',bossVisual:{tag:'VOID'},bossPhase:1,hp:250,maxHp:1000,color:'#b000ff'},
   {id:13,bossName:'DEAD',bossVisual:{tag:'PRISM'},bossPhase:3,hp:0,maxHp:1000,color:'#00f3ff',dead:true}
 ])`);
 assert.match(htmlRows,/data-boss-id="11"/);
 assert.match(htmlRows,/data-boss-id="12"/);
 assert.doesNotMatch(htmlRows,/data-boss-id="13"/);
 assert.match(htmlRows,/50%/);
 assert.match(htmlRows,/25%/);
 assert.match(htmlRows,/F2/);
 assert.match(htmlRows,/F1/);
 assert.match(htmlRows,/aria-label="TITAN, Faz 2, HP 500 \/ 1000"/);
});

test('multi-boss target cycling gives players explicit target control',()=>{
 const {run}=setup();
 const x=JSON.parse(run(`(()=>{startNewGame();activeBosses=[
   {id:1,dead:false,x:100,y:100},
   {id:2,dead:false,x:200,y:100},
   {id:3,dead:false,x:300,y:100}
 ];
 const first=cycleBossTarget(1)?.id;
 const second=cycleBossTarget(1)?.id;
 const backwards=cycleBossTarget(-1)?.id;
 activeBosses[1].dead=true;
 const skipsDead=cycleBossTarget(1)?.id;
 return JSON.stringify({first,second,backwards,skipsDead,manual:manualBossTarget?.id});})()`));
 assert.deepEqual(x,{first:1,second:2,backwards:1,skipsDead:3,manual:3});
});

test('chassis atmosphere skins stay distinct and cosmetic-only',()=>{
 const {run}=setup();
 const x=JSON.parse(run("JSON.stringify(['VANGUARD','PHANTOM','TITAN'].map(c=>getChassisAtmosphereSkin(c)))"));
 assert.deepEqual(x.map(s=>s.id),['AURORA_GRID','VIOLET_GHOST','EMERALD_FURNACE']);
 assert.equal(new Set(x.map(s=>s.accent)).size,3);
 assert.ok(x.every(s=>/^#[0-9a-f]{6}$/i.test(s.accent)));
 assert.ok(x.every(s=>typeof s.label==='string'&&s.label.length>4));
});

test('neon contracts are selectable, bounded and only modify their declared run modifiers',()=>{
 const {run}=setup();
 const x=JSON.parse(run(`(()=>{const list=getNeonContractList();selectNeonContract('REDLINE');startNewGame();const active=getActiveNeonContract();const fast=new Enemy(0,0,'SWARM');return JSON.stringify({ids:list.map(c=>c.id),active:active.id,speed:fast.speed,base:fast.speed/getActiveNeonContract().enemySpeedMult,score:getActiveNeonContract().scoreMultiplier,label:active.label});})()`));
 assert.deepEqual(x.ids,['STANDARD','REDLINE','BLACKOUT','OVERCHARGE']);
 assert.equal(x.active,'REDLINE');
 assert.ok(x.speed>x.base);
 assert.ok(x.score>1&&x.score<=1.35);
 assert.ok(x.label.length>5);
});

test('contract mastery starts with four isolated cosmetic records',()=>{
 const {run}=setup();
 const out=JSON.parse(run("JSON.stringify({list:window.getNeonContractMastery(),markup:document.getElementById('neonContractOptions').innerHTML})"));
 assert.deepEqual(Object.keys(out.list),['STANDARD','REDLINE','BLACKOUT','OVERCHARGE']);
 assert.ok(Object.values(out.list).every(entry=>entry.runs===0&&entry.bestWave===0&&entry.bestScore===0&&entry.bestDurationSeconds===0));
 assert.match(out.markup,/USTALIK/);
 assert.match(out.markup,/DALGA/);
});

test('contract mastery records one completed run in the active bucket and remains defensive',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{selectNeonContract('REDLINE');startNewGame();wave=8;score=123;totalTime=95;triggerGameOver();const first=window.getNeonContractMastery();triggerGameOver();const second=window.getNeonContractMastery();first.REDLINE.bestWave=999;return JSON.stringify({first:second,after:window.getNeonContractMastery(),report:window.getNeonFinalReport().contract});})()"));
 assert.equal(out.first.REDLINE.runs,1);
 assert.equal(out.first.REDLINE.bestWave,8);
 assert.equal(out.first.REDLINE.bestScore,123);
 assert.equal(out.first.REDLINE.bestDurationSeconds,95);
 assert.equal(out.after.REDLINE.bestWave,8);
 assert.equal(out.after.STANDARD.runs,0);
 assert.equal(out.report.id,'REDLINE');
});

test('contract mastery sanitizes corrupt storage and persists independent progress',()=>{
 const stored={'neonCekirdek.contractMastery.v1':JSON.stringify({version:99,REDLINE:{runs:-4,bestWave:'oops'}})};
 const {run}=setup(stored);
 const out=JSON.parse(run("(()=>{const before=window.getNeonContractMastery();selectNeonContract('BLACKOUT');startNewGame();wave=16;score=400;totalTime=180;triggerGameOver();return JSON.stringify({before,after:window.getNeonContractMastery(),raw:localStorage.getItem('neonCekirdek.contractMastery.v1')});})()"));
 assert.equal(out.before.REDLINE.runs,0);
 assert.equal(out.after.BLACKOUT.runs,1);
 assert.equal(out.after.REDLINE.runs,0);
 assert.match(out.raw,/BLACKOUT/);
});

test('contract mastery ignores instant runs and exposes three wave tiers',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{selectNeonContract('STANDARD');startNewGame();wave=2;totalTime=29.999;triggerGameOver();const ignored=window.getNeonContractMastery().STANDARD;startNewGame();wave=8;totalTime=30;triggerGameOver();const tier1=getContractMasteryTier(window.getNeonContractMastery().STANDARD);startNewGame();wave=16;totalTime=40;triggerGameOver();const tier2=getContractMasteryTier(window.getNeonContractMastery().STANDARD);startNewGame();wave=24;totalTime=50;triggerGameOver();const tier3=getContractMasteryTier(window.getNeonContractMastery().STANDARD);return JSON.stringify({ignored,tier1,tier2,tier3});})()"));
 assert.equal(out.ignored.runs,0);
 assert.equal(out.tier1,1);
 assert.equal(out.tier2,2);
 assert.equal(out.tier3,3);
});

test('contract mastery requires both the minimum time and wave boundary',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{selectNeonContract('REDLINE');startNewGame();wave=3;totalTime=29.99;triggerGameOver();const short=window.getNeonContractMastery().REDLINE.runs;startNewGame();wave=2;totalTime=30;triggerGameOver();const lowWave=window.getNeonContractMastery().REDLINE.runs;startNewGame();wave=3;totalTime=30;triggerGameOver();const valid=window.getNeonContractMastery().REDLINE.runs;return JSON.stringify({short,lowWave,valid});})()"));
 assert.deepEqual(out,{short:0,lowWave:0,valid:1});
});

test('contract mastery storage failure never blocks a finished run',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{selectNeonContract('OVERCHARGE');startNewGame();wave=5;totalTime=60;const original=localStorage.setItem;localStorage.setItem=()=>{throw Error('denied')};triggerGameOver();localStorage.setItem=original;return JSON.stringify({state:gameState,runs:window.getNeonContractMastery().OVERCHARGE.runs,report:!!window.getNeonFinalReport()});})()"));
 assert.equal(out.state,'GAME_OVER');
 assert.equal(out.runs,1);
 assert.equal(out.report,true);
});


test('M5.5 new full-screen debrief has accessible responsive tabs and retained safe actions',()=>{
 assert.match(html,/id="gameOverModal"[^>]+role="dialog" aria-modal="true"/);
 for(const [key,name] of [['Summary','summary'],['Combat','combat'],['Build','build'],['Economy','economy'],['Objectives','objectives']]){
  assert.match(html,new RegExp('id="reportTab'+key+'"[^>]*data-report-tab="'+name+'"'));
  assert.match(html,new RegExp('id="report'+key+'Content"[^>]*role="tabpanel"'));
 }
 for(const id of ['restartBtn','backToMenuBtn','openShopFromOverBtn','finalScoreText','finalWaveText','finalTimeText','finalKillsText','finalGoldEarnedText','newRecordBadge']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/#gameOverModal\{overflow-y:auto/);
 assert.match(html,/@media\(max-width:720px\)/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
});

test('M5.5.1 final report does not exist before first actual game over',()=>{
 const {run}=setup();
 assert.equal(run("window.getNeonFinalReport()"),null);
 run("startNewGame()");
 assert.equal(run("window.getNeonFinalReport()"),null);
 assert.equal(run("gameState"),'PLAYING');
});

test('M5.5.1 report records run at death and captures true score, duration, balance and first record',()=>{
 const {run}=setup();
 const r=JSON.parse(run("(()=>{startNewGame();score=12750;wave=9;totalTime=243.5;kills=135;sessionGold=188;totalGold=266;triggerGameOver();return JSON.stringify(window.getNeonFinalReport());})()"));
 assert.equal(r.version,1);assert.equal(r.reason,'CORE_DEPLETED');
 assert.equal(r.newRecord,true);
 assert.equal(r.result.score,12750);assert.equal(r.result.wave,9);
 assert.equal(r.result.durationSeconds,243.5);assert.equal(r.result.kills,135);
 assert.equal(r.result.goldEarned,188);assert.equal(r.result.totalGoldBalance,266);
 assert.equal(run('gameState'),'GAME_OVER');
 assert.equal(run('savedHighScore'),12750);
});

test('M5.5.1 ending twice never changes frozen report or awards duplicate record',()=>{
 const {run}=setup();
 const value=JSON.parse(run("(()=>{startNewGame();score=123;triggerGameOver();const first=window.getNeonFinalReport();score=222;sessionGold=111;totalTime=900;combatDirector.stats.bossKills=20;triggerGameOver('REVIVE_DECLINED');return JSON.stringify({before:first,after:window.getNeonFinalReport(),score:savedHighScore});})()"));
 assert.deepEqual(value.after,value.before);
 assert.equal(value.before.result.score,123);
 assert.equal(value.before.combat.bossKills,0);
 assert.equal(value.score,123);
});

test('M5.5.1 final report getter copies arrays and nested counters defensively',()=>{
 const {run}=setup();
 const data=JSON.parse(run("(()=>{startNewGame();wave=8;player.upgradeCounts={firerate:3};player.refreshBuildTraits();questStats.byType.NO_HIT=2;combatDirector.stats.goldBySource.quests=35;combatDirector.stats.arenaByKind.RELAY={offered:2,completed:1,expired:1,cancelled:0};triggerGameOver();const copy=window.getNeonFinalReport();copy.missions.byType.NO_HIT=900;copy.economy.goldBySource.quests=900;copy.arena.byKind.RELAY.completed=900;copy.build.modules[0].tier=900;return JSON.stringify(window.getNeonFinalReport());})()"));
 assert.equal(data.missions.byType.NO_HIT,2);
 assert.equal(data.economy.goldBySource.quests,35);
 assert.equal(data.arena.byKind.RELAY.completed,1);
 assert.equal(data.build.modules[0].tier,3);
});

test('M5.5.1 damage and shield reporting count only real lost HP',()=>{
 const {run}=setup();
 const r=JSON.parse(run("(()=>{startNewGame();player.hasShield=true;player.shieldActive=true;player.invulnTimer=0;player.takeDamage(30);const blockHp=player.hp;player.invulnTimer=0;player.shieldActive=false;player.takeDamage(13);const after=player.hp;player.takeDamage(20);const blockedByIframes=player.hp;triggerGameOver();return JSON.stringify({blockHp,after,blockedByIframes,report:window.getNeonFinalReport().combat});})()"));
 assert.ok(r.blockHp>r.after);assert.equal(r.after,r.blockedByIframes);
 assert.equal(r.report.shieldBlocks,1);
 assert.equal(r.report.hitsTaken,1);
 assert.equal(r.report.damageTaken,13);
});

test('M5.5.1 peak combo captures actual kill streak before it resets',()=>{
 const {run}=setup();
 const r=JSON.parse(run("(()=>{startNewGame();wave=2;for(let i=0;i<7;i++){const e=new Enemy(100,100,'SWARM');e.die();}const peak=combo;combo=1;triggerGameOver();return JSON.stringify({peak,reported:window.getNeonFinalReport().combat.peakCombo,killCount:window.getNeonFinalReport().result.kills});})()"));
 assert.equal(r.peak,8);assert.equal(r.reported,8);assert.equal(r.killCount,7);
});

// Odak 4.4 · one paid revive per run, priced 60 + 10 × wave; the second attempt ends the run.
test('M5.5.1 paid revives log actual gold cost and do not invent run income',()=>{
 const {run}=setup();
 const r=JSON.parse(run("(()=>{startNewGame();wave=4;player.freeRevives=0;totalGold=200;gameState='REVIVE_PROMPT';executePlayerRevive();const after=gameState;gameState='REVIVE_PROMPT';executePlayerRevive();return JSON.stringify({after,end:gameState,report:window.getNeonFinalReport(),gold:totalGold});})()"));
 assert.equal(r.after,'PLAYING');
 assert.equal(r.end,'GAME_OVER');
 assert.equal(r.report.combat.paidRevivesUsed,1);
 assert.equal(r.report.combat.freeRevivesUsed,0);
 assert.equal(r.report.combat.paidReviveGoldSpent,100);
 assert.equal(r.gold,100);
 assert.equal(r.report.result.goldEarned,0);
 assert.equal(r.report.result.totalGoldBalance,100);
});

test('M5.5.1 free revive and rejected second revive preserve explicit end reason',()=>{
 const {run}=setup();
 const r=JSON.parse(run("(()=>{startNewGame();gameState='REVIVE_PROMPT';executePlayerRevive();gameState='REVIVE_PROMPT';triggerGameOver('REVIVE_DECLINED');return JSON.stringify(window.getNeonFinalReport());})()"));
 assert.equal(r.reason,'REVIVE_DECLINED');
 assert.equal(r.combat.freeRevivesUsed,1);
 assert.equal(r.combat.paidRevivesUsed,0);
 assert.equal(run("document.getElementById('reportRunStatus').textContent"),'DİRİLİŞ REDDEDİLDİ');
});

test('M5.5.3 report aggregates gold sources and chest rewards without altering ledger',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();const d=combatDirector.stats;Object.assign(d.goldBySource,{orbs:28,quests:36,arena:41,chests:75});Object.assign(d.chestDrops,{elite:3,boss:2});Object.assign(d.chestOpened,{goldHeal:2,overdriveXp:1,bulletNova:1});d.chestRewards.elite.opened=3;d.chestRewards.elite.gold=60;d.chestRewards.boss.opened=1;d.chestRewards.boss.gold=15;sessionGold=180;triggerGameOver();return JSON.stringify({report:window.getNeonFinalReport(),html:document.getElementById('reportEconomyContent').innerHTML});})()"));
 assert.deepEqual(a.report.economy.goldBySource,{orbs:28,quests:36,arena:41,chests:75});
 assert.equal(a.report.result.goldEarned,180);
 assert.equal(a.report.economy.chestDrops.elite,3);
 assert.equal(a.report.economy.chestRewards.elite.gold,60);
 assert.match(a.html,/Altın küreler/);
 assert.match(a.html,/Sandık ödülleri/);
 assert.match(a.html,/SANDIK ÖDÜL DETAYI/);
});

test('M5.5.3 report shows exact build module tiers, evolution and synergy names',()=>{
 const {run}=setup();
 const r=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts={firerate:3,multishot:2};player.refreshBuildTraits();triggerGameOver();return JSON.stringify({model:window.getNeonFinalReport().build,html:document.getElementById('reportBuildContent').innerHTML});})()"));
 assert.equal(r.model.modules.find(m=>m.id==='firerate').tier,3);
 assert.equal(r.model.totalTiers,5);
 assert.ok(r.model.evolutions.length>0);
 assert.ok(r.model.synergies.length>=0);
 assert.match(r.html,/MODÜL YÜKLERİ/);
 assert.match(r.html,/AKTİF EVRİMLER/);
 assert.match(r.html,/K3/);
});

test('M5.5.3 mission, arena and boss reports preserve exact completed/denied breakdown',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();questStats.offered=7;questStats.completed=4;questStats.byType.KILLS=3;questStats.byType.DEFEND=1;const d=combatDirector.stats;d.arenaOffered=3;d.arenaCompleted=1;d.arenaExpired=1;d.arenaCancelled=1;d.arenaByKind.STORM={offered:3,completed:1,expired:1,cancelled:1};d.bossByPattern.ARMOR_PRISM=2;triggerGameOver();return JSON.stringify({report:window.getNeonFinalReport(),html:document.getElementById('reportObjectivesContent').innerHTML});})()"));
 assert.equal(a.report.missions.completed,4);
 assert.equal(a.report.arena.completed,1);
 assert.equal(a.report.arena.byKind.STORM.cancelled,1);
 assert.equal(a.report.encounters.bossByPattern.ARMOR_PRISM,2);
 assert.match(a.html,/57%/);
 assert.match(a.html,/ENERJİ FIRTINASI/);
 assert.match(a.html,/ARMOR PRISM/);
});

test('M5.5.4 tab navigation accepts known tabs, sets ARIA and never mutates the report',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();triggerGameOver();const original=JSON.stringify(window.getNeonFinalReport());const first=showRunReportTab('build'),selected=document.getElementById('reportTabBuild')._attrs['aria-selected'],other=document.getElementById('reportTabSummary')._attrs['aria-selected'];const invalid=showRunReportTab('wat');const final=JSON.stringify(window.getNeonFinalReport());return JSON.stringify({first,selected,other,invalid,activeReportTab,same:original===final});})()"));
 assert.equal(a.first,true);assert.equal(a.selected,'true');assert.equal(a.other,'false');
 assert.equal(a.invalid,false);assert.equal(a.activeReportTab,'build');assert.equal(a.same,true);
});

test('M5.5.4 empty run has clear messages rather than invented DPS or nonexistent arena data',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();triggerGameOver();return JSON.stringify({summary:document.getElementById('reportSummaryContent').innerHTML,combat:document.getElementById('reportCombatContent').innerHTML,build:document.getElementById('reportBuildContent').innerHTML,objectives:document.getElementById('reportObjectivesContent').innerHTML});})()"));
 assert.match(d.summary,/DPS takibi henüz bulunmuyor/);
 assert.match(d.combat,/ayrı bir gelişmiş silah etkisi tetiklenmedi/);
 assert.match(d.build,/yükseltme modülü seçilmedi/);
 assert.match(d.objectives,/henüz tamamlanan görev yok/);
 assert.match(d.objectives,/arena etkinliği henüz sunulmadı/);
});

test('M5.5.4 HTML escaping prevents untrusted snapshot labels from injecting markup',()=>{
 const {run}=setup();
 const sanitized=run("reportEscape('<img src=x onerror=alert(1)>&\\\"')");
 assert.equal(sanitized,'&lt;img src=x onerror=alert(1)&gt;&amp;&quot;');
 const built=run("reportPair('<script>','5&6')");
 assert.match(built,/&lt;script&gt;/);
 assert.doesNotMatch(built,/<script>/);
});

test('M5.5.4 switching menu and shop keeps report frozen until the next run resets',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();score=999;triggerGameOver();openShop('GAME_OVER');closeShop();const saved=window.getNeonFinalReport().result.score;returnToMainMenu();const inMenu=window.getNeonFinalReport().result.score;startNewGame();return JSON.stringify({saved,inMenu,next:window.getNeonFinalReport(),state:gameState});})()"));
 assert.equal(a.saved,999);assert.equal(a.inMenu,999);
 assert.equal(a.next,null);assert.equal(a.state,'PLAYING');
});

test('M5.5.4 short/long run numeric formatting, meters and insights stay bounded',()=>{
 const {run}=setup();
 const a=JSON.parse(run("(()=>{startNewGame();const m=reportMeter('Sınır',1000,4);const n=reportNumber(123456);const i=getRunReportInsights({missions:{offered:8,completed:1},arena:{offered:3,completed:0},economy:{goldBySource:{chests:80,quests:20}},combat:{bossKills:1,hitsTaken:12},build:{evolutions:['A','B']},result:{bossEncounters:2}});return JSON.stringify({m,n,i});})()"));
 assert.match(a.m,/width:100\.0%/);
 assert.match(a.n,/123/);
 assert.ok(a.i.length<=3);
 assert.ok(a.i.some(x=>x.title==='EN GÜÇLÜ GELİR KAYNAĞI'));
});



test('M6.1.1 held P/Escape cannot rapidly toggle pause; pause clears movement', () => {
  const { run, windowEvent } = setup();
  run('startNewGame()');
  windowEvent('keydown', { code: 'KeyW' });
  assert.equal(run('keys.KeyW'), true);
  windowEvent('keydown', { code: 'KeyP' });
  assert.equal(run('gameState'), 'PAUSED');
  assert.equal(run('!!keys.KeyW'), false);
  windowEvent('keydown', { code: 'KeyP', repeat: true });
  assert.equal(run('gameState'), 'PAUSED');
  windowEvent('keyup', { code: 'KeyP' });
  windowEvent('keydown', { code: 'Escape' });
  assert.equal(run('gameState'), 'PLAYING');
});

test('M6.1.1 window blur and hidden tab pause a real run without stuck keys', () => {
  const { run, windowEvent, documentEvent } = setup();
  run('startNewGame()');
  windowEvent('keydown', { code: 'ArrowRight' });
  windowEvent('blur');
  assert.equal(run('gameState'), 'PAUSED');
  assert.equal(run('!!keys.ArrowRight || mouse.active'), false);
  run('togglePause()');
  windowEvent('keydown', { code: 'KeyD' });
  run('document.hidden=true');
  documentEvent('visibilitychange');
  assert.equal(run('gameState'), 'PAUSED');
  assert.equal(run('!!keys.KeyD'), false);
  documentEvent('visibilitychange');
  assert.equal(run('gameState'), 'PAUSED');
});

test('M6.1.1 touch release/cancel stops movement and menu touches do not latch', () => {
  const { run, canvasEvent } = setup();
  run('startNewGame()');
  const finger = (x, y) => ({ identifier: 1, clientX: x, clientY: y });
  canvasEvent('touchstart', { touches: [finger(350, 250)], changedTouches: [finger(350, 250)] });
  assert.equal(run('touchStick.id'), 1);
  canvasEvent('touchend', { touches: [], changedTouches: [finger(350, 250)] });
  assert.equal(run('touchStick.id'), null);
  canvasEvent('touchstart', { touches: [finger(420, 290)], changedTouches: [finger(420, 290)] });
  assert.equal(run('touchStick.id'), 1);
  canvasEvent('touchcancel');
  assert.equal(run('touchStick.id === null && !mouse.active'), true);
  run("gameState='MENU'");
  canvasEvent('touchstart', { touches: [finger(420, 290)], changedTouches: [finger(420, 290)] });
  assert.equal(run('touchStick.id === null && !mouse.active'), true);
});

test('Odak 2.3 relative joystick: dead zone, full tilt at 56 px and left 60% zone', () => {
  const { run, canvasEvent } = setup();
  run('startNewGame(); enemies=[]; player.x=400; player.y=300; player.lastPos.x=400; player.lastPos.y=300');
  assert.equal(run('touchMoveMode'), 'joystick');
  const at = (x, y, id = 1) => ({ identifier: id, clientX: x, clientY: y });
  // Right 40% of a 1280 px wide screen is not a joystick zone.
  canvasEvent('touchstart', { touches: [at(900, 300)], changedTouches: [at(900, 300)] });
  assert.equal(run('touchStick.id'), null);
  canvasEvent('touchstart', { touches: [at(200, 500)], changedTouches: [at(200, 500)] });
  assert.deepEqual(Array.from(run('[touchStick.originX, touchStick.originY]')), [200, 500]);
  // Inside the 8 px dead zone the core holds still.
  canvasEvent('touchmove', { touches: [at(206, 500)], changedTouches: [at(206, 500)] });
  assert.equal(run('touchStickVector().power'), 0);
  assert.equal(run('player.update(.1); player.x'), 400);
  // Half way and full tilt; the core moves, it does not jump to the finger.
  canvasEvent('touchmove', { touches: [at(232, 500)], changedTouches: [at(232, 500)] });
  assert.equal(run('touchStickVector().power'), .5);
  canvasEvent('touchmove', { touches: [at(256, 500)], changedTouches: [at(256, 500)] });
  assert.equal(run('touchStickVector().power'), 1);
  canvasEvent('touchmove', { touches: [at(400, 500)], changedTouches: [at(400, 500)] });
  assert.equal(run('touchStickVector().power'), 1);
  const moved = run('const x0=player.x; player.update(.1); ({dx:player.x-x0, speed:player.speed, y:player.y})');
  assert.ok(Math.abs(moved.dx - moved.speed * .1) < 1e-6, JSON.stringify(moved));
  assert.equal(moved.y, 300);
  assert.equal(run('mouse.active'), false);
});

test('Odak 2.3 a second finger on an ability does not steal or stop the joystick', () => {
  const { run, canvasEvent } = setup();
  run('startNewGame(); enemies=[]');
  const at = (x, y, id) => ({ identifier: id, clientX: x, clientY: y });
  canvasEvent('touchstart', { touches: [at(100, 400, 7)], changedTouches: [at(100, 400, 7)] });
  canvasEvent('touchmove', { touches: [at(160, 400, 7)], changedTouches: [at(160, 400, 7)] });
  // A second finger lands (even inside the zone) while the first is down.
  canvasEvent('touchstart', { touches: [at(100, 400, 7), at(120, 200, 8)], changedTouches: [at(120, 200, 8)] });
  assert.equal(run('touchStick.id'), 7);
  canvasEvent('touchmove', { touches: [at(160, 400, 7), at(10, 10, 8)], changedTouches: [at(10, 10, 8)] });
  assert.deepEqual(Array.from(run('[touchStick.x, touchStick.y]')), [160, 400]);
  canvasEvent('touchend', { touches: [at(160, 400, 7)], changedTouches: [at(10, 10, 8)] });
  assert.equal(run('touchStick.id'), 7);
  // Touch fires the ability on pointerdown; the click that may follow is swallowed.
  run("globalThis.novaHits=0; player.triggerNova=()=>novaHits++");
  run("document.getElementById('novaBtn').dispatch('pointerdown', { pointerType: 'touch' })");
  run("document.getElementById('novaBtn').click()");
  run("document.getElementById('novaBtn').dispatch('pointerdown', { pointerType: 'mouse' })");
  assert.equal(run('novaHits'), 1);
  assert.equal(run('touchStick.id === 7 && touchStickVector().power === 1'), true);
  canvasEvent('touchend', { touches: [], changedTouches: [at(160, 400, 7)] });
  assert.equal(run('touchStick.id'), null);
});

test('Odak 2.3 "follow finger" keeps the old absolute target and the choice persists', () => {
  const a = setup();
  a.run('startNewGame()');
  a.run("document.getElementById('pauseTouchMode').dispatch('change', { target: { value: 'follow' } })");
  assert.equal(a.run('touchMoveMode'), 'follow');
  assert.equal(a.stored['neonCekirdek.touchMode.v1'], 'follow');
  const at = (x, y) => ({ identifier: 3, clientX: x, clientY: y });
  // Follow mode accepts the whole screen, like before.
  a.canvasEvent('touchstart', { touches: [at(1000, 250)], changedTouches: [at(1000, 250)] });
  assert.equal(a.run('mouse.active'), true);
  assert.deepEqual(Array.from(a.run('[mouse.x * viewScale, mouse.y * viewScale]'), Math.round), [1000, 250]);
  assert.equal(a.run('touchStickVector()'), null);
  a.canvasEvent('touchend', { touches: [], changedTouches: [at(1000, 250)] });
  assert.equal(a.run('mouse.active'), false);
  assert.equal(setup(a.stored).run('touchMoveMode'), 'follow');
  assert.equal(setup({ 'neonCekirdek.touchMode.v1': 'teleport' }).run('touchMoveMode'), 'joystick');
});

test('M6.1.1 native revive decision button keeps Enter/Space, ambient Enter revives', () => {
  const a = setup();
  a.run('startNewGame(); showRevivePromptOrGameOver()');
  assert.equal(a.run('gameState'), 'REVIVE_PROMPT');
  const focusedButton = { closest: () => ({ tagName: 'BUTTON' }) };
  a.windowEvent('keydown', { code: 'Enter', target: focusedButton });
  a.windowEvent('keydown', { code: 'Space', target: focusedButton });
  assert.equal(a.run('gameState'), 'REVIVE_PROMPT');
  a.run("document.getElementById('declineReviveBtn').click()");
  assert.equal(a.run('gameState'), 'GAME_OVER');
  assert.equal(a.run('finalRunReport.reason'), 'REVIVE_DECLINED');
  const b = setup();
  b.run('startNewGame(); showRevivePromptOrGameOver()');
  b.windowEvent('keydown', { code: 'Enter' });
  assert.equal(b.run('gameState'), 'PLAYING');
});

test('M6.1.1 reroll executes once on keydown, not for OS key repeat', () => {
  const { run, windowEvent } = setup();
  run('startNewGame(); totalGold=250; triggerLevelUp()');
  const costBefore = run('totalGold');
  windowEvent('keydown', { code: 'KeyR', repeat: true });
  assert.equal(run('totalGold'), costBefore);
  windowEvent('keydown', { code: 'KeyR' });
  assert.equal(run('totalGold'), costBefore - 15);
  windowEvent('keydown', { code: 'KeyR', repeat: true });
  assert.equal(run('totalGold'), costBefore - 15);
});

test('M6.1.1 new run resets held keys, mouse, and menu keyboard input', () => {
  const { run, windowEvent, canvasEvent } = setup();
  windowEvent('keydown', { code: 'KeyW' });
  assert.equal(run('!!keys.KeyW'), false);
  run('startNewGame()');
  windowEvent('keydown', { code: 'KeyW' });
  canvasEvent('mousemove', { clientX: 410, clientY: 310 });
  assert.equal(run('mouse.active && keys.KeyW'), true);
  run('startNewGame()');
  assert.equal(run('mouse.active || !!keys.KeyW'), false);
  canvasEvent('mousemove', { clientX: 410, clientY: 310,
    sourceCapabilities: { firesTouchEvents: true } });
  assert.equal(run('mouse.active'), false);
});


test('M6.2.1 compact and desktop render DPR obey fixed pixel budgets', () => {
  const { run } = setup();
  const v = JSON.parse(run(`JSON.stringify({
    phone: getRenderDpr(390, 844, 3),
    tablet: getRenderDpr(820, 1180, 3),
    desktop: getRenderDpr(1920, 1080, 2),
    lowDensity: getRenderDpr(1280, 720, 1),
    fourK: getRenderDpr(3840, 2160, 2),
    invalid: getRenderDpr(390, 844, 0)
  })`));
  assert.equal(v.phone, 1.75);
  assert.ok(820 * 1180 * v.tablet ** 2 <= 1800001);
  assert.ok(1920 * 1080 * v.desktop ** 2 <= 6000001);
  assert.equal(v.lowDensity, 1);
  assert.ok(3840 * 2160 * v.fourK ** 2 <= 6000001);
  assert.equal(v.invalid, 1);
});

test('M6.2.1 backing canvas shrinks on high-DPR phone without altering world or CSS size', () => {
  const { run } = setup();
  const result = JSON.parse(run(`(() => {
    document.documentElement.clientWidth = 390;
    document.documentElement.clientHeight = 844;
    window.devicePixelRatio = 1;
    resizeCanvas();
    const baseline = { worldWidth, worldHeight, viewScale };
    window.devicePixelRatio = 3;
    resizeCanvas();
    return JSON.stringify({ baseline,
      logical: { worldWidth, worldHeight, viewScale },
      width: canvas.width, height: canvas.height,
      cssWidth: canvas.style.width, cssHeight: canvas.style.height,
      dpr: currentDpr, miB: window.getNeonPerformanceSnapshot().canvasBufferMiB });
  })()`));
  assert.equal(result.logical.worldWidth, result.baseline.worldWidth);
  assert.equal(result.logical.worldHeight, result.baseline.worldHeight);
  assert.equal(result.logical.viewScale, result.baseline.viewScale);
  assert.equal(result.cssWidth, '390px');
  assert.equal(result.cssHeight, '844px');
  assert.equal(result.dpr, 1.75);
  assert.ok(result.width * result.height <= 1800000);
  assert.ok(result.miB < 4);
});

test('M6.2.1 rolling frame stats produce real average and P95 without gameplay mutations', () => {
  const { run } = setup();
  const result = JSON.parse(run(`(() => {
    togglePerformanceOverlay();
    gameState = 'PAUSED';
    lastFrameTime = 0;
    let now = 0;
    for (const delta of [10, 10, 15, 40]) {
      now += delta;
      gameLoop(now);
    }
    return JSON.stringify({ frame: window.getNeonPerformanceSnapshot().frame,
      state: gameState, recent: perfRecentFrameCount,
      overlay: performanceOverlayOn });
  })()`));
  assert.equal(result.frame.sampleCount, 4);
  assert.ok(Math.abs(result.frame.avgMs - 18.75) < 0.001);
  assert.equal(result.frame.p95Ms, 40);
  assert.equal(result.state, 'PAUSED');
  assert.equal(result.recent, 4);
  assert.equal(result.overlay, true);
});

test('M6.2.1 mobile ?perf=1 opt-in is isolated from normal game startup', () => {
  const { run } = setup();
  assert.equal(run('performanceOverlayOn'), false);
  assert.equal(run("window.location={search:'?perf=1'}; shouldShowPerformanceOverlay()"), true);
  assert.equal(run("window.location={search:'?x=1&perf=1&y=2'}; shouldShowPerformanceOverlay()"), true);
  assert.equal(run("window.location={search:'?perf=10'}; shouldShowPerformanceOverlay()"), false);
  assert.equal(run('window.getNeonPerformanceSnapshot().frame.sampleCount'), 0);
});


test('M6.2.2 collision bucket is reused across frames without stale coordinates', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    bullets = [{ x: 12, y: 24, radius: 5, dead: false }];
    buildBulletCollisionGrid();
    const oldBucket = bulletCollisionGrid.get('0,0');
    const oldHits = getNearbyBulletIndices(12, 24, 8);
    bullets[0].x = 400;
    bullets[0].y = 200;
    buildBulletCollisionGrid();
    return JSON.stringify({
      reused: bulletCollisionGrid.get('4,2') === oldBucket,
      oldHits, oldCellPresent: bulletCollisionGrid.has('0,0'),
      staleHits: getNearbyBulletIndices(12, 24, 8),
      currentHits: getNearbyBulletIndices(400, 200, 8),
      pool: bulletGridCellPool.length
    });
  })()`));
  assert.equal(data.reused, true);
  assert.deepEqual(data.oldHits, [0]);
  assert.equal(data.oldCellPresent, false);
  assert.deepEqual(data.staleHits, []);
  assert.deepEqual(data.currentHits, [0]);
  assert.equal(data.pool, 0);
});

test('M6.2.2 collision query scratch stays sorted, reusable and independent by default', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    bullets = [
      { x: 20, y: 20, radius: 6, dead: false },
      { x: 22, y: 22, radius: 6, dead: false },
      { x: 380, y: 20, radius: 6, dead: false }
    ];
    buildBulletCollisionGrid();
    const scratch = ['previous', 999];
    const first = getNearbyBulletIndices(20, 20, 10, scratch).slice();
    const sameIdentity = getNearbyBulletIndices(380, 20, 10, scratch) === scratch;
    const second = scratch.slice();
    const directA = getNearbyBulletIndices(20, 20, 10);
    const directB = getNearbyBulletIndices(20, 20, 10);
    return JSON.stringify({ first, second, sameIdentity,
      directA, directB, independent: directA !== directB });
  })()`));
  assert.deepEqual(data.first, [1, 0], 'reverse original projectile order is preserved');
  assert.deepEqual(data.second, [2], 'old candidates are discarded between enemies');
  assert.equal(data.sameIdentity, true);
  assert.deepEqual(data.directA, [1, 0]);
  assert.deepEqual(data.directB, [1, 0]);
  assert.equal(data.independent, true, 'legacy/direct callers receive separate arrays');
});

test('M6.2.2 collision cell pool remains bounded through moving dense volleys', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    bullets = Array.from({ length: 400 }, (_, i) =>
      ({ x: (i * 101) % 2800, y: (i * 67) % 1900, radius: 5, dead: false }));
    let highestPool = 0;
    let largestGrid = 0;
    for (let step = 0; step < 180; step++) {
      for (const b of bullets) {
        b.x = (b.x + 37) % 2800;
        b.y = (b.y + 19) % 1900;
      }
      buildBulletCollisionGrid();
      highestPool = Math.max(highestPool, bulletGridCellPool.length);
      largestGrid = Math.max(largestGrid, bulletCollisionGrid.size);
      if (bulletGridCellPool.length > MAX_PLAYER_PROJECTILES) throw Error('unbounded pool');
    }
    return JSON.stringify({ highestPool, largestGrid,
      finalCells: bulletCollisionGrid.size, playerCap: MAX_PLAYER_PROJECTILES,
      valid: getNearbyBulletIndices(bullets[3].x, bullets[3].y, 10).includes(3) });
  })()`));
  assert.ok(data.highestPool <= data.playerCap);
  assert.ok(data.largestGrid <= 400);
  assert.ok(data.finalCells > 0);
  assert.equal(data.valid, true);
});

test('M6.2.2 dying projectiles are not revived by the recycled bucket cache', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    bullets = [
      { x: 48, y: 48, radius: 12, dead: false },
      { x: 500, y: 500, radius: 6, dead: false }
    ];
    buildBulletCollisionGrid();
    const start = getNearbyBulletIndices(48, 48, 16);
    bullets[0].dead = true;
    buildBulletCollisionGrid();
    return JSON.stringify({ start,
      removed: getNearbyBulletIndices(48, 48, 16),
      survivor: getNearbyBulletIndices(500, 500, 10),
      maxRadius: largestBulletRadius });
  })()`));
  assert.deepEqual(data.start, [0]);
  assert.deepEqual(data.removed, []);
  assert.deepEqual(data.survivor, [1]);
  assert.equal(data.maxRadius, 6);
});


test('M6.2-PC2 straight grid extends to the visible arena edge with two path points', () => {
  const trace = [];
  const context = new Proxy({}, {
    get(_, key) { return (...args) => { trace.push({ kind: String(key), args }); }; }
  });
  const { run } = setup({}, { canvasContext: context });
  trace.length = 0;
  const result = JSON.parse(run(`(() => {
    worldWidth = 100; worldHeight = 81; gridOffset.x = -5; gridOffset.y = 7;
    shockwaves = [];
    drawBackgroundGrid();
    return JSON.stringify({ waveCount: shockwaves.length, worldWidth, worldHeight });
  })()`));
  assert.equal(result.waveCount, 0);
  const moves = trace.filter(t => t.kind === 'moveTo').map(t => t.args);
  const lines = trace.filter(t => t.kind === 'lineTo').map(t => t.args);
  assert.deepEqual(moves, [[-5, 0], [43, 0], [91, 0], [0, 7], [0, 55]]);
  assert.deepEqual(lines, [[-5, 81], [43, 81], [91, 81], [100, 7], [100, 55]]);
  assert.equal(trace.filter(t => t.kind === 'stroke').length, 5);
  assert.equal(trace.filter(t => t.kind === 'beginPath').length, 5);
});

test('M6.2-PC2 active shockwave retains dense distorted grid sampling', () => {
  const trace = [];
  const context = new Proxy({}, {
    get(_, key) { return (...args) => { trace.push({ kind: String(key), args }); }; }
  });
  const { run } = setup({}, { canvasContext: context });
  trace.length = 0;
  const state = JSON.parse(run(`(() => {
    startNewGame();
    worldWidth = 100; worldHeight = 81;
    gridOffset.x = -5; gridOffset.y = 7;
    const before = { hp: player.hp, gold: totalGold, kills };
    shockwaves = [{ x: 35, y: 20, maxRadius: 110, elapsed: .2, duration: .4 }];
    drawBackgroundGrid();
    return JSON.stringify({ before, after: { hp: player.hp, gold: totalGold, kills } });
  })()`));
  assert.deepEqual(state.after, state.before);
  assert.ok(trace.filter(t => t.kind === 'lineTo').length > 5,
    'shockwave path keeps original 32px subdivision and distortion');
  assert.equal(trace.filter(t => t.kind === 'stroke').length, 5);
});

test('M6.2-PC2 atmosphere palettes are stable immutable records with unchanged danger priority', () => {
  const { run } = setup();
  const state = JSON.parse(run(`JSON.stringify({
    repeat: getArenaAtmosphereProfile('CRISIS', false) ===
      getArenaAtmosphereProfile('CRISIS', false),
    frozen: Object.isFrozen(getArenaAtmosphereProfile('CRISIS', false)),
    bossOverrides: getArenaAtmosphereProfile('BOSS', true).id,
    warningOverrides: getArenaAtmosphereProfile('WARNING', true).id,
    overdrive: getArenaAtmosphereProfile('PRESSURE', true).id,
    crisis: getArenaAtmosphereProfile('CRISIS', false)
  })`));
  assert.equal(state.repeat, true);
  assert.equal(state.frozen, true);
  assert.equal(state.bossOverrides, 'danger');
  assert.equal(state.warningOverrides, 'danger');
  assert.equal(state.overdrive, 'overdrive');
  assert.deepEqual(state.crisis, {
    id: 'crisis', color: '#f4a44b', accent: '#ff6277', strength: 0.68, speed: 1.6
  });
});

test('M6.2-PC2 stable boss HUD skips expensive markup and gradient DOM writes', () => {
  const { run } = setup();
  const state = JSON.parse(run(`(() => {
    startNewGame();
    const strip = document.getElementById('bossIdentityStrip');
    const bar = document.getElementById('bossHpBar');
    const dash = document.getElementById('dashStatus');
    const nova = document.getElementById('novaStatus');
    let htmlWrites = 0, gradientWrites = 0, dashClassWrites = 0, novaClassWrites = 0;
    let markup = '', gradient = '', dashClass = '', novaClass = '';
    Object.defineProperty(strip, 'innerHTML', {
      get() { return markup; }, set(v) { htmlWrites++; markup = v; }, configurable: true
    });
    Object.defineProperty(bar.style, 'background', {
      get() { return 'browser-normalized:' + gradient; },
      set(v) { gradientWrites++; gradient = v; }, configurable: true
    });
    for (const [el, kind] of [[dash, 'dash'], [nova, 'nova']]) {
      Object.defineProperty(el, 'className', {
        get() { return kind === 'dash' ? dashClass : novaClass; },
        set(v) {
          if (kind === 'dash') { dashClassWrites++; dashClass = v; }
          else { novaClassWrites++; novaClass = v; }
        }, configurable: true
      });
    }
    activeBosses = [{
      dead: false, hp: 120, maxHp: 150, bossName: 'TEST BOSS',
      color: '#f80', bossPhase: 1, bossVisual: { tag: 'TEST' }
    }];
    updateHUD();
    updateHUD();
    const stable = { htmlWrites, gradientWrites, dashClassWrites, novaClassWrites };
    activeBosses[0].hp = 90;
    updateHUD();
    const hpOnly = { htmlWrites, gradientWrites, hpText: document.getElementById('bossHpText').textContent };
    activeBosses[0].bossPhase = 2;
    updateHUD();
    const phase = { htmlWrites, gradientWrites, markup };
    activeBosses[0].color = '#0f0';
    updateHUD();
    const color = { htmlWrites, gradientWrites, gradient };
    player.dashCooldown = 1;
    player.novaCooldown = 2;
    updateHUD(); updateHUD();
    const cooldown = { dashClassWrites, novaClassWrites };
    return JSON.stringify({ stable, hpOnly, phase, color, cooldown });
  })()`));
  assert.deepEqual(state.stable, { htmlWrites: 1, gradientWrites: 1, dashClassWrites: 1, novaClassWrites: 1 });
  assert.equal(state.hpOnly.htmlWrites, 1);
  assert.equal(state.hpOnly.gradientWrites, 1);
  assert.match(state.hpOnly.hpText, /90 \/ 150/);
  assert.equal(state.phase.htmlWrites, 1);
  assert.equal(state.phase.gradientWrites, 1);
  assert.equal(state.phase.markup, '');
  assert.equal(state.color.htmlWrites, 1);
  assert.equal(state.color.gradientWrites, 2);
  assert.match(state.color.gradient, /#0f0/);
  assert.deepEqual(state.cooldown, { dashClassWrites: 2, novaClassWrites: 2 });
});

test('M6.2-PC2 restarting a run invalidates boss HUD value cache', () => {
  const { run } = setup();
  const state = JSON.parse(run(`(() => {
    startNewGame();
    activeBosses = [{
      dead: false, hp: 60, maxHp: 100, bossName: 'CORE',
      color: '#ff738f', bossPhase: 1, bossVisual: { tag: 'A' }
    }];
    updateHUD();
    const filled = lastBossGradientColor !== null && lastBossIdentityMarkup !== null;
    startNewGame();
    return JSON.stringify({ filled, gradientReset: lastBossGradientColor,
      markupReset: lastBossIdentityMarkup, active: gameState === 'PLAYING' });
  })()`));
  assert.equal(state.filled, true);
  assert.equal(state.gradientReset, null);
  assert.equal(state.markupReset, null);
  assert.equal(state.active, true);
});


test('PC46 multi-boss simultaneous phase readiness does not deadlock all attacks', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    startNewGame();
    totalTime=500; wave=46;
    const bosses=['BOSS_TITAN','BOSS_VOID','BOSS_DESTROYER']
      .map((type,i)=>new Enemy(160+i*110,180,type));
    activeBosses=bosses;
    for (const b of bosses) {
      b.bossPhase=2;
      b.bossSpecial={angle:0,delay:0,timer:-0.05,phase:2};
      b.stunTimer=0;
    }
    const initial=enemyProjectiles.length;
    for (const b of bosses) b.updateBossPhases(.016,1,0);
    const afterFirst=enemyProjectiles.length;
    const first=[...bosses.map(b=>b.bossSpecialCount)];
    totalTime+=1.51;
    for (const b of bosses) b.updateBossPhases(.016,1,0);
    const afterSecond=enemyProjectiles.length;
    const second=[...bosses.map(b=>b.bossSpecialCount)];
    totalTime+=1.51;
    for (const b of bosses) b.updateBossPhases(.016,1,0);
    const third=bosses.map(b=>b.bossSpecialCount);
    return JSON.stringify({
      initial,afterFirst,afterSecond,finalShots:enemyProjectiles.length,
      first,second,third,remaining:bosses.map(b=>b.bossSpecial),
      tracked:combatDirector.stats.bossSpecialAttacks,
      deferred:combatDirector.stats.bossAttacksDeferred
    });
  })()`));
  assert.equal(data.initial, 0);
  assert.equal(data.afterFirst, 3);
  assert.equal(data.afterSecond, 8);
  assert.equal(data.finalShots, 13);
  assert.deepEqual(data.first, [1,0,0]);
  assert.deepEqual(data.second, [1,1,0]);
  assert.deepEqual(data.third, [1,1,1]);
  assert.deepEqual(data.remaining, [null,null,null]);
  assert.equal(data.tracked, 3);
  assert.ok(data.deferred >= 2);
});

test('PC46 an announced phase blocks regular attacks but never itself', () => {
  const { run } = setup();
  const data=JSON.parse(run(`(() => {
    startNewGame(); totalTime=250;
    const a=new Enemy(100,100,'BOSS_PRISM');
    const b=new Enemy(200,200,'BOSS_VOID');
    activeBosses=[a,b];
    a.bossSpecial={angle:0,phase:2,delay:0,timer:.4};
    const regular=combatDirector.allowBossAttack(b,'regular');
    const phase=combatDirector.allowBossAttack(a,'phase');
    return JSON.stringify({regular,phase,deferred:combatDirector.stats.bossAttacksDeferred});
  })()`));
  assert.equal(data.regular,false);
  assert.equal(data.phase,true);
  assert.equal(data.deferred,1);
});

test('PC46 stunned phase owner does not block another armed boss indefinitely', () => {
  const { run } = setup();
  const data=JSON.parse(run(`(() => {
    startNewGame(); totalTime=500;
    const a=new Enemy(100,100,'BOSS_DESTROYER');
    const b=new Enemy(200,200,'BOSS_PRISM');
    activeBosses=[a,b];
    for (const x of [a,b]) x.bossSpecial={angle:0,phase:2,delay:0,timer:-.1};
    a.stunTimer=8;
    const allowed=combatDirector.allowBossAttack(b,'phase');
    return JSON.stringify({allowed,deferred:combatDirector.stats.bossAttacksDeferred});
  })()`));
  assert.equal(data.allowed,true);
  assert.equal(data.deferred,0);
});

test('PC46 warped grid continues through right and bottom edge on non-32px sizes', () => {
  const calls=[];
  const context=new Proxy({}, { get(_,key) { return (...args) => calls.push({kind:String(key),args}); } });
  const { run }=setup({}, { canvasContext: context });
  calls.length=0;
  run(`(() => {
    worldWidth=100;worldHeight=81;gridOffset.x=-5;gridOffset.y=7;
    shockwaves=[{x:35,y:20,maxRadius:110,elapsed:.2,duration:.4}];
    drawBackgroundGrid();
  })()`);
  const lines=calls.filter(x=>x.kind==='lineTo');
  assert.ok(lines.some(x=>x.args[1]===81), 'vertical grid extends to bottom edge');
  assert.ok(lines.some(x=>x.args[0]===100), 'horizontal grid extends to right edge');
  assert.equal(calls.filter(x=>x.kind==='stroke').length,5);
});

test('PC46 dashed boundary warning remains an intentional special-encounter telegraph',()=>{
  const calls=[];
  const context=new Proxy({}, { get(_,key) { return (...args)=>calls.push({kind:String(key),args}); } });
  const { run }=setup({}, { canvasContext: context });
  calls.length=0;
  run(`(() => {
    startNewGame();
    combatDirector.pendingEncounter={warning:SPECIAL_ENCOUNTER_WARNING,
      label:'ÖNCÜ HÜCUMU',color:'#ffbf58',units:[{side:1}]};
    drawSpecialEncounterWarning();
  })()`);
  const dashes=calls.filter(x=>x.kind==='setLineDash').map(x=>Array.from(x.args[0]));
  assert.deepEqual(dashes,[[14,9],[]]);
  assert.ok(calls.some(x=>x.kind==='fillText'&&x.args[0]==='ÖNCÜ HÜCUMU'));
});


test('M6.2-PC3 offscreen FX culling includes sprite glow and leaves nonfinite positions unculled', () => {
  const { run } = setup();
  const values = JSON.parse(run(`JSON.stringify({
    edge: isFxInsideViewport(-27, 100, 5, 14),
    outside: isFxInsideViewport(-28, 100, 5, 14),
    right: isFxInsideViewport(worldWidth + 27, 100, 5, 14),
    farRight: isFxInsideViewport(worldWidth + 28, 100, 5, 14),
    bottom: isFxInsideViewport(100, worldHeight + 27, 5, 14),
    farBottom: isFxInsideViewport(100, worldHeight + 28, 5, 14),
    invalid: isFxInsideViewport(NaN, 500, 8, 5)
  })`));
  assert.deepEqual(values, {
    edge: true, outside: false, right: true, farRight: false,
    bottom: true, farBottom: false, invalid: true
  });
});

test('M6.2-PC3 FX drawing culls offscreen instances but retains all game objects', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    startNewGame();
    performanceOverlayOn = true;
    const drawn = [];
    const make = (name, x, y, radius) => ({
      x, y, radius, draw() { drawn.push(name); }
    });
    const near = make('near-glow', -30, 100, 10);
    const far = make('far', -300, 100, 10);
    const onScreen = make('on', 100, 100, 10);
    const actors = [near, far, onScreen];
    drawVisibleFxCollection(actors, 20);
    return JSON.stringify({
      drawn, originalCount: actors.length,
      same: actors[0] === near && actors[1] === far,
      stats: { ...pc3RenderCounts },
      normalBossDraw: typeof drawBossAttackTelegraphs === 'function'
    });
  })()`));
  assert.deepEqual(data.drawn, ['near-glow', 'on']);
  assert.equal(data.originalCount, 3);
  assert.equal(data.same, true);
  assert.deepEqual(data.stats, { visible: 2, skipped: 1 });
  assert.equal(data.normalBossDraw, true);
});

test('M6.2-PC3 gameplay update still advances invisible XP orb and enemy shot', () => {
  const { run } = setup();
  const state = JSON.parse(run(`(() => {
    startNewGame(); gameState = 'PLAYING';
    const orb = new EnergyOrb(-400, 100, 27, false);
    const shot = new EnemyProjectile(-38, 100, 35, 0, 7, 12, '#ff88dd');
    orbs=[orb]; enemyProjectiles=[shot];
    const before={orbX:orb.x, projectileX:shot.x, orbValue:orb.value};
    drawVisibleFxCollection(orbs, 22);
    drawVisibleFxCollection(enemyProjectiles, 20);
    orb.update(.1);
    shot.update(.1);
    return JSON.stringify({
      before, after:{orbX:orb.x, projectileX:shot.x, orbValue:orb.value},
      kept:orbs[0]===orb && enemyProjectiles[0]===shot
    });
  })()`));
  assert.equal(state.kept, true);
  assert.equal(state.after.orbValue, state.before.orbValue);
  assert.equal(state.after.orbX, state.before.orbX);
  assert.ok(state.after.projectileX > state.before.projectileX);
  assert.ok(state.after.projectileX < 0, 'movement occurs while still offscreen');
});

test('M6.2-PC3 long-run memory samples are opt-in, spaced and reset per run', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    startNewGame();
    performance.memory = { usedJSHeapSize: 48 * 1048576 };
    totalTime = 0; capturePc3LongRunSample();
    const disabled=window.getNeonPerformanceHistory().length;
    togglePerformanceOverlay();
    gameState='PLAYING';
    totalTime = 0; capturePc3LongRunSample();
    totalTime = 4.5; capturePc3LongRunSample();
    const early=window.getNeonPerformanceHistory().length;
    performance.memory.usedJSHeapSize=64 * 1048576;
    orbs=Array.from({ length: 7 }, () => ({ count: 1 }));
    totalTime=5.1; capturePc3LongRunSample();
    const before=window.getNeonPerformanceSnapshot().longRun;
    const history=window.getNeonPerformanceHistory();
    startNewGame();
    const after=window.getNeonPerformanceSnapshot().longRun;
    return JSON.stringify({ disabled,early,before,history,after });
  })()`));
  assert.equal(data.disabled, 0);
  assert.equal(data.early, 1);
  assert.equal(data.before.storedSamples, 2);
  assert.equal(data.before.lastHeapMiB, 64);
  assert.equal(data.before.sampledPeakHeapMiB, 64);
  assert.equal(data.before.sampledPeakObjects.orbs, 7);
  assert.equal(data.history.length, 2);
  assert.equal(data.history[0].jsHeapMiB, 48);
  assert.equal(data.history[1].orbs, 7);
  assert.equal(data.after.storedSamples, 0);
  assert.equal(data.after.lastHeapMiB, null);
  assert.equal(data.after.sampledPeakObjects.orbs, 0);
});

test('M6.2-PC3 hourly sample ring is bounded and returned chronologically', () => {
  const { run } = setup();
  const data = JSON.parse(run(`(() => {
    startNewGame();
    togglePerformanceOverlay();
    for (let i = 0; i < PC3_HISTORY_LIMIT + 11; i++) {
      totalTime = i * PC3_SAMPLE_INTERVAL;
      capturePc3LongRunSample();
    }
    const records = window.getNeonPerformanceHistory();
    return JSON.stringify({
      count: records.length, max: PC3_HISTORY_LIMIT,
      first: records[0].gameSeconds,
      last: records[records.length - 1].gameSeconds,
      heapUnavailable: records[0].jsHeapMiB,
      stored: window.getNeonPerformanceSnapshot().longRun.storedSamples
    });
  })()`));
  assert.equal(data.count, 720);
  assert.equal(data.stored, 720);
  assert.equal(data.max, 720);
  assert.equal(data.first, 55);
  assert.equal(data.last, 3650);
  assert.equal(data.heapUnavailable, null);
});


test('M6.2-PC4 graphics settings load, synchronize controls and persist across sessions', () => {
  const store={};
  const { run } = setup(store);
  const states = JSON.parse(run(`(() => {
    const initial={quality:graphicsQuality,root:document.documentElement.dataset.graphicsQuality,
      menu:document.getElementById('menuGraphicsQuality').value,
      pause:document.getElementById('pauseGraphicsQuality').value};
    const accepted=applyGraphicsQuality('low');
    const selected={quality:graphicsQuality,root:document.documentElement.dataset.graphicsQuality,
      menu:document.getElementById('menuGraphicsQuality').value,
      pause:document.getElementById('pauseGraphicsQuality').value,
      stored:localStorage.getItem(GRAPHICS_SAVE_KEY)};
    const rejected=applyGraphicsQuality('ultra');
    return JSON.stringify({initial,accepted,selected,rejected,afterReject:graphicsQuality});
  })()`));
  assert.deepEqual(states.initial,{quality:'high',root:'high',menu:'high',pause:'high'});
  assert.equal(states.accepted,true);
  assert.deepEqual(states.selected,{quality:'low',root:'low',menu:'low',pause:'low',stored:'low'});
  assert.equal(states.rejected,false);
  assert.equal(states.afterReject,'low');
  const reloaded=setup(store);
  assert.equal(reloaded.run('graphicsQuality'),'low');
  assert.equal(reloaded.run('document.getElementById("menuGraphicsQuality").value'),'low');
  assert.equal(reloaded.run('document.getElementById("pauseGraphicsQuality").value'),'low');
});

test('M6.2-PC4 invalid and blocked graphics storage safely falls back to High', () => {
  const invalid=setup({'neonCekirdek.graphics.v1':'super-max'}).run('graphicsQuality');
  assert.equal(invalid,'high');
  const {run}=setup();
  const r=JSON.parse(run(`(() => {
    localStorage.setItem = () => { throw Error('blocked'); };
    const accepted=applyGraphicsQuality('medium');
    return JSON.stringify({accepted,quality:graphicsQuality,
      root:document.documentElement.dataset.graphicsQuality});
  })()`));
  assert.deepEqual(r,{accepted:true,quality:'medium',root:'medium'});
});

test('M6.2-PC4 quality graphics profiles visibly differ without modifying world space', () => {
  const {run}=setup();
  const p=JSON.parse(run(`(() => {
    const rows={};
    for(const q of ['high','medium','low']) {
      applyGraphicsQuality(q);
      const world={width:worldWidth,height:worldHeight,scale:viewScale};
      rows[q]={dpr:getRenderDpr(1920,1080,3),
        blur:getGraphicsBlur(20),fx:getBossFxQuality(),
        spacing:getGraphicsPreset().gridSpacing,
        particles:getGraphicsPreset().particleDrawRatio,
        world};
    }
    return JSON.stringify(rows);
  })()`));
  assert.ok(p.high.dpr>p.medium.dpr&&p.medium.dpr>p.low.dpr);
  assert.equal(p.high.blur,20);
  assert.equal(p.medium.blur,9);
  assert.equal(p.low.blur,0);
  assert.equal(p.high.fx,2);
  assert.equal(p.medium.fx,1);
  assert.equal(p.low.fx,0);
  assert.deepEqual([p.high.spacing,p.medium.spacing,p.low.spacing],[48,64,96]);
  assert.deepEqual([p.high.particles,p.medium.particles,p.low.particles],[1,.68,.35]);
  assert.deepEqual(p.high.world,p.medium.world);
  assert.deepEqual(p.medium.world,p.low.world);
});

test('M6.2-PC4 medium and low selectively reduce cosmetic particle draws only', () => {
  const {run}=setup();
  const data=JSON.parse(run(`(() => {
    const drawn=[];
    const items=Array.from({length:100},(_,i)=>({x:300,y:300,radius:2,
      draw(){drawn.push(i);}}));
    const rows={};
    for(const q of ['high','medium','low']) {
      applyGraphicsQuality(q);
      drawn.length=0;
      drawVisibleFxCollection(items,12,getGraphicsPreset().particleDrawRatio);
      rows[q]=drawn.length;
    }
    drawn.length=0;drawVisibleFxCollection(items,20);
    return JSON.stringify({rows,shots:drawn.length,intact:items.length});
  })()`));
  assert.deepEqual(data.rows,{high:100,medium:70,low:40});
  assert.equal(data.shots,100);
  assert.equal(data.intact,100);
});

test('M6.2-PC4 frozen upgrade card state renders canvas once, then invalidates on quality change', () => {
  const calls=[];
  const context=new Proxy({}, {get(_,key){return (...args)=>calls.push(String(key));}});
  const {run}=setup({}, {canvasContext:context});
  const data=JSON.parse(run(`(() => {
    startNewGame();
    gameState='LEVEL_UP';
    lastFrameTime=0;
    gameLoop(16);
    const first=canvasRenderInvalidated===false&&lastCanvasRenderedState==='LEVEL_UP';
    gameLoop(32);
    const steady=canvasRenderInvalidated===false;
    const firstCount=pc3RenderCounts.visible+pc3RenderCounts.skipped;
    applyGraphicsQuality('low');
    const dirty=canvasRenderInvalidated;
    gameLoop(48);
    return JSON.stringify({first,steady,firstCount,dirty,
      after:canvasRenderInvalidated,last:lastCanvasRenderedState,
      quality:graphicsQuality});
  })()`));
  assert.equal(data.first,true);
  assert.equal(data.steady,true);
  assert.equal(data.dirty,true);
  assert.equal(data.after,false);
  assert.equal(data.last,'LEVEL_UP');
  assert.equal(data.quality,'low');
});

test('M6.2-PC4 card overlay has low-cost backdrop and animation rules by quality',()=>{
  for (const needle of [
    'id="menuGraphicsQuality"', 'id="pauseGraphicsQuality"',
    'html[data-graphics-quality="low"] .upgrade-card',
    'html[data-graphics-quality="medium"] .upgrade-card',
    'backdrop-filter:none!important',
    'backdrop-filter:blur(2px)!important',
    '.upgrade-card .upgrade-evolution-orbit',
    'select id="pauseGraphicsQuality"'
  ]) assert.ok(html.includes(needle),needle);
  assert.ok(!html.includes('renderGame()\n            capturePc3LongRunSample()'),
    'frozen modal must not call canvas render every frame');
});


test('Gameplay V2 intensity observer reports read-only state while director phase and economy stay unchanged', () => {
  const {run}=setup();
  const data=JSON.parse(run(`(() => {
    startNewGame(); wave=8; totalTime=23; nextBossTime=200;
    enemies=[]; enemyProjectiles=[];
    const expected=getDirectorProfile(totalTime,wave,0,nextBossTime,combatDirector.afterBossUntil,1);
    combatDirector.tokens=4;
    combatDirector.intensityObserver.recordDamage(35,100);
    combatDirector.update(.05);
    const diag=window.getNeonRunDiagnostics();
    return JSON.stringify({
      phase:combatDirector.profile.phase,interval:combatDirector.profile.interval,
      rate:combatDirector.profile.tokenRate,
      expectedPhase:expected.phase,expectedInterval:expected.interval,
      expectedRate:expected.tokenRate,
      tokens:combatDirector.tokens,
      stress:diag.adaptiveTempo.stress,preview:diag.adaptiveTempo.proposedPhase,
      mode:diag.adaptiveTempo.mode, bossAt:nextBossTime
    });
  })()`));
  assert.equal(data.phase,data.expectedPhase);
  assert.equal(data.interval,data.expectedInterval);
  assert.equal(data.rate,data.expectedRate);
  assert.ok(data.tokens>4);
  assert.ok(data.stress>0);
  assert.equal(data.preview,'BUILDUP');
  assert.equal(data.mode,'observe-only');
  assert.equal(data.bossAt,200);
});

test('Gameplay V2 real shield break and HP loss feed stress but retain existing damage counters', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    player.invulnTimer=0; player.hasShield=true;player.shieldActive=true;
    player.takeDamage(20);
    const blocked=window.getNeonRunDiagnostics().adaptiveTempo;
    player.invulnTimer=0;player.hasShield=false;
    const before=player.hp;
    player.takeDamage(12);
    const result=window.getNeonRunDiagnostics().adaptiveTempo;
    return JSON.stringify({blocked,result,hpLost:before-player.hp,
      shieldCount:runMetrics.shieldBlocks,hitCount:runMetrics.hitsTaken,
      damageCount:runMetrics.damageTaken});
  })()`));
  assert.equal(x.blocked.shieldBreaks,1);
  assert.equal(x.blocked.hpHits,0);
  assert.equal(x.result.hpHits,1);
  assert.ok(x.result.stress>x.blocked.stress);
  assert.equal(x.hpLost,12);
  assert.equal(x.shieldCount,1);
  assert.equal(x.hitCount,1);
  assert.equal(x.damageCount,12);
});

test('Gameplay V2 nearby kills add pressure but long range kills primarily raise mastery', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();
    const obs=combatDirector.intensityObserver;
    const far=new Enemy(player.x+400,player.y,'SWARM');
    const close=new Enemy(player.x+45,player.y,'SWARM');
    obs.recordKill(far,player);
    const distant=obs.getSnapshot();
    obs.recordKill(close,player);
    const nearby=obs.getSnapshot();
    close.die();
    return JSON.stringify({distant,nearby,live:obs.getSnapshot(),
      gameKills:kills,questKills:questStats.byType.KILLS?.completed||0});
  })()`));
  assert.equal(x.distant.nearKills,0);
  assert.equal(x.distant.stress,0);
  assert.ok(x.distant.mastery>0);
  assert.equal(x.nearby.nearKills,1);
  assert.ok(x.nearby.stress>x.distant.stress);
  assert.equal(x.live.nearKills,2);
  assert.equal(x.live.kills,3);
  assert.equal(x.gameKills,1);
});

test('Gameplay V2 proximity measures real nearby threats and decays after the arena clears', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=1000;
    const o=combatDirector.intensityObserver;
    enemies=[new Enemy(player.x+24,player.y,'SWARM'),
      new Enemy(player.x+700,player.y,'SWARM')];
    enemyProjectiles=[new EnemyProjectile(player.x,player.y+30,5,0,4,2)];
    for(let i=0;i<5;i++)o.observe(.05,i*.05,player,enemies,enemyProjectiles,false);
    const withEnemies=o.getSnapshot();
    enemies=[];enemyProjectiles=[];
    for(let i=0;i<60;i++)o.observe(.05,.25+i*.05,player,enemies,enemyProjectiles,false);
    const cleared=o.getSnapshot();
    return JSON.stringify({withEnemies,cleared});
  })()`));
  assert.equal(x.withEnemies.nearbyEnemies,1);
  assert.equal(x.withEnemies.nearbyProjectiles,1);
  assert.ok(x.withEnemies.stress>=6);
  assert.equal(x.cleared.nearbyEnemies,0);
  assert.equal(x.cleared.nearbyProjectiles,0);
  assert.ok(x.cleared.stress<x.withEnemies.stress);
});

test('Gameplay V2 preview models buildup peak fade relax and boss lock without combat changes', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    const o=new AdaptiveTempoObserver();
    o.intensity=82;
    o.advancePreview(8,false);
    const peak=o.previewPhase;
    o.advancePreview(4,false);
    const fade=o.previewPhase;
    o.advancePreview(4,false);
    const relief=o.previewPhase;
    o.intensity=10;o.advancePreview(12,false);
    const buildup=o.previewPhase;
    o.advancePreview(.05,true);
    const locked=o.previewPhase;
    o.advancePreview(100,true);
    const stillLocked=o.previewPhase;
    o.advancePreview(.05,false);
    const resumed=o.previewPhase;
    return JSON.stringify({peak,fade,relief,buildup,locked,stillLocked,resumed,
      transitions:o.previewTransitions});
  })()`));
  assert.deepEqual(x,{
    peak:'SUSTAIN',fade:'FADE',relief:'RELAX',buildup:'BUILDUP',
    locked:'BOSS_LOCK',stillLocked:'BOSS_LOCK',resumed:'BUILDUP',transitions:6
  });
});

test('Gameplay V2 telemetry has fixed last-180 sample ring and copies are mutation-safe', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame(); const o=combatDirector.intensityObserver;
    for(let i=0;i<220;i++)o.observe(.05,i+1,player,[],[],false);
    const old=o.getHistory(),first=old[0].second,last=old[old.length-1].second;
    old[0].stress=999;old.push({second:99999});
    const diag=window.getNeonRunDiagnostics();
    diag.adaptiveTempo.stress=999;
    const safe=window.getNeonIntensityHistory();
    return JSON.stringify({length:safe.length,first,last,safeFirst:safe[0].stress,
      internalStress:o.getSnapshot().stress,internalSamples:o.historyCount,
      backingLength:o.history.length});
  })()`));
  assert.equal(x.length,180);
  assert.equal(x.first,41);
  assert.equal(x.last,220);
  assert.notEqual(x.safeFirst,999);
  assert.notEqual(x.internalStress,999);
  assert.equal(x.internalSamples,180);
  assert.equal(x.backingLength,1080);
});

test('Gameplay V2 observer pauses with gameplay and completely resets at new run', () => {
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame(); nextBossTime=1000;
    combatDirector.intensityObserver.recordDamage(15,100);
    const before=combatDirector.intensityObserver.getSnapshot();
    gameState='LEVEL_UP';lastFrameTime=0;
    gameLoop(100);gameLoop(200);gameLoop(300);
    const frozen=combatDirector.intensityObserver.getSnapshot();
    gameState='PLAYING';gameLoop(350);
    const advanced=combatDirector.intensityObserver.getSnapshot();
    startNewGame();
    return JSON.stringify({before,frozen,advanced,reset:window.getNeonRunDiagnostics().adaptiveTempo});
  })()`));
  assert.equal(x.frozen.stress,x.before.stress);
  assert.equal(x.frozen.historySamples,0);
  assert.ok(x.advanced.historySamples>=1);
  assert.equal(x.reset.stress,0);
  assert.equal(x.reset.mastery,0);
  assert.equal(x.reset.hpHits,0);
  assert.equal(x.reset.historySamples,0);
  assert.equal(x.reset.proposedPhase,'BUILDUP');
});

test('Gameplay V2 actual boss kill ignores stress model and keeps guaranteed chest accounting',()=>{
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    startNewGame(); spawnBossEncounter();
    const boss=activeBosses[0];boss.hp=1;
    const prior=combatDirector.intensityObserver.getSnapshot();
    boss.takeDamage(99999,0,0,false,false);
    const after=combatDirector.intensityObserver.getSnapshot();
    return JSON.stringify({prior,after,kills,tracked:combatDirector.stats.bossKills,
      chests:combatDirector.stats.chestDrops.boss});
  })()`));
  assert.equal(x.after.kills,x.prior.kills);
  assert.equal(x.after.nearKills,x.prior.nearKills);
  assert.equal(x.after.stress,x.prior.stress);
  assert.equal(x.kills,1);
  assert.equal(x.tracked,1);
  assert.equal(x.chests,1);
});


test('Gameplay V2 G2 tempo flag is opt-in and ignores malformed URL parameters',()=>{
  const {run}=setup();
  const values=JSON.parse(run(`JSON.stringify({
    defaultMode:getTempoMode(),
    optIn:getTempoMode('?tempo=adaptive&perf=1'),
    secondParam:getTempoMode('?perf=1&tempo=adaptive'),
    classic:getTempoMode('?tempo=classic'),
    invalid:getTempoMode('?tempo=adaptive-ish'),
    lookalike:getTempoMode('?mytempo=adaptive'),
    caps:getTempoMode('?TEMPO=ADAPTIVE')
  })`));
  assert.deepEqual(values,{
    defaultMode:'classic',optIn:'adaptive',secondParam:'adaptive',
    classic:'classic',invalid:'classic',lookalike:'classic',caps:'adaptive'
  });
});

test('Gameplay V2 G2 classic retains existing 64-second combat profile',()=>{
  const {run}=setup();
  const r=JSON.parse(run(`(() => {
    startNewGame();wave=8;nextBossTime=10000;
    const values=[];
    for(const t of [5,20,40,55,65,90]) {
      totalTime=t;combatDirector.update(.05);
      const fixed=getDirectorProfile(t,wave,0,nextBossTime,combatDirector.afterBossUntil,1);
      values.push({t,phase:combatDirector.profile.phase,expected:fixed.phase,
        interval:combatDirector.profile.interval,fixedInterval:fixed.interval,
        rate:combatDirector.profile.tokenRate,fixedRate:fixed.tokenRate,
        base:combatDirector.baseProfile.phase});
    }
    const diag=window.getNeonRunDiagnostics();
    return JSON.stringify({values,mode:diag.tempoMode,
      observerMode:diag.adaptiveTempo.mode,adaptive:diag.adaptivePhase});
  })()`));
  assert.equal(r.mode,'classic');
  assert.equal(r.observerMode,'observe-only');
  assert.equal(r.adaptive,null);
  for(const x of r.values){
    assert.equal(x.phase,x.expected);
    assert.equal(x.phase,x.base);
    assert.equal(x.interval,x.fixedInterval);
    assert.equal(x.rate,x.fixedRate);
  }
  assert.deepEqual(r.values.map(x=>x.phase),
    ['BUILDUP','PRESSURE','CRISIS','RECOVERY','BUILDUP','PRESSURE']);
});

test('Gameplay V2 G2 maps all four observer phases into contrasting safe director profiles',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const r=JSON.parse(run(`(() => {
    startNewGame();wave=8;totalTime=25;nextBossTime=1000;
    const stages=[['BUILDUP',3],['BUILDUP',15],['SUSTAIN',1],
      ['FADE',1],['RELAX',10],['BOSS_LOCK',0]];
    const rows=[];
    for(const [stage,age] of stages) {
      const o=combatDirector.intensityObserver;
      o.setPreview(stage);o.previewAge=age;
      combatDirector.update(.05);
      rows.push({stage,phase:combatDirector.profile.phase,
        base:combatDirector.baseProfile.phase,
        interval:combatDirector.profile.interval,
        rate:combatDirector.profile.tokenRate,
        elite:combatDirector.profile.eliteChance,
        active:combatDirector.adaptivePhase});
    }
    return JSON.stringify({rows,mode:combatDirector.tempoMode,
      diag:window.getNeonRunDiagnostics()});
  })()`));
  const rows=r.rows;
  assert.equal(r.mode,'adaptive');
  assert.equal(r.diag.adaptiveTempo.mode,'driving-spawns');
  assert.deepEqual(rows.map(x=>x.phase),
    ['BUILDUP','PRESSURE','CRISIS','BUILDUP','RECOVERY','BUILDUP']);
  assert.equal(run("mapAdaptiveStageToDirectorPhase('BOSS_LOCK',0)"),null);
  assert.ok(rows[2].interval<rows[1].interval);
  assert.ok(rows[4].interval>rows[2].interval);
  assert.ok(rows[2].rate>rows[4].rate);
  assert.equal(rows[4].elite,0);
  assert.ok(rows.every(x=>x.base==='PRESSURE'));
  assert.equal(rows[5].active,'BUILDUP');
});

test('Gameplay V2 G2 high stress triggers a real crisis and preserves director caps and XP rules',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const r=JSON.parse(run(`(() => {
    startNewGame();wave=8;totalTime=25;nextBossTime=1000;
    const o=combatDirector.intensityObserver;
    o.eventStress=90;o.refreshIntensity();o.previewAge=7.95;
    combatDirector.update(.05);
    const newProfile={...combatDirector.profile};
    const classic=getDirectorProfile(totalTime,wave,0,nextBossTime,combatDirector.afterBossUntil,1);
    const chosen=combatDirector.profile.phase;
    const budget=combatDirector.tokens;
    return JSON.stringify({chosen,classic:classic.phase,
      interval:newProfile.interval,oldInterval:classic.interval,
      maxCap:MAX_ACTIVE_ENEMIES,actualCap:newProfile.cap,
      hp:player.hp,damage:player.damage,xp:player.xp,tokens:budget});
  })()`));
  assert.equal(r.chosen,'CRISIS');
  assert.equal(r.classic,'PRESSURE');
  assert.ok(r.interval<r.oldInterval);
  assert.ok(r.actualCap<=r.maxCap);
  assert.ok(r.tokens<=14);
  assert.ok(r.hp>0&&r.damage>0);
  assert.equal(r.xp,0);
});

test('Gameplay V2 G2 boss warning, live boss and final-boss recovery override the adaptive peak',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const r=JSON.parse(run(`(() => {
    startNewGame();wave=8;
    const observer=combatDirector.intensityObserver;
    observer.setPreview('SUSTAIN');
    nextBossTime=100;totalTime=96.6;
    combatDirector.update(.05);
    const warning={phase:combatDirector.profile.phase,base:combatDirector.baseProfile.phase,
      stage:observer.previewPhase,active:combatDirector.adaptivePhase};
    activeBosses=[{dead:false}];totalTime=101;
    combatDirector.update(.05);
    const boss={phase:combatDirector.profile.phase,base:combatDirector.baseProfile.phase,
      active:combatDirector.adaptivePhase};
    activeBosses=[];nextBossTime=200;combatDirector.afterBossUntil=110;
    totalTime=105;combatDirector.update(.05);
    const recover={phase:combatDirector.profile.phase,
      base:combatDirector.baseProfile.phase,active:combatDirector.adaptivePhase};
    totalTime=111;combatDirector.update(.05);
    const resumed={phase:combatDirector.profile.phase,
      stage:observer.previewPhase,active:combatDirector.adaptivePhase};
    return JSON.stringify({warning,boss,recover,resumed});
  })()`));
  assert.deepEqual(r.warning,{phase:'WARNING',base:'WARNING',stage:'BOSS_LOCK',active:null});
  assert.deepEqual(r.boss,{phase:'BOSS',base:'BOSS',active:null});
  assert.deepEqual(r.recover,{phase:'RECOVERY',base:'RECOVERY',active:null});
  assert.equal(r.resumed.stage,'BUILDUP');
  assert.equal(r.resumed.active,'BUILDUP');
  assert.equal(r.resumed.phase,'BUILDUP');
});

test('Gameplay V2 G2 stress relief cannot start new special raids but honors existing telegraphs',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const r=JSON.parse(run(`(() => {
    startNewGame();totalTime=22;wave=8;nextBossTime=1000;
    const o=combatDirector.intensityObserver;
    o.setPreview('RELAX');o.previewAge=3;
    combatDirector.tokens=14;
    combatDirector.nextEncounterAt=0;
    combatDirector.update(.05);
    const relief={phase:combatDirector.profile.phase,base:combatDirector.baseProfile.phase,
      offered:combatDirector.stats.specialEncounters,
      pending:combatDirector.pendingEncounter};
    combatDirector.pendingEncounter={type:'TEST',warning:1.5,units:[]};
    combatDirector.update(.05);
    return JSON.stringify({relief,pendingWarning:combatDirector.pendingEncounter?.warning,
      cancellationCount:combatDirector.stats.specialCancelled});
  })()`));
  assert.equal(r.relief.phase,'RECOVERY');
  assert.equal(r.relief.base,'PRESSURE');
  assert.equal(r.relief.pending,null);
  assert.equal(r.relief.offered,0);
  assert.ok(r.pendingWarning<1.5 && r.pendingWarning>1.3);
  assert.equal(r.cancellationCount,0);
});

test('Gameplay V2 G2 adaptive attempts use actual shorter spawn interval without new spawn routes',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const r=JSON.parse(run(`(() => {
    startNewGame();totalTime=20;wave=8;nextBossTime=1000;
    const o=combatDirector.intensityObserver;
    o.setPreview('SUSTAIN');o.previewAge=0;
    combatDirector.tokens=14;spawnTimer=.01;
    const before=combatDirector.stats.spawned;
    updateGame(.05);
    return JSON.stringify({
      phase:combatDirector.profile.phase,afterTimer:spawnTimer,
      interval:combatDirector.profile.interval,spawned:combatDirector.stats.spawned-before,
      enemies:enemies.length,remainingTokens:combatDirector.tokens
    });
  })()`));
  assert.equal(r.phase,'CRISIS');
  assert.ok(Math.abs(r.afterTimer-(r.interval-.04))<.001);
  assert.ok(r.spawned>=0&&r.spawned<=1);
  assert.ok(r.remainingTokens<=14);
});

test('Gameplay V2 G2 restores legacy phase on new classic run and reports bounded counters',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const r=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=1000;wave=8;totalTime=25;
    combatDirector.intensityObserver.setPreview('SUSTAIN');
    combatDirector.update(.05);
    const active=window.getNeonRunDiagnostics();
    startNewGame();
    const fresh=window.getNeonRunDiagnostics();
    return JSON.stringify({active:{
      mode:active.tempoMode,base:active.basePhase,phase:active.phase,
      switches:active.tempoPhaseSwitches,seconds:active.tempoPhaseSeconds
    },fresh:{mode:fresh.tempoMode,
      switches:fresh.tempoPhaseSwitches,seconds:fresh.tempoPhaseSeconds,
      proposal:fresh.adaptivePhase,stress:fresh.adaptiveTempo.stress}});
  })()`));
  assert.equal(r.active.mode,'adaptive');
  assert.equal(r.active.base,'PRESSURE');
  assert.equal(r.active.phase,'CRISIS');
  assert.ok(r.active.switches>=1);
  assert.equal(r.fresh.mode,'adaptive');
  assert.equal(r.fresh.switches,0);
  assert.deepEqual(r.fresh.seconds,{BUILDUP:0,PRESSURE:0,CRISIS:0,RECOVERY:0});
  assert.equal(r.fresh.proposal,null);
  assert.equal(r.fresh.stress,0);
});


test('Gameplay V2 G3 hysteresis counts separated stress peaks, not every high-stress frame',()=>{
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    const m=new TempoRunMetrics();
    const o={intensity:80,mastery:40,nearbyEnemies:3,nearbyProjectiles:2};
    for(let i=0;i<10;i++)m.observe(.1,o,'CRISIS',false);
    const one=m.getSnapshot();
    o.intensity=52;m.observe(.5,o,'PRESSURE',false);
    o.intensity=75;m.observe(.1,o,'CRISIS',false);
    const notRearmed=m.getSnapshot();
    o.intensity=34;m.observe(.5,o,'RECOVERY',false);
    o.intensity=83;m.observe(.1,o,'CRISIS',false);
    const twice=m.getSnapshot();
    return JSON.stringify({one,notRearmed,twice});
  })()`));
  assert.equal(x.one.stressPeaks,1);
  assert.equal(x.notRearmed.stressPeaks,1);
  assert.equal(x.twice.stressPeaks,2);
  assert.equal(x.twice.peakStress,83);
  assert.ok(Math.abs(x.one.normalSeconds-1)<.001);
  assert.ok(x.twice.averageStress>0 && x.twice.averageStress<=100);
  assert.equal(x.twice.reliefEntries,1);
});

test('Gameplay V2 G3 calm-window metric only counts 8+ seconds near-threat-free and excludes boss periods',()=>{
  const {run}=setup();
  const x=JSON.parse(run(`(() => {
    const m=new TempoRunMetrics();
    const o={intensity:8,mastery:35,nearbyEnemies:0,nearbyProjectiles:0};
    for(let i=0;i<90;i++)m.observe(.1,o,'RECOVERY',false);
    const running=m.getSnapshot();
    m.observe(2,o,'BOSS',true);
    const afterBoss=m.getSnapshot();
    for(let i=0;i<40;i++)m.observe(.1,o,'BUILDUP',false);
    o.nearbyProjectiles=1;
    m.observe(.1,o,'PRESSURE',false);
    const ended=m.getSnapshot();
    return JSON.stringify({running,afterBoss,ended});
  })()`));
  assert.equal(x.running.calmWindows,1);
  assert.ok(Math.abs(x.running.longestCalmSeconds-9)<.001);
  assert.equal(x.afterBoss.calmWindows,1);
  assert.equal(x.afterBoss.bossProtectedSeconds,2);
  assert.equal(x.ended.calmWindows,1);
  assert.ok(Math.abs(x.ended.normalSeconds-13.1)<.001);
  assert.ok(Math.abs(x.ended.calmSeconds-13)<.001);
  assert.equal(x.ended.reliefEntries,1);
});

test('Gameplay V2 G3 diagnostics expose independent normal/boss durations without modifying phase',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const x=JSON.parse(run(`(() => {
    startNewGame();wave=7;totalTime=25;nextBossTime=200;
    combatDirector.intensityObserver.setPreview('SUSTAIN');
    combatDirector.update(.05);
    const normal=window.getNeonRunDiagnostics();
    activeBosses=[{dead:false}];combatDirector.update(.05);
    const boss=window.getNeonRunDiagnostics();
    return JSON.stringify({normalPhase:normal.phase,normal:normal.tempoRunMetrics,
      bossPhase:boss.phase,boss:boss.tempoRunMetrics});
  })()`));
  assert.equal(x.normalPhase,'CRISIS');
  assert.equal(x.bossPhase,'BOSS');
  assert.ok(x.normal.normalSeconds>0);
  assert.equal(x.normal.bossProtectedSeconds,0);
  assert.ok(x.boss.bossProtectedSeconds>0);
  assert.equal(x.boss.normalSeconds,x.normal.normalSeconds);
});

test('Gameplay V2 G3 end-of-run rhythm report integrates safely into existing tab controls',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive'});
  const x=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=9999;
    combatDirector.intensityObserver.recordDamage(14,player.maxHp);
    combatDirector.update(.05);
    triggerGameOver();
    const report=window.getNeonFinalReport();
    const html=document.getElementById('reportTempoContent').innerHTML;
    const activated=showRunReportTab('tempo');
    return JSON.stringify({mode:report.tempo.mode,metrics:report.tempo.metrics,
      phases:report.tempo.phases,html,activated,activeTab:activeReportTab,
      reportTabs:REPORT_TABS,version:report.version});
  })()`));
  assert.equal(x.mode,'adaptive');
  assert.equal(x.version,1);
  assert.ok(x.metrics.averageStress>0);
  assert.equal(x.activated,true);
  assert.equal(x.activeTab,'tempo');
  assert.ok(x.reportTabs.includes('tempo'));
  assert.match(x.html,/BU KOŞUNUN RİTMİ/);
  assert.match(x.html,/ADAPTİF/);
  assert.match(x.html,/FAZ ZAMANLARI/);
  assert.match(html,/id="reportTabTempo"[^>]*data-report-tab="tempo"/);
  assert.match(html,/id="reportTempoContent"[^>]*role="tabpanel"/);
});

test('Gameplay V2 G3 only completed runs write compact compare data; reload keeps both modes',()=>{
  const store={};
  let a=setup(store,{locationSearch:'?tempo=classic'});
  a.run(`startNewGame();totalTime=145;wave=10;kills=160;
    combatDirector.tempoRunMetrics.observe(5,combatDirector.intensityObserver,'BUILDUP',false);`);
  assert.equal(Object.hasOwn(store,'neonCekirdek.tempoCompare.v1'),false);
  a.run('triggerGameOver()');
  let b=setup(store,{locationSearch:'?tempo=adaptive'});
  b.run(`startNewGame();totalTime=180;wave=12;kills=190;
    combatDirector.tempoRunMetrics.observe(7,combatDirector.intensityObserver,'CRISIS',false);`);
  b.run('triggerGameOver()');
  const c=setup(store);
  const x=JSON.parse(c.run('JSON.stringify(window.getNeonTempoComparison())'));
  assert.equal(x.classic.mode,'classic');
  assert.equal(x.adaptive.mode,'adaptive');
  assert.equal(x.classic.durationSeconds,145);
  assert.equal(x.adaptive.durationSeconds,180);
  assert.equal(x.classic.wave,10);
  assert.equal(x.adaptive.wave,12);
  const raw=store['neonCekirdek.tempoCompare.v1'];
  assert.ok(!raw.includes('modules'));
  assert.ok(!raw.includes('upgrades'));
  assert.ok(!raw.includes('email'));
  assert.ok(!raw.includes('goldBySource'));
});

test('Gameplay V2 G3 A/B comparison shows both modes and warns against false conclusions',()=>{
  const store={};
  let a=setup(store,{locationSearch:'?tempo=classic'});
  a.run('startNewGame();totalTime=130;wave=9;triggerGameOver()');
  let b=setup(store,{locationSearch:'?tempo=adaptive'});
  const x=JSON.parse(b.run(`(() => {
    startNewGame();totalTime=140;wave=10;
    triggerGameOver();
    const txt=document.getElementById('reportTempoContent').innerHTML;
    return JSON.stringify({txt,summary:window.getNeonTempoComparison()});
  })()`));
  assert.ok(x.txt.includes('KLASİK'));
  assert.ok(x.txt.includes('ADAPTİF'));
  assert.ok(x.txt.includes('KARŞILAŞTIRMA GÜVENİ'));
  assert.ok(x.txt.includes('Benzer koşul kontrolü sağlandı'));
  assert.equal(x.summary.classic.wave,9);
  assert.equal(x.summary.adaptive.wave,10);
});

test('Gameplay V2 G3 malformed comparison storage is ignored and results can be cleared',()=>{
  const storage={'neonCekirdek.tempoCompare.v1':'{"version":1,"classic":{"mode":"classic","chassis":"ATTACK","graphicsQuality":"high","durationSeconds":400},"adaptive":{}}'};
  const {run}=setup(storage);
  const x=JSON.parse(run(`(() => {
    const corrupted=window.getNeonTempoComparison();
    const cleared=window.clearNeonTempoComparison();
    const after=window.getNeonTempoComparison();
    return JSON.stringify({corrupted,cleared,after});
  })()`));
  assert.deepEqual(x.corrupted,{classic:null,adaptive:null});
  assert.equal(x.cleared,true);
  assert.deepEqual(x.after,{classic:null,adaptive:null});
  const blocked=setup();
  const y=JSON.parse(blocked.run(`(() => {
    startNewGame();localStorage.setItem=()=>{throw Error('no storage')};
    const result=saveTempoComparisonRun(snapshotEndOfRun());
    return JSON.stringify({result,stillRuns:!!combatDirector});
  })()`));
  assert.equal(y.result,false);
  assert.equal(y.stillRuns,true);
});

test('Gameplay V2 G3 last-of-each-mode overwrite is isolated and comparison returns copies',()=>{
  const storage={};
  let a=setup(storage,{locationSearch:'?tempo=adaptive'});
  a.run('startNewGame();totalTime=140;wave=8;triggerGameOver()');
  a.run('startNewGame();totalTime=165;wave=11;triggerGameOver()');
  let b=setup(storage,{locationSearch:'?tempo=classic'});
  b.run('startNewGame();totalTime=185;wave=13;triggerGameOver()');
  const x=JSON.parse(b.run(`(() => {
    const first=window.getNeonTempoComparison();
    first.classic.wave=99999;first.adaptive.mode='broken';
    return JSON.stringify(window.getNeonTempoComparison());
  })()`));
  assert.equal(x.adaptive.wave,11);
  assert.equal(x.classic.wave,13);
  assert.equal(x.adaptive.mode,'adaptive');
  assert.equal(x.classic.mode,'classic');
});


test('Gameplay V2 MLP1 learner flag is opt-in, not confused with adaptivity',()=>{
  const {run}=setup();
  const v=JSON.parse(run(`JSON.stringify({
    default:isPlayerLearningEnabled(),
    enabled:isPlayerLearningEnabled('?tempo=adaptive&learn=on'),
    reordered:isPlayerLearningEnabled('?learn=on&tempo=classic'),
    malformed:isPlayerLearningEnabled('?learn=only'),
    unrelated:isPlayerLearningEnabled('?mylearn=on'),
    off:isPlayerLearningEnabled('?learn=off')
  })`));
  assert.deepEqual(v,{default:false,enabled:true,reordered:true,malformed:false,
    unrelated:false,off:false});
  const off=setup().run("(()=>{startNewGame();return window.getNeonPlayerLearner().mode})()");
  assert.equal(off,'off');
});

test('Gameplay V2 MLP1 online SGD learns from labeled outcomes and separates high from low risk inputs',()=>{
  const {run}=setup();
  const v=JSON.parse(run(`(() => {
    const l=new OnlinePlayerLearner('VANGUARD',true);
    const low=[1,0,0,0,0,0,0,0],high=[1,1,1,.7,.9,0,0,0];
    const initial=[l.predict(low),l.predict(high)];
    for(let i=0;i<100;i++){
      l.train(high,1);l.train(low,0);
    }
    const after=[l.predict(low),l.predict(high)];
    return JSON.stringify({initial,after,weights:l.weights,snap:l.getSnapshot()});
  })()`));
  assert.deepEqual(v.initial,[.5,.5]);
  assert.ok(v.after[0]<.5);
  assert.ok(v.after[1]>.5);
  assert.ok(v.after[1]>v.after[0]+.35);
  assert.equal(v.snap.trainedWindows,200);
  assert.equal(v.snap.positiveWindows,100);
  assert.equal(v.snap.readyForEvaluation,true);
  assert.equal(v.snap.controlsSpawns,false);
  assert.ok(v.weights.every(x=>Math.abs(x)<=8));
  assert.ok(v.snap.preUpdateBrier<v.snap.baselineBrier,
    'learner must outperform naive running prevalence on separable labels');
});

test('Gameplay V2 MLP1 labels only completed future 8s HP-loss windows',()=>{
  const {run}=setup({}, {locationSearch:'?tempo=adaptive&learn=on'});
  const v=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=1000;totalTime=1;
    combatDirector.update(.05);
    const l=combatDirector.playerLearner;
    const originalFeatures=[...l.pending.features], initialPrediction=l.lastPrediction;
    runMetrics.hitsTaken=1;totalTime=7;combatDirector.update(.05);
    const premature=l.getSnapshot();
    totalTime=9.1;combatDirector.update(.05);
    const complete=l.getSnapshot();
    return JSON.stringify({
      initialPrediction,originalFeatures,premature,complete,
      trainingUsesOldFeatures:l.pending.features!==originalFeatures,
      nextStartsAt:l.pending.started
    });
  })()`));
  assert.equal(v.premature.thisRunWindows,0);
  assert.equal(v.complete.thisRunWindows,1);
  assert.equal(v.complete.positiveWindows,1);
  assert.equal(v.complete.previousOutcome,1);
  assert.equal(v.originalFeatures[0],1);
  assert.equal(v.nextStartsAt,9.1);
});

test('Gameplay V2 MLP1 excludes interrupted boss warning and boss combat windows',()=>{
  const {run}=setup({}, {locationSearch:'?learn=on'});
  const v=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    const l=combatDirector.playerLearner;
    nextBossTime=12;totalTime=5;combatDirector.update(.05);
    const dropped={skipped:l.skippedWindows,samples:l.samples,pending:!!l.pending};
    activeBosses=[{dead:false}];totalTime=6;combatDirector.update(.05);
    const boss={samples:l.samples,pending:!!l.pending};
    activeBosses=[];nextBossTime=1000;totalTime=20;combatDirector.update(.05);
    runMetrics.hitsTaken=1;totalTime=28.1;combatDirector.update(.05);
    return JSON.stringify({dropped,boss,finished:l.getSnapshot()});
  })()`));
  assert.deepEqual(v.dropped,{skipped:1,samples:0,pending:false});
  assert.deepEqual(v.boss,{samples:0,pending:false});
  assert.equal(v.finished.trainedWindows,1);
  assert.equal(v.finished.positiveWindows,1);
});

test('Gameplay V2 MLP1 game pause/upgrade freezes training and new run discards incomplete window',()=>{
  const {run}=setup({}, {locationSearch:'?learn=on'});
  const v=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    const firstPending=combatDirector.playerLearner.pending.started;
    gameState='LEVEL_UP';lastFrameTime=0;
    gameLoop(100);gameLoop(200);gameLoop(300);
    const before=combatDirector.playerLearner.getSnapshot();
    startNewGame();
    const after=combatDirector.playerLearner.getSnapshot();
    return JSON.stringify({firstPending,before,after});
  })()`));
  assert.equal(v.firstPending,1);
  assert.equal(v.before.trainedWindows,0);
  assert.equal(v.after.trainedWindows,0);
  assert.equal(v.after.thisRunWindows,0);
  assert.equal(v.after.predictedRisk,null);
});

test('Gameplay V2 MLP1 saves only after game-over and resumes same chassis with learned weights',()=>{
  const storage={};
  const a=setup(storage,{locationSearch:'?tempo=adaptive&learn=on'});
  a.run(`startNewGame();nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    totalTime=9.1;runMetrics.hitsTaken=1;combatDirector.update(.05);`);
  assert.equal(Object.hasOwn(storage,'neonCekirdek.playerLearner.v1'),false,
    'do not persist during gameplay');
  const first=JSON.parse(a.run('JSON.stringify(window.getNeonPlayerLearner())'));
  a.run('triggerGameOver()');
  const stored=JSON.parse(storage['neonCekirdek.playerLearner.v1']);
  assert.equal(stored.version,1);
  assert.equal(stored.models.VANGUARD.samples,1);
  assert.equal(stored.models.VANGUARD.positives,1);
  assert.equal(JSON.stringify(stored).includes('nearbyEnemies'),false,
    'no raw gameplay events in persisted model');
  const b=setup(storage,{locationSearch:'?learn=on'});
  const second=JSON.parse(b.run("(()=>{startNewGame();return JSON.stringify(window.getNeonPlayerLearner())})()"));
  assert.equal(first.trainedWindows,second.trainedWindows);
  assert.deepEqual(first.weights,second.weights);
  assert.equal(second.thisRunWindows,0);
  assert.equal(second.mode,'online-training-shadow');
});

test('Gameplay V2 MLP1 stores independent chassis models, not cross-chassis weights',()=>{
  const storage={};
  const a=setup(storage,{locationSearch:'?learn=on'});
  a.run(`startNewGame();nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    runMetrics.hitsTaken=1;totalTime=9.1;combatDirector.update(.05);triggerGameOver();`);
  const b=setup(storage,{locationSearch:'?learn=on'});
  const x=JSON.parse(b.run(`(() => {
    selectedChassis='PHANTOM';startNewGame();
    const model=combatDirector.playerLearner.getSnapshot();
    nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    totalTime=9.1;combatDirector.update(.05);triggerGameOver();
    return JSON.stringify(model);
  })()`));
  assert.equal(x.chassis,'PHANTOM');
  assert.equal(x.trainedWindows,0);
  const bank=JSON.parse(storage['neonCekirdek.playerLearner.v1']);
  assert.equal(bank.models.VANGUARD.positives,1);
  assert.equal(bank.models.PHANTOM.positives,0);
  assert.equal(bank.models.PHANTOM.samples,1);
});

test('Gameplay V2 MLP1 corrupt state and storage failures never break gameplay',()=>{
  const key='neonCekirdek.playerLearner.v1';
  const storage={[key]:JSON.stringify({version:1,models:{VANGUARD:{
    weights:[Infinity,999],samples:500,positives:500,modelBrier:0,baselineBrier:0
  }}})};
  const {run}=setup(storage,{locationSearch:'?learn=on'});
  assert.equal(run("(()=>{startNewGame();return combatDirector.playerLearner.samples})()"),0);
  const p=JSON.parse(run(`(() => {
    nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    runMetrics.hitsTaken=1;totalTime=9.1;combatDirector.update(.05);
    localStorage.setItem=()=>{throw Error('storage denied')};
    const save=combatDirector.playerLearner.save();
    return JSON.stringify({save,model:window.getNeonPlayerLearner(),canSpawn:!!combatDirector});
  })()`));
  assert.equal(p.save,false);
  assert.equal(p.model.trainedWindows,1);
  assert.equal(p.canSpawn,true);
});

test('Gameplay V2 MLP1 never alters adaptive boss precedence, tokens, or actual spawn profile',()=>{
  const a=setup({}, {locationSearch:'?tempo=adaptive'});
  const b=setup({}, {locationSearch:'?tempo=adaptive&learn=on'});
  const expr=`(() => {
    startNewGame();wave=8;totalTime=25;nextBossTime=1000;
    const observer=combatDirector.intensityObserver;
    observer.setPreview('SUSTAIN');observer.previewAge=1;
    combatDirector.tokens=4;
    combatDirector.update(.05);
    return JSON.stringify({profile:combatDirector.profile,
      tokens:combatDirector.tokens,phase:combatDirector.profile.phase,
      bossAt:nextBossTime,learning:combatDirector.playerLearner.enabled});
  })()`;
  const normal=JSON.parse(a.run(expr)),learning=JSON.parse(b.run(expr));
  assert.equal(normal.learning,false);
  assert.equal(learning.learning,true);
  assert.deepEqual(normal.profile,learning.profile);
  assert.equal(normal.tokens,learning.tokens);
  assert.equal(normal.bossAt,learning.bossAt);
});

test('Gameplay V2 MLP1 reset clears weights without disturbing graphics, meta or G3 A/B records',()=>{
  const storage={};
  const {run}=setup(storage,{locationSearch:'?learn=on'});
  const r=JSON.parse(run(`(() => {
    startNewGame();nextBossTime=1000;totalTime=1;combatDirector.update(.05);
    runMetrics.hitsTaken=1;totalTime=9.1;combatDirector.update(.05);
    const learned=window.getNeonPlayerLearner();
    const cleared=window.clearNeonPlayerLearner();
    const fresh=window.getNeonPlayerLearner();
    return JSON.stringify({learned,cleared,fresh});
  })()`));
  assert.equal(r.learned.trainedWindows,1);
  assert.equal(r.cleared,true);
  assert.equal(r.fresh.trainedWindows,0);
  assert.ok(r.fresh.weights.every(x=>x===0));
  assert.equal(storage['neonCekirdek.playerLearner.v1'],'');
  assert.ok(!Object.hasOwn(storage,'neonCekirdek.tempoCompare.v1'));
});


test('upgrade Fisher-Yates shuffle reaches all six three-item permutations', () => {
  const { run } = setup();
  const result = JSON.parse(run(`(() => {
    const permutations = new Set();
    const originalRandom = rng;
    let sameReference = true;
    try {
      for (let first = 0; first < 3; first++) {
        for (let second = 0; second < 2; second++) {
          const draws = [(first + .5) / 3, (second + .5) / 2];
          let drawIndex = 0;
          rng = () => draws[drawIndex++];
          const sample = [0, 1, 2];
          const returned = shuffleInPlace(sample);
          sameReference = sameReference && returned === sample;
          permutations.add(sample.join(','));
        }
      }
    } finally {
      rng = originalRandom;
    }
    return JSON.stringify({ permutations: [...permutations].sort(), sameReference });
  })()`));
  assert.equal(result.sameReference, true);
  assert.deepEqual(result.permutations, [
    '0,1,2', '0,2,1', '1,0,2', '1,2,0', '2,0,1', '2,1,0'
  ]);
});

test('upgrade draft keeps evolution priority, unique eligible cards and original pool', () => {
  const { run } = setup();
  const result = JSON.parse(run(`(() => {
    startNewGame();
    // Full weapon and passive slots: only owned cards and multishot remain.
    player.upgradeCounts = { orbital: 3, lightning: 3, homing: 2, multishot: 0,
      pierce_ricochet: 3, crit_mastery: 3, aegis_shield: 3, firerate: 1, vampiric: 1 };
    const originalIds = UPGRADES_POOL.map(u => u.id);
    const originalRandom = rng;
    try {
      rng = () => 0;
      populateUpgradeCards();
    } finally {
      rng = originalRandom;
    }
    return JSON.stringify({
      offered: currentUpgradeChoices.map(choice => choice.upg.id),
      rarities: currentUpgradeChoices.map(choice => choice.rarity.id),
      poolUnchanged: UPGRADES_POOL.every((u, i) => u.id === originalIds[i]),
      completedOffered: currentUpgradeChoices.some(choice =>
        player.upgradeCounts[choice.upg.id] >= MAX_MODULE_TIER)
    });
  })()`));
  assert.equal(result.offered.length, 3);
  assert.equal(result.offered[0], 'homing');
  assert.equal(new Set(result.offered).size, 3);
  assert.equal(result.completedOffered, false);
  assert.equal(result.poolUnchanged, true);
  assert.deepEqual(result.rarities, ['COMMON', 'COMMON', 'COMMON']);
});


test('static page loads extracted CSS and classic game script in the correct order', () => {
  assert.match(pageHtml, /<link rel="stylesheet" href="\.\/src\/game\.css">/);
  assert.match(pageHtml, /<script src="\.\/src\/game\.js"><\/script>/);
  assert.equal(pageHtml.includes('class Player'), false);
  assert.ok(gameCss.includes('#gameCanvas'));
  assert.ok(gameCode.includes('window.onload = function'));
});

test('portable save backup round-trips meta and graphics with strict schema', () => {
  const { run, stored } = setup();
  const result = JSON.parse(run(`(() => {
    savedHighScore = 7450; savedMaxWave = 19; totalGold = 250;
    metaUpgrades.baseDamage = 7;
    metaUpgrades.defibrillator = 1;
    applyGraphicsQuality('low', false);
    const backup = JSON.stringify(createProgressBackup());
    savedHighScore = 0; savedMaxWave = 1; totalGold = 0;
    metaUpgrades.baseDamage = 0; metaUpgrades.defibrillator = 0;
    applyGraphicsQuality('high', false);
    const restored = restoreProgressBackup(backup);
    return JSON.stringify({
      restored, gold: totalGold, score: savedHighScore, wave: savedMaxWave,
      baseDamage: metaUpgrades.baseDamage, defibrillator: metaUpgrades.defibrillator,
      graphics: graphicsQuality, backup: JSON.parse(backup)
    });
  })()`));
  assert.equal(result.restored, true);
  assert.equal(result.gold, 250);
  assert.equal(result.score, 7450);
  assert.equal(result.wave, 19);
  assert.equal(result.baseDamage, 7);
  assert.equal(result.defibrillator, 1);
  assert.equal(result.graphics, 'low');
  assert.equal(result.backup.format, 'neon-cekirdek-progress');
  assert.equal(result.backup.version, 1);
  assert.equal(JSON.parse(stored['neonCekirdek.meta.v1']).gold, 250);
  assert.equal(stored['neonCekirdek.graphics.v1'], 'low');
  assert.ok(!JSON.stringify(result.backup).includes('playerLearner'));
});

test('portable backup rejects invalid, oversized or in-game replacements without changes', () => {
  const { run, stored } = setup();
  const checks = JSON.parse(run(`(() => {
    totalGold = 444;
    const valid = JSON.stringify(createProgressBackup());
    const wrong = JSON.parse(valid);
    wrong.progress.gold = -5;
    const invalid = restoreProgressBackup(JSON.stringify(wrong));
    const oversize = restoreProgressBackup(valid + ' '.repeat(17000));
    const unknownVersion = restoreProgressBackup(valid.replace('neon-cekirdek-progress', 'alien-save'));
    startNewGame();
    const duringGame = restoreProgressBackup(valid);
    return JSON.stringify({ invalid, oversize, unknownVersion, duringGame, gold:totalGold });
  })()`));
  assert.deepEqual(checks, { invalid:false, oversize:false, unknownVersion:false, duringGame:false, gold:444 });
  assert.equal(stored['neonCekirdek.meta.v1'], undefined);
});

test('portable backup rolls back persistence on partial storage failure', () => {
  const stored = {};
  const { run } = setup(stored);
  const result = JSON.parse(run(`(() => {
    totalGold = 360;
    const valid = JSON.stringify(createProgressBackup());
    const previous = JSON.stringify({version:1, gold:22, highScore:2, maxWave:1,
      upgrades:{baseDamage:0,maxHp:0,speedDash:0,greed:0,defibrillator:0}});
    localStorage.setItem(META_SAVE_KEY,previous);
    localStorage.setItem(GRAPHICS_SAVE_KEY,'high');
    const original=localStorage.setItem;
    localStorage.setItem=(key,value) => {
      if (key===GRAPHICS_SAVE_KEY && value==='low') throw Error('quota');
      return original(key,value);
    };
    const updated=JSON.parse(valid);
    updated.graphics='low';
    const ok=restoreProgressBackup(JSON.stringify(updated));
    localStorage.setItem=original;
    return JSON.stringify({ok,liveGold:totalGold,
      savedGold:JSON.parse(localStorage.getItem(META_SAVE_KEY)).gold,
      graphics:localStorage.getItem(GRAPHICS_SAVE_KEY)});
  })()`));
  assert.deepEqual(result,{ok:false,liveGold:360,savedGold:22,graphics:'high'});
});

test('offline static styles, icon assets and font files are shipped locally', () => {
  assert.doesNotMatch(pageHtml, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/);
  assert.match(pageHtml, /src\/utilities\.css/);
  assert.match(pageHtml, /src\/vendor\/fontawesome\/css\/all\.min\.css/);
  assert.match(pageHtml, /src\/vendor\/fonts\.css/);
  const asset = name => fs.statSync(path.join(__dirname, '..', name)).size;
  assert.ok(asset('src/utilities.css') > 10000);
  assert.ok(asset('src/vendor/fontawesome/css/all.min.css') > 10000);
  assert.ok(asset('src/vendor/fontawesome/webfonts/fa-solid-900.woff2') > 10000);
  assert.ok(asset('src/vendor/fonts/orbitron-latin-700-normal.woff2') > 1000);
  assert.ok(asset('src/vendor/fonts/rajdhani-latin-600-normal.woff2') > 1000);
});


test('PINWHEEL wave16 gate and BLACKOUT early unlock preserve old formations', () => {
  const {run}=setup();
  const info=JSON.parse(run("(()=>{const before=getSpecialEncounterKinds(15).map(x=>x.type);const at16=getSpecialEncounterKinds(16).map(x=>x.type);activeContractId='BLACKOUT';const early=getSpecialEncounterKinds(15).map(x=>x.type);return JSON.stringify({before,at16,early});})()"));
  assert.equal(info.before.includes('PINWHEEL'),false);
  assert.equal(info.at16.at(-1),'PINWHEEL');
  assert.deepEqual(info.early,info.at16);
});

test('PINWHEEL offers four roles on four unique sides and weak SWARM escape', () => {
  const {run}=setup();
  const plans=JSON.parse(run("JSON.stringify([0,1,2,3].map(side=>{const p=getSpecialEncounterPlan(16,'HUNT',side,7);return {type:p.type,label:p.label,side,warning:p.warning,roles:p.units.map(u=>u.type),sides:p.units.map(u=>u.side),cost:p.threatCost,realCost:p.units.reduce((n,u)=>n+ENEMY_THREAT_COST[u.type],0)};}))"));
  for(const p of plans) {
    assert.equal(p.type,'PINWHEEL');
    assert.equal(p.label,'DÖRT CEPHE KIRILMASI');
    assert.equal(p.warning,1.65);
    assert.deepEqual(p.roles,['SHIELD_BEARER','SHOOTER','DASHER','SWARM']);
    assert.deepEqual(p.sides,[p.side,(p.side+1)%4,(p.side+2)%4,(p.side+3)%4]);
    assert.equal(new Set(p.sides).size,4);
    assert.ok(Math.abs(p.cost-7.6)<.001 && Math.abs(p.realCost-p.cost)<.001);
  }
});

test('PINWHEEL actual Director respects warning, threat budget and boss cancellation', () => {
  const {run}=setup();
  const out=JSON.parse(run("(()=>{startNewGame();wave=16;totalTime=40;nextBossTime=500;combatDirector.encounterIndex=7;combatDirector.nextEncounterAt=0;combatDirector.tokens=14;combatDirector.update(.02);const kind=combatDirector.pendingEncounter.type;const blocked=combatDirector.trySpawn();combatDirector.update(1.7);const a=combatDirector.getDiagnostics().specialByKind.PINWHEEL;const first={kind,blocked,spawned:enemies.length,spent:a.tokensSpent,units:a.units,offered:a.offered,resolved:a.resolved,left:combatDirector.tokens};startNewGame();wave=16;totalTime=40;nextBossTime=500;combatDirector.encounterIndex=7;combatDirector.nextEncounterAt=0;combatDirector.tokens=14;combatDirector.update(.02);combatDirector.onBossEncounter();return JSON.stringify({first,pending:combatDirector.pendingEncounter,cancel:combatDirector.getDiagnostics().specialByKind.PINWHEEL});})()"));
  assert.equal(out.first.kind,'PINWHEEL');
  assert.equal(out.first.blocked,false);
  assert.equal(out.first.spawned,4);
  assert.equal(out.first.spent,7.6);
  assert.equal(out.first.units,4);
  assert.equal(out.first.offered,1);
  assert.equal(out.first.resolved,1);
  assert.ok(out.first.left>=0 && out.first.left<14);
  assert.equal(out.pending,null);
  assert.equal(out.cancel.cancelled,1);
  assert.equal(out.cancel.units,0);
  assert.equal(out.cancel.tokensSpent,0);
});

test('tactical encounter plans expose readable role links without changing threat cost', () => {
 const {run}=setup();
 const info=JSON.parse(run("(()=>{const p=getSpecialEncounterPlan(8,'SIEGE',0,2);return JSON.stringify({type:p.type,formation:p.formationId,roles:p.units.map(u=>u.role),cost:p.threatCost,real:p.units.reduce((n,u)=>n+ENEMY_THREAT_COST[u.type],0)});})()"));
 assert.equal(info.type,'ESCORT');
 assert.match(info.formation,/^ESCORT:8:0:2$/);
 assert.deepEqual(info.roles,['screen','guard','payload','screen']);
 assert.equal(info.cost,info.real);
});

test('escort formations attach shield and payload enemies to one tactical link', () => {
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();const shield=new Enemy(380,300,'SHIELD_BEARER',false,{formationId:'ESCORT:8:0:2',role:'guard'});const sniper=new Enemy(520,300,'SNIPER',false,{formationId:'ESCORT:8:0:2',role:'payload'});enemies=[shield,sniper];player.x=120;player.y=300;const point=getTacticalCoverPoint(sniper);shield.dead=true;const after=getTacticalCoverPoint(sniper);return JSON.stringify({shieldRole:shield.tacticalRole,payloadRole:sniper.tacticalRole,point,after});})()"));
 assert.equal(out.shieldRole,'guard');
 assert.equal(out.payloadRole,'payload');
 assert.ok(out.point && out.point.x>out.shieldRole.length);
 assert.equal(out.after,null);
});

test('tactical link renderer is cosmetic and safe with a live escort', () => {
 const calls=[];
 const context=new Proxy({}, { get(_,key) { return (...args)=>calls.push({kind:String(key),args}); } });
 const {run}=setup({}, {canvasContext:context});
 run("(()=>{startNewGame();gameState='PLAYING';const shield=new Enemy(380,300,'SHIELD_BEARER',false,{formationId:'LINK',role:'guard'});const shooter=new Enemy(520,300,'SHOOTER',false,{formationId:'LINK',role:'payload'});enemies=[shield,shooter];drawTacticalLinks();})()");
 assert.ok(calls.some(x=>x.kind==='lineTo'));
 assert.ok(calls.some(x=>x.kind==='stroke'));
});

test('tactical cover changes formation positioning but not enemy combat stats', () => {
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();player.x=100;player.y=300;const plain=new Enemy(700,300,'SHOOTER');const shield=new Enemy(300,300,'SHIELD_BEARER',false,{formationId:'T',role:'guard'});const linked=new Enemy(700,300,'SHOOTER',false,{formationId:'T',role:'payload'});enemies=[shield,linked];const before={x:linked.x,hp:linked.maxHp,damage:linked.damage,speed:linked.speed};linked.update(.1);return JSON.stringify({moved:linked.x<before.x,stats:{hp:linked.maxHp,damage:linked.damage,speed:linked.speed},plain:{hp:plain.maxHp,damage:plain.damage,speed:plain.speed}});})()"));
 assert.equal(out.moved,true);
 assert.deepEqual(out.stats,out.plain);
});

test('flank roles approach from mirrored tangential angles without changing speed', () => {
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();const a=new Enemy(100,300,'DASHER',false,{formationId:'F',role:'flank',side:0,slot:0});const b=new Enemy(100,300,'DASHER',false,{formationId:'F',role:'flank',side:0,slot:1});const plain=new Enemy(100,300,'DASHER');const va=getTacticalFlankVector(a,300,0,300);const vb=getTacticalFlankVector(b,300,0,300);return JSON.stringify({a:va,b:vb,plain:{x:plain.speed},speedA:a.speed,speedB:b.speed});})()"));
 assert.ok(out.a.y * out.b.y < 0);
 assert.ok(Math.abs(out.a.x)>0.5 && Math.abs(out.b.x)>0.5);
 assert.equal(out.speedA,out.plain.x);
 assert.equal(out.speedB,out.plain.x);
});

test('special warning previews tactical roles at the incoming edge', () => {
 const calls=[];
 const context=new Proxy({}, { get(_,key) { return (...args)=>calls.push({kind:String(key),args}); } });
 const {run}=setup({}, {canvasContext:context});
 run("(()=>{startNewGame();gameState='PLAYING';graphicsQuality='high';combatDirector.pendingEncounter=getSpecialEncounterPlan(8,'SIEGE',0,2);drawSpecialEncounterWarning();})()");
 const labels=calls.filter(x=>x.kind==='fillText').map(x=>String(x.args[0]));
 assert.ok(labels.some(label=>label.includes('KALKAN')));
 assert.ok(labels.some(label=>label.includes('MENZIL')));
});

test('low graphics profile keeps the tactical warning readable without role text', () => {
 const calls=[];
 const context=new Proxy({}, { get(_,key) { return (...args)=>calls.push({kind:String(key),args}); } });
 const {run}=setup({}, {canvasContext:context});
 run("(()=>{startNewGame();gameState='PLAYING';graphicsQuality='low';combatDirector.pendingEncounter=getSpecialEncounterPlan(8,'SIEGE',0,2);drawSpecialEncounterWarning();})()");
 const labels=calls.filter(x=>x.kind==='fillText').map(x=>String(x.args[0]));
 assert.equal(labels.some(label=>label.includes('KALKAN') || label.includes('MENZIL')),false);
 assert.ok(labels.some(label=>label.includes('KESK')) || labels.some(label=>label.includes('KOR')));
});

test('tactical HUD hint follows pending and live formation state, then hides after guard death', () => {
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();const plan=getSpecialEncounterPlan(8,'SIEGE',0,2);combatDirector.pendingEncounter=plan;const pending=getTacticalHintState();combatDirector.pendingEncounter=null;const guard=new Enemy(300,300,'SHIELD_BEARER',false,{formationId:'H',role:'guard'});const payload=new Enemy(420,300,'SNIPER',false,{formationId:'H',role:'payload'});enemies=[guard,payload];const live=getTacticalHintState();guard.dead=true;const gone=getTacticalHintState();return JSON.stringify({pending,live,gone});})()"));
 assert.equal(out.pending.kind,'guard');
 assert.match(out.pending.text,/KALKAN/);
 assert.equal(out.live.kind,'guard');
 assert.equal(out.gone,null);
});

test('tactical HUD hint markup and reduced-motion-safe styling are present',()=>{
 assert.match(html,/id="tacticalHintBadge"/);
 assert.match(gameCss,/\.tactical-hint-badge/);
 assert.match(gameCss,/prefers-reduced-motion/);
});


test('spatial Director returns legacy random side without enough trustworthy movement', () => {
  const { run } = setup();
  const states = JSON.parse(run("(()=>{startNewGame();wave=16;player.x=worldWidth/2;player.y=worldHeight/2;return JSON.stringify([scoreTacticalDeployment(16,'HUNT',7,3,{vx:0,vy:0,tracked:3},null),scoreTacticalDeployment(16,'HUNT',7,2,{vx:250,vy:0,tracked:.25},null)]);})()"));
  assert.equal(states[0].side,3);
  assert.equal(states[1].side,2);
  assert.ok(states.every(x=>x.mode==='unobserved'));
});

test('spatial Director rotates PINWHEEL weaker escape towards observed player path', () => {
  const { run } = setup();
  const results=JSON.parse(run("(()=>{startNewGame();wave=16;player.x=worldWidth/2;player.y=worldHeight/2;const east=scoreTacticalDeployment(16,'HUNT',7,0,{vx:260,vy:0,tracked:2},null);const west=scoreTacticalDeployment(16,'HUNT',7,0,{vx:-260,vy:0,tracked:2},null);const e=getSpecialEncounterPlan(16,'HUNT',east.side,7).units.find(u=>u.role==='escape').side;const w=getSpecialEncounterPlan(16,'HUNT',west.side,7).units.find(u=>u.role==='escape').side;return JSON.stringify({east,west,e,w});})()"));
  assert.equal(results.east.mode,'reading-motion');
  assert.equal(results.west.mode,'reading-motion');
  assert.equal(results.e,1);
  assert.equal(results.w,3);
  assert.ok(results.east.clearance>0 && results.west.clearance>0);
});

test('spatial Director avoids nearby and crowded spawn candidates without extra tokens', () => {
  const { run } = setup();
  const result=JSON.parse(run("(()=>{startNewGame();wave=16;player.x=35;player.y=worldHeight/2;enemies=[new Enemy(-30,worldHeight/2,'SWARM'),new Enemy(-45,worldHeight/2,'SWARM')];const result=scoreTacticalDeployment(16,'HUNT',7,0,{vx:-240,vy:0,tracked:2},null);const distances=[0,1,2,3].map(s=>{const p=getSpecialEncounterPlan(16,'HUNT',s,7);return Math.min(...p.units.map(u=>{const q=formationEdgePoint(u.side,u.slot,u.count);return Math.hypot(q.x-player.x,q.y-player.y);}));});return JSON.stringify({result,distances});})()"));
  assert.equal(result.result.mode,'safe-retreat');
  assert.equal(result.result.clearance,Math.round(Math.max(...result.distances)));
});

test('spatial Director records motion and diagnostic decision only when offering a real raid', () => {
  const {run}=setup();
  const record=JSON.parse(run("(()=>{startNewGame();wave=16;totalTime=30;nextBossTime=500;combatDirector.tokens=14;combatDirector.nextEncounterAt=500;player.vx=230;player.vy=0;for(let i=0;i<26;i++)combatDirector.update(.05);combatDirector.nextEncounterAt=0;combatDirector.encounterIndex=7;combatDirector.update(.02);const p=combatDirector.pendingEncounter;const d=combatDirector.getDiagnostics();return JSON.stringify({p:p&&{side:p.side,kind:p.type,placement:p.placement,threatCost:p.threatCost},diag:d.tacticalPlacement,enemyCount:enemies.length,tokens:d.threatTokens});})()"));
  assert.equal(record.p.kind,'PINWHEEL');
  assert.equal(record.p.placement.mode,'reading-motion');
  assert.equal(record.p.side,record.diag.side);
  assert.equal(record.enemyCount,0);
  assert.equal(record.p.threatCost,7.6);
  assert.equal(record.tokens,14);
});

test('linked squad ranged attacks use staggered fire slots; normals and bosses do not', () => {
  const {run}=setup();
  const result=JSON.parse(run("(()=>{startNewGame();totalTime=20;const a=new Enemy(100,100,'SHOOTER',false,{formationId:'A',role:'payload'});const b=new Enemy(200,100,'SHOOTER',false,{formationId:'A',role:'payload'});const solo=new Enemy(200,100,'SHOOTER');enemies=[a,b,solo];const first=combatDirector.claimSquadVolley(a);const denied=combatDirector.claimSquadVolley(b);const normal=combatDirector.claimSquadVolley(solo);totalTime+=.76;const next=combatDirector.claimSquadVolley(b);a.dead=true;const unlinked=combatDirector.claimSquadVolley(b);return JSON.stringify({first,denied,normal,next,unlinked,count:combatDirector.getDiagnostics().squadShotsDeferred});})()"));
  assert.deepEqual(result,{first:true,denied:false,normal:true,next:true,unlinked:true,count:1});
});

test('real linked shooters delay simultaneous volley rather than adding projectiles', () => {
  const {run}=setup();
  const result=JSON.parse(run("(()=>{startNewGame();wave=8;totalTime=20;player.x=400;player.y=300;const a=new Enemy(330,150,'SHOOTER',false,{formationId:'C',role:'payload'});const b=new Enemy(470,150,'SHOOTER',false,{formationId:'C',role:'payload'});a.actionTimer=0;b.actionTimer=0;enemies=[a,b];a.update(.016);const afterA=enemyProjectiles.length;b.update(.016);const afterB=enemyProjectiles.length;totalTime+=.76;b.update(.016);return JSON.stringify({afterA,afterB,afterDelay:enemyProjectiles.length,denied:combatDirector.stats.squadShotsDeferred,unmodifiedDamage:a.damage===b.damage});})()"));
  assert.equal(result.afterA,3);
  assert.equal(result.afterB,3);
  assert.equal(result.afterDelay,6);
  assert.equal(result.denied,1);
  assert.equal(result.unmodifiedDamage,true);
});


test('idle player at arena edge gets safe entrance instead of unsafe random flank', () => {
  const {run}=setup();
  const data=JSON.parse(run("(()=>{startNewGame();wave=8;player.x=30;player.y=worldHeight/2;const chosen=scoreTacticalDeployment(8,'SIEGE',1,3,{vx:0,vy:0,tracked:3},null);const blocked=getSpecialEncounterPlan(8,'SIEGE',3,1);const unsafe=Math.min(...blocked.units.map(u=>{const q=formationEdgePoint(u.side,u.slot,u.count);return Math.hypot(q.x-player.x,q.y-player.y);}));return JSON.stringify({chosen,unsafe});})()"));
  assert.equal(data.chosen.mode,'safety-only');
  assert.notEqual(data.chosen.side,3);
  assert.ok(data.chosen.clearance>data.unsafe+80);
});


test('M5.13 spatial crowd pairs peel apart instead of remaining one horizontal collision queue', () => {
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();player.x=820;player.y=300;const a=new Enemy(260,300,'SWARM');const b=new Enemy(278,300,'SWARM');a.speed=180;b.speed=180;enemies=[a,b];const initial=Math.hypot(a.x-b.x,a.y-b.y);const sampled=sampleEnemyCrowdSteering(.2);const beforeA={x:a.x,y:a.y},beforeB={x:b.x,y:b.y};a.update(.05);b.update(.05);return JSON.stringify({sampled,initial,dist:Math.hypot(a.x-b.x,a.y-b.y),aSide:a.y-beforeA.y,bSide:b.y-beforeB.y,travelA:Math.hypot(a.x-beforeA.x,a.y-beforeA.y),expectedA:a.speed*.05,snapshot:getEnemyCrowdSteeringSnapshot()});})()"));
  assert.equal(x.sampled,true);
  assert.ok(x.dist>x.initial,'nearby enemies should move apart in the same target lane');
  assert.ok(x.aSide*x.bSide<0,'close agents must take mirrored lateral lanes');
  assert.ok(Math.abs(x.travelA-x.expectedA)<.001,'do not silently buff movement speed');
  assert.ok(x.snapshot.steered>=2);
});

test('M5.13 no crowd influence when neighbors are far; bosses, GRAV_WELL and kamikaze keep original behavior',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();player.x=850;player.y=300;const a=new Enemy(120,300,'SWARM');const far=new Enemy(460,300,'SWARM');const boss=new Enemy(110,300,'BOSS_TITAN');const grav=new Enemy(110,300,'GRAV_WELL');const kam=new Enemy(110,300,'KAMIKAZE');enemies=[a,far,boss,grav,kam];sampleEnemyCrowdSteering(.2);return JSON.stringify({swarm:[a.crowdSteerX,a.crowdSteerY],boss:[boss.crowdSteerX,boss.crowdSteerY],grav:[grav.crowdSteerX,grav.crowdSteerY],kam:[kam.crowdSteerX,kam.crowdSteerY]});})()"));
  assert.deepEqual(x.swarm,[0,0]);
  assert.deepEqual(x.boss,[0,0]);
  assert.deepEqual(x.grav,[0,0]);
  assert.deepEqual(x.kam,[0,0]);
});

test('M5.13 steering is sampled sparsely and has bounded per-agent neighbor scans under full enemy cap',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();player.x=760;player.y=520;enemies=Array.from({length:160},()=>new Enemy(260,280,'SWARM'));const once=sampleEnemyCrowdSteering(.08);const twice=sampleEnemyCrowdSteering(.08);const thrice=sampleEnemyCrowdSteering(.03);const snap=getEnemyCrowdSteeringSnapshot();return JSON.stringify({once,twice,thrice,snap,units:enemies.length});})()"));
  assert.deepEqual([x.once,x.twice,x.thrice],[false,false,true]);
  assert.equal(x.snap.samples,1);
  assert.equal(x.snap.agents,160);
  assert.ok(x.snap.checks<=160*18,'maximum bounded neighbor probes per spatial sample');
  assert.equal(x.snap.peakCell,160);
});

test('M5.13 dasher lunge and boss special movement ignore crowd influence',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();player.x=700;player.y=300;const a=new Enemy(240,300,'DASHER');a.state='LUNGE';a.actionTimer=.25;a.dashTargetAngle=0;a.crowdSteerX=0;a.crowdSteerY=0.38;const s={x:a.x,y:a.y};a.update(.02);const b=new Enemy(240,300,'BOSS_PRISM');const x0=b.x;b.crowdSteerX=0;b.crowdSteerY=.38;b.update(.02);return JSON.stringify({dashX:a.x-s.x,dashY:a.y-s.y,bossMoved:b.x-x0,bossSteer:b.crowdSteerY});})()"));
  assert.ok(x.dashX>0);
  assert.ok(Math.abs(x.dashY)<.001,'telegraphed lunge must not curve toward crowd steering');
  assert.ok(x.bossMoved!==0);
});

test('M5.13 flankers predict trusted player movement, ordinary AI and unobserved motion remain unchanged',()=>{
  const {run}=setup();
  const x=JSON.parse(run("(()=>{startNewGame();player.x=500;player.y=300;const flank=new Enemy(120,300,'DASHER',false,{formationId:'F',role:'flank',side:0,slot:0});const plain=new Enemy(120,300,'DASHER');const initial=getTacticalFlankVector(flank,380,0,380);combatDirector.tacticalMotion={vx:0,vy:240,tracked:2};const predicted=getTacticalFlankVector(flank,380,0,380);const normal=getTacticalFlankVector(plain,380,0,380);combatDirector.tacticalMotion.tracked=.2;const unobserved=getTacticalFlankVector(flank,380,0,380);return JSON.stringify({initial,predicted,normal,unobserved});})()"));
  assert.ok(Math.abs(x.predicted.y-x.initial.y)>.02);
  assert.deepEqual(x.normal,{x:1,y:0});
  assert.deepEqual(x.unobserved,x.initial);
});

test('M5.13 run reset clears crowd telemetry and no steering persists into a new session',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();player.x=700;enemies=[new Enemy(250,300,'SWARM'),new Enemy(260,300,'SWARM')];sampleEnemyCrowdSteering(.2);const old=getEnemyCrowdSteeringSnapshot();startNewGame();const now=getEnemyCrowdSteeringSnapshot();return JSON.stringify({old,now});})()"));
 assert.equal(x.old.samples,1);
 assert.equal(x.now.samples,0);
 assert.equal(x.now.checks,0);
 assert.equal(x.now.agents,0);
});


test('M5.14 gold bastion cannot be purchased before wave four or in menus', () => {
 const {run}=setup();
 const out=JSON.parse(run("(()=>{const before=getBastionStatus();startNewGame();totalGold=500;const early=getBastionStatus();const denied=deployBastion();return JSON.stringify({before,early,denied,wallet:totalGold});})()"));
 assert.equal(out.before.available,false);
 assert.equal(out.early.reason,'locked');
 assert.equal(out.denied,false);
 assert.equal(out.wallet,500);
});

test('M5.14 gold-only fixed defense purchases exactly once and never alters card progression',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();wave=8;nextBossTime=500;totalGold=300;player.x=190;player.y=235;const initial=JSON.stringify(player.upgradeCounts);const first=deployBastion();const second=deployBastion();return JSON.stringify({first,second,cost:getBastionCost(),wallet:totalGold,uses:bastionUses,location:{x:bastion.x,y:bastion.y},saved:JSON.parse(localStorage.getItem(META_SAVE_KEY)).gold,cardUnchanged:JSON.stringify(player.upgradeCounts)===initial,rerollCost,diag:combatDirector.getDiagnostics().bastion});})()"));
 assert.equal(out.first,true);
 assert.equal(out.second,false);
 assert.equal(out.wallet,230);
 assert.equal(out.saved,230);
 assert.equal(out.uses,1);
 assert.deepEqual(out.location,{x:190,y:235});
 assert.equal(out.cardUnchanged,true);
 assert.equal(out.rerollCost,15);
 assert.equal(out.diag.goldSpent,70);
 assert.equal(out.diag.remaining,2);
});

test('M5.14 bastion intercepts entering enemy projectiles only, including swept fast crossings',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();wave=8;nextBossTime=500;totalGold=300;player.x=420;player.y=330;deployBastion();const enter=new EnemyProjectile(620,330,-900,0,6,23);enter.update(.2);const fast=new EnemyProjectile(640,330,-3000,0,5,23);fast.update(.2);const inside=new EnemyProjectile(420,330,300,0,6,23);inside.update(.1);const miss=new EnemyProjectile(620,500,-900,0,6,23);miss.update(.2);const results=[bastionIntercepts(enter),bastionIntercepts(fast),bastionIntercepts(inside),bastionIntercepts(miss)];return JSON.stringify({results,damage:enter.damage,insideOrigin:inside.previousX===420});})()"));
 assert.deepEqual(out.results,[true,true,false,false]);
 assert.equal(out.damage,23);
 assert.equal(out.insideOrigin,true);
});

test('M5.14 real simulation uses the shield before projectile-player collision and records spending',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();wave=8;nextBossTime=500;totalGold=300;player.x=420;player.y=330;deployBastion();const hp=player.hp;enemyProjectiles=[new EnemyProjectile(560,330,-600,0,6,38)];const d=enemyProjectiles[0];d.update(.05);if(bastionIntercepts(d)){d.dead=true;bastion.blocked++;bastionShotsBlocked++;}return JSON.stringify({gone:d.dead,hp,now:player.hp,cost:getBastionStatus().goldSpent,economy:combatDirector.getEconomySnapshot().fieldDefense,card:currentUpgradeChoices.length});})()"));
 assert.equal(out.gone,true);
 assert.equal(out.now,out.hp);
 assert.equal(out.cost,70);
 assert.deepEqual(out.economy,{uses:1,goldSpent:70,shotsBlocked:1});
 assert.equal(out.card,0);
});

test('M5.14 defense expires, has independent cooldown and boss protection',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();wave=8;nextBossTime=500;totalGold=1000;deployBastion();const expiry=bastion.expiresAt;totalTime=expiry+.01;updateBastion();const expired=getBastionStatus();totalTime=33;const ready=getBastionStatus();nextBossTime=40;const bossDenied=deployBastion();nextBossTime=500;const second=deployBastion();return JSON.stringify({expired,ready,bossDenied,second,wallet:totalGold});})()"));
 assert.equal(out.expired.active,false);
 assert.equal(out.expired.reason,'cooldown');
 assert.equal(out.ready.available,true);
 assert.equal(out.bossDenied,false);
 assert.equal(out.second,true);
 assert.equal(out.wallet,820);
});

test('M5.14 usage cap and fresh run reset prevent unlimited defensive purchase',()=>{
 const {run}=setup();
 const out=JSON.parse(run("(()=>{startNewGame();wave=8;nextBossTime=1000;totalGold=1000;const purchases=[];for(let i=0;i<4;i++){totalTime=i*40;updateBastion();purchases.push(deployBastion());}const spent=bastionGoldSpent,locked=getBastionStatus();startNewGame();return JSON.stringify({purchases,spent,locked,newRun:getBastionStatus()});})()"));
 assert.deepEqual(out.purchases,[true,true,true,false]);
 assert.equal(out.spent,330);
 assert.equal(out.locked.reason,'used-up');
 assert.equal(out.newRun.uses,0);
 assert.equal(out.newRun.goldSpent,0);
 assert.equal(out.newRun.shotsBlocked,0);
});

test('M5.14 bastion draw is graphics-only and HUD provides independent button state',()=>{
 const calls=[];
 const ctx=new Proxy({}, { get(_obj,key) {return (...args)=>calls.push(String(key));} });
 const {run}=setup({}, {canvasContext:ctx});
 const out=JSON.parse(run("(()=>{startNewGame();wave=8;nextBossTime=500;totalGold=200;updateBastionHud();const before=document.getElementById('bastionBtn').disabled;deployBastion();updateBastionHud();drawBastion(ctx);return JSON.stringify({before,after:document.getElementById('bastionBtn').disabled,label:document.getElementById('bastionStatus').textContent});})()"));
 assert.equal(out.before,false);
 assert.equal(out.after,true);
 assert.match(out.label,/8s/);
 assert.ok(calls.includes('arc'));
 assert.ok(calls.includes('stroke'));
 assert.match(html,/id="bastionBtn"/);
});


test('M5.15 Phase Echo stays selectable after 13th card and build guide reflects dynamic tiers',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();const card=UPGRADES_POOL.find(u=>u.id==='phase_echo');const pool=UPGRADES_POOL.length;const guide=getBuildGuideModel(player);return JSON.stringify({pool,cardName:card.name,role:getUpgradeCardPresentation(card,RARITIES[0],0).role,evo:EVOLUTION_DEFS.phase_echo.name,guide:guide.totalTiers});})()"));
 assert.equal(d.pool,UPGRADE_IDS.length);
 assert.equal(d.cardName,'Faz Yankısı');
 assert.equal(d.role,'module');
 assert.equal(d.evo,'Çift Yankı');
 assert.equal(d.guide,0);
 assert.match(gameCode,/UPGRADES_POOL\.length \* MAX_MODULE_TIER/);
});

test('M5.15 dash creates a bounded hologram that redirects at most six nearby melee foes',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();gameState='PLAYING';player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();player.x=350;player.y=300;enemies=Array.from({length:12},(_,i)=>new Enemy(360+i*3,300,'SWARM'));const original={x:player.x,y:player.y};player.triggerDash();const started=player.isDashing;player.update(.2);const echo=phaseEchoes[0];return JSON.stringify({started,deployed:phaseEchoes.length,origin:{x:echo.x,y:echo.y},playerMoved:player.x!==original.x,targets:echo.targets.length,redirect:getPhaseEchoTarget(enemies[0])!==null,stats:player.buildStats,readyAt:player.phaseEchoReadyAt});})()"));
 assert.equal(d.started,true);
 assert.equal(d.deployed,1);
 assert.deepEqual(d.origin,{x:350,y:300});
 assert.equal(d.playerMoved,true);
 assert.equal(d.targets,6);
 assert.equal(d.redirect,true);
 assert.equal(d.stats.phaseEchoes,1);
 assert.equal(d.stats.phaseEchoTargets,6);
 assert.equal(d.readyAt,6);
});

test('M5.15 Echo never distracts bosses, shooters, specialist flankers or shield guards',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();player.x=400;player.y=300;const types=['SWARM','SNIPER','SHOOTER','ASSASSIN','DASHER','GRAV_WELL','KAMIKAZE','BOSS_PRISM'];enemies=types.map((t,i)=>new Enemy(410,290+i,t));const guard=new Enemy(410,290,'SHIELD_BEARER',false,{formationId:'X',role:'guard'});enemies.push(guard);const deployed=deployPhaseEcho(player,{x:400,y:300});return JSON.stringify({deployed,results:enemies.map(e=>({type:e.type,role:e.tacticalRole||null,redirect:!!getPhaseEchoTarget(e)}))});})()"));
 assert.equal(d.deployed,true);
 assert.deepEqual(d.results.filter(e=>e.redirect).map(e=>e.type),['SWARM']);
});

test('M5.15 redirect changes existing chase aim but never changes enemy speed or player gold',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();player.x=650;player.y=300;player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();const a=new Enemy(400,300,'SWARM');const b=new Enemy(400,300,'SWARM');a.speed=160;b.speed=160;enemies=[a];const deployed=deployPhaseEcho(player,{x:400,y:150});const goldBefore=totalGold;const speed=a.speed;const before={x:a.x,y:a.y};a.update(.1);const after={x:a.x,y:a.y};return JSON.stringify({deployed,before,after,goldBefore,goldAfter:totalGold,speed,afterSpeed:a.speed,lured:!!getPhaseEchoTarget(a),otherTarget:getPhaseEchoTarget(b)});})()"));
 assert.equal(d.deployed,true);
 assert.ok(d.after.y<d.before.y);
 assert.equal(d.goldAfter,d.goldBefore);
 assert.equal(d.afterSpeed,d.speed);
 assert.equal(d.otherTarget,null);
});

test('M5.15 empty cast does not waste cooldown; expired echo stops redirecting',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();const noTarget=deployPhaseEcho(player,{x:300,y:300});const ready=player.phaseEchoReadyAt;const e=new Enemy(320,300,'SWARM');enemies=[e];const deployed=deployPhaseEcho(player,{x:300,y:300});const active=!!getPhaseEchoTarget(e);totalTime=3.0;updatePhaseEchoes();return JSON.stringify({noTarget,ready,deployed,active,expired:phaseEchoes.length,redirect:!!getPhaseEchoTarget(e)});})()"));
 assert.equal(d.noTarget,false);
 assert.equal(d.ready,0);
 assert.equal(d.deployed,true);
 assert.equal(d.active,true);
 assert.equal(d.expired,0);
 assert.equal(d.redirect,false);
});

test('M5.15 tier 1 replaces oldest echo, tier 3 can support two and never three',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();const a=new Enemy(300,300,'SWARM');const b=new Enemy(500,300,'SWARM');enemies=[a,b];deployPhaseEcho(player,{x:300,y:300});totalTime=6.1;deployPhaseEcho(player,{x:500,y:300});const ordinary=phaseEchoes.map(e=>e.x);player.upgradeCounts.phase_echo=3;player.refreshBuildTraits();phaseEchoes=[];player.phaseEchoReadyAt=0;totalTime=10;deployPhaseEcho(player,{x:300,y:300});totalTime=13.1;deployPhaseEcho(player,{x:500,y:300});const evolved=phaseEchoes.map(e=>e.x);totalTime=16.2;deployPhaseEcho(player,{x:300,y:300});return JSON.stringify({ordinary,evolved,cap:phaseEchoes.length,stats:player.buildStats});})()"));
 assert.deepEqual(d.ordinary,[500]);
 assert.deepEqual(d.evolved,[300,500]);
 assert.equal(d.cap,2);
 assert.equal(d.stats.phaseEchoes,5);
});

test('M5.15 new run resets echo state and does not touch altin, cards or reroll prices',()=>{
 const {run}=setup();
 const d=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();enemies=[new Enemy(300,300,'SWARM')];deployPhaseEcho(player,{x:300,y:300});const before=getPhaseEchoSnapshot();const gold=totalGold;const reroll=rerollCost;startNewGame();return JSON.stringify({before,after:getPhaseEchoSnapshot(),gold,afterGold:totalGold,reroll,afterReroll:rerollCost});})()"));
 assert.equal(d.before.active,1);
 assert.equal(d.after.active,0);
 assert.equal(d.after.deployed,0);
 assert.equal(d.gold,d.afterGold);
 assert.equal(d.reroll,d.afterReroll);
});

test('M5.15 high and low graphics draw echo without adding simulation entities',()=>{
 const calls=[];
 const ctx=new Proxy({}, {get(_,key){return (...a)=>calls.push(String(key));}});
 const {run}=setup({}, {canvasContext:ctx});
 const d=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.phase_echo=1;player.refreshBuildTraits();enemies=[new Enemy(300,300,'SWARM')];deployPhaseEcho(player,{x:300,y:300});graphicsQuality='high';drawPhaseEchoes(ctx);graphicsQuality='low';drawPhaseEchoes(ctx);return JSON.stringify({active:getPhaseEchoSnapshot().active,projectiles:enemyProjectiles.length,bullets:bullets.length,upgrades:player.upgradeCounts});})()"));
 assert.ok(calls.filter(c=>c==='arc').length>=4);
 assert.equal(d.active,1);
 assert.equal(d.projectiles,0);
 assert.equal(d.bullets,0);
 assert.equal(d.upgrades.phase_echo,1);
});


test('M5.16 Circuit Weaver card extends pool to 13 without changing gold or existing rarity',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();const a=UPGRADES_POOL.find(u=>u.id==='circuit_weaver');return JSON.stringify({pool:UPGRADES_POOL.length,name:a.name,evo:EVOLUTION_DEFS.circuit_weaver.name,role:getUpgradeCardPresentation(a,RARITIES[0],0).role,stats:player.buildStats.circuitClosures,initialGold:totalGold});})()"));
 assert.equal(s.pool,UPGRADE_IDS.length);
 assert.equal(s.name,'Devre Dokuyucu');
 assert.equal(s.evo,'Yanan Çember');
 assert.equal(s.role,'weapon');
 assert.equal(s.stats,0);
 assert.equal(s.initialGold,50);
});

test('M5.16 reliable polygon geometry accepts interior and rejects exterior regardless of winding',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{const p=[{x:300,y:200},{x:420,y:200},{x:420,y:320},{x:300,y:320}];return JSON.stringify({a:circuitSignedArea(p),inside:circuitContains(p,360,260),out:circuitContains(p,430,260),reverse:circuitContains([...p].reverse(),360,260)});})()"));
 assert.equal(s.a,14400);
 assert.equal(s.inside,true);
 assert.equal(s.out,false);
 assert.equal(s.reverse,true);
});

test('M5.16 tracing a movement rectangle closes circuit and damages only enclosed enemies',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.circuit_weaver=1;player.refreshBuildTraits();player.x=300;player.y=200;const inside=new Enemy(360,260,'TANK'),outside=new Enemy(500,260,'TANK');inside.hp=1000;outside.hp=1000;enemies=[inside,outside];recordCircuitWeaverMotion(player,0,false);const route=[];for(let n=1;n<=6;n++)route.push([300+20*n,200]);for(let n=1;n<=6;n++)route.push([420,200+20*n]);for(let n=1;n<=6;n++)route.push([420-20*n,320]);for(let n=1;n<=6;n++)route.push([300,320-20*n]);let fired=0;for(const [x,y] of route){player.x=x;player.y=y;totalTime+=.07;if(recordCircuitWeaverMotion(player,20,false))fired++;}return JSON.stringify({fired,inside:inside.hp,outside:outside.hp,closures:player.buildStats.circuitClosures,hits:player.buildStats.circuitPulseHits,remaining:player.circuitTrace.length,ready:player.circuitReadyAt,gold:totalGold,field:!!circuitField});})()"));
 assert.equal(s.fired,1);
 assert.ok(s.inside<1000,'inside target is hit');
 assert.equal(s.outside,1000);
 assert.equal(s.closures,1);
 assert.equal(s.hits,1);
 assert.equal(s.remaining,0);
 assert.ok(s.ready>0);
 assert.equal(s.gold,50);
 assert.equal(s.field,false);
});

test('M5.16 tiny loops cannot arm and long-distance dash is not an artificial closing stroke',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.circuit_weaver=1;player.refreshBuildTraits();player.x=250;player.y=250;recordCircuitWeaverMotion(player,0,false);for(let i=0;i<40;i++){const a=i*Math.PI/10;player.x=250+20*Math.cos(a);player.y=250+20*Math.sin(a);totalTime+=.07;recordCircuitWeaverMotion(player,20,false);}const tiny=player.buildStats.circuitClosures;player.x=500;player.y=500;recordCircuitWeaverMotion(player,350,true);return JSON.stringify({tiny,trace:player.circuitTrace.length,startsAt:player.circuitTrace[0],ready:player.circuitReadyAt});})()"));
 assert.equal(s.tiny,0);
 assert.equal(s.trace,1);
 assert.deepEqual(s.startsAt,{x:500,y:500});
 assert.equal(s.ready,0);
});

test('M5.16 full 160-enemy room caps loop pulse hits and never harms boss',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.circuit_weaver=1;player.refreshBuildTraits();enemies=Array.from({length:159},()=>new Enemy(360,260,'TANK'));const boss=new Enemy(360,260,'BOSS_PRISM');enemies.push(boss);for(const e of enemies)e.hp=e.maxHp=10000;const polygon=[{x:300,y:200},{x:440,y:200},{x:440,y:340},{x:300,y:340}];const hit=closeCircuitWeaver(player,polygon,19600);return JSON.stringify({hit,damaged:enemies.filter(e=>e.hp<10000).length,boss:boss.hp,total:enemies.length,stats:player.buildStats.circuitPulseHits});})()"));
 assert.equal(s.hit,true);
 assert.equal(s.damaged,16);
 assert.equal(s.boss,10000);
 assert.equal(s.total,160);
 assert.equal(s.stats,16);
});

test('M5.16 evolved charged boundary hits each crossing enemy once but not an idle enemy',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.circuit_weaver=3;player.refreshBuildTraits();const a=new Enemy(490,260,'TANK'),b=new Enemy(490,260,'TANK');a.hp=a.maxHp=b.hp=b.maxHp=1000;enemies=[a,b];const poly=[{x:300,y:200},{x:420,y:200},{x:420,y:320},{x:300,y:320}];closeCircuitWeaver(player,poly,14400);totalTime=.2;a.x=360;updateCircuitField();const once=a.hp;totalTime=.4;a.x=490;updateCircuitField();const twice=a.hp;totalTime=.6;a.x=360;updateCircuitField();return JSON.stringify({once,twice,third:a.hp,idle:b.hp,crossings:player.buildStats.circuitCrossings,field:!!circuitField});})()"));
 assert.ok(s.once<1000);
 assert.equal(s.twice,s.once);
 assert.equal(s.third,s.once);
 assert.equal(s.idle,1000);
 assert.equal(s.crossings,1);
 assert.equal(s.field,true);
});

test('M5.16 circuit field and trace expire and reset on new run',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.circuit_weaver=3;player.refreshBuildTraits();const poly=[{x:300,y:200},{x:420,y:200},{x:420,y:320},{x:300,y:320}];closeCircuitWeaver(player,poly,14400);const old=getCircuitWeaverSnapshot();totalTime=3.25;updateCircuitField();const expired=getCircuitWeaverSnapshot();startNewGame();return JSON.stringify({old,expired,now:getCircuitWeaverSnapshot(),gold:totalGold});})()"));
 assert.equal(s.old.fieldActive,true);
 assert.equal(s.expired.fieldActive,false);
 assert.equal(s.now.tier,0);
 assert.equal(s.now.closures,0);
 assert.equal(s.now.fieldActive,false);
 assert.equal(s.gold,50);
});

test('M5.16 circuit visualization has bounded draw path and distinct high/low effects',()=>{
 const methods=[];const ctx=new Proxy({}, {get(_,key){return(...args)=>methods.push(String(key));}});
 const {run}=setup({}, {canvasContext:ctx});
 const s=JSON.parse(run("(()=>{startNewGame();player.upgradeCounts.circuit_weaver=1;player.refreshBuildTraits();player.circuitTrace=[{x:300,y:200},{x:400,y:200},{x:400,y:300}];graphicsQuality='high';drawCircuitWeaver(ctx);graphicsQuality='low';drawCircuitWeaver(ctx);return JSON.stringify({trace:player.circuitTrace.length,stats:getCircuitWeaverSnapshot()});})()"));
 assert.ok(methods.filter(m=>m==='lineTo').length>=4);
 assert.ok(methods.filter(m=>m==='stroke').length>=4);
 assert.equal(s.trace,3);
 assert.equal(s.stats.closures,0);
});


test('M5.17 chapters rotate every three waves with unique art and a boss-safe mode',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{const at=[1,5,6,7,8,9,10,11,12,13,14,15,18,21].map(w=>chapterIdForWave(w));return JSON.stringify({at,keys:Object.keys(ARENA_CHAPTERS),colors:Object.values(ARENA_CHAPTERS).map(x=>x.color),bounds:{cycle:CHAPTER_RULES.foundryCycle,garden:CHAPTER_RULES.gardenCharge,warp:CHAPTER_RULES.riftCooldown}});})()"));
 assert.deepEqual(x.at,[null,null,'FOUNDRY','FOUNDRY','FOUNDRY','GARDEN','GARDEN','GARDEN','RIFT','RIFT','RIFT','FOUNDRY','GARDEN','RIFT']);
 assert.deepEqual(x.keys,['FOUNDRY','GARDEN','RIFT']);
 assert.equal(new Set(x.colors).size,3);
 assert.equal(x.bounds.cycle,6);
});

test('M5.17 chapter announces wave transitions with readable HUD names and status',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();const initial=getArenaChapterSnapshot();wave=6;updateArenaChapter(.1);updateArenaChapterHud();const badge=document.getElementById('arenaChapterBadge').textContent;const msg=document.getElementById('arenaChapterStatus').textContent;const activated=getArenaChapterSnapshot();wave=9;updateArenaChapter(.1);const garden=getArenaChapterSnapshot();wave=12;updateArenaChapter(.1);const rift=getArenaChapterSnapshot();return JSON.stringify({initial,activated,badge,msg,garden,rift,attr:document.getElementById('hud')._attrs['data-arena-chapter']});})()"));
 assert.equal(s.initial.id,null);
 assert.equal(s.activated.id,'FOUNDRY');
 assert.equal(s.activated.changes,1);
 assert.match(s.badge,/DÖKÜMHANE/);
 assert.match(s.msg,/YÜKLENİYOR|KAÇ|SOĞUYOR/);
 assert.equal(s.garden.id,'GARDEN');
 assert.equal(s.rift.id,'RIFT');
 assert.equal(s.rift.changes,3);
 assert.equal(s.attr,'FOUNDRY');
});

test('M5.17 foundry warns before the heat pulse and damages at most twelve normal enemies once',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=6;nextBossTime=500;totalTime=0;updateArenaChapter(.1);const L=chapterFoundryLayout;const at=foundryRailPositions(L)[0];const put=(o,along)=>{if(L.axis==='y'){o.x=along;o.y=at;}else{o.x=at;o.y=along;}return o;};put(player,200);enemies=Array.from({length:18},(_,i)=>put(new Enemy(0,0,'TANK'),220+i*18));for(const e of enemies)e.hp=e.maxHp=2000;const boss=put(new Enemy(0,0,'BOSS_DESTROYER'),220);boss.hp=boss.maxHp=2000;enemies.push(boss);const hp=player.hp;totalTime=1.2;updateArenaChapter(.1);const warned=enemies.filter(e=>e.hp<2000).length;totalTime=1.6;updateArenaChapter(.1);const once=enemies.filter(e=>e.hp<2000).length;const mid=player.hp;updateArenaChapter(.1);const twice=enemies.filter(e=>e.hp<2000).length;return JSON.stringify({hp,warned,once,twice,mid,bossHp:boss.hp,stats:getArenaChapterSnapshot()});})()"));
 assert.equal(s.warned,0);
 assert.equal(s.once,12);
 assert.equal(s.twice,12);
 assert.equal(s.mid,s.hp-9);
 assert.equal(s.bossHp,2000);
 assert.equal(s.stats.foundryEnemyHits,12);
 assert.equal(s.stats.foundryPlayerHits,1);
});

test('Odak 5.13 arena events suppress chapter effects; boss fights and their warning do not',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=9;nextBossTime=500;player.x=worldWidth*.25;player.y=worldHeight*.38;updateArenaChapter(.2);updateArenaChapter(1);const charge=chapterGardenCharge[0];combatDirector.activeArenaEvent={kind:'RELAY',dead:false};updateArenaChapter(3);const during=chapterGardenCharge[0];const allowedEvent=chapterEffectsAllowed();combatDirector.activeArenaEvent=null;activeBosses=[new Enemy(500,300,'BOSS_DESTROYER')];updateArenaChapter(4);const allowedBoss=chapterEffectsAllowed();activeBosses=[];nextBossTime=totalTime+3;const allowedWarning=chapterEffectsAllowed();gameState='PAUSED';const allowedPause=chapterEffectsAllowed();return JSON.stringify({charge,during,allowedEvent,allowedBoss,allowedWarning,allowedPause,id:arenaChapter});})()"));
 assert.ok(s.charge>0);
 assert.equal(s.during,0);
 assert.equal(s.allowedEvent,false);
 assert.equal(s.allowedBoss,true);
 assert.equal(s.allowedWarning,true);
 assert.equal(s.allowedPause,false);
 assert.equal(s.id,'GARDEN');
});

test('M5.17 garden charges exactly one node, stuns at most eight foes and respects cooldown',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=9;nextBossTime=500;const node=getGardenCenters()[0];player.x=node.x;player.y=node.y;enemies=Array.from({length:12},()=>new Enemy(node.x+18,node.y+14,'TANK'));const boss=new Enemy(node.x,node.y,'BOSS_DESTROYER');enemies.push(boss);updateArenaChapter(.1);updateArenaChapter(.8);const half=chapterGardenCharge[0];updateArenaChapter(.85);const hits=enemies.filter(e=>e.stunTimer>0).length;const after=getArenaChapterSnapshot();updateArenaChapter(4);return JSON.stringify({half,hits,bossStun:boss.stunTimer,after,final:getArenaChapterSnapshot()});})()"));
 assert.ok(s.half>0);
 assert.equal(s.hits,8);
 assert.equal(s.bossStun,0);
 assert.equal(s.after.gardenBursts,1);
 assert.equal(s.after.gardenStuns,8);
 assert.ok(s.after.gardenReadyIn[0]>0);
 assert.equal(s.final.gardenBursts,1);
});

test('M5.17 garden partial charge decays when player leaves a node',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=9;nextBossTime=500;const node=getGardenCenters()[0];player.x=node.x;player.y=node.y;updateArenaChapter(.3);updateArenaChapter(.8);const held=chapterGardenCharge[0];player.x=worldWidth*.95;player.y=worldHeight*.95;updateArenaChapter(.3);return JSON.stringify({held,left:chapterGardenCharge[0],bursts:chapterStats.gardenBursts});})()"));
 assert.ok(s.held>0);
 assert.ok(s.left<s.held);
 assert.equal(s.bursts,0);
});

test('M5.17 rift gate teleports once, re-arms on exit, preserves gold and breaks circuit trail',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=12;nextBossTime=500;totalTime=175;updateArenaChapter(.01);const nodes=getRiftCenters();player.x=nodes[0].x;player.y=nodes[0].y;player.circuitTrace=[{x:120,y:180},{x:260,y:180}];player.circuitLength=140;player.vx=200;const gold=totalGold;updateArenaChapter(.02);const first={x:player.x,y:player.y,warps:chapterStats.riftWarps,invuln:player.invulnTimer,trace:player.circuitTrace.length,vx:player.vx};updateArenaChapter(.02);const blocked=chapterStats.riftWarps;player.x=worldWidth*.5;player.y=worldHeight*.5;updateArenaChapter(.02);totalTime+=12;player.x=nodes[1].x;player.y=nodes[1].y;updateArenaChapter(.02);return JSON.stringify({first,blocked,after:{x:player.x,y:player.y},warps:chapterStats.riftWarps,gold,saved:totalGold,expected:nodes[0]});})()"));
 assert.equal(s.first.warps,1);
 assert.ok(s.first.invuln>=.55);
 assert.equal(s.first.trace,0);
 assert.equal(s.first.vx,0);
 assert.equal(s.blocked,1);
 assert.equal(s.warps,2);
 assert.ok(Math.abs(s.after.x-s.expected.x)<1);
 assert.equal(s.gold,s.saved);
});

test('Odak 5.13 rift stays live through the boss warning but not during an arena mission',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=12;nextBossTime=200;totalTime=196.5;const a=getRiftCenters()[0];player.x=a.x;player.y=a.y;updateArenaChapter(.02);const danger=getArenaChapterSnapshot();const dangerWarps=chapterStats.riftWarps;totalTime=180;chapterRiftLastWarpAt=-Infinity;player.x=a.x;player.y=a.y;combatDirector.activeArenaEvent={kind:'STORM'};updateArenaChapter(.02);const event=getArenaChapterSnapshot();return JSON.stringify({danger,dangerWarps,event,warps:chapterStats.riftWarps,x:player.x});})()"));
 assert.equal(s.danger.enabled,true);
 assert.equal(s.dangerWarps,1);
 assert.equal(s.event.enabled,false);
 assert.equal(s.warps,1);
});

test('M5.17 new run resets all three chapters and metrics and keeps legacy progression',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=12;nextBossTime=500;updateArenaChapter(.01);const gate=getRiftCenters()[0];player.x=gate.x;player.y=gate.y;updateArenaChapter(.02);const before=getArenaChapterSnapshot();const gold=totalGold,choices=UPGRADES_POOL.length;startNewGame();return JSON.stringify({before,now:getArenaChapterSnapshot(),gold,afterGold:totalGold,choices,afterChoices:UPGRADES_POOL.length});})()"));
 assert.equal(s.before.riftWarps,1);
 assert.equal(s.now.id,null);
 assert.equal(s.now.changes,0);
 assert.equal(s.now.riftWarps,0);
 assert.equal(s.gold,s.afterGold);
 assert.equal(s.choices,s.afterChoices);
 assert.equal(s.choices,UPGRADE_IDS.length);
});

test('M5.17 arena chapters render distinct canvas geometry at low graphics without new enemies',()=>{
 const calls=[];
 const ctx=new Proxy({}, {get(_,name){return(...args)=>calls.push(String(name));}});
 const {run}=setup({}, {canvasContext:ctx});
 const s=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;graphicsQuality='low';const result={};for(const [w,id] of [[6,'FOUNDRY'],[9,'GARDEN'],[12,'RIFT']]){wave=w;updateArenaChapter(.05);const before=enemies.length;drawArenaChapter(ctx);result[id]={count:enemies.length-before,mode:arenaChapter};}return JSON.stringify(result);})()"));
 assert.equal(s.FOUNDRY.mode,'FOUNDRY');
 assert.equal(s.GARDEN.mode,'GARDEN');
 assert.equal(s.RIFT.mode,'RIFT');
 assert.equal(Object.values(s).every(x=>x.count===0),true);
 assert.ok(calls.includes('fillRect'));
 assert.ok(calls.includes('ellipse'));
 assert.ok(calls.includes('arc'));
 assert.match(html,/id="arenaChapterAnnouncement"/);
 assert.match(html,/\[data-arena-chapter="FOUNDRY"\]/);
});


test('M5.18 foundry offers a full warning on entry and after a suppressed boss or mission',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;wave=6;totalTime=1.7;const hp=player.hp;updateArenaChapter(.02);const start=getArenaChapterSnapshot();{const L=chapterFoundryLayout;const at=foundryRailPositions(L)[0];const put=(o,along)=>{if(L.axis==='y'){o.x=along;o.y=at;}else{o.x=at;o.y=along;}return o;};put(player,300);}totalTime=3.2;updateArenaChapter(.02);const first=player.hp;combatDirector.activeArenaEvent={kind:'STORM'};totalTime=3.7;updateArenaChapter(.02);const blocked=getArenaChapterSnapshot();combatDirector.activeArenaEvent=null;totalTime=4.7;updateArenaChapter(.02);const restart=getArenaChapterSnapshot();{const L=chapterFoundryLayout;const at=foundryRailPositions(L)[0];const put=(o,along)=>{if(L.axis==='y'){o.x=along;o.y=at;}else{o.x=at;o.y=along;}return o;};put(player,300);}const protectedHp=player.hp;player.invulnTimer=0;totalTime=6.2;updateArenaChapter(.02);return JSON.stringify({hp,start,first,blocked,restart,protectedHp,finalHp:player.hp,stats:getArenaChapterSnapshot()});})()"));
 assert.equal(s.start.foundryPhase,0);
 assert.equal(s.start.foundryReadyIn,1.5);
 assert.equal(s.first,s.hp-9);
 assert.equal(s.blocked.enabled,false);
 assert.equal(s.restart.foundryPhase,0);
 assert.equal(s.restart.foundryReadyIn,1.5);
 assert.equal(s.protectedHp,s.first);
 assert.equal(s.stats.foundryPlayerHits,2);
 assert.equal(s.finalHp,s.first-9);
});

test('M5.18 portal seeks a safe nearby landing only if its exit is crowded',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;wave=12;totalTime=10;updateArenaChapter(.02);const gates=getRiftCenters();player.x=gates[0].x;player.y=gates[0].y;enemies=[new Enemy(gates[1].x,gates[1].y,'TANK')];updateArenaChapter(.02);const crowded={distance:Math.hypot(player.x-gates[1].x,player.y-gates[1].y),reroutes:chapterStats.riftReroutes};startNewGame();wave=12;nextBossTime=500;updateArenaChapter(.02);const free=getRiftCenters();player.x=free[0].x;player.y=free[0].y;enemies=[];updateArenaChapter(.02);return JSON.stringify({crowded,freeDistance:Math.hypot(player.x-free[1].x,player.y-free[1].y),freeReroutes:chapterStats.riftReroutes});})()"));
 assert.ok(s.crowded.distance>45,'crowded exit should move off the enemy');
 assert.equal(s.crowded.reroutes,1);
 assert.ok(s.freeDistance<1,'empty portal stays at its center');
 assert.equal(s.freeReroutes,0);
});

test('M5.18 mobile status and honest cooldown arcs expose terrain mechanics',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;const chip=document.getElementById('arenaChapterChip');const read=()=>document.getElementById('arenaChapterBadge').textContent+' · '+document.getElementById('arenaChapterStatus').textContent;wave=9;updateArenaChapter(.02);updateArenaChapterHud();const garden=read(),gardenUrgent=chip.dataset.urgent;chapterGardenContested[0]=true;updateArenaChapterHud();const contested=read(),contestedUrgent=chip.dataset.urgent;chapterGardenContested[0]=false;wave=12;updateArenaChapter(.02);updateArenaChapterHud();const rift=read(),riftUrgent=chip.dataset.urgent;return JSON.stringify({garden,gardenUrgent,contested,contestedUrgent,rift,riftUrgent});})()"));
 assert.match(s.garden,/BAHÇE.*İYON/);
 assert.equal(s.gardenUrgent,'false');
 assert.match(s.contested,/İYON BASKISI/);
 assert.equal(s.contestedUrgent,'true');
 assert.match(s.rift,/YARIK.*GEÇİT/);
 assert.equal(s.riftUrgent,'false');
 // Odak 4.10 · the cooldown arcs are drawn from the real remaining time (half spent = half circle).
 const arcs=[];
 const ctx=new Proxy({},{get:(_,key)=>(...args)=>{if(key==='arc')arcs.push(args);}});
 const drawn=setup({},{canvasContext:ctx});
 const half=(code)=>{arcs.length=0;drawn.run(code);return arcs.some(a=>Math.abs(a[3]+Math.PI/2)<1e-6&&Math.abs(a[4]-Math.PI/2)<1e-3);};
 const base="startNewGame();nextBossTime=1e6;gameState='PLAYING';totalTime=40;";
 assert.ok(half(base+"wave=9;chapterShowcaseAttemptedWave=9;updateArenaChapter(.02);chapterGardenReady[0]=totalTime+CHAPTER_RULES.gardenCooldown/2;drawArenaChapter(ctx)"),'garden arc is half full');
 assert.ok(half(base+"wave=12;chapterShowcaseAttemptedWave=12;updateArenaChapter(.02);chapterRiftReadyAt=totalTime+CHAPTER_RULES.riftCooldown/2;drawArenaChapter(ctx)"),'rift arc is half full');
});

 
test('M5.19 announced foundry rails make cautious ranged units sidestep without speed buffs',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=6;nextBossTime=500;totalTime=101;updateArenaChapter(.02);const L=chapterFoundryLayout;const h=L.axis==='y';const at=foundryRailPositions(L)[0];const pos=(along,across)=>h?{x:along,y:across}:{x:across,y:along};const move=(o,along,across)=>{if(h){o.x+=along;o.y+=across;}else{o.x+=across;o.y+=along;}};const acr=o=>h?o.y:o.x;const start=pos(390,at+10);const e=new Enemy(start.x,start.y,'SHOOTER');const from={x:e.x,y:e.y};move(e,19,-6);steerFoundryRangedEnemy(e,from.x,from.y);const after=acr(e),before=at+10-6;const distance=Math.hypot(e.x-from.x,e.y-from.y);const count=chapterStats.foundryDodges;totalTime+=1.7;const danger=new Enemy(start.x,start.y,'SHOOTER');move(danger,19,-6);const orig={x:danger.x,y:danger.y};steerFoundryRangedEnemy(danger,start.x,start.y);return JSON.stringify({after,before,distance,count,dangerX:danger.x,origX:orig.x,dangerY:danger.y,origY:orig.y});})()"));
 assert.ok(s.after>s.before,'warning-phase shooter must steer away from rail');
 assert.ok(Math.abs(s.distance-Math.hypot(19,6))<0.01,'no additional displacement');
 assert.equal(s.count,1);
 assert.equal(s.dangerX,s.origX,'danger-phase enemy does not dodge mid-pulse');
 assert.equal(s.dangerY,s.origY);
});

test('M5.19 contested ion flowers still charge and recover as the guard is stunned',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=9;nextBossTime=500;const node=getGardenCenters()[0];player.x=node.x;player.y=node.y;const e=new Enemy(node.x+24,node.y,'SHIELD_BEARER');enemies=[e];updateArenaChapter(.02);updateArenaChapter(.5);const guarded=getArenaChapterSnapshot();e.stunTimer=2;updateArenaChapter(.5);const cleared=getArenaChapterSnapshot();combatDirector.activeArenaEvent={kind:'STORM'};updateArenaChapter(.5);const suppressed=getArenaChapterSnapshot();return JSON.stringify({guarded,cleared,suppressed});})()"));
 assert.equal(s.guarded.gardenContested[0],1);
 assert.ok(s.guarded.gardenCharge[0]>.3&&s.guarded.gardenCharge[0]<.5);
 assert.ok(s.guarded.gardenContestedSeconds>.4);
 assert.equal(s.cleared.gardenContested[0],0);
 assert.ok(s.cleared.gardenCharge[0]>s.guarded.gardenCharge[0]+.49);
 assert.equal(s.suppressed.enabled,false);
 assert.equal(s.suppressed.gardenCharge[0],0);
 assert.equal(s.suppressed.gardenContested[0],0);
});

test('M5.19 portal pursuer warns before flanking; never telefrags or spawns new enemies',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=12;nextBossTime=500;totalTime=100;updateArenaChapter(.02);const portals=getRiftCenters();player.x=portals[0].x;player.y=portals[0].y;const e=new Enemy(portals[0].x+22,portals[0].y+12,'ASSASSIN');enemies=[e];updateArenaChapter(.02);const warps=chapterStats.riftWarps;updateArenaChapter(.02);const announced=getArenaChapterSnapshot();const old={x:e.x,y:e.y};totalTime+=1.1;updateArenaChapter(.02);const arrived=getArenaChapterSnapshot();return JSON.stringify({warps,announced,arrived,old,after:{x:e.x,y:e.y},gap:Math.hypot(e.x-player.x,e.y-player.y),stun:e.stunTimer,count:enemies.length});})()"));
 assert.equal(s.warps,1);
 assert.ok(s.announced.riftPursuit?.remaining>=1);
 assert.equal(s.announced.riftEnemyFlanks,0);
 assert.equal(s.arrived.riftPursuit,null);
 assert.equal(s.arrived.riftEnemyFlanks,1);
 assert.ok(Math.hypot(s.after.x-s.old.x,s.after.y-s.old.y)>300);
 assert.ok(s.gap>80,'enemy must land beyond melee contact');
 assert.ok(s.stun>=.5,'follow-up ambush has visible reaction time');
 assert.equal(s.count,1,'no extra enemy spawned');
});

test('M5.19 moving a pursuer away or starting a boss event cancels the portal follow',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();wave=12;nextBossTime=500;totalTime=100;updateArenaChapter(.02);const portals=getRiftCenters();player.x=portals[0].x;player.y=portals[0].y;const e=new Enemy(portals[0].x+20,portals[0].y,'DASHER');enemies=[e];updateArenaChapter(.02);updateArenaChapter(.02);const planned=!!chapterRiftPursuit;combatDirector.activeArenaEvent={kind:'STORM'};totalTime+=1.2;updateArenaChapter(.02);combatDirector.activeArenaEvent=null;updateArenaChapter(.02);const after=getArenaChapterSnapshot();return JSON.stringify({planned,after,x:e.x});})()"));
 assert.equal(s.planned,true);
 assert.equal(s.after.riftPursuit,null);
 assert.equal(s.after.riftEnemyFlanks,0);
});

test('M5.19 reset clears counterplay state without changing gold or module count',()=>{
 const {run}=setup();
 const s=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;wave=9;const n=getGardenCenters()[0];enemies=[new Enemy(n.x,n.y,'SHOOTER')];player.x=n.x;player.y=n.y;updateArenaChapter(.5);const before=getArenaChapterSnapshot();const gold=totalGold,cards=UPGRADES_POOL.length;startNewGame();const after=getArenaChapterSnapshot();return JSON.stringify({before,after,gold,afterGold:totalGold,cards,afterCards:UPGRADES_POOL.length});})()"));
 assert.ok(s.before.gardenContested[0]>0);
 assert.deepEqual(s.after.gardenContested,[0,0,0]);
 assert.equal(s.after.riftEnemyFlanks,0);
 assert.equal(s.after.foundryDodges,0);
 assert.equal(s.gold,s.afterGold);
 assert.equal(s.cards,s.afterCards);
});


test('M5.20 signature operations start on each middle wave, once per wave',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=1000;const result=[];let lastWave=5;for(const w of [6,7,7,8,9,10,11,12,13,14,15,16]){if(w!==lastWave)totalTime+=(w-lastWave)*16;lastWave=w;wave=w;waveTimer=2;enemies=[new Enemy(360,300,'SHOOTER')];updateArenaChapter(.02);result.push({w,kind:getArenaChapterSnapshot().showcase?.id||null,started:chapterShowcaseStats.started});}return JSON.stringify(result);})()"));
 assert.equal(x[0].kind,null);
 assert.equal(x[1].kind,'FOUNDRY');
 assert.equal(x[2].started,1);
 assert.equal(x[3].kind,null);
 assert.equal(x[5].kind,'GARDEN');
 assert.equal(x[7].kind,null);
 assert.equal(x[8].kind,'RIFT');
 assert.equal(x[11].kind,'FOUNDRY');
 assert.equal(x[11].started,4);
});

// Odak 4.5 · presses hit for 20, and the second one aims where the player stood
// when the first slammed: walking away dodges it, standing still does not.
test('M5.20 giant presses telegraph before bounded once-only hits',()=>{
 const {run}=setup();
 const press=(moveAway)=>JSON.parse(run(`(()=>{startNewGame();wave=7;waveTimer=2;nextBossTime=1000;totalTime=100;updateArenaChapter(.02);
   const p0=chapterShowcase.press[0];const put=(o,p,along)=>{if(p.axis==='x'){o.x=p.at;o.y=along;}else{o.y=p.at;o.x=along;}return o;};
   enemies=Array.from({length:15},()=>put(new Enemy(0,0,'TANK'),p0,worldHeight*.5));for(const e of enemies)e.hp=e.maxHp=5000;
   put(player,p0,300);const hp=player.hp;const aimAt={x:player.x,y:player.y};totalTime=101.4;updateArenaChapter(.02);const before={hp:player.hp,hits:chapterShowcaseStats.pressEnemyHits};
   totalTime=101.9;updateArenaChapter(.02);const first={hp:player.hp,hits:chapterShowcaseStats.pressEnemyHits,mask:chapterShowcase.pulseMask,aim:(()=>{const p=chapterShowcase.press[1];return Math.abs(p.at-(p.axis==='x'?aimAt.x:aimAt.y))<1;})()};
   updateArenaChapter(.02);const repeated={hp:player.hp,hits:chapterShowcaseStats.pressEnemyHits};
   player.invulnTimer=0;if(${moveAway}){const p=chapterShowcase.press[1];if(p.axis==='x')player.x+=p.at>worldWidth/2?-200:200;else player.y+=p.at>worldHeight/2?-200:200;}totalTime=103.9;updateArenaChapter(.02);
   const after={hp:player.hp,mask:chapterShowcase.pulseMask};return JSON.stringify({hp,before,first,repeated,after});})()`));
 const x=press(true);
 assert.equal(x.before.hp,x.hp);
 assert.equal(x.before.hits,0);
 assert.equal(x.first.hp,x.hp-20);
 assert.equal(x.first.hits,10);
 assert.equal(x.first.mask,1);
 assert.equal(x.first.aim,true);
 assert.equal(x.repeated.hp,x.first.hp);
 assert.equal(x.repeated.hits,10);
 assert.equal(x.after.mask,3);
 assert.equal(x.after.hp,x.hp-20);
 const stay=press(false);
 assert.equal(stay.after.hp,stay.hp-40);
});

// Odak 4.9 · each foundry pulse rolls a direction and two lanes that never sit side by
// side, the same seed gives the same sequence, and the lanes really do the damage.
test('Odak 4.9 foundry rails pick a random direction and lanes each pulse',()=>{
 const {run}=setup();
 const roll=(seed)=>JSON.parse(run(`(()=>{startNewGame();setRunSeed(${seed});wave=6;nextBossTime=1e6;totalTime=0;chapterFoundryAnchor=null;chapterFoundryLayout=null;updateArenaChapter(.02);
   const rows=[];for(let i=0;i<40;i++){totalTime=i*CHAPTER_RULES.foundryCycle+.05;updateArenaChapter(.02);rows.push({...getArenaChapterSnapshot().foundryLanes,slots:[...chapterFoundryLayout.slots]});}
   return JSON.stringify(rows);})()`));
 const a=roll(7),b=roll(7),c=roll(99);
 assert.deepEqual(a,b,'same seed, same rails');
 assert.notDeepEqual(a,c,'another seed, other rails');
 const axes=new Set(a.map(r=>r.axis));
 assert.deepEqual([...axes].sort(),['x','y'],'both horizontal and vertical rails appear');
 assert.ok(new Set(a.map(r=>r.slots.join())).size>=4,'lanes move around');
 for(const r of a)assert.ok(Math.abs(r.slots[0]-r.slots[1])>=2,'a safe lane always lies between or beside the rails');
 // A vertical layout hits the player standing in its column, not one beside it.
 const hit=JSON.parse(run("(()=>{startNewGame();wave=6;nextBossTime=1e6;totalTime=0;updateArenaChapter(.02);chapterFoundryLayout.axis='x';const at=foundryRailPositions(chapterFoundryLayout);player.x=at[0];player.y=worldHeight*.2;const hp=player.hp;totalTime=1.6;updateArenaChapter(.02);const inLane=hp-player.hp;player.invulnTimer=0;totalTime=6.05;updateArenaChapter(.02);chapterFoundryLayout.axis='x';const next=foundryRailPositions(chapterFoundryLayout);player.x=(next[0]+next[1])/2;const hp2=player.hp;totalTime=7.6;updateArenaChapter(.02);return JSON.stringify({inLane,between:hp2-player.hp});})()"));
 assert.equal(hit.inLane,9);
 assert.equal(hit.between,0);
});

test('Odak 4.9 Kizil Makas presses come from a random side and the second follows the player',()=>{
 const {run}=setup();
 const rows=JSON.parse(run(`(()=>{const rows=[];for(let seed=1;seed<=24;seed++){startNewGame();setRunSeed(seed);wave=7;waveTimer=2;nextBossTime=1e6;totalTime=100;chapterShowcaseAttemptedWave=0;updateArenaChapter(.02);
   const p0={...chapterShowcase.press[0]};player.x=worldWidth*.6;player.y=worldHeight*.4;player.invulnTimer=1e6;totalTime=101.85;updateArenaChapter(.02);const p1={...chapterShowcase.press[1]};
   rows.push({p0,p1,aimed:Math.abs(p1.at-(p1.axis==='x'?player.x:player.y))<1});}return JSON.stringify(rows);})()`));
 assert.deepEqual([...new Set(rows.map(r=>r.p0.axis))].sort(),['x','y'],'first press runs both ways');
 assert.deepEqual([...new Set(rows.map(r=>r.p1.axis))].sort(),['x','y'],'second press runs both ways');
 assert.ok(new Set(rows.map(r=>Math.round(r.p0.at/40))).size>=5,'first press lands in different places');
 assert.ok(rows.every(r=>r.aimed),'second press locks onto the player');
});

test('M5.20 ion chorus needs two distinct flowers and keeps bosses immune',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=10;waveTimer=2;nextBossTime=1000;totalTime=300;enemies=[new Enemy(600,330,'SHOOTER'),new Enemy(800,420,'TANK')];const boss=new Enemy(700,330,'BOSS_DESTROYER');enemies.push(boss);const gold=totalGold;updateArenaChapter(.02);const nodes=getGardenCenters();player.x=nodes[0].x;player.y=nodes[0].y;updateArenaChapter(1.65);const first=getArenaChapterSnapshot();player.x=nodes[1].x;player.y=nodes[1].y;updateArenaChapter(1.65);const finished=getArenaChapterSnapshot();return JSON.stringify({first,finished,stuns:enemies.slice(0,2).map(e=>e.stunTimer),bossStun:boss.stunTimer,count:enemies.length,gold,afterGold:totalGold});})()"));
 assert.equal(x.first.showcase.flowerMask,1);
 assert.equal(x.first.showcase.completed,false);
 assert.equal(x.finished.showcase.flowerMask,3);
 assert.equal(x.finished.showcase.completed,true);
 assert.equal(x.finished.showcaseStats.ionHarmonies,1);
 assert.ok(x.stuns.every(s=>s>=1.8));
 assert.equal(x.bossStun,0);
 assert.equal(x.count,3);
 assert.equal(x.gold,x.afterGold);
});

test('M5.20 rift pincer warns and repositions original enemies safely',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=13;waveTimer=2;nextBossTime=1000;totalTime=400;const a=new Enemy(270,280,'ASSASSIN'),b=new Enemy(950,410,'DASHER');enemies=[a,b];const old=[{x:a.x,y:a.y},{x:b.x,y:b.y}];updateArenaChapter(.02);const start=getArenaChapterSnapshot();totalTime+=1.5;updateArenaChapter(.02);const tell={x:a.x,y:a.y};totalTime+=.8;updateArenaChapter(.02);const result=getArenaChapterSnapshot();return JSON.stringify({start,tell,old,result,after:[{x:a.x,y:a.y,stun:a.stunTimer},{x:b.x,y:b.y,stun:b.stunTimer}],player:{x:player.x,y:player.y},count:enemies.length});})()"));
 assert.equal(x.start.showcase.targets.length,2);
 assert.equal(x.start.showcase.completed,false);
 assert.equal(x.tell.x,x.old[0].x);
 assert.equal(x.tell.y,x.old[0].y);
 assert.equal(x.result.showcaseStats.pincerFlanks,2);
 assert.equal(x.result.showcase.completed,true);
 assert.equal(x.count,2);
 for(const enemy of x.after){
   assert.ok(enemy.stun>=.65);
   assert.ok(Math.hypot(enemy.x-x.player.x,enemy.y-x.player.y)>90);
 }
});

test('M5.20 leaving the rift mark evades flanks; boss events cancel the stage',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=13;waveTimer=2;nextBossTime=1000;totalTime=400;const a=new Enemy(270,280,'ASSASSIN');enemies=[a];updateArenaChapter(.02);const orig={x:a.x,y:a.y};player.x+=210;totalTime+=2.3;updateArenaChapter(.02);const avoided=getArenaChapterSnapshot();wave=16;waveTimer=2;updateArenaChapter(.02);const beforeBoss=getArenaChapterSnapshot();combatDirector.activeArenaEvent={kind:'STORM'};updateArenaChapter(.02);const boss=getArenaChapterSnapshot();combatDirector.activeArenaEvent=null;updateArenaChapter(.02);const resumed=getArenaChapterSnapshot();return JSON.stringify({orig,after:{x:a.x,y:a.y},avoided,beforeBoss,boss,resumed});})()"));
 assert.equal(x.avoided.showcaseStats.pincerEvades,1);
 assert.equal(x.avoided.showcaseStats.pincerFlanks,0);
 assert.equal(x.orig.x,x.after.x);
 assert.equal(x.beforeBoss.showcase?.id,'FOUNDRY');
 assert.equal(x.boss.showcase,null);
 assert.equal(x.boss.showcaseStats.cancelled,1);
 assert.equal(x.resumed.showcase,null);
});

test('M5.20 low graphics renders distinct press, chorus, and pincer geometry',()=>{
 const calls=[];
 const ctx=new Proxy({}, {get(_,name){return(...args)=>calls.push(String(name));}});
 const {run}=setup({}, {canvasContext:ctx});
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=1000;graphicsQuality='low';const result={};for(const [w,id] of [[7,'FOUNDRY'],[10,'GARDEN'],[13,'RIFT']]){wave=w;waveTimer=2;enemies=[new Enemy(360,300,'SHOOTER')];updateArenaChapter(.02);const count=enemies.length;drawChapterShowcase(ctx);updateArenaChapterHud();result[id]={show:getArenaChapterSnapshot().showcase?.id,count:enemies.length,was:count,banner:document.getElementById('arenaShowcaseBanner').textContent};}return JSON.stringify(result);})()"));
 assert.equal(x.FOUNDRY.show,'FOUNDRY');
 assert.equal(x.GARDEN.show,'GARDEN');
 assert.equal(x.RIFT.show,'RIFT');
 assert.ok(calls.includes('fillRect'));
 assert.ok(calls.includes('arc'));
 assert.ok(calls.includes('lineTo'));
 assert.ok(Object.values(x).every(a=>a.count===a.was));
 assert.match(x.FOUNDRY.banner,/KIZIL MAKAS/);
 assert.match(x.GARDEN.banner,/İYON KOROSU/);
 assert.match(x.RIFT.banner,/FAZ KISKACI/);
 assert.match(html,/id="arenaShowcaseBanner"/);
});


test('M5.21 Echo Hunter promotes one existing eligible foe on scheduled waves, never creates enemies',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=5000;wave=10;waveTimer=2;totalTime=100;enemies=[new Enemy(70,70,'SHOOTER'),new Enemy(110,90,'DASHER')];const before=enemies.length;updateNemesis(.02);const first=getNemesisSnapshot();updateNemesis(.02);const same=getNemesisSnapshot();wave=11;waveTimer=2;totalTime=116;updateNemesis(.02);const after=getNemesisSnapshot();wave=16;waveTimer=2;totalTime=196;updateNemesis(.02);const later=getNemesisSnapshot();return JSON.stringify({before,afterCount:enemies.length,first,same,after,later,gold:totalGold,upgradeCount:UPGRADES_POOL.length});})()"));
 assert.equal(x.before,x.afterCount);
 assert.equal(x.first.active,true);
 assert.equal(x.first.wave,10);
 assert.equal(x.first.stats.started,1);
 assert.equal(x.same.stats.started,1);
 assert.equal(x.after.active,false);
 assert.equal(x.later.active,true);
 assert.equal(x.later.stats.started,2);
 assert.equal(x.gold,50);
 assert.equal(x.upgradeCount,UPGRADE_IDS.length);
});

test('M5.21 stationary player receives a 1.45s warning and only one bounded hit',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=5000;wave=10;waveTimer=2;totalTime=100;enemies=[new Enemy(70,70,'TANK')];updateNemesis(.02);const hp=player.hp;totalTime=101.65;updateNemesis(.02);const tell=getNemesisSnapshot();totalTime=102.7;updateNemesis(.02);const warningHp=player.hp;totalTime=103.12;updateNemesis(.02);const after=getNemesisSnapshot(),hitHp=player.hp;updateNemesis(.02);return JSON.stringify({hp,tell,warningHp,hitHp,after,repeatedHp:player.hp});})()"));
 assert.equal(x.tell.attack.kind,'LOCK');
 assert.equal(x.tell.attack.title,'SABİT NOKTA');
 assert.ok(x.tell.attack.warning>=1.4);
 assert.equal(x.warningHp,x.hp);
 assert.equal(x.hitHp,x.hp-8);
 assert.equal(x.after.stats.attacks,1);
 assert.equal(x.after.stats.hits,1);
 assert.equal(x.after.attack,null);
 assert.equal(x.repeatedHp,x.hitHp);
});

test('M5.21 movement history selects trail markers with real positions and allows escape',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=5000;wave=10;waveTimer=2;totalTime=100;enemies=[new Enemy(70,70,'SNIPER')];updateNemesis(.02);const hp=player.hp;for(let i=0;i<9;i++){totalTime+=.2;player.x+=30;updateNemesis(.02);}const tell=getNemesisSnapshot();player.x=worldWidth*.9;player.y=worldHeight*.9;totalTime=tell.attack?totalTime+tell.attack.warning+.02:totalTime;updateNemesis(.02);return JSON.stringify({hp,tell,after:getNemesisSnapshot(),hpAfter:player.hp});})()"));
 assert.equal(x.tell.attack.kind,'TRAIL');
 assert.ok(x.tell.attack.centers.length>=2&&x.tell.attack.centers.length<=3);
 assert.equal(x.hpAfter,x.hp);
 assert.equal(x.after.stats.trail,1);
 assert.equal(x.after.stats.evaded,1);
});

test('M5.21 recent dash triggers cross-lock but both crossing beams can be dodged',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=5000;wave=10;waveTimer=2;totalTime=100;enemies=[new Enemy(70,70,'DASHER')];updateNemesis(.02);totalTime=100.6;player.isDashing=true;updateNemesis(.02);player.isDashing=false;totalTime=101.7;updateNemesis(.02);const tell=getNemesisSnapshot();const hp=player.hp;player.x+=95;totalTime+=1.5;updateNemesis(.02);return JSON.stringify({tell,hp,after:player.hp,stats:getNemesisSnapshot().stats});})()"));
 assert.equal(x.tell.attack.kind,'CROSS');
 assert.equal(x.tell.attack.title,'ÇAPRAZ KİLİT');
 assert.equal(x.hp,x.after);
 assert.equal(x.stats.cross,1);
 assert.equal(x.stats.evaded,1);
});

test('M5.21 stun cancels the marked strike, death defeats hunter, bosses suppress it',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=5000;wave=10;waveTimer=2;totalTime=100;const e=new Enemy(70,70,'SHOOTER');enemies=[e];updateNemesis(.02);totalTime=101.7;updateNemesis(.02);const attacking=!!nemesis.attack;e.stunTimer=1.5;updateNemesis(.02);const interrupted=getNemesisSnapshot();e.dead=true;updateNemesis(.02);const defeated=getNemesisSnapshot();wave=16;totalTime=200;waveTimer=2;enemies=[new Enemy(70,70,'SHOOTER')];updateNemesis(.02);combatDirector.activeArenaEvent={kind:'STORM'};updateNemesis(.02);const suppressed=getNemesisSnapshot();return JSON.stringify({attacking,interrupted,defeated,suppressed});})()"));
 assert.equal(x.attacking,true);
 assert.equal(x.interrupted.attack,null);
 assert.equal(x.interrupted.stats.interrupted,1);
 assert.equal(x.defeated.stats.defeated,1);
 assert.equal(x.suppressed.active,false);
 assert.equal(x.suppressed.stats.suppressed,1);
});

test('M5.21 reset, boss priority and mobile HUD honor safety and accessibility',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();wave=10;waveTimer=2;totalTime=100;nextBossTime=103;enemies=[new Enemy(70,70,'ASSASSIN')];updateNemesis(.02);const bossGuard=getNemesisSnapshot();nextBossTime=5000;updateNemesis(.02);totalTime+=1.65;updateNemesis(.02);updateNemesisHud();const banner=document.getElementById('nemesisBanner').textContent;const before=getNemesisSnapshot();startNewGame();return JSON.stringify({bossGuard,banner,before,after:getNemesisSnapshot(),gold:totalGold});})()"));
 assert.equal(x.bossGuard.active,false);
 assert.equal(x.before.active,true);
 assert.match(x.banner,/YANKI AVCISI.*SABİT NOKTA/);
 assert.equal(x.after.active,false);
 assert.equal(x.after.stats.started,0);
 assert.equal(x.gold,50);
 assert.match(html,/id="nemesisBanner"/);
 assert.match(html,/aria-label="Yankı Avcısı tehdidi"/);
});

test('M5.21 low-VFX Echo Hunter identity and warning geometry are rendered without spawning',()=>{
 const calls=[];
 const ctx=new Proxy({}, {get(_,name){return(...args)=>calls.push(String(name));}});
 const {run}=setup({}, {canvasContext:ctx});
 const x=JSON.parse(run("(()=>{startNewGame();wave=10;waveTimer=2;nextBossTime=5000;totalTime=100;graphicsQuality='low';enemies=[new Enemy(70,70,'SNIPER')];updateNemesis(.02);totalTime+=1.7;updateNemesis(.02);const before=enemies.length;drawNemesisThreat(ctx);drawNemesisIdentity(ctx);return JSON.stringify({before,after:enemies.length,kind:getNemesisSnapshot().attack?.kind});})()"));
 assert.equal(x.before,x.after);
 assert.equal(x.kind,'LOCK');
 assert.ok(calls.includes('arc'));
 assert.ok(calls.includes('lineTo'));
 assert.ok(calls.includes('fill'));
});


test('M5.22 Prism Riposte has an eight-second cooldown and refuses paused or dash activation',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();totalTime=10;const first=activatePrismGuard();const second=activatePrismGuard();const active=getPrismGuardSnapshot();gameState='PAUSED';const paused=activatePrismGuard();gameState='PLAYING';totalTime=18.6;player.isDashing=true;const dash=activatePrismGuard();player.isDashing=false;const later=activatePrismGuard();return JSON.stringify({first,second,active,paused,dash,later,after:getPrismGuardSnapshot()});})()"));
 assert.equal(x.first,true);
 assert.equal(x.second,false);
 assert.equal(x.active.active,true);
 assert.equal(x.active.cap,4);
 assert.ok(x.active.remaining>.4);
 assert.equal(x.paused,false);
 assert.equal(x.dash,false);
 assert.equal(x.later,true);
 assert.equal(x.after.stats.activations,2);
});

test('M5.22 frontal incoming shots deflect once, return real Bullet and reward a single perfect timing',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();totalTime=10;const beforeGold=totalGold;player.momentum=0;const ep1=new EnemyProjectile(player.x+75,player.y,-320,0,6,18);const ep2=new EnemyProjectile(player.x+65,player.y+12,-320,0,6,18);enemyProjectiles=[ep1,ep2];enemies=[new Enemy(player.x+300,player.y,'SHOOTER')];const ready=activatePrismGuard();const a=deflectPrismProjectile(ep1);const b=deflectPrismProjectile(ep2);return JSON.stringify({ready,a,b,dead1:ep1.dead,dead2:ep2.dead,bolts:bullets.map(b=>({damage:b.damage,riposte:b.prismRiposte,crit:b.isCrit,life:b.life,pierce:b.pierce})),stats:getPrismGuardSnapshot(),momentum:player.momentum,gold:totalGold,beforeGold});})()"));
 assert.equal(x.ready,true);
 assert.equal(x.a,true);
 assert.equal(x.b,true);
 assert.equal(x.dead1,true);
 assert.equal(x.dead2,true);
 assert.equal(x.bolts.length,2);
 assert.ok(x.bolts.every(b=>b.riposte&&b.crit===false&&b.damage<=42&&b.pierce===1));
 assert.equal(x.stats.stats.deflected,2);
 assert.equal(x.stats.stats.shotsReturned,2);
 assert.equal(x.stats.stats.perfect,1);
 assert.equal(x.momentum,12);
 assert.equal(x.gold,x.beforeGold);
});

test('M5.22 flank, receding and distant shots cannot be parried',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();totalTime=10;const threat=new EnemyProjectile(player.x+160,player.y,-320,0,6,18);enemyProjectiles=[threat];activatePrismGuard();const distant=deflectPrismProjectile(threat);const back=new EnemyProjectile(player.x-55,player.y,320,0,6,18);const backBlocked=deflectPrismProjectile(back);const away=new EnemyProjectile(player.x+55,player.y,320,0,6,18);const receding=deflectPrismProjectile(away);return JSON.stringify({distant,backBlocked,receding,stats:getPrismGuardSnapshot(),backDead:back.dead,awayDead:away.dead});})()"));
 assert.equal(x.distant,false);
 assert.equal(x.backBlocked,false);
 assert.equal(x.receding,false);
 assert.equal(x.stats.stats.deflected,0);
 assert.equal(x.backDead,false);
 assert.equal(x.awayDead,false);
});

test('M5.22 four-deflection cap and friendly-bullet capacity remain bounded',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();totalTime=10;enemies=[];enemyProjectiles=[new EnemyProjectile(player.x+65,player.y,-240,0,6,25)];activatePrismGuard();bullets=Array.from({length:250},()=>({dead:false}));let result=[];for(let i=0;i<6;i++){const ep=new EnemyProjectile(player.x+65,player.y,-240,0,6,25);result.push(deflectPrismProjectile(ep));}const s=getPrismGuardSnapshot();return JSON.stringify({result,stats:s.stats,active:s.active,deflections:s.deflections,bullets:bullets.length});})()"));
 assert.deepEqual(x.result,[true,true,true,true,false,false]);
 assert.equal(x.deflections,4);
 assert.equal(x.active,false);
 assert.equal(x.bullets,250);
 assert.equal(x.stats.shotsReturned,0);
 assert.equal(x.stats.deflected,4);
});

test('M5.22 actual game projectile loop intercepts before player damage',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();totalTime=10;nextBossTime=500;player.momentum=0;player.takeDamage=(n)=>{player.hp-=n;};const hp=player.hp;const ep=new EnemyProjectile(player.x+71,player.y,-400,0,6,23);enemyProjectiles=[ep];activatePrismGuard();updateGame(.016);const state=getPrismGuardSnapshot();return JSON.stringify({hp,afterHp:player.hp,deflected:state.stats.deflected,shotCount:bullets.filter(b=>b.prismRiposte).length,epCount:enemyProjectiles.length});})()"));
 assert.equal(x.hp,x.afterHp);
 assert.equal(x.deflected,1);
 assert.equal(x.shotCount,1);
 assert.equal(x.epCount,0);
});

test('M5.22 expired guard cannot block and correctly counts whiffs; run reset clears temporary state',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();totalTime=10;activatePrismGuard();totalTime=10.5;updatePrismGuard();const stale=new EnemyProjectile(player.x+40,player.y,-240,0,6,12);const blocked=deflectPrismProjectile(stale);const expired=getPrismGuardSnapshot();const gold=totalGold;startNewGame();return JSON.stringify({blocked,staleDead:stale.dead,expired,reset:getPrismGuardSnapshot(),gold,afterGold:totalGold});})()"));
 assert.equal(x.blocked,false);
 assert.equal(x.staleDead,false);
 assert.equal(x.expired.stats.whiffs,1);
 assert.equal(x.expired.stats.spent,1);
 assert.equal(x.reset.stats.activations,0);
 assert.equal(x.reset.readyIn,0);
 assert.equal(x.reset.active,false);
 assert.equal(x.gold,x.afterGold);
});

test('M5.22 HUD and low-VFX prism sector are accessible with no artificial movement',()=>{
 const calls=[];
 const ctx=new Proxy({}, {get(_,key){return(...args)=>calls.push(String(key));}});
 const {run}=setup({}, {canvasContext:ctx});
 const x=JSON.parse(run("(()=>{startNewGame();graphicsQuality='low';totalTime=10;activatePrismGuard();updatePrismGuardHud();drawPrismGuard(ctx);const b=document.getElementById('prismBtn');return JSON.stringify({text:document.getElementById('prismStatus').textContent,aria:b._attrs['aria-label'],active:getPrismGuardSnapshot().active});})()"));
 assert.equal(x.active,true);
 assert.match(x.text,/KARŞILA/);
 assert.match(x.aria,/aktif/);
 assert.ok(calls.includes('arc'));
 assert.ok(calls.includes('lineTo'));
 assert.ok(calls.includes('fill'));
 assert.match(html,/id="prismBtn"/);
 assert.match(html,/id="prismCooldownOverlay"/);
 assert.match(html,/\[C\]/);
});


test('M5.23 readable upgrade cards preserve every original description and selection semantics',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();const variants=[];for(const u of UPGRADES_POOL){for(const r of RARITIES){const currentLvl=u.id==='circuit_weaver'?2:0;const p=getUpgradeCardPresentation(u,r,currentLvl);const markup=renderUpgradeCardMarkup(u,r,currentLvl,0,p,[]);variants.push({id:u.id,rarity:r.id,description:u.getDesc(r),markup,role:p.role});}}const gold=totalGold;triggerLevelUp();return JSON.stringify({variants,count:UPGRADES_POOL.length,choiceCount:currentUpgradeChoices.length,gold,afterGold:totalGold});})()"));
 assert.equal(x.count,UPGRADE_IDS.length);
 assert.equal(x.variants.length,UPGRADE_IDS.length*4);
 assert.equal(x.choiceCount,3);
 assert.equal(x.gold,x.afterGold);
 for(const card of x.variants){
   assert.ok(card.markup.includes(card.description),'original gameplay copy missing: '+card.id);
   assert.match(card.markup,/upgrade-card-header/);
   assert.match(card.markup,/upgrade-card-labels/);
   assert.match(card.markup,/upgrade-card-tier-row/);
   assert.match(card.markup,/upgrade-card-footer/);
   assert.match(card.markup,/upgrade-rarity-title/);
 }
 assert.match(gameCss,/#upgradeCardsContainer \.upgrade-card-desc \{[\s\S]*?font-size:16px/);
 assert.match(gameCss,/#upgradeCardsContainer \.upgrade-role-label \{[\s\S]*?font:750 12px/);
 assert.match(gameCss,/@media \(min-width:1100px\)/);
});


test('M5.24 motion effects use separate, strictly bounded per-profile live and per-frame budgets',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();const out={};for(const quality of ['high','medium','low']){graphicsQuality=quality;resetMotionFx();const emissions=[];for(let i=0;i<100;i++)emissions.push(emitMotionFx('PRISM',player.x,player.y));const first=motionFxSnapshot();const cue=[emitMotionFx('WAVE',player.x,player.y),emitMotionFx('BOSS',player.x,player.y),emitMotionFx('NOVA',player.x,player.y)];const cueState=motionFxSnapshot();for(let frame=0;frame<50;frame++){motionFxFrameCount=0;for(let n=0;n<8;n++)emitMotionFx('PRISM',player.x,player.y);}const stressed=motionFxSnapshot();out[quality]={cue,frameTotal:cueState.active,first:{active:first.active,emitted:first.emitted,frameDropped:first.frameDropped},stressed:{active:stressed.active,highWater:stressed.highWater,capDropped:stressed.capDropped,emitted:stressed.emitted},max:MOTION_FX_LIMITS[quality].live,perFrame:MOTION_FX_LIMITS[quality].frame};}return JSON.stringify(out);})()"));
 for(const value of Object.values(x)){
   assert.equal(value.first.active,value.perFrame-Math.min(2,value.perFrame-1));
   assert.deepEqual(value.cue,[true,true,false]);
   assert.equal(value.frameTotal,value.perFrame);
   assert.ok(value.first.frameDropped>0);
   assert.ok(value.stressed.active<=value.max);
   assert.ok(value.stressed.highWater<=value.max);
   assert.ok(value.stressed.capDropped>0);
 }
 assert.equal(x.high.max,64);
 assert.equal(x.medium.max,30);
 assert.equal(x.low.max,12);
});

test('M5.24 real dash, EMP Nova, Overdrive and prism riposte trigger distinct bounded animation motifs',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();graphicsQuality='high';nextBossTime=500;totalTime=10;const before={gold:totalGold,score,kills};player.dashDir={x:1,y:0};player.triggerDash();updateGame(.04);const afterDash=motionFxSnapshot();player.triggerNova();const afterNova=motionFxSnapshot();player.addOverdrive(200);const afterOverdrive=motionFxSnapshot();const ep=new EnemyProjectile(player.x+60,player.y,-300,0,6,15);enemyProjectiles=[ep];player.isDashing=false;activatePrismGuard();const blocked=deflectPrismProjectile(ep);const afterParry=motionFxSnapshot();return JSON.stringify({before,after:{gold:totalGold,score,kills},dash:afterDash.byKind.DASH,nova:afterNova.byKind.NOVA,overdrive:afterOverdrive.byKind.OVERDRIVE,prism:afterParry.byKind.PRISM,blocked,active:afterParry.active});})()"));
 assert.ok(x.dash>=1);
 assert.equal(x.nova,1);
 assert.equal(x.overdrive,1);
 assert.equal(x.prism,1);
 assert.equal(x.blocked,true);
 assert.ok(x.active<=64);
 assert.deepEqual(x.before,x.after);
});

test('M5.24 elite/boss and wave events emit identity cues without adding enemies or economy ties',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();graphicsQuality='high';nextBossTime=500;totalTime=10;const before=enemies.length;waveTimer=16.01;updateGame(.016);const afterWave=motionFxSnapshot().byKind.WAVE||0;const elite=new Enemy(player.x+80,player.y,'SHOOTER',true);elite.dead=false;enemies.push(elite);elite.die();const afterElite=motionFxSnapshot().byKind.ELITE||0;spawnBossEncounter();const bosses=motionFxSnapshot().byKind.BOSS||0;return JSON.stringify({before,afterWave,afterElite,bosses,bossCount:activeBosses.length,cap:motionFxSnapshot().limit});})()"));
 assert.equal(x.before,0);
 assert.equal(x.afterWave,1);
 assert.ok(x.afterElite>=1);
 assert.ok(x.bosses>=1);
 assert.ok(x.bossCount>=1);
 assert.equal(x.cap,64);
});

test('M5.24 offscreen rejection, short lifetime and new run reset prevent accumulating motion FX',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();graphicsQuality='high';const far=emitMotionFx('PRISM',-100000,-100000);const near=emitMotionFx('BOSS',player.x,player.y);const before=motionFxSnapshot();updateMotionFx(2);const after=motionFxSnapshot();startNewGame();return JSON.stringify({far,near,before,after,reset:motionFxSnapshot()});})()"));
 assert.equal(x.far,false);
 assert.equal(x.near,true);
 assert.equal(x.before.culled,1);
 assert.equal(x.before.active,1);
 assert.equal(x.after.active,0);
 assert.equal(x.reset.active,0);
 assert.equal(x.reset.emitted,0);
 assert.equal(x.reset.highWater,0);
});

test('M5.24 low graphics renders limited silhouettes, skips ambient and repeated micro-kill FX',()=>{
 const calls=[];
 const ctx=new Proxy({}, {get(_,k){return(...args)=>calls.push(String(k));}});
 const {run}=setup({}, {canvasContext:ctx});
 const x=JSON.parse(run("(()=>{startNewGame();graphicsQuality='low';const dash=emitMotionFx('DASH',player.x,player.y);const kill=emitMotionFx('KILL',player.x,player.y);const boss=emitMotionFx('BOSS',player.x,player.y);drawMotionBackdrop(ctx);drawMotionFx(ctx);return JSON.stringify({dash,kill,boss,s:motionFxSnapshot()});})()"));
 assert.equal(x.dash,false);
 assert.equal(x.kill,false);
 assert.equal(x.boss,true);
 assert.equal(x.s.active,1);
 assert.ok(x.s.qualityDropped>=2);
 assert.ok(calls.includes('arc'));
 assert.ok(calls.includes('lineTo'));
 assert.ok(calls.includes('stroke'));
 assert.ok(!calls.includes('fillRect'));
});

test('M5.24 cinematic extras preserve existing particle, weapon impact and lightning caps',()=>{
 assert.match(gameCode,/const MAX_VISIBLE_PARTICLES = 420;/);
 assert.match(gameCode,/const MAX_WEAPON_IMPACTS = 56;/);
 assert.match(gameCode,/const MAX_LIGHTNING_ARCS = 32;/);
 assert.match(gameCode,/const MOTION_FX_LIMITS=Object\.freeze/);
 assert.match(gameCode,/PREFERS_REDUCED_VFX_MOTION&&\(kind==='DASH'\|\|kind==='KILL'\)/);
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();return JSON.stringify({motion:window.getNeonMotionFx(),particles:particles.length,impacts:weaponImpacts.length,lightning:lightningBolts.length})})()"));
 assert.equal(x.motion.active,0);
 assert.equal(x.particles,0);
 assert.equal(x.impacts,0);
 assert.equal(x.lightning,0);
});


test('M5.25 cockpit health urgency uses actual percentage and keeps values accessible',()=>{
 const {run}=setup();
 const states=JSON.parse(run("(()=>{startNewGame();nextBossTime=5000;player.hp=player.maxHp;updateHUD();const high={...document.getElementById('hud').dataset};player.hp=player.maxHp*.47;updateHUD();const mid={...document.getElementById('hud').dataset};player.hp=player.maxHp*.19;updateHUD();const low={...document.getElementById('hud').dataset};const aria={hp:document.getElementById('hpBar').getAttribute('aria-valuenow'),xp:document.getElementById('xpBar').getAttribute('aria-valuenow')};return JSON.stringify({high,mid,low,aria,hpText:document.getElementById('hpText').textContent});})()"));
 assert.equal(states.high.vital,'steady');
 assert.equal(states.mid.vital,'wounded');
 assert.equal(states.low.vital,'critical');
 assert.equal(states.aria.hp,'19');
 assert.equal(states.aria.xp,'0');
 assert.ok(states.hpText.includes('/'));
});

test('M5.25 boss, warning, and overdrive cockpit states have explicit priorities',()=>{
 const {run}=setup();
 const values=JSON.parse(run("(()=>{startNewGame();totalTime=10;nextBossTime=5000;updateHUD();const patrol=document.getElementById('hud').dataset.combatAlert;combatDirector.profile.phase='WARNING';updateHUD();const warning=document.getElementById('hud').dataset.combatAlert;player.overdriveActive=true;updateHUD();const warningDuringDrive=document.getElementById('hud').dataset.combatAlert;combatDirector.profile.phase='PREPARATION';updateHUD();const drive=document.getElementById('hud').dataset.combatAlert;const e=new Enemy(player.x+130,player.y,'BOSS_DESTROYER');activeBosses=[e];updateHUD();const boss=document.getElementById('hud').dataset.combatAlert;return JSON.stringify({patrol,warning,warningDuringDrive,drive,boss});})()"));
 assert.equal(values.patrol,'patrol');
 assert.equal(values.warning,'warning');
 assert.equal(values.warningDuringDrive,'warning');
 assert.equal(values.drive,'overdrive');
 assert.equal(values.boss,'boss');
});

test('M5.25 combat skills expose visual readiness without modifying their mechanics',()=>{
 const {run}=setup();
 const data=JSON.parse(run("(()=>{startNewGame();totalTime=5;player.dashCooldown=0;player.novaCooldown=0;prismGuardReadyAt=0;updateHUD();const status=()=>['dashBtn','novaBtn','prismBtn','bastionBtn'].map(x=>[x,document.getElementById(x).dataset.ready]);const ready=status();player.dashCooldown=2;player.novaCooldown=4;prismGuardReadyAt=10;updateHUD();const charging=status();return JSON.stringify({ready,charging,damage:player.damage,gold:totalGold});})()"));
 assert.equal(data.ready[0][1],'true');
 assert.equal(data.ready[1][1],'true');
 assert.equal(data.ready[2][1],'true');
 assert.equal(data.charging[0][1],'false');
 assert.equal(data.charging[1][1],'false');
 assert.equal(data.charging[2][1],'false');
 assert.ok(data.damage>0);
 assert.equal(data.gold,50);
});


test('M5.26 wave-gated engineering alternates devices, offers paired reactors, and honors boss lockouts',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();worldWidth=1000;worldHeight=800;player.x=500;player.y=400;nextBossTime=800;conduitZones=[];activeQuest.point=null;combatDirector.activeArenaEvent=null;rng=()=>.3;wave=4;const early=maybeSpawnFieldDevice();wave=5;const first=maybeSpawnFieldDevice(),repeat=maybeSpawnFieldDevice();const firstKinds=fieldDevices.map(d=>d.kind);wave=8;const second=maybeSpawnFieldDevice();const both=fieldDevices.map(d=>d.kind);fieldDevices=[];wave=11;const pairOk=maybeSpawnFieldDevice();const pair=fieldDevices.map(d=>({x:d.x,y:d.y,kind:d.kind}));fieldDevices=[];wave=14;activeBosses=[new Enemy(150,150,'BOSS_DESTROYER')];const blocked=maybeSpawnFieldDevice();return JSON.stringify({early,first,repeat,firstKinds,second,both,pairOk,pair,blocked});})()"));
 assert.equal(x.early,false);assert.equal(x.first,true);assert.equal(x.repeat,false);
 assert.deepEqual(x.firstKinds,['CAPACITOR']);assert.equal(x.second,true);
 assert.deepEqual(x.both,['CAPACITOR','GRAVITON']);assert.equal(x.pairOk,true);
 assert.equal(x.pair.length,2);assert.ok(x.pair.every(d=>d.kind==='CAPACITOR'));
 assert.ok(Math.hypot(x.pair[0].x-x.pair[1].x,x.pair[0].y-x.pair[1].y)<=190);
 assert.equal(x.blocked,false);
});

test('M5.26 swept plasma shots, player dash and EMP Nova all activate field devices once',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;const d=spawnFieldDevice('CAPACITOR',player.x+110,player.y);const b=new Bullet(d.x-90,d.y,800,0,20,5,1,0);b.previousX=d.x-90;b.x=d.x+90;bullets.push(b);updateFieldDevices(.016);const shot={state:d.state,source:d.source,dead:b.dead};const duplicate=triggerFieldDevice(d,'shot');fieldDevices=[];const q=spawnFieldDevice('CAPACITOR',player.x+22,player.y);player.isDashing=true;updateFieldDevices(.016);const dash={state:q.state,source:q.source};player.isDashing=false;fieldDevices=[];player.novaCooldown=0;const g=spawnFieldDevice('GRAVITON',player.x+115,player.y);player.triggerNova();return JSON.stringify({shot,duplicate,dash,gravity:{state:g.state,source:g.source},stats:fieldDeviceStats});})()"));
 assert.deepEqual(x.shot,{state:'armed',source:'shot',dead:true});
 assert.equal(x.duplicate,false);assert.deepEqual(x.dash,{state:'armed',source:'dash'});
 assert.deepEqual(x.gravity,{state:'field',source:'nova'});
 assert.equal(x.stats.shotsCaptured,1);assert.equal(x.stats.gravityFields,1);
});

test('M5.26 volatile reactor has a visible fuse, limited friendly-fire risk and delayed chained blasts',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();nextBossTime=500;player.hasShield=false;player.invulnTimer=0;const a=spawnFieldDevice('CAPACITOR',player.x+90,player.y),b=spawnFieldDevice('CAPACITOR',player.x+205,player.y);const near=new Enemy(a.x+35,a.y,'TANK'),far=new Enemy(a.x+350,a.y,'TANK'),boss=new Enemy(a.x+15,a.y,'BOSS_TITAN');near.hp=500;far.hp=500;boss.hp=500;enemies.push(near,far,boss);const hp=player.hp,gold=totalGold;triggerFieldDevice(a,'shot');updateFieldDevices(.2);const delay={hp:player.hp,enemyHp:near.hp,blasts:fieldDeviceStats.blasts};updateFieldDevices(.34);const afterFirst={hp:player.hp,near:near.hp,far:far.hp,boss:boss.hp,chains:fieldDeviceStats.chainReactions,blasts:fieldDeviceStats.blasts};updateFieldDevices(.23);return JSON.stringify({delay,afterFirst,end:{...fieldDeviceStats},remaining:fieldDevices.length,gold,finalGold:totalGold,initialHp:hp});})()"));
 assert.equal(x.delay.blasts,0);assert.equal(x.delay.enemyHp,500);
 assert.ok(x.afterFirst.hp<x.initialHp);assert.ok(x.afterFirst.near<500);
 assert.equal(x.afterFirst.far,500);assert.equal(x.afterFirst.boss,500);
 assert.equal(x.afterFirst.chains,1);assert.equal(x.afterFirst.blasts,1);
 assert.equal(x.end.blasts,2);assert.equal(x.remaining,0);
 assert.equal(x.end.playerHits,1);assert.equal(x.gold,x.finalGold);
});

test('M5.26 graviton slows normal enemies but not bosses and expires without touching build or loot',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();const d=spawnFieldDevice('GRAVITON',player.x+110,player.y);const near=new Enemy(d.x+30,d.y,'SWARM'),far=new Enemy(d.x+380,d.y,'SWARM'),boss=new Enemy(d.x,d.y,'BOSS_VOID');const before=getFieldEnemyTimeScale(near);triggerFieldDevice(d,'shot');const active=[getFieldEnemyTimeScale(near),getFieldEnemyTimeScale(far),getFieldEnemyTimeScale(boss)];const gold=totalGold;updateFieldDevices(4.3);return JSON.stringify({before,active,after:getFieldEnemyTimeScale(near),count:fieldDevices.length,gold,finalGold:totalGold,stats:fieldDeviceStats});})()"));
 assert.equal(x.before,1);assert.deepEqual(x.active,[.55,1,1]);
 assert.equal(x.after,1);assert.equal(x.count,0);
 assert.equal(x.gold,x.finalGold);assert.equal(x.stats.gravityFields,1);
});

test('M5.26 hard device cap, boss cancellation, timeout and new-run reset',()=>{
 const {run}=setup();
 const x=JSON.parse(run("(()=>{startNewGame();spawnFieldDevice('CAPACITOR',player.x+90,player.y);spawnFieldDevice('GRAVITON',player.x+160,player.y);const before=window.getNeonFieldDevices();const third=spawnFieldDevice('CAPACITOR',player.x,player.y);spawnBossEncounter();const boss=window.getNeonFieldDevices();fieldDevices=[];spawnFieldDevice('CAPACITOR',player.x+80,player.y);for(let i=0;i<900;i++)updateFieldDevices(.016);const expired=window.getNeonFieldDevices();startNewGame();return JSON.stringify({before,third:third===null,boss,expired,reset:window.getNeonFieldDevices()});})()"));
 assert.equal(x.before.limit,2);assert.equal(x.before.devices.length,2);
 assert.equal(x.third,true);assert.equal(x.boss.devices.length,0);
 assert.equal(x.boss.stats.cancelled,2);assert.equal(x.expired.stats.expired,1);
 assert.equal(x.expired.devices.length,0);assert.equal(x.reset.devices.length,0);
 assert.equal(x.reset.stats.spawned,0);
});


test('M5.27 public showcase is a standalone static presentation with actual game route and no auto-running iframe',()=>{
  const showcase=fs.readFileSync(path.join(__dirname,'..','showcase.html'),'utf8');
  const js=fs.readFileSync(path.join(__dirname,'..','src','showcase.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','src','showcase.css'),'utf8');
  assert.match(showcase,/href="\.\/index\.html"/);
  assert.match(showcase,/id="loadPreviewBtn"/);
  assert.match(showcase,/id="stopPreviewBtn"/);
  assert.match(showcase,/id="langSwitch"/);
  assert.match(showcase,/NOT A GAMEPLAY SCREENSHOT/);
  assert.doesNotMatch(showcase,/<iframe\b/i);
  assert.match(js,/document\.createElement\('iframe'\)/);
  assert.match(js,/gameFrame\.remove\(\)/);
  assert.match(js,/gameFrame\.src = '\.\/index\.html'/);
  assert.doesNotMatch(js,/fetch\(|setInterval\(|localStorage/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.skip-link:focus/);
});

test('M5.27 public-facing links, media and factual documentation are present on disk',()=>{
  const root=path.join(__dirname,'..');
  const showcase=fs.readFileSync(path.join(root,'showcase.html'),'utf8');
  const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
  const press=fs.readFileSync(path.join(root,'docs','PRESSKIT.md'),'utf8');
  const publishing=fs.readFileSync(path.join(root,'docs','PUBLISHING.md'),'utf8');
  const cover=fs.readFileSync(path.join(root,'media','neon-core-cover.svg'),'utf8');
  for(const filename of ['src/showcase.css','src/showcase.js','docs/PRESSKIT.md',
    'docs/PUBLISHING.md','media/neon-core-cover.svg','.nojekyll']){
    assert.ok(fs.existsSync(path.join(root,filename)),filename+' missing');
  }
  assert.match(showcase,/id="press"/);
  assert.match(readme,/No public hosted demo is confirmed yet/);
  assert.match(readme,/Geliştirici/);
  assert.match(press,/not a screenshot of gameplay/);
  assert.match(press,/No verified public GitHub Pages deployment yet/);
  assert.match(publishing,/has_pages = false/);
  assert.match(cover,/<svg[\s>]/);
  assert.match(cover,/NOT A GAMEPLAY SCREENSHOT/);
  assert.match(pageHtml,/id="showcaseLink"[^>]*href="\.\/showcase\.html"/);
});

test('M5.27 a new game still loads exactly the same playable mechanics without showcase dependencies',()=>{
  const {run}=setup();
  const state=JSON.parse(run("(()=>{startNewGame();return JSON.stringify({gameState,player:!!player,wave,enemies:enemies.length,graphics:graphicsQuality,level:player.level});})()"));
  assert.equal(state.gameState,'PLAYING');
  assert.equal(state.player,true);
  assert.equal(state.wave,1);
  assert.equal(state.level,1);
  assert.equal(state.enemies,0);
});


test('M5.28 capture suite uses the real game and labels all staged evidence before publication',()=>{
  const root=path.join(__dirname,'..');
  const capture=fs.readFileSync(path.join(root,'tests','press.capture.spec.cjs'),'utf8');
  const config=fs.readFileSync(path.join(root,'playwright.capture.config.cjs'),'utf8');
  const pipeline=fs.readFileSync(path.join(root,'.github','workflows','neon-smoke.yml'),'utf8');
  const guide=fs.readFileSync(path.join(root,'docs','M5.28-gameplay-evidence.md'),'utf8');
  assert.match(capture,/renderGame\(\)/);
  assert.match(capture,/spawnEnemy\(false,type,false/);
  assert.match(capture,/spawnFieldDevice\('CAPACITOR'/);
  assert.match(capture,/spawnBossEncounter\(\)/);
  assert.match(capture,/triggerLevelUp\(\)/);
  assert.match(capture,/approved_for_publication: false/);
  assert.match(capture,/not an organic play session/i);
  assert.match(capture,/contact-sheet\.html/);
  assert.match(config,/workers:1/);
  assert.match(pipeline,/neon-gameplay-evidence/);
  assert.match(pipeline,/--config=playwright\.capture\.config\.cjs/);
  assert.match(guide,/Human publishing gate/);
});

test('M5.28 generated screenshots are ignored in git, not falsely advertised as live gallery',()=>{
  const root=path.join(__dirname,'..');
  const ignore=fs.readFileSync(path.join(root,'.gitignore'),'utf8');
  const showcase=fs.readFileSync(path.join(root,'showcase.html'),'utf8');
  const media=fs.readFileSync(path.join(root,'docs','PRESSKIT.md'),'utf8');
  assert.match(ignore,/^press-capture\/$/m);
  assert.match(showcase,/no approved public screenshot gallery/i);
  assert.match(media,/No \*\*approved\*\* public screenshots yet/);
  assert.doesNotMatch(showcase,/src="\.\/press-capture\//);
  assert.match(showcase,/M5\.28-gameplay-evidence\.md/);
});

test('Odak 0.2 ?wave=N starts the run at wave N with shifted clock and boss timer', () => {
  const plain = setup();
  assert.deepEqual(JSON.parse(plain.run('startNewGame(); JSON.stringify([wave,totalTime,nextBossTime])')), [1, 0, 55]);
  const { run } = setup({}, { locationSearch: '?wave=10' });
  assert.deepEqual(JSON.parse(run('startNewGame(); JSON.stringify([wave,totalTime,nextBossTime])')), [10, 144, 199]);
  // A restart keeps the requested start wave instead of drifting.
  assert.deepEqual(JSON.parse(run('startNewGame(); JSON.stringify([wave,totalTime,nextBossTime])')), [10, 144, 199]);
});

test('Odak 3.0 same ?seed and same input give the same first upgrades and spawns', () => {
  const trace = (search) => {
    const { run } = setup({}, { locationSearch: search });
    return JSON.parse(run(`(() => {
      startNewGame();
      player.hp = player.maxHp = 1e6;
      const seenEnemies = new Set(), spawns = [];
      let upgrades = null;
      for (let frame = 0; frame < 60 * 90 && (spawns.length < 20 || !upgrades); frame++) {
        if (gameState === 'LEVEL_UP') {
          upgrades = upgrades || currentUpgradeChoices.map(c => c.upg.id + ':' + c.rarity.id);
          selectUpgradeOption(0);
          continue;
        }
        updateGame(1 / 60);
        for (const e of enemies) {
          if (seenEnemies.has(e) || spawns.length >= 20) continue;
          seenEnemies.add(e);
          spawns.push([e.type, Math.round(e.x), Math.round(e.y), e.isElite ? 1 : 0]);
        }
      }
      return JSON.stringify({ seed: runSeed, spawns, upgrades });
    })()`));
  };
  const a = trace('?seed=2026'), b = trace('?seed=2026'), c = trace('?seed=7');
  assert.equal(a.seed, 2026);
  assert.equal(a.spawns.length, 20);
  assert.equal(a.upgrades?.length, 3);
  assert.deepEqual(b, a);
  assert.notDeepEqual(c.spawns, a.spawns);
});

test('Odak 3.0 rng is a stable mulberry32 stream that restarts with setRunSeed', () => {
  const { run } = setup();
  const draws = JSON.parse(run('setRunSeed(1); const a=[rng(),rng(),rng()]; setRunSeed(1); JSON.stringify([a,[rng(),rng(),rng()]])'));
  assert.deepEqual(draws[0], draws[1]);
  assert.ok(draws[0].every(x => x >= 0 && x < 1));
  assert.equal(draws[0][0].toFixed(6), '0.627074');
  // Without ?seed each run still gets its own fresh seed.
  const seeds = JSON.parse(run('startNewGame(); const s1=runSeed; startNewGame(); JSON.stringify([s1,runSeed])'));
  assert.notEqual(seeds[0], seeds[1]);
});

test('Odak 0.2 ?wave and ?unlock parsing rejects malformed values', () => {
  const { run } = setup();
  const read = search => JSON.parse(run(`JSON.stringify(readPlaytestParams(${JSON.stringify(search)}))`));
  assert.deepEqual(read(''), { wave: 1, unlockAll: false, seed: null });
  assert.deepEqual(read('?x=1&wave=7&unlock=all'), { wave: 7, unlockAll: true, seed: null });
  assert.equal(read('?seed=42').seed, 42);
  assert.equal(read('?seed=-3').seed, null);
  assert.equal(read('?seed=12345678901').seed, null);
  assert.equal(read('?wave=0').wave, 1);
  assert.equal(read('?wave=abc').wave, 1);
  assert.equal(read('?wave=-4').wave, 1);
  assert.equal(read('?wave=500').wave, 99);
  assert.equal(read('?wave=1234').wave, 1);
  assert.equal(read('?unlock=allx').unlockAll, false);
  assert.equal(read('?unlock=ALL').unlockAll, false);
});

test('Odak 0.2 ?unlock=all raises NEON_UNLOCK_ALL only when requested', () => {
  assert.equal(setup({}, { unlockAll: false }).run('window.NEON_UNLOCK_ALL === true'), false);
  assert.equal(setup({}, { unlockAll: false, locationSearch: '?unlock=all' }).run('window.NEON_UNLOCK_ALL'), true);
});

test('Odak 1.1 SYSTEM_UNLOCKS is a frozen single source covering levels 0..6', () => {
  const { run } = setup();
  const table = JSON.parse(run('JSON.stringify(SYSTEM_UNLOCKS)'));
  assert.equal(run('Object.isFrozen(SYSTEM_UNLOCKS)'), true);
  assert.equal(table.length, 13);
  assert.equal(new Set(table.map(s => s.id)).size, table.length);
  assert.deepEqual([...new Set(table.map(s => s.level))].sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(table.find(s => s.id === 'dash').level, 0);
  assert.equal(run('MAX_UNLOCK_LEVEL'), 6);
});

test('Odak 1.1 isSystemUnlocked follows unlockLevel and NEON_UNLOCK_ALL', () => {
  const { run } = setup({}, { unlockAll: false });
  const open = ids => JSON.parse(run(`JSON.stringify(${JSON.stringify(ids)}.map(isSystemUnlocked))`));
  assert.equal(run('unlockLevel'), 0);
  assert.deepEqual(open(['dash', 'emp', 'contracts', 'unknown']), [true, false, false, false]);
  run('unlockLevel = 2');
  assert.deepEqual(open(['emp', 'quests', 'overdrive', 'prism', 'chapters']), [true, true, true, true, false]);
  run('unlockLevel = 0; window.NEON_UNLOCK_ALL = true');
  assert.deepEqual(open(['emp', 'nemesis', 'contracts']), [true, true, true]);
});

test('Odak 1.1 v1 saves migrate to v2 with veteran unlocks from max wave', () => {
  const key = 'neonCekirdek.meta.v1';
  const v1 = maxWave => ({ [key]: JSON.stringify({ version: 1, gold: 120, highScore: 900, maxWave,
    upgrades: { baseDamage: 2, maxHp: 0, speedDash: 0, greed: 0, defibrillator: 0 } }) });
  const veteran = setup(v1(12));
  assert.equal(veteran.run('unlockLevel'), 6);
  assert.equal(veteran.run('totalGold'), 120);
  assert.equal(setup(v1(11)).run('unlockLevel'), 0);
  veteran.run('saveMetaProgress()');
  const saved = JSON.parse(veteran.stored[key]);
  assert.equal(saved.version, 2);
  assert.equal(saved.unlockLevel, 6);
  assert.equal(setup(veteran.stored).run('unlockLevel'), 6);
});

test('Odak 1.1 corrupt or out-of-range unlockLevel clamps into 0..6', () => {
  const key = 'neonCekirdek.meta.v1';
  const load = unlock => setup({ [key]: JSON.stringify({ version: 2, gold: 10, highScore: 0, maxWave: 30,
    unlockLevel: unlock, upgrades: {} }) }).run('unlockLevel');
  assert.equal(load(4), 4);
  assert.equal(load(99), 6);
  assert.equal(load(-1), 0);
  assert.equal(load('3'), 0);
  assert.equal(load(2.5), 0);
  assert.equal(load(null), 0);
  assert.equal(load(undefined), 0);
});

test('Odak 1.1 portable backup carries unlockLevel and migrates v1 backups', () => {
  const { run } = setup();
  const result = JSON.parse(run(`(() => {
    unlockLevel = 3; savedMaxWave = 4;
    const backup = JSON.stringify(createProgressBackup());
    const exported = JSON.parse(backup).progress.unlockLevel;
    unlockLevel = 0;
    const restored = restoreProgressBackup(backup);
    const afterRoundTrip = unlockLevel;
    const legacy = JSON.parse(backup);
    legacy.progress.version = 1; delete legacy.progress.unlockLevel; legacy.progress.maxWave = 15;
    const legacyRestored = restoreProgressBackup(JSON.stringify(legacy));
    const afterLegacy = unlockLevel;
    const tooHigh = JSON.parse(backup); tooHigh.progress.unlockLevel = 9;
    const rejected = restoreProgressBackup(JSON.stringify(tooHigh));
    return JSON.stringify({ exported, restored, afterRoundTrip, legacyRestored, afterLegacy,
      rejected, finalLevel: unlockLevel });
  })()`));
  assert.deepEqual(result, { exported: 3, restored: true, afterRoundTrip: 3, legacyRestored: true,
    afterLegacy: 6, rejected: false, finalLevel: 6 });
});

test('Odak 1.2 smoke harness opens every system unless a test opts out', () => {
  assert.equal(setup().run('window.NEON_UNLOCK_ALL'), true);
  assert.equal(setup().run('unlockLevel'), 0);
  assert.equal(setup().run("isSystemUnlocked('contracts')"), true);
  assert.equal(setup({}, { unlockAll: false }).run("isSystemUnlocked('contracts')"), false);
});

test('Odak 1.2 browser helper loads the real game with ?unlock=all by default', () => {
  const { gameUrl } = require('./browser.helpers.cjs');
  assert.equal(gameUrl(), '/index.html?unlock=all');
  assert.equal(gameUrl('/index.html?perf=1'), '/index.html?perf=1&unlock=all');
  assert.equal(gameUrl('/index.html?unlock=none&wave=3'), '/index.html?unlock=all&wave=3');
  assert.equal(gameUrl('/index.html', { unlockAll: false }), '/index.html');
  const { run } = setup({}, { unlockAll: false, locationSearch: gameUrl('/index.html?wave=4').split('/index.html')[1] });
  assert.equal(run('window.NEON_UNLOCK_ALL'), true);
  assert.equal(run('startNewGame(); wave'), 4);
});

// Odak 1.3 · each gate is checked locked (level below) and open (its level).
function gatedGame(level, before = '') {
  const game = setup({}, { unlockAll: false });
  game.run(`unlockLevel = ${level}; ${before} startNewGame();`);
  return game;
}

test('Odak 1.3 EMP Nova does not fire until level 1', () => {
  const nova = level => gatedGame(level).run('player.novaCooldown = 0; player.triggerNova(); player.novaCooldown');
  assert.equal(nova(0), 0);
  assert.ok(nova(1) > 0);
});

test('Odak 1.3 Prism Riposte refuses to activate until level 2', () => {
  const prism = level => gatedGame(level).run('totalTime = 30; prismGuardReadyAt = 0; activatePrismGuard()');
  assert.equal(prism(1), false);
  assert.equal(prism(2), true);
});

test('Odak 1.3 Bastion cannot be bought until level 5 and keeps gold', () => {
  const deploy = level => JSON.parse(gatedGame(level).run(`wave = 5; totalGold = 1000;
    nextBossTime = totalTime + 300; JSON.stringify([deployBastion(), totalGold, bastionUses])`));
  assert.deepEqual(deploy(4), [false, 1000, 0]);
  const [ok, gold, uses] = deploy(5);
  assert.equal(ok, true);
  assert.ok(gold < 1000);
  assert.equal(uses, 1);
});

test('Odak 1.3 quests are neither generated nor advanced until level 1', () => {
  const locked = gatedGame(0);
  assert.equal(locked.run("updateQuest(1); advanceQuest('KILL', 5); window.getNeonQuestSnapshot()"), null);
  assert.equal(locked.run('generateNextQuest()'), null);
  assert.notEqual(gatedGame(1).run('window.getNeonQuestSnapshot()'), null);
});

test('Odak 1.3 Overdrive never charges until level 2', () => {
  const charge = level => gatedGame(level).run('player.addOverdrive(50); player.overdrive');
  assert.equal(charge(1), 0);
  assert.ok(charge(2) > 0);
});

test('Odak 1.3 momentum stays 0 and grants no fire-rate bonus until level 4', () => {
  const momentum = level => gatedGame(level).run('player.momentum = 60; player.update(1 / 60); player.momentum');
  assert.equal(momentum(3), 0);
  assert.ok(momentum(4) > 0);
});

test('Odak 1.3 arena chapters stay off until level 3', () => {
  assert.equal(gatedGame(2).run('chapterIdForWave(7)'), null);
  assert.notEqual(gatedGame(3).run('chapterIdForWave(7)'), null);
});

test('Odak 1.3 conduit zones never spawn until level 3', () => {
  // Odak 1.5: the first spawn waits 40 s; skip ahead to just before it.
  // This test is about the lock gate, so another system's intro must not
  // defer the spawn through the one-intro-per-60-s rule (tested on its own).
  // The player waits in a corner: a zone spawned on top of it would be
  // charged and consumed within the 6 s window (about 1 in 30 seeds).
  const zones = level => JSON.parse(gatedGame(level).run(`player.takeDamage = () => {};
    player.x = 0; player.y = 0;
    systemIntroSeen.add('conduits');
    conduitSpawnTimer = 1;
    for (let i = 0; i < 12; i++) updateGame(0.5);
    JSON.stringify([conduitZones.length, conduitSpawnTimer])`));
  assert.deepEqual(zones(2), [0, 1]);
  assert.ok(zones(3)[0] >= 1);
});

test('Odak 1.3 field devices do not spawn until level 4', () => {
  const spawn = level => gatedGame(level).run(`wave = FIELD_RULES.firstWave;
    nextBossTime = totalTime + 300; maybeSpawnFieldDevice()`);
  assert.equal(spawn(3), false);
  assert.equal(spawn(4), true);
});

test('Odak 1.3 arena events are not offered until level 4', () => {
  const offer = level => gatedGame(level).run(`wave = 8; nextBossTime = totalTime + 300;
    combatDirector.nextArenaAt = 0;
    if (combatDirector.baseProfile) combatDirector.baseProfile.phase = 'PRESSURE';
    combatDirector.profile.phase = 'PRESSURE';
    combatDirector.updateArenaEvent(1 / 60); !!combatDirector.activeArenaEvent`);
  assert.equal(offer(3), false);
  assert.equal(offer(4), true);
});

test('Odak 1.3 Nemesis is not allowed until level 5', () => {
  const allowed = level => gatedGame(level).run('nextBossTime = totalTime + 300; nemesisAllowed()');
  assert.equal(allowed(4), false);
  assert.equal(allowed(5), true);
});

test('Odak 1.3 contracts fall back to STANDARD until level 6', () => {
  const contract = level => gatedGame(level, "selectedContractId = 'OVERCHARGE';").run('activeContractId');
  assert.equal(contract(5), 'STANDARD');
  assert.equal(contract(6), 'OVERCHARGE');
});

test('Odak 1.3 upgrade cards respect requires and EMP-free descriptions', () => {
  const draws = level => JSON.parse(gatedGame(level).run(`(() => {
    const seen = new Set();
    for (let i = 0; i < 60; i++) { populateUpgradeCards(); currentUpgradeChoices.forEach(c => seen.add(c.upg.id)); }
    return JSON.stringify([...seen]);
  })()`));
  const locked = draws(0);
  assert.ok(!locked.includes('overdrive_boost'));
  assert.ok(locked.includes('phase_echo'));
  assert.ok(draws(2).includes('overdrive_boost'));
  const desc = level => gatedGame(level).run("UPGRADES_POOL.find(u => u.id === 'kinetic_magnet').getDesc({ mult: 1 })");
  assert.doesNotMatch(desc(0), /EMP/);
  assert.match(desc(1), /EMP Nova/);
  assert.equal(gatedGame(0).run("UPGRADES_POOL.find(u => u.id === 'overdrive_boost').requires"), 'overdrive');
  assert.equal(gatedGame(0).run("UPGRADES_POOL.find(u => u.id === 'phase_echo').requires"), 'dash');
});

// Odak 1.4 · unlock rule and unlock moment.
function endLockedRun(run, reachedWave) {
  return JSON.parse(run(`(()=>{startNewGame();wave=${reachedWave};triggerGameOver();
    return JSON.stringify({level:unlockLevel,failed:unlockFailedRuns,result:lastRunUnlock,
      block:document.getElementById('reportUnlockBlock').innerHTML});})()`));
}

test('Odak 1.4 reaching wave 3 on a clean save opens EMP and Quests and persists', () => {
  const a = setup({}, { unlockAll: false });
  const out = endLockedRun(a.run, 3);
  assert.equal(out.level, 1);
  assert.deepEqual(out.result, { level: 1, gate: 3, byFallback: false, systems: ['emp', 'quests'] });
  assert.equal(a.run("isSystemUnlocked('emp') && isSystemUnlocked('quests')"), true);
  assert.equal(a.run("isSystemUnlocked('overdrive')"), false);
  const saved = JSON.parse(a.stored['neonCekirdek.meta.v1']);
  assert.equal(saved.unlockLevel, 1);
  assert.equal(saved.unlockSpotlight, true);
  const b = setup(a.stored, { unlockAll: false });
  assert.equal(b.run('unlockLevel'), 1);
  assert.equal(b.run('unlockSpotlightPending'), true);
});

test('Odak 1.4 each gate opens exactly one level, only when reached', () => {
  const gates = [3, 5, 6, 8, 9, 11];
  const { run } = setup({}, { unlockAll: false });
  assert.deepEqual(JSON.parse(run('JSON.stringify(UNLOCK_WAVE_GATES)')), gates);
  gates.forEach((gate, level) => {
    run(`unlockLevel=${level};unlockFailedRuns=0`);
    assert.equal(endLockedRun(run, gate - 1).level, level, 'wave ' + (gate - 1) + ' stays at ' + level);
    run('unlockFailedRuns=0');
    const out = endLockedRun(run, 99);
    assert.equal(out.level, level + 1, 'a long run still opens a single level');
    assert.equal(out.result.gate, gate);
  });
  const maxed = endLockedRun(run, 99);
  assert.equal(maxed.level, 6);
  assert.equal(maxed.result, null);
  assert.equal(maxed.block, '');
});

test('Odak 1.4 three missed gates in a row open the next level anyway', () => {
  const a = setup({}, { unlockAll: false });
  assert.equal(endLockedRun(a.run, 2).failed, 1);
  assert.equal(JSON.parse(a.stored['neonCekirdek.meta.v1']).unlockFailedRuns, 1);
  const b = setup(a.stored, { unlockAll: false });
  assert.equal(endLockedRun(b.run, 1).failed, 2);
  const third = endLockedRun(b.run, 2);
  assert.equal(third.level, 1);
  assert.equal(third.failed, 0);
  assert.equal(third.result.byFallback, true);
  assert.match(third.block, /üç koşu üst üste/);
  // A pass resets the counter as well.
  b.run('unlockFailedRuns=2');
  const passed = endLockedRun(b.run, 5);
  assert.equal(passed.level, 2);
  assert.equal(passed.failed, 0);
  assert.equal(passed.result.byFallback, false);
});

test('Odak 1.4 ?unlock=all never changes saved unlock progress', () => {
  const a = setup();
  const out = endLockedRun(a.run, 12);
  assert.equal(out.level, 0);
  assert.equal(out.result, null);
  assert.equal(out.block, '');
  assert.equal(JSON.parse(a.stored['neonCekirdek.meta.v1']).unlockLevel, 0);
});

test('Odak 1.4 the report announces each new system with its input', () => {
  const { run } = setup({}, { unlockAll: false });
  const block = endLockedRun(run, 3).block;
  assert.match(block, /YENİ PROTOKOL AÇILDI/);
  assert.match(block, /EMP Nova/);
  assert.match(block, /Görevler/);
  assert.match(block, /E · SAĞ TIK/);
  const touch = run("unlockAnnouncementMarkup({level:2,gate:5,byFallback:false,systems:['overdrive','prism']},true)");
  assert.match(touch, /PRİZMA BUTONU/);
  assert.match(touch, /BAR DOLUNCA/);
  assert.equal(run('unlockAnnouncementMarkup(null)'), '');
  for (const s of JSON.parse(run('JSON.stringify(SYSTEM_UNLOCKS.filter(s=>s.level>0).map(s=>s.id))')))
    assert.ok(run(`!!SYSTEM_UNLOCK_INFO['${s}']?.desc`), s + ' has an announcement');
  run('startNewGame()');
  assert.equal(run('lastRunUnlock'), null, 'the next run starts without the old announcement');
});

test('Odak 1.4 the next run spotlights the new systems for 20 seconds once', () => {
  const a = setup({}, { unlockAll: false });
  endLockedRun(a.run, 3);
  const b = setup(a.stored, { unlockAll: false });
  const ids = JSON.parse(b.run('startNewGame();JSON.stringify(unlockSpotlightIds)'));
  assert.deepEqual(ids, ['emp', 'quests']);
  assert.equal(JSON.parse(b.stored['neonCekirdek.meta.v1']).unlockSpotlight, false);
  b.run('totalTime += 19.9; updateHUD()');
  assert.equal(b.run('unlockSpotlightIds.length'), 2);
  b.run('totalTime += 0.2; updateHUD()');
  assert.equal(b.run('unlockSpotlightIds.length'), 0);
  b.run('startNewGame()');
  assert.equal(b.run('unlockSpotlightIds.length'), 0, 'only the first run after the unlock');
});

test('Odak 1.4 the controls tab hint names the next gate', () => {
  const { run } = setup({}, { unlockAll: false });
  const hint = (level) => run(`unlockLevel=${level};updateMenuCounters();document.getElementById('menuUnlockHint').textContent`);
  assert.equal(hint(0), "Yeni protokol: Dalga 3'e ulaşınca açılır.");
  assert.equal(hint(2), "Yeni protokol: Dalga 6'ya ulaşınca açılır.");
  assert.equal(hint(4), "Yeni protokol: Dalga 9'a ulaşınca açılır.");
  assert.equal(hint(5), "Yeni protokol: Dalga 11'e ulaşınca açılır.");
  assert.equal(hint(6), '');
  assert.equal(setup().run("updateMenuCounters();document.getElementById('menuUnlockHint').textContent"), '');
});

test('Odak 1.4 backups carry the fallback counter', () => {
  const { run } = setup({}, { unlockAll: false });
  const backup = run('unlockFailedRuns=2;JSON.stringify(createProgressBackup())');
  assert.equal(JSON.parse(backup).progress.unlockFailedRuns, 2);
  assert.equal(run(`parseProgressBackup(${JSON.stringify(backup)}).progress.unlockFailedRuns`), 2);
  const older = JSON.parse(backup); delete older.progress.unlockFailedRuns;
  assert.equal(run(`parseProgressBackup(${JSON.stringify(JSON.stringify(older))}).progress.unlockFailedRuns`), 0);
  const bad = JSON.parse(backup); bad.progress.unlockFailedRuns = 3;
  assert.equal(run(`parseProgressBackup(${JSON.stringify(JSON.stringify(bad))})`), null);
  run('unlockFailedRuns=0;unlockSpotlightPending=true');
  assert.equal(run(`restoreProgressBackup(${JSON.stringify(backup)})`), true);
  assert.equal(run('unlockFailedRuns'), 2);
  assert.equal(run('unlockSpotlightPending'), false);
});

// Odak 1.5 · in-run spacing of first appearances.
test('Odak 1.5 systems first appear later in a run', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{startNewGame();nextBossTime=5000;
    const timer=conduitSpawnTimer;
    const chapters=[5,6].map(w=>chapterIdForWave(w));
    const field=[4,5].map(w=>{wave=w;fieldDeviceLastWave=0;fieldDevices=[];return maybeSpawnFieldDevice();});
    return JSON.stringify({timer,chapters,field,
      rules:[CONDUIT_RULES.firstSpawn,FIELD_RULES.firstWave,CHAPTER_RULES.firstWave,
        ARENA_EVENT_RULES.firstWave,NEMESIS_RULES.firstWave]});})()`));
  assert.equal(x.timer, 40);
  assert.deepEqual(x.chapters, [null, 'FOUNDRY']);
  assert.deepEqual(x.field, [false, true]);
  assert.deepEqual(x.rules, [40, 5, 6, 7, 10]);
});

test('Odak 1.5 arena events and the Echo Hunter wait for waves 7 and 10', () => {
  const { run } = setup();
  const arena = w => run(`(()=>{startNewGame();wave=${w};totalTime=150;nextBossTime=500;
    combatDirector.nextArenaAt=0;combatDirector.profile.phase='BUILDUP';combatDirector.updateArenaEvent(.01);
    return !!combatDirector.activeArenaEvent;})()`);
  assert.equal(arena(6), false);
  assert.equal(arena(7), true);
  const hunter = w => run(`(()=>{startNewGame();nextBossTime=5000;wave=${w};waveTimer=2;totalTime=150;
    enemies=[new Enemy(70,70,'SHOOTER')];updateNemesis(.02);return getNemesisSnapshot().active;})()`);
  assert.equal(hunter(7), false);
  assert.equal(hunter(10), true);
});

test('Odak 1.5 at most one first appearance per 60 s, retried every 20 s', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{startNewGame();const out=[];
    const at=(t,id)=>{totalTime=t;out.push([t,id,claimSystemIntro(id)]);};
    at(0,'conduits');at(10,'chapters');at(25,'chapters');at(30,'chapters');at(50,'chapters');
    at(61,'conduits');at(70,'chapters');at(75,'nemesis');
    return JSON.stringify({out,retry:systemIntroRetryAt.nemesis});})()`));
  assert.deepEqual(x.out.map(r => r[2]), [true, false, false, false, false, true, true, false]);
  assert.equal(x.retry, 95);
});

test('Odak 1.5 a deferred field device still lands off its usual wave', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{startNewGame();nextBossTime=5000;
    totalTime=80;wave=6;updateArenaChapter(.02);const chapter=arenaChapter;
    totalTime=100;wave=8;const blocked=maybeSpawnFieldDevice();
    totalTime=121;wave=9;const stillBlocked=maybeSpawnFieldDevice();
    totalTime=141;const landed=maybeSpawnFieldDevice();
    return JSON.stringify({chapter,blocked,stillBlocked,landed,count:fieldDevices.length});})()`));
  assert.deepEqual(x, { chapter: 'FOUNDRY', blocked: false, stillBlocked: false, landed: true, count: 1 });
});

test('Odak 1.5 a new run forgets earlier first appearances', () => {
  const { run } = setup();
  assert.equal(run("startNewGame();totalTime=10;claimSystemIntro('conduits');startNewGame();totalTime=0;claimSystemIntro('chapters')"), true);
});

// Odak 2.2 · contextual HUD items and the cached HUD nodes.
test('Odak 2.2 showContextual holds an item for its time, then one sweep fades it', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{startNewGame();const el=document.getElementById('goldHudChip');
    const seen=[];const at=t=>{totalTime=t;updateContextualHud();seen.push(el.dataset.context);};
    totalTime=10;showContextual(el,2000);totalTime=11;showContextual(el,500);at(11.9);at(12.01);
    showContextual(el,300);at(12.2);at(12.4);
    return JSON.stringify({seen,left:hudContextUntil.size});})()`));
  // A shorter request never cuts an existing hold short.
  assert.deepEqual(x.seen, ['on', 'off', 'on', 'off']);
  assert.equal(x.left, 0);
});

test('Odak 2.2 gold, quest, combo and gauges appear only when they matter', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{startNewGame();nextBossTime=5000;
    const ctx=id=>document.getElementById(id).dataset.context||'off';
    totalTime=20;combo=4;player.overdrive=79;player.momentum=79;updateHUD();
    const calm={gold:ctx('goldHudChip'),combo:ctx('comboContainer'),od:ctx('overdriveMeter'),mom:ctx('momentumMeter')};
    totalGold+=15;combo=5;player.overdrive=80;player.momentum=80;updateHUD();
    const busy={gold:ctx('goldHudChip'),combo:ctx('comboContainer'),od:ctx('overdriveMeter'),mom:ctx('momentumMeter')};
    combo=1;player.overdrive=10;player.momentum=10;totalTime=20.5;updateHUD();
    const dropped={gold:ctx('goldHudChip'),combo:ctx('comboContainer'),od:ctx('overdriveMeter'),mom:ctx('momentumMeter')};
    totalTime=22.1;updateHUD();const goldLater=ctx('goldHudChip');
    totalTime=25;generateNextQuest('ORBS');totalTime=28.1;updateHUD();const questIdle=ctx('questHudBox');totalTime=30;advanceQuest('ORBS',1);const quest=ctx('questHudBox');
    totalTime=33.1;updateHUD();const questLater=ctx('questHudBox');
    return JSON.stringify({calm,busy,dropped,goldLater,questIdle,quest,questLater});})()`));
  assert.deepEqual(x.calm, { gold: 'off', combo: 'off', od: 'off', mom: 'off' });
  assert.deepEqual(x.busy, { gold: 'on', combo: 'on', od: 'on', mom: 'on' });
  assert.deepEqual(x.dropped, { gold: 'on', combo: 'off', od: 'off', mom: 'off' });
  assert.equal(x.goldLater, 'off');
  assert.equal(x.questIdle, 'off');
  assert.equal(x.quest, 'on');
  assert.equal(x.questLater, 'off');
});

test('Odak 2.2 updateHUD reuses cached HUD nodes instead of looking them up', () => {
  const { run } = setup();
  const lookups = run(`(()=>{startNewGame();nextBossTime=5000;updateHUD();
    const original=document.getElementById;let n=0;
    document.getElementById=id=>{n++;return original(id);};
    updateHUD();document.getElementById=original;return n;})()`);
  const before = run(`(()=>{const original=document.getElementById;let n=0;
    document.getElementById=id=>{n++;return original(id);};
    updateArenaChapterHud();updateNemesisHud();updatePrismGuardHud();updateFieldDeviceHud();
    updateTacticalHint();updateBastionHud();document.getElementById=original;return n;})()`);
  // Only the per-system helpers still look up their own nodes.
  assert.equal(lookups, before);
});

test('Odak 2.5 the turn-sideways tip shows once, only on a touch phone held upright', () => {
  const a = setup();
  a.run('startNewGame()');
  assert.equal(a.stored['neonCekirdek.rotateHint.v1'], undefined, 'no matchMedia: desktop sandbox');
  a.run('window.matchMedia = q => ({ matches: q.includes("coarse") })');
  assert.equal(a.run('maybeShowRotateHint()'), false, 'landscape touch phone');
  a.run('window.matchMedia = () => ({ matches: true })');
  a.run('startNewGame()');
  assert.equal(a.stored['neonCekirdek.rotateHint.v1'], '1');
  assert.equal(a.run('maybeShowRotateHint()'), false, 'only once');
  const b = setup(a.stored);
  b.run('window.matchMedia = () => ({ matches: true })');
  assert.equal(b.run('maybeShowRotateHint()'), false, 'once per device, across reloads');
});

// Odak 2.7 · enemy flow follows the arena area on small screens.
test('Odak 2.7 small arenas get fewer spawn tokens and a lower enemy cap', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{startNewGame();nextBossTime=1000;wave=6;totalTime=40;
    const base=getDirectorProfile(40,6,0,1000,-Infinity,1);
    const at=(w,h)=>{worldWidth=w;worldHeight=h;combatDirector.update(.01);
      return {scale:arenaDensityScale(),rate:combatDirector.profile.tokenRate,cap:combatDirector.profile.cap,
        same:combatDirector.profile===combatDirector.baseProfile};};
    const desktop=at(1327,829),phone=at(520,1125),tiny=at(300,500);
    const kept=scaleDirectorProfileForArena(base,1)===base;
    return JSON.stringify({base:{rate:base.tokenRate,cap:base.cap},desktop,phone,tiny,kept});})()`));
  // Desktop arenas keep the plan's director values untouched.
  assert.equal(x.kept, true);
  assert.equal(x.desktop.scale, 1);
  assert.equal(x.desktop.rate, x.base.rate);
  assert.equal(x.desktop.cap, x.base.cap);
  // A 390x844 phone (world 520x1125) gets sqrt(0.585) of the flow.
  assert.ok(Math.abs(x.phone.scale - Math.sqrt(520 * 1125 / 1e6)) < 1e-9);
  assert.ok(Math.abs(x.phone.rate - x.base.rate * x.phone.scale) < 1e-9);
  assert.equal(x.phone.cap, Math.round(x.base.cap * x.phone.scale));
  assert.equal(x.phone.same, true);
  // Never below half the desktop flow.
  assert.equal(x.tiny.scale, 0.5);
});

test('Odak 2.7c canvas fills the screen when the mobile address bar hides', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{window.devicePixelRatio=1;
    document.documentElement.clientWidth=724;document.documentElement.clientHeight=280;
    window.innerWidth=724;window.innerHeight=336;resizeCanvas();
    return JSON.stringify({css:canvas.style.height,world:Math.round(worldHeight),scale:viewScale});})()`));
  // Measured on a TECNO CK6n in landscape: the old code drew only 280 of 336 px.
  assert.equal(x.css, '336px');
  assert.equal(x.world, Math.round(336 / x.scale));
});

// Odak 2.7d · automatic graphics step-down for slow devices.
test('Odak 2.7d slow play steps graphics down once per window and remembers it', () => {
  const store = {};
  const { run } = setup(store);
  const x = JSON.parse(run(`(()=>{let now=10000;const play=(ms,seconds,playing=true)=>{const out=[];
      for(let t=0;t<seconds*1000;t+=ms){now+=ms;const r=observeGraphicsFrame(ms,now,playing);if(r)out.push(r);}return out;};
    const start=graphicsQuality;
    const smooth=play(16.7,8);                 // 60 fps: nothing changes
    const menu=play(55,8,false);               // slow menus never count
    const slow=play(33,8);                     // ~30 fps: one step, then cooldown
    const afterSlow=graphicsQuality;
    const verySlow=play(55,12);                // ~18 fps: straight to low
    const end=graphicsQuality;const stepsAtLow=graphicsAuto.steps;
    play(55,10);                               // already low: no more steps
    return JSON.stringify({start,smooth,menu,slow,afterSlow,verySlow,end,stepsAtLow,steps:graphicsAuto.steps,
      saved:localStorage.getItem(GRAPHICS_AUTO_SAVE_KEY),explicit:localStorage.getItem(GRAPHICS_SAVE_KEY)});})()`));
  assert.equal(x.start, 'high');
  assert.deepEqual(x.smooth, []);
  assert.deepEqual(x.menu, []);
  assert.deepEqual(x.slow, ['medium']);
  assert.equal(x.afterSlow, 'medium');
  assert.deepEqual(x.verySlow, ['low']);
  assert.equal(x.end, 'low');
  assert.equal(x.steps, x.stepsAtLow);
  assert.equal(x.saved, 'low');
  // The automatic result is not a hand-picked choice.
  assert.equal(x.explicit, null);
  const reloaded = setup(store);
  assert.equal(reloaded.run('graphicsQuality'), 'low');
  assert.equal(reloaded.run('graphicsAuto.enabled'), true);
});

test('Odak 2.7d a hand-picked graphics quality is never changed automatically', () => {
  const { run } = setup({ 'neonCekirdek.graphics.v1': 'high', 'neonCekirdek.graphicsAuto.v1': 'low' });
  const x = JSON.parse(run(`(()=>{let now=0;const out=[];
    for(let t=0;t<20000;t+=55){now+=55;const r=observeGraphicsFrame(55,now,true);if(r)out.push(r);}
    return JSON.stringify({quality:graphicsQuality,auto:graphicsAuto.enabled,out});})()`));
  assert.deepEqual(x, { quality: 'high', auto: false, out: [] });
});

test('Odak 3.6 gold stops growing past wave 20 and greed no longer boosts XP', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{
    const pickup=(w)=>{startNewGame();wave=w;const before=totalGold;
      const o=new EnergyOrb(player.x,player.y,1,true);o.update(1/60);return totalGold-before;};
    const orb={w5:pickup(5),w20:pickup(20),w40:pickup(40)};
    const chest={w20:getChestRewardProfile('elite',20,100,1).goldHeal.gold,w60:getChestRewardProfile('elite',60,100,1).goldHeal.gold};
    metaUpgrades.greed=8;startNewGame();
    const greedy={gold:player.greedBonus,xpMult:player.xpMultiplier,orb:pickup(20)};
    const xp0=player.xp;player.gainXp(10);
    return JSON.stringify({orb,chest,greedy,xpGain:player.xp-xp0});})()`));
  assert.ok(x.orb.w5 < x.orb.w20, 'gold still grows in early waves');
  assert.equal(x.orb.w40, x.orb.w20);
  assert.equal(x.chest.w60, x.chest.w20);
  assert.equal(x.greedy.xpMult, 1);
  assert.equal(x.xpGain, 10);
  assert.ok(Math.abs(x.greedy.gold - 1.8) < 1e-9);
  assert.equal(x.greedy.orb, Math.round(x.orb.w20 * 1.8));
});

test('Odak 3.7 locked content stays out of runs until bought, and the purchase persists', () => {
  const store = {};
  const { run } = setup(store, { unlockAll: false });
  const x = JSON.parse(run(`(()=>{
    unlockLevel=MAX_UNLOCK_LEVEL;savedMaxWave=10;totalGold=5000;selectedChassis='TITAN';startNewGame();
    const gated=CONTENT_UNLOCKS.filter(c=>c.type!=='chassis').map(c=>c.id);
    const offered=UPGRADES_POOL.filter(u=>isUpgradeAvailable(u)).map(u=>u.id);
    const before={chassis:player.chassis,leaked:gated.filter(id=>offered.includes(id))};
    const poor=(()=>{const g=totalGold;totalGold=10;const ok=buyContent('shock_ring');totalGold=g;return ok;})();
    const bought=buyContent('shock_ring')&&buyContent('TITAN');
    const again=buyContent('TITAN');
    selectChassis('TITAN');startNewGame();
    return JSON.stringify({before,poor,bought,again,gold:totalGold,
      ring:isUpgradeAvailable(UPGRADES_POOL.find(u=>u.id==='shock_ring')),chassis:player.chassis});})()`));
  assert.deepEqual(x.before, { chassis: 'VANGUARD', leaked: [] });
  assert.equal(x.poor, false);
  assert.equal(x.bought, true);
  assert.equal(x.again, false, 'owned content cannot be bought twice');
  assert.equal(x.gold, 5000 - 1300 - 1800);
  assert.equal(x.ring, true);
  assert.equal(x.chassis, 'TITAN');
  const reloaded = setup(store, { unlockAll: false });
  assert.equal(reloaded.run("[...ownedContent].sort().join(',')"), 'TITAN,shock_ring');
  assert.equal(reloaded.run('totalGold'), 1900);
});

test('Odak 3.7 backups carry owned content and reject unknown ids', () => {
  const { run } = setup({}, { unlockAll: false });
  const x = JSON.parse(run(`(()=>{
    ownedContent=new Set(['PHANTOM','coolant']);
    const raw=JSON.stringify(createProgressBackup());
    const ok=parseProgressBackup(raw).progress.owned;
    const bad=JSON.parse(raw);bad.progress.owned=['PHANTOM','laser'];
    const old=JSON.parse(raw);delete old.progress.owned;
    ownedContent=new Set();
    const restored=restoreProgressBackup(raw);
    return JSON.stringify({ok,bad:parseProgressBackup(JSON.stringify(bad)),old:parseProgressBackup(JSON.stringify(old)).progress.owned,
      restored,owned:[...ownedContent].sort()});})()`));
  assert.deepEqual(x.ok, ['PHANTOM', 'coolant']);
  assert.equal(x.bad, null);
  assert.deepEqual(x.old, []);
  assert.equal(x.restored, true);
  assert.deepEqual(x.owned, ['PHANTOM', 'coolant']);
});

// Odak 5.2 · after the lab the goal points at the cheapest costume, then at the record.
test('Odak 3.8 next goal walks collection, then lab, then costumes, then the record', () => {
  const { run } = setup({}, { unlockAll: false });
  const x = JSON.parse(run(`(()=>{
    savedMaxWave=10;const out=[];totalGold=0;out.push(getMenuNextGoal());
    totalGold=1000;out.push(getMenuNextGoal());
    CONTENT_UNLOCKS.forEach(c=>ownedContent.add(c.id));out.push(getMenuNextGoal());
    META_SHOP_ITEMS.forEach(i=>metaUpgrades[i.key]=i.maxLevel);out.push(getMenuNextGoal());
    COSMETICS.forEach(c=>ownedCosmetics.add(c.id));out.push(getMenuNextGoal());
    return JSON.stringify(out.map(g=>({kind:g.kind,id:g.id,ready:g.ready})));})()`));
  assert.deepEqual(x[0], { kind: 'content', id: 'coolant', ready: false });
  // With 1000 gold the cheapest locked item is affordable, so the card says it is ready.
  assert.equal(x[1].kind, 'content');
  assert.equal(x[1].ready, true);
  assert.equal(x[2].kind, 'lab');
  assert.deepEqual(x[3], { kind: 'cosmetic', id: 'core_gold', ready: true });
  assert.equal(x[4].kind, 'record');
});

test('Odak 3.8 the last run summary survives a reload and ignores broken saves', () => {
  const store = {};
  const { run } = setup(store);
  run(`startNewGame();wave=7;score=4321;sessionGold=333;totalTime=125.4;triggerGameOver();`);
  const reloaded = setup(store);
  assert.deepEqual(JSON.parse(reloaded.run('JSON.stringify(lastRunSummary)')),
    { score: 4321, wave: 7, seconds: 125, gold: 333, chassis: 'VANGUARD' });
  assert.equal(reloaded.run('formatRunClock(125)'), '2:05');
  const saved = JSON.parse(store['neonCekirdek.meta.v1']);
  saved.lastRun = { score: -5, wave: 'x' };
  store['neonCekirdek.meta.v1'] = JSON.stringify(saved);
  assert.equal(setup(store).run('lastRunSummary'), null);
});

test('Odak 3.10 collection items need their wave before gold can buy them', () => {
  const { run } = setup({}, { unlockAll: false });
  const x = JSON.parse(run(`(()=>{
    totalGold=5000;savedMaxWave=3;
    const early={titan:buyContent('TITAN'),coolant:buyContent('coolant'),gold:totalGold};
    const goal=getMenuNextGoal();
    savedMaxWave=4;const later=buyContent('TITAN');
    savedMaxWave=1;ownedContent=new Set();totalGold=0;
    const fresh=getMenuNextGoal();
    return JSON.stringify({early,goal:{kind:goal.kind,id:goal.id},later,fresh:{kind:fresh.kind,id:fresh.id,wave:fresh.wave},
      dative:[waveDative(3),waveDative(4),waveDative(6),waveDative(10)],hint:unlockHintText(5)});})()`));
  assert.deepEqual(x.early, { titan: false, coolant: true, gold: 4300 });
  // Nothing else is buyable at wave 3, so the goal points at the nearest wave condition.
  assert.deepEqual(x.goal, { kind: 'wave', id: 'TITAN' });
  assert.equal(x.later, true);
  assert.deepEqual(x.fresh, { kind: 'wave', id: 'coolant', wave: 3 });
  assert.deepEqual(x.dative, ["3'e", "4'e", "6'ya", "10'a"]);
  assert.equal(x.hint, "Yeni protokol: Dalga 5'e ulaşınca açılır.");
});

test('Odak 4.1 a slow 12 s loop now closes the circuit; a 16 s loop still times out', () => {
  const { run } = setup();
  const loop = (seconds) => JSON.parse(run(`(()=>{startNewGame();player.upgradeCounts.circuit_weaver=1;player.refreshBuildTraits();
    player.x=300;player.y=200;recordCircuitWeaverMotion(player,0,false);const route=[];
    for(let n=1;n<=6;n++)route.push([300+20*n,200]);for(let n=1;n<=6;n++)route.push([420,200+20*n]);
    for(let n=1;n<=6;n++)route.push([420-20*n,320]);for(let n=1;n<=6;n++)route.push([300,320-20*n]);
    let fired=0;const step=${seconds}/route.length;
    for(const [x,y] of route){player.x=x;player.y=y;totalTime+=step;if(recordCircuitWeaverMotion(player,20,false))fired++;}
    return JSON.stringify({fired,closures:player.buildStats.circuitClosures});})()`));
  assert.deepEqual(loop(12), { fired: 1, closures: 1 });
  assert.deepEqual(loop(16), { fired: 0, closures: 0 });
});

test('Odak 4.2 the first quest pauses once for its guide, then never again after a reload', () => {
  const store = {};
  const { run } = setup(store, { guides: true });
  const x = JSON.parse(run(`(()=>{startNewGame();guideQueue=[];generateNextQuest('KILLS');
    const queued=guideQueue.map(g=>g.id);updateGame(.5);const early=gameState;
    totalTime=1.3;updateGame(.016);const shown=gameState,id=activeGuide&&activeGuide.id;
    const text=document.getElementById('guideHow').textContent;
    const frozen=totalTime;keys.KeyW=true;
    closeGuide();const after=gameState;
    return JSON.stringify({queued,early,shown,id,text:text.length>20,frozen,after,seen:[...guidesSeen]});})()`));
  assert.deepEqual(x.queued, ['quests']);
  assert.equal(x.early, 'PLAYING');
  assert.equal(x.shown, 'GUIDE');
  assert.equal(x.id, 'quests');
  assert.equal(x.text, true);
  assert.equal(x.after, 'PLAYING');
  assert.deepEqual(x.seen, ['quests']);
  assert.deepEqual(JSON.parse(store['neonCekirdek.meta.v1']).guides, ['quests']);
  const again = setup(store, { guides: true });
  assert.equal(again.run(`startNewGame();guideQueue=[];generateNextQuest('ORBS');totalTime=2;updateGame(.016);gameState+':'+guideQueue.length`), 'PLAYING:0');
});

test('Odak 4.2 guides wait their turn, skip vanished targets and read live rules', () => {
  const { run } = setup({}, { guides: true });
  const x = JSON.parse(run(`(()=>{startNewGame();guidesSeen.add('quests');guideQueue=[];
    // A target that is already gone is dropped but stays unseen.
    requestGuide('conduits',()=>null);totalTime=5;const skipped=processGuideQueue();
    const unseen=!guidesSeen.has('conduits');
    // Two at once: the second waits for the gap after the first closes.
    const zone={x:200,y:150,dead:false};
    requestGuide('conduits',()=>zone.dead?null:{x:zone.x,y:zone.y,r:80});
    requestGuide('circuit',()=>({x:player.x,y:player.y,r:76}));
    const dup=requestGuide('conduits');
    processGuideQueue();const first=activeGuide.id;
    const spot=document.getElementById('guideSpotlight').style.left;
    closeGuide();totalTime+=1;const tooSoon=processGuideQueue();
    totalTime+=GUIDE_RULES.gap;processGuideQueue();const second=activeGuide&&activeGuide.id;closeGuide();
    resetGuidesSeen();
    return JSON.stringify({skipped,unseen,dup,first,spot,tooSoon,second,reset:guidesSeen.size,
      circuit:guideText(GUIDE_DEFS.circuit.how),defend:guideText(GUIDE_DEFS.DEFEND.how),
      vault:guideText(GUIDE_DEFS.arena_VAULT.how),scale:viewScale});})()`));
  assert.equal(x.skipped, false);
  assert.equal(x.unseen, true);
  assert.equal(x.dup, false);
  assert.equal(x.first, 'conduits');
  // Spotlight sits on the object in screen pixels: (world x - r) * viewScale.
  assert.ok(Math.abs(parseFloat(x.spot) - (200 - 80) * x.scale) < 1e-6);
  assert.equal(x.tooSoon, false);
  assert.equal(x.second, 'circuit');
  assert.equal(x.reset, 0);
  assert.match(x.circuit, /14 sn içinde/);
  assert.match(x.defend, /8'e dolunca/);
  assert.match(x.vault, /4,1 sn kal/);
});

test('Odak 4.2 conduits, field devices, quests and the circuit pick queue their guide', () => {
  const { run } = setup({}, { guides: true });
  const x = JSON.parse(run(`(()=>{startNewGame();guideQueue=[];
    conduitSpawnTimer=0;systemIntroSeen.add('conduits');updateGame(.016);
    wave=8;fieldDeviceLastWave=0;activeBosses=[];nextBossTime=totalTime+60;
    systemIntroSeen.add('fieldDevices');combatDirector.activeArenaEvent=null;const placed=maybeSpawnFieldDevice();
    generateNextQuest('DEFEND');
    const q=guideQueue.map(g=>g.id);
    const defend=guideQueue.find(g=>g.id==='DEFEND');
    const defendBox=defend&&guideTargetBox(defend.target).box;
    return JSON.stringify({placed,q,defend:!!defendBox&&defendBox.round,ids:Object.keys(GUIDE_DEFS).length});})()`));
  assert.equal(x.placed, true);
  assert.ok(x.q.includes('conduits'));
  assert.ok(x.q.includes('fieldDevices'));
  assert.ok(x.q.includes('DEFEND'), x.q.join(','));
  assert.equal(x.defend, true);
  assert.equal(x.ids, 16);
  const circuit = run(`(()=>{startNewGame();guideQueue=[];gameState='LEVEL_UP';
    const upg=UPGRADES_POOL.find(u=>u.id==='circuit_weaver');
    currentUpgradeChoices=[{upg,rarity:RARITIES[0]}];selectUpgradeOption(0);
    return guideQueue.map(g=>g.id).join(',');})()`);
  assert.equal(circuit, 'circuit');
});

test('Odak 4.3 every card is stronger at a higher rarity, and the card says by how much', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{
    // Pick one card at a rarity through the real level-up flow, then read the player.
    const pickAt = (id, r) => { startNewGame(); const upg = UPGRADES_POOL.find(u => u.id === id);
      gameState = 'LEVEL_UP'; currentUpgradeChoices = [{ upg, rarity: RARITIES[r] }]; selectUpgradeOption(0); return upg; };
    const read = {
      coolant: () => 1 - getCooldownMult(player),
      collector: () => getCollectorXpMult(player) - 1,
      circuit_weaver: () => cardTierCap(player, 'circuit_weaver'),
      phase_echo: () => cardTierCap(player, 'phase_echo'),
    };
    const flat = {};
    for (const [id, f] of Object.entries(read)) flat[id] = [0, 1, 2, 3].map(r => { pickAt(id, r); return +f().toFixed(4); });
    const descs = {};
    for (const id of Object.keys(read)) { const upg = UPGRADES_POOL.find(u => u.id === id); descs[id] = [0, 3].map(r => upg.getDesc(RARITIES[r])); }
    // Every card: no two rarities print the same description, so no card hides its rarity.
    const sameText = UPGRADES_POOL.filter(u => u.getDesc(RARITIES[0]) === u.getDesc(RARITIES[3])).map(u => u.id);
    // Mixed picks: each tier keeps its own rarity, caps use the rarest.
    startNewGame(); const c = UPGRADES_POOL.find(u => u.id === 'circuit_weaver');
    for (const r of [0, 3, 1]) { gameState = 'LEVEL_UP'; currentUpgradeChoices = [{ upg: c, rarity: RARITIES[r] }]; selectUpgradeOption(0); }
    const mixed = cardTierValues(player, 'circuit_weaver'), cap = cardTierCap(player, 'circuit_weaver');
    // Phase echo really lures more enemies when rarer.
    const lured = [0, 3].map(r => { pickAt('phase_echo', r); player.x = 300; player.y = 300; phaseEchoes = []; player.phaseEchoReadyAt = 0;
      enemies = Array.from({ length: 14 }, (_, i) => new Enemy(310 + i * 4, 300, 'SWARM'));
      deployPhaseEcho(player, { x: 300, y: 300 }); return phaseEchoes[0].targets.length; });
    return JSON.stringify({ flat, descs, sameText, mixed, cap, lured });
  })()`));
  assert.deepEqual(x.flat, {
    coolant: [0.08, 0.1, 0.13, 0.16],
    collector: [0.12, 0.15, 0.19, 0.24],
    circuit_weaver: [12, 16, 20, 24],
    phase_echo: [5, 6, 8, 10],
  });
  assert.deepEqual(x.descs.coolant.map(d => d.match(/%(\d+)/)[1]), ['8', '16']);
  assert.deepEqual(x.descs.collector.map(d => d.match(/%(\d+)/)[1]), ['12', '24']);
  assert.match(x.descs.circuit_weaver[1], /en fazla 24 düşmanı/);
  assert.match(x.descs.phase_echo[1], /en fazla 10 sıradan/);
  assert.deepEqual(x.sameText, []);
  assert.deepEqual(x.mixed, [12, 24, 16]);
  assert.equal(x.cap, 24);
  assert.deepEqual(x.lured, [5, 10]);
});

test('Odak 4.4 revives: at most 3 free, health shrinks each time, no free Cinnet', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(()=>{
    metaUpgrades.defibrillator = 1; selectedChassis = 'VANGUARD'; startNewGame();
    const free = player.freeRevives;
    player.addOverdrive(-1000); const od = player.overdrive;
    const hp = [];
    for (let i = 0; i < 3; i++) { gameState = 'REVIVE_PROMPT'; player.hp = 0; executePlayerRevive(); hp.push(+(player.hp / player.maxHp).toFixed(2)); }
    // Free charges are gone; a 4th revive costs gold and still brings back 30 %.
    wave = 12; totalGold = 1000; player.hp = 0; showRevivePromptOrGameOver();
    const prompt = { state: gameState, price: paidReviveCost(), label: document.getElementById('confirmReviveBtn').innerHTML };
    executePlayerRevive(); hp.push(+(player.hp / player.maxHp).toFixed(2));
    player.hp = 0; showRevivePromptOrGameOver();
    return JSON.stringify({ free, hp, prompt, gold: totalGold, after: gameState, cinnetGain: player.overdrive - od,
      lab: META_SHOP_ITEMS.find(i => i.key === 'defibrillator').maxLevel });
  })()`));
  assert.equal(x.free, 3);
  assert.deepEqual(x.hp, [0.6, 0.45, 0.3, 0.3]);
  assert.equal(x.prompt.state, 'REVIVE_PROMPT');
  assert.equal(x.prompt.price, 180);
  assert.match(x.prompt.label, /180 ALTIN/);
  assert.equal(x.gold, 820);
  assert.equal(x.after, 'GAME_OVER');
  assert.equal(x.cinnetGain, 0);
  assert.equal(x.lab, 1);
});

test('Odak 4.4 old saves and backups with 2-3 lab revive tiers get their gold back once', () => {
  const key = 'neonCekirdek.meta.v1';
  const store = { [key]: JSON.stringify({ version: 1, gold: 100, highScore: 0, maxWave: 3,
    upgrades: { baseDamage: 0, maxHp: 0, speedDash: 0, greed: 0, defibrillator: 3 } }) };
  const first = setup(store);
  // Tier 2 cost 132, tier 3 cost 290.
  assert.equal(first.run('totalGold'), 100 + 132 + 290);
  assert.equal(first.run('metaUpgrades.defibrillator'), 1);
  assert.equal(JSON.parse(store[key]).upgrades.defibrillator, 1);
  assert.equal(JSON.parse(store[key]).gold, 522);
  // Saved once: a reload does not pay again.
  assert.equal(setup(store).run('totalGold'), 522);
  const r = JSON.parse(first.run(`(()=>{ gameState = 'MENU';
    const backup = createProgressBackup(); backup.progress.upgrades.defibrillator = 2; backup.progress.gold = 10;
    const ok = restoreProgressBackup(JSON.stringify(backup));
    return JSON.stringify({ ok, gold: totalGold, defib: metaUpgrades.defibrillator }); })()`));
  assert.deepEqual(r, { ok: true, gold: 142, defib: 1 });
});

test('Odak 4.6 ion chorus marks the harmony moment and draws less on low graphics', () => {
  let calls = 0;
  const ctx = new Proxy({}, { get: () => () => { calls++; } });
  const { run } = setup({}, { canvasContext: ctx });
  const x = JSON.parse(run(`(()=>{startNewGame();wave=10;waveTimer=2;nextBossTime=1000;totalTime=300;
    enemies=[new Enemy(600,330,'SHOOTER')];updateArenaChapter(.02);
    recordShowcaseIonFlower(0);const half=chapterShowcase.completed;
    totalTime=301;recordShowcaseIonFlower(2);totalTime=301.3;
    return JSON.stringify({half,done:chapterShowcase.completed,at:chapterShowcase.completedAt});})()`));
  const draw = (quality) => { const before = calls; run(`graphicsQuality='${quality}';drawIonChorus(ctx,chapterShowcase,${quality === 'low'})`); return calls - before; };
  const high = draw('high'), low = draw('low');
  assert.equal(x.half, false);
  assert.equal(x.done, true);
  assert.equal(x.at, 301);
  assert.ok(low > 0 && low < high, `low ${low} high ${high}`);
});

test('Odak 4.7 phase pincer records who landed or who was escaped, and low graphics draws less', () => {
  let calls = 0;
  const ctx = new Proxy({}, { get: () => () => { calls++; } });
  const { run } = setup({}, { canvasContext: ctx });
  const pincer = (escape) => JSON.parse(run(`(()=>{startNewGame();nextBossTime=1000;wave=13;waveTimer=2;totalTime=500;
    player.x=640;player.y=420;enemies=[new Enemy(900,250,'SHOOTER'),new Enemy(420,620,'SHOOTER')];
    for(const e of enemies)e.speed=0;updateArenaChapter(.02);const op=chapterShowcase;
    if(${escape})player.x+=RIFT_PINCER.escapeRadius+20;
    totalTime+=RIFT_PINCER.resolveAt+.01;updateArenaChapter(.02);
    return JSON.stringify({evaded:!!op.evaded,resolved:Number.isFinite(op.resolvedAt),flanked:op.targets.map(t=>!!t.flanked)});})()`));
  assert.deepEqual(pincer(false), { evaded: false, resolved: true, flanked: [true, true] });
  assert.deepEqual(pincer(true), { evaded: true, resolved: true, flanked: [false, false] });
  run(`startNewGame();nextBossTime=1000;wave=13;waveTimer=2;totalTime=600;player.x=640;player.y=420;
    enemies=[new Enemy(900,250,'SHOOTER'),new Enemy(420,620,'SHOOTER')];updateArenaChapter(.02);totalTime+=1`);
  const draw = (low) => { const before = calls; run(`drawRiftPincer(ctx,chapterShowcase,1,${low})`); return calls - before; };
  const high = draw(false), low = draw(true);
  assert.ok(low > 0 && low < high, `low ${low} high ${high}`);
});

// Odak 4.10 · both floors move with the clock, simplify on low graphics, and the two
// showcases leave particles behind: gold petals on harmony, shards on a flank, a ring on an escape.
test('Odak 4.10 garden and rift floors animate, draw less on low, and showcases burst', () => {
  const trace = [];
  const ctx = new Proxy({}, { get: (_, key) => (...args) => { trace.push([String(key), args]); } });
  const { run } = setup({}, { canvasContext: ctx });
  const frame = (wave, quality, time) => {
    run(`startNewGame();nextBossTime=1e6;wave=${wave};chapterShowcaseAttemptedWave=${wave};totalTime=${time};
      gameState='PLAYING';updateArenaChapter(.02);graphicsQuality='${quality}'`);
    trace.length = 0;
    run('drawArenaChapter(ctx)');
    return JSON.stringify(trace.filter(([k]) => k === 'arc' || k === 'lineTo' || k === 'ellipse'));
  };
  for (const wave of [9, 12]) {
    const a = frame(wave, 'high', 50), b = frame(wave, 'high', 50.4), low = frame(wave, 'low', 50);
    assert.notEqual(a, b, `wave ${wave} floor moves over time`);
    assert.ok(JSON.parse(low).length > 0 && JSON.parse(low).length < JSON.parse(a).length,
      `wave ${wave} low draws less`);
  }
  const burst = JSON.parse(run(`(()=>{startNewGame();wave=10;waveTimer=2;nextBossTime=1e6;totalTime=300;graphicsQuality='high';
    enemies=[];updateArenaChapter(.02);particles=[];recordShowcaseIonFlower(0);recordShowcaseIonFlower(1);
    const petals=particles.filter(p=>p.color==='#fff5b2').length;
    startNewGame();nextBossTime=1e6;wave=13;waveTimer=2;totalTime=500;player.x=640;player.y=420;
    enemies=[new Enemy(900,250,'SHOOTER'),new Enemy(420,620,'SHOOTER')];for(const e of enemies)e.speed=0;
    updateArenaChapter(.02);particles=[];totalTime+=RIFT_PINCER.resolveAt+.01;updateArenaChapter(.02);
    const shards=particles.filter(p=>p.color==='#e3a6ff').length;
    startNewGame();nextBossTime=1e6;wave=13;waveTimer=2;totalTime=700;player.x=640;player.y=420;
    enemies=[new Enemy(900,250,'SHOOTER'),new Enemy(420,620,'SHOOTER')];for(const e of enemies)e.speed=0;
    updateArenaChapter(.02);shockwaves=[];player.x+=RIFT_PINCER.escapeRadius+20;totalTime+=RIFT_PINCER.resolveAt+.01;updateArenaChapter(.02);
    return JSON.stringify({petals,shards,escapeRing:shockwaves.some(w=>w.color==='#7dffb0')});})()`));
  assert.ok(burst.petals >= 7, `petals ${burst.petals}`);
  assert.ok(burst.shards >= 8, `shards ${burst.shards}`);
  assert.equal(burst.escapeRing, true);
});

// Odak 5.1 · Düşman sözlüğü: met foes (and elites) are recorded once, kills are counted,
// both survive a reload and a backup; corrupt entries are dropped; menu spawns do not count.
test('Odak 5.1 enemy codex records encounters and kills and keeps them', () => {
  const key = 'neonCekirdek.meta.v1';
  const store = {};
  const first = setup(store);
  const x = JSON.parse(first.run(`(()=>{
    gameState='MENU';new Enemy(10,10,'TANK');const menu=codexSeen.size;
    startNewGame();gameState='PLAYING';
    const a=new Enemy(100,100,'SWARM');new Enemy(120,100,'SWARM');const e=new Enemy(140,100,'DASHER',true);
    const texts=floatingTexts.filter(t=>String(t.text).startsWith('SÖZLÜĞE EKLENDİ')).length;
    a.die();e.die();
    renderEnemyCodex();
    const html=document.getElementById('tabCodexContent').innerHTML;
    saveMetaProgress();
    return JSON.stringify({menu,seen:[...codexSeen].sort(),kills:codexKills,texts,
      known:(html.match(/data-seen="true"/g)||[]).length,unknown:(html.match(/data-seen="false"/g)||[]).length,
      swarmName:html.includes('SÜRÜ'),tankName:html.includes('>TANK<'),
      backup:JSON.stringify(createProgressBackup())});})()`));
  assert.equal(x.menu, 0, 'menu demo enemies do not count');
  assert.deepEqual(x.seen, ['DASHER', 'ELITE', 'SWARM']);
  assert.deepEqual(x.kills, { SWARM: 1, DASHER: 1, ELITE: 1 });
  assert.equal(x.texts, 3, 'one note per new entry');
  assert.equal(x.known, 3);
  assert.equal(x.unknown, 12, 'the rest wait as silhouettes');
  assert.equal(x.swarmName, true);
  assert.equal(x.tankName, false, 'unmet foes keep their name hidden');
  // Reload.
  const again = JSON.parse(setup(store).run('JSON.stringify({seen:[...codexSeen].sort(),kills:codexKills})'));
  assert.deepEqual(again, { seen: ['DASHER', 'ELITE', 'SWARM'], kills: { SWARM: 1, DASHER: 1, ELITE: 1 } });
  // Corrupt codex data is filtered, the rest of the save still loads.
  const bad = { [key]: JSON.stringify({ version: 2, gold: 77, highScore: 0, maxWave: 3,
    codex: { seen: ['SWARM', 'NOPE', 5], kills: { SWARM: -3, TANK: 2.5, SNIPER: 4, NOPE: 9 } },
    upgrades: { baseDamage: 0, maxHp: 0, speedDash: 0, greed: 0, defibrillator: 0 } }) };
  const c = JSON.parse(setup(bad).run('JSON.stringify({seen:[...codexSeen],kills:codexKills,gold:totalGold})'));
  assert.deepEqual(c, { seen: ['SWARM'], kills: { SNIPER: 4 }, gold: 77 });
  // Backup round trip into a fresh profile.
  const fresh = setup({});
  const r = JSON.parse(fresh.run(`(()=>{gameState='MENU';const ok=restoreProgressBackup(${JSON.stringify(x.backup)});
    return JSON.stringify({ok,seen:[...codexSeen].sort(),kills:codexKills});})()`));
  assert.deepEqual(r, { ok: true, seen: ['DASHER', 'ELITE', 'SWARM'], kills: { SWARM: 1, DASHER: 1, ELITE: 1 } });
});

// Odak 5.2 · costumes are bought once, worn or taken off, saved, and change nothing but looks.
test('Odak 5.2 costumes are bought, worn and saved, and never change the run', () => {
  const key = 'neonCekirdek.meta.v1';
  const store = {};
  const first = setup(store);
  const x = JSON.parse(first.run(`(()=>{
    gameState='MENU';totalGold=300;
    const poor=buyCosmetic('core_gold');totalGold=2000;
    const bought=buyCosmetic('core_gold'), again=buyCosmetic('core_gold');
    const afterBuy={gold:totalGold,worn:equippedCosmetics.core};
    buyCosmetic('shape_star');
    toggleCosmetic('core_gold');const off=equippedCosmetics.core;toggleCosmetic('core_gold');
    renderShopItems();
    const html=document.getElementById('shopCosmeticContainer').innerHTML;
    return JSON.stringify({poor,bought,again,afterBuy,off,gold:totalGold,equipped:equippedCosmetics,
      worn:(html.match(/data-state="worn"/g)||[]).length,items:(html.match(/data-cosmetic=/g)||[]).length,
      count:document.getElementById('shopCosmeticCount').textContent,backup:JSON.stringify(createProgressBackup())});})()`));
  assert.equal(x.poor, false, 'not enough gold');
  assert.equal(x.bought, true);
  assert.equal(x.again, false, 'bought once');
  assert.deepEqual(x.afterBuy, { gold: 1600, worn: 'core_gold' }, 'a new costume is worn at once');
  assert.equal(x.off, null, 'wearing it again takes it off');
  assert.equal(x.gold, 1600 - 950);
  assert.deepEqual(x.equipped, { core: 'core_gold', trail: null, shape: 'shape_star', arena: null });
  assert.equal(x.items, 16);
  assert.equal(x.worn, 2);
  assert.equal(x.count, '2/16');
  const again = JSON.parse(setup(store).run('JSON.stringify({owned:[...ownedCosmetics].sort(),equipped:equippedCosmetics})'));
  assert.deepEqual(again, { owned: ['core_gold', 'shape_star'], equipped: { core: 'core_gold', trail: null, shape: 'shape_star', arena: null } });
  // Worn-but-not-owned, wrong slot and unknown ids are dropped.
  const bad = { [key]: JSON.stringify({ version: 2, gold: 5, highScore: 0, maxWave: 2,
    cosmetics: { owned: ['trail_comet', 'nope', 'arena_amber'], equipped: { core: 'trail_comet', trail: 'trail_comet', shape: 'shape_ring', arena: 'nope' } },
    upgrades: { baseDamage: 0, maxHp: 0, speedDash: 0, greed: 0, defibrillator: 0 } }) };
  const c = JSON.parse(setup(bad).run('JSON.stringify({owned:[...ownedCosmetics].sort(),equipped:equippedCosmetics,gold:totalGold})'));
  assert.deepEqual(c, { owned: ['arena_amber', 'trail_comet'], equipped: { core: null, trail: 'trail_comet', shape: null, arena: null }, gold: 5 });
  const r = JSON.parse(setup({}).run(`(()=>{gameState='MENU';const ok=restoreProgressBackup(${JSON.stringify(x.backup)});
    return JSON.stringify({ok,owned:[...ownedCosmetics].sort(),core:equippedCosmetics.core});})()`));
  assert.deepEqual(r, { ok: true, owned: ['core_gold', 'shape_star'], core: 'core_gold' });
  // Every costume on: the same player numbers, a different picture.
  const trace = [];
  const ctx = new Proxy({}, { get: (_, k) => (...a) => { trace.push(String(k)); },
    set: (_, k, v) => { if (k === 'fillStyle') trace.push('fill:' + v); return true; } });
  const look = setup({}, { canvasContext: ctx });
  const stats = (wear) => JSON.parse(look.run(`(()=>{gameState='MENU';
    for(const slot of Object.keys(equippedCosmetics))equippedCosmetics[slot]=null;
    if(${wear}){for(const c of COSMETICS)ownedCosmetics.add(c.id);
      Object.assign(equippedCosmetics,{core:'core_lava',trail:'trail_comet',shape:'shape_hex',arena:'arena_emerald'});}
    setRunSeed(3);startNewGame();
    return JSON.stringify({r:player.radius,speed:player.speed,dmg:player.damage,hp:player.maxHp,rate:player.fireRate,crit:player.critChance});})()`));
  const plain = stats(false), dressed = stats(true);
  assert.deepEqual(dressed, plain);
  const picture = () => { trace.length = 0; look.run(`player.trail=[{x:10,y:10,r:12},{x:20,y:10,r:12},{x:30,y:10,r:12}];player.draw(ctx);drawBackgroundGrid()`); return trace.join('|'); };
  const worn = picture();
  look.run(`for(const slot of Object.keys(equippedCosmetics))equippedCosmetics[slot]=null`);
  const standard = picture();
  assert.ok(worn.includes('fill:#03100c') && !standard.includes('fill:#03100c'), 'arena palette paints the floor');
  assert.ok(worn.includes('fill:#ff6a3d'), 'core colour');
  assert.ok((worn.match(/lineTo/g) || []).length > (standard.match(/lineTo/g) || []).length, 'hexagon and comet trail draw lines');
});

test('Odak 5.3 the data capsule gives an unowned costume, never repeats and stops when all are owned', () => {
  const store = {};
  const x = JSON.parse(setup(store).run(`(()=>{
    gameState='MENU';totalGold=299;
    const poor=openDataCapsule(()=>0);
    totalGold=300*20;buyCosmetic('core_gold');
    const goldBefore=totalGold;
    const first=openDataCapsule(()=>0);
    const firstState={gold:goldBefore-totalGold,worn:equippedCosmetics[first.slot],last:lastCapsuleId};
    renderShopItems();
    const html=document.getElementById('shopCosmeticContainer').innerHTML;
    const got=[first.id];
    for(let i=0;i<20;i++){const it=openDataCapsule(()=>0.999999);if(!it)break;got.push(it.id);}
    const afterAll={gold:totalGold,owned:ownedCosmetics.size,more:openDataCapsule(()=>0.5)};
    renderShopItems();
    const done=document.getElementById('shopCosmeticContainer').innerHTML;
    return JSON.stringify({poor,first:first.id,firstState,got,afterAll,
      fresh:(html.match(/data-fresh="true"/g)||[]).length,freshOn:/data-cosmetic="core_lava"[^>]*data-fresh/.test(html),
      ready:/capsule-panel" data-state="ready"/.test(html),result:html.includes('ÇIKTI: <b>Lav Çekirdek</b>'),
      doneState:/capsule-panel" data-state="done"/.test(done),disabled:/id="openCapsuleBtn"[^>]*disabled/.test(done)});})()`));
  assert.equal(x.poor, null, 'not enough gold');
  assert.equal(x.first, 'core_lava', 'owned costumes are skipped');
  assert.deepEqual(x.firstState, { gold: 300, worn: 'core_gold', last: 'core_lava' }, 'costs 300 and does not change what is worn');
  assert.equal(x.got.length, 15, 'the 15 unowned costumes come out once each');
  assert.equal(new Set(x.got).size, 15, 'never a duplicate');
  assert.ok(!x.got.includes('core_gold'));
  assert.deepEqual(x.afterAll, { gold: 300 * 20 - 400 - 300 * 15, owned: 16, more: null });
  assert.equal(x.fresh, 1);
  assert.equal(x.freshOn, true, 'the new costume is marked in the grid');
  assert.equal(x.ready, true);
  assert.equal(x.result, true, 'the result names the costume');
  assert.equal(x.doneState, true);
  assert.equal(x.disabled, true, 'nothing left to give');
  const again = JSON.parse(setup(store).run('JSON.stringify({owned:ownedCosmetics.size,gold:totalGold})'));
  assert.deepEqual(again, { owned: 16, gold: 300 * 20 - 400 - 300 * 15 }, 'capsule results are saved');
});

test('Odak 5.5 the report ends on the next goal and names a new record', () => {
  const { run } = setup({}, { unlockAll: false });
  const x = JSON.parse(run(`(()=>{
    const end=(w,s,runGold,balance)=>{startNewGame();wave=w;score=s;totalTime=60;sessionGold=runGold;totalGold=balance;triggerGameOver();
      const box=document.getElementById('reportNextGoal');
      return {kind:box.dataset.kind,ready:box.dataset.ready,html:box.innerHTML,
        record:document.getElementById('newRecordText').textContent};};
    const first=end(2,500,40,90);
    const close=end(5,900,200,500);
    const far=end(5,300,100,400);
    const ready=end(5,300,100,800);
    return JSON.stringify({first,close,far,ready});})()`));
  assert.equal(x.first.kind, 'wave', 'nothing is buyable before wave 3');
  assert.match(x.first.html, /Soğutucu/);
  assert.match(x.first.html, /DALGA 2 \/ 3/);
  assert.match(x.first.html, /1 DALGA DAHA/);
  assert.equal(x.first.record, 'İLK REKORUN KAYDEDİLDİ');
  assert.equal(x.close.kind, 'content');
  assert.match(x.close.html, /BU KOŞU \+200/);
  assert.match(x.close.html, /BİR KOŞU DAHA YETER/);
  assert.match(x.close.html, /is-before" style="width:43%/, 'gold before this run');
  assert.match(x.close.html, /is-gain" style="width:28%/, 'gold from this run');
  assert.equal(x.close.record, 'YENİ KİŞİSEL REKOR · +400 (ESKİSİ 500)');
  assert.match(x.far.html, /KALAN 300 ALTIN · YAKLAŞIK 3 KOŞU/);
  assert.equal(x.far.record, '', 'a lower score is no record');
  assert.equal(x.ready.ready, 'true');
  assert.match(x.ready.html, /HAZIR/);
  assert.match(x.ready.html, /id="reportGoalOpenBtn"/);
});

test('Odak 5.6 contract mastery travels with the backup; old backups leave it and bad ones are refused', () => {
  const key = 'neonCekirdek.contractMastery.v1';
  const { run, stored } = setup({});
  const x = JSON.parse(run(`(()=>{
    selectNeonContract('REDLINE');startNewGame();wave=12;score=900;totalTime=200;triggerGameOver();
    gameState='MENU';
    const backup=createProgressBackup();
    const raw=JSON.stringify(backup);
    const mastered=window.getNeonContractMastery().REDLINE;
    // A fresh device: mastery wiped, then the backup comes back.
    contractMastery=createEmptyContractMastery();localStorage.setItem(CONTRACT_MASTERY_SAVE_KEY,JSON.stringify(contractMastery));
    const restored=restoreProgressBackup(raw);
    const afterRestore=window.getNeonContractMastery().REDLINE;
    // An old backup without contracts keeps what is there.
    const old=JSON.parse(raw);delete old.contracts;
    const oldOk=restoreProgressBackup(JSON.stringify(old));
    const afterOld=window.getNeonContractMastery().REDLINE;
    // A broken contracts block refuses the whole backup.
    const bad=JSON.parse(raw);bad.contracts={version:99};
    const badOk=restoreProgressBackup(JSON.stringify(bad));
    // Clamped values are sanitized.
    const big=JSON.parse(raw);big.contracts.contracts.REDLINE.bestWave=1e9;
    const bigOk=restoreProgressBackup(JSON.stringify(big));
    const afterBig=window.getNeonContractMastery().REDLINE.bestWave;
    // A failed contracts write rolls everything back.
    const before=localStorage.getItem(CONTRACT_MASTERY_SAVE_KEY);
    const original=localStorage.setItem;
    localStorage.setItem=(k,v)=>{if(k===CONTRACT_MASTERY_SAVE_KEY&&v!==before)throw Error('quota');return original(k,v);};
    const changed=JSON.parse(raw);changed.contracts.contracts.REDLINE.runs=7;
    const failOk=restoreProgressBackup(JSON.stringify(changed));
    localStorage.setItem=original;
    return JSON.stringify({hasContracts:!!backup.contracts,mastered,restored,afterRestore,oldOk,afterOld,badOk,bigOk,afterBig,failOk,
      kept:localStorage.getItem(CONTRACT_MASTERY_SAVE_KEY)===before,size:raw.length});})()`));
  assert.equal(x.hasContracts, true);
  assert.equal(x.mastered.runs, 1);
  assert.equal(x.mastered.bestWave, 12);
  assert.equal(x.restored, true);
  assert.deepEqual(x.afterRestore, x.mastered, 'mastery comes back on a new device');
  assert.equal(x.oldOk, true);
  assert.deepEqual(x.afterOld, x.mastered, 'an old backup leaves mastery alone');
  assert.equal(x.badOk, false);
  assert.equal(x.bigOk, true);
  assert.equal(x.afterBig, 100000, 'values are clamped like a normal load');
  assert.equal(x.failOk, false);
  assert.equal(x.kept, true, 'a failed write keeps the old mastery');
  assert.ok(x.size < 16384, 'still well under the backup size limit');
  assert.equal(JSON.parse(stored[key]).contracts.REDLINE.bestWave, 100000);
});

test('Odak 5.8 enemy XP grows with the wave and stops at 3.5x', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const xpAt = (w, elite = false) => { wave = w; return new Enemy(300, 300, 'TANK', elite).xpValue; };
    const out = { mult: [1, 11, 20, 40].map(w => +lateXpMult(w).toFixed(2)),
      w1: xpAt(1), w11: xpAt(11), w40: xpAt(40), elite11: xpAt(11, true) };
    // A boss drops scaled orbs too.
    wave = 11; orbs = []; const boss = new Enemy(400, 400, 'BOSS_TITAN'); boss.takeDamage(1e9);
    out.bossOrbs = orbs.filter(o => !o.isGold).map(o => o.value);
    return JSON.stringify(out);
  })()`));
  assert.deepEqual(x.mult, [1, 1.8, 2.52, 3.5]);
  assert.equal(x.w11, Math.round(x.w1 * 1.8));
  assert.equal(x.w40, Math.round(x.w1 * 3.5));
  assert.equal(x.elite11, Math.round(x.w1 * 2.5 * 1.8));
  assert.ok(x.bossOrbs.length > 0 && x.bossOrbs.every(v => v % 63 === 0), JSON.stringify(x.bossOrbs));
});

test('Odak 5.8 gold resonance turns run gold into damage without spending lab gold', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const res = [0, 99, 100, 650, 5000].map(g => +goldResonance(g).toFixed(2));
    const hit = gold => { sessionGold = gold; const e = new Enemy(300, 300, 'TANK'); e.hp = e.maxHp = 1e6;
      e.takeDamage(100); return Math.round(1e6 - e.hp); };
    totalGold = 1234;
    const plain = hit(0), rich = hit(1000);
    sessionGold = 600; updateHUD();
    const badge = document.getElementById('goldResonanceText');
    const shown = { text: badge.textContent, hidden: badge.hidden, title: document.getElementById('goldHudChip').title };
    sessionGold = 0; updateHUD();
    return JSON.stringify({ res, plain, rich, lab: totalGold, shown, after: { text: badge.textContent, hidden: badge.hidden } });
  })()`));
  assert.deepEqual(x.res, [0, 0, 0.03, 0.18, 0.6]);
  assert.equal(x.rich, Math.round(x.plain * 1.3));
  assert.equal(x.lab, 1234);
  assert.equal(x.shown.text, '+%18');
  assert.equal(x.shown.hidden, false);
  assert.ok(x.shown.title.includes('ALTIN REZONANSI'));
  assert.deepEqual(x.after, { text: '', hidden: true });
});

test('Odak 5.8 overload cards fill a thin hand and stack without tiers', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const box = document.getElementById('upgradeCardsContainer'), cards = [];
    box.appendChild = c => cards.push(c);
    // Only two modules left below tier 3: the third card is an overload.
    const offer = new Set(['homing', 'firerate']);
    const saved = isUpgradeOfferable;
    isUpgradeOfferable = u => offer.has(u.id);
    try { populateUpgradeCards(); } finally { isUpgradeOfferable = saved; }
    const kinds = currentUpgradeChoices.map(c => c.upg.kind).sort();
    const idx = currentUpgradeChoices.findIndex(c => c.upg.kind === 'overload');
    const card = cards[idx];
    // Pick the damage overload twice at common rarity.
    const core = OVERLOAD_CARDS.find(c => c.id === 'overload_core');
    const pick = () => { gameState = 'LEVEL_UP'; currentUpgradeChoices = [{ upg: core, rarity: RARITIES[0] }]; selectUpgradeOption(0); };
    player.damage = 240; pick(); pick();
    const e = new Enemy(300, 300, 'TANK'); e.hp = e.maxHp = 1e6; e.takeDamage(100);
    // Focus leaves the pool at the crit cap.
    player.critChance = 0.60;
    const pool = overloadChoicesFor(player).map(c => c.id).sort();
    return JSON.stringify({ kinds, role: card._attrs['data-role'], label: card._attrs['aria-label'], markup: card.innerHTML,
      stacks: player.overloadStacks, bonus: +player.overloadDamage.toFixed(2), counts: Object.keys(player.upgradeCounts).filter(k => k.startsWith('overload')),
      state: gameState, dealt: Math.round(1e6 - e.hp), damage: player.damage, pool,
      legendary: core.getDesc(RARITIES[3]) });
  })()`));
  assert.equal(x.kinds.length, 3);
  assert.equal(x.kinds.filter(k => k === 'overload').length, 1);
  assert.equal(x.role, 'overload');
  assert.ok(x.label.includes('Yığın 1'), x.label);
  assert.ok(x.markup.includes('AŞIRI YÜK') && x.markup.includes('YIĞIN 0 → 1'), x.markup);
  assert.ok(!x.markup.includes('KADEME'));
  assert.equal(x.stacks, 2);
  assert.equal(x.bonus, 0.1);
  assert.deepEqual(x.counts, []);
  assert.equal(x.state, 'PLAYING');
  assert.equal(x.damage, 240);
  assert.equal(x.dealt, 110);
  assert.deepEqual(x.pool, ['overload_core', 'overload_hull']);
  assert.ok(x.legendary.includes('+%8'), x.legendary);
});

test('Odak 5.9 elite traits open with the waves and only elites carry one', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const pools = {};
    for (const w of [1, 4, 6, 8, 10, 30]) {
      wave = w; const seen = new Set();
      for (let i = 0; i < 300; i++) seen.add(new Enemy(300, 300, 'TANK', true).affix.id);
      pools[w] = [...seen].sort();
    }
    wave = 10;
    const plain = new Enemy(300, 300, 'TANK', false).affix;
    const boss = new Enemy(300, 300, 'BOSS_TITAN', true).affix;
    return JSON.stringify({ pools, plain, boss });
  })()`));
  assert.deepEqual(x.pools[1], ['SHIELDED']);
  assert.deepEqual(x.pools[4], ['SHIELDED', 'SPLITTING']);
  assert.deepEqual(x.pools[6], ['HASTE', 'SHIELDED', 'SPLITTING']);
  assert.deepEqual(x.pools[8], ['HASTE', 'SHIELDED', 'SPLITTING', 'THIEF']);
  assert.deepEqual(x.pools[10], ['HASTE', 'REFLECT', 'SHIELDED', 'SPLITTING', 'THIEF']);
  assert.deepEqual(x.pools[30], x.pools[10]);
  assert.equal(x.plain, null);
  assert.equal(x.boss, null);
});

test('Odak 5.9 each elite trait changes the fight', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave = 10; player.x = 900; player.y = 900;
    const make = (id, type = 'TANK') => { const e = new Enemy(300, 300, type, true);
      applyEliteAffix(e, ELITE_AFFIXES.find(a => a.id === id)); e.speed = 0; enemies.push(e); return e; };
    const out = {};
    // KALKANLI: the shield takes the first hits, then regrows after a quiet spell.
    enemies = []; const s = make('SHIELDED'); const hp0 = s.hp, pool = s.affixShieldMax;
    s.takeDamage(pool * 0.5); out.shieldHit = { hpLost: Math.round(hp0 - s.hp), shieldLeft: Math.round(s.affixShield / pool * 100) };
    s.takeDamage(pool); out.shieldBroken = { hpLost: Math.round(hp0 - s.hp), pool: Math.round(pool), shield: s.affixShield };
    for (let i = 0; i < 60 * 2; i++) s.update(1 / 60); out.regrowEarly = s.affixShield;
    for (let i = 0; i < 60 * 3; i++) s.update(1 / 60); out.regrowLate = +(s.affixShield / pool).toFixed(2);
    // BÖLÜNEN: two weaker, plain copies.
    enemies = []; const sp = make('SPLITTING'); sp.takeDamage(1e9);
    const copies = enemies.filter(e => !e.dead);
    out.split = { n: copies.length, elite: copies.some(c => c.isElite), share: +(copies[0].maxHp / sp.maxHp).toFixed(2), type: copies[0].type };
    // HIZLANDIRICI: a neighbour moves 30% further per frame, a far foe does not.
    enemies = []; const h = make('HASTE'); const near = new Enemy(400, 300, 'TANK'), far = new Enemy(800, 800, 'TANK'), ctrl = new Enemy(100, 100, 'TANK');
    enemies.push(near, far, ctrl); h.update(1 / 60);
    const step = e => { const x0 = e.x, y0 = e.y; e.update(1 / 60); return Math.hypot(e.x - x0, e.y - y0); };
    out.haste = { near: +(step(near) / step(ctrl)).toFixed(2), speedBack: near.speed === ctrl.speed, farHasted: (far.affixHasteUntil || 0) > totalTime };
    // HIRSIZ: pulls XP orbs in and pays 1.5x on death.
    enemies = []; orbs = []; const t = make('THIEF'); emitEnergyOrb(360, 300, 40, false); emitEnergyOrb(310, 300, 20, false);
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    out.thief = { stolen: t.stolenXp, left: orbs.filter(o => !o.dead).length };
    t.takeDamage(1e9); out.thief.payout = orbs.filter(o => !o.dead && !o.isGold).map(o => o.value);
    // YANSITICI: every fifth hit fires back at the player.
    enemies = []; enemyProjectiles = []; const r = make('REFLECT'); r.hp = r.maxHp = 1e6;
    for (let i = 0; i < 4; i++) r.takeDamage(1); out.reflect4 = enemyProjectiles.length;
    r.takeDamage(1); out.reflect5 = enemyProjectiles.length;
    const shot = enemyProjectiles[0]; out.aim = shot ? Math.sign(shot.vx) === 1 && Math.sign(shot.vy) === 1 : false;
    return JSON.stringify(out);
  })()`));
  assert.deepEqual(x.shieldHit, { hpLost: 0, shieldLeft: 50 });
  assert.ok(Math.abs(x.shieldBroken.hpLost - x.shieldBroken.pool * 0.5) <= 1, JSON.stringify(x.shieldBroken));
  assert.equal(x.shieldBroken.shield, 0);
  assert.equal(x.regrowEarly, 0);
  assert.ok(x.regrowLate > 0.1 && x.regrowLate <= 1, String(x.regrowLate));
  assert.deepEqual(x.split, { n: 2, elite: false, share: 0.35, type: 'TANK' });
  assert.ok(Math.abs(x.haste.near - 1.3) < 0.02, JSON.stringify(x.haste));
  assert.equal(x.haste.speedBack, true);
  assert.equal(x.haste.farHasted, false);
  assert.deepEqual(x.thief.stolen, 60);
  assert.equal(x.thief.left, 0);
  assert.ok(x.thief.payout.includes(90), JSON.stringify(x.thief.payout));
  assert.equal(x.reflect4, 0);
  assert.equal(x.reflect5, 1);
  assert.equal(x.aim, true);
});

test('Odak 5.9 chain arcs apply the late power multiplier once', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); wave = 3;
    const arc = gold => {
      sessionGold = gold; player.chainLightning = 1;
      const a = new Enemy(300, 300, 'TANK'), b = new Enemy(340, 300, 'TANK');
      a.hp = a.maxHp = b.hp = b.maxHp = 1e6; enemies = [a, b];
      a.takeDamage(100, 0, 0, false, true, true);
      return { first: Math.round(1e6 - a.hp), arc: Math.round(1e6 - b.hp) };
    };
    return JSON.stringify({ plain: arc(0), rich: arc(1000) });
  })()`));
  assert.ok(x.plain.arc > 0);
  assert.equal(x.rich.first, Math.round(x.plain.first * 1.3));
  assert.ok(Math.abs(x.rich.arc - x.plain.arc * 1.3) <= 1, JSON.stringify(x));
});

test('Odak 5.10 a boss chest opens a hand of three relics and each relic comes once', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); gameState = 'PLAYING';
    const box = document.getElementById('upgradeCardsContainer'), cards = [];
    box.appendChild = c => cards.push(c);
    const chest = new LootChest(player.x, player.y, 'boss'); chest.update(1 / 60);
    const queued = pendingRelicChoices;
    gameState = 'PLAYING'; closeUpgradeModal(); gameState = 'PLAYING';
    updateGame(1 / 60);
    const hand = currentUpgradeChoices.map(c => c.upg.id);
    const view = { state: gameState, open: relicChoiceOpen, roles: cards.map(c => c._attrs['data-role']),
      title: document.getElementById('upgradeModalTitle').textContent, tools: document.getElementById('upgradeToolsRow').hidden,
      markup: cards[0].innerHTML };
    // Reroll and skip do nothing while the relic hand is open.
    const gold = totalGold = 999; document.getElementById('skipUpgradeBtn'); const skipped = skipUpgradeChoice();
    selectUpgradeOption(1);
    const after = { state: gameState, open: relicChoiceOpen, relics: [...player.relics], gold: totalGold,
      title: document.getElementById('upgradeModalTitle').textContent, tools: document.getElementById('upgradeToolsRow').hidden };
    // Own all but one: the next hand has only the last relic; then no hand at all.
    const missing = RELICS.find(r => !player.relics.has(r.id)).id;
    for (const r of RELICS) if (r.id !== missing) player.relics.add(r.id);
    pendingRelicChoices = 1; gameState = 'PLAYING'; openRelicChoice();
    const last = currentUpgradeChoices.map(c => c.upg.id);
    selectUpgradeOption(0);
    const full = new LootChest(player.x, player.y, 'boss'); gameState = 'PLAYING'; full.update(1 / 60);
    return JSON.stringify({ queued, hand, view, skipped, after, last, fullQueue: pendingRelicChoices, owned: player.relics.size });
  })()`));
  assert.equal(x.queued, 1);
  assert.equal(x.hand.length, 3);
  assert.equal(new Set(x.hand).size, 3);
  assert.equal(x.view.state, 'LEVEL_UP');
  assert.equal(x.view.open, true);
  assert.deepEqual(x.view.roles, ['relic', 'relic', 'relic']);
  assert.equal(x.view.title, 'ESER SEÇ');
  assert.equal(x.view.tools, true);
  assert.ok(x.view.markup.includes('BOSS ÖDÜLÜ') && x.view.markup.includes('ESERİ AL'), x.view.markup);
  assert.equal(x.skipped, false);
  assert.deepEqual(x.after.relics, [x.hand[1]]);
  assert.equal(x.after.state, 'PLAYING');
  assert.equal(x.after.open, false);
  assert.equal(x.after.title, 'SİBER YÜKSELTME SEÇ');
  assert.equal(x.after.tools, false);
  assert.equal(x.last.length, 1);
  assert.equal(x.fullQueue, 0);
  assert.equal(x.owned, 8);
});

test('Odak 5.10 every relic changes how the run plays', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); gameState = 'PLAYING'; wave = 5; player.x = 600; player.y = 400;
    const out = {};
    const foe = (x, y) => { const e = new Enemy(x, y, 'TANK'); e.hp = e.maxHp = 1e6; e.speed = 0; enemies.push(e); return e; };
    const lost = e => Math.round(1e6 - e.hp);
    // Patlayan Şarjör: the 10th salvo's shell bursts on hit.
    player.relics = new Set(['BURST_MAG']); enemies = []; bullets = [];
    const target = foe(760, 400), side = foe(790, 440);
    player.shotCounter = 9; player.critChance = 0; player.autoShoot();
    out.burstShell = bullets.filter(b => b.relicBurst).length;
    const b = bullets.find(b => b.relicBurst); relicBurstAt(b, target);
    out.burstSide = lost(side) > 0;
    player.shotCounter = 10; bullets = []; player.autoShoot(); out.burstOff = bullets.filter(b => b.relicBurst).length;
    // Ayna Namlu: one shell flies backwards.
    player.relics = new Set(['MIRROR_SHOT']); bullets = []; player.multishot = 1; player.autoShoot();
    out.mirror = bullets.map(b => Math.sign(Math.round(b.vx))).sort();
    // Son Direniş: low HP fires twice as fast.
    const fireDrop = (relic, hpShare) => { player.relics = new Set(relic ? ['LAST_STAND'] : []); player.hp = player.maxHp * hpShare;
      player.fireTimer = 10; player.momentum = 0; player.update(0.1); return 10 - player.fireTimer; };
    out.lastStand = +(fireDrop(true, 0.2) / fireDrop(false, 0.2)).toFixed(2);
    out.lastStandHigh = +(fireDrop(true, 0.9) / fireDrop(false, 0.9)).toFixed(2);
    player.hp = player.maxHp;
    // Altın Kan: a gold orb heals.
    player.relics = new Set(['GOLD_HEAL']); player.hp = 50; const g = new EnergyOrb(player.x, player.y, 1, true); g.update(1 / 60);
    out.goldHeal = player.hp - 50;
    // Kombo Hasadı: combo 20+ doubles the XP orb.
    player.relics = new Set(['COMBO_HARVEST']); orbs = [];
    combo = 25; const h1 = new Enemy(300, 300, 'TANK'); const xp1 = h1.xpValue; h1.die();
    combo = 2; const h2 = new Enemy(300, 300, 'TANK'); const xp2 = h2.xpValue; h2.die();
    out.harvest = [orbs[0].value / xp1, orbs[1].value / xp2];
    // Kritik Fırtına: a crit arcs with no ion module.
    player.relics = new Set(['CRIT_STORM']); player.chainLightning = 0; enemies = [];
    const c1 = foe(300, 300), c2 = foe(340, 300), c3 = foe(380, 300);
    c1.takeDamage(100, 0, 0, true, true); out.critStorm = [lost(c2) > 0, lost(c3) > 0];
    player.critStormReadyAt = 0; const before = lost(c2); c1.takeDamage(100, 0, 0, false, true);
    out.critStormNoCrit = lost(c2) === before;
    // Kor İzi: dashing leaves embers that burn.
    player.relics = new Set(['EMBER_DASH']); enemies = []; relicEmbers = [];
    const burn = foe(600, 400); player.isDashing = true; updateRelicEffects(1 / 60);
    out.embers = relicEmbers.length; out.emberBurn = lost(burn) > 0;
    player.isDashing = false; totalTime += 3; updateRelicEffects(1 / 60); out.embersGone = relicEmbers.length;
    // Yankı Novası: the nova fires again after 0.6 s.
    player.relics = new Set(['NOVA_ECHO']); enemies = []; const n = foe(650, 400);
    player.novaCooldown = 0; player.triggerNova(); const first = lost(n);
    totalTime += 0.7; updateRelicEffects(1 / 60); const second = lost(n) - first;
    out.echo = +(second / first).toFixed(2);
    out.echoNeedsEmp = RELICS.find(r => r.id === 'NOVA_ECHO').offerable.toString().includes('emp');
    return JSON.stringify(out);
  })()`));
  assert.equal(x.burstShell, 1);
  assert.equal(x.burstSide, true);
  assert.equal(x.burstOff, 0);
  assert.deepEqual(x.mirror, [-1, 1]);
  assert.ok(Math.abs(x.lastStand - 2) < 0.05, String(x.lastStand));
  assert.ok(Math.abs(x.lastStandHigh - 1) < 0.03, String(x.lastStandHigh));
  assert.equal(x.goldHeal, 2);
  assert.deepEqual(x.harvest, [2, 1]);
  assert.deepEqual(x.critStorm, [true, true]);
  assert.equal(x.critStormNoCrit, true);
  assert.equal(x.embers, 1);
  assert.equal(x.emberBurn, true);
  assert.equal(x.embersGone, 0);
  assert.ok(Math.abs(x.echo - 0.5) < 0.02, String(x.echo));
  assert.equal(x.echoNeedsEmp, true);
});

test('Odak 5.11 the daily run uses one seed and one contract per day', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const key = dailyDateKey(new Date(2026, 10, 6));
    const a = dailySeedFor(key), b = dailySeedFor(key), other = dailySeedFor('2026-11-07');
    selectedContractId = 'STANDARD';
    startDailyRun(); const s1 = runSeed, c1 = activeContractId, r1 = [rng(), rng()];
    selectedContractId = 'REDLINE';
    startDailyRun(); const s2 = runSeed, c2 = activeContractId, r2 = [rng(), rng()];
    document.getElementById('startBtn'); dailyRunActive = false; startNewGame(); const normal = runSeed;
    const ids = NEON_CONTRACTS.map(c => c.id);
    const contracts = new Set(); for (let d = 1; d <= 40; d++) contracts.add(dailyContractFor('2026-12-' + String(d).padStart(2, '0')));
    return JSON.stringify({ key, a, b, other, s1, s2, c1, c2, r1, r2, normal, today: dailySeedFor(dailyDateKey()),
      validContract: ids.includes(c1), contracts: contracts.size });
  })()`));
  assert.equal(x.key, '2026-11-06');
  assert.equal(x.a, x.b);
  assert.notEqual(x.a, x.other);
  assert.equal(x.s1, x.today);
  assert.equal(x.s1, x.s2);
  assert.deepEqual(x.r1, x.r2);
  assert.equal(x.c1, x.c2);
  assert.equal(x.validContract, true);
  assert.notEqual(x.normal, x.s1);
  assert.ok(x.contracts >= 3, String(x.contracts));
});

test('Odak 5.11 a locked contract system keeps the daily run on the standard protocol', () => {
  const { run } = setup({}, { unlockAll: false });
  const x = JSON.parse(run(`(() => { startDailyRun(); return JSON.stringify({ contract: activeContractId, label: document.getElementById('dailyRunMeta').textContent }); })()`));
  assert.equal(x.contract, 'STANDARD');
  assert.equal(x.label, 'GÜVENLİ');
});

test('Odak 5.11 today\'s best is saved, shown in the menu and reported at game over', () => {
  const first = setup();
  const x = JSON.parse(first.run(`(() => {
    startDailyRun(); score = 5000; wave = 7; triggerGameOver();
    const firstLabel = document.getElementById('newRecordText').textContent;
    startDailyRun(); score = 3000; wave = 5; triggerGameOver();
    const lowerLabel = document.getElementById('newRecordText').textContent;
    const saved = JSON.parse(localStorage.getItem(META_SAVE_KEY)).daily;
    // A normal run never touches the daily best.
    dailyRunActive = false; startNewGame(); score = 9000; triggerGameOver();
    return JSON.stringify({ firstLabel, lowerLabel, saved, after: dailyBest, normalLabel: document.getElementById('newRecordText').textContent,
      meta: (updateMenuCounters(), document.getElementById('dailyRunMeta').textContent), store: localStorage.getItem(META_SAVE_KEY) });
  })()`));
  assert.ok(x.firstLabel.startsWith('GÜNLÜK REKOR · 5.000'), x.firstLabel);
  assert.ok(x.lowerLabel.startsWith('GÜNLÜK KOŞU · BUGÜNÜN EN İYİSİ 5.000'), x.lowerLabel);
  assert.equal(x.saved.score, 5000);
  assert.equal(x.saved.wave, 7);
  assert.equal(x.after.score, 5000);
  assert.ok(!x.normalLabel.includes('GÜNLÜK'), x.normalLabel);
  assert.equal(x.meta, 'EN İYİ 5.000');
  // The best survives a reload; yesterday's or broken entries are ignored.
  const reload = setup({ 'neonCekirdek.meta.v1': x.store });
  assert.equal(reload.run('todaysDailyBest()?.score'), 5000);
  const old = JSON.parse(x.store); old.daily = { date: '2001-01-01', score: 99, wave: 2 };
  assert.equal(setup({ 'neonCekirdek.meta.v1': JSON.stringify(old) }).run('todaysDailyBest()'), null);
  for (const bad of [{ date: 'yarın', score: 5, wave: 2 }, { date: '2026-11-06', score: -4, wave: 2 }, 'x']) {
    const broken = JSON.parse(x.store); broken.daily = bad;
    assert.equal(setup({ 'neonCekirdek.meta.v1': JSON.stringify(broken) }).run('dailyBest'), null);
  }
});

test('Odak 5.12 fire rate and Cyber Frenzy speed up every weapon', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame();
    const give = (id, n) => { const upg = UPGRADES_POOL.find(u => u.id === id);
      for (let i = 0; i < n; i++) { gameState = 'LEVEL_UP'; currentUpgradeChoices = [{ upg, rarity: RARITIES[0] }]; selectUpgradeOption(0); } };
    const base = getWeaponTempo(player), baseCd = getWeaponCooldownMult(player);
    give('firerate', 3); const fast = getWeaponTempo(player);
    player.overdriveActive = true; const frenzy = getWeaponTempo(player); player.overdriveActive = false;
    player.fireDelay = 0.01; const capped = getWeaponTempo(player);
    player.fireDelay = 0.46; give('boomerang_disc', 1);
    boomerangDiscs = []; player.boomerangReadyAt = 0; updateBoomerangDiscs(1 / 60); const slowCd = player.boomerangReadyAt - totalTime;
    player.fireDelay = 0.30; boomerangDiscs = []; player.boomerangReadyAt = 0; updateBoomerangDiscs(1 / 60); const fastCd = player.boomerangReadyAt - totalTime;
    return JSON.stringify({ base, baseCd, fast, frenzy, capped, slowCd, fastCd, tempoAt30: getWeaponTempo(player) });
  })()`));
  assert.equal(x.base, 1);
  assert.equal(x.baseCd, 1);
  assert.ok(x.fast > 1.2 && x.fast < 2, String(x.fast));
  assert.ok(Math.abs(x.frenzy - x.fast * 1.3) < 1e-9);
  assert.equal(x.capped, 2);
  assert.ok(Math.abs(x.slowCd - 2.2) < 1e-6, String(x.slowCd));
  assert.ok(Math.abs(x.fastCd - 2.2 / x.tempoAt30) < 1e-6, String(x.fastCd));
});

test('Odak 5.12 every weapon can hurt a lone boss on its own', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    const out = {};
    for (const id of ['orbital', 'mine_trail', 'boomerang_disc', 'shock_ring', 'homing']) {
      startNewGame(); gameState = 'PLAYING'; nextBossTime = 1e12;
      const upg = UPGRADES_POOL.find(u => u.id === id);
      for (let i = 0; i < 3; i++) { gameState = 'LEVEL_UP'; currentUpgradeChoices = [{ upg, rarity: RARITIES[0] }]; selectUpgradeOption(0); }
      gameState = 'PLAYING';
      const cx = worldWidth / 2, cy = worldHeight / 2;
      const boss = new Enemy(cx + 260, cy, 'BOSS_TITAN'); boss.maxHp = boss.hp = 1e9; boss.speed = 0; boss.actionTimer = 1e9;
      enemies = [boss]; activeBosses = [boss];
      // The plasma gun stays silent: only the weapon under test can deal damage.
      const shoot = Player.prototype.autoShoot;
      player.autoShoot = function () { this.lockedTarget = boss; if (id === 'homing') shoot.call(this); };
      player.x = cx; player.y = cy;
      for (let t = 0; t < 60 * 8; t++) {
        gameState = 'PLAYING'; player.hp = player.maxHp; enemyProjectiles = []; enemies = [boss];
        player.lockedTarget = boss; boss.x = cx + 260; boss.y = cy;
        updateGame(1 / 60);
      }
      out[id] = Math.round(1e9 - boss.hp);
    }
    return JSON.stringify(out);
  })()`));
  for (const id of ['orbital', 'mine_trail', 'boomerang_disc', 'shock_ring', 'homing'])
    assert.ok(x[id] > 0, id + ' never reached the boss: ' + JSON.stringify(x));
});

test('Odak 5.12 lightning grounds into a lone foe and a circuit discharges into the boss', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); gameState = 'PLAYING';
    player.upgradeCounts.lightning = 3; player.chainLightning = 6;
    const lone = new Enemy(300, 300, 'TANK'); lone.hp = lone.maxHp = 1e6; enemies = [lone];
    lone.takeDamage(100, 0, 0, false, true, true);
    const grounded = Math.round(1e6 - lone.hp);
    const a = new Enemy(300, 300, 'TANK'), b = new Enemy(340, 300, 'TANK');
    a.hp = a.maxHp = b.hp = b.maxHp = 1e6; enemies = [a, b];
    player.chainLightning = 1; a.takeDamage(100, 0, 0, false, true, true);
    const pair = { a: Math.round(1e6 - a.hp), b: Math.round(1e6 - b.hp) };
    // Circuit: the closure skips bosses, the discharge does not.
    player.upgradeCounts.circuit_weaver = 3;
    const boss = new Enemy(player.x + 200, player.y, 'BOSS_TITAN'); boss.maxHp = boss.hp = 1e9; enemies = [boss]; activeBosses = [boss];
    player.lockedTarget = boss;
    const square = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
    closeCircuitWeaver(player, square, 40000);
    return JSON.stringify({ grounded, pair, discharge: Math.round(1e9 - boss.hp), dmg: player.damage, stats: player.buildStats.circuitDischarges });
  })()`));
  // 100 + 4 grounded arcs at 1.05 x arcDamage (1.0 at tier 3).
  assert.equal(x.grounded, Math.round(100 + 100 * 1.05 * 4));
  assert.equal(x.pair.a, 100, 'with a neighbour the arc jumps, nothing grounds');
  assert.ok(x.pair.b > 0);
  assert.equal(x.stats, 1);
  assert.equal(x.discharge, Math.round(x.dmg * 17 * 0.78));
});

test('Odak 5.13 every mission but no-hit fails when its time runs out', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    startNewGame(); gameState = 'PLAYING'; wave = 6;
    generateNextQuest('KILLS');
    const start = activeQuest.timeLeft, gold = totalGold;
    updateQuest(QUEST_FAIL_RULES.timeLimit - QUEST_FAIL_RULES.warnAt - 1);
    const quietHud = questHudPrevious;
    updateQuest(1.5);
    const warnHud = questHudPrevious;
    gameState = 'PAUSED'; updateQuest(100); const paused = activeQuest.type;
    gameState = 'PLAYING'; updateQuest(QUEST_FAIL_RULES.warnAt);
    const after = { type: activeQuest.type, timeLeft: activeQuest.timeLeft, failed: questStats.failed, byType: questStats.failedByType };
    generateNextQuest('NO_HIT'); const flawless = activeQuest.timeLeft;
    const snap = window.getNeonQuestSnapshot();
    triggerGameOver();
    return JSON.stringify({ start, quietHud, warnHud, paused, after, flawless, snap: snap.timeLeft, goldGained: totalGold - gold, report: window.getNeonFinalReport().missions });
  })()`));
  assert.equal(x.start, 75);
  assert.doesNotMatch(x.quietHud, /sn/, 'no countdown before the warning window');
  assert.match(x.warnHud, /· 15sn/);
  assert.equal(x.paused, 'KILLS', 'the clock stops outside active play');
  assert.equal(x.after.failed, 1);
  assert.deepEqual(x.after.byType, { KILLS: 1 });
  assert.notEqual(x.after.type, 'KILLS');
  assert.equal(x.after.timeLeft, x.after.type === 'NO_HIT' ? null : 75, 'the next mission gets a fresh clock');
  assert.equal(x.flawless, null);
  assert.equal(x.snap, null);
  assert.equal(x.goldGained, 0);
  assert.equal(x.report.failed, 1);
  assert.deepEqual(x.report.failedByType, { KILLS: 1 });
});

test('Odak 5.13 biome hazards keep working during a boss fight while bosses stay immune', () => {
  const { run } = setup();
  const x = JSON.parse(run(`(() => {
    // Garden: ion node bursts and stuns the crowd around a live boss.
    startNewGame(); wave = 9; nextBossTime = 500;
    const node = getGardenCenters()[0]; player.x = node.x; player.y = node.y;
    enemies = Array.from({ length: 12 }, () => new Enemy(node.x + 18, node.y + 14, 'TANK'));
    const gBoss = new Enemy(node.x, node.y, 'BOSS_DESTROYER'); enemies.push(gBoss); activeBosses = [gBoss];
    updateArenaChapter(.1); updateArenaChapter(.8); updateArenaChapter(.85);
    const garden = { stuns: enemies.filter(e => e.stunTimer > 0).length, bossStun: gBoss.stunTimer, bursts: chapterStats.gardenBursts };
    // Foundry: the heat rail fires through the boss warning window.
    startNewGame(); wave = 6; totalTime = 0; nextBossTime = 3; updateArenaChapter(.1);
    const L = chapterFoundryLayout; const at = foundryRailPositions(L)[0];
    const put = (o, along) => { if (L.axis === 'y') { o.x = along; o.y = at; } else { o.x = at; o.y = along; } return o; };
    put(player, 200); enemies = [put(new Enemy(0, 0, 'TANK'), 240)]; enemies[0].hp = enemies[0].maxHp = 2000;
    const fBoss = put(new Enemy(0, 0, 'BOSS_DESTROYER'), 260); fBoss.hp = fBoss.maxHp = 2000; enemies.push(fBoss); activeBosses = [fBoss];
    const hp = player.hp; totalTime = 1.6; updateArenaChapter(.1);
    const foundry = { playerLost: hp - player.hp, enemyHp: enemies[0].hp, bossHp: fBoss.hp };
    // The nemesis and the scripted showcase still wait for the boss to fall.
    startNewGame(); wave = 16; waveTimer = 2; totalTime = 400; nextBossTime = 1000;
    const sBoss = new Enemy(300, 300, 'BOSS_TITAN'); activeBosses = [sBoss];
    updateArenaChapter(.02);
    const duringBoss = { showcase: getArenaChapterSnapshot().showcase, nemesis: nemesisAllowed(), hud: chapterEffectsAllowed() };
    sBoss.dead = true; updateArenaChapter(.02);
    const afterBoss = { showcase: getArenaChapterSnapshot().showcase?.id || null };
    return JSON.stringify({ garden, foundry, duringBoss, afterBoss });
  })()`));
  assert.equal(x.garden.stuns, 8);
  assert.equal(x.garden.bossStun, 0);
  assert.equal(x.garden.bursts, 1);
  assert.equal(x.foundry.playerLost, 9);
  assert.ok(x.foundry.enemyHp < 2000);
  assert.equal(x.foundry.bossHp, 2000);
  assert.equal(x.duringBoss.hud, true);
  assert.equal(x.duringBoss.showcase, null);
  assert.equal(x.duringBoss.nemesis, false);
  assert.equal(x.afterBoss.showcase, 'FOUNDRY');
});
