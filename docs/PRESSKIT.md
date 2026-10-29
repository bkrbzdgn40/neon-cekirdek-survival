# NEON ÇEKİRDEK · Press / Developer Fact Sheet

**Current factual project sheet.** This is documentation of an actively developed browser prototype, **not a commercial launch announcement**. [Türkçe bilgiler](#türkçe-bilgi-föyü).

## Facts at a glance

| Item | Verified description |
| --- | --- |
| **Title** | Neon Çekirdek: Hayatta Kal |
| **English short title** | Neon Çekirdek |
| **Genre** | Top-down arena survival with roguelite upgrade systems |
| **Platform** | Desktop and mobile web browsers; Canvas 2D |
| **Technology** | Vanilla JavaScript, HTML, CSS; local static assets |
| **Distribution / development** | Public source repository; active browser prototype |
| **Dependencies to run** | No account, API, database, build pipeline or installer |
| **Playable build** | [`index.html`](../index.html) (host or local server required) |
| **Professional showcase** | [`showcase.html`](../showcase.html), English/Turkish |
| **Source & updates** | [GitHub](https://github.com/bkrbzdgn40/neon-cekirdek-survival) |
| **Project contact** | [GitHub Issues](https://github.com/bkrbzdgn40/neon-cekirdek-survival/issues) |

**One-line description (EN):**
> A browser-based neon arena-survival game where evolving builds, tactical enemy formations and interactive battlefield devices turn every wave into a new positioning problem.

**One-line description (TR):**
> Gelişen modüllerin, taktiksel düşman formasyonlarının ve etkileşimli arena cihazlarının her dalgada yeni kararlar yarattığı neon temalı tarayıcı hayatta kalma oyunu.

### Short English description

Neon Çekirdek is a playable independent arena-survival project built entirely for the browser. Players choose one of three chassis, collect upgrades, unlock module evolutions and synergies, and survive against varied enemy formations and boss archetypes. The Combat Director shapes encounters, while the Foundry, Garden and Rift chapters alter the arena. Risk/reward interactions include volatile reactors that can chain-explode and graviton pylons that slow incoming enemies. The game uses procedural Canvas effects and configurable graphics profiles, with Node and real Chromium browser regressions run in CI.

### 3 verifiable angles

1. **Battlefield interaction as player choice:** shoot, dash or EMP-trigger temporary devices; a volatile reactor can hit the player as well as enemies.
2. **Combat pacing without overclaiming AI:** scripted tactical encounters and an optional adaptive tempo exist; player-pattern learning is an **observation-only shadow system** and does not control spawns or rewards.
3. **Browser engineering:** the runtime has fixed entity/FX limits, offscreen visual culling and three graphics modes. Logic and browser regression CI exist; long-duration device performance is not certified.

## Media

- **Original vector brand key art:** [`media/neon-core-cover.svg`](../media/neon-core-cover.svg), 1200 × 630 SVG. It is an illustration, **not a screenshot of gameplay**. Avoid describing it as gameplay.
- **Actual gameplay screenshots:** Not yet provided as approved files in the repository. Do **not** replace these with concept art. Capture directly from `index.html` (recommended 16:9, HUD visible, screenshot from an actual run).
- **Gameplay video/trailer:** None is represented as published. Footage must be captured from an actual play session, not from the CSS illustration.
- **Editorial re-use:** There is no published media usage license or public code license in the repository. Contact the maintainer for permission before reuse.

### Suggested real-game capture shot list

These are instructions for **future captures**, not claims that the files already exist.

1. Normal early combat with the complete Combat Cockpit HUD readable.
2. One genuine multi-enemy tactical encounter with clear attack warnings.
3. An arena chapter featuring Foundry, Garden or Rift mechanics.
4. A late-wave upgrade/evolution card showing legible full descriptions.
5. A player-triggered reactor, actual fuse telegraph and resulting explosion, or an active graviton field.
6. Optional: real boss battle, phase telegraphs and identifiable boss HUD.

When recording, include game build/commit, browser, viewport, graphics quality and whether `?tempo=adaptive` or `?learn=on` is active. Game screenshots for future store use should show actual play, not composited text overlays.

## How to evaluate

```sh
python -m http.server 8000
```

- Game: **http://localhost:8000/index.html**
- Professional page: **http://localhost:8000/showcase.html**
- Optional performance diagnostics: **http://localhost:8000/index.html?perf=1**
- Automated checks: [Node + Chromium CI](../.github/workflows/neon-smoke.yml)
- Real-device limitations: [Device QA](DEVICE_QA.md)

The game stores progression locally in the browser and includes a JSON export/import for selected meta progress. There is no cloud account or server-side player telemetry.

## Honest limitations

- No verified public GitHub Pages deployment yet. [Publishing checklist](PUBLISHING.md).
- No verified manual 30–60-minute device benchmark or universally proven FPS value.
- No published Steam listing, console certification, awards, reviews, release date or commercial price is asserted.
- Source is visible, but **no open-source license has been declared**. Do not assume re-use rights.

## Türkçe bilgi föyü

**Neon Çekirdek: Hayatta Kal**, modern masaüstü ve mobil tarayıcılarda çalışabilen bağımsız bir arena-survival prototipidir. Üç şasi, modül kademe/evrim/sinerji sistemi, Combat Director karşılaşmaları, dört boss türü, Dökümhane/Bahçe/Yarık arena bölümleri ve etkileşimli reaktör/graviton cihazları bulunur.

Gerçek oyun [`index.html`](../index.html), profesyonel tanıtım [`showcase.html`](../showcase.html) üzerinden yerel sunucuyla açılabilir. Basın veya inceleme için **gerçek oynanış görüntüleri oyundan kaydedilmelidir**; depodaki SVG yalnızca marka görselidir.

Oyun için internet hesabı ya da sunucu gerekmez. Veri tarayıcının yerel alanında tutulur. Node ve Chromium otomatik testleri mevcuttur, fakat bu sonuçlar tüm cihazlarda sabit FPS veya uzun süreli stabilite garantisi değildir. Lisans ve yayın konularındaki kararlar için depo sorumlusu ile iletişim kurulmalıdır.
