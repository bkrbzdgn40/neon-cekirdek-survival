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
