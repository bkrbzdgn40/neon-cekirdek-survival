#!/usr/bin/env node
// Odak 3.3 · DPS and survival simulation. Run by hand, not in CI:
//   node scripts/sim-dps.cjs [--seeds=5] [--seconds=30] [--only=homing,orbital]
// Each run: fixed ?seed, arena at wave 6, plasma plus one weapon at a given
// tier, a bot circling a 120 px radius around the arena centre. Level-up
// choices are suppressed so the build stays fixed. Writes a table to stdout
// and the raw numbers to sim-results.json.
const fs = require('node:fs');
const path = require('node:path');
const { setup } = require('../tests/harness.cjs');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v = 'true'] = a.replace(/^--/, '').split('=');
  return [k, v];
}));
const SEEDS = Array.from({ length: Number(args.seeds) || 5 }, (_, i) => 1001 + i * 7919);
const SECONDS = Number(args.seconds) || 30;
const WAVE = 6;
const RADIUS = 120;
const VIEWPORT = { width: 1366, height: 768 };

function weaponList(run) {
  const ids = JSON.parse(run(`JSON.stringify(UPGRADES_POOL.filter(u => u.kind === 'weapon').map(u => u.id))`));
  const only = args.only ? String(args.only).split(',') : null;
  return ids.filter(id => !only || only.includes(id));
}

function simulate(weaponId, tier, seed) {
  const { run } = setup({}, { locationSearch: `?seed=${seed}&wave=${WAVE}`, unlockAll: false,
    width: VIEWPORT.width, height: VIEWPORT.height, timeout: 20000 });
  run(`(() => {
    window.__sim = { damage: 0, taken: 0 };
    const enemyHit = Enemy.prototype.takeDamage;
    Enemy.prototype.takeDamage = function (...a) {
      const before = Math.max(0, this.hp);
      const result = enemyHit.apply(this, a);
      window.__sim.damage += before - Math.max(0, this.hp);
      return result;
    };
    triggerLevelUp = () => {};
    startNewGame();
    const upgrade = UPGRADES_POOL.find(u => u.id === ${JSON.stringify(weaponId)});
    for (let i = 0; upgrade && i < ${tier}; i++) {
      gameState = 'LEVEL_UP';
      currentUpgradeChoices = [{ upg: upgrade, rarity: RARITIES[0] }];
      selectUpgradeOption(0);
    }
    player.maxHp = player.hp = 1e6;
    const playerHit = player.takeDamage.bind(player);
    player.takeDamage = function (amount) {
      const before = this.hp;
      playerHit(amount);
      window.__sim.taken += Math.max(0, before - this.hp);
      this.hp = this.maxHp;
    };
    kills = 0;
    touchMoveMode = 'joystick';
    touchStick.id = 1;
    touchStick.originX = 0; touchStick.originY = 0;
    window.__simStep = () => {
      const cx = worldWidth / 2, cy = worldHeight / 2;
      const a = Math.atan2(player.y - cy, player.x - cx) + 0.35;
      const dx = cx + Math.cos(a) * ${RADIUS} - player.x, dy = cy + Math.sin(a) * ${RADIUS} - player.y;
      const d = Math.hypot(dx, dy) || 1;
      touchStick.x = dx / d * 100; touchStick.y = dy / d * 100;
      gameState = 'PLAYING';
      updateGame(1 / 60);
    };
  })()`);
  for (let s = 0; s < SECONDS; s++) run('for (let f = 0; f < 60; f++) window.__simStep()');
  return JSON.parse(run(`JSON.stringify({ damage: window.__sim.damage, taken: window.__sim.taken, kills,
    tier: player.upgradeCounts[${JSON.stringify(weaponId)}] || 0 })`));
}

function average(rows, key) { return rows.reduce((s, r) => s + r[key], 0) / rows.length; }

function measure(weaponId, tier) {
  const rows = SEEDS.map(seed => simulate(weaponId, tier, seed));
  return { weapon: weaponId, tier, seeds: SEEDS.length,
    dps: average(rows, 'damage') / SECONDS, kills: average(rows, 'kills'), taken: average(rows, 'taken') };
}

const started = Date.now();
const probe = setup({}, { unlockAll: false });
const weapons = weaponList(probe.run);
const results = [measure('plasma', 0)];
const base = results[0].dps;
for (const id of weapons) for (let tier = 1; tier <= 3; tier++) results.push(measure(id, tier));
for (const r of results) r.addedDps = r.dps - base;

const pad = (s, n) => String(s).padEnd(n);
const num = (x, n, d = 1) => x.toFixed(d).padStart(n);
console.log(`DPS simülasyonu · dalga ${WAVE} · ${SECONDS} sn · ${SEEDS.length} tohum · ${RADIUS} px daire botu`);
console.log(`${pad('silah', 16)}${pad('kademe', 8)}${'DPS'.padStart(8)}${'+DPS'.padStart(8)}${'öldürme'.padStart(9)}${'hasar'.padStart(8)}`);
for (const r of results) {
  console.log(`${pad(r.weapon, 16)}${pad(r.weapon === 'plasma' ? 'temel' : 'K' + r.tier, 8)}` +
    `${num(r.dps, 8)}${num(r.addedDps, 8)}${num(r.kills, 9)}${num(r.taken, 8)}`);
}
// Balance band (plan 3.3): each tier's added DPS within ±25 % of that tier's median.
const bands = {};
for (let tier = 1; tier <= 3; tier++) {
  const row = results.filter(r => r.tier === tier && r.weapon !== 'plasma');
  if (!row.length) continue;
  const sorted = row.map(r => r.addedDps).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const outside = row.filter(r => Math.abs(r.addedDps / median - 1) > 0.25)
    .map(r => `${r.weapon} ${r.addedDps > median ? '+' : ''}${Math.round((r.addedDps / median - 1) * 100)}%`);
  bands['K' + tier] = { median, low: median * 0.75, high: median * 1.25, outside };
  console.log(`K${tier} +DPS medyanı ${median.toFixed(1)} · bant ${(median * 0.75).toFixed(1)}–${(median * 1.25).toFixed(1)} · dışında: ${outside.join(', ') || 'yok'}`);
}
const out = { generatedAt: new Date().toISOString(), wave: WAVE, seconds: SECONDS, seeds: SEEDS,
  radius: RADIUS, viewport: VIEWPORT, bands, results };
fs.writeFileSync(path.join(__dirname, '..', 'sim-results.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`sim-results.json yazıldı (${((Date.now() - started) / 1000).toFixed(1)} sn)`);
