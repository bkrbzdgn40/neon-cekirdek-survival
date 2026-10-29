
        // Audio arrangement only. Game timing and collision do not depend on music.
        const ADAPTIVE_MUSIC_PROFILES = Object.freeze({
            NORMAL: Object.freeze({beat:.24,root:1,volume:.027,filter:280,accentEvery:8,accentGain:.013}),
            APPROACH: Object.freeze({beat:.215,root:.91,volume:.030,filter:320,accentEvery:4,accentGain:.014}),
            BOSS: Object.freeze({beat:.19,root:.82,volume:.034,filter:370,accentEvery:4,accentGain:.016}),
            OVERDRIVE: Object.freeze({beat:.155,root:1.22,volume:.036,filter:405,accentEvery:2,accentGain:.018})
        });
        function getCombatMusicPhase(isOverdrive, bossCount, bossApproaching) {
            if (isOverdrive) return 'OVERDRIVE';
            if (bossCount>0) return 'BOSS';
            if (bossApproaching) return 'APPROACH';
            return 'NORMAL';
        }


        // Each procedural one-shot is bounded and filtered, without external audio files.
        const WEAPON_SFX=Object.freeze({
            plasma:{wave:'triangle',start:620,end:190,length:.08,gain:.044,lowpass:920},
            prism:{wave:'sine',start:800,end:400,length:.095,gain:.047,lowpass:950},
            reactor:{wave:'triangle',start:440,end:720,length:.09,gain:.044,lowpass:920},
            rail:{wave:'sawtooth',start:260,end:85,length:.16,gain:.054,lowpass:550},
            missile:{wave:'sawtooth',start:205,end:100,length:.135,gain:.05,lowpass:480},
            cluster:{wave:'triangle',start:340,end:160,length:.1,gain:.037,lowpass:650},
            arc:{wave:'triangle',start:670,end:370,length:.08,gain:.032,lowpass:970}
        });
        const HIT_SFX=Object.freeze({
            plasma:{wave:'triangle',start:310,end:110,length:.06,gain:.031,lowpass:750},
            prism:{wave:'sine',start:720,end:390,length:.084,gain:.035,lowpass:900},
            reactor:{wave:'triangle',start:410,end:610,length:.075,gain:.033,lowpass:810},
            rail:{wave:'sawtooth',start:190,end:75,length:.14,gain:.047,lowpass:490},
            missile:{wave:'sawtooth',start:160,end:65,length:.14,gain:.048,lowpass:460},
            cluster:{wave:'triangle',start:380,end:135,length:.085,gain:.031,lowpass:680},
            arc:{wave:'triangle',start:810,end:420,length:.09,gain:.036,lowpass:980}
        });
        const BOSS_DEATH_SFX=Object.freeze({
            BOSS_DESTROYER:{wave:'sawtooth',start:265,end:65,length:.48,gain:.076,lowpass:630},
            BOSS_TITAN:{wave:'sawtooth',start:160,end:55,length:.55,gain:.084,lowpass:440},
            BOSS_VOID:{wave:'sine',start:410,end:90,length:.62,gain:.073,lowpass:690},
            BOSS_PRISM:{wave:'triangle',start:690,end:135,length:.50,gain:.073,lowpass:820}
        });
        function getWeaponSoundFamily(b) {
            if (b.evoRail) return 'rail';
            if (b.reactorPulse) return 'reactor';
            if (b.clusterFragment) return 'cluster';
            if (b.isHoming) return b.clusterPayload?'cluster':'missile';
            if (b.prismEvolved) return 'prism';
            return 'plasma';
        }

        class SoundEngine {
            constructor() {
                this.ctx = null;
                this.enabled = true;
                this.musicEnabled = true;
                this.musicTimer = 0;
                this.musicStep = 0;
                this.bassNotes = [55, 55, 65.41, 55, 73.42, 65.41, 49, 55];
                this.lastSfxTime = Object.create(null);
                this.musicPhase = 'NORMAL';
                this.lastMusicPhase = null;
                this.sfxWindowAt = -Infinity;
                this.sfxWindowCount = 0;
                this.sfxWindowSeconds = .12;
                this.sfxWindowMax = 9; // Low-priority effects only: phase warnings bypass it.
            }

            allowSfx(channel, spacingSeconds, important = false) {
                if (!this.ctx) return false;
                const now = this.ctx.currentTime;
                if (now < this.sfxWindowAt || now - this.sfxWindowAt >= this.sfxWindowSeconds) {
                    this.sfxWindowAt = now;
                    this.sfxWindowCount = 0;
                }
                const previous = this.lastSfxTime[channel];
                if (previous !== undefined && now - previous < spacingSeconds) return false;
                // An encounter must never hide its warning cue behind cheap explosions.
                if (!important && this.sfxWindowCount >= this.sfxWindowMax) return false;
                this.sfxWindowCount++;
                this.lastSfxTime[channel] = now;
                return true;
            }

            init() {
                try {
                    if (!this.ctx) {
                        const AudioCtx = window.AudioContext || window.webkitAudioContext;
                        if (AudioCtx) this.ctx = new AudioCtx();
                    }
                    if (this.ctx && this.ctx.state === 'suspended') {
                        this.ctx.resume();
                    }
                } catch (e) {
                    console.warn('AudioContext init skipped:', e);
                }
            }

            updateMusic(dt, isActive, isOverdrive = false, bossCount = 0, bossApproaching = false) {
                if (!isActive) {
                    this.musicTimer = 0;
                    this.musicStep = 0;
                    this.lastMusicPhase = null;
                    this.musicPhase = 'NORMAL';
                    return;
                }
                const phase = getCombatMusicPhase(isOverdrive, bossCount, bossApproaching);
                this.musicPhase = phase;
                if (phase !== this.lastMusicPhase) {
                    this.lastMusicPhase = phase;
                    this.musicTimer = 0; // Introduce the next mood promptly, never queue old layers.
                    this.musicStep = 0;
                }
                // SFX toggle never mutes music. The two HUD switches are independent.
                if (!this.musicEnabled || !this.ctx || this.ctx.state === 'suspended') return;
                this.musicTimer -= Math.max(0,dt);
                if (this.musicTimer > 0) return;
                const profile = ADAPTIVE_MUSIC_PROFILES[phase];
                this.musicTimer = profile.beat;
                const step = this.musicStep++;
                const freq = this.bassNotes[step % this.bassNotes.length] * profile.root;
                this.playBassPulse(freq,profile);
                if (step % profile.accentEvery === profile.accentEvery - 1) {
                    this.playMusicAccent(freq*4,profile);
                }
            }

            playBassPulse(freq,profile=ADAPTIVE_MUSIC_PROFILES.NORMAL) {
                if (!this.ctx) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const filter = this.ctx.createBiquadFilter();
                    const gain = this.ctx.createGain();

                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(freq, now);
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(profile.filter, now);
                    filter.frequency.exponentialRampToValueAtTime(80, now + 0.18);
                    gain.gain.setValueAtTime(profile.volume, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

                    osc.connect(filter);
                    filter.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.19);
                } catch (e) {}
            }

            playMusicAccent(freq,profile) {
                if (!this.ctx) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = this.musicPhase === 'OVERDRIVE' ? 'triangle' : 'sine';
                    osc.frequency.setValueAtTime(Math.min(900,freq),now);
                    osc.frequency.exponentialRampToValueAtTime(Math.min(950,freq*1.07),now+.13);
                    gain.gain.setValueAtTime(profile.accentGain,now);
                    gain.gain.exponentialRampToValueAtTime(.001,now+.14);
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);osc.stop(now+.14);
                } catch(e) {}
            }

            playThreatCue(kind = 'raid') {
                // Short distinct UI cue, separated from bass and rapid-fire audio.
                if (!this.enabled || !this.allowSfx('cue-' + kind, 1.5, true)) return;
                try {
                    const notes = {boss:[260,195],raid:[570,430],phase:[440,310],event:[740,920]}[kind] || [570,430];
                    notes.forEach((freq,index) => {
                        const now = this.ctx.currentTime + index * .13;
                        const osc = this.ctx.createOscillator();
                        const gain = this.ctx.createGain();
                        osc.type = kind === 'boss' ? 'sawtooth' : 'triangle';
                        osc.frequency.setValueAtTime(freq,now);
                        osc.frequency.exponentialRampToValueAtTime(freq*.92,now+.11);
                        gain.gain.setValueAtTime(kind==='boss' ? .061 : .036,now);
                        gain.gain.exponentialRampToValueAtTime(.001,now+.12);
                        osc.connect(gain);gain.connect(this.ctx.destination);
                        osc.start(now);osc.stop(now+.12);
                    });
                } catch(e) {}
            }


            // One synthesized voice per accepted event, filtered below 1 kHz.
            synthSfx(recipe,pitch=1,delay=0) {
                if (!this.ctx || this.ctx.state === 'suspended') return;
                try {
                    const now=this.ctx.currentTime+delay;
                    const osc=this.ctx.createOscillator();
                    const amp=this.ctx.createGain();
                    const filter=this.ctx.createBiquadFilter?.();
                    osc.type=recipe.wave;
                    osc.frequency.setValueAtTime(Math.min(1000,Math.max(45,recipe.start*pitch)),now);
                    osc.frequency.exponentialRampToValueAtTime(
                        Math.min(1000,Math.max(45,recipe.end*pitch)),now+recipe.length*.86);
                    amp.gain.setValueAtTime(Math.min(.09,recipe.gain),now);
                    amp.gain.exponentialRampToValueAtTime(.001,now+recipe.length);
                    if(filter) {
                        filter.type='lowpass';
                        filter.frequency.setValueAtTime(recipe.lowpass,now);
                        osc.connect(filter);filter.connect(amp);
                    } else osc.connect(amp);
                    amp.connect(this.ctx.destination);
                    osc.start(now);osc.stop(now+recipe.length);
                }catch(e){}
            }
            playWeaponFire(family='plasma',crit=false) {
                if (!this.enabled || !this.allowSfx('weapon-fire',.035,!!crit)) return;
                this.synthSfx(WEAPON_SFX[family]||WEAPON_SFX.plasma,crit?1.08:1);
            }
            playWeaponHit(family='plasma',crit=false,boss=false) {
                const arc=family==='arc';
                if (!this.enabled || !this.allowSfx(arc?'arc-hit':'weapon-hit',
                        arc?.14:.055,!!boss&&!!crit)) return;
                this.synthSfx(HIT_SFX[family]||HIT_SFX.plasma,boss?.87:crit?1.11:1);
            }
            playBossDeath(archetype) {
                if (!this.enabled || !this.allowSfx('boss-death',.32,true)) return;
                this.synthSfx(BOSS_DEATH_SFX[archetype]||BOSS_DEATH_SFX.BOSS_DESTROYER);
            }
            playRevive() {
                if (!this.enabled || !this.allowSfx('revive',.5,true)) return;
                this.synthSfx({wave:'sine',start:240,end:520,length:.29,gain:.07,lowpass:720});
                this.synthSfx({wave:'triangle',start:350,end:680,length:.36,gain:.049,lowpass:850},1,.14);
            }

            playLaser(isCrit = false) {
                if (!this.enabled || !this.allowSfx('laser', 0.035, isCrit)) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = isCrit ? 'sawtooth' : 'triangle';
                    osc.frequency.setValueAtTime(isCrit ? 920 : 680, now);
                    osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);

                    gain.gain.setValueAtTime(isCrit ? 0.068 : 0.044, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.08);
                } catch (e) {}
            }

            playExplosion(isBig = false) {
                if (!this.enabled || !this.allowSfx(isBig ? 'bigExplosion' : 'smallExplosion', isBig ? 0.12 : 0.06, isBig)) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(isBig ? 140 : 210, now);
                    osc.frequency.exponentialRampToValueAtTime(28, now + (isBig ? 0.35 : 0.16));

                    gain.gain.setValueAtTime(isBig ? 0.102 : 0.065, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + (isBig ? 0.35 : 0.16));

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + (isBig ? 0.35 : 0.16));
                } catch (e) {}
            }

            playOrbPickup(combo = 1, isGold = false) {
                if (!this.enabled || !this.allowSfx(isGold ? 'goldPickup' : 'xpPickup', isGold ? 0.075 : 0.045)) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = isGold ? 'triangle' : 'sine';
                    const baseFreq = isGold ? 580 : Math.min(420 + combo * 18, 1100);
                    osc.frequency.setValueAtTime(baseFreq, now);
                    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.07);

                    gain.gain.setValueAtTime(0.044, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.07);
                } catch (e) {}
            }

            playDash() {
                if (!this.enabled || !this.allowSfx('dash', .1, true)) return;
                try {
                    const now = this.ctx.currentTime;
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(220, now);
                    osc.frequency.exponentialRampToValueAtTime(760, now + 0.14);

                    gain.gain.setValueAtTime(0.072, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(now);
                    osc.stop(now + 0.14);
                } catch (e) {}
            }

            playLevelUp() {
                if (!this.enabled || !this.allowSfx('levelup', .25, true)) return;
                try {
                    const notes = [440, 554.37, 659.25, 880];
                    notes.forEach((freq, idx) => {
                        const now = this.ctx.currentTime + idx * 0.07;
                        const osc = this.ctx.createOscillator();
                        const gain = this.ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(freq, now);

                        gain.gain.setValueAtTime(0.073, now);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

                        osc.connect(gain);
                        gain.connect(this.ctx.destination);
                        osc.start(now);
                        osc.stop(now + 0.22);
                    });
                } catch (e) {}
            }

            playJackpot() {
                if (!this.enabled || !this.allowSfx('jackpot', .24, true)) return;
                try {
                    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
                    notes.forEach((freq, idx) => {
                        const now = this.ctx.currentTime + idx * 0.055;
                        const osc = this.ctx.createOscillator();
                        const gain = this.ctx.createGain();
                        osc.type = 'sawtooth';
                        osc.frequency.setValueAtTime(freq, now);

                        gain.gain.setValueAtTime(0.06, now);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

                        osc.connect(gain);
                        gain.connect(this.ctx.destination);
                        osc.start(now);
                        osc.stop(now + 0.25);
                    });
                } catch (e) {}
            }
        }

        const audio = new SoundEngine();

        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');

        let gameState = 'MENU'; // MENU, PLAYING, LEVEL_UP, PAUSED, DYING_SEQUENCE, REVIVE_PROMPT, GAME_OVER
        let controlMode = 'HYBRID'; // HYBRID, KEYBOARD

        let savedHighScore = 0;
        let savedMaxWave = 1;
        let totalGold = 50;

        let metaUpgrades = {
            baseDamage: 0,
            maxHp: 0,
            speedDash: 0,
            greed: 0,
            defibrillator: 0
        };

        // A versioned save preserves the original single-file, offline playable build.
        const GRAPHICS_SAVE_KEY = 'neonCekirdek.graphics.v1';
        const GRAPHICS_PRESETS = Object.freeze({
            high: Object.freeze({ dprCap: 2, pixelBudget: 6000000, particleDrawRatio: 1, glowScale: 1, gridSpacing: 48, bossFxCap: 2 }),
            medium: Object.freeze({ dprCap: 1.4, pixelBudget: 3600000, particleDrawRatio: .68, glowScale: .45, gridSpacing: 64, bossFxCap: 1 }),
            low: Object.freeze({ dprCap: 1, pixelBudget: 1800000, particleDrawRatio: .35, glowScale: 0, gridSpacing: 96, bossFxCap: 0 })
        });
        let graphicsQuality = 'high';
        let canvasRenderInvalidated = true;
        function getGraphicsPreset() { return GRAPHICS_PRESETS[graphicsQuality]; }
        function getGraphicsBlur(value) { return value * getGraphicsPreset().glowScale; }
        function isValidGraphicsQuality(value) { return Object.hasOwn(GRAPHICS_PRESETS, value); }
        function applyGraphicsQuality(value, persist = true) {
            if (!isValidGraphicsQuality(value)) return false;
            const changed = graphicsQuality !== value;
            graphicsQuality = value;
            document.documentElement.dataset.graphicsQuality = value;
            for (const id of ['menuGraphicsQuality', 'pauseGraphicsQuality']) {
                const select = document.getElementById(id);
                if (select) select.value = value;
            }
            if (changed) {
                // Rebuild the backing store using the new render pixel budget.
                // World coordinates and all combat rules remain unchanged.
                resizeCanvas();
            }
            canvasRenderInvalidated = true;
            if (persist) {
                try { localStorage.setItem(GRAPHICS_SAVE_KEY, value); }
                catch (e) { console.warn('Grafik tercihi kaydedilemedi.', e); }
            }
            return true;
        }
        function loadGraphicsQuality() {
            let selected = 'high';
            try {
                const saved = localStorage.getItem(GRAPHICS_SAVE_KEY);
                if (isValidGraphicsQuality(saved)) selected = saved;
            } catch (e) { /* local file/storage restrictions must not block play */ }
            applyGraphicsQuality(selected, false);
        }

        const META_SAVE_KEY = 'neonCekirdek.meta.v1';
        const META_SAVE_VERSION = 1;
        const META_UPGRADE_LIMITS = { baseDamage: 10, maxHp: 10, speedDash: 8, greed: 8, defibrillator: 3 };

        function safeSaveInteger(value, fallback, max = 1000000000) {
            return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
        }

        function loadMetaProgress() {
            try {
                const stored = localStorage.getItem(META_SAVE_KEY);
                if (!stored) return;
                const data = JSON.parse(stored);
                if (!data || typeof data !== 'object' || data.version !== META_SAVE_VERSION) return;
                savedHighScore = safeSaveInteger(data.highScore, savedHighScore);
                savedMaxWave = Math.max(1, safeSaveInteger(data.maxWave, savedMaxWave, 100000));
                totalGold = safeSaveInteger(data.gold, totalGold);
                if (data.upgrades && typeof data.upgrades === 'object') {
                    for (const [key, max] of Object.entries(META_UPGRADE_LIMITS)) {
                        metaUpgrades[key] = safeSaveInteger(data.upgrades[key], metaUpgrades[key], max);
                    }
                }
            } catch (error) {
                // Corrupt saves, disabled storage and file:// privacy restrictions must not block play.
                console.warn('Meta kayıt okunamadı, varsayılan değerlerle devam ediliyor.', error);
            }
        }

        function saveMetaProgress() {
            try {
                localStorage.setItem(META_SAVE_KEY, JSON.stringify({
                    version: META_SAVE_VERSION,
                    highScore: savedHighScore,
                    maxWave: savedMaxWave,
                    gold: totalGold,
                    upgrades: { ...metaUpgrades }
                }));
            } catch (error) {
                console.warn('Meta kayıt yazılamadı; bu oturum devam edebilir.', error);
            }
            updateMenuCounters();
        }

        // Portable backup is an explicit, local-only alternative to unavailable cloud sync.
        // Only meta progression and the graphics preference are exported. No raw telemetry,
        // identity or learned model weights are included.
        const PROGRESS_BACKUP_FORMAT = 'neon-cekirdek-progress';
        const PROGRESS_BACKUP_VERSION = 1;
        const PROGRESS_BACKUP_MAX_BYTES = 16384;

        function createProgressBackup() {
            return {
                format: PROGRESS_BACKUP_FORMAT,
                version: PROGRESS_BACKUP_VERSION,
                exportedAt: new Date().toISOString(),
                progress: {
                    version: META_SAVE_VERSION,
                    highScore: savedHighScore,
                    maxWave: savedMaxWave,
                    gold: totalGold,
                    upgrades: { ...metaUpgrades }
                },
                graphics: graphicsQuality
            };
        }

        function parseProgressBackup(raw) {
            if (typeof raw !== 'string' || raw.length > PROGRESS_BACKUP_MAX_BYTES) return null;
            try {
                const backup = JSON.parse(raw);
                if (!backup || backup.format !== PROGRESS_BACKUP_FORMAT ||
                    backup.version !== PROGRESS_BACKUP_VERSION ||
                    !isValidGraphicsQuality(backup.graphics)) return null;
                const data = backup.progress;
                if (!data || data.version !== META_SAVE_VERSION || !data.upgrades ||
                    typeof data.upgrades !== 'object') return null;
                const limits = { highScore: 1000000000, maxWave: 100000, gold: 1000000000 };
                for (const [key, maximum] of Object.entries(limits)) {
                    if (!Number.isSafeInteger(data[key]) || data[key] < (key === 'maxWave' ? 1 : 0) ||
                        data[key] > maximum) return null;
                }
                const upgrades = {};
                for (const [key, maximum] of Object.entries(META_UPGRADE_LIMITS)) {
                    const level = data.upgrades[key];
                    if (!Number.isSafeInteger(level) || level < 0 || level > maximum) return null;
                    upgrades[key] = level;
                }
                return {
                    progress: {
                        version: META_SAVE_VERSION,
                        highScore: data.highScore,
                        maxWave: data.maxWave,
                        gold: data.gold,
                        upgrades
                    },
                    graphics: backup.graphics
                };
            } catch (error) {
                return null;
            }
        }

        function restoreProgressBackup(raw) {
            const backup = parseProgressBackup(raw);
            // Never replace persistent progress during an active run.
            if (!backup || gameState !== 'MENU') return false;
            let oldMeta, oldGraphics;
            try {
                oldMeta = localStorage.getItem(META_SAVE_KEY);
                oldGraphics = localStorage.getItem(GRAPHICS_SAVE_KEY);
                localStorage.setItem(META_SAVE_KEY, JSON.stringify(backup.progress));
                localStorage.setItem(GRAPHICS_SAVE_KEY, backup.graphics);
            } catch (error) {
                // If one write fails, make a best-effort rollback before touching live state.
                try {
                    if (oldMeta !== undefined) {
                        if (oldMeta === null) localStorage.removeItem(META_SAVE_KEY);
                        else localStorage.setItem(META_SAVE_KEY, oldMeta);
                    }
                    if (oldGraphics !== undefined) {
                        if (oldGraphics === null) localStorage.removeItem(GRAPHICS_SAVE_KEY);
                        else localStorage.setItem(GRAPHICS_SAVE_KEY, oldGraphics);
                    }
                } catch (rollbackError) {
                    console.warn('Kayıt geri alma girişimi tamamlanamadı.', rollbackError);
                }
                console.warn('Yedek geri yüklenemedi; oturumdaki ilerleme korundu.', error);
                return false;
            }

            savedHighScore = backup.progress.highScore;
            savedMaxWave = backup.progress.maxWave;
            totalGold = backup.progress.gold;
            metaUpgrades = { ...backup.progress.upgrades };
            applyGraphicsQuality(backup.graphics, false);
            updateMenuCounters();
            return true;
        }

        const META_SHOP_ITEMS = [
            {
                key: 'baseDamage',
                name: 'Başlangıç Hasarı',
                icon: 'fa-solid fa-crosshairs',
                color: '#ff007f',
                desc: 'Her kademe başlangıç plazma hasarını +%8 ve kritik şansını +%1,2 artırır.',
                baseCost: 25,
                costScale: 1.65,
                maxLevel: 10
            },
            {
                key: 'maxHp',
                name: 'Maksimum Zırh',
                icon: 'fa-solid fa-heart-pulse',
                color: '#00ff66',
                desc: 'Her kademe maksimum çekirdek canını +18 artırır.',
                baseCost: 20,
                costScale: 1.55,
                maxLevel: 10
            },
            {
                key: 'speedDash',
                name: 'Hız & Atılım Motoru',
                icon: 'fa-solid fa-bolt',
                color: '#00f3ff',
                desc: 'Her kademe hareket hızını +%4 artırır ve Dash dolum süresini %4 azaltır.',
                baseCost: 30,
                costScale: 1.65,
                maxLevel: 8
            },
            {
                key: 'greed',
                name: 'Altın & XP Çarpanı',
                icon: 'fa-solid fa-coins',
                color: '#ffe600',
                desc: 'Her kademe kazanılan XP ve Altın Çekirdek miktarını +%12 artırır.',
                baseCost: 35,
                costScale: 1.75,
                maxLevel: 8
            },
            {
                key: 'defibrillator',
                name: 'Yedek Defibrilatör Şarjı',
                icon: 'fa-solid fa-heart-circle-bolt',
                color: '#10b981',
                desc: 'Her kademe operasyon başına +1 Ücretsiz Acil Durum Diriliş hakkı ekler.',
                baseCost: 60,
                costScale: 2.2,
                maxLevel: 3
            }
        ];

        let selectedChassis = 'VANGUARD';
        const NEON_CONTRACTS = Object.freeze([
            Object.freeze({id:'STANDARD',label:'STANDART PROTOKOL',short:'GÜVENLİ',color:'#67e8f9',desc:'Mevcut denge. Öğrenmek ve build kurmak için temiz başlangıç.',enemySpeedMult:1,scoreMultiplier:1}),
            Object.freeze({id:'REDLINE',label:'REDLINE / KIZIL HAT',short:'RİSK',color:'#ff5268',desc:'Normal düşmanlar %8 daha hızlı gelir; skor kazancı %22 artar.',enemySpeedMult:1.08,scoreMultiplier:1.22}),
            Object.freeze({id:'BLACKOUT',label:'BLACKOUT / KARA KUTU',short:'GİZEM',color:'#b678ff',desc:'Özel formasyonlar bir dalga erken açılır; skor kazancı %16 artar.',enemySpeedMult:1,scoreMultiplier:1.16}),
            Object.freeze({id:'OVERCHARGE',label:'OVERCHARGE / AŞIRI YÜK',short:'GÜÇ',color:'#ffd166',desc:'Oyuncu ateş temposu %7 hızlanır; düşman mermileri %10 hızlıdır.',enemySpeedMult:1,scoreMultiplier:1.18})
        ]);
        let selectedContractId = 'STANDARD';
        let activeContractId = 'STANDARD';
        const CONTRACT_MASTERY_SAVE_KEY = 'neonCekirdek.contractMastery.v1';
        const CONTRACT_MASTERY_VERSION = 1;
        function createEmptyContractMastery() {
            return {
                version: CONTRACT_MASTERY_VERSION,
                contracts: Object.fromEntries(NEON_CONTRACTS.map(contract => [contract.id, {
                    runs: 0, bestWave: 0, bestScore: 0, bestDurationSeconds: 0
                }]))
            };
        }
        function sanitizeContractMastery(data) {
            const empty = createEmptyContractMastery();
            if (!data || data.version !== CONTRACT_MASTERY_VERSION ||
                !data.contracts || typeof data.contracts !== 'object') return empty;
            for (const contract of NEON_CONTRACTS) {
                const raw = data.contracts[contract.id];
                if (!raw || typeof raw !== 'object') continue;
                empty.contracts[contract.id] = {
                    runs: safeSaveInteger(raw.runs, 0, 1000000),
                    bestWave: safeSaveInteger(raw.bestWave, 0, 100000),
                    bestScore: safeSaveInteger(raw.bestScore, 0, 1000000000),
                    bestDurationSeconds: Number.isFinite(raw.bestDurationSeconds) &&
                        raw.bestDurationSeconds >= 0 ? Math.min(86400, raw.bestDurationSeconds) : 0
                };
            }
            return empty;
        }
        let contractMastery = createEmptyContractMastery();
        let contractMasteryRecordedThisRun = false;
        function loadContractMastery() {
            try {
                const stored = localStorage.getItem(CONTRACT_MASTERY_SAVE_KEY);
                if (stored) contractMastery = sanitizeContractMastery(JSON.parse(stored));
            } catch (error) {
                contractMastery = createEmptyContractMastery();
                console.warn('Sözleşme ustalığı okunamadı.', error);
            }
        }
        function saveContractMastery() {
            try {
                localStorage.setItem(CONTRACT_MASTERY_SAVE_KEY, JSON.stringify(contractMastery));
                return true;
            } catch (error) {
                console.warn('Sözleşme ustalığı kaydedilemedi; koşu devam ediyor.', error);
                return false;
            }
        }
        function getContractMasterySnapshot() {
            return JSON.parse(JSON.stringify(contractMastery.contracts));
        }
        function getContractMasteryTier(entry) {
            const bestWave = entry?.bestWave || 0;
            return bestWave >= 24 ? 3 : bestWave >= 16 ? 2 : bestWave >= 8 ? 1 : 0;
        }
        function recordContractMastery(report) {
            if (contractMasteryRecordedThisRun || !report?.contract ||
                (report.result?.durationSeconds < 30 || report.result?.wave < 3)) return false;
            const entry = contractMastery.contracts[report.contract.id];
            if (!entry) return false;
            entry.runs++;
            entry.bestWave = Math.max(entry.bestWave, report.result.wave || 0);
            entry.bestScore = Math.max(entry.bestScore, report.result.score || 0);
            entry.bestDurationSeconds = Math.max(entry.bestDurationSeconds,
                Math.min(86400, report.result.durationSeconds || 0));
            contractMasteryRecordedThisRun = true;
            saveContractMastery();
            updateMenuCounters();
            return true;
        }
        window.getNeonContractMastery = () => getContractMasterySnapshot();
        function getNeonContractList() { return NEON_CONTRACTS.map(contract => ({...contract})); }
        function getActiveNeonContract() {
            return NEON_CONTRACTS.find(contract => contract.id === activeContractId) || NEON_CONTRACTS[0];
        }
        function selectNeonContract(id) {
            if (!NEON_CONTRACTS.some(contract => contract.id === id)) return false;
            selectedContractId = id;
            const cards = document.querySelectorAll?.('[data-neon-contract]') || [];
            for (const card of cards) {
                const active = card.getAttribute('data-neon-contract') === id;
                card.classList.toggle('is-selected', active);
                card.setAttribute('aria-pressed', active ? 'true' : 'false');
            }
            return true;
        }
        let currentUpgradeChoices = [];

        let viewScale = 1;
        let currentDpr = 1;
        let worldWidth = window.innerWidth;
        let worldHeight = window.innerHeight;

        const keys = {};
        const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false };

        let score = 0;
        let sessionGold = 0;
        let combo = 1;
        let comboTimer = 0;
        const COMBO_MAX_TIME = 3.8;
        let wave = 1;
        let waveTimer = 0;
        let totalTime = 0;
        let nextBossTime = 55;
        let bossEncounterCount = 0;
        let activeBosses = [];
        let manualBossTarget = null;
        let bossWarningTimer = 0;
        let kills = 0;
        let screenShake = 0;
        let hitStopTimer = 0;
        let slowMoTimer = 0;
        let bannerHideTimer = 0;
        let rerollCost = 15;
        let dyingSequenceTimer = 0;
        let reviveCountUsed = 0;
        let paidRevivesUsed = 0;
        // Run-only metrics are counted at the actual event, not inferred afterward.
        let runMetrics={peakCombo:1,damageTaken:0,hitsTaken:0,shieldBlocks:0,
            freeRevivesUsed:0,paidReviveGoldSpent:0,paidRevivesUsed:0};
        let finalRunReport=null;
        let activeReportTab='summary';
        let gridOffset = { x: 0, y: 0 };

        function cycleBossTarget(direction = 1) {
            const living = activeBosses.filter(b => b && !b.dead);
            if (!living.length) {
                manualBossTarget = null;
                if (player) player.lockedTarget = null;
                return null;
            }
            const current = living.indexOf(manualBossTarget);
            const step = direction < 0 ? -1 : 1;
            if (current < 0) {
                manualBossTarget = living[step > 0 ? 0 : living.length - 1];
                if (player) player.lockedTarget = manualBossTarget;
                return manualBossTarget;
            }
            const start = current;
            const next = (start + step + living.length) % living.length;
            manualBossTarget = living[next];
            if (player) {
                player.lockedTarget = manualBossTarget;
                player.aimAngle = Math.atan2(manualBossTarget.y - player.y,
                    manualBossTarget.x - player.x);
            }
            return manualBossTarget;
        }

        let menuDemoNodes = [];
        function initMenuDemoNodes() {
            menuDemoNodes = [];
            for (let i = 0; i < 22; i++) {
                menuDemoNodes.push({
                    x: Math.random() * worldWidth,
                    y: Math.random() * worldHeight,
                    vx: (Math.random() - 0.5) * 90,
                    vy: (Math.random() - 0.5) * 90,
                    r: Math.random() * 10 + 6,
                    sides: [3, 4, 6][i % 3],
                    rot: Math.random() * Math.PI * 2,
                    color: ['#00f3ff', '#ff007f', '#b000ff', '#00ff66'][i % 4]
                });
            }
        }


        // M5.2 tactical missions: objectives are selected only if the run can satisfy them.
        const QUEST_LABELS=Object.freeze({
            KILLS:'AV',ORBS:'KÜRE',COMBO:'KOMBO',ELITE_HUNT:'ELİT AV',
            CHAIN:'ZİNCİR',NO_HIT:'HASARSIZ',DEFEND:'SAVUN',RESCUE:'KURTAR'
        });
        const QUEST_COLORS=Object.freeze({
            KILLS:'#75f7ac',ORBS:'#74e5ff',COMBO:'#ffc36b',
            ELITE_HUNT:'#ffe08a',CHAIN:'#9fc4ff',NO_HIT:'#d4b3ff',
            DEFEND:'#65f7dc',RESCUE:'#ffacb8'
        });
        let activeQuest={type:'KILLS',target:15,progress:0,rewardGold:20,desc:'15 Düşman İmha Et'};
        let questHistory=[];
        let questStats={offered:0,completed:0,byType:{},hitsReset:0};
        let questHudPrevious='';

        function getQuestCandidates(currentWave=wave,hasChain=!!player?.chainLightning){
            const options=['KILLS','ORBS','COMBO'];
            if(currentWave>=2) options.push('NO_HIT','RESCUE');
            if(currentWave>=3) options.push('DEFEND');
            if(currentWave>=4) options.push('ELITE_HUNT');
            if(currentWave>=3&&hasChain) options.push('CHAIN');
            return options;
        }
        function chooseQuestType(available,history=questHistory,roll=Math.random()){
            const fresh=available.filter(type=>!history.slice(-2).includes(type));
            const pool=fresh.length?fresh:available;
            return pool[Math.min(pool.length-1,Math.floor(Math.max(0,roll)*pool.length))];
        }
        function getQuestPoint(fromX=player?.x||worldWidth/2,fromY=player?.y||worldHeight/2){
            const angle=Math.random()*Math.PI*2;
            const distance=140+Math.random()*80;
            return {
                x:Math.max(65,Math.min(worldWidth-65,fromX+Math.cos(angle)*distance)),
                y:Math.max(65,Math.min(worldHeight-65,fromY+Math.sin(angle)*distance))
            };
        }
        function createQuest(type,currentWave=wave){
            let target=1,desc='',progress=0;
            const advanced=['ELITE_HUNT','CHAIN','NO_HIT','DEFEND','RESCUE'].includes(type);
            if(type==='KILLS'){target=Math.min(125,14+currentWave*4);desc=target+' DÜŞMAN İMHA';}
            else if(type==='ORBS'){target=Math.min(130,18+currentWave*4);desc=target+' XP KÜRESİ TOPLA';}
            else if(type==='COMBO'){target=Math.min(45,10+currentWave*3);desc='x'+target+' KOMBOYA ULAŞ';progress=combo;}
            else if(type==='ELITE_HUNT'){target=currentWave<9?1:2;desc=target+' ELİT HEDEFİ AVLA';}
            else if(type==='CHAIN'){target=Math.min(10,3+Math.floor(currentWave/3));desc=target+' ZİNCİR SIÇRAMASI';}
            else if(type==='NO_HIT'){target=Math.min(24,12+Math.floor(currentWave/2));desc=target+' SN HASAR ALMA';}
            else if(type==='DEFEND'){target=5;desc='SİNYAL NOKTASINI SAVUN';}
            else if(type==='RESCUE'){target=2;desc='2 VERİ KAPSÜLÜNÜ KURTAR';}
            const quest={type,target,progress,rewardGold:Math.min(180,
                advanced?30+currentWave*5:18+currentWave*4),desc};
            if(type==='DEFEND'||type==='RESCUE') quest.point=getQuestPoint();
            if(type==='DEFEND') quest.radius=105;
            return quest;
        }
        function generateNextQuest(forcedType=null){
            const candidates=getQuestCandidates();
            const type=forcedType&&candidates.includes(forcedType)?forcedType:
                chooseQuestType(candidates);
            activeQuest=createQuest(type);
            questHistory.push(type);
            if(questHistory.length>3) questHistory.shift();
            questStats.offered++;
            questHudPrevious='';
            updateQuestHud();
            return activeQuest;
        }
        function completeQuest(){
            if(!activeQuest) return;
            const {type,rewardGold:goldWon}=activeQuest;
            questStats.completed++;
            questStats.byType[type]=(questStats.byType[type]||0)+1;
            totalGold+=goldWon;
            sessionGold+=goldWon;
            if(combatDirector) combatDirector.onGoldGranted('quests',goldWon);
            saveMetaProgress();
            audio.playJackpot();
            if(player){
                player.addOverdrive(25);
                createFloatingText(player.x,player.y-45,
                    'GÖREV TAMAMLANDI · +'+goldWon+' ALTIN',QUEST_COLORS[type],17);
            }
            showDopamineBanner('GÖREV · +'+goldWon+' ALTIN',QUEST_COLORS[type]);
            generateNextQuest();
        }
        function advanceQuest(type,amount=1){
            if(!activeQuest||activeQuest.type!==type||!Number.isFinite(amount)||amount<=0) return;
            if(type==='COMBO') activeQuest.progress=Math.max(activeQuest.progress,amount);
            else activeQuest.progress=Math.min(activeQuest.target,activeQuest.progress+amount);
            if(activeQuest.progress>=activeQuest.target) completeQuest();
            else updateQuestHud();
        }
        function resetFlawlessQuest(){
            if(activeQuest?.type!=='NO_HIT') return;
            activeQuest.progress=0;
            questStats.hitsReset++;
            updateQuestHud();
        }
        function updateQuest(dt){
            if(!activeQuest||!player||gameState!=='PLAYING'||dt<=0) return;
            const current=activeQuest;
            if(current.type==='NO_HIT') advanceQuest('NO_HIT',dt);
            else if(current.type==='DEFEND'&&current.point){
                const dist=Math.hypot(player.x-current.point.x,player.y-current.point.y);
                // Only an enemy contesting this zone counts as a real defense.
                const defending=dist<=current.radius &&
                    enemies.some(enemy=>!enemy.dead&&!enemy.isBoss &&
                        Number.isFinite(enemy.x)&&Number.isFinite(enemy.y) &&
                        Math.hypot(enemy.x-current.point.x,
                            enemy.y-current.point.y)<=current.radius+170);
                const value=Math.max(0,Math.min(current.target,current.progress+
                    (defending?dt:-dt*.65)));
                current.progress=value;
                if(value>=current.target) completeQuest();
                else updateQuestHud();
            } else if(current.type==='RESCUE'&&current.point){
                if(Math.hypot(player.x-current.point.x,player.y-current.point.y)<player.radius+23){
                    advanceQuest('RESCUE',1);
                    if(activeQuest===current) current.point=getQuestPoint(player.x,player.y);
                }
            }
        }
        function updateQuestHud(){
            if(!activeQuest) return;
            const q=activeQuest;
            const shown=Math.floor(q.progress);
            const content=QUEST_LABELS[q.type]+' · '+shown+'/'+q.target+' · +'+q.rewardGold;
            if(content===questHudPrevious) return;
            questHudPrevious=content;
            for(const id of ['questHudText','questMobileText']){
                const el=document.getElementById(id);
                if(el){el.textContent=content;el.title=q.desc;
                    el.style.color=QUEST_COLORS[q.type];}
            }
        }
        function drawQuestObjective(ctx){
            const q=activeQuest;
            if(!q?.point||gameState!=='PLAYING') return;
            const zone=q.type==='DEFEND',radius=zone?q.radius:23;
            ctx.save();ctx.globalAlpha=.85;
            ctx.strokeStyle=QUEST_COLORS[q.type];
            ctx.fillStyle=zone?'rgba(55,225,195,.10)':'rgba(255,125,155,.17)';
            ctx.lineWidth=zone?3:2;
            ctx.setLineDash(zone?[12,7]:[5,4]);
            ctx.beginPath();ctx.arc(q.point.x,q.point.y,radius,0,Math.PI*2);
            ctx.fill();ctx.stroke();ctx.setLineDash([]);
            if(zone){
                ctx.beginPath();
                ctx.arc(q.point.x,q.point.y,radius+7,-Math.PI/2,
                    -Math.PI/2+2*Math.PI*q.progress/q.target);
                ctx.lineWidth=4;ctx.stroke();
            }
            ctx.font="bold 12px 'Orbitron',sans-serif";
            ctx.textAlign='center';ctx.fillStyle=QUEST_COLORS[q.type];
            ctx.fillText(zone?'SAVUN':'KURTAR',q.point.x,q.point.y-radius-13);
            ctx.restore();
        }
        window.getNeonQuestSnapshot=()=>activeQuest?{
            type:activeQuest.type,description:activeQuest.desc,
            progress:Math.round(activeQuest.progress*10)/10,target:activeQuest.target,
            rewardGold:activeQuest.rewardGold,
            point:activeQuest.point?{...activeQuest.point}:null,
            eligible:getQuestCandidates(),history:[...questHistory],
            stats:{...questStats,byType:{...questStats.byType}}
        }:null;

        function showDopamineBanner(text, borderColor = '#ffe600') {
            const banner = document.getElementById('killstreakBanner');
            const badge = document.getElementById('killstreakBadge');
            badge.textContent = text;
            badge.style.borderColor = borderColor;
            badge.style.color = borderColor;
            banner.classList.remove('hidden');
            bannerHideTimer = 2.4;
        }

        class Player {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.lastPos = { x, y };
                this.vx = 0;
                this.vy = 0;
                this.radius = 16;
                this.chassis = selectedChassis;
                this.color = this.chassis === 'PHANTOM' ? '#ff007f' : (this.chassis === 'TITAN' ? '#00ff66' : '#00f3ff');

                const dmgBonus = 1 + metaUpgrades.baseDamage * 0.08;
                const hpBonus = metaUpgrades.maxHp * 18;
                const spdBonus = 1 + metaUpgrades.speedDash * 0.04;
                const dashCdReduction = 1 - metaUpgrades.speedDash * 0.04;
                this.greedBonus = 1 + metaUpgrades.greed * 0.12;

                this.speed = 285 * spdBonus;

                this.momentum = 0;
                this.kineticSparkTimer = 0;
                this.hasteTimer = 0;

                this.maxHp = 100 + hpBonus;
                this.hp = this.maxHp;
                this.invulnTimer = 0;
                this.hasShield = false;
                this.shieldActive = false;
                this.shieldCooldown = 0;
                this.shieldMaxCooldown = 12;
                this.freeRevives = 1 + (metaUpgrades.defibrillator || 0);

                this.damage = 13 * dmgBonus;
                this.critChance = 0.04 + metaUpgrades.baseDamage * 0.012;
                this.fireDelay = 0.46 * (activeContractId === 'OVERCHARGE' ? 0.93 : 1);
                this.fireTimer = 0;
                this.shotCounter = 0;
                this.bulletSpeed = 580;
                this.bulletSize = 5;
                this.multishot = 1;
                this.pierce = 1;
                this.ricochet = 0;
                this.homingMissiles = 0;
                this.chainLightning = 0;
                this.vampiricHeal = 0;
                this.muzzleFlash = 0;
                this.missileLaunchFlash = 0;
                this.aimAngle = 0;
                this.lockedTarget = null;

                // Overdrive Nerfed & Upgradable stats
                this.overdrive = 0;
                this.overdriveActive = false;
                this.overdriveTimer = 0;
                this.overdriveMaxDuration = 5.0;
                this.overdriveGainMult = 0.75;
                this.overdriveFireRateMult = 1.65;
                this.overdriveCritBonus = 0.15;

                this.orbitals = 0;
                this.orbitalAngle = 0;
                this.orbitalSpeed = 3.2;
                this.orbitalRadius = 68;

                this.isDashing = false;
                this.dashTimer = 0;
                this.dashDuration = 0.18;
                this.dashSpeed = 1120;
                this.dashDir = { x: 1, y: 0 };
                this.dashCooldown = 0;
                this.dashMaxCooldown = Math.max(1.1, 2.5 * dashCdReduction);

                this.novaCooldown = 0;
                this.novaMaxCooldown = 10.0;

                this.level = 1;
                this.xp = 0;
                this.xpToNext = 125;
                this.xpMultiplier = this.greedBonus;
                this.magnetRadius = 85;

                if (this.chassis === 'VANGUARD') {
                    this.damage *= 1.12;
                    this.freeRevives += 1;
                } else if (this.chassis === 'PHANTOM') {
                    this.speed *= 1.15;
                    this.critChance += 0.15;
                    this.dashMaxCooldown *= 0.8;
                    this.pierce += 1;
                    this.ricochet += 1;
                } else if (this.chassis === 'TITAN') {
                    this.maxHp += 50;
                    this.hp = this.maxHp;
                    this.hasShield = true;
                    this.shieldActive = true;
                    this.orbitals = 1;
                }

                this.trail = [];
                this.upgradeCounts = {};
                this.evolutions = new Set();
                this.synergies = new Set();
                this.evolutionPulseTimer = 5.5;
                this.buildStats = { railShots: 0, clusterBursts: 0, arcSurges: 0,
                    orbitalPulses: 0, aegisPulses: 0, prismBounces: 0,
                    reactorBursts: 0, overdriveDischarges: 0, weakpointMarks: 0,
                    bloodReactorHeals: 0, aegisDeflections: 0, kineticVortices: 0,
                    phaseEchoes: 0, phaseEchoTargets: 0,
                    circuitClosures: 0, circuitPulseHits: 0, circuitCrossings: 0 };
                this.bloodReactorKills = 0;
                this.bloodReactorReadyAt = 0;
                this.kineticVortexReadyAt = 0;
                this.phaseEchoReadyAt = 0;
                this.phaseEchoOrigin = null;
                this.circuitTrace = [];
                this.circuitLength = 0;
                this.circuitStartedAt = 0;
                this.circuitReadyAt = 0;
            }

            refreshBuildTraits() {
                this.evolutions = new Set(Object.keys(EVOLUTION_DEFS).filter(
                    id => (this.upgradeCounts[id] || 0) >= 3));
                this.synergies = new Set(SYNERGY_DEFS.filter(syn =>
                    syn.modules.every(id => (this.upgradeCounts[id] || 0) >= 2)).map(syn => syn.id));
            }

            addOverdrive(amount) {
                if (this.overdriveActive) return;
                this.overdrive = Math.min(100, this.overdrive + amount * this.overdriveGainMult);
                if (this.overdrive >= 100) {
                    this.overdriveActive = true;
                    this.overdriveTimer = this.overdriveMaxDuration;
                    screenShake = 12;
                    audio.playJackpot();
                    shockwaves.push(new Shockwave(this.x, this.y, 220, '#ff007f', 0.4));
                    emitMotionFx('OVERDRIVE',this.x,this.y,{radius:145});
                    showDopamineBanner('SİBER CİNNET', '#ff007f');
                    document.getElementById('overdriveOverlay').classList.remove('hidden');
                    if (this.evolutions.has('overdrive_boost')) {
                        // Once per Overdrive activation, never once per frame.
                        let cleared = 0;
                        for (const projectile of enemyProjectiles) {
                            if (cleared >= 12) break;
                            if (!projectile.dead && Math.hypot(projectile.x - this.x, projectile.y - this.y) < 185) {
                                projectile.dead = true;
                                cleared++;
                            }
                        }
                        this.buildStats.overdriveDischarges++;
                        shockwaves.push(new Shockwave(this.x, this.y, 185, '#ff007f', 0.45));
                    }
                }
            }

            update(dt) {
                const circuitWasDashing = this.isDashing;
                if (this.invulnTimer > 0) this.invulnTimer -= dt;
                if (this.dashCooldown > 0) this.dashCooldown = Math.max(0, this.dashCooldown - dt);
                if (this.novaCooldown > 0) this.novaCooldown = Math.max(0, this.novaCooldown - dt);
                if (this.muzzleFlash > 0) this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 10);
                if (this.missileLaunchFlash > 0)
                    this.missileLaunchFlash = Math.max(0, this.missileLaunchFlash - dt * 6);
                if (this.hasteTimer > 0) this.hasteTimer = Math.max(0, this.hasteTimer - dt);

                if (this.overdriveActive) {
                    this.overdriveTimer -= dt;
                    this.overdrive = Math.max(0, (this.overdriveTimer / this.overdriveMaxDuration) * 100);
                    if (Math.random() < 0.55) {
                        emitParticle(new Particle(
                            this.x + (Math.random() - 0.5) * 22,
                            this.y + (Math.random() - 0.5) * 22,
                            (Math.random() - 0.5) * 80,
                            (Math.random() - 0.5) * 80,
                            Math.random() < 0.5 ? '#ff007f' : '#ffe600',
                            3,
                            0.22
                        ));
                    }
                    if (this.overdriveTimer <= 0) {
                        this.overdriveActive = false;
                        this.overdrive = 0;
                        document.getElementById('overdriveOverlay').classList.add('hidden');
                    }
                }

                if (this.hasShield && !this.shieldActive) {
                    this.shieldCooldown -= dt * (this.synergies.has('orbital_aegis') ? 1.12 : 1);
                    if (this.shieldCooldown <= 0) {
                        this.shieldActive = true;
                        createFloatingText(this.x, this.y - 25, 'KALKAN AKTİF!', '#00f3ff', 15);
                    }
                }

                if (this.isDashing) {
                    this.dashTimer -= dt;
                    this.x += this.dashDir.x * this.dashSpeed * dt;
                    this.y += this.dashDir.y * this.dashSpeed * dt;

                    for (let i = 0; i < 2; i++) {
                        emitParticle(new Particle(
                            this.x + (Math.random() - 0.5) * 14,
                            this.y + (Math.random() - 0.5) * 14,
                            -this.dashDir.x * 160 + (Math.random() - 0.5) * 60,
                            -this.dashDir.y * 160 + (Math.random() - 0.5) * 60,
                            '#00f3ff',
                            Math.random() * 4 + 2,
                            0.28
                        ));
                    }

                    if (this.dashTimer <= 0) {
                        this.isDashing = false;
                        deployPhaseEcho(this, this.phaseEchoOrigin);
                        this.phaseEchoOrigin = null;
                        if (this.evolutions.has('kinetic_magnet') && totalTime >= this.kineticVortexReadyAt) {
                            this.kineticVortexReadyAt = totalTime + 4;
                            this.buildStats.kineticVortices++;
                            shockwaves.push(new Shockwave(this.x, this.y, 160, '#38bdf8', 0.35));
                            let disrupted = 0;
                            for (const target of enemies) {
                                if (target.dead || disrupted >= 8) continue;
                                const dx = target.x - this.x, dy = target.y - this.y;
                                const dist = Math.hypot(dx, dy);
                                if (dist > 160) continue;
                                target.takeDamage(this.damage * 0.45,
                                    dx / (dist || 1) * 220, dy / (dist || 1) * 220, false, false);
                                disrupted++;
                            }
                            for (const orb of orbs) {
                                if (Math.hypot(orb.x - this.x, orb.y - this.y) <= 240) orb.magnetized = true;
                            }
                        }
                    }
                } else {
                    let kx = 0, ky = 0;
                    if (keys['KeyW'] || keys['ArrowUp']) ky -= 1;
                    if (keys['KeyS'] || keys['ArrowDown']) ky += 1;
                    if (keys['KeyA'] || keys['ArrowLeft']) kx -= 1;
                    if (keys['KeyD'] || keys['ArrowRight']) kx += 1;

                    const spdMult = (this.overdriveActive ? 1.2 : 1.0) * (this.hasteTimer > 0 ? 1.25 : 1.0);

                    if (kx !== 0 || ky !== 0) {
                        const len = Math.hypot(kx, ky);
                        kx /= len;
                        ky /= len;
                        this.vx = kx * this.speed * spdMult;
                        this.vy = ky * this.speed * spdMult;
                        this.x += this.vx * dt;
                        this.y += this.vy * dt;
                        this.dashDir = { x: kx, y: ky };
                    } else if (controlMode === 'HYBRID' && mouse.active) {
                        const dx = mouse.x - this.x;
                        const dy = mouse.y - this.y;
                        const dist = Math.hypot(dx, dy);
                        if (dist > 6) {
                            const dirX = dx / dist;
                            const dirY = dy / dist;
                            const moveSpd = Math.min(this.speed * spdMult, dist * 7.5);
                            this.vx = dirX * moveSpd;
                            this.vy = dirY * moveSpd;
                            this.x += this.vx * dt;
                            this.y += this.vy * dt;
                            this.dashDir = { x: dirX, y: dirY };
                        } else {
                            this.vx = 0;
                            this.vy = 0;
                        }
                    } else {
                        this.vx = 0;
                        this.vy = 0;
                    }
                }

                this.x = Math.max(this.radius, Math.min(worldWidth - this.radius, this.x));
                this.y = Math.max(this.radius, Math.min(worldHeight - this.radius, this.y));

                const movedDist = Math.hypot(this.x - this.lastPos.x, this.y - this.lastPos.y);
                const moveRatio = movedDist / Math.max(1, this.speed * dt);
                this.lastPos.x = this.x;
                this.lastPos.y = this.y;
                recordCircuitWeaverMotion(this, movedDist, circuitWasDashing);

                if (moveRatio > 0.25 || this.isDashing) {
                    this.momentum = Math.min(100, this.momentum + dt * (this.isDashing ? 95 : 28));
                } else {
                    this.momentum = Math.max(0, this.momentum - dt * 16);
                }

                if (this.momentum >= 80 && moveRatio > 0.25) {
                    this.kineticSparkTimer -= dt;
                    if (this.kineticSparkTimer <= 0) {
                        this.kineticSparkTimer = 0.38;
                        let nearEnemy = null;
                        let nearDist = 230;
                        for (const e of enemies) {
                            const d = Math.hypot(e.x - this.x, e.y - this.y);
                            if (d < nearDist) {
                                nearDist = d;
                                nearEnemy = e;
                            }
                        }
                        if (nearEnemy) {
                            nearEnemy.takeDamage(this.damage * 0.55, 0, 0, true, false);
                            emitLightningArc(this.x, this.y, nearEnemy.x, nearEnemy.y);
                        }
                    }
                }

                this.trail.push({ x: this.x, y: this.y, r: this.radius });
                if (this.trail.length > 10) this.trail.shift();

                this.orbitalAngle += this.orbitalSpeed * dt * (this.overdriveActive ? 1.4 : 1.0);
                if (this.evolutions.has('orbital') && this.orbitals > 0) {
                    this.evolutionPulseTimer -= dt;
                    if (this.evolutionPulseTimer <= 0) {
                        this.evolutionPulseTimer += 6;
                        this.buildStats.orbitalPulses++;
                        shockwaves.push(new Shockwave(this.x, this.y, 145, '#ffe600', 0.4));
                        for (const target of enemies) {
                            if (target.dead) continue;
                            if (Math.hypot(target.x - this.x, target.y - this.y) <= 145) {
                                target.takeDamage(this.damage * 0.62, 0, 0, false, false);
                            }
                        }
                    }
                }

                const odFireBonus = this.overdriveActive ? this.overdriveFireRateMult : 1.0;
                this.fireTimer -= dt * (1 + (this.momentum / 100) * 0.3) * odFireBonus * (this.hasteTimer > 0 ? 1.2 : 1.0);
                if (this.fireTimer <= 0 && enemies.length > 0) {
                    this.autoShoot();
                    this.fireTimer = this.fireDelay;
                }
            }

            autoShoot() {
                let closest = null;
                let minDist = Infinity;
                for (const e of enemies) {
                    const d = Math.hypot(e.x - this.x, e.y - this.y);
                    if (d < minDist) {
                        minDist = d;
                        closest = e;
                    }
                }

                if (manualBossTarget && (manualBossTarget.dead || !activeBosses.includes(manualBossTarget))) {
                    manualBossTarget = null;
                }
                let target = closest;
                if (manualBossTarget && !manualBossTarget.dead) {
                    const manualDist = Math.hypot(manualBossTarget.x - this.x,
                        manualBossTarget.y - this.y);
                    if (manualDist < 540) {
                        target = manualBossTarget;
                        minDist = manualDist;
                    }
                }

                this.lockedTarget = (target && minDist <= 540) ? target : null;
                if (!target || minDist > 540) return;

                this.shotCounter++;
                // One sound per fired salvo even if multiple weapon modules fire.
                let shotSoundFamily=this.evolutions.has('pierce_ricochet')?'prism':'plasma';
                const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
                this.aimAngle = baseAngle;
                this.muzzleFlash = 1.0;

                const spread = 0.16;
                const startAngle = baseAngle - ((this.multishot - 1) * spread) / 2;
                const effectiveCrit = Math.min(0.78, this.critChance +
                    (this.overdriveActive ? this.overdriveCritBonus : 0) + (this.momentum / 100) * 0.1);
                const isCrit = Math.random() < effectiveCrit;
                const finalDamage = isCrit ? this.damage * 2.0 : this.damage;

                for (let i = 0; i < this.multishot; i++) {
                    const angle = startAngle + i * spread;
                    const shell = new Bullet(
                        this.x + Math.cos(angle) * 14,
                        this.y + Math.sin(angle) * 14,
                        Math.cos(angle) * this.bulletSpeed,
                        Math.sin(angle) * this.bulletSpeed,
                        finalDamage,
                        this.bulletSize + (isCrit ? 2 : 0),
                        this.pierce + (isCrit && this.synergies.has('prism_optics') ? 1 : 0),
                        this.ricochet + (isCrit && this.synergies.has('prism_optics') ? 1 : 0),
                        isCrit,
                        false
                    );
                    if (this.evolutions.has('pierce_ricochet')) shell.prismEvolved = true;
                    if (bullets.length < MAX_PLAYER_PROJECTILES) bullets.push(shell);
                }

                if (this.evolutions.has('firerate') && this.shotCounter % 5 === 0 &&
                    bullets.length <= 245) {
                    for (const deviation of [-0.27, 0.27]) {
                        const a = baseAngle + deviation;
                        const pulse = new Bullet(this.x, this.y,
                            Math.cos(a) * this.bulletSpeed * 1.1,
                            Math.sin(a) * this.bulletSpeed * 1.1,
                            this.damage * 0.50, 4, 1, 0, false, false);
                        pulse.reactorPulse = true;
                        bullets.push(pulse);
                    }
                    this.buildStats.reactorBursts++;
                    shotSoundFamily='reactor';
                }

                if (this.evolutions.has('multishot') && this.shotCounter % 4 === 0 &&
                    bullets.length < MAX_PLAYER_PROJECTILES) {
                    const rail = new Bullet(this.x + Math.cos(baseAngle) * 14,
                        this.y + Math.sin(baseAngle) * 14,
                        Math.cos(baseAngle) * this.bulletSpeed * 1.2,
                        Math.sin(baseAngle) * this.bulletSpeed * 1.2,
                        this.damage * 1.45, 9, Math.min(this.pierce + 2, 9), 0, false, false);
                    rail.evoRail = true;
                    bullets.push(rail);
                    this.buildStats.railShots++;
                    shotSoundFamily='rail';
                }

                const missileInterval = this.synergies.has('swarm_guidance') ? 2 : 3;
                if (this.homingMissiles > 0 && this.shotCounter % missileInterval === 0) {
                    if (bullets.length < MAX_PLAYER_PROJECTILES) this.missileLaunchFlash = 1;
                    for (let m = 0; m < Math.min(this.homingMissiles, 5) &&
                        bullets.length < MAX_PLAYER_PROJECTILES; m++) {
                        const mAngle = baseAngle + (m - (this.homingMissiles - 1) / 2) * 0.5;
                        const missile = new Bullet(
                            this.x,
                            this.y,
                            Math.cos(mAngle) * (this.bulletSpeed * 0.78),
                            Math.sin(mAngle) * (this.bulletSpeed * 0.78),
                            this.damage * 1.35,
                            6, 1, 0, true, true
                        );
                        missile.clusterPayload = this.evolutions.has('homing');
                        missile.forceChain = this.synergies.has('ionic_guidance');
                        bullets.push(missile);
                        if(shotSoundFamily!=='rail') shotSoundFamily='missile';
                    }
                }

                audio.playWeaponFire(shotSoundFamily,isCrit);
            }

            triggerDash() {
                if (this.dashCooldown > 0 || this.isDashing) return;
                this.phaseEchoOrigin = { x: this.x, y: this.y };
                this.isDashing = true;
                this.dashTimer = this.dashDuration;
                this.dashCooldown = this.dashMaxCooldown;
                this.invulnTimer = this.dashDuration + 0.12;
                this.momentum = Math.min(100, this.momentum + 25);
                audio.playDash();
                screenShake = 6;
                shockwaves.push(new Shockwave(this.x, this.y, 85, '#00f3ff', 0.25));
                motionDashLastX=this.x;motionDashLastY=this.y;motionDashClock=0;
            }

            triggerNova() {
                if (this.novaCooldown > 0) return;
                this.novaCooldown = this.novaMaxCooldown;
                audio.playExplosion(true);
                screenShake = 18;
                const novaRadius = 290;
                shockwaves.push(new Shockwave(this.x, this.y, novaRadius, '#b000ff', 0.45));
                emitMotionFx('NOVA',this.x,this.y,{radius:novaRadius});
                for(const device of fieldDevices){
                    if(device.state==='idle'&&Math.hypot(device.x-this.x,device.y-this.y)<=
                        FIELD_RULES.novaReach)triggerFieldDevice(device,'nova');
                }

                for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
                    const ep = enemyProjectiles[i];
                    if (Math.hypot(ep.x - this.x, ep.y - this.y) <= novaRadius) {
                        enemyProjectiles.splice(i, 1);
                    }
                }

                for (let i = enemies.length - 1; i >= 0; i--) {
                    const e = enemies[i];
                    const dx = e.x - this.x;
                    const dy = e.y - this.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist <= novaRadius) {
                        const pushForce = (1 - dist / novaRadius) * 540 + 200;
                        const angle = Math.atan2(dy, dx);
                        e.stunTimer = 1.1;
                        e.takeDamage(this.damage * 2.4 + 20, Math.cos(angle) * pushForce, Math.sin(angle) * pushForce, true);
                    }
                }
            }

            takeDamage(amount) {
                if (this.invulnTimer > 0 || this.isDashing) return;

                if (this.hasShield && this.shieldActive) {
                    this.shieldActive = false;
                    runMetrics.shieldBlocks++;
                    combatDirector?.intensityObserver.recordShieldBreak();
                    this.shieldCooldown = this.shieldMaxCooldown;
                    this.invulnTimer = 0.8;
                    audio.playExplosion(false);
                    screenShake = 10;
                    shockwaves.push(new Shockwave(this.x, this.y, 130, '#00f3ff', 0.3));
                    if (this.evolutions.has('aegis_shield')) {
                        // Reflect the opening blow into up to three guarded bolts.
                        let sent = 0;
                        for (const target of enemies) {
                            if (target.dead || sent >= 3 || bullets.length >= 250) continue;
                            if (Math.hypot(target.x - this.x, target.y - this.y) > 260) continue;
                            const angle = Math.atan2(target.y - this.y, target.x - this.x);
                            const counter = new Bullet(this.x, this.y,
                                Math.cos(angle) * 450, Math.sin(angle) * 450,
                                this.damage * 0.65, 5, 1, 0, false, true);
                            bullets.push(counter);
                            sent++;
                        }
                        this.buildStats.aegisDeflections += sent;
                    }
                    if (this.synergies.has('orbital_aegis')) {
                        this.buildStats.aegisPulses++;
                        for (const target of enemies) {
                            if (!target.dead && Math.hypot(target.x - this.x, target.y - this.y) < 130) {
                                target.takeDamage(this.damage * 0.8, 0, 0, false, false);
                            }
                        }
                    }
                    createFloatingText(this.x, this.y - 20, 'KALKAN KIRILDI!', '#00f3ff', 16);
                    return;
                }

                const hpBefore=this.hp;
                this.hp = Math.max(0, this.hp - amount);
                const damageLost=hpBefore-this.hp;
                if(damageLost>0){
                    runMetrics.damageTaken+=damageLost;
                    runMetrics.hitsTaken++;
                    combatDirector?.intensityObserver.recordDamage(damageLost, this.maxHp);
                }
                resetFlawlessQuest();
                this.invulnTimer = 0.65;
                screenShake = 14;
                combo = 1;
                comboTimer = 0;
                audio.playExplosion(true);

                createFloatingText(this.x, this.y - 20, `-${Math.round(amount)}`, '#ff0055', 20);
                for (let i = 0; i < 18; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const spd = Math.random() * 240 + 60;
                    emitParticle(new Particle(this.x, this.y, Math.cos(angle) * spd, Math.sin(angle) * spd, '#ff007f', 4, 0.5));
                }

                if (this.hp <= 0) {
                    initiateDeathSequence();
                }
            }

            gainXp(amount) {
                this.xp += amount * this.xpMultiplier;
                if (this.xp >= this.xpToNext) {
                    this.xp -= this.xpToNext;
                    this.level++;
                    this.xpToNext = Math.floor(this.xpToNext * 1.21 + 35);
                    this.hp = Math.min(this.maxHp, this.hp + 15);
                    triggerLevelUp();
                }
            }

            getOrbitalPositions() {
                const positions = [];
                for (let i = 0; i < this.orbitals; i++) {
                    const angle = this.orbitalAngle + (i * Math.PI * 2) / this.orbitals;
                    positions.push({
                        x: this.x + Math.cos(angle) * this.orbitalRadius,
                        y: this.y + Math.sin(angle) * this.orbitalRadius,
                        r: 9
                    });
                }
                return positions;
            }

            draw(ctx) {
                for (let i = 0; i < this.trail.length; i++) {
                    const t = this.trail[i];
                    const alpha = ((i + 1) / this.trail.length) * 0.35;
                    ctx.beginPath();
                    ctx.arc(t.x, t.y, t.r * (i / this.trail.length), 0, Math.PI * 2);
                    ctx.fillStyle = this.overdriveActive
                        ? `rgba(255, 0, 127, ${alpha})`
                        : (this.isDashing ? `rgba(255, 230, 0, ${alpha})` : `rgba(0, 243, 255, ${alpha})`);
                    ctx.fill();
                }

                const orbPositions = this.getOrbitalPositions();
                for (const op of orbPositions) {
                    ctx.save();
                    ctx.shadowBlur = getGraphicsBlur(15);
                    ctx.shadowColor = '#ffe600';
                    ctx.beginPath();
                    ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffe600';
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                }

                ctx.save();
                if (this.invulnTimer > 0 && Math.floor(this.invulnTimer * 20) % 2 === 0) {
                    ctx.globalAlpha = 0.45;
                }

                if (this.hasShield && this.shieldActive) {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.radius + 9, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(0, 243, 255, 0.85)';
                    ctx.lineWidth = 2.5;
                    ctx.setLineDash([6, 4]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                if (this.momentum >= 50) {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.radius + 14, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(0, 255, 102, ${(this.momentum / 100) * 0.55})`;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }

                if (this.overdriveActive) {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.radius + 15 + Math.sin(totalTime * 18) * 3, 0, Math.PI * 2);
                    ctx.strokeStyle = '#ff007f';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                if (this.muzzleFlash > 0) {
                    const ca = Math.cos(this.aimAngle), sa = Math.sin(this.aimAngle);
                    const fx = this.x + ca * (this.radius + 7);
                    const fy = this.y + sa * (this.radius + 7);
                    const reach = (this.overdriveActive ? 27 : 20) * this.muzzleFlash;
                    const spread = 8 * this.muzzleFlash;
                    ctx.save();
                    ctx.globalAlpha = Math.min(1, this.muzzleFlash);
                    ctx.fillStyle = this.overdriveActive ? '#ffb6dc' : '#dbfdff';
                    ctx.beginPath();
                    ctx.moveTo(fx - sa * spread, fy + ca * spread);
                    ctx.lineTo(fx + ca * reach, fy + sa * reach);
                    ctx.lineTo(fx + sa * spread, fy - ca * spread);
                    ctx.closePath();
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(fx, fy, 4.5 * this.muzzleFlash, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();
                    ctx.restore();
                }

                if (this.missileLaunchFlash > 0) {
                    const ca = Math.cos(this.aimAngle), sa = Math.sin(this.aimAngle);
                    const range = this.radius + 10 + 16 * (1 - this.missileLaunchFlash);
                    ctx.save();
                    ctx.globalAlpha = .55 * this.missileLaunchFlash;
                    ctx.strokeStyle = '#7dffba';
                    ctx.lineWidth = 2.4;
                    for (const side of [-1, 1]) {
                        const ox = -sa * side * this.radius * .65;
                        const oy = ca * side * this.radius * .65;
                        ctx.beginPath();
                        ctx.moveTo(this.x + ox + ca * (range - 13),
                                   this.y + oy + sa * (range - 13));
                        ctx.lineTo(this.x + ox + ca * range,
                                   this.y + oy + sa * range);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
                ctx.shadowBlur = getGraphicsBlur(22);
                ctx.shadowColor = this.overdriveActive ? '#ff007f' : (this.isDashing ? '#ffe600' : this.color);
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = this.overdriveActive ? '#ff007f' : (this.isDashing ? '#ffe600' : this.color);
                ctx.fill();

                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius * 0.48, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.restore();
            }
        }

        class Bullet {
            constructor(x, y, vx, vy, damage, radius, pierce, ricochet, isCrit = false, isHoming = false) {
                this.x = x;
                this.y = y;
                this.vx = vx;
                this.vy = vy;
                this.damage = damage;
                this.radius = radius;
                this.pierce = pierce;
                this.ricochet = ricochet;
                this.isCrit = isCrit;
                this.isHoming = isHoming;
                this.dead = false;
                this.hitIds = new Set();
                this.life = 2.6;
                this.prismEvolved = false;
                this.evoRail = false;
                this.clusterPayload = false;
                this.clusterUsed = false;
                this.forceChain = false;
                this.baseDamage = damage;
                this.previousX = x;
                this.previousY = y;
                this.visualAge = 0;
                this.exhaustTrail = isHoming ? [] : null;
                this.exhaustSampleTimer = 0;
                this.visualLockDistance = Infinity;
                this.clusterFragment = false;
            }

            update(dt) {
                this.life -= dt;
                this.visualAge += dt;
                if (this.life <= 0) {
                    this.dead = true;
                    return;
                }

                if (this.isHoming && enemies.length > 0) {
                    let target = null;
                    let minDist = 380;
                    for (const e of enemies) {
                        if (this.hitIds.has(e.id) || e.dead) continue;
                        const d = Math.hypot(e.x - this.x, e.y - this.y);
                        if (d < minDist) {
                            minDist = d;
                            target = e;
                        }
                    }
                    this.visualLockDistance = target ? minDist : Infinity;
                    if (target) {
                        const desiredAngle = Math.atan2(target.y - this.y, target.x - this.x);
                        const curSpeed = Math.hypot(this.vx, this.vy);
                        const curAngle = Math.atan2(this.vy, this.vx);
                        let diff = desiredAngle - curAngle;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        const newAngle = curAngle + Math.sign(diff) * Math.min(Math.abs(diff), 7.5 * dt);
                        this.vx = Math.cos(newAngle) * curSpeed;
                        this.vy = Math.sin(newAngle) * curSpeed;
                    }
                }

                this.previousX = this.x;
                this.previousY = this.y;
                this.x += this.vx * dt;
                this.y += this.vy * dt;
                if (this.isHoming && this.exhaustTrail) {
                    this.exhaustSampleTimer += dt;
                    if (this.exhaustSampleTimer >= 0.035) {
                        this.exhaustSampleTimer %= 0.035;
                        this.exhaustTrail.push({ x: this.x, y: this.y });
                        if (this.exhaustTrail.length > 9) this.exhaustTrail.shift();
                    }
                }

                if (this.x < this.radius || this.x > worldWidth - this.radius) {
                    if (this.ricochet > 0) {
                        this.ricochet--;
                        this.vx = -this.vx;
                        this.x = Math.max(this.radius, Math.min(worldWidth - this.radius, this.x));
                        if (this.prismEvolved) retargetPrismShell(this);
                        this.hitIds.clear();
                    } else {
                        this.dead = true;
                    }
                }

                if (this.y < this.radius || this.y > worldHeight - this.radius) {
                    if (this.ricochet > 0) {
                        this.ricochet--;
                        this.vy = -this.vy;
                        this.y = Math.max(this.radius, Math.min(worldHeight - this.radius, this.y));
                        if (this.prismEvolved) retargetPrismShell(this);
                        this.hitIds.clear();
                    } else {
                        this.dead = true;
                    }
                }
            }

            draw(ctx, compact = false) {
                if (this.isHoming) {
                    drawGuidedMissile(ctx, this, compact);
                    return;
                }
                const visual = getProjectileVisualStyle(this);
                const speed = Math.hypot(this.vx, this.vy) || 1;
                const dx = this.vx / speed, dy = this.vy / speed;
                const trailLength = visual.trail;
                ctx.save();
                // A dim body plus narrow bright core reads better than pure glow.
                if (trailLength > 0) {
                    ctx.strokeStyle = visual.color;
                    ctx.globalAlpha = 0.45;
                    ctx.lineWidth = visual.width + 2;
                    ctx.beginPath();
                    ctx.moveTo(this.x - dx * trailLength, this.y - dy * trailLength);
                    ctx.lineTo(this.x, this.y);
                    ctx.stroke();
                    if (!compact) {
                        ctx.globalAlpha = 0.95;
                        ctx.lineWidth = Math.max(1.4, visual.width - 1);
                        ctx.strokeStyle = visual.core;
                        ctx.beginPath();
                        ctx.moveTo(this.x - dx * trailLength * 0.58, this.y - dy * trailLength * 0.58);
                        ctx.lineTo(this.x, this.y);
                        ctx.stroke();
                    }
                }
                ctx.globalAlpha = 1;
                ctx.fillStyle = visual.color;
                ctx.shadowColor = visual.color;
                ctx.shadowBlur = compact ? 0 : getGraphicsBlur(visual.glow);
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.fillStyle = visual.core;
                ctx.beginPath();
                ctx.arc(this.x, this.y, Math.max(1.1, this.radius * 0.43), 0, Math.PI * 2);
                ctx.fill();
                if (this.evoRail && !compact) {
                    const px = -dy * (this.radius + 3), py = dx * (this.radius + 3);
                    ctx.strokeStyle = visual.color;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(this.x + px, this.y + py);
                    ctx.lineTo(this.x - px, this.y - py);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        function retargetPrismShell(shell) {
            if (!shell.prismEvolved || shell.dead) return;
            shell.damage = Math.min(shell.baseDamage * 1.8, shell.damage * 1.2);
            let chosen = null;
            let distanceSq = 450 * 450;
            for (const target of enemies) {
                if (target.dead || shell.hitIds.has(target.id)) continue;
                const dx = target.x - shell.x;
                const dy = target.y - shell.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < distanceSq) {
                    distanceSq = d2;
                    chosen = target;
                }
            }
            if (chosen) {
                const speed = Math.hypot(shell.vx, shell.vy);
                const angle = Math.atan2(chosen.y - shell.y, chosen.x - shell.x);
                shell.vx = Math.cos(angle) * speed;
                shell.vy = Math.sin(angle) * speed;
            }
            if (player) player.buildStats.prismBounces++;
        }

        function spawnClusterFragments(shell, struckEnemy) {
            if (!shell.clusterPayload || shell.clusterUsed || bullets.length > MAX_PLAYER_PROJECTILES - 2) return 0;
            shell.clusterUsed = true;
            const heading = Math.atan2(shell.vy, shell.vx);
            for (const deviation of [-0.55, 0.55]) {
                const angle = heading + deviation;
                const fragment = new Bullet(shell.x, shell.y,
                    Math.cos(angle) * 430, Math.sin(angle) * 430,
                    shell.damage * 0.32, 3.5, 1, 0, false, true);
                fragment.life = 1.2;
                fragment.clusterFragment = true;
                // Fragments should not instantly collide with their parent hit target.
                fragment.hitIds.add(struckEnemy.id);
                bullets.push(fragment);
            }
            if (player) player.buildStats.clusterBursts++;
            return 2;
        }

        // Reusable immutable paint recipes: no per-bullet allocations each render.
        const PROJECTILE_VISUAL_STYLES = Object.freeze({
            rail: { type:'rail', color:'#f7fbff', core:'#ffffff', trail:43, width:5, glow:14 },
            reactor: { type:'reactor', color:'#2bdfff', core:'#f0ffff', trail:24, width:3, glow:8 },
            prism: { type:'prism', color:'#b68aff', core:'#ffffff', trail:28, width:4, glow:9 },
            cluster: { type:'missile', color:'#7dffba', core:'#e2ffec', trail:32, width:4, glow:9 },
            missile: { type:'missile', color:'#30ec83', core:'#e2ffec', trail:32, width:4, glow:9 },
            critical: { type:'critical', color:'#ffe070', core:'#ffffff', trail:26, width:4, glow:12 },
            plasma: { type:'plasma', color:'#15d7ed', core:'#e3ffff', trail:18, width:3, glow:7 }
        });
        function getProjectileVisualStyle(b) {
            if (b.evoRail) return PROJECTILE_VISUAL_STYLES.rail;
            if (b.reactorPulse) return PROJECTILE_VISUAL_STYLES.reactor;
            if (b.prismEvolved) return PROJECTILE_VISUAL_STYLES.prism;
            if (b.isHoming) return b.clusterPayload ?
                PROJECTILE_VISUAL_STYLES.cluster : PROJECTILE_VISUAL_STYLES.missile;
            return b.isCrit ? PROJECTILE_VISUAL_STYLES.critical : PROJECTILE_VISUAL_STYLES.plasma;
        }

        function drawGuidedMissile(ctx, b, compact = false) {
            const angle = Math.atan2(b.vy, b.vx);
            const ca = Math.cos(angle), sa = Math.sin(angle);
            const x = b.x, y = b.y;
            const fragment = b.clusterFragment;
            const size = b.radius * (fragment ? 0.8 : 1);
            const pulse = 0.78 + 0.22 * Math.sin(
                (PREFERS_REDUCED_VFX_MOTION ? 0 : b.visualAge) * 24 + x * .017);
            ctx.save();
            ctx.lineCap = 'round';
            // Recorded movement points make the exhaust actually curve when homing turns.
            const trail = b.exhaustTrail || [];
            if (trail.length > 1) {
                ctx.globalAlpha = compact ? 0.3 : 0.4;
                ctx.strokeStyle = fragment ? '#baffc5' : '#09bca8';
                ctx.lineWidth = compact ? 2.4 : 4.5;
                ctx.beginPath();
                ctx.moveTo(trail[0].x, trail[0].y);
                for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
                ctx.lineTo(x - ca * size * 1.8, y - sa * size * 1.8);
                ctx.stroke();
                if (!compact) {
                    ctx.globalAlpha = 0.63;
                    ctx.strokeStyle = '#92fff3';
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(trail[0].x, trail[0].y);
                    for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
                    ctx.stroke();
                }
            }
            ctx.translate(x, y);
            ctx.rotate(angle);
            // Exhaust flame is a short animated thruster, not a particle emitter.
            const flame = size * (2.1 + pulse * 1.1);
            ctx.globalAlpha = compact ? 0.75 : 0.9;
            ctx.fillStyle = '#00bdb9';
            ctx.beginPath();
            ctx.moveTo(-size * 1.0, -size * 0.62);
            ctx.lineTo(-flame, 0);
            ctx.lineTo(-size * 1.0, size * 0.62);
            ctx.closePath();
            ctx.fill();
            if (!compact) {
                ctx.fillStyle = '#cefff5';
                ctx.beginPath();
                ctx.moveTo(-size * 1.2, -size * 0.3);
                ctx.lineTo(-flame * .72, 0);
                ctx.lineTo(-size * 1.2, size * .3);
                ctx.closePath();
                ctx.fill();
            }
            // Diamond-nosed smart rocket with fins: distinguishable at small scale.
            ctx.globalAlpha = 1;
            ctx.fillStyle = fragment ? '#b1ffb6' : (b.clusterPayload ? '#8cffe0' : '#35ec8d');
            ctx.strokeStyle = '#dcfff1';
            ctx.lineWidth = compact ? 1 : 1.5;
            ctx.beginPath();
            ctx.moveTo(size * 1.85, 0);
            ctx.lineTo(size * .30, -size * .80);
            ctx.lineTo(-size * 1.15, -size * .66);
            ctx.lineTo(-size * .85, 0);
            ctx.lineTo(-size * 1.15, size * .66);
            ctx.lineTo(size * .30, size * .80);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            if (!compact) {
                ctx.fillStyle = '#17c7b3';
                for (const dir of [-1, 1]) {
                    ctx.beginPath();
                    ctx.moveTo(-size * .25, size * dir * .45);
                    ctx.lineTo(-size * 1.30, size * dir * 1.35);
                    ctx.lineTo(-size * .75, size * dir * .35);
                    ctx.closePath();
                    ctx.fill();
                }
            }
            ctx.fillStyle = '#f0fffa';
            ctx.beginPath();
            ctx.arc(size * .5, 0, Math.max(1.15, size * .26), 0, Math.PI * 2);
            ctx.fill();
            if (!compact && Number.isFinite(b.visualLockDistance) &&
                b.visualLockDistance < 185) {
                const lockStrength = 1 - b.visualLockDistance / 185;
                ctx.globalAlpha = 0.28 + lockStrength * 0.5;
                ctx.strokeStyle = '#cbfff5';
                ctx.lineWidth = 1.1;
                ctx.beginPath();
                ctx.arc(size * .5, 0, size * (1.2 + 0.26 * pulse),
                    -Math.PI * .3, Math.PI * .3);
                ctx.stroke();
            }
            ctx.restore();
        }

        class EnemyProjectile {
            constructor(x, y, vx, vy, radius, damage, color = '#ff0055') {
                this.x = x;
                this.y = y;
                this.previousX = x;
                this.previousY = y;
                this.vx = vx;
                this.vy = vy;
                this.radius = radius;
                this.damage = damage;
                this.color = color;
                this.dead = false;
            }

            update(dt) {
                this.previousX = this.x;
                this.previousY = this.y;
                this.x += this.vx * dt;
                this.y += this.vy * dt;
                if (this.x < -40 || this.x > worldWidth + 40 || this.y < -40 || this.y > worldHeight + 40) {
                    this.dead = true;
                }
            }

            draw(ctx) {
                ctx.save();
                // All hostile projectiles use the same magenta ring, including cyan bosses.
                ctx.shadowBlur = getGraphicsBlur(5);
                ctx.shadowColor = '#ff527a';
                ctx.strokeStyle = '#ff809b';
                ctx.lineWidth = 2;
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius + 1, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.fillStyle = '#170719';
                ctx.arc(this.x, this.y, Math.max(1.5, this.radius * .37), 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        class ConduitZone {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.radius = 68;
                this.charge = 0;
                this.life = 14.0;
                this.dead = false;
                this.angle = 0;
            }

            update(dt) {
                this.angle += dt * 2.2;
                this.life -= dt;
                if (this.life <= 0) {
                    this.dead = true;
                    return;
                }

                const d = Math.hypot(player.x - this.x, player.y - this.y);
                if (d <= this.radius + player.radius) {
                    this.charge = Math.min(100, this.charge + dt * 78);
                    player.momentum = Math.min(100, player.momentum + dt * 45);
                    if (this.charge >= 100) {
                        this.dead = true;
                        audio.playJackpot();
                        screenShake = 12;
                        player.hasteTimer = 4.5;
                        player.addOverdrive(25);
                        shockwaves.push(new Shockwave(this.x, this.y, 210, '#00ff66', 0.4));

                        for (const e of enemies) {
                            const ed = Math.hypot(e.x - this.x, e.y - this.y);
                            if (ed <= 210) {
                                const ang = Math.atan2(e.y - this.y, e.x - this.x);
                                e.takeDamage(player.damage * 2.0, Math.cos(ang) * 340, Math.sin(ang) * 340, true, false);
                            }
                        }

                        for (let i = 0; i < 5; i++) {
                            emitEnergyOrb(
                                this.x + (Math.random() - 0.5) * 55,
                                this.y + (Math.random() - 0.5) * 55,
                                24,
                                i === 0
                            );
                        }
                        createFloatingText(this.x, this.y - 25, '⚡ İKMAL HALKASI AŞIRI YÜKLENDİ! ⚡', '#00ff66', 16);
                    }
                } else {
                    this.charge = Math.max(0, this.charge - dt * 18);
                }
            }

            draw(ctx) {
                ctx.save();
                ctx.translate(this.x, this.y);

                ctx.beginPath();
                ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 255, 102, ${0.06 + (this.charge / 100) * 0.14})`;
                ctx.fill();

                ctx.save();
                ctx.rotate(this.angle);
                ctx.strokeStyle = 'rgba(0, 255, 102, 0.55)';
                ctx.lineWidth = 2;
                ctx.setLineDash([12, 8]);
                ctx.beginPath();
                ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();

                if (this.charge > 0) {
                    ctx.beginPath();
                    ctx.arc(0, 0, this.radius + 4, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (this.charge / 100)));
                    ctx.strokeStyle = '#00ff66';
                    ctx.lineWidth = 4;
                    ctx.stroke();
                }

                ctx.fillStyle = '#00ff66';
                ctx.font = "700 10px 'Orbitron', sans-serif";
                ctx.textAlign = 'center';
                ctx.fillText(`⚡ İKMAL %${Math.round(this.charge)}`, 0, -this.radius - 10);
                ctx.restore();
            }
        }

        // First three encounters are deliberate single-boss introductions:
        // armored orange Behemoth -> red Destroyer -> teleporting purple Void.
        // Later encounters retain the full pool (including cyan Prism).
        const OPENING_BOSS_ORDER=Object.freeze([
            'BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID'
        ]);
        const BOSS_ARCHETYPES = [
            {
                type: 'BOSS_DESTROYER',
                name: 'MEGA-ÇEKİRDEK YIKICI',
                color: '#ff0055',
                radius: 44,
                speed: 74,
                hpMult: 1.0,
                sides: 8
            },
            {
                type: 'BOSS_TITAN',
                name: 'ZIRHLI SİBER BEHEMOT',
                color: '#ff8800',
                radius: 48,
                speed: 86,
                hpMult: 1.25,
                sides: 6
            },
            {
                type: 'BOSS_VOID',
                name: 'KUANTUM HİÇLİK ÖRÜMCEĞİ',
                color: '#b000ff',
                radius: 40,
                speed: 82,
                hpMult: 0.92,
                sides: 10
            },
            {
                type: 'BOSS_PRISM',
                name: 'OMEGA PRİZMA HÜKÜMDARI',
                color: '#00f3ff',
                radius: 42,
                speed: 78,
                hpMult: 0.95,
                sides: 4
            }
        ];


        // Four visual archetypes are deliberately independent of combat stats and hitboxes.
        const BOSS_VISUALS = Object.freeze({
            BOSS_DESTROYER: Object.freeze({ tag:'YIKICI', silhouette:'siege', color:'#ff0055' }),
            BOSS_TITAN: Object.freeze({ tag:'BEHEMOT', silhouette:'armor', color:'#ff8800' }),
            BOSS_VOID: Object.freeze({ tag:'HİÇLİK', silhouette:'spider', color:'#b000ff' }),
            BOSS_PRISM: Object.freeze({ tag:'PRİZMA', silhouette:'crystal', color:'#00f3ff' })
        });
        function bossPolygon(ctx, count, r, offset=0) {
            ctx.beginPath();
            for (let i=0; i<count; i++) {
                const a=i*Math.PI*2/count+offset;
                if (i===0) ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);
                else ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
            }
            ctx.closePath();
        }

        // Zero new particle arrays: quality tiers are based on existing combat load.
        // Telegraphs deliberately ignore this tier and remain visible at all loads.
        function getBossFxQuality() {
            if (PREFERS_REDUCED_VFX_MOTION) return 0;
            const pressure=bullets.length+enemyProjectiles.length+particles.length*.55;
            const adaptive = pressure>=210 || (activeBosses.length>=3 && pressure>=135) ? 0 :
                pressure>=105 || activeBosses.length>=3 ? 1 : 2;
            return Math.min(adaptive, getGraphicsPreset().bossFxCap);
        }
        function isBossFxInView(x,y,margin=105) {
            return x>=-margin && x<=worldWidth+margin &&
                y>=-margin && y<=worldHeight+margin;
        }

        // Impact direction and intensity live on the existing boss object: no per-hit allocations.
        function drawBossImpactAccent(ctx,boss,r,quality) {
            if (!(boss.bossHitAccentAge>0)) return;
            const strength=Math.min(1,boss.bossHitAccentAge/.22);
            ctx.save();
            ctx.rotate(boss.bossHitAngle||0);
            ctx.globalAlpha=(boss.bossHitAccentCrit?.92:.67)*strength;
            ctx.lineWidth=boss.bossHitAccentCrit?3.3:2;
            ctx.strokeStyle=boss.bossHitAccentCrit?'#fff5aa':'#ebfcff';
            ctx.shadowBlur=quality===2?7:0;
            ctx.shadowColor=boss.color;
            const spokes=quality===0?1:boss.bossHitAccentCrit?4:3;
            for(let i=0;i<spokes;i++) {
                const lateral=(i-(spokes-1)/2)*7;
                ctx.beginPath();
                if(boss.type==='BOSS_TITAN') {
                    ctx.moveTo(r*.68,lateral-5);ctx.lineTo(r*1.02,lateral);
                    ctx.lineTo(r*1.16,lateral+3);
                } else if(boss.type==='BOSS_VOID') {
                    ctx.moveTo(r*.57,lateral);ctx.lineTo(r*.76,lateral-5);
                    ctx.lineTo(r*.94,lateral+5);ctx.lineTo(r*1.17,lateral-2);
                } else if(boss.type==='BOSS_PRISM') {
                    ctx.moveTo(r*.58,lateral-4);ctx.lineTo(r*.96,lateral);
                    ctx.lineTo(r*.7,lateral+7);
                } else {
                    ctx.moveTo(r*.69,lateral);ctx.lineTo(r*1.03,lateral-3);
                    ctx.lineTo(r*1.18,lateral+2);
                }
                ctx.stroke();
            }
            ctx.restore();
        }

        function drawBossIdentity(ctx, boss) {
            const r=boss.radius, phase=boss.bossPhase, hit=boss.bossHitFlash||0;
            const quality=getBossFxQuality();
            const clock=quality===0 ? 0 : totalTime;
            const breath=PREFERS_REDUCED_VFX_MOTION ? 0 : Math.sin(clock*(2+phase*.5)+boss.id*.3);
            const entry=Math.min(1,boss.bossEntranceAge/.8);
            ctx.save();
            ctx.scale(.67+.33*entry,.67+.33*entry);
            ctx.lineJoin='bevel';
            ctx.shadowColor=boss.color;
            ctx.shadowBlur=quality===0?0:Math.min(17,7+phase*2+hit*3);
            // Restrained aura, bounded to the boss; hazard beams remain visible.
            ctx.save();
            ctx.globalAlpha=quality===0?.12:.16+phase*.045+Math.max(0,breath)*.04;
            ctx.strokeStyle=boss.color; ctx.lineWidth=2;
            ctx.beginPath();ctx.arc(0,0,r*(1.16+phase*.04),0,Math.PI*2);ctx.stroke();
            ctx.restore();
            if (boss.type==='BOSS_DESTROYER') {
                // Red octagonal reactor plus four heavy weapon barrels.
                ctx.fillStyle='#230714';ctx.strokeStyle=boss.color;ctx.lineWidth=3;
                bossPolygon(ctx,8,r*.88,Math.PI/8);ctx.fill();ctx.stroke();
                for(let i=0;i<4;i++){
                    ctx.save();ctx.rotate(i*Math.PI/2);
                    const extension=(phase-1)*2.5+
                        (quality===0?0:Math.sin(clock*(phase===3?4.4:2.3)+i*1.57)*(phase===3?2.3:1.1))-
                        (boss.bossVolleyRecoil||0)*4;
                    ctx.fillStyle='#440b24';ctx.strokeStyle='#ff4977';
                    ctx.beginPath();
                    ctx.moveTo(r*.52,-r*.23);ctx.lineTo(r*.92,-r*.19);
                    ctx.lineTo(r*1.22+extension,-r*.10);ctx.lineTo(r*1.22+extension,r*.10);
                    ctx.lineTo(r*.92,r*.19);ctx.lineTo(r*.52,r*.23);ctx.closePath();
                    ctx.fill();ctx.stroke();
                    if(quality>=1) {
                        ctx.strokeStyle='#ffc0d5';ctx.lineWidth=1.6;
                        ctx.beginPath();ctx.moveTo(r*.79,0);ctx.lineTo(r*1.21+extension,0);ctx.stroke();
                    }
                    ctx.restore();
                }
                ctx.strokeStyle='#ffacc9';bossPolygon(ctx,8,r*.55,Math.PI/8);ctx.stroke();
            } else if(boss.type==='BOSS_TITAN') {
                // Massy hex armor, isolated articulated plates and hot vents.
                ctx.fillStyle='#211306';ctx.strokeStyle='#ff8800';ctx.lineWidth=4;
                bossPolygon(ctx,6,r*.91,Math.PI/6);ctx.fill();ctx.stroke();
                for(let i=0;i<6;i++){
                    ctx.save();ctx.rotate(i*Math.PI/3+Math.PI/6);
                    ctx.fillStyle='#49311b';ctx.strokeStyle='#ffd086';ctx.lineWidth=2;
                    ctx.beginPath();ctx.moveTo(r*.56,-r*.29);ctx.lineTo(r*.96,-r*.25);
                    ctx.lineTo(r*1.12,-r*.10);ctx.lineTo(r*1.12,r*.10);
                    ctx.lineTo(r*.96,r*.25);ctx.lineTo(r*.56,r*.29);ctx.closePath();
                    ctx.fill();ctx.stroke();
                    ctx.strokeStyle='#ff8b25';ctx.lineWidth=3+(quality>=1?Math.max(0,breath)*1.4:0);
                    ctx.beginPath();ctx.moveTo(r*.75,0);ctx.lineTo(r*(.96+.035*phase),0);ctx.stroke();
                    ctx.restore();
                }
                ctx.fillStyle='#110a09';bossPolygon(ctx,6,r*.48,Math.PI/6);ctx.fill();
            } else if(boss.type==='BOSS_VOID') {
                // Six disconnected jointed legs: silhouette reads as a void spider.
                ctx.strokeStyle='#cd7dff';ctx.lineWidth=3.5;
                for(let i=0;i<6;i++){
                    const a=i*Math.PI/3, sway=quality===0?0:Math.sin(clock*(phase===3?2.2:1.6)+i)*2;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a)*r*.34,Math.sin(a)*r*.34);
                    ctx.lineTo(Math.cos(a+.2)*r*.79,Math.sin(a+.2)*r*.79);
                    ctx.lineTo(Math.cos(a-.14)*r*1.29+sway,Math.sin(a-.14)*r*1.29-sway);
                    ctx.stroke();
                    ctx.fillStyle='#ad46ff';ctx.beginPath();
                    ctx.arc(Math.cos(a+.2)*r*.79,Math.sin(a+.2)*r*.79,3,0,Math.PI*2);ctx.fill();
                }
                ctx.fillStyle='#10051d';ctx.strokeStyle=boss.color;ctx.lineWidth=3;
                bossPolygon(ctx,6,r*.55,Math.PI/6);ctx.fill();ctx.stroke();
                if(quality>=1) {
                    ctx.save();ctx.rotate(clock*.31);ctx.strokeStyle='#c7a1ff';ctx.lineWidth=1.8;
                    for(let i=0;i<(quality===2?3:1);i++){
                        const a=i*Math.PI*2/3;ctx.beginPath();ctx.arc(0,0,r*.73,a,a+.53);ctx.stroke();
                    }ctx.restore();
                }
            } else if(boss.type==='BOSS_PRISM') {
                // Four long crystal spears with independently rotating diamond core.
                for(let i=0;i<4;i++){
                    ctx.save();ctx.rotate(i*Math.PI/2);
                    ctx.fillStyle='#072434';ctx.strokeStyle='#7cf8ff';ctx.lineWidth=2.5;
                    ctx.beginPath();ctx.moveTo(r*.21,-r*.33);ctx.lineTo(r*.7,-r*.24);
                    ctx.lineTo(r*1.3,0);ctx.lineTo(r*.7,r*.24);
                    ctx.lineTo(r*.21,r*.33);ctx.closePath();ctx.fill();ctx.stroke();
                    if(quality>=1) {
                        ctx.strokeStyle='#00f3ff';ctx.lineWidth=1.5;
                        ctx.beginPath();ctx.moveTo(r*.4,0);ctx.lineTo(r*1.22,0);ctx.stroke();
                    }
                    ctx.restore();
                }
                if(quality>=1) {
                    ctx.save();ctx.rotate(Math.PI/4+clock*(phase===3?.54:.32));
                    ctx.strokeStyle='#bdffff';ctx.lineWidth=2;
                    bossPolygon(ctx,4,r*.64);ctx.stroke();ctx.restore();
                }
            }
            ctx.fillStyle='#f0fcff';ctx.shadowBlur=quality===0?0:Math.min(19,10+phase*2);
            bossPolygon(ctx,boss.type==='BOSS_VOID'?6:4,
                r*(.15+.015*phase+Math.max(0,breath)*.012),Math.PI/4);ctx.fill();
            ctx.strokeStyle=boss.color;ctx.lineWidth=2.5;
            bossPolygon(ctx,boss.type==='BOSS_TITAN'?6:4,r*.32,
                boss.type==='BOSS_PRISM'?Math.PI/4:0);ctx.stroke();
            if(hit>0){
                ctx.globalAlpha=hit*.6;ctx.strokeStyle='#ffffff';ctx.lineWidth=3;
                bossPolygon(ctx,8,r*.47);ctx.stroke();
            }
            // Near-death cracks are controlled by existing HP; there is no new damage state.
            if(quality>=1 && boss.hp<boss.maxHp*.35) {
                ctx.save();
                ctx.shadowBlur=0;
                ctx.strokeStyle=boss.color;ctx.lineWidth=1.5;
                ctx.globalAlpha=.33+.13*Math.max(0,breath);
                for(let i=0;i<(quality===2?4:2);i++){
                    const a=i*Math.PI/2+.22;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a)*r*.37,Math.sin(a)*r*.37);
                    ctx.lineTo(Math.cos(a+.19)*r*.52,Math.sin(a+.19)*r*.52);
                    ctx.lineTo(Math.cos(a-.10)*r*.69,Math.sin(a-.10)*r*.69);
                    ctx.stroke();
                }
                ctx.restore();
            }
            drawBossImpactAccent(ctx,boss,r,quality);
            if(entry<1){
                // Arrival geometry follows the archetype, never stops simulation.
                ctx.globalAlpha=(1-entry)*.7;ctx.strokeStyle=boss.color;
                ctx.lineWidth=boss.type==='BOSS_TITAN'?5:2.5;
                bossPolygon(ctx,boss.type==='BOSS_DESTROYER'?8:
                    boss.type==='BOSS_PRISM'?4:6,r*(1.48-entry*.24),clock*.16);ctx.stroke();
            }
            ctx.restore();
        }
        const MAX_BOSS_DEATH_VFX=3;
        let bossDeathVfx=[];
        function drawBossDeathVfx(ctx,v) {
            if(!isBossFxInView(v.x,v.y,v.radius*2.7)) return;
            const quality=getBossFxQuality();
            const progress=Math.min(1,v.age/v.duration);
            const travel=PREFERS_REDUCED_VFX_MOTION?.55:progress;
            const r=v.radius;
            ctx.save();ctx.translate(v.x,v.y);
            ctx.globalAlpha=(1-progress)*.78;ctx.strokeStyle=v.color;
            ctx.shadowColor=v.color;ctx.shadowBlur=quality===2?8:0;
            ctx.lineWidth=v.type==='BOSS_TITAN'?5:2.8;
            // No persistent particle objects: these are transient procedural silhouettes.
            if(v.type==='BOSS_VOID') {
                for(let i=0;i<3;i++){
                    const a=i*Math.PI*2/3+progress;
                    ctx.beginPath();ctx.arc(0,0,r*(1.18-travel*.8),a,a+.64);ctx.stroke();
                }
            } else if(v.type==='BOSS_PRISM') {
                bossPolygon(ctx,4,r*(.86+travel*.85),Math.PI/4+progress*.33);ctx.stroke();
            } else {
                bossPolygon(ctx,v.type==='BOSS_DESTROYER'?8:6,r*(.86+travel*.85),progress*.28);
                ctx.stroke();
            }
            const count=quality===0?2:v.type==='BOSS_TITAN'?6:
                v.type==='BOSS_VOID'?6:v.type==='BOSS_PRISM'?4:8;
            for(let i=0;i<count;i++){
                const a=i*Math.PI*2/count+(v.type==='BOSS_PRISM'?Math.PI/4:0);
                const d=v.type==='BOSS_VOID'?r*(1.10-travel*.9):r*(.38+travel*1.26);
                ctx.save();ctx.translate(Math.cos(a)*d,Math.sin(a)*d);
                ctx.rotate(a+progress*(v.type==='BOSS_TITAN'?.24:1.12));
                ctx.fillStyle=i%2?'#e6faff':v.color;
                ctx.beginPath();
                if(v.type==='BOSS_TITAN') {
                    ctx.moveTo(-9,-6);ctx.lineTo(10,-5);ctx.lineTo(13,5);ctx.lineTo(-9,6);
                } else if(v.type==='BOSS_VOID') {
                    ctx.moveTo(-3,-11);ctx.lineTo(3,-2);ctx.lineTo(1,12);
                } else if(v.type==='BOSS_PRISM') {
                    ctx.moveTo(-5,-5);ctx.lineTo(18,0);ctx.lineTo(-5,5);
                } else {
                    ctx.moveTo(-6,-7);ctx.lineTo(12,-2);ctx.lineTo(13,3);ctx.lineTo(-6,7);
                }
                ctx.closePath();ctx.fill();ctx.restore();
            }
            ctx.restore();
        }

        let enemyIdCounter = 1;
        class Enemy {
            constructor(x, y, type, isElite = false, tacticalMeta = null) {
                this.id = enemyIdCounter++;
                this.x = x;
                this.y = y;
                this.type = type;
                this.isBoss = type.startsWith('BOSS');
                this.isElite = isElite && !this.isBoss;
                this.formationId = tacticalMeta?.formationId || null;
                this.tacticalRole = tacticalMeta?.role || null;
                this.tacticalSide = Number.isFinite(tacticalMeta?.side) ? tacticalMeta.side : null;
                this.tacticalSlot = Number.isFinite(tacticalMeta?.slot) ? tacticalMeta.slot : null;
                this.crowdSteerX = 0;
                this.crowdSteerY = 0;
                this.pushVx = 0;
                this.pushVy = 0;
                this.rotation = 0;
                this.stunTimer = 0;
                this.orbitalHitCooldown = 0;
                this.dead = false;
                this.actionTimer = 1.4 + Math.random() * 1.2;
                this.secondaryTimer = 3.0 + Math.random() * 1.5;
                this.state = 'CHASE';
                this.enraged = false;
                this.bossPhase = 1;
                this.bossSpecial = null;
                this.bossSpecialCount = 0;

                // Predictable, sub-exponential late-game scaling; wave 30 stays playable.
                const elapsedWaves = Math.max(0, wave - 1);
                const waveMult = 1 + elapsedWaves * 0.20 + elapsedWaves * elapsedWaves * 0.018;
                const dmgMult = Math.min(2.8, 1 + elapsedWaves * 0.095);
                const spdWaveMult = Math.min(1.65, 1 + elapsedWaves * 0.022);
                const eliteHpMult = this.isElite ? Math.min(4.1, 2.2 + Math.max(0, wave - 4) * 0.12) : 1.0;

                if (type === 'SWARM') {
                    this.radius = 12;
                    this.speed = (165 + Math.random() * 25) * spdWaveMult;
                    this.maxHp = 25 * waveMult * eliteHpMult;
                    this.damage = Math.round(11 * dmgMult);
                    this.color = '#ff0055';
                    this.xpValue = 16;
                    this.scoreValue = 25;
                    this.sides = 3;
                } else if (type === 'KAMIKAZE') {
                    this.radius = 13;
                    this.speed = 245 * spdWaveMult;
                    this.maxHp = 22 * waveMult * eliteHpMult;
                    this.damage = Math.round(22 * dmgMult);
                    this.color = '#ff3300';
                    this.xpValue = 22;
                    this.scoreValue = 40;
                    this.sides = 3;
                } else if (type === 'ASSASSIN') {
                    this.radius = 13;
                    this.speed = 260 * spdWaveMult;
                    this.maxHp = 38 * waveMult * eliteHpMult;
                    this.damage = Math.round(20 * dmgMult);
                    this.color = '#00f3ff';
                    this.xpValue = 34;
                    this.scoreValue = 75;
                    this.sides = 3;
                    this.strafePhase = Math.random() * Math.PI * 2;
                } else if (type === 'SPLITTER') {
                    this.radius = 18;
                    this.speed = 128 * spdWaveMult;
                    this.maxHp = 54 * waveMult * eliteHpMult;
                    this.damage = Math.round(15 * dmgMult);
                    this.color = '#b000ff';
                    this.xpValue = 28;
                    this.scoreValue = 50;
                    this.sides = 4;
                } else if (type === 'MINI') {
                    this.radius = 9;
                    this.speed = 225 * spdWaveMult;
                    this.maxHp = 15 * waveMult;
                    this.damage = Math.round(9 * dmgMult);
                    this.color = '#ff66b2';
                    this.xpValue = 10;
                    this.scoreValue = 15;
                    this.sides = 3;
                } else if (type === 'DASHER') {
                    this.radius = 15;
                    this.speed = 140 * spdWaveMult;
                    this.maxHp = 48 * waveMult * eliteHpMult;
                    this.damage = Math.round(18 * dmgMult);
                    this.color = '#ff8800';
                    this.xpValue = 32;
                    this.scoreValue = 65;
                    this.sides = 4;
                    this.dashTargetAngle = 0;
                } else if (type === 'SHOOTER') {
                    this.radius = 16;
                    this.speed = 110 * spdWaveMult;
                    this.maxHp = 50 * waveMult * eliteHpMult;
                    this.damage = Math.round(14 * dmgMult);
                    this.color = '#00ff88';
                    this.xpValue = 35;
                    this.scoreValue = 75;
                    this.sides = 5;
                } else if (type === 'SNIPER') {
                    this.radius = 15;
                    this.speed = 96 * spdWaveMult;
                    this.maxHp = 44 * waveMult * eliteHpMult;
                    this.damage = Math.round(25 * dmgMult);
                    this.color = '#ff00aa';
                    this.xpValue = 40;
                    this.scoreValue = 90;
                    this.sides = 4;
                    this.aimAngle = 0;
                } else if (type === 'GRAV_WELL') {
                    this.radius = 21;
                    this.speed = 82 * spdWaveMult;
                    this.maxHp = 98 * waveMult * eliteHpMult;
                    this.damage = Math.round(18 * dmgMult);
                    this.color = '#9933ff';
                    this.xpValue = 50;
                    this.scoreValue = 110;
                    this.sides = 8;
                } else if (type === 'SHIELD_BEARER') {
                    this.radius = 22;
                    this.speed = 90 * spdWaveMult;
                    this.maxHp = 135 * waveMult * eliteHpMult;
                    this.damage = Math.round(20 * dmgMult);
                    this.color = '#38bdf8';
                    this.xpValue = 55;
                    this.scoreValue = 120;
                    this.sides = 6;
                } else if (type === 'TANK') {
                    this.radius = 25;
                    this.speed = 80 * spdWaveMult;
                    this.maxHp = 168 * waveMult * eliteHpMult;
                    this.damage = Math.round(25 * dmgMult);
                    this.color = '#ffaa00';
                    this.xpValue = 60;
                    this.scoreValue = 130;
                    this.sides = 6;
                } else if (this.isBoss) {
                    const arch = BOSS_ARCHETYPES.find(b => b.type === type) || BOSS_ARCHETYPES[0];
                    this.bossName = arch.name;
                    this.bossVisual = BOSS_VISUALS[arch.type];
                    this.bossEntranceAge = 0;
                    this.bossHitFlash = 0;
                    this.bossPhaseFlash = 0;
                    this.bossHitAccentAge = 0;
                    this.bossHitAngle = 0;
                    this.bossHitAccentCrit = false;
                    this.bossNextAccentAt = -Infinity;
                    this.bossVolleyRecoil = 0;
                    this.radius = arch.radius;
                    this.speed = arch.speed * Math.min(1.7, 1 + (wave - 1) * 0.038);
                    this.maxHp = 2100 * waveMult * arch.hpMult * (1 + Math.min(2, bossEncounterCount) * 0.25);
                    this.damage = Math.round(32 * dmgMult);
                    this.color = arch.color;
                    this.xpValue = 420;
                    this.scoreValue = 1800;
                    this.sides = arch.sides;
                    this.actionTimer = 1.8;
                    this.dashTargetAngle = 0;
                    this.aimAngle = 0;
                }

                if (!this.isBoss) this.speed *= getActiveNeonContract().enemySpeedMult;
                if (this.isElite) {
                    this.radius *= 1.22;
                    this.speed *= 1.12;
                    this.xpValue *= 2.5;
                    this.scoreValue *= 3;
                }

                this.hp = this.maxHp;
            }

            update(dt) {
                const steeringStartX = this.x, steeringStartY = this.y;
                if (this.isBoss) {
                    this.bossEntranceAge = Math.min(.8, this.bossEntranceAge + dt);
                    this.bossHitFlash = Math.max(0, this.bossHitFlash - dt*3.8);
                    this.bossPhaseFlash = Math.max(0, this.bossPhaseFlash - dt);
                    this.bossHitAccentAge = Math.max(0, this.bossHitAccentAge - dt);
                    this.bossVolleyRecoil = Math.max(0, this.bossVolleyRecoil - dt*3);
                }
                this.orbitalHitCooldown = Math.max(0, this.orbitalHitCooldown - dt);
                if (this.stunTimer > 0) {
                    this.stunTimer -= dt;
                } else {
                    const echoTarget = getPhaseEchoTarget(this);
                    const dx = (echoTarget ? echoTarget.x : player.x) - this.x;
                    const dy = (echoTarget ? echoTarget.y : player.y) - this.y;
                    const dist = Math.hypot(dx, dy) || 1;
                    const contractProjectileMult = !this.isBoss && activeContractId === 'OVERCHARGE' ? 1.10 : 1;
                    const projSpeedScale = Math.min(1.7, 1 + (wave - 1) * 0.042) * contractProjectileMult;
                    const enemyDmgScale = Math.min(2.7, 1 + (wave - 1) * 0.08);

                    if (this.isBoss) {
                        this.updateBossPhases(dt, dx, dy);
                        if (!this.enraged && this.hp < this.maxHp * 0.45) {
                            this.enraged = true;
                            this.speed *= 1.25;
                            shockwaves.push(new Shockwave(this.x, this.y, 220, this.color, 0.4));
                            createFloatingText(this.x, this.y - this.radius - 15, `⚠ ${this.bossName}: ÖFKE MODU!`, this.color, 16);
                        }
                    }

                    if (this.isBoss && this.bossSpecial) {
                        // Do not mix a regular boss attack with an announced phase salvo.
                        this.actionTimer = Math.max(this.actionTimer, 0.7);
                    } else if (this.type === 'ASSASSIN') {
                        this.strafePhase += dt * 7;
                        const flankVector = getTacticalFlankVector(this, dx, dy, dist);
                        const perpX = -dy / dist;
                        const perpY = dx / dist;
                        const waveOffset = Math.sin(this.strafePhase) * 0.65;
                        const moveX = flankVector.x + perpX * waveOffset;
                        const moveY = flankVector.y + perpY * waveOffset;
                        const moveLength = this.tacticalRole === 'flank' ?
                            Math.hypot(moveX, moveY) || 1 : 1;
                        this.x += moveX / moveLength * this.speed * dt;
                        this.y += moveY / moveLength * this.speed * dt;
                    } else if (this.type === 'DASHER') {
                        this.actionTimer -= dt;
                        if (this.state === 'CHASE') {
                            const flankVector = getTacticalFlankVector(this, dx, dy, dist);
                            this.x += flankVector.x * this.speed * dt;
                            this.y += flankVector.y * this.speed * dt;
                            if (this.actionTimer <= 0 && dist < 360) {
                                this.state = 'CHARGE';
                                this.actionTimer = Math.max(0.32, 0.55 - wave * 0.015);
                                this.dashTargetAngle = Math.atan2(dy, dx);
                            }
                        } else if (this.state === 'CHARGE') {
                            if (this.actionTimer <= 0) {
                                this.state = 'LUNGE';
                                this.actionTimer = 0.36;
                            }
                        } else if (this.state === 'LUNGE') {
                            this.x += Math.cos(this.dashTargetAngle) * (this.speed * 3.9) * dt;
                            this.y += Math.sin(this.dashTargetAngle) * (this.speed * 3.9) * dt;
                            if (this.actionTimer <= 0) {
                                this.state = 'CHASE';
                                this.actionTimer = 1.7 + Math.random() * 0.8;
                            }
                        }
                    } else if (this.type === 'SHOOTER') {
                        const cover = getTacticalCoverPoint(this);
                        if (cover && Math.hypot(cover.x - this.x, cover.y - this.y) > 18) {
                            const cdx = cover.x - this.x;
                            const cdy = cover.y - this.y;
                            const cdist = Math.hypot(cdx, cdy) || 1;
                            this.x += cdx / cdist * this.speed * 1.12 * dt;
                            this.y += cdy / cdist * this.speed * 1.12 * dt;
                        } else if (dist > 250) {
                            this.x += (dx / dist) * this.speed * dt;
                            this.y += (dy / dist) * this.speed * dt;
                        } else if (dist < 150) {
                            this.x -= (dx / dist) * (this.speed * 0.6) * dt;
                            this.y -= (dy / dist) * (this.speed * 0.6) * dt;
                        }
                        this.actionTimer -= dt;
                        if (this.actionTimer <= 0 && dist < 560 &&
                            (!combatDirector || combatDirector.claimSquadVolley(this))) {
                            this.actionTimer = Math.max(1.2, 2.3 - wave * 0.06);
                            const angle = Math.atan2(dy, dx);
                            const pSpd = 290 * projSpeedScale;
                            enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(angle) * pSpd, Math.sin(angle) * pSpd, 6, Math.round(13 * enemyDmgScale), '#00ff88'));
                            if (this.isElite || wave >= 8) {
                                enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(angle - 0.22) * pSpd, Math.sin(angle - 0.22) * pSpd, 5, Math.round(11 * enemyDmgScale), '#00ff88'));
                                enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(angle + 0.22) * pSpd, Math.sin(angle + 0.22) * pSpd, 5, Math.round(11 * enemyDmgScale), '#00ff88'));
                            }
                        }
                    } else if (this.type === 'SNIPER') {
                        const cover = getTacticalCoverPoint(this);
                        if (cover && Math.hypot(cover.x - this.x, cover.y - this.y) > 18) {
                            const cdx = cover.x - this.x;
                            const cdy = cover.y - this.y;
                            const cdist = Math.hypot(cdx, cdy) || 1;
                            this.x += cdx / cdist * this.speed * 1.08 * dt;
                            this.y += cdy / cdist * this.speed * 1.08 * dt;
                        } else if (dist > 390) {
                            this.x += (dx / dist) * this.speed * dt;
                            this.y += (dy / dist) * this.speed * dt;
                        }
                        this.actionTimer -= dt;
                        this.aimAngle = Math.atan2(dy, dx);
                        if (this.actionTimer <= 0 && dist < 720 &&
                            (!combatDirector || combatDirector.claimSquadVolley(this))) {
                            this.actionTimer = Math.max(1.8, 3.0 - wave * 0.07);
                            const pSpd = 560 * projSpeedScale;
                            enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(this.aimAngle) * pSpd, Math.sin(this.aimAngle) * pSpd, 7, Math.round(22 * enemyDmgScale), '#ff00aa'));
                        }
                    } else if (this.type === 'GRAV_WELL') {
                        this.x += (dx / dist) * this.speed * dt;
                        this.y += (dy / dist) * this.speed * dt;
                        const pullRadius = 265;
                        if (dist < pullRadius && !player.isDashing) {
                            const pullStrength = (1 - dist / pullRadius) * (125 + wave * 4);
                            player.x -= (dx / dist) * pullStrength * dt;
                            player.y -= (dy / dist) * pullStrength * dt;
                        }
                    } else if (this.type === 'BOSS_DESTROYER') {
                        this.x += (dx / dist) * this.speed * dt;
                        this.y += (dy / dist) * this.speed * dt;
                        this.actionTimer -= dt * (this.enraged ? 1.35 : 1.0);
                        if (this.actionTimer <= 0 && (!combatDirector || combatDirector.allowBossAttack(this, 'regular'))) {
                            this.actionTimer = 2.2;
                            const count = this.enraged ? 16 : 12;
                            const pSpd = 265 * projSpeedScale;
                            for (let i = 0; i < count; i++) {
                                const a = (i * Math.PI * 2) / count + this.rotation;
                                enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(a) * pSpd, Math.sin(a) * pSpd, 8, Math.round(18 * enemyDmgScale), '#ff0055'));
                            }
                            if (this.enraged) {
                                const aim = Math.atan2(dy, dx);
                                for (let k = -2; k <= 2; k++) {
                                    const a2 = aim + k * 0.14;
                                    enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(a2) * (pSpd * 1.35), Math.sin(a2) * (pSpd * 1.35), 7, Math.round(20 * enemyDmgScale), '#ffe600'));
                                }
                            }
                            shockwaves.push(new Shockwave(this.x, this.y, 150, '#ff0055', 0.35));
                            audio.playExplosion(false);
                        }
                    } else if (this.type === 'BOSS_TITAN') {
                        this.actionTimer -= dt;
                        if (this.state === 'CHASE') {
                            this.x += (dx / dist) * this.speed * dt;
                            this.y += (dy / dist) * this.speed * dt;
                            if (this.actionTimer <= 0 && (!combatDirector || combatDirector.allowBossAttack(this, 'titan'))) {
                                this.state = 'CHARGE';
                                this.actionTimer = this.enraged ? 0.5 : 0.7;
                                this.dashTargetAngle = Math.atan2(dy, dx);
                            }
                        } else if (this.state === 'CHARGE') {
                            this.dashTargetAngle = Math.atan2(dy, dx);
                            if (this.actionTimer <= 0) {
                                this.state = 'LUNGE';
                                this.actionTimer = 0.48;
                                audio.playDash();
                            }
                        } else if (this.state === 'LUNGE') {
                            this.x += Math.cos(this.dashTargetAngle) * (this.speed * 4.4) * dt;
                            this.y += Math.sin(this.dashTargetAngle) * (this.speed * 4.4) * dt;
                            if (this.actionTimer <= 0) {
                                this.state = 'CHASE';
                                this.actionTimer = this.enraged ? 1.5 : 2.2;
                                const pSpd = 340 * projSpeedScale;
                                const spreadCount = this.enraged ? 9 : 7;
                                for (let i = 0; i < spreadCount; i++) {
                                    const a = this.dashTargetAngle + (i - (spreadCount - 1) / 2) * 0.18;
                                    enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(a) * pSpd, Math.sin(a) * pSpd, 8, Math.round(20 * enemyDmgScale), '#ff8800'));
                                }
                                shockwaves.push(new Shockwave(this.x, this.y, 175, '#ff8800', 0.35));
                                screenShake = Math.max(screenShake, 10);
                            }
                        }
                    } else if (this.type === 'BOSS_VOID') {
                        this.x += (dx / dist) * this.speed * dt;
                        this.y += (dy / dist) * this.speed * dt;
                        if (dist < 320 && !player.isDashing) {
                            const pull = (1 - dist / 320) * (135 + wave * 3);
                            player.x -= (dx / dist) * pull * dt;
                            player.y -= (dy / dist) * pull * dt;
                        }
                        this.actionTimer -= dt;
                        this.secondaryTimer -= dt;
                        if (this.actionTimer <= 0 && (!combatDirector || combatDirector.allowBossAttack(this, 'regular'))) {
                            this.actionTimer = this.enraged ? 1.3 : 1.85;
                            const baseA = Math.atan2(dy, dx);
                            const pSpd = 300 * projSpeedScale;
                            for (let i = 0; i < 8; i++) {
                                const a = baseA + (i * Math.PI * 2) / 8 + this.rotation;
                                enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(a) * pSpd, Math.sin(a) * pSpd, 7, Math.round(17 * enemyDmgScale), '#b000ff'));
                            }
                            if (enemies.length < 45) {
                                enemies.push(new Enemy(this.x + (Math.random() - 0.5) * 60, this.y + (Math.random() - 0.5) * 60, 'KAMIKAZE', false));
                            }
                        }
                        if (this.secondaryTimer <= 0 && (!combatDirector || combatDirector.canBossReposition(this))) {
                            this.secondaryTimer = this.enraged ? 3.4 : 4.8;
                            shockwaves.push(new Shockwave(this.x, this.y, 140, '#b000ff', 0.3));
                            const blinkAngle = Math.random() * Math.PI * 2;
                            const blinkDist = 230 + Math.random() * 90;
                            this.x = Math.max(60, Math.min(worldWidth - 60, player.x + Math.cos(blinkAngle) * blinkDist));
                            this.y = Math.max(60, Math.min(worldHeight - 60, player.y + Math.sin(blinkAngle) * blinkDist));
                            shockwaves.push(new Shockwave(this.x, this.y, 160, '#00f3ff', 0.3));
                        }
                    } else if (this.type === 'BOSS_PRISM') {
                        const idealDist = 290;
                        const perpX = -dy / dist;
                        const perpY = dx / dist;
                        if (dist > idealDist + 40) {
                            this.x += ((dx / dist) * 0.8 + perpX * 0.6) * this.speed * dt;
                            this.y += ((dy / dist) * 0.8 + perpY * 0.6) * this.speed * dt;
                        } else if (dist < idealDist - 50) {
                            this.x += ((-dx / dist) * 0.7 + perpX * 0.7) * this.speed * dt;
                            this.y += ((-dy / dist) * 0.7 + perpY * 0.7) * this.speed * dt;
                        } else {
                            this.x += perpX * this.speed * 1.15 * dt;
                            this.y += perpY * this.speed * 1.15 * dt;
                        }
                        this.x = Math.max(50, Math.min(worldWidth - 50, this.x));
                        this.y = Math.max(50, Math.min(worldHeight - 50, this.y));

                        this.aimAngle = Math.atan2(dy, dx);
                        this.actionTimer -= dt;
                        if (this.actionTimer <= 0 && (!combatDirector || combatDirector.allowBossAttack(this, 'regular'))) {
                            this.actionTimer = this.enraged ? 1.15 : 1.65;
                            const sniperSpd = 520 * projSpeedScale;
                            for (let s = -1; s <= 1; s++) {
                                const a = this.aimAngle + s * 0.14;
                                enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(a) * sniperSpd, Math.sin(a) * sniperSpd, 7, Math.round(21 * enemyDmgScale), '#00f3ff'));
                            }
                            const crossCount = this.enraged ? 6 : 4;
                            for (let c = 0; c < crossCount; c++) {
                                const ca = this.rotation + (c * Math.PI * 2) / crossCount;
                                enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(ca) * 280 * projSpeedScale, Math.sin(ca) * 280 * projSpeedScale, 6, Math.round(16 * enemyDmgScale), '#ff007f'));
                            }
                            audio.playLaser(true);
                        }
                    } else {
                        this.x += (dx / dist) * this.speed * dt;
                        this.y += (dy / dist) * this.speed * dt;
                    }
                }

                // Re-orient only existing CHASE displacement. No speed buff,
                // extra movement, changed charge path, or damage collision bypass.
                if (canCrowdSteer(this) && this.stunTimer <= 0 &&
                    this.x >= 0 && this.x <= worldWidth &&
                    this.y >= 0 && this.y <= worldHeight &&
                    Math.hypot(this.x - player.x, this.y - player.y) >
                        this.radius + player.radius + 30 &&
                    (this.crowdSteerX || this.crowdSteerY)) {
                    const moveX = this.x - steeringStartX;
                    const moveY = this.y - steeringStartY;
                    const traveled = Math.hypot(moveX, moveY);
                    if (traveled > 0.001) {
                        const roleScale = this.tacticalRole === 'payload' ? 0.5 :
                            this.formationId ? 0.75 : 1;
                        const steerX = moveX / traveled + this.crowdSteerX * roleScale;
                        const steerY = moveY / traveled + this.crowdSteerY * roleScale;
                        const norm = Math.hypot(steerX, steerY) || 1;
                        this.x = steeringStartX + steerX / norm * traveled;
                        this.y = steeringStartY + steerY / norm * traveled;
                    }
                }
                // M5.19: Only cautious ranged units interpret an announced
                // foundry rail. They retain their original travel distance.
                steerFoundryRangedEnemy(this,steeringStartX,steeringStartY);
                this.x += this.pushVx * dt;
                this.y += this.pushVy * dt;
                this.pushVx *= Math.pow(0.04, dt);
                this.pushVy *= Math.pow(0.04, dt);
                this.rotation += (this.isBoss ? (this.enraged ? 2.2 : 1.3) : 2.5) * dt;
            }

            updateBossPhases(dt, dx, dy) {
                const ratio = this.hp / Math.max(1, this.maxHp);
                const nextPhase = ratio <= 0.35 ? 3 : ratio <= 0.70 ? 2 : 1;
                // Do not skip phase 2 even if one hit crosses both thresholds.
                // Every threshold gets its own telegraph and counterplay window.
                if (nextPhase > this.bossPhase && !this.bossSpecial) {
                    this.bossPhase++;
                    this.bossPhaseFlash = .7; // visual-only phase resonance
                    const aimAngle = Math.atan2(dy, dx);
                    const phase = this.bossPhase;
                    const delay = combatDirector ? combatDirector.reserveBossPhase(phase) : 0;
                    this.bossSpecial = { angle: aimAngle, delay, timer: phase === 3 ? 1.35 : 1.15, phase };
                    if (delay < .01) audio.playThreatCue('phase');
                    this.actionTimer = Math.max(this.actionTimer, 1.2);
                    this.secondaryTimer = Math.max(this.secondaryTimer, 1.2);
                    if (this.type === 'BOSS_TITAN') this.state = 'CHASE';
                    if (delay < 0.01) {
                        createFloatingText(this.x, this.y - this.radius - 30,
                            phase === 3 ? '⚠ SON FAZ: ÖZEL SALDIRI!' : '⚠ 2. FAZ: ÖZEL SALDIRI!',
                            this.color, 16);
                    }
                }
                if (!this.bossSpecial) return;
                if (this.bossSpecial.delay > 0) {
                    this.bossSpecial.delay = Math.max(0, this.bossSpecial.delay - dt);
                    if (this.bossSpecial.delay === 0) audio.playThreatCue('phase');
                    return;
                }
                this.bossSpecial.timer -= dt;
                if (this.bossSpecial.timer <= 0 &&
                    (!combatDirector || combatDirector.allowBossAttack(this, 'phase'))) {
                    const attack = this.bossSpecial;
                    this.bossSpecial = null;
                    fireBossPhaseAttack(this, attack.angle, attack.phase);
                    this.actionTimer = Math.max(this.actionTimer, 1.0);
                    this.secondaryTimer = Math.max(this.secondaryTimer, 1.0);
                    this.bossSpecialCount++;
                    if (combatDirector) combatDirector.stats.bossSpecialAttacks++;
                }
            }

            takeDamage(amount, knockVx = 0, knockVy = 0, isCrit = false, triggerChain = true, forceChain = false) {
                let finalDmg = amount;
                if (this.type === 'SHIELD_BEARER' && !isCrit) {
                    finalDmg *= 0.55;
                }
                if (this.type === 'BOSS_TITAN' && !isCrit) {
                    finalDmg *= 0.78;
                }
                if (isCrit && player.evolutions.has('crit_mastery') &&
                    totalTime >= (this.weakpointReadyAt || 0)) {
                    this.weakpointUntil = totalTime + 3;
                    this.weakpointReadyAt = totalTime + 8;
                    player.buildStats.weakpointMarks++;
                } else if (!isCrit && (this.weakpointUntil || 0) > totalTime) {
                    finalDmg *= 1.12;
                }
                if (this.isBoss) {
                    const maxSingleHit = this.maxHp * 0.085;
                    if (finalDmg > maxSingleHit) {
                        finalDmg = maxSingleHit + (finalDmg - maxSingleHit) * 0.25;
                    }
                }

                this.hp -= finalDmg;
                if (this.isBoss) {
                    this.bossHitFlash = 1;
                    if (totalTime >= this.bossNextAccentAt) {
                        const aimX=Math.abs(knockVx)+Math.abs(knockVy)>0.01?knockVx:player.x-this.x;
                        const aimY=Math.abs(knockVx)+Math.abs(knockVy)>0.01?knockVy:player.y-this.y;
                        this.bossHitAngle = Math.atan2(aimY,aimX)-this.rotation;
                        this.bossHitAccentCrit = !!isCrit;
                        this.bossHitAccentAge = .22;
                        this.bossNextAccentAt = totalTime+.12;
                    }
                }
                this.pushVx += knockVx * (this.isBoss ? 0.08 : 1);
                this.pushVy += knockVy * (this.isBoss ? 0.08 : 1);

                createFloatingText(
                    this.x + (Math.random() - 0.5) * 16,
                    this.y - this.radius - 6,
                    Math.round(finalDmg).toString() + (isCrit ? '!' : ''),
                    isCrit ? '#ffe600' : '#ffffff',
                    isCrit ? 17 : 13
                );

                const evolvedArc = player.evolutions.has('lightning');
                if (triggerChain && player.chainLightning > 0 &&
                    (forceChain || (evolvedArc && isCrit) || Math.random() < 0.35)) {
                    if (evolvedArc) player.buildStats.arcSurges++;
                    let jumps = Math.min(player.chainLightning, 8);
                    let lastTarget = this;
                    const visited = new Set([this.id]);

                    while (jumps > 0) {
                        let nextTarget = null;
                        let minDist = evolvedArc ? 235 : 190;
                        for (const other of enemies) {
                            if (visited.has(other.id) || other.dead) continue;
                            const d = Math.hypot(other.x - lastTarget.x, other.y - lastTarget.y);
                            if (d < minDist) {
                                minDist = d;
                                nextTarget = other;
                            }
                        }
                        if (nextTarget) {
                            visited.add(nextTarget.id);
                            emitLightningArc(lastTarget.x, lastTarget.y,
                                nextTarget.x, nextTarget.y, isCrit || evolvedArc);
                            if(lastTarget===this) audio.playWeaponHit('arc',isCrit,false);
                            advanceQuest('CHAIN',1);
                            nextTarget.takeDamage(finalDmg * 0.55, 0, 0, false, false);
                            lastTarget = nextTarget;
                            jumps--;
                        } else {
                            break;
                        }
                    }
                }

                if (this.hp <= 0 && !this.dead) {
                    this.die();
                }
            }

            die() {
                this.dead = true;
                combatDirector?.intensityObserver.recordKill(this, player);
                kills++;
                advanceQuest('KILLS',1);
                if(this.isElite) advanceQuest('ELITE_HUNT',1);

                combo = Math.min(99, combo + 1);
                runMetrics.peakCombo=Math.max(runMetrics.peakCombo,combo);
                comboTimer = COMBO_MAX_TIME;
                advanceQuest('COMBO', combo);

                if (combo === 15) showDopamineBanner('15 KOMBO', '#00f3ff');
                else if (combo === 30) showDopamineBanner('30 KOMBO', '#ff007f');
                else if (combo === 50) showDopamineBanner('50 KOMBO', '#ffe600');

                score += Math.round(this.scoreValue * (1 + combo * 0.12) * getActiveNeonContract().scoreMultiplier);
                player.addOverdrive(this.isBoss ? 45 : (this.isElite ? 16 : 2.8));

                if (player.vampiricHeal > 0 && Math.random() < 0.14 &&
                    totalTime >= (player.lastVampiricHealAt || 0)) {
                    const healed = Math.min(12, player.vampiricHeal, player.maxHp - player.hp);
                    if (healed > 0) {
                        player.hp += healed;
                        player.lastVampiricHealAt = totalTime + 0.65;
                        createFloatingText(player.x, player.y - 24, `+${Math.round(healed)} HP`, '#00ff66', 13);
                    }
                }
                if (player.evolutions.has('vampiric') && !this.isBoss) {
                    player.bloodReactorKills++;
                    if (player.bloodReactorKills >= 5 && totalTime >= player.bloodReactorReadyAt) {
                        player.bloodReactorKills = 0;
                        player.bloodReactorReadyAt = totalTime + 4;
                        const healed = Math.min(8, player.maxHp - player.hp);
                        if (healed > 0) {
                            player.hp += healed;
                            player.buildStats.bloodReactorHeals++;
                            createFloatingText(player.x, player.y - 25, `KAN REAKTÖRÜ +${Math.round(healed)}`, '#00ff88', 14);
                        }
                    }
                }

                if(this.isBoss||this.isElite||this.id%4===0){
                    emitMotionFx(this.isBoss?'BOSS':this.isElite?'ELITE':'KILL',
                        this.x,this.y,{radius:this.isBoss?135:60});
                }
                for (let i = 0; i < (this.isBoss ? 48 : 12); i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const spd = Math.random() * 220 + 50;
                    emitParticle(new Particle(this.x, this.y, Math.cos(angle) * spd, Math.sin(angle) * spd, this.color, Math.random() * 4 + 2, 0.4));
                }

                if (this.type === 'KAMIKAZE') {
                    shockwaves.push(new Shockwave(this.x, this.y, 95, '#ff3300', 0.25));
                    const dToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
                    if (dToPlayer < 95) {
                        player.takeDamage(Math.round(16 * (1 + (wave - 1) * 0.12)));
                    }
                }

                if (this.isElite && wave >= 6) {
                    const ringCount = 6;
                    for (let r = 0; r < ringCount; r++) {
                        const ra = (r * Math.PI * 2) / ringCount;
                        enemyProjectiles.push(new EnemyProjectile(this.x, this.y, Math.cos(ra) * 260, Math.sin(ra) * 260, 6, 16, '#ffe600'));
                    }
                }

                if (this.isElite) {
                    hitStopTimer = 0.045;
                    screenShake = 12;
                    if (combatDirector && combatDirector.registerChestDrop('elite', this.x, this.y)) {
                        createFloatingText(this.x, this.y - 30, 'ELİT TAKVİYE', '#40e9bc', 16);
                    }
                }

                if (this.isBoss) {
                    audio.playBossDeath(this.type);
                    // Visual snapshot only; loot, scoring and Director finish this same tick.
                    if (bossDeathVfx.length >= MAX_BOSS_DEATH_VFX) bossDeathVfx.shift();
                    bossDeathVfx.push({x:this.x,y:this.y,type:this.type,color:this.color,
                        radius:this.radius,age:0,duration:PREFERS_REDUCED_VFX_MOTION?.24:.85});
                    hitStopTimer = 0.08;
                    screenShake = 25;
                    activeBosses = activeBosses.filter(b => b.id !== this.id && !b.dead);
                    if (activeBosses.length === 0) {
                        // The recovery window begins AFTER the final boss dies.
                        nextBossTime = totalTime + Math.max(42, 58 - bossEncounterCount * 3);
                        if (combatDirector) combatDirector.onBossCleared();
                        document.getElementById('bossHudContainer').classList.add('hidden');
                        document.getElementById('bossHudContainer').classList.remove('flex');
                    }
                    shockwaves.push(new Shockwave(this.x, this.y, 350, '#ffe600', 0.65));
                    if (combatDirector) {
                        combatDirector.stats.bossKills++;
                        combatDirector.registerChestDrop('boss', this.x, this.y);
                    } else {
                        lootChests.push(new LootChest(this.x, this.y,'boss'));
                    }
                    for (let i = 0; i < 16; i++) {
                        emitEnergyOrb(
                            this.x + (Math.random() - 0.5) * 90,
                            this.y + (Math.random() - 0.5) * 90,
                            35,
                            i < 8
                        );
                    }
                    showDopamineBanner(`${this.bossName} · İMHA`, '#ffe600');
                } else {
                    const dropGold = Math.random() < (this.type === 'TANK' ? 0.42 : 0.11);
                    emitEnergyOrb(this.x, this.y, this.xpValue, dropGold);

                    if (!dropGold && Math.random() < 0.025) {
                        const pType = Math.random() < 0.5 ? 'MAGNET' : 'CHRONO';
                        powerups.push(new PowerupOrb(this.x, this.y, pType));
                    }
                }

                if (this.type === 'SPLITTER') {
                    const splitCount = wave >= 7 ? 3 : 2;
                    for (let i = 0; i < splitCount; i++) {
                        const offset = (i - 1) * 16;
                        if (enemies.length < MAX_ACTIVE_ENEMIES) {
                            enemies.push(new Enemy(this.x + offset, this.y + offset, 'MINI'));
                        }
                    }
                }

                // Avoid layering a generic explosion on top of the boss death signature.
                if(!this.isBoss) audio.playExplosion(this.type === 'TANK' || this.isElite);
            }

            draw(ctx) {
                // Offscreen sprite culling never touches gameplay or floor attack telegraphs.
                if (this.isBoss && !isBossFxInView(this.x,this.y,this.radius*1.8)) return;
                ctx.save();

                if (this.type === 'DASHER' && this.state === 'CHARGE') {
                    ctx.beginPath();
                    ctx.moveTo(this.x, this.y);
                    const teleLen = this.isBoss ? 480 : 260;
                    ctx.lineTo(this.x + Math.cos(this.dashTargetAngle) * teleLen, this.y + Math.sin(this.dashTargetAngle) * teleLen);
                    ctx.strokeStyle = 'rgba(255, 136, 0, 0.85)';
                    ctx.lineWidth = this.isBoss ? 4 : 2;
                    ctx.setLineDash([8, 6]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                if (this.type === 'SNIPER' && this.actionTimer < 0.85) {
                    ctx.beginPath();
                    ctx.moveTo(this.x, this.y);
                    ctx.lineTo(this.x + Math.cos(this.aimAngle) * 650, this.y + Math.sin(this.aimAngle) * 650);
                    ctx.strokeStyle = this.type === 'BOSS_PRISM' ? 'rgba(0, 243, 255, 0.75)' : 'rgba(255, 0, 170, 0.7)';
                    ctx.lineWidth = this.isBoss ? 2.5 : 1.5;
                    ctx.stroke();
                }

                if (this.type === 'GRAV_WELL') {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.isBoss ? 320 : 240, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(176, 0, 255, 0.22)';
                    ctx.lineWidth = this.isBoss ? 2.5 : 1.5;
                    ctx.stroke();
                }

                ctx.translate(this.x, this.y);
                ctx.rotate(this.rotation);

                if (this.isElite || this.enraged) {
                    ctx.beginPath();
                    ctx.arc(0, 0, this.radius + 8, 0, Math.PI * 2);
                    ctx.strokeStyle = this.enraged ? '#ff0055' : '#ffe600';
                    ctx.lineWidth = 2.5;
                    ctx.setLineDash([5, 4]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                if (this.isBoss) {
                    drawBossIdentity(ctx, this);
                } else {
                    ctx.shadowBlur=getGraphicsBlur(this.isElite?24:14);
                    ctx.shadowColor=this.isElite?'#ffe600':this.color;
                    ctx.fillStyle='rgba(8,10,20,.90)';
                    ctx.strokeStyle=this.color;ctx.lineWidth=2.5;
                    bossPolygon(ctx,this.sides,this.radius);ctx.fill();ctx.stroke();
                    ctx.fillStyle=this.isElite?'#ffe600':this.color;
                    ctx.beginPath();ctx.arc(0,0,this.radius*.35,0,Math.PI*2);ctx.fill();
                }
                ctx.restore();

                if (this.hp < this.maxHp) {
                    const bw = this.radius * 2;
                    const bh = this.isBoss ? 6 : 4;
                    ctx.fillStyle = 'rgba(0,0,0,0.75)';
                    ctx.fillRect(this.x - bw / 2, this.y - this.radius - 13, bw, bh);
                    ctx.fillStyle = this.isElite ? '#ffe600' : this.color;
                    ctx.fillRect(this.x - bw / 2, this.y - this.radius - 13, bw * Math.max(0, this.hp / this.maxHp), bh);
                }
            }
        }

        class EnergyOrb {
            constructor(x, y, value, isGold = false) {
                this.x = x;
                this.y = y;
                this.value = value;
                this.isGold = isGold;
                this.radius = isGold ? 7 : 5.5;
                this.color = isGold ? '#ffe600' : '#00ff66';
                this.dead = false;
                this.magnetized = false;
                this.count = 1;
            }

            update(dt) {
                const dx = player.x - this.x;
                const dy = player.y - this.y;
                const dist = Math.hypot(dx, dy);

                const effectiveMagnet = player.magnetRadius * (1 + (player.momentum / 100) * 0.55) * (player.overdriveActive ? 1.5 : 1.0);
                if ((dist < effectiveMagnet || this.magnetized) && dist > 0.0001) {
                    const pullSpeed = this.magnetized ? 780 : 480;
                    const travel = Math.min(dist, pullSpeed * dt);
                    this.x += (dx / dist) * travel;
                    this.y += (dy / dist) * travel;
                }

                if (dist < player.radius + this.radius + 5) {
                    this.dead = true;
                    if (this.isGold) {
                        const goldAmt = Math.max(1, Math.round((2 + Math.floor(wave / 2)) * player.greedBonus)) * this.count;
                        totalGold += goldAmt;
                        sessionGold += goldAmt;
                        if(combatDirector) combatDirector.onGoldGranted('orbs',goldAmt);
                        pendingMetaSave = true;
                        audio.playOrbPickup(combo, true);
                        createFloatingText(this.x, this.y - 12, `+${goldAmt} ALTIN`, '#ffe600', 14);
                    } else {
                        player.gainXp(this.value);
                        advanceOrbQuestStacks(this.count);
                        audio.playOrbPickup(combo, false);
                    }
                }
            }

            draw(ctx) {
                ctx.save();
                ctx.shadowBlur = getGraphicsBlur(10);
                ctx.shadowColor = this.color;
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.fill();
                if (this.count > 1) {
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = Math.min(3, 0.75 + Math.log2(this.count) * 0.4);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }


        // M5.1: Elite supply drops and guaranteed boss jackpot have separate rules.
        const CHEST_ECONOMY=Object.freeze({
            eliteCooldownSeconds:5,
            eliteGroundCap:4,
            resetSeconds:60,
            // Each successful drop in this 60s window steps to the next tier.
            // Deliberately no per-minute hard cap and no forced pity drop.
            eliteDropChances:Object.freeze([.65,.38,.22,.12,.06])
        });
        function getChestRewardProfile(source,currentWave,xpNext,greed=1){
            const boss=source==='boss';
            return {
                goldHeal:{gold:Math.round((boss?22+currentWave*6:14+currentWave*3)*greed),
                    heal:boss?30:18},
                overdriveXp:{charge:boss?55:32,xp:xpNext*(boss?.45:.28)},
                bulletNova:{shots:boss?24:12,charge:boss?30:18}
            };
        }

        class LootChest {
            constructor(x, y, source = 'elite') {
                this.x = x;
                this.y = y;
                this.source = source==='boss'?'boss':'elite';
                this.radius = 15;
                this.dead = false;
                this.pulse = 0;
            }

            update(dt) {
                this.pulse += dt * 6;
                const dist = Math.hypot(player.x - this.x, player.y - this.y);
                if (dist < player.radius + this.radius + 6) {
                    this.dead = true;
                    audio.playJackpot();
                    screenShake=this.source==='boss'?15:10;
                    const rewardColor=this.source==='boss'?'#ffe600':'#40e9bc';
                    shockwaves.push(new Shockwave(this.x,this.y,180,rewardColor,.36));
                    const profile=getChestRewardProfile(this.source,wave,player.xpToNext,player.greedBonus);
                    const roll=Math.random();
                    if(roll<.38){
                        const gold=profile.goldHeal.gold;
                        const healed=Math.min(profile.goldHeal.heal,player.maxHp-player.hp);
                        totalGold+=gold;sessionGold+=gold;player.hp+=healed;
                        if(combatDirector){
                            combatDirector.onGoldGranted('chests',gold);
                            combatDirector.onChestOpened('goldHeal',this.source,{gold,healed});
                        }
                        saveMetaProgress();
                        showDopamineBanner(this.source==='boss'?
                            `🎰 BOSS JACKPOT · +${gold} ALTIN & +${profile.goldHeal.heal} CAN`:
                            `✦ ELİT TAKVİYE · +${gold} ALTIN & +${profile.goldHeal.heal} CAN`,rewardColor);
                    }else if(roll<.72){
                        player.addOverdrive(profile.overdriveXp.charge);
                        player.gainXp(profile.overdriveXp.xp);
                        if(combatDirector) combatDirector.onChestOpened('overdriveXp',this.source,{
                            charge:profile.overdriveXp.charge,xp:profile.overdriveXp.xp
                        });
                        showDopamineBanner(this.source==='boss'?'🎰 BOSS JACKPOT · DEV XP + CİNNET':
                            '✦ ELİT TAKVİYE · XP + CİNNET',rewardColor);
                    }else{
                        const shots=Math.min(profile.bulletNova.shots,
                            Math.max(0,MAX_PLAYER_PROJECTILES-bullets.length));
                        for(let i=0;i<shots;i++){
                            const a=(i*Math.PI*2)/Math.max(1,shots);
                            bullets.push(new Bullet(player.x,player.y,Math.cos(a)*650,Math.sin(a)*650,
                                player.damage*2.5,7,4,2,true,false));
                        }
                        player.addOverdrive(profile.bulletNova.charge);
                        if(combatDirector) combatDirector.onChestOpened('bulletNova',this.source,{
                            shots,charge:profile.bulletNova.charge
                        });
                        showDopamineBanner(this.source==='boss'?'🎰 BOSS JACKPOT · KUANTUM NOVA':
                            '✦ ELİT TAKVİYE · KUANTUM NOVA',rewardColor);
                    }
                }
            }

            draw(ctx) {
                ctx.save();
                ctx.translate(this.x, this.y);
                const s = 1 + Math.sin(this.pulse) * 0.1;
                ctx.scale(s, s);
                ctx.shadowBlur = getGraphicsBlur(20);
                ctx.shadowColor=this.source==='boss'?'#ffe600':'#40e9bc';
                ctx.fillStyle=this.source==='boss'?'#ffe600':'#2de8bd';
                ctx.strokeStyle='#ffffff';
                ctx.lineWidth=2;
                ctx.beginPath();
                const r = 13;
                for (let i = 0; i < 8; i++) {
                    const a = (i * Math.PI * 2) / 8 + Math.PI / 8;
                    const px = Math.cos(a) * r;
                    const py = Math.sin(a) * r;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#05070f';
                ctx.font = "900 12px 'Orbitron', sans-serif";
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.source==='boss'?'★':'◆', 0, 1);
                ctx.restore();
            }
        }

        class PowerupOrb {
            constructor(x, y, type) {
                this.x = x;
                this.y = y;
                this.type = type;
                this.radius = 11;
                this.dead = false;
                this.color = type === 'MAGNET' ? '#00f3ff' : '#b000ff';
            }

            update(dt) {
                const dist = Math.hypot(player.x - this.x, player.y - this.y);
                if (dist < player.radius + this.radius + 6) {
                    this.dead = true;
                    audio.playJackpot();
                    if (this.type === 'MAGNET') {
                        for (const o of orbs) o.magnetized = true;
                        showDopamineBanner('🧲 KÜRESEL VAKUM AKTİF! TÜM KÜRELER ÇEKİLİYOR!', '#00f3ff');
                    } else {
                        slowMoTimer = 4.5;
                        showDopamineBanner('⏳ ZAMAN KIRILMASI! DÜŞMANLAR %55 YAVAŞLADI!', '#b000ff');
                    }
                }
            }

            draw(ctx) {
                ctx.save();
                ctx.shadowBlur = getGraphicsBlur(16);
                ctx.shadowColor = this.color;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = '#ffffff';
                ctx.font = "700 10px 'Orbitron', sans-serif";
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.type === 'MAGNET' ? 'M' : 'Z', this.x, this.y);
                ctx.restore();
            }
        }

        class Particle {
            constructor(x, y, vx, vy, color, size, life) {
                this.x = x;
                this.y = y;
                this.vx = vx;
                this.vy = vy;
                this.color = color;
                this.size = size;
                this.life = life;
                this.maxLife = life;
            }

            update(dt) {
                this.x += this.vx * dt;
                this.y += this.vy * dt;
                this.vx *= 0.94;
                this.vy *= 0.94;
                this.life -= dt;
            }

            draw(ctx) {
                const alpha = Math.max(0, this.life / this.maxLife);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * alpha, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        class Shockwave {
            constructor(x, y, maxRadius, color, duration = 0.35) {
                this.x = x;
                this.y = y;
                this.maxRadius = maxRadius;
                this.color = color;
                this.duration = duration;
                this.elapsed = 0;
            }

            update(dt) {
                this.elapsed += dt;
            }

            draw(ctx) {
                const p = Math.min(1, this.elapsed / this.duration);
                const r = this.maxRadius * p;
                ctx.save();
                ctx.globalAlpha = 1 - p;
                ctx.strokeStyle = this.color;
                ctx.lineWidth = 4 * (1 - p) + 1;
                ctx.beginPath();
                ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        const RARITIES = [
            { id: 'COMMON', name: 'YAYGIN', mult: 1.0, border: '#38bdf8', badgeBg: 'rgba(56,189,248,0.15)', textCol: '#7dd3fc', weight: 48 },
            { id: 'RARE', name: 'NADİR', mult: 1.35, border: '#a855f7', badgeBg: 'rgba(168,85,247,0.2)', textCol: '#d8b4fe', weight: 30 },
            { id: 'EPIC', name: 'DESTANSI', mult: 1.75, border: '#ec4899', badgeBg: 'rgba(236,72,153,0.25)', textCol: '#f9a8d4', weight: 15 },
            { id: 'LEGENDARY', name: 'EFSANEVİ', mult: 2.3, border: '#eab308', badgeBg: 'rgba(234,179,8,0.3)', textCol: '#fef08a', weight: 7 }
        ];

        function rollRarity() {
            const total = RARITIES.reduce((acc, r) => acc + r.weight, 0);
            let rnd = Math.random() * total;
            for (const r of RARITIES) {
                if (rnd < r.weight) return r;
                rnd -= r.weight;
            }
            return RARITIES[0];
        }

        const EVOLUTION_DEFS = Object.freeze({
            circuit_weaver: { name: 'Yanan Çember', desc: 'Kapatılan devre 3,2 saniye daha elektrikli kalır; sınırdan geçen en fazla 16 düşmana bir kez zarar verir.' },
            phase_echo: { name: 'Çift Yankı', desc: 'Aynı anda iki Faz Yankısı aktif kalabilir; hologram süresi 4,1 saniyeye çıkar.' },
            multishot: { name: 'Odak Rayı', desc: 'Her 4. salvoya güçlü, fazladan iki hedef delen beyaz bir plazma rayı ekler.' },
            firerate: { name: 'Reaktör Ritmi', desc: 'Her 5. salvoda iki ek düşük hasarlı yan plazma atışı üretir.' },
            homing: { name: 'Küme Roketleri', desc: 'İsabet eden ana güdümlü füze iki küçük takip füzesi bırakır.' },
            lightning: { name: 'İyon Ağı', desc: 'Kritik isabetler zincirleme elektriği garanti eder; menzil 235 olur.' },
            overdrive_boost: { name: 'Cinnet Rezonansı', desc: 'Cinnet başladığında yakınındaki en fazla 12 düşman mermisini dağıtır.' },
            crit_mastery: { name: 'Zayıf Nokta', desc: 'Kritik isabet hedefi 3 sn işaretler; normal vuruşlar %12 ek hasar verir. 8 sn bekleme.' },
            vampiric: { name: 'Kan Reaktörü', desc: 'Her 5 düşman imhasında, en sık 4 saniyede bir +8 can geri kazanır.' },
            aegis_shield: { name: 'Aegis Karşı Ateşi', desc: 'Kalkan kırılınca en fazla 3 kısa menzilli takip mermisi ateşler.' },
            kinetic_magnet: { name: 'Kinetik Girdap', desc: 'Dash bitince 4 sn aralıkla yakındaki en fazla 8 düşmana darbe uygular ve küreleri çeker.' },
            orbital: { name: 'Darbe Uyduları', desc: '6 saniyede bir çevrendeki düşmanlara alan darbesi uygular.' },
            pierce_ricochet: { name: 'Prizma Rotası', desc: 'Sekmeler güçlenir ve yakın hedefe yön değiştirebilir.' }
        });
        const SYNERGY_DEFS = Object.freeze([
            { id: 'swarm_guidance', name: 'Sürü Protokolü', modules: ['multishot', 'homing'],
                desc: 'Güdümlü füze her 3 yerine 2 salvoda çıkar.' },
            { id: 'ionic_guidance', name: 'İyon Kılavuzu', modules: ['homing', 'lightning'],
                desc: 'Ana güdümlü füzenin isabeti zincir elektriğini garanti eder.' },
            { id: 'orbital_aegis', name: 'Savunma Matrisi', modules: ['orbital', 'aegis_shield'],
                desc: 'Kalkan kırılınca uydu karşı darbesi olur ve kalkan %12 hızlı dolar.' },
            { id: 'prism_optics', name: 'Prizma Optiği', modules: ['pierce_ricochet', 'crit_mastery'],
                desc: 'Kritik plazma mermisi bir ek hedef deler ve bir kez daha seker.' }
        ]);

        const MAX_MODULE_TIER = 3;
        function normalizePlayerBuildPower(p) {
            // Class bonuses survive, while repeated high-rarity cards cannot grow without bound.
            p.damage = Math.min(p.damage, 240);
            p.critChance = Math.min(p.critChance, 0.60);
            p.fireDelay = Math.max(p.fireDelay, 0.12);
            p.multishot = Math.min(p.multishot, 7);
            p.orbitals = Math.min(p.orbitals, 7);
            p.homingMissiles = Math.min(p.homingMissiles, 5);
            p.chainLightning = Math.min(p.chainLightning, 8);
            p.pierce = Math.min(p.pierce, 9);
            p.ricochet = Math.min(p.ricochet, 6);
            p.overdriveMaxDuration = Math.min(p.overdriveMaxDuration, 12);
            p.overdriveGainMult = Math.min(p.overdriveGainMult, 1.5);
            p.overdriveCritBonus = Math.min(p.overdriveCritBonus, 0.25);
            p.vampiricHeal = Math.min(p.vampiricHeal, 12);
            p.magnetRadius = Math.min(p.magnetRadius, 280);
            p.speed = Math.min(p.speed, 470);
        }

        function getBuildGuideModel(p) {
            return {
                totalModules: Object.keys(p.upgradeCounts).length,
                totalTiers: Object.values(p.upgradeCounts).reduce((sum, tier) => sum + tier, 0),
                evolutions: Object.entries(EVOLUTION_DEFS).filter(([id]) => p.evolutions.has(id))
                    .map(([id, evo]) => evo.name),
                synergies: SYNERGY_DEFS.filter(s => p.synergies.has(s.id)).map(s => s.name),
                nextEvolutions: UPGRADES_POOL.filter(u => (p.upgradeCounts[u.id] || 0) > 0 &&
                        (p.upgradeCounts[u.id] || 0) < MAX_MODULE_TIER)
                    .sort((a,b) => (p.upgradeCounts[b.id] || 0) - (p.upgradeCounts[a.id] || 0))
                    .slice(0, 4).map(u => ({
                        name: EVOLUTION_DEFS[u.id].name,
                        tier: p.upgradeCounts[u.id],
                        missing: MAX_MODULE_TIER - p.upgradeCounts[u.id]
                    })),
                nearSynergies: SYNERGY_DEFS.filter(s => !p.synergies.has(s.id) &&
                    s.modules.some(id => (p.upgradeCounts[id] || 0) > 0))
                    .map(s => ({
                        name: s.name,
                        missing: s.modules.filter(id => (p.upgradeCounts[id] || 0) < 2)
                            .map(id => ({
                                name: UPGRADES_POOL.find(u => u.id === id)?.name || id,
                                current: p.upgradeCounts[id] || 0
                            }))
                    })).sort((a,b) => a.missing.reduce((n,x) => n + 2 - x.current, 0) -
                        b.missing.reduce((n,x) => n + 2 - x.current, 0)).slice(0, 4)
            };
        }

        function updateBuildGuide() {
            const panel = document.getElementById('buildGuideDetails');
            if (!panel || !player) return;
            const info = getBuildGuideModel(player);
            const summary = document.getElementById('buildGuideLabel');
            if (summary) summary.textContent = `BUILD · ${info.evolutions.length} EVRİM / ${info.synergies.length} SİNERJİ`;
            const section = (title, rows, empty) =>
                `<div class="mt-2 text-cyan-300 font-bold">${title}</div>` +
                (rows.length ? rows.map(row => `<p class="mt-1 text-gray-200">${row}</p>`).join('') :
                    `<p class="text-gray-500">${empty}</p>`);
            panel.innerHTML =
                `<p class="text-gray-400">Modül: ${info.totalModules} / ${UPGRADES_POOL.length} · Kademe: ${info.totalTiers} / ${UPGRADES_POOL.length * MAX_MODULE_TIER}</p>` +
                section('AÇIK EVRİMLER', info.evolutions, 'Henüz evrim yok') +
                section('AKTİF SİNERJİLER', info.synergies, 'Henüz sinerji yok') +
                section('EVRİME YAKIN', info.nextEvolutions.map(x =>
                    `${x.name} · Kademe ${x.tier}/3 (${x.missing} kaldı)`), 'Modül seçerek ilerle') +
                section('SİNERJİ HEDEFLERİ', info.nearSynergies.map(s =>
                    `${s.name}: ${s.missing.map(x => `${x.name} ${x.current}/2`).join(', ')}`),
                    'İki modül seçince hedefler görünür');
        }

        function newSynergiesForUpgrade(upgradeCounts, id) {
            const proposed = { ...upgradeCounts, [id]: (upgradeCounts[id] || 0) + 1 };
            return SYNERGY_DEFS.filter(syn =>
                syn.modules.every(key => (proposed[key] || 0) >= 2) &&
                !syn.modules.every(key => (upgradeCounts[key] || 0) >= 2));
        }

        const UPGRADES_POOL = [
            {
                id: 'circuit_weaver',
                name: 'Devre Dokuyucu',
                icon: 'fa-solid fa-draw-polygon',
                color: '#ffe66d',
                getDesc: () => 'Hareketinle kapalı bir devre çiz: içindeki en fazla 16 düşmanı vur. Dash devreyi sıfırlar. 3. kademede sınırı elektrikli bırak.',
                apply: () => { /* Drawn movement path supplies the attack, not a weapon stat. */ }
            },
            {
                id: 'phase_echo',
                name: 'Faz Yankısı',
                icon: 'fa-solid fa-clone',
                color: '#6df7ff',
                getDesc: () => 'Dash sonrasında geride bir hologram bırakır. Yakındaki en fazla 6 sıradan düşman kısa süreliğine holograma yönelir. Boss ve menzilli düşmanlar etkilenmez.',
                apply: () => { /* Passive ability uses upgradeCounts, not combat stats. */ }
            },
            {
                id: 'multishot',
                name: 'Çatallı Plazma',
                icon: 'fa-solid fa-burst',
                color: '#00f3ff',
                getDesc: (r) => `Her atışta +${r.id === 'LEGENDARY' ? 2 : 1} ekstra plazma mermisi ve +%${Math.round(8 * r.mult)} hasar kazandırır.`,
                apply: (p, r) => {
                    p.multishot += (r.id === 'LEGENDARY' ? 2 : 1);
                    p.damage *= (1 + 0.08 * r.mult);
                }
            },
            {
                id: 'firerate',
                name: 'Hiper-Reaktör',
                icon: 'fa-solid fa-gauge-high',
                color: '#ff007f',
                getDesc: (r) => `Atış hızını +%${Math.round(16 * r.mult)} ve mermi hızını +%12 artırır.`,
                apply: (p, r) => {
                    p.fireDelay = Math.max(0.08, p.fireDelay * (1 - 0.12 * Math.min(1.8, r.mult)));
                    p.bulletSpeed *= 1.12;
                }
            },
            {
                id: 'orbital',
                name: 'Plazma Uydusu',
                icon: 'fa-solid fa-satellite',
                color: '#ffe600',
                getDesc: (r) => `Çekirdek etrafında dönen +${r.id === 'LEGENDARY' ? 2 : 1} koruyucu plazma uydusu ekler.`,
                apply: (p, r) => {
                    p.orbitals += (r.id === 'LEGENDARY' ? 2 : 1);
                    p.orbitalSpeed += 0.35 * r.mult;
                }
            },
            {
                id: 'pierce_ricochet',
                name: 'Kuantum Sekme',
                icon: 'fa-solid fa-arrows-split-up-and-left',
                color: '#b000ff',
                getDesc: (r) => `Mermiler +1 düşman deler ve ekran kenarlarından +${r.id === 'LEGENDARY' ? 2 : 1} kez seker.`,
                apply: (p, r) => {
                    p.pierce += 1;
                    p.ricochet += (r.id === 'LEGENDARY' ? 2 : 1);
                    p.damage *= (1 + 0.12 * r.mult);
                }
            },
            {
                id: 'homing',
                name: 'Güdümlü Mikro-Füze',
                icon: 'fa-solid fa-rocket',
                color: '#00ff66',
                getDesc: (r) => `Her 3 atışta bir en yakın düşmanı kovalayan +${r.id === 'LEGENDARY' ? 2 : 1} güdümlü füze ateşler.`,
                apply: (p, r) => {
                    p.homingMissiles += (r.id === 'LEGENDARY' ? 2 : 1);
                }
            },
            {
                id: 'lightning',
                name: 'Zincirleme Yıldırım',
                icon: 'fa-solid fa-bolt-lightning',
                color: '#ffe600',
                getDesc: (r) => `Mermiler vurduğu düşmandan yakındaki +${Math.ceil(1.5 * r.mult)} hedefe elektrik arkı sıçratır.`,
                apply: (p, r) => {
                    p.chainLightning += Math.ceil(1.5 * r.mult);
                }
            },
            {
                id: 'overdrive_boost',
                name: 'Siber Cinnet Çip Ekstresi',
                icon: 'fa-solid fa-fire-flame-curved',
                color: '#ff0055',
                getDesc: (r) => `Siber Cinnet süresini +${(1.5 * r.mult).toFixed(1)}s uzatır, dolum hızını ve cinnet üstü kritiğini güçlendirir.`,
                apply: (p, r) => {
                    p.overdriveMaxDuration += 1.5 * r.mult;
                    p.overdriveGainMult += 0.18 * r.mult;
                    p.overdriveCritBonus += 0.1 * r.mult;
                }
            },
            {
                id: 'crit_mastery',
                name: 'Kuantum Optik Nişangah',
                icon: 'fa-solid fa-crosshairs',
                color: '#38bdf8',
                getDesc: (r) => `Kritik vuruş şansını +%${Math.round(12 * r.mult)} ve kritik hasar çarpanını artırır.`,
                apply: (p, r) => {
                    p.critChance += 0.12 * r.mult;
                    p.damage *= (1 + 0.05 * r.mult);
                }
            },
            {
                id: 'vampiric',
                name: 'Vampirik Zırh',
                icon: 'fa-solid fa-heart-pulse',
                color: '#00ff88',
                getDesc: (r) => `Maksimum canı +${Math.round(25 * r.mult)} artırır, düşman imhasında can yenileme kazandırır.`,
                apply: (p, r) => {
                    const addHp = Math.round(25 * r.mult);
                    p.maxHp += addHp;
                    p.hp = Math.min(p.maxHp, p.hp + addHp);
                    p.vampiricHeal += Math.ceil(2.5 * r.mult);
                }
            },
            {
                id: 'aegis_shield',
                name: 'Aegis Enerji Kalkanı',
                icon: 'fa-solid fa-shield-halved',
                color: '#00f3ff',
                getDesc: (r) => `Tek darbeyi tamamen yok sayan enerji kalkanı verir ve dolum süresini %${Math.round(14 * r.mult)} kısaltır.`,
                apply: (p, r) => {
                    p.hasShield = true;
                    p.shieldActive = true;
                    p.shieldMaxCooldown = Math.max(4.5, p.shieldMaxCooldown * (1 - 0.12 * r.mult));
                }
            },
            {
                id: 'kinetic_magnet',
                name: 'Kinetik Türbin & Vakum',
                icon: 'fa-solid fa-magnet',
                color: '#38bdf8',
                getDesc: (r) => `Hareket hızını +%${Math.round(10 * r.mult)}, çekim alanını +%35 artırır ve EMP Nova süresini kısaltır.`,
                apply: (p, r) => {
                    p.speed *= (1 + 0.10 * r.mult);
                    p.magnetRadius *= 1.35;
                    p.novaMaxCooldown = Math.max(4.5, p.novaMaxCooldown * 0.85);
                }
            }
        ];

        let player = null;
        let bullets = [];
        let enemyProjectiles = [];
        let enemies = [];
        let orbs = [];
        let lootChests = [];
        let powerups = [];
        let conduitZones = [];
        let particles = [];
        let floatingTexts = [];
        let shockwaves = [];
        let lightningBolts = [];
        let lightningArcSequence = 0;
        const MAX_LIGHTNING_ARCS = 32;
        let weaponImpacts = [];
        let weaponImpactFrameCount = 0;
        const MAX_WEAPON_IMPACTS = 56;
        const MAX_IMPACTS_PER_FRAME = 7;
        const MAX_ACTIVE_ORBS = 240;
        const MAX_PLAYER_PROJECTILES = 260;
        let pendingMetaSave = false;
        let spawnTimer = 0;
        let conduitSpawnTimer = 4.0;

        // M5.26: Tactical field engineering. Devices are physical, temporary
        // targets, completely separate from the gold, XP and upgrade economy.
        // A capacitor is an optional risky blast; a graviton pylon is control.
        const FIELD_RULES=Object.freeze({
            maxDevices:2,firstWave:2,waveInterval:3,
            life:13.5,triggerRadius:24,blastRadius:166,
            blastDamage:54,blastTargets:12,blastFuse:.52,
            friendlyBlastDamage:13,chainRadius:190,chainFuse:.22,
            gravityRadius:175,gravityDuration:4.2,enemyTimeScale:.55,
            novaReach:290
        });
        const FIELD_DEVICE_TYPES=Object.freeze({
            CAPACITOR:{label:'KARARSIZ REAKTÖR',color:'#ffb15e'},
            GRAVITON:{label:'GRAVİTON DİREĞİ',color:'#80daff'}
        });
        let fieldDevices=[];
        let fieldDeviceLastWave=0;
        let fieldDeviceCounter=0;
        let fieldDeviceStats={spawned:0,triggered:0,blasts:0,
            gravityFields:0,chainReactions:0,enemyHits:0,
            playerHits:0,expired:0,cancelled:0,shotsCaptured:0};
        function resetFieldDevices(){
            fieldDevices=[];fieldDeviceLastWave=0;fieldDeviceCounter=0;
            fieldDeviceStats={spawned:0,triggered:0,blasts:0,
                gravityFields:0,chainReactions:0,enemyHits:0,
                playerHits:0,expired:0,cancelled:0,shotsCaptured:0};
        }
        function getFieldDeviceSnapshot(){
            return {limit:FIELD_RULES.maxDevices,
                devices:fieldDevices.map(d=>({
                    id:d.id,kind:d.kind,state:d.state,
                    x:d.x,y:d.y,radius:FIELD_RULES.triggerRadius,
                    remaining:Math.max(0,Math.round(d.life*10)/10),
                    fuse:Math.max(0,Math.round(d.fuse*100)/100),
                    source:d.source,
                    effectRemaining:Math.max(0,Math.round(d.effect*10)/10)
                })),stats:{...fieldDeviceStats}};
        }
        function spawnFieldDevice(kind,x,y){
            if(!Object.hasOwn(FIELD_DEVICE_TYPES,kind)||
                fieldDevices.length>=FIELD_RULES.maxDevices||
                !Number.isFinite(x)||!Number.isFinite(y))return null;
            const d={id:++fieldDeviceCounter,kind,x,y,
                state:'idle',source:'',fuse:0,effect:0,
                life:FIELD_RULES.life,age:0};
            fieldDevices.push(d);fieldDeviceStats.spawned++;
            return d;
        }
        function maybeSpawnFieldDevice(){
            if(wave<FIELD_RULES.firstWave ||
                (wave-FIELD_RULES.firstWave)%FIELD_RULES.waveInterval!==0||
                fieldDeviceLastWave===wave||fieldDevices.length>=FIELD_RULES.maxDevices||
                activeBosses.some(b=>!b.dead)||nextBossTime-totalTime<7||
                combatDirector?.activeArenaEvent||!player)return false;
            // One attempt per eligible wave. No catch-up spawning on subsequent frames.
            fieldDeviceLastWave=wave;
            const kind=(Math.floor((wave-FIELD_RULES.firstWave)/
                FIELD_RULES.waveInterval)%2===0)?'CAPACITOR':'GRAVITON';
            const minX=55,maxX=Math.max(55,worldWidth-55);
            const minY=55,maxY=Math.max(55,worldHeight-55);
            for(let i=0;i<8;i++){
                const a=Math.random()*Math.PI*2;
                const distance=175+Math.random()*85;
                const x=Math.min(maxX,Math.max(minX,player.x+Math.cos(a)*distance));
                const y=Math.min(maxY,Math.max(minY,player.y+Math.sin(a)*distance));
                if(Math.hypot(x-player.x,y-player.y)<100 ||
                    conduitZones.some(c=>Math.hypot(x-c.x,y-c.y)<115)||
                    (activeQuest?.point&&
                        Math.hypot(x-activeQuest.point.x,y-activeQuest.point.y)<110))
                    continue;
                const d=spawnFieldDevice(kind,x,y);
                if(d){
                    createFloatingText(x,y-35,kind==='CAPACITOR'?
                        'REAKTÖR SAHADA':'GRAVİTON SAHADA',
                        FIELD_DEVICE_TYPES[kind].color,13);
                    return true;
                }
            }
            return false;
        }
        function triggerFieldDevice(d,source='shot'){
            if(!d||d.state!=='idle')return false;
            d.source=source;
            fieldDeviceStats.triggered++;
            if(d.kind==='CAPACITOR'){
                d.state='armed';
                d.fuse=source==='chain'?FIELD_RULES.chainFuse:FIELD_RULES.blastFuse;
                if(source==='chain')fieldDeviceStats.chainReactions++;
            }else{
                d.state='field';
                d.effect=FIELD_RULES.gravityDuration;
                fieldDeviceStats.gravityFields++;
                shockwaves.push(new Shockwave(d.x,d.y,
                    FIELD_RULES.gravityRadius,'#80daff',.28));
            }
            return true;
        }
        function blastFieldCapacitor(d){
            if(!d||d.state!=='armed')return false;
            d.state='spent';fieldDeviceStats.blasts++;
            shockwaves.push(new Shockwave(d.x,d.y,
                FIELD_RULES.blastRadius,'#ffae59',.38));
            emitMotionFx('NOVA',d.x,d.y,{radius:FIELD_RULES.blastRadius});
            let victims=0;
            for(const e of enemies){
                if(e.dead||e.isBoss||victims>=FIELD_RULES.blastTargets)continue;
                const dx=e.x-d.x,dy=e.y-d.y;
                const dist=Math.hypot(dx,dy);
                if(dist>FIELD_RULES.blastRadius+e.radius)continue;
                const n=dist||1;
                e.takeDamage(FIELD_RULES.blastDamage,
                    dx/n*280,dy/n*280,false,false);
                fieldDeviceStats.enemyHits++;victims++;
            }
            if(player&&Math.hypot(player.x-d.x,player.y-d.y)<
                FIELD_RULES.blastRadius+player.radius){
                const hpBefore=player.hp,shieldBefore=player.shieldActive;
                player.takeDamage(FIELD_RULES.friendlyBlastDamage);
                if(player.hp<hpBefore||player.shieldActive!==shieldBefore)
                    fieldDeviceStats.playerHits++;
            }
            // Chain explosions are finite: at most MAX_FIELD_DEVICES-1 neighbors.
            for(const other of fieldDevices){
                if(other===d||other.kind!=='CAPACITOR'||other.state!=='idle')continue;
                if(Math.hypot(other.x-d.x,other.y-d.y)<=FIELD_RULES.chainRadius)
                    triggerFieldDevice(other,'chain');
            }
            return true;
        }
        function pointNearBulletSegment(b,x,y,reach){
            const ax=Number.isFinite(b.previousX)?b.previousX:b.x;
            const ay=Number.isFinite(b.previousY)?b.previousY:b.y;
            const dx=b.x-ax,dy=b.y-ay,len2=dx*dx+dy*dy;
            const t=len2>0?Math.max(0,Math.min(1,
                ((x-ax)*dx+(y-ay)*dy)/len2)):0;
            const ox=ax+dx*t-x,oy=ay+dy*t-y;
            return ox*ox+oy*oy<=reach*reach;
        }
        function updateFieldDevices(dt){
            if(!player||!fieldDevices.length)return;
            for(let i=fieldDevices.length-1;i>=0;i--){
                const d=fieldDevices[i];d.age+=dt;
                if(d.state==='idle'){
                    d.life-=dt;
                    if(d.life<=0){
                        fieldDeviceStats.expired++;fieldDevices.splice(i,1);continue;
                    }
                    if(player.isDashing&&Math.hypot(player.x-d.x,player.y-d.y)<=
                        FIELD_RULES.triggerRadius+player.radius+9)
                        triggerFieldDevice(d,'dash');
                    if(d.state!=='idle')continue;
                    // Swept player projectile detection avoids tunneling at high speed.
                    for(const b of bullets){
                        if(b.dead)continue;
                        if(pointNearBulletSegment(b,d.x,d.y,
                            FIELD_RULES.triggerRadius+b.radius)){
                            if(triggerFieldDevice(d,'shot')){
                                b.dead=true;fieldDeviceStats.shotsCaptured++;
                            }
                            break;
                        }
                    }
                    // Enemy fire can unexpectedly activate the prop too.
                    if(d.state==='idle'){
                        for(const ep of enemyProjectiles){
                            if(ep.dead)continue;
                            if(Math.hypot(ep.x-d.x,ep.y-d.y)<=
                                FIELD_RULES.triggerRadius+ep.radius){
                                if(triggerFieldDevice(d,'enemy')){
                                    ep.dead=true;fieldDeviceStats.shotsCaptured++;
                                }
                                break;
                            }
                        }
                    }
                }else if(d.state==='armed'){
                    d.fuse-=dt;
                    if(d.fuse<=0)blastFieldCapacitor(d);
                }else if(d.state==='field'){
                    d.effect-=dt;
                    if(d.effect<=0)d.state='spent';
                }
                if(d.state==='spent')fieldDevices.splice(i,1);
            }
        }
        function getFieldEnemyTimeScale(enemy){
            if(enemy.isBoss||enemy.dead)return 1;
            for(const d of fieldDevices){
                if(d.kind==='GRAVITON'&&d.state==='field'&&
                    Math.hypot(enemy.x-d.x,enemy.y-d.y)<
                        FIELD_RULES.gravityRadius+enemy.radius)
                    return FIELD_RULES.enemyTimeScale;
            }
            return 1;
        }
        function cancelFieldDevices(){
            if(fieldDevices.length)fieldDeviceStats.cancelled+=fieldDevices.length;
            fieldDevices=[];
        }
        function drawFieldDevices(target){
            if(!fieldDevices.length)return;
            for(const d of fieldDevices){
                if(!isFxInsideViewport(d.x,d.y,FIELD_RULES.gravityRadius,12))
                    continue;
                const cap=d.kind==='CAPACITOR';
                const color=FIELD_DEVICE_TYPES[d.kind].color;
                target.save();target.translate(d.x,d.y);
                const phase=PREFERS_REDUCED_VFX_MOTION?0:totalTime*1.7;
                const size=FIELD_RULES.triggerRadius;
                target.strokeStyle=color;target.fillStyle=color;
                target.globalAlpha=.85;target.lineWidth=2;
                if(d.state==='armed'||d.state==='field'){
                    const r=d.state==='armed'?FIELD_RULES.blastRadius:
                        FIELD_RULES.gravityRadius;
                    target.fillStyle=d.state==='armed'?
                        'rgba(255,115,69,.12)':'rgba(74,184,255,.09)';
                    target.beginPath();target.arc(0,0,r,0,Math.PI*2);
                    target.fill();
                    target.strokeStyle=d.state==='armed'?'#ff9666':'#8aefff';
                    target.globalAlpha=.8;
                    target.setLineDash([8,9]);
                    target.stroke();target.setLineDash([]);
                }
                target.rotate(phase);
                target.beginPath();
                for(let n=0;n<=6;n++){
                    const a=n*Math.PI/3;
                    if(n===0)target.moveTo(Math.cos(a)*size,Math.sin(a)*size);
                    else target.lineTo(Math.cos(a)*size,Math.sin(a)*size);
                }
                target.closePath();target.stroke();
                target.rotate(-phase);
                target.fillStyle=color;
                if(cap){
                    target.beginPath();
                    target.moveTo(-6,-12);target.lineTo(4,-3);
                    target.lineTo(-2,2);target.lineTo(7,13);
                    target.lineTo(-8,1);target.lineTo(-1,-3);
                    target.closePath();target.fill();
                }else{
                    for(let n=0;n<4;n++){
                        const a=n*Math.PI/2;
                        target.beginPath();target.arc(Math.cos(a)*8,
                            Math.sin(a)*8,3,0,Math.PI*2);target.fill();
                    }
                }
                target.rotate(0);
                target.font="700 11px 'Segoe UI',sans-serif";
                target.textAlign='center';target.fillStyle=color;
                target.fillText(d.state==='armed'?'KAÇ · '+Math.max(0,d.fuse).toFixed(1)+'s':
                    d.state==='field'?'YAVAŞLATMA · '+Math.ceil(d.effect)+'s':
                    cap?'REAKTÖR · TETİKLE':'GRAVİTON · TETİKLE',
                    0,-FIELD_RULES.triggerRadius-15);
                target.restore();
            }
        }
        function updateFieldDeviceHud(){
            const chip=document.getElementById('fieldDeviceBadge');
            if(!chip)return;
            const d=fieldDevices.find(e=>e.state==='armed')||
                fieldDevices.find(e=>e.state==='field')||fieldDevices[0];
            if(!d){chip.classList.add('hidden');return;}
            chip.classList.remove('hidden');
            chip.dataset.kind=d.kind;
            chip.dataset.state=d.state;
            const text=d.state==='armed'?
                'REAKTÖR PATLAYACAK · '+Math.max(0,d.fuse).toFixed(1)+'sn · UZAKLAŞ':
                d.state==='field'?
                    'GRAVİTON AKTİF · '+Math.ceil(d.effect)+'sn DÜŞMANLAR YAVAŞ':
                d.kind==='CAPACITOR'?
                    'KARARSIZ REAKTÖR · ATEŞ / ATILIM / NOVA · PATLAMA RİSKİ':
                    'GRAVİTON DİREĞİ · ATEŞ / ATILIM / NOVA · YAVAŞLATMA';
            if(chip.textContent!==text)chip.textContent=text;
        }

        const MAX_VISIBLE_PARTICLES = 420;

        // M5.24: event-driven motion grammar, separate from gameplay and the
        // existing particle budget. No emitters, per-frame DOM, or image assets.
        const MOTION_FX_LIMITS=Object.freeze({
            high:Object.freeze({live:64,frame:8,facets:9,ambient:3}),
            medium:Object.freeze({live:30,frame:5,facets:6,ambient:2}),
            low:Object.freeze({live:12,frame:3,facets:3,ambient:0})
        });
        const MOTION_FX_LIFE=Object.freeze({
            DASH:.31,NOVA:.65,PRISM:.37,KILL:.32,
            ELITE:.58,WAVE:.72,BOSS:1.05,OVERDRIVE:.68
        });
        const MOTION_FX_COLORS=Object.freeze({
            DASH:'#66efff',NOVA:'#d8a2ff',PRISM:'#bffaff',
            KILL:'#ff8aaf',ELITE:'#ffde93',WAVE:'#75f7ff',
            BOSS:'#ff6d97',OVERDRIVE:'#ff5fb8'
        });
        let motionFx=[],motionFxFrameCount=0,motionDashClock=0;
        let motionDashLastX=0,motionDashLastY=0;
        let motionFxStats={emitted:0,drawn:0,culled:0,
            capDropped:0,frameDropped:0,qualityDropped:0,
            highWater:0,byKind:{}};
        function resetMotionFx(){
            motionFx=[];motionFxFrameCount=0;motionDashClock=0;
            motionDashLastX=0;motionDashLastY=0;
            motionFxStats={emitted:0,drawn:0,culled:0,
                capDropped:0,frameDropped:0,qualityDropped:0,
                highWater:0,byKind:{}};
        }
        function emitMotionFx(kind,x,y,options=null){
            if(gameState!=='PLAYING'||!Number.isFinite(x)||!Number.isFinite(y)||
                !Object.hasOwn(MOTION_FX_LIFE,kind))return false;
            // Reduced motion never animates ambient / continuous dash trails.
            if(PREFERS_REDUCED_VFX_MOTION&&(kind==='DASH'||kind==='KILL'))
                {motionFxStats.qualityDropped++;return false;}
            if(graphicsQuality==='low'&&(kind==='DASH'||kind==='KILL'))
                {motionFxStats.qualityDropped++;return false;}
            const critical=kind==='BOSS'||kind==='WAVE'||kind==='NOVA'||kind==='OVERDRIVE';
            if(!isFxInsideViewport(x,y,120,80)){
                motionFxStats.culled++;return false;
            }
            const budget=MOTION_FX_LIMITS[graphicsQuality];
            // Reserve two short-lived issue slots for boss/wave/ability cues,
            // without EVER exceeding the frame budget in a dense volley.
            const reserved=Math.min(2,budget.frame-1);
            if(motionFxFrameCount>=budget.frame-(critical?0:reserved)){
                motionFxStats.frameDropped++;return false;
            }
            if(motionFx.length>=budget.live){
                if(!critical){motionFxStats.capDropped++;return false;}
                // Replace an old low-priority flourish, never expand allocation.
                const index=motionFx.findIndex(e=>e.kind==='DASH'||
                    e.kind==='KILL'||e.kind==='PRISM');
                if(index<0){motionFxStats.capDropped++;return false;}
                motionFx.splice(index,1);
            }
            const duration=MOTION_FX_LIFE[kind]*
                (PREFERS_REDUCED_VFX_MOTION?.45:1);
            motionFx.push({kind,x,y,fromX:options?.fromX??x,
                fromY:options?.fromY??y,angle:options?.angle??0,
                radius:options?.radius??72,age:0,duration,
                seed:motionFxStats.emitted+1});
            motionFxFrameCount++;
            motionFxStats.emitted++;
            motionFxStats.byKind[kind]=(motionFxStats.byKind[kind]||0)+1;
            motionFxStats.highWater=Math.max(motionFxStats.highWater,motionFx.length);
            return true;
        }
        function updateMotionFx(dt){
            for(let i=motionFx.length-1;i>=0;i--){
                const e=motionFx[i];
                e.age+=dt;
                if(e.age>=e.duration)motionFx.splice(i,1);
            }
        }
        function sampleMotionDash(dt){
            if(!player)return;
            if(!player.isDashing){
                motionDashClock=0;
                motionDashLastX=player.x;motionDashLastY=player.y;
                return;
            }
            motionDashClock+=dt;
            const cadence=graphicsQuality==='high'?.035:.075;
            if(motionDashClock<cadence)return;
            motionDashClock%=cadence;
            emitMotionFx('DASH',player.x,player.y,{
                fromX:motionDashLastX,fromY:motionDashLastY,
                angle:Math.atan2(player.y-motionDashLastY,
                    player.x-motionDashLastX)});
            motionDashLastX=player.x;motionDashLastY=player.y;
        }
        function motionFxSnapshot(){
            return {active:motionFx.length,
                limit:MOTION_FX_LIMITS[graphicsQuality].live,
                perFrame:MOTION_FX_LIMITS[graphicsQuality].frame,
                byKind:{...motionFxStats.byKind},...motionFxStats,
                kinds:motionFx.map(e=>e.kind)};
        }
        function drawMotionBackdrop(target){
            if(gameState!=='PLAYING'||PREFERS_REDUCED_VFX_MOTION)return;
            const budget=MOTION_FX_LIMITS[graphicsQuality];
            if(!budget.ambient)return;
            const w=worldWidth,h=worldHeight;
            const tone=arenaChapter==='FOUNDRY'?'#ff9c69':
                arenaChapter==='GARDEN'?'#80ffcb':
                arenaChapter==='RIFT'?'#bb87ff':'#42d5ed';
            target.save();
            target.strokeStyle=tone;
            target.lineWidth=1;
            target.globalAlpha=.12;
            // Constant work: two or three thin drifting locator rays, not a
            // full-screen animated particle grid or expensive gradients.
            for(let i=0;i<budget.ambient;i++){
                const x=((totalTime*(10+i*3)+i*w/budget.ambient)%Math.max(1,w));
                target.beginPath();
                target.moveTo(x,0);
                target.lineTo(x-36,h);
                target.stroke();
            }
            target.restore();
        }
        function drawMotionFx(target){
            const budget=MOTION_FX_LIMITS[graphicsQuality];
            const begin=Math.max(0,motionFx.length-budget.live);
            for(let index=begin;index<motionFx.length;index++){
                const fx=motionFx[index];
                if(!isFxInsideViewport(fx.x,fx.y,fx.radius,90)){
                    if(performanceOverlayOn)pc3RenderCounts.skipped++;
                    continue;
                }
                const progress=Math.min(1,fx.age/fx.duration);
                const fade=1-progress;
                const steps=budget.facets;
                const color=MOTION_FX_COLORS[fx.kind];
                target.save();
                target.translate(fx.x,fx.y);
                target.rotate(fx.angle);
                target.strokeStyle=color;
                target.fillStyle=color;
                target.lineWidth=2;
                target.globalAlpha=Math.min(1,fade*.9);
                if(fx.kind==='DASH'){
                    const dx=fx.fromX-fx.x,dy=fx.fromY-fx.y;
                    const length=Math.min(82,Math.hypot(dx,dy));
                    const theta=Math.atan2(dy,dx)-fx.angle;
                    const ux=Math.cos(theta),uy=Math.sin(theta);
                    for(const side of [-1,1]){
                        const ox=-uy*side*8,oy=ux*side*8;
                        target.beginPath();
                        target.moveTo(ox,oy);
                        target.lineTo(ox+ux*(length+20*fade),
                            oy+uy*(length+20*fade));
                        target.lineWidth=side===1?3:1.5;
                        target.stroke();
                    }
                }else if(fx.kind==='PRISM'){
                    // A crystal splinter fan; angle follows the incoming shot.
                    for(let i=0;i<steps;i++){
                        const a=-1.05+i*2.1/Math.max(1,steps-1);
                        const distance=(14+progress*53)*(i%2===0?1:.75);
                        const x=Math.cos(a)*distance,y=Math.sin(a)*distance;
                        target.beginPath();
                        target.moveTo(x,y-6*fade);
                        target.lineTo(x+4*fade,y);
                        target.lineTo(x,y+11*fade);
                        target.lineTo(x-4*fade,y);
                        target.closePath();target.stroke();
                    }
                }else if(fx.kind==='KILL'||fx.kind==='ELITE'){
                    // Ordinary kills are tiny; elite kills get a distinct
                    // hexagonal execution stamp without spawning new particles.
                    const points=fx.kind==='ELITE'?6:3;
                    const reach=(fx.kind==='ELITE'?52:23)*(0.3+.7*progress);
                    for(let i=0;i<points;i++){
                        const a=i*2*Math.PI/points+fx.seed*.39;
                        const x=Math.cos(a)*reach,y=Math.sin(a)*reach;
                        target.beginPath();
                        target.moveTo(x,y-7*fade);
                        target.lineTo(x+6*fade,y+4*fade);
                        target.lineTo(x-6*fade,y+4*fade);
                        target.closePath();
                        target.stroke();
                    }
                    if(fx.kind==='ELITE'){
                        target.beginPath();
                        for(let i=0;i<=6;i++){
                            const a=i*Math.PI/3-Math.PI/6;
                            const x=Math.cos(a)*reach*.7,y=Math.sin(a)*reach*.7;
                            if(i===0)target.moveTo(x,y);else target.lineTo(x,y);
                        }
                        target.stroke();
                    }
                }else if(fx.kind==='NOVA'||fx.kind==='OVERDRIVE'){
                    // Counter-rotating energy petals; sparse lines, no blur.
                    for(let i=0;i<steps;i++){
                        const a=i*2*Math.PI/steps+(PREFERS_REDUCED_VFX_MOTION?
                            0:progress*(fx.kind==='NOVA'?.55:-.9));
                        const reach=(fx.kind==='NOVA'?fx.radius:100)*
                            (.24+progress*.72);
                        target.beginPath();
                        target.moveTo(Math.cos(a)*reach,Math.sin(a)*reach);
                        target.lineTo(Math.cos(a+.16)*(reach+16*fade),
                            Math.sin(a+.16)*(reach+16*fade));
                        target.lineTo(Math.cos(a+.32)*(reach+27*fade),
                            Math.sin(a+.32)*(reach+27*fade));
                        target.stroke();
                    }
                }else if(fx.kind==='WAVE'||fx.kind==='BOSS'){
                    // Chapter-start compass vs. threatening boss summon seal.
                    const sides=fx.kind==='BOSS'?8:4;
                    const r=fx.radius*(.38+.64*progress);
                    for(let i=0;i<sides;i++){
                        const a=i*2*Math.PI/sides+
                            (PREFERS_REDUCED_VFX_MOTION?0:progress*.3);
                        const x=Math.cos(a)*r,y=Math.sin(a)*r;
                        target.beginPath();
                        target.moveTo(x+Math.cos(a-.32)*12*fade,
                            y+Math.sin(a-.32)*12*fade);
                        target.lineTo(x,y);
                        target.lineTo(x+Math.cos(a+.32)*12*fade,
                            y+Math.sin(a+.32)*12*fade);
                        target.stroke();
                    }
                    if(fx.kind==='BOSS'){
                        target.beginPath();
                        target.arc(0,0,r*.7,0,Math.PI*2);
                        target.stroke();
                        target.beginPath();
                        target.moveTo(-r*.24,0);target.lineTo(r*.24,0);
                        target.moveTo(0,-r*.24);target.lineTo(0,r*.24);
                        target.stroke();
                    }
                }
                target.restore();
                if(performanceOverlayOn)pc3RenderCounts.visible++;
                motionFxStats.drawn++;
            }
        }

        const MAX_FLOATING_TEXTS = 110;
        const BULLET_GRID_SIZE = 96;
        const HUD_REFRESH_INTERVAL = 0.10;
        let hudRefreshAccumulator = 0;
        function shouldShowPerformanceOverlay() {
            // Mobile devices lack F3. A local ?perf=1 URL opts into diagnostics.
            return /(?:^|[?&])perf=1(?:&|$)/.test(window.location?.search || '');
        }
        let performanceOverlayOn = shouldShowPerformanceOverlay();
        let performanceSampleFrames = 0;
        let performanceSampleMs = 0;
        const PERFORMANCE_FRAME_WINDOW = 300;
        const perfRecentFrameMs = new Float32Array(PERFORMANCE_FRAME_WINDOW);
        let perfRecentFrameCount = 0;
        let perfRecentFrameIndex = 0;
        let perfUpdateTotalMs = 0;
        let perfRenderTotalMs = 0;
        // Opt-in PC long-run telemetry: 5s samples, at most 60 minutes of data.
        // Typed storage avoids allocating sample objects during gameplay.
        const PC3_SAMPLE_INTERVAL = 5;
        const PC3_HISTORY_LIMIT = 720;
        const PC3_HISTORY_STRIDE = 7; // seconds, JS heap MiB, enemies, bullets, enemy shots, orbs, particles
        const pc3History = new Float32Array(PC3_HISTORY_LIMIT * PC3_HISTORY_STRIDE);
        let pc3HistoryNext = 0;
        let pc3HistoryCount = 0;
        let pc3NextSampleAt = 0;
        let pc3HeapPeakMiB = 0;
        let pc3LastHeapMiB = null;
        const pc3SampledPeaks = { enemies: 0, bullets: 0, enemyProjectiles: 0, orbs: 0, particles: 0 };
        const pc3RenderCounts = { visible: 0, skipped: 0 };
        function resetPc3Telemetry() {
            pc3HistoryNext = 0;
            pc3HistoryCount = 0;
            pc3NextSampleAt = 0;
            pc3HeapPeakMiB = 0;
            pc3LastHeapMiB = null;
            for (const key of Object.keys(pc3SampledPeaks)) pc3SampledPeaks[key] = 0;
            pc3RenderCounts.visible = 0;
            pc3RenderCounts.skipped = 0;
        }
        function capturePc3LongRunSample() {
            if (!performanceOverlayOn || gameState !== 'PLAYING' || totalTime < pc3NextSampleAt) return;
            pc3NextSampleAt = totalTime + PC3_SAMPLE_INTERVAL;
            // Chromium-only, deprecated and approximate process-level JS heap.
            // This is NOT GPU memory or a reliable per-tab RAM total.
            const bytes = performance.memory?.usedJSHeapSize;
            const heapMiB = Number.isFinite(bytes) && bytes > 0 ? bytes / 1048576 : 0;
            const counts = [enemies.length, bullets.length, enemyProjectiles.length, orbs.length, particles.length];
            const offset = pc3HistoryNext * PC3_HISTORY_STRIDE;
            pc3History[offset] = totalTime;
            pc3History[offset + 1] = heapMiB;
            for (let i = 0; i < counts.length; i++) pc3History[offset + i + 2] = counts[i];
            pc3HistoryNext = (pc3HistoryNext + 1) % PC3_HISTORY_LIMIT;
            pc3HistoryCount = Math.min(PC3_HISTORY_LIMIT, pc3HistoryCount + 1);
            pc3LastHeapMiB = heapMiB || null;
            pc3HeapPeakMiB = Math.max(pc3HeapPeakMiB, heapMiB);
            const names = ['enemies', 'bullets', 'enemyProjectiles', 'orbs', 'particles'];
            for (let i = 0; i < names.length; i++)
                pc3SampledPeaks[names[i]] = Math.max(pc3SampledPeaks[names[i]], counts[i]);
        }
        function getPc3TelemetrySummary() {
            return {
                intervalSeconds: PC3_SAMPLE_INTERVAL, storedSamples: pc3HistoryCount,
                maxSamples: PC3_HISTORY_LIMIT,
                lastHeapMiB: pc3LastHeapMiB,
                sampledPeakHeapMiB: pc3HeapPeakMiB || null,
                sampledPeakObjects: { ...pc3SampledPeaks },
                lastRender: { ...pc3RenderCounts }
            };
        }
        function getPerformanceFrameStats() {
            if (!perfRecentFrameCount) return { sampleCount: 0, avgMs: 0, p95Ms: 0 };
            const values = Array.from(perfRecentFrameMs.subarray(0, perfRecentFrameCount))
                .sort((a, b) => a - b);
            const total = values.reduce((sum, ms) => sum + ms, 0);
            return { sampleCount: values.length, avgMs: total / values.length,
                p95Ms: values[Math.ceil(values.length * .95) - 1] };
        }
        let bulletCollisionGrid = new Map();
        // These short-lived structures are reused in the PC collision hot path.
        // Pool is capped so prolonged runs cannot retain an unbounded cell cache.
        const bulletGridCellPool = [];
        const bulletCandidateScratch = [];
        let largestBulletRadius = 0;
        let combatDirector = null;

        function emitEnergyOrb(x, y, value, isGold = false) {
            if (orbs.length >= MAX_ACTIVE_ORBS) {
                // Remove collected orbs before trying to compact surviving rewards.
                for (let i = orbs.length - 1; i >= 0; i--) {
                    if (orbs[i].dead) orbs.splice(i, 1);
                }
            }
            if (orbs.length < MAX_ACTIVE_ORBS) {
                orbs.push(new EnergyOrb(x, y, value, isGold));
                return;
            }
            let nearest = null;
            let minDistanceSq = Infinity;
            for (const orb of orbs) {
                if (orb.dead || orb.isGold !== isGold) continue;
                const dx = orb.x - x;
                const dy = orb.y - y;
                const distanceSq = dx * dx + dy * dy;
                if (distanceSq < minDistanceSq) {
                    nearest = orb;
                    minDistanceSq = distanceSq;
                }
            }
            if (!nearest) {
                // Mixed reward types must keep their XP/gold identity intact.
                // Replace no reward: keep one extra orb until a compatible stack exists.
                orbs.push(new EnergyOrb(x, y, value, isGold));
                return;
            }
            nearest.value += value;
            nearest.count++;
            nearest.radius = Math.min(12, (isGold ? 7 : 5.5) + Math.log2(nearest.count) * 1.2);
        }

        function advanceOrbQuestStacks(count) {
            let remaining = count;
            while (remaining > 0 && activeQuest && activeQuest.type === 'ORBS') {
                const towardGoal = Math.max(1, activeQuest.target - activeQuest.progress);
                const consumed = Math.min(remaining, towardGoal);
                advanceQuest('ORBS', consumed);
                remaining -= consumed;
            }
        }

        function emitParticle(particle) {
            // Preserve combat feedback without accumulating unbounded particle work.
            if (particles.length < MAX_VISIBLE_PARTICLES) particles.push(particle);
        }

        function emitWeaponImpact(bullet, target) {
            // Important hits reserve visual slots; regular body hits never starve them.
            if (gameState !== 'PLAYING' || weaponImpactFrameCount >= MAX_IMPACTS_PER_FRAME)
                return false;
            const style = getProjectileVisualStyle(bullet);
            const important = style.type !== 'plasma' || target.isBoss;
            if (!important && weaponImpactFrameCount >= MAX_IMPACTS_PER_FRAME - 2)
                return false;
            if (weaponImpacts.length >= MAX_WEAPON_IMPACTS) {
                if (!important) return false;
                weaponImpacts.shift();
            }
            const type = style.type;
            const duration = type === 'rail' ? 0.26 : type === 'critical' ? 0.23 : 0.17;
            weaponImpacts.push({
                x: bullet.x, y: bullet.y, type,
                color: style.color, core: style.core,
                duration, life: duration, important,
                cluster: !!bullet.clusterPayload, boss: !!target.isBoss,
                radius: Math.min(35, Math.max(10, target.radius * 0.52)),
                angle: Math.atan2(bullet.vy, bullet.vx)
            });
            weaponImpactFrameCount++;
            return true;
        }

        function emitLightningArc(x1, y1, x2, y2, charged = false) {
            // Only visual metadata: actual chain targets and damage were settled already.
            if (lightningBolts.length >= MAX_LIGHTNING_ARCS) lightningBolts.shift();
            const length = Math.hypot(x2 - x1, y2 - y1);
            const duration = charged ? 0.23 : 0.17;
            const seed = ++lightningArcSequence;
            lightningBolts.push({
                x1, y1, x2, y2, life: duration, duration,
                seed, charged, segments: Math.max(4, Math.min(7, Math.round(length / 42)))
            });
        }

        function getLightningArcPoints(arc, time = totalTime) {
            // Stable segment count and deterministic multi-joint distortion:
            // visual jitter never changes the real collision geometry.
            const count = arc.segments || 5;
            const dx = arc.x2 - arc.x1, dy = arc.y2 - arc.y1;
            const length = Math.hypot(dx, dy) || 1;
            const nx = -dy / length, ny = dx / length;
            const phase = ((PREFERS_REDUCED_VFX_MOTION ? 0 : time) * 23 +
                (arc.seed || 1) * 2.17);
            const sway = Math.min(20, length * 0.13);
            const points = [{ x: arc.x1, y: arc.y1 }];
            for (let i = 1; i < count; i++) {
                const t = i / count;
                const envelope = Math.sin(Math.PI * t);
                const jag = Math.sin(i * 4.13 + phase) * 0.68 +
                    Math.sin(i * 8.11 + phase * 0.46) * 0.32;
                points.push({
                    x: arc.x1 + dx * t + nx * jag * sway * envelope,
                    y: arc.y1 + dy * t + ny * jag * sway * envelope
                });
            }
            points.push({ x: arc.x2, y: arc.y2 });
            return points;
        }

        function drawLightningArcs() {
            const dense = graphicsQuality === 'low' ||
                lightningBolts.length > (graphicsQuality === 'medium' ? 8 : 15);
            for (const arc of lightningBolts) {
                const duration = arc.duration || 0.15;
                const strength = Math.max(0, Math.min(1, arc.life / duration));
                const points = getLightningArcPoints(arc);
                const segments = points.length - 1;
                const strokePath = () => {
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i <= segments; i++) ctx.lineTo(points[i].x, points[i].y);
                    ctx.stroke();
                };
                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'miter';
                // Amber electric field, cyan ionization and a white-hot core.
                ctx.globalAlpha = strength * (arc.charged ? 0.46 : 0.30);
                ctx.lineWidth = arc.charged ? 11 : 8;
                ctx.strokeStyle = '#ffb336';
                strokePath();
                if (!dense) {
                    ctx.globalAlpha = strength * 0.5;
                    ctx.strokeStyle = '#50f2ff';
                    ctx.lineWidth = arc.charged ? 5.4 : 3.8;
                    strokePath();
                }
                ctx.globalAlpha = strength;
                ctx.strokeStyle = '#fff9e1';
                ctx.lineWidth = arc.charged ? 2.6 : 1.65;
                strokePath();
                if (!dense) {
                    // Visible current front traveling from the previous target to the next.
                    const progress = 1 - strength;
                    const n = Math.min(segments - 1, Math.floor(progress * segments));
                    const t = progress * segments - n;
                    const px = points[n].x + (points[n + 1].x - points[n].x) * t;
                    const py = points[n].y + (points[n + 1].y - points[n].y) * t;
                    ctx.globalAlpha = strength;
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(px, py, arc.charged ? 4 : 2.8, 0, Math.PI * 2);
                    ctx.fill();
                    // Very short fork at one joint: keeps the electric silhouette jagged.
                    const middle = points[Math.floor(segments / 2)];
                    const heading = Math.atan2(arc.y2 - arc.y1, arc.x2 - arc.x1);
                    ctx.globalAlpha = strength * 0.63;
                    ctx.strokeStyle = '#67e8ff';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(middle.x, middle.y);
                    ctx.lineTo(middle.x + Math.cos(heading + 1.12) * 14,
                               middle.y + Math.sin(heading + 1.12) * 14);
                    ctx.stroke();
                }
                // The struck target has a crown that collapses with the discharge.
                const corona = arc.charged ? 17 : 12;
                ctx.globalAlpha = strength * 0.85;
                ctx.strokeStyle = '#a1faff';
                ctx.lineWidth = arc.charged ? 2.5 : 1.6;
                ctx.beginPath();
                ctx.arc(arc.x2, arc.y2, corona * (1.12 - strength * .35), 0, Math.PI * 2);
                ctx.stroke();
                if (!dense) {
                    ctx.strokeStyle = '#fff6be';
                    const spin = (PREFERS_REDUCED_VFX_MOTION ? 0 : totalTime) * 9 +
                        (arc.seed || 0);
                    for (let i = 0; i < 4; i++) {
                        const angle = spin + i * Math.PI / 2;
                        ctx.beginPath();
                        ctx.moveTo(arc.x2 + Math.cos(angle) * (corona - 2),
                                   arc.y2 + Math.sin(angle) * (corona - 2));
                        ctx.lineTo(arc.x2 + Math.cos(angle) * (corona + 7),
                                   arc.y2 + Math.sin(angle) * (corona + 7));
                        ctx.stroke();
                    }
                }
                ctx.restore();
            }
        }

        function drawWeaponImpacts() {
            const dense = graphicsQuality === 'low' ||
                weaponImpacts.length > (graphicsQuality === 'medium' ? 15 : 30);
            for (const impact of weaponImpacts) {
                const life = Math.max(0, Math.min(1, impact.life / impact.duration));
                const p = 1 - life;
                const size = impact.radius * (0.65 + p * (impact.boss ? 1.9 : 1.4));
                ctx.save();
                ctx.globalAlpha = 0.74 * life;
                ctx.strokeStyle = impact.color;
                ctx.lineWidth = impact.type === 'rail' ? 3.4 : impact.type === 'missile' ? 2.8 : 2;
                ctx.beginPath();
                ctx.arc(impact.x, impact.y, size, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = life * 0.78;
                ctx.strokeStyle = impact.core;
                ctx.lineWidth = 1.6;
                // Rocket: concentric pressure wave, directed debris, bright central bloom.
                if (impact.type === 'missile') {
                    ctx.globalAlpha = life * 0.48;
                    ctx.strokeStyle = impact.cluster ? '#cefff5' : '#82ffb3';
                    ctx.lineWidth = 3.2;
                    ctx.beginPath();
                    ctx.arc(impact.x, impact.y, size * .6, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.globalAlpha = life;
                    ctx.fillStyle = '#f1fff4';
                    ctx.beginPath();
                    ctx.arc(impact.x, impact.y, Math.max(1, (1 - p) * 5), 0, Math.PI * 2);
                    ctx.fill();
                }
                const spokes = impact.type === 'missile' ? (impact.cluster ? 6 : 5) :
                    impact.type === 'rail' ? 6 : impact.type === 'critical' ? 8 : 3;
                for (let i = 0; i < spokes; i++) {
                    const a = impact.angle + i * Math.PI * 2 / spokes;
                    const inner = impact.type === 'missile' ? 0.28 : .42;
                    const outer = impact.type === 'missile' ? 1.55 : 1.25;
                    ctx.beginPath();
                    ctx.moveTo(impact.x + Math.cos(a) * size * inner,
                               impact.y + Math.sin(a) * size * inner);
                    ctx.lineTo(impact.x + Math.cos(a) * size * outer,
                               impact.y + Math.sin(a) * size * outer);
                    ctx.stroke();
                }
                // Critical: a sharp four-corner hit confirmation instead of text spam.
                if (impact.type === 'critical' && !dense) {
                    ctx.strokeStyle = '#fff3ab';
                    ctx.lineWidth = 2.1;
                    ctx.globalAlpha = 0.88 * life;
                    ctx.save();
                    ctx.translate(impact.x, impact.y);
                    ctx.rotate(p * 0.55);
                    ctx.beginPath();
                    const r = size * 1.35;
                    ctx.moveTo(0,-r);ctx.lineTo(r*.46,0);
                    ctx.lineTo(0,r);ctx.lineTo(-r*.46,0);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.restore();
                }
                // Rail burns forward into the target; deliberately short-lived.
                if (impact.type === 'rail' && !dense) {
                    ctx.globalAlpha = life * 0.8;
                    ctx.strokeStyle = '#b8f5ff';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(impact.x - Math.cos(impact.angle) * size * 1.8,
                               impact.y - Math.sin(impact.angle) * size * 1.8);
                    ctx.lineTo(impact.x + Math.cos(impact.angle) * size,
                               impact.y + Math.sin(impact.angle) * size);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        function buildBulletCollisionGrid() {
            // Recycling the previous frame's buckets avoids allocating one array per
            // occupied cell on every frame. The grid itself still contains only
            // current-frame keys, so moving shots never leave ghost collisions.
            for (const cell of bulletCollisionGrid.values()) {
                cell.length = 0;
                if (bulletGridCellPool.length < MAX_PLAYER_PROJECTILES) {
                    bulletGridCellPool.push(cell);
                }
            }
            bulletCollisionGrid.clear();
            largestBulletRadius = 0;
            for (let i = 0; i < bullets.length; i++) {
                const b = bullets[i];
                if (b.dead) continue;
                largestBulletRadius = Math.max(largestBulletRadius, b.radius);
                const key = `${Math.floor(b.x / BULLET_GRID_SIZE)},${Math.floor(b.y / BULLET_GRID_SIZE)}`;
                let cell = bulletCollisionGrid.get(key);
                if (!cell) {
                    cell = bulletGridCellPool.pop() || [];
                    bulletCollisionGrid.set(key, cell);
                }
                cell.push(i);
            }
        }

        function getNearbyBulletIndices(x, y, enemyRadius, candidates = []) {
            // Callers can supply scratch storage. The public/default behavior still
            // returns an independent array, while updateGame reuses one per enemy.
            candidates.length = 0;
            // Include the maximum projectile radius, so large bullets and bosses never miss cells.
            const reach = enemyRadius + largestBulletRadius;
            const minX = Math.floor((x - reach) / BULLET_GRID_SIZE);
            const maxX = Math.floor((x + reach) / BULLET_GRID_SIZE);
            const minY = Math.floor((y - reach) / BULLET_GRID_SIZE);
            const maxY = Math.floor((y + reach) / BULLET_GRID_SIZE);
            for (let gx = minX; gx <= maxX; gx++) {
                for (let gy = minY; gy <= maxY; gy++) {
                    const cell = bulletCollisionGrid.get(`${gx},${gy}`);
                    if (cell) candidates.push(...cell);
                }
            }
            // Matches the former reverse-bullet iteration order where collisions overlap.
            candidates.sort((a, b) => b - a);
            return candidates;
        }

        function createFloatingText(x, y, text, color = '#ffffff', size = 14) {
            // New feedback takes precedence over expired-looking old numbers.
            if (floatingTexts.length >= MAX_FLOATING_TEXTS) floatingTexts.shift();
            floatingTexts.push({
                x,
                y,
                text,
                color,
                size,
                life: 0.75,
                maxLife: 0.75
            });
        }

        function getRandomEdgePosition(margin = 45) {
            const side = Math.floor(Math.random() * 4);
            if (side === 0) return { x: Math.random() * worldWidth, y: -margin };
            if (side === 1) return { x: worldWidth + margin, y: Math.random() * worldHeight };
            if (side === 2) return { x: Math.random() * worldWidth, y: worldHeight + margin };
            return { x: -margin, y: Math.random() * worldHeight };
        }

        const MAX_ACTIVE_ENEMIES = 160;
        const ENEMY_SPAWN_WEIGHTS = [
            { type: 'SWARM', from: 1, weight: 50 },
            { type: 'SPLITTER', from: 1, weight: 18 },
            { type: 'KAMIKAZE', from: 2, weight: 12 },
            { type: 'DASHER', from: 2, weight: 10 },
            { type: 'SHOOTER', from: 3, weight: 10 },
            { type: 'TANK', from: 3, weight: 8 },
            { type: 'SHIELD_BEARER', from: 4, weight: 7 },
            { type: 'SNIPER', from: 5, weight: 6 },
            { type: 'ASSASSIN', from: 5, weight: 8 },
            { type: 'GRAV_WELL', from: 6, weight: 5 }
        ];

        const ENEMY_THREAT_COST = {
            SWARM: 1, SPLITTER: 1.5, KAMIKAZE: 1.4, DASHER: 1.6,
            SHOOTER: 2, TANK: 3, SHIELD_BEARER: 3, SNIPER: 2.3,
            ASSASSIN: 2.1, GRAV_WELL: 2.6
        };

        // M5.16: CIRCUIT WEAVER. The player draws a closed loop with movement.
        // Completing it detonates a bounded area, and the third tier leaves a
        // short-lived live wire that damages a crossing enemy only once.
        const CIRCUIT_WEAVER = Object.freeze({
            sampleStep: 16, maxPoints: 48, maxDuration: 9,
            minLength: 340, minPoints: 12, closeRadius: 42,
            minArea: 8000, maxArea: 90000, maxJump: 90,
            maxPulseTargets: 16, maxWireTargets: 16,
            cooldown: [0, 11, 9, 7], fieldSeconds: 3.2, fieldStep: .13
        });
        let circuitField = null;
        let circuitFlash = null;
        function circuitSignedArea(points) {
            if (points.length < 3) return 0;
            let twice = 0;
            for (let i = 0; i < points.length; i++) {
                const a = points[i], b = points[(i + 1) % points.length];
                twice += a.x * b.y - b.x * a.y;
            }
            return twice / 2;
        }
        function circuitContains(points, x, y) {
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const a = points[i], b = points[j];
                if ((a.y > y) !== (b.y > y) &&
                    x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x)
                    inside = !inside;
            }
            return inside;
        }
        function closeCircuitWeaver(p, points, area) {
            const tier = Math.min(MAX_MODULE_TIER, p.upgradeCounts.circuit_weaver || 0);
            if (!tier || gameState !== 'PLAYING') return false;
            const impacted = [];
            for (const target of enemies) {
                if (impacted.length >= CIRCUIT_WEAVER.maxPulseTargets) break;
                if (target.dead || target.isBoss ||
                    !circuitContains(points, target.x, target.y)) continue;
                impacted.push(target.id);
                target.takeDamage(Math.min(260, p.damage * (1.15 + .1 * tier) + 18),
                    0, 0, false, false);
            }
            p.buildStats.circuitClosures++;
            p.buildStats.circuitPulseHits += impacted.length;
            p.circuitReadyAt = totalTime + CIRCUIT_WEAVER.cooldown[tier];
            // Preserve immutable point snapshots for effects and the live wire.
            const closed = points.map(point => ({x: point.x, y: point.y}));
            circuitFlash = { points: closed, expiresAt: totalTime + .75,
                createdAt: totalTime };
            circuitField = null;
            if (p.evolutions.has('circuit_weaver')) {
                const prev = new Map();
                for (const target of enemies) {
                    if (!target.dead && !target.isBoss) {
                        prev.set(target.id, circuitContains(closed, target.x, target.y));
                    }
                }
                circuitField = { points: closed,
                    expiresAt: totalTime + CIRCUIT_WEAVER.fieldSeconds,
                    nextTickAt: totalTime + CIRCUIT_WEAVER.fieldStep,
                    previous: prev, hitIds: new Set(impacted), crossings: 0 };
            }
            shockwaves.push(new Shockwave(p.x, p.y, 90, '#ffe66d', .35));
            createFloatingText(p.x, p.y - 45,
                'DEVRE TAMAMLANDI · ' + impacted.length + ' HEDEF', '#ffe66d', 15);
            return true;
        }
        function recordCircuitWeaverMotion(p, movedDist = 0, wasDashing = false) {
            const tier = Math.min(MAX_MODULE_TIER, p?.upgradeCounts?.circuit_weaver || 0);
            if (!tier || gameState !== 'PLAYING') return false;
            if (totalTime < p.circuitReadyAt) {
                p.circuitTrace = [];
                p.circuitLength = 0;
                return false;
            }
            const now = {x:p.x,y:p.y};
            const trace = p.circuitTrace;
            if (wasDashing || movedDist > CIRCUIT_WEAVER.maxJump ||
                !Number.isFinite(now.x) || !Number.isFinite(now.y)) {
                p.circuitTrace = [{x:now.x,y:now.y}];
                p.circuitLength = 0;
                p.circuitStartedAt = totalTime;
                return false;
            }
            if (!trace.length || totalTime - p.circuitStartedAt >
                CIRCUIT_WEAVER.maxDuration) {
                p.circuitTrace = [now];
                p.circuitLength = 0;
                p.circuitStartedAt = totalTime;
                return false;
            }
            const previous = trace[trace.length-1];
            const delta = Math.hypot(now.x-previous.x, now.y-previous.y);
            if (delta < CIRCUIT_WEAVER.sampleStep) return false;
            const nextLength = p.circuitLength + delta;
            const start = trace[0];
            if (trace.length >= CIRCUIT_WEAVER.minPoints &&
                nextLength >= CIRCUIT_WEAVER.minLength &&
                Math.hypot(now.x-start.x,now.y-start.y) <=
                    CIRCUIT_WEAVER.closeRadius) {
                const polygon = [...trace, now];
                const area = Math.abs(circuitSignedArea(polygon));
                if (area >= CIRCUIT_WEAVER.minArea &&
                    area <= CIRCUIT_WEAVER.maxArea) {
                    closeCircuitWeaver(p, polygon, area);
                    p.circuitTrace = [];
                    p.circuitLength = 0;
                    return true;
                }
            }
            trace.push(now);
            p.circuitLength = nextLength;
            if (trace.length >= CIRCUIT_WEAVER.maxPoints) {
                p.circuitTrace = [now];
                p.circuitLength = 0;
                p.circuitStartedAt = totalTime;
            }
            return false;
        }
        function updateCircuitField() {
            if (circuitFlash && totalTime >= circuitFlash.expiresAt) circuitFlash = null;
            if (!circuitField) return;
            if (totalTime >= circuitField.expiresAt) {
                circuitField = null;
                return;
            }
            if (totalTime < circuitField.nextTickAt) return;
            circuitField.nextTickAt = totalTime + CIRCUIT_WEAVER.fieldStep;
            const field = circuitField;
            for (const target of enemies) {
                if (field.crossings >= CIRCUIT_WEAVER.maxWireTargets) break;
                if (target.dead || target.isBoss || !player) continue;
                const nowInside = circuitContains(field.points, target.x, target.y);
                const previousInside = field.previous.get(target.id);
                field.previous.set(target.id, nowInside);
                // Enemy created mid-field is first registered, not hit for free.
                if (previousInside === undefined || previousInside === nowInside ||
                    field.hitIds.has(target.id)) continue;
                field.hitIds.add(target.id);
                field.crossings++;
                player.buildStats.circuitCrossings++;
                target.takeDamage(Math.min(135, player.damage * .68 + 12),
                    0, 0, false, false);
            }
        }
        function getCircuitWeaverSnapshot() {
            return { tier: player?.upgradeCounts?.circuit_weaver || 0,
                tracePoints: player?.circuitTrace?.length || 0,
                readyIn: player ? Math.max(0, Math.round((player.circuitReadyAt -
                    totalTime) * 10) / 10) : 0,
                fieldActive: !!circuitField,
                closures: player?.buildStats.circuitClosures || 0,
                pulseHits: player?.buildStats.circuitPulseHits || 0,
                wireHits: player?.buildStats.circuitCrossings || 0 };
        }
        function drawCircuitWeaver(ctx) {
            if (!player || gameState !== 'PLAYING') return;
            const trace = player.circuitTrace;
            const renderPath = (points, closed, color, alpha, width) => {
                if (points.length < 2) return;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                if (graphicsQuality === 'high') {
                    ctx.shadowBlur = getGraphicsBlur(14);
                    ctx.shadowColor = color;
                }
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
                if (closed) ctx.closePath();
                ctx.stroke();
                ctx.restore();
            };
            if (player.upgradeCounts.circuit_weaver > 0 &&
                totalTime >= player.circuitReadyAt && trace.length > 1) {
                renderPath(trace,false,'#66efff',.65,3);
                const start = trace[0];
                ctx.save();
                ctx.strokeStyle = '#ffe66d';
                ctx.globalAlpha = .75;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(start.x,start.y,CIRCUIT_WEAVER.closeRadius,0,Math.PI*2);
                ctx.stroke();
                ctx.restore();
            }
            if (circuitFlash) {
                const alpha = Math.max(0, (circuitFlash.expiresAt-totalTime)/.75);
                renderPath(circuitFlash.points,true,'#ffe66d',alpha,5);
            }
            if (circuitField) {
                const alpha = Math.max(0,
                    (circuitField.expiresAt-totalTime)/CIRCUIT_WEAVER.fieldSeconds);
                renderPath(circuitField.points,true,'#ff58d2',.8*alpha,4);
            }
        }

        // M5.15: card-only tactical decoy. No gold consumption, no new
        // projectile sources, no boss targeting changes or saved run state.
        const PHASE_ECHO = Object.freeze({
            eligible: ['SWARM', 'SPLITTER', 'TANK', 'SHIELD_BEARER'],
            maxDecoys: 2, maxTargets: 6,
            durations: [0, 2.6, 3.2, 4.1],
            cooldowns: [Infinity, 6, 4.5, 3.0],
            ranges: [0, 250, 265, 280]
        });
        let phaseEchoes = [];
        function canPhaseEchoDistract(enemy) {
            return !!enemy && !enemy.dead && !enemy.isBoss &&
                PHASE_ECHO.eligible.includes(enemy.type) &&
                !(enemy.type === 'SHIELD_BEARER' && enemy.tacticalRole === 'guard');
        }
        function deployPhaseEcho(p, origin) {
            const tier = Math.min(MAX_MODULE_TIER, p?.upgradeCounts?.phase_echo || 0);
            if (!tier || gameState !== 'PLAYING' || totalTime < p.phaseEchoReadyAt)
                return false;
            if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y))
                return false;
            const range = PHASE_ECHO.ranges[tier];
            const eligible = enemies.filter(e => canPhaseEchoDistract(e) &&
                Math.hypot(e.x - origin.x, e.y - origin.y) <= range)
                .sort((a,b) => Math.hypot(a.x-origin.x,a.y-origin.y) -
                    Math.hypot(b.x-origin.x,b.y-origin.y) || a.id-b.id)
                .slice(0, PHASE_ECHO.maxTargets);
            // Nothing to misdirect? Do not consume a charge for an empty cast.
            if (!eligible.length) return false;
            p.phaseEchoReadyAt = totalTime + PHASE_ECHO.cooldowns[tier];
            // 1 or 2 simultaneous echoes, depending on evolution status.
            const cap = p.evolutions.has('phase_echo') ? PHASE_ECHO.maxDecoys : 1;
            while (phaseEchoes.length >= cap) phaseEchoes.shift();
            phaseEchoes.push({
                x: origin.x, y: origin.y, createdAt: totalTime,
                expiresAt: totalTime + PHASE_ECHO.durations[tier],
                radius: range, targets: eligible.map(e => e.id)
            });
            p.buildStats.phaseEchoes++;
            p.buildStats.phaseEchoTargets += eligible.length;
            shockwaves.push(new Shockwave(origin.x, origin.y, 110, '#6df7ff', 0.35));
            createFloatingText(origin.x, origin.y - 30,
                'FAZ YANKISI · ' + eligible.length + ' HEDEF ŞAŞIRDI', '#6df7ff', 13);
            return true;
        }
        function updatePhaseEchoes() {
            if (phaseEchoes.length) phaseEchoes = phaseEchoes.filter(e =>
                totalTime < e.expiresAt);
        }
        function getPhaseEchoTarget(enemy) {
            if (!canPhaseEchoDistract(enemy)) return null;
            // Latest surviving decoy wins: intuitive counterplay during two-echo
            // evolution, independent of AI Director threat tokens.
            for (let i = phaseEchoes.length - 1; i >= 0; i--) {
                const echo = phaseEchoes[i];
                if (totalTime < echo.expiresAt && echo.targets.includes(enemy.id) &&
                    Math.hypot(enemy.x - echo.x, enemy.y - echo.y) < echo.radius * 1.45)
                    return echo;
            }
            return null;
        }
        function getPhaseEchoSnapshot() {
            return {
                active: phaseEchoes.length,
                targets: phaseEchoes.map(e => e.targets.length),
                remaining: phaseEchoes.map(e => Math.max(0,
                    Math.round((e.expiresAt - totalTime)*10)/10)),
                deployed: player?.buildStats.phaseEchoes || 0,
                distracted: player?.buildStats.phaseEchoTargets || 0
            };
        }
        function drawPhaseEchoes(ctx) {
            if (gameState !== 'PLAYING') return;
            for (const echo of phaseEchoes) {
                const remain = Math.max(0, echo.expiresAt - totalTime);
                if (!remain) continue;
                const fade = Math.min(1, remain / .7);
                const pulse = Math.sin((totalTime - echo.createdAt) * 7);
                ctx.save();
                ctx.translate(echo.x, echo.y);
                ctx.globalAlpha = fade * .65;
                ctx.strokeStyle = '#6df7ff';
                ctx.lineWidth = 2;
                if (graphicsQuality === 'high') {
                    ctx.shadowBlur = getGraphicsBlur(15);
                    ctx.shadowColor = '#00f3ff';
                }
                // Hologram silhouette and beacon, not a second player.
                ctx.setLineDash([6, 8]);
                ctx.beginPath();
                ctx.arc(0, 0, 23 + 3 * pulse, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(0, -18);
                ctx.lineTo(17, 8);
                ctx.lineTo(-17, 8);
                ctx.closePath();
                ctx.stroke();
                ctx.globalAlpha *= .32;
                ctx.beginPath();
                ctx.arc(0, 0, echo.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        // M5.14: an independent gold sink, with no connection to level-up cards.
        // A stationary shield counters *incoming* projectiles, not collision damage
        // or melee enemies. No extra projectiles, XP or upgrade choices are created.
        const BASTION = Object.freeze({
            radius: 132, duration: 8, cooldown: 32,
            maxUses: 3, baseCost: 70, stepCost: 40, bossBuffer: 11
        });
        let bastion = null;
        let bastionReadyAt = 0;
        let bastionUses = 0;
        let bastionGoldSpent = 0;
        let bastionShotsBlocked = 0;
        function getBastionCost() {
            return BASTION.baseCost + bastionUses * BASTION.stepCost;
        }
        function getBastionStatus() {
            const activeTime = bastion ? Math.max(0, bastion.expiresAt - totalTime) : 0;
            const cooldown = Math.max(0, bastionReadyAt - totalTime);
            const cost = getBastionCost();
            let reason = null;
            if (gameState !== 'PLAYING' || !player) reason = 'not-playing';
            else if (bastion && activeTime > 0) reason = 'active';
            else if (bastionUses >= BASTION.maxUses) reason = 'used-up';
            else if (wave < 4) reason = 'locked';
            else if (activeBosses.some(b => !b.dead) ||
                nextBossTime - totalTime <= BASTION.duration + BASTION.bossBuffer)
                reason = 'boss-window';
            else if (cooldown > 0) reason = 'cooldown';
            else if (totalGold < cost) reason = 'gold';
            return {
                active: activeTime > 0,
                secondsLeft: Math.ceil(activeTime),
                cooldown: Math.ceil(cooldown),
                cost, uses: bastionUses, remaining: BASTION.maxUses - bastionUses,
                goldSpent: bastionGoldSpent, shotsBlocked: bastionShotsBlocked,
                available: reason === null, reason
            };
        }
        function deployBastion() {
            if (!getBastionStatus().available) return false;
            const cost = getBastionCost();
            // This is a single atomic purchase for an eight-second position.
            totalGold -= cost;
            bastionGoldSpent += cost;
            bastionUses++;
            bastionReadyAt = totalTime + BASTION.cooldown;
            bastion = { x: player.x, y: player.y, radius: BASTION.radius,
                expiresAt: totalTime + BASTION.duration, startedAt: totalTime,
                blocked: 0 };
            saveMetaProgress();
            shockwaves.push(new Shockwave(bastion.x, bastion.y,
                BASTION.radius, '#4fffe0', .4));
            audio.playThreatCue('event');
            createFloatingText(player.x, player.y - 62,
                'SİPER KURULDU · MENZİLLİ ATEŞİ ENGELLE', '#4fffe0', 15);
            return true;
        }
        function updateBastion() {
            if (bastion && totalTime >= bastion.expiresAt) bastion = null;
        }
        // Swept segment/circle check prevents high-speed shots skipping the ring.
        // Shots born inside the dome are not erased, and bullets leaving it pass.
        function bastionIntercepts(projectile) {
            if (!bastion || totalTime >= bastion.expiresAt || !projectile ||
                projectile.dead) return false;
            const sx = projectile.previousX - bastion.x;
            const sy = projectile.previousY - bastion.y;
            const radius = bastion.radius - Math.max(0, projectile.radius || 0);
            if (!(radius > 0)) return false;
            if (sx * sx + sy * sy <= radius * radius) return false;
            const dx = projectile.x - projectile.previousX;
            const dy = projectile.y - projectile.previousY;
            const len2 = dx * dx + dy * dy;
            if (!(len2 > 0)) return false;
            const t = Math.max(0, Math.min(1, -(sx * dx + sy * dy) / len2));
            const closestX = sx + dx * t;
            const closestY = sy + dy * t;
            return closestX * closestX + closestY * closestY <= radius * radius;
        }
        function drawBastion(ctx) {
            if (!bastion || gameState !== 'PLAYING') return;
            const timeLeft = Math.max(0, bastion.expiresAt - totalTime);
            if (!timeLeft) return;
            const progress = timeLeft / BASTION.duration;
            ctx.save();
            ctx.translate(bastion.x, bastion.y);
            ctx.strokeStyle = '#4fffe0';
            ctx.fillStyle = '#4fffe0';
            ctx.lineWidth = 2.5;
            ctx.globalAlpha = .5 + .25 * progress;
            if (graphicsQuality === 'high') {
                ctx.shadowBlur = getGraphicsBlur(18);
                ctx.shadowColor = '#4fffe0';
                ctx.globalAlpha = .07;
                ctx.beginPath();
                ctx.arc(0, 0, bastion.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = .6;
            }
            ctx.beginPath();
            ctx.arc(0, 0, bastion.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 5;
            ctx.globalAlpha = .85;
            ctx.beginPath();
            ctx.arc(0, 0, bastion.radius - 5, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.stroke();
            ctx.restore();
        }
        function updateBastionHud() {
            const button = document.getElementById('bastionBtn');
            const status = document.getElementById('bastionStatus');
            const amount = document.getElementById('bastionCostText');
            if (!button || !status || !amount) return;
            const info = getBastionStatus();
            button.disabled = !info.available;
            amount.textContent = info.remaining ?
                info.cost + ' ALTIN · ' + info.remaining + ' HAK' : 'HAK BİTTİ';
            const titles = {
                'not-playing': 'Yalnızca savaşta kurulabilir',
                active: 'Siperin süresi bitiyor',
                'used-up': 'Bu koşunun tüm siper hakları kullanıldı',
                locked: 'Dalga 4 itibarıyla açılır',
                'boss-window': 'Boss öncesi ve sırasında kullanılamaz',
                cooldown: 'Siper yeniden hazır olmayı bekliyor',
                gold: 'Yeterli altın yok'
            };
            status.textContent = info.active ? info.secondsLeft + 's' :
                info.reason === 'cooldown' ? info.cooldown + 's' :
                info.reason === 'boss-window' ? 'BOSS' :
                info.reason === 'locked' ? 'DALGA 4' :
                info.reason === 'gold' ? 'ALTIN YOK' :
                info.reason === 'used-up' ? 'BİTTİ' : 'HAZIR';
            button.title = (titles[info.reason] || 'Siper kur') +
                ' · Q · ' + info.cost + ' altın';
        }

        // M5.13: low-frequency local steering. One indexed snapshot per 0.18s,
        // never a full enemy-vs-enemy scan per animation frame.
        const CROWD_CELL = 88;
        const CROWD_SAMPLE_SECONDS = 0.18;
        const CROWD_MAX_CHECKS_PER_AGENT = 18;
        const crowdSteeringStats = { age: 0, samples: 0, agents: 0, checks: 0,
            steered: 0, peakCell: 0 };
        function resetEnemyCrowdSteering() {
            Object.assign(crowdSteeringStats, { age: 0, samples: 0, agents: 0,
                checks: 0, steered: 0, peakCell: 0 });
        }
        function canCrowdSteer(enemy) {
            return !!enemy && !enemy.dead && !enemy.isBoss &&
                enemy.type !== 'KAMIKAZE' && enemy.type !== 'GRAV_WELL' &&
                (enemy.type !== 'DASHER' || enemy.state === 'CHASE');
        }
        function sampleEnemyCrowdSteering(dt) {
            if (!(dt > 0 && dt < 0.25)) return false;
            crowdSteeringStats.age += dt;
            if (crowdSteeringStats.age < CROWD_SAMPLE_SECONDS) return false;
            crowdSteeringStats.age %= CROWD_SAMPLE_SECONDS;
            crowdSteeringStats.samples++;
            const grid = new Map();
            let candidates = 0;
            for (const enemy of enemies) {
                enemy.crowdSteerX = 0;
                enemy.crowdSteerY = 0;
                if (!canCrowdSteer(enemy)) continue;
                candidates++;
                const key = Math.floor(enemy.x / CROWD_CELL) + ':' +
                    Math.floor(enemy.y / CROWD_CELL);
                let cell = grid.get(key);
                if (!cell) { cell = []; grid.set(key, cell); }
                cell.push(enemy);
                crowdSteeringStats.peakCell = Math.max(crowdSteeringStats.peakCell, cell.length);
            }
            crowdSteeringStats.agents += candidates;
            if (!player) return true;
            for (const enemy of enemies) {
                if (!canCrowdSteer(enemy)) continue;
                const cellX = Math.floor(enemy.x / CROWD_CELL);
                const cellY = Math.floor(enemy.y / CROWD_CELL);
                const headingX = player.x - enemy.x;
                const headingY = player.y - enemy.y;
                const headingLength = Math.hypot(headingX, headingY) || 1;
                const tangentX = -headingY / headingLength;
                const tangentY = headingX / headingLength;
                let steerX = 0, steerY = 0, checked = 0;
                neighborCells: for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        const cell = grid.get((cellX + ox) + ':' + (cellY + oy));
                        if (!cell) continue;
                        for (const other of cell) {
                            if (other === enemy || other.dead) continue;
                            if (checked++ >= CROWD_MAX_CHECKS_PER_AGENT) break neighborCells;
                            crowdSteeringStats.checks++;
                            const vx = enemy.x - other.x;
                            const vy = enemy.y - other.y;
                            const separation = enemy.radius + other.radius + 18;
                            const dist2 = vx * vx + vy * vy;
                            if (dist2 >= separation * separation) continue;
                            const dist = Math.sqrt(dist2);
                            const weight = (separation - dist) / separation;
                            // A head-to-tail queue needs opposite sidesteps;
                            // pushing only backwards makes the queue remain stacked.
                            const along = Math.abs(vx * tangentX + vy * tangentY);
                            if (dist < 0.001 || along < dist * 0.24) {
                                const side = enemy.id < other.id ? -1 : 1;
                                steerX += tangentX * side * weight;
                                steerY += tangentY * side * weight;
                            } else {
                                steerX += vx / dist * weight;
                                steerY += vy / dist * weight;
                            }
                        }
                    }
                }
                const strength = Math.hypot(steerX, steerY);
                if (strength > 0.02) {
                    // Only a direction bias; final displacement length remains
                    // the one prescribed by the original enemy state machine.
                    const scale = Math.min(0.38, strength * 0.36) / strength;
                    enemy.crowdSteerX = steerX * scale;
                    enemy.crowdSteerY = steerY * scale;
                    crowdSteeringStats.steered++;
                }
            }
            return true;
        }
        function getEnemyCrowdSteeringSnapshot() {
            return { samples: crowdSteeringStats.samples,
                agents: crowdSteeringStats.agents, checks: crowdSteeringStats.checks,
                steered: crowdSteeringStats.steered,
                peakCell: crowdSteeringStats.peakCell };
        }

        // Formation links are deliberately metadata-only. They let existing
        // enemy roles coordinate their position without adding HP, damage or
        // another projectile source to the encounter budget.
        function getFormationMates(enemy) {
            if (!enemy?.formationId) return [];
            return enemies.filter(other => other !== enemy &&
                !other.dead && other.formationId === enemy.formationId);
        }
        function getTacticalEscort(enemy) {
            if (!enemy?.formationId) return null;
            return getFormationMates(enemy).find(other =>
                other.type === 'SHIELD_BEARER' && other.tacticalRole === 'guard') || null;
        }
        function getTacticalCoverPoint(enemy) {
            if (!enemy || enemy.tacticalRole !== 'payload' || !player) return null;
            const escort = getTacticalEscort(enemy);
            if (!escort) return null;
            const dx = escort.x - player.x;
            const dy = escort.y - player.y;
            const dist = Math.hypot(dx, dy) || 1;
            const coverDistance = 108;
            return {
                x: escort.x + dx / dist * coverDistance,
                y: escort.y + dy / dist * coverDistance,
                escort
            };
        }
        function getTacticalFlankVector(enemy, dx, dy, dist) {
            const safeDist = Math.max(1, dist || Math.hypot(dx, dy));
            let radialX = dx / safeDist;
            let radialY = dy / safeDist;
            if (enemy?.tacticalRole !== 'flank') return { x: radialX, y: radialY };
            // Formation flankers aim a short distance into a *measured* player
            // path. Random enemies, dash charge/lunge and all bosses are unchanged.
            const motion = combatDirector?.tacticalMotion;
            if (player && !player.isDashing && motion?.tracked >= 0.8 &&
                Math.hypot(motion.vx, motion.vy) >= 85 && safeDist > 140) {
                const horizon = Math.min(0.42, safeDist / Math.max(1, enemy.speed * 4));
                const leadX = Math.max(20, Math.min(worldWidth - 20,
                    player.x + motion.vx * horizon));
                const leadY = Math.max(20, Math.min(worldHeight - 20,
                    player.y + motion.vy * horizon));
                const leadDx = leadX - enemy.x;
                const leadDy = leadY - enemy.y;
                const leadDist = Math.hypot(leadDx, leadDy) || 1;
                radialX = leadDx / leadDist;
                radialY = leadDy / leadDist;
            }
            const sign = ((enemy.tacticalSlot || 0) % 2 === 0 ? 1 : -1) *
                ((enemy.tacticalSide || 0) % 2 === 0 ? 1 : -1);
            const tangentX = -radialY * sign;
            const tangentY = radialX * sign;
            const blendX = radialX * 0.78 + tangentX * 0.62;
            const blendY = radialY * 0.78 + tangentY * 0.62;
            const blendLength = Math.hypot(blendX, blendY) || 1;
            return { x: blendX / blendLength, y: blendY / blendLength };
        }
        function getTacticalHintState() {
            const plan = combatDirector?.pendingEncounter;
            const pendingUnits = plan?.units || [];
            const hasGuardPayload = pendingUnits.some(unit => unit.role === 'guard') &&
                pendingUnits.some(unit => unit.role === 'payload');
            const pendingFlanks = pendingUnits.filter(unit => unit.role === 'flank').length;
            if (plan && hasGuardPayload) {
                return { kind: 'guard', text: 'KORUMA PROTOKOLU · ÖNCE KALKAN', color: plan.color || '#67e8f9' };
            }
            if (plan && pendingFlanks >= 2) {
                return { kind: 'flank', text: 'İKİLİ FLANK · MERKEZİ BOŞALT', color: '#ff9f43' };
            }
            const livePayload = enemies.find(enemy => enemy.tacticalRole === 'payload' &&
                getTacticalEscort(enemy));
            if (livePayload) {
                const escort = getTacticalEscort(livePayload);
                return { kind: 'guard', text: 'KORUMA BAĞI · MENZİLLİ HEDEFİ AÇ', color: escort?.color || '#67e8f9' };
            }
            const flankGroups = new Map();
            for (const enemy of enemies) {
                if (enemy.dead || enemy.tacticalRole !== 'flank' || !enemy.formationId) continue;
                const group = flankGroups.get(enemy.formationId) || 0;
                flankGroups.set(enemy.formationId, group + 1);
            }
            if ([...flankGroups.values()].some(count => count >= 2)) {
                return { kind: 'flank', text: 'İKİLİ FLANK · AÇIYI KIR', color: '#ff9f43' };
            }
            return null;
        }
        const DIRECTOR_THEMES = ['SURGE', 'SIEGE', 'HUNT'];
        const THEME_WEIGHTS = {
            SURGE: { SWARM: 1.6, SPLITTER: 1.3, KAMIKAZE: 1.6, DASHER: 1.5 },
            SIEGE: { TANK: 2.1, SHIELD_BEARER: 2.1, SHOOTER: 1.8, GRAV_WELL: 1.3 },
            HUNT: { DASHER: 1.3, ASSASSIN: 2.3, SNIPER: 2.1, GRAV_WELL: 1.5 }
        };
        // Directional incoming threats have explicit warning time and spend director tokens.
        const SPECIAL_ENCOUNTER_WARNING = 1.65;
        const SPECIAL_ENCOUNTER_GAP = 39;

        function formationEdgePoint(side, slot, count, offset = 48) {
            const fraction = (slot + 1) / (count + 1);
            if (side === 0) return { x: fraction * worldWidth, y: -offset };
            if (side === 1) return { x: worldWidth + offset, y: fraction * worldHeight };
            if (side === 2) return { x: fraction * worldWidth, y: worldHeight + offset };
            return { x: -offset, y: fraction * worldHeight };
        }

        // M5.4: combinations use existing enemy roles and the same Director budget.
        const SPECIAL_ENCOUNTER_VARIANTS=Object.freeze([
            Object.freeze({type:'PINCER',from:3,label:'ÇİFT YÖNLÜ KISKAÇ',color:'#ffbf58'}),
            Object.freeze({type:'SPEARHEAD',from:3,label:'ÖNCÜ HÜCUMU',color:'#ffbf58'}),
            Object.freeze({type:'ESCORT',from:8,label:'KESKİN NİŞANCI KORUMASI',color:'#fa9cd7'}),
            Object.freeze({type:'INTERCEPT',from:10,label:'İKİ YÖNLÜ AVCI BASKINI',color:'#77dcff'}),
            Object.freeze({type:'CORRIDOR',from:6,label:'KAÇIŞ KORİDORU KİLİDİ',color:'#8cf0c8'}),
            Object.freeze({type:'BREACH',from:13,label:'AĞIR HAT YARMA',color:'#ffac70'}),
            Object.freeze({type:'CROSSLOCK',from:12,label:'ÇAPRAZ HEDEF KİLİDİ',color:'#c6a0ff'}),
            Object.freeze({type:'PINWHEEL',from:16,label:'DÖRT CEPHE KIRILMASI',color:'#77e0ff'})
        ]);
        function getSpecialEncounterKinds(currentWave){
            const unlockWave = activeContractId === 'BLACKOUT' ? currentWave + 1 : currentWave;
            return SPECIAL_ENCOUNTER_VARIANTS.filter(p=>unlockWave>=p.from);
        }
        function getSpecialEncounterPlan(currentWave,theme,side,index){
            const available=getSpecialEncounterKinds(currentWave);
            const kind=available[Math.max(0,index)%available.length];
            const opposite=(side+2)%4;
            const offset=(side+1)%4;
            const unit=(type,edge,slot,count,role='pressure')=>({type,side:edge,slot,count,role});
            let units;
            if(kind.type==='PINCER'){
                units=[unit('SWARM',side,0,2,'screen'),
                    unit(currentWave>=2?'DASHER':'SWARM',side,1,2,'flank'),
                    unit('SWARM',opposite,0,2,'screen'),
                    unit(currentWave>=2?'DASHER':'SWARM',opposite,1,2,'flank')];
            }else if(kind.type==='SPEARHEAD'){
                const guard=currentWave>=4&&theme==='SIEGE'?'SHIELD_BEARER':'TANK';
                units=[unit('SWARM',side,0,3,'screen'),unit(guard,side,1,3,'guard'),
                    unit(currentWave>=3?'SHOOTER':'SWARM',side,2,3,'payload')];
            }else if(kind.type==='ESCORT'){
                // Frontline protects the long-range sniper; no bonus enemy HP.
                units=[unit('SWARM',side,0,4,'screen'),unit('SHIELD_BEARER',side,1,4,'guard'),
                    unit('SNIPER',side,2,4,'payload'),unit('SWARM',side,3,4,'screen')];
            }else if(kind.type==='INTERCEPT'){
                units=[unit('DASHER',side,0,2,'flank'),unit('ASSASSIN',side,1,2,'flank'),
                    unit('DASHER',opposite,0,2,'flank'),unit('SHOOTER',opposite,1,2,'payload')];
            }else if(kind.type==='BREACH'){
                units=[unit('TANK',side,0,3,'anchor'),unit('SPLITTER',side,1,3,'pressure'),
                    unit('GRAV_WELL',side,2,3,'anchor'),unit('SWARM',offset,0,1,'flank')];
            }else if(kind.type==='CORRIDOR'){
                // Two offset lines leave the arena centre open as a readable escape lane.
                units=[unit('SHIELD_BEARER',side,0,3,'guard'),unit('SWARM',side,2,3,'lane'),
                    unit('SHIELD_BEARER',opposite,0,3,'guard'),unit('SWARM',opposite,2,3,'lane')];
            }else if(kind.type==='CROSSLOCK'){
                // Shooters anchor two perpendicular edges; dashers force the target choice.
                units=[unit('SHOOTER',side,0,3,'payload'),unit('DASHER',side,2,3,'flank'),
                    unit('SHOOTER',offset,0,3,'payload'),unit('ASSASSIN',offset,2,3,'flank')];
            }else{
                // PINWHEEL gives four clear approach directions and a weaker SWARM exit.
                units=[unit('SHIELD_BEARER',side,0,1,'guard'),
                    unit('SHOOTER',offset,0,1,'payload'),
                    unit('DASHER',opposite,0,1,'flank'),
                    unit('SWARM',(side+3)%4,0,1,'escape')];
            }
            return {
                type:kind.type,side,label:kind.label,color:kind.color,
                formationId:`${kind.type}:${currentWave}:${side}:${index}`,
                warning:SPECIAL_ENCOUNTER_WARNING,units,
                threatCost:Math.round(units.reduce((n,u)=>n+ENEMY_THREAT_COST[u.type],0)*10)/10
            };
        }


        // M5.12: Evaluate four candidate rotations only when meaningful player
        // movement has been observed. Retain the legacy random decision for an
        // idle/unknown player. No change to encounter kinds, units or token costs.
        function scoreTacticalDeployment(currentWave, theme, index, fallbackSide, memory, lastSide) {
            const fallback = ((fallbackSide % 4) + 4) % 4;
            const velocity = Math.hypot(memory?.vx || 0, memory?.vy || 0);
            if (!player || !Number.isFinite(velocity)) {
                return { side: fallback, mode: 'unobserved', clearance: null };
            }
            const observed = velocity >= 85 && (memory?.tracked || 0) >= 0.8;
            const headingX = observed ? memory.vx / velocity : 0;
            const headingY = observed ? memory.vy / velocity : 0;
            const safeDistance = Math.min(210, Math.min(worldWidth, worldHeight) * 0.24);
            const edgeX = [0, 1, 0, -1];
            const edgeY = [-1, 0, 1, 0];
            const candidates = [0, 1, 2, 3].map(side => {
                const plan = getSpecialEncounterPlan(currentWave, theme, side, index);
                let clearance = Infinity, crowd = 0;
                for (const unit of plan.units) {
                    const point = formationEdgePoint(unit.side, unit.slot, unit.count);
                    clearance = Math.min(clearance, Math.hypot(point.x - player.x, point.y - player.y));
                    for (const enemy of enemies) {
                        if (!enemy.dead && Math.hypot(point.x - enemy.x, point.y - enemy.y) < 185)
                            crowd++;
                    }
                }
                // PINWHEEL deliberately puts the weakest SWARM exit in the
                // player's current travel direction, rather than sealing it.
                const exit = plan.units.find(unit => unit.role === 'escape');
                const front = exit ? exit.side : side;
                const alignment = headingX * edgeX[front] + headingY * edgeY[front];
                const distancePenalty = Math.max(0, safeDistance - clearance) /
                    Math.max(1, safeDistance) * 8;
                const score = alignment * 2.8 - distancePenalty -
                    Math.min(4, crowd) * 0.65 - (side === lastSide ? 1.5 : 0);
                return { side, clearance, score };
            });
            const legal = candidates.filter(candidate => candidate.clearance >= safeDistance);
            const fallbackCandidate = candidates.find(candidate => candidate.side === fallback);
            // Idle players still deserve safe spawns. Keep the legacy random
            // direction unless it would put an entry almost on top of them.
            if (!observed && fallbackCandidate.clearance >= safeDistance) {
                return { side: fallback, mode: 'unobserved',
                    clearance: Math.round(fallbackCandidate.clearance) };
            }
            // If no edge is truly safe, maximize distance, not aggression.
            const choices = !observed ? candidates : (legal.length ? legal : candidates);
            choices.sort((a, b) => (!observed || !legal.length ?
                b.clearance - a.clearance : b.score - a.score) ||
                (((a.side - fallback + 4) % 4) - ((b.side - fallback + 4) % 4)));
            const best = choices[0];
            return {
                side: best.side, mode: !observed ? 'safety-only' :
                    (legal.length ? 'reading-motion' : 'safe-retreat'),
                clearance: Math.round(best.clearance),
                confidence: observed ? Math.round(velocity) : 0
            };
        }

        // Attack lines use the exact same volley configuration as the damage pipeline.
        // Never create a separate gameplay timing or projectile source in rendering.
        const BOSS_PHASE_VOLLEYS = Object.freeze({
            BOSS_DESTROYER: Object.freeze({count2:5,count3:7,spread:0.30,color:'#ff0055'}),
            BOSS_TITAN: Object.freeze({count2:3,count3:5,spread:0.22,color:'#ff8800'}),
            BOSS_VOID: Object.freeze({count2:5,count3:7,spread:0.38,color:'#b000ff'}),
            BOSS_PRISM: Object.freeze({count2:3,count3:5,spread:0.18,color:'#00f3ff'})
        });

        // Only cosmetic measurements are returned. All attacks stay in Enemy.update().
        function getBossAttackVisualState(boss) {
            if (!boss?.isBoss || boss.dead) return null;
            const phase=boss.bossSpecial;
            if (phase) {
                const total=phase.phase===3 ? 1.35 : 1.15;
                return {kind:phase.delay>0?'queued':'phase',
                    progress:phase.delay>0?0:Math.max(0,Math.min(1,1-phase.timer/total)),
                    angle:phase.angle, phase:phase.phase};
            }
            if (boss.type==='BOSS_TITAN' && boss.state==='CHARGE') {
                return {kind:'charge',progress:Math.max(0,Math.min(1,
                    1-boss.actionTimer/(boss.enraged?.5:.7))),angle:boss.dashTargetAngle};
            }
            if (boss.type==='BOSS_PRISM' && boss.actionTimer>0 && boss.actionTimer<.85) {
                return {kind:'aim',progress:Math.max(0,Math.min(1,1-boss.actionTimer/.85)),
                    angle:boss.aimAngle};
            }
            if (boss.type==='BOSS_DESTROYER' && boss.actionTimer>0 && boss.actionTimer<.65) {
                return {kind:'radial',progress:Math.max(0,Math.min(1,1-boss.actionTimer/.65)),
                    angle:boss.rotation};
            }
            if (boss.type==='BOSS_VOID' && boss.secondaryTimer>0 && boss.secondaryTimer<.65) {
                return {kind:'blink',progress:Math.max(0,Math.min(1,1-boss.secondaryTimer/.65)),
                    angle:boss.rotation};
            }
            return null;
        }

        function drawBossArenaPresence(ctx) {
            if (gameState!=='PLAYING' || !activeBosses.length) return;
            const tm=PREFERS_REDUCED_VFX_MOTION?0:totalTime;
            // Subdued, local-only floor motifs. No fullscreen overlays over projectiles.
            const quality=getBossFxQuality();
            if(quality===0) return;
            for (const boss of activeBosses) {
                if (boss.dead || !isBossFxInView(boss.x,boss.y,190)) continue;
                const r=boss.radius;
                ctx.save();
                ctx.translate(boss.x,boss.y);
                ctx.strokeStyle=boss.color;
                ctx.globalAlpha=.10+.018*boss.bossPhase;
                ctx.lineWidth=1.4;
                if(boss.type==='BOSS_DESTROYER') {
                    for(let i=0;i<(quality===2?4:2);i++){
                        ctx.save();ctx.rotate(i*Math.PI/2);
                        ctx.strokeRect(r*1.6,-5,r*.75,10);ctx.restore();
                    }
                } else if(boss.type==='BOSS_TITAN'){
                    for(let i=0;i<(quality===2?6:3);i++){
                        const a=i*Math.PI/3+Math.PI/6;
                        ctx.beginPath();ctx.arc(Math.cos(a)*r*1.7,Math.sin(a)*r*1.7,
                            7,a-.6,a+.6);ctx.stroke();
                    }
                } else if(boss.type==='BOSS_VOID') {
                    ctx.setLineDash([7,17]);ctx.beginPath();
                    ctx.arc(0,0,r*2.1,tm*.13,tm*.13+Math.PI*2);ctx.stroke();
                    ctx.setLineDash([]);
                } else if(boss.type==='BOSS_PRISM') {
                    ctx.rotate(Math.PI/4);ctx.strokeRect(-r*1.3,-r*1.3,r*2.6,r*2.6);
                    if(quality===2)ctx.strokeRect(-r*1.6,-r*1.6,r*3.2,r*3.2);
                }
                ctx.restore();
            }
        }

        function drawBossAttackTelegraph(ctx, boss) {
            if (boss.dead || !boss.isBoss) return;
            const state=getBossAttackVisualState(boss);
            const reduced=PREFERS_REDUCED_VFX_MOTION;
            const clock=reduced?0:totalTime;
            const r=boss.radius;
            const alphaBase=activeBosses.length>1?.55:.76;
            // Pure presentation: phase-change resonance expires independently of attack scheduling.
            if (boss.bossPhaseFlash>0 && isBossFxInView(boss.x,boss.y)) {
                ctx.save();ctx.translate(boss.x,boss.y);
                ctx.globalAlpha=Math.min(.52,boss.bossPhaseFlash*.58);
                ctx.strokeStyle=boss.color;ctx.lineWidth=3;
                const grow=reduced?1:1+(1-boss.bossPhaseFlash/.7)*.46;
                bossPolygon(ctx,boss.type==='BOSS_PRISM'?4:
                    boss.type==='BOSS_DESTROYER'?8:6,r*grow,clock*.16);
                ctx.stroke();
                // Phase transition: brief segmented energy locks, no broad screen flash.
                if(getBossFxQuality()>=1) {
                    ctx.globalAlpha=Math.min(.32,boss.bossPhaseFlash*.43);
                    ctx.lineWidth=1.5;ctx.strokeStyle='#f5ffff';
                    for(let i=0;i<3;i++) {
                        const a=i*Math.PI*2/3+clock*.3;
                        ctx.beginPath();ctx.arc(0,0,r*1.48,a,a+.36);ctx.stroke();
                    }
                }
                ctx.restore();
            }
            // Void gravity exists throughout the encounter. The ring is the actual pull radius.
            if (boss.type==='BOSS_VOID') {
                ctx.save();ctx.strokeStyle=boss.color;
                ctx.globalAlpha=activeBosses.length>1?.24:.32;
                ctx.lineWidth=2;ctx.setLineDash([9,15]);
                ctx.beginPath();ctx.arc(boss.x,boss.y,320,0,Math.PI*2);ctx.stroke();
                ctx.setLineDash([]);ctx.restore();
            }
            if (!state || state.kind==='queued') {
                // Reserved multi-boss telegraphs do NOT look like a firing attack.
                if (state?.kind==='queued') {
                    ctx.save();ctx.globalAlpha=.3;ctx.strokeStyle=boss.color;ctx.lineWidth=2;
                    ctx.setLineDash([3,9]);ctx.beginPath();
                    ctx.arc(boss.x,boss.y,r+16,0,Math.PI*2);ctx.stroke();ctx.restore();
                }
                return;
            }
            ctx.save();
            ctx.translate(boss.x,boss.y);
            ctx.strokeStyle=boss.color;
            ctx.lineCap='round';
            const bright=.20+.31*state.progress;
            ctx.globalAlpha=alphaBase*(reduced?.75:1);
            if(state.kind==='phase'){
                const config=BOSS_PHASE_VOLLEYS[boss.type];
                const count=state.phase===3?config.count3:config.count2;
                const distance=Math.max(worldWidth,worldHeight);
                // Fan rays match the precise angles of the existing phase volley.
                for(let i=0;i<count;i++){
                    const a=state.angle+(i-(count-1)/2)*config.spread;
                    const length=distance; // Full flight lane: never understate the threatened path.
                    ctx.beginPath();ctx.moveTo(Math.cos(a)*r*.65,Math.sin(a)*r*.65);
                    ctx.lineTo(Math.cos(a)*length,Math.sin(a)*length);
                    ctx.strokeStyle=i===(count-1)/2? '#f6fbff':config.color;
                    ctx.globalAlpha=(.30+.25*state.progress)*(activeBosses.length>1?.87:1);
                    ctx.lineWidth=state.phase===3?2.9:2.2;ctx.setLineDash([12,12]);ctx.stroke();
                }
                ctx.setLineDash([]);
                // An archetype-specific charging element is distinct from the actual projectile lanes.
                ctx.globalAlpha=bright;ctx.strokeStyle=boss.color;
                ctx.lineWidth=state.phase===3?4:2.5;
                if(boss.type==='BOSS_DESTROYER'){
                    bossPolygon(ctx,8,r*(1.28+state.progress*.1),Math.PI/8);ctx.stroke();
                } else if(boss.type==='BOSS_TITAN'){
                    ctx.rotate(state.angle);
                    ctx.strokeRect(r*.8,-r*.31,r*.88,r*.62);
                } else if(boss.type==='BOSS_VOID'){
                    for(let i=0;i<3;i++){const a=i*Math.PI*2/3+clock*.24;
                        ctx.beginPath();ctx.arc(0,0,r*1.45,a,a+.58);ctx.stroke();}
                } else if(boss.type==='BOSS_PRISM'){
                    ctx.rotate(Math.PI/4);
                    ctx.strokeRect(-r*.93,-r*.93,r*1.86,r*1.86);
                }
            } else if(state.kind==='charge') {
                // Titan dash: paired corridor edges, not a fake damaging area fill.
                ctx.rotate(state.angle);
                ctx.lineWidth=3.2;ctx.globalAlpha=bright+.20;
                ctx.setLineDash([14,11]);
                for(const sign of [-1,1]){
                    ctx.beginPath();ctx.moveTo(r*.5,sign*r*.62);
                    ctx.lineTo(480,sign*r*.62);ctx.stroke();
                }
                ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(450,-r*.77);
                ctx.lineTo(480,0);ctx.lineTo(450,r*.77);ctx.stroke();
            } else if(state.kind==='aim') {
                // Prism focus: thin central ray and fine parallel energy threads.
                ctx.rotate(state.angle);ctx.lineWidth=2.1;ctx.globalAlpha=bright+.16;
                ctx.setLineDash([14,8]);
                ctx.beginPath();ctx.moveTo(r*.8,0);ctx.lineTo(650,0);ctx.stroke();
                ctx.setLineDash([]);ctx.globalAlpha=.22;
                for(const sign of [-1,1]){
                    ctx.beginPath();ctx.moveTo(r,sign*9);ctx.lineTo(235,sign*9);ctx.stroke();
                }
            } else if(state.kind==='radial') {
                // Destroyer arms preload the radial attack without inventing damage zones.
                ctx.lineWidth=2.5;ctx.globalAlpha=bright;
                for(let i=0;i<8;i++){
                    const a=i*Math.PI/4+state.angle;
                    ctx.beginPath();ctx.moveTo(Math.cos(a)*r*1.03,Math.sin(a)*r*1.03);
                    ctx.lineTo(Math.cos(a)*r*(1.25+state.progress*.15),
                        Math.sin(a)*r*(1.25+state.progress*.15));ctx.stroke();
                }
            } else if(state.kind==='blink'){
                // Destination is deliberately not shown: reposition is randomized in game logic.
                ctx.setLineDash([3,9]);ctx.lineWidth=2;
                ctx.globalAlpha=bright;ctx.rotate(clock*.35);
                ctx.beginPath();ctx.arc(0,0,r*1.35,0,Math.PI*2);ctx.stroke();
            }
            ctx.restore();
        }

        function drawBossAttackTelegraphs(ctx) {
            if (gameState!=='PLAYING') return;
            for(const boss of activeBosses) if(!boss.dead) drawBossAttackTelegraph(ctx,boss);
        }

        function fireBossPhaseAttack(boss, angle, phase) {
            const baseSpeed = phase === 3 ? 330 : 275;
            const damage = Math.round(boss.damage * (phase === 3 ? 0.55 : 0.45));
            const config = BOSS_PHASE_VOLLEYS[boss.type];
            if (!config || boss.dead) return 0;
            const count = phase === 3 ? config.count3 : config.count2;
            for (let i = 0; i < count; i++) {
                const a = angle + (i - (count - 1) / 2) * config.spread;
                enemyProjectiles.push(new EnemyProjectile(boss.x, boss.y,
                    Math.cos(a) * baseSpeed, Math.sin(a) * baseSpeed, 7, damage, config.color));
            }
            boss.bossVolleyRecoil = .25; // visual recoil only, after the existing volley fires
            audio.playExplosion(false);
            return count;
        }


        // M5.17. Arena chapters change both visual identity and positional rules.
        // Existing arena missions and the boss subsystem always have priority.
        const ARENA_CHAPTERS = Object.freeze({
            FOUNDRY: Object.freeze({label:'KOR DÖKÜMHANESİ',short:'DÖKÜMHANE',
                caption:'Kızgın raylar · uyarıdan sonra hattı terk et',
                color:'#ff9757',dark:'#180d17',accent:'#ffd392',glyph:'▰'}),
            GARDEN: Object.freeze({label:'İYON BAHÇESİ',short:'BAHÇE',
                caption:'İyon çiçeklerini doldur · rakipleri sersemlet',
                color:'#6fffc6',dark:'#071d19',accent:'#b3ffe0',glyph:'✦'}),
            RIFT: Object.freeze({label:'YARIK GEÇİDİ',short:'YARIK',
                caption:'Geçide gir · uzak kapıdan çık',
                color:'#bd93ff',dark:'#100d25',accent:'#ebe1ff',glyph:'◇'})
        });
        const ARENA_CHAPTER_ORDER = Object.freeze(['FOUNDRY','GARDEN','RIFT']);
        const CHAPTER_RULES = Object.freeze({
            foundryCycle:6, foundryWarn:1.5, foundryActiveEnd:2.05,
            foundryHalfWidth:26, foundryHitCap:12,
            gardenCharge:1.6, gardenCooldown:10, gardenRadius:58,
            gardenStunRadius:175, gardenHitCap:8,
            riftRadius:49, riftCooldown:11, riftInvuln:.55,
            riftPursuitTell:1.05, riftPursuitCooldown:16
        });
        let arenaChapter = null;
        let chapterAnnounceUntil = 0;
        let chapterStats = {changes:0,foundryEnemyHits:0,foundryPlayerHits:0,
            gardenBursts:0,gardenStuns:0,riftWarps:0,riftReroutes:0,
            foundryDodges:0,gardenContestedSeconds:0,riftEnemyFlanks:0,
            riftInterrupted:0};
        const chapterGardenCharge = [0,0,0];
        const chapterGardenReady = [-Infinity,-Infinity,-Infinity];
        const chapterGardenContested = [0,0,0];
        let chapterRiftArmed = true;
        let chapterRiftReadyAt = 0;
        let chapterRiftLastWarpAt = -Infinity;
        let chapterRiftLastWarpSource = -1;
        let chapterRiftPursuit = null;
        let chapterRiftPursuitReadyAt = 0;
        let chapterFoundryLastPulse = -1;
        // Foundry timing starts in its first eligible frame, never mid-pulse.
        let chapterFoundryAnchor = null;

        // M5.20: one cinematic encounter on each chapter's middle wave.
        // Neither a new spawn budget nor a reward system; existing entities
        // and arena rules provide the stakes, while the stage owns the visuals.
        const CHAPTER_SHOWCASES=Object.freeze({
            FOUNDRY:Object.freeze({name:'KIZIL MAKAS',hint:'İKİ DİKEY PRES · SÜRÜYÜ HATTA ÇEK',color:'#ffb36f',duration:5.2}),
            GARDEN:Object.freeze({name:'İYON KOROSU',hint:'İKİ FARKLI ÇİÇEĞİ DOLDUR',color:'#86ffe0',duration:14}),
            RIFT:Object.freeze({name:'FAZ KISKACI',hint:'İŞARETTEN UZAKLAŞ YA DA DÜŞMANI DURDUR',color:'#e3a6ff',duration:4.5})
        });
        let chapterShowcase=null;
        let chapterShowcaseAttemptedWave=0;
        let chapterShowcaseStats={started:0,completed:0,cancelled:0,
            pressEnemyHits:0,pressPlayerHits:0,ionHarmonies:0,ionStuns:0,
            pincerFlanks:0,pincerEvades:0};

        function chapterIdForWave(currentWave) {
            if (!Number.isFinite(currentWave) || currentWave < 4) return null;
            return ARENA_CHAPTER_ORDER[Math.floor((currentWave-4)/3)%3];
        }
        function getGardenCenters() {
            return [
                {x:worldWidth*.25,y:worldHeight*.38},
                {x:worldWidth*.72,y:worldHeight*.35},
                {x:worldWidth*.51,y:worldHeight*.72}
            ];
        }
        function getRiftCenters() {
            return [
                {x:Math.max(75,worldWidth*.16),y:worldHeight*.46},
                {x:Math.min(worldWidth-75,worldWidth*.84),y:worldHeight*.54}
            ];
        }
        function chapterEffectsAllowed() {
            return gameState==='PLAYING' && !!player &&
                activeBosses.every(b=>b.dead) &&
                nextBossTime-totalTime>4.0 &&
                !combatDirector?.activeArenaEvent;
        }
        function resetChapterBiome() {
            arenaChapter = null;
            chapterAnnounceUntil = 0;
            chapterStats={changes:0,foundryEnemyHits:0,foundryPlayerHits:0,
                gardenBursts:0,gardenStuns:0,riftWarps:0,riftReroutes:0,
            foundryDodges:0,gardenContestedSeconds:0,riftEnemyFlanks:0,
            riftInterrupted:0};
            chapterGardenCharge.fill(0);
            chapterGardenReady.fill(-Infinity);
            chapterGardenContested.fill(0);
            chapterRiftPursuit=null;
            chapterRiftPursuitReadyAt=0;
            chapterRiftLastWarpAt=-Infinity;
            chapterRiftLastWarpSource=-1;
            chapterRiftArmed=true;
            chapterRiftReadyAt=0;
            chapterFoundryLastPulse=-1;
            chapterFoundryAnchor=null;
            chapterShowcase=null;
            chapterShowcaseAttemptedWave=0;
            chapterShowcaseStats={started:0,completed:0,cancelled:0,
                pressEnemyHits:0,pressPlayerHits:0,ionHarmonies:0,ionStuns:0,
                pincerFlanks:0,pincerEvades:0};
        }
        function startChapterIfChanged() {
            const next = chapterIdForWave(wave);
            if (arenaChapter===next) return false;
            arenaChapter=next;
            chapterShowcase=null;
            chapterGardenCharge.fill(0);
            chapterGardenReady.fill(-Infinity);
            chapterGardenContested.fill(0);
            chapterRiftPursuit=null;
            chapterRiftPursuitReadyAt=0;
            chapterRiftLastWarpAt=-Infinity;
            chapterRiftLastWarpSource=-1;
            chapterRiftArmed=true;
            chapterRiftReadyAt=0;
            chapterFoundryLastPulse=-1;
            chapterFoundryAnchor=null;
            if (!next) return false;
            chapterAnnounceUntil=totalTime+5.0;
            chapterStats.changes++;
            const d=ARENA_CHAPTERS[next];
            createFloatingText(player.x,player.y-54,d.label,d.color,17);
            return true;
        }
        function chapterFoundryPhase(t=totalTime) {
            if(chapterFoundryAnchor===null)return 0;
            return Math.max(0,t-chapterFoundryAnchor)%CHAPTER_RULES.foundryCycle;
        }
        function steerFoundryRangedEnemy(enemy,fromX,fromY) {
            if(arenaChapter!=='FOUNDRY'||!chapterEffectsAllowed()||
                enemy.dead||enemy.stunTimer>0||
                (enemy.type!=='SHOOTER'&&enemy.type!=='SNIPER')||
                chapterFoundryPhase()>=CHAPTER_RULES.foundryWarn)return;
            const traveled=Math.hypot(enemy.x-fromX,enemy.y-fromY);
            if(traveled<0.001)return;
            const rails=[worldHeight*.32,worldHeight*.68];
            const nearest=rails[Math.abs(enemy.y-rails[0])<Math.abs(enemy.y-rails[1])?0:1];
            const clearance=CHAPTER_RULES.foundryHalfWidth+enemy.radius+24;
            if(Math.abs(enemy.y-nearest)>clearance)return;
            const escape=nearest+(enemy.y<nearest?-1:1)*clearance;
            const desiredX=enemy.x-fromX,desiredY=escape-fromY;
            const norm=Math.hypot(desiredX,desiredY)||1;
            enemy.x=Math.max(enemy.radius,Math.min(worldWidth-enemy.radius,
                fromX+traveled*desiredX/norm));
            enemy.y=Math.max(enemy.radius,Math.min(worldHeight-enemy.radius,
                fromY+traveled*desiredY/norm));
            const pulse=Math.floor(Math.max(0,totalTime-chapterFoundryAnchor)/
                CHAPTER_RULES.foundryCycle);
            if(enemy.lastFoundryDodgePulse!==pulse){
                enemy.lastFoundryDodgePulse=pulse;
                chapterStats.foundryDodges++;
            }
        }
        function updateFoundryChapter() {
            const phase=chapterFoundryPhase();
            if (phase<CHAPTER_RULES.foundryWarn ||
                phase>=CHAPTER_RULES.foundryActiveEnd) return;
            const pulse=Math.floor(Math.max(0,totalTime-chapterFoundryAnchor)/CHAPTER_RULES.foundryCycle);
            if (chapterFoundryLastPulse===pulse) return;
            chapterFoundryLastPulse=pulse;
            const ys=[worldHeight*.32,worldHeight*.68];
            if (ys.some(y=>Math.abs(player.y-y)<=CHAPTER_RULES.foundryHalfWidth)) {
                const prev=player.hp;
                player.takeDamage(9);
                if(player.hp<prev)chapterStats.foundryPlayerHits++;
            }
            let hits=0;
            for(const e of enemies){
                if(hits>=CHAPTER_RULES.foundryHitCap) break;
                if(e.dead||e.isBoss||!ys.some(y=>
                    Math.abs(e.y-y)<=CHAPTER_RULES.foundryHalfWidth)) continue;
                e.takeDamage(Math.min(70,player.damage*.65+18),0,0,false,false);
                hits++;
            }
            chapterStats.foundryEnemyHits+=hits;
            if(hits)shockwaves.push(new Shockwave(worldWidth*.5,ys[0],85,
                ARENA_CHAPTERS.FOUNDRY.color,.25));
        }
        function updateGardenChapter(dt) {
            const nodes=getGardenCenters();
            for(let i=0;i<nodes.length;i++){
                if(totalTime<chapterGardenReady[i]){
                    chapterGardenContested[i]=0;
                    continue;
                }
                const p=nodes[i];
                const inside=Math.hypot(player.x-p.x,player.y-p.y) <
                    CHAPTER_RULES.gardenRadius-player.radius*.25;
                // At most two nearby unstunned tactical units can interfere.
                // Interference slows charging, never fully locks the player out.
                let contest=0;
                for(const e of enemies){
                    if(e.dead||e.isBoss||e.stunTimer>0||
                        !['SHOOTER','SNIPER','SHIELD_BEARER'].includes(e.type))continue;
                    if(Math.hypot(e.x-p.x,e.y-p.y)<CHAPTER_RULES.gardenRadius+e.radius+12)
                        if(++contest>=2)break;
                }
                chapterGardenContested[i]=contest;
                if(inside&&contest)chapterStats.gardenContestedSeconds+=dt;
                const speed=inside?Math.max(.4,1-contest*.3):-1.5;
                chapterGardenCharge[i]=Math.max(0,Math.min(CHAPTER_RULES.gardenCharge,
                    chapterGardenCharge[i]+dt*speed));
                if(chapterGardenCharge[i]<CHAPTER_RULES.gardenCharge)continue;
                chapterGardenReady[i]=totalTime+CHAPTER_RULES.gardenCooldown;
                chapterGardenCharge[i]=0;
                chapterStats.gardenBursts++;
                let stunned=0;
                for(const e of enemies){
                    if(stunned>=CHAPTER_RULES.gardenHitCap)break;
                    if(e.dead||e.isBoss||Math.hypot(e.x-p.x,e.y-p.y)>
                        CHAPTER_RULES.gardenStunRadius)continue;
                    e.stunTimer=Math.max(e.stunTimer,1.15);
                    stunned++;
                }
                chapterStats.gardenStuns+=stunned;
                recordShowcaseIonFlower(i);
                shockwaves.push(new Shockwave(p.x,p.y,
                    CHAPTER_RULES.gardenStunRadius,ARENA_CHAPTERS.GARDEN.color,.48));
                createFloatingText(p.x,p.y-48,'İYON ÇİÇEĞİ · '+stunned+' SERSEM',
                    ARENA_CHAPTERS.GARDEN.color,13);
            }
        }
        // Keep an empty portal centered. If its exit is crowded, select a nearby
        // safer landing using a bounded deterministic search, without RNG.
        function chooseRiftLanding(dest) {
            const margin=Math.max(26,player.radius+8);
            const clamp=(value,max)=>Math.max(margin,Math.min(max-margin,value));
            const candidates=[{x:clamp(dest.x,worldWidth),y:clamp(dest.y,worldHeight)}];
            for(const radius of [72,120]){
                for(let i=0;i<8;i++){
                    const a=i*Math.PI/4;
                    candidates.push({x:clamp(dest.x+Math.cos(a)*radius,worldWidth),
                        y:clamp(dest.y+Math.sin(a)*radius,worldHeight)});
                }
            }
            let chosen=candidates[0],lowest=Infinity;
            for(const point of candidates){
                let risk=Math.hypot(point.x-dest.x,point.y-dest.y)*.6;
                for(const enemy of enemies){
                    if(!enemy||enemy.dead)continue;
                    const gap=Math.hypot(point.x-enemy.x,point.y-enemy.y)-
                        (Number.isFinite(enemy.radius)?enemy.radius:18)-player.radius;
                    if(gap<120)risk+=(120-gap)*(120-gap);
                }
                for(const shot of enemyProjectiles){
                    if(!shot||shot.dead)continue;
                    const gap=Math.hypot(point.x-shot.x,point.y-shot.y)-
                        (Number.isFinite(shot.radius)?shot.radius:7)-player.radius;
                    if(gap<60)risk+=(60-gap)*(60-gap)*1.5;
                }
                if(risk<lowest){lowest=risk;chosen=point;}
            }
            return chosen;
        }
        function updateRiftPursuit(nodes) {
            if(chapterRiftPursuit){
                const plan=chapterRiftPursuit;
                if(totalTime<plan.readyAt)return;
                chapterRiftPursuit=null;
                const e=enemies.find(unit=>unit.id===plan.enemyId);
                if(!e||e.dead||e.isBoss||e.stunTimer>0||
                    Math.hypot(e.x-nodes[plan.from].x,e.y-nodes[plan.from].y)>83||
                    Math.hypot(player.x-nodes[plan.to].x,player.y-nodes[plan.to].y)>315){
                    chapterStats.riftInterrupted++;
                    return;
                }
                const gate=nodes[plan.to];
                // Follow from a visible portal, land outside contact range,
                // and give the player another half-second to react.
                const options=[[0,120],[0,-120],[120,0],[-120,0]];
                let spot=null,score=-Infinity;
                for(const [ox,oy] of options){
                    const x=Math.max(e.radius+6,Math.min(worldWidth-e.radius-6,gate.x+ox));
                    const y=Math.max(e.radius+6,Math.min(worldHeight-e.radius-6,gate.y+oy));
                    const gap=Math.hypot(player.x-x,player.y-y);
                    if(gap>score){score=gap;spot={x,y};}
                }
                if(score<player.radius+e.radius+65){
                    chapterStats.riftInterrupted++;
                    return;
                }
                e.x=spot.x;e.y=spot.y;
                e.stunTimer=Math.max(e.stunTimer,.5);
                e.actionTimer=Math.max(e.actionTimer,.8);
                e.state='CHASE';e.pushVx=0;e.pushVy=0;
                e.crowdSteerX=0;e.crowdSteerY=0;
                chapterStats.riftEnemyFlanks++;
                shockwaves.push(new Shockwave(spot.x,spot.y,90,'#ffc078',.28));
                createFloatingText(spot.x,spot.y-38,'YARIK TAKİPÇİSİ','#ffc078',12);
                return;
            }
            // A single living pursuer may follow a recent player warp. The
            // player can break it by moving away or stunning the pursuer.
            if(totalTime-chapterRiftLastWarpAt>2.5||
                totalTime<chapterRiftPursuitReadyAt||chapterRiftLastWarpSource<0)return;
            const from=chapterRiftLastWarpSource,to=1-from;
            if(Math.hypot(player.x-nodes[to].x,player.y-nodes[to].y)>315)return;
            const e=enemies.find(unit=>!unit.dead&&!unit.isBoss&&
                (unit.type==='ASSASSIN'||unit.type==='DASHER')&&
                unit.stunTimer<=0&&
                Math.hypot(unit.x-nodes[from].x,unit.y-nodes[from].y)<=65);
            if(!e)return;
            chapterRiftPursuit={enemyId:e.id,from,to,
                readyAt:totalTime+CHAPTER_RULES.riftPursuitTell};
            chapterRiftPursuitReadyAt=totalTime+CHAPTER_RULES.riftPursuitCooldown;
        }
        function updateRiftChapter() {
            const nodes=getRiftCenters();
            updateRiftPursuit(nodes);
            const within=nodes.map(n=>Math.hypot(player.x-n.x,player.y-n.y)<
                CHAPTER_RULES.riftRadius);
            if(!within.some(Boolean)){
                chapterRiftArmed=true;
                return;
            }
            if(!chapterRiftArmed||totalTime<chapterRiftReadyAt)return;
            const from=within[0]?0:1, source=nodes[from],dest=nodes[1-from];
            chapterRiftArmed=false;
            chapterRiftReadyAt=totalTime+CHAPTER_RULES.riftCooldown;
            chapterRiftLastWarpAt=totalTime;
            chapterRiftLastWarpSource=from;
            chapterStats.riftWarps++;
            shockwaves.push(new Shockwave(source.x,source.y,95,
                ARENA_CHAPTERS.RIFT.color,.36));
            const landing=chooseRiftLanding(dest);
            if(Math.hypot(landing.x-dest.x,landing.y-dest.y)>1)
                chapterStats.riftReroutes++;
            player.x=landing.x;
            player.y=landing.y;
            player.lastPos.x=player.x;
            player.lastPos.y=player.y;
            player.vx=0;player.vy=0;
            player.invulnTimer=Math.max(player.invulnTimer,
                CHAPTER_RULES.riftInvuln);
            player.circuitTrace=[];
            player.circuitLength=0;
            player.circuitStartedAt=totalTime;
            mouse.active=false;
            shockwaves.push(new Shockwave(dest.x,dest.y,110,
                ARENA_CHAPTERS.RIFT.accent,.42));
            createFloatingText(dest.x,dest.y-36,'YARIK GEÇİŞİ',
                ARENA_CHAPTERS.RIFT.accent,15);
        }

        function showcaseClamp(value,radius,max) {
            return Math.max(radius+10,Math.min(max-radius-10,value));
        }
        function chapterShowcaseSnapshot() {
            if(!chapterShowcase)return null;
            const op=chapterShowcase;
            return {id:op.id,name:CHAPTER_SHOWCASES[op.id].name,
                elapsed:Math.round((totalTime-op.start)*10)/10,
                remaining:Math.max(0,Math.round((op.endAt-totalTime)*10)/10),
                pulseMask:op.pulseMask||0,flowerMask:op.flowerMask||0,
                completed:!!op.completed,
                targets:op.targets?.map(t=>({enemyId:t.enemyId,x:t.x,y:t.y}))||[]};
        }
        function beginChapterShowcase() {
            if(!arenaChapter||wave<5||(wave-5)%3!==0||
                chapterShowcaseAttemptedWave===wave||waveTimer<1.2||
                !chapterEffectsAllowed())return false;
            let targets=[];
            if(arenaChapter==='RIFT'){
                const eligible=enemies.filter(e=>!e.dead&&!e.isBoss&&e.stunTimer<=0&&
                    ['ASSASSIN','DASHER','SHOOTER'].includes(e.type)&&
                    (e.state==='CHASE'||e.type==='SHOOTER'));
                if(!eligible.length)return false;
                eligible.sort((a,b)=>Math.hypot(a.x-player.x,a.y-player.y)-
                    Math.hypot(b.x-player.x,b.y-player.y));
                const offsets=[[-188,-100],[188,100]];
                targets=eligible.slice(0,2).map((e,i)=>{
                    const [ox,oy]=offsets[i];
                    return {enemyId:e.id,
                        x:showcaseClamp(player.x+ox,e.radius,worldWidth),
                        y:showcaseClamp(player.y+oy,e.radius,worldHeight)};
                });
            }
            chapterShowcaseAttemptedWave=wave;
            const spec=CHAPTER_SHOWCASES[arenaChapter];
            chapterShowcase={id:arenaChapter,start:totalTime,
                endAt:totalTime+spec.duration, pulseMask:0,flowerMask:0,
                completed:false,targets,
                anchorX:player.x,anchorY:player.y};
            chapterShowcaseStats.started++;
            if(arenaChapter==='FOUNDRY'){
                chapterFoundryAnchor=null;
                chapterFoundryLastPulse=-1;
            }
            chapterAnnounceUntil=Math.max(chapterAnnounceUntil,totalTime+3);
            createFloatingText(player.x,player.y-80,spec.name,spec.color,18);
            return true;
        }
        function cancelChapterShowcase() {
            if(!chapterShowcase)return;
            chapterShowcaseStats.cancelled++;
            chapterShowcase=null;
            chapterFoundryAnchor=null;
            chapterFoundryLastPulse=-1;
        }
        function fireFoundryPress(index) {
            const x=worldWidth*(index===0?.28:.72);
            const width=35;
            if(Math.abs(player.x-x)<width+player.radius){
                const hp=player.hp;
                player.takeDamage(8);
                if(player.hp<hp)chapterShowcaseStats.pressPlayerHits++;
            }
            let hits=0;
            for(const enemy of enemies){
                if(hits>=10)break;
                if(enemy.dead||enemy.isBoss||
                    Math.abs(enemy.x-x)>width+enemy.radius)continue;
                enemy.takeDamage(Math.min(85,player.damage*.7+25),0,0,false,false);
                hits++;
            }
            chapterShowcaseStats.pressEnemyHits+=hits;
            shockwaves.push(new Shockwave(x,worldHeight*.5,130,'#ffb36f',.4));
        }
        function recordShowcaseIonFlower(index) {
            const op=chapterShowcase;
            if(!op||op.id!=='GARDEN'||op.completed||
                totalTime>=op.endAt)return;
            op.flowerMask|=1<<index;
            if((op.flowerMask & (op.flowerMask-1))===0)return;
            op.completed=true;
            op.endAt=Math.min(op.endAt,totalTime+2.5);
            chapterShowcaseStats.ionHarmonies++;
            chapterShowcaseStats.completed++;
            let stunned=0;
            for(const enemy of enemies){
                if(stunned>=14)break;
                if(enemy.dead||enemy.isBoss)continue;
                enemy.stunTimer=Math.max(enemy.stunTimer,1.8);
                stunned++;
            }
            chapterShowcaseStats.ionStuns+=stunned;
            shockwaves.push(new Shockwave(worldWidth*.5,worldHeight*.5,
                Math.min(worldWidth,worldHeight)*.58,'#86ffe0',.8));
            createFloatingText(player.x,player.y-65,'İYON KOROSU · REZONANS!',
                '#86ffe0',17);
        }
        function resolveRiftPincer(op) {
            if(Math.hypot(player.x-op.anchorX,player.y-op.anchorY)>155){
                chapterShowcaseStats.pincerEvades+=op.targets.length;
                return;
            }
            for(const target of op.targets){
                const enemy=enemies.find(e=>e.id===target.enemyId);
                if(!enemy||enemy.dead||enemy.isBoss||enemy.stunTimer>0||
                    Math.hypot(player.x-target.x,player.y-target.y)<
                    player.radius+enemy.radius+85){
                    chapterShowcaseStats.pincerEvades++;
                    continue;
                }
                enemy.x=target.x;enemy.y=target.y;
                enemy.state='CHASE';
                enemy.stunTimer=Math.max(enemy.stunTimer,.65);
                enemy.actionTimer=Math.max(enemy.actionTimer,1.2);
                enemy.pushVx=0;enemy.pushVy=0;
                enemy.crowdSteerX=0;enemy.crowdSteerY=0;
                chapterShowcaseStats.pincerFlanks++;
                shockwaves.push(new Shockwave(enemy.x,enemy.y,108,
                    '#e3a6ff',.45));
            }
        }
        function updateChapterShowcase() {
            const op=chapterShowcase;
            if(!op)return;
            const elapsed=totalTime-op.start;
            if(op.id==='FOUNDRY'){
                for(let i=0;i<2;i++){
                    const moment=i===0?1.8:3.8;
                    if(elapsed>=moment&&!(op.pulseMask&(1<<i))){
                        op.pulseMask|=1<<i;
                        // Skipped frames cannot apply a hit after its warning.
                        if(elapsed<moment+.5)fireFoundryPress(i);
                    }
                }
            }else if(op.id==='RIFT'&&!op.completed&&elapsed>=2.2){
                op.completed=true;
                if(elapsed<2.7)resolveRiftPincer(op);
                chapterShowcaseStats.completed++;
            }
            if(totalTime>=op.endAt){
                if(op.id==='FOUNDRY')chapterShowcaseStats.completed++;
                chapterShowcase=null;
                chapterFoundryAnchor=null;
                chapterFoundryLastPulse=-1;
            }
        }
        function drawChapterShowcase(ctx) {
            if(!chapterShowcase||!chapterEffectsAllowed())return;
            const op=chapterShowcase;
            const elapsed=totalTime-op.start;
            const low=graphicsQuality==='low';
            ctx.save();
            if(op.id==='FOUNDRY'){
                for(let i=0;i<2;i++){
                    const moment=i===0?1.8:3.8;
                    if(elapsed>moment+.5)continue;
                    const x=worldWidth*(i===0?.28:.72);
                    const active=elapsed>=moment;
                    ctx.fillStyle=active?'#ffc178':'#ff874b';
                    ctx.strokeStyle=active?'#fff3cc':'#ffb36f';
                    ctx.lineWidth=active?5:3;
                    ctx.globalAlpha=active?.28:.13;
                    ctx.fillRect(x-35,0,70,worldHeight);
                    ctx.globalAlpha=active?1:.78;
                    if(!active)ctx.setLineDash([14,11]);
                    ctx.beginPath();ctx.moveTo(x-35,0);ctx.lineTo(x-35,worldHeight);
                    ctx.moveTo(x+35,0);ctx.lineTo(x+35,worldHeight);
                    ctx.stroke();ctx.setLineDash([]);
                    // The press teeth make this unmistakably vertical machinery.
                    const teeth=low?5:10;
                    for(let k=0;k<teeth;k++){
                        const y=(k+.5)*worldHeight/teeth;
                        ctx.beginPath();ctx.moveTo(x-19,y-10);
                        ctx.lineTo(x,y);ctx.lineTo(x-19,y+10);ctx.stroke();
                        ctx.beginPath();ctx.moveTo(x+19,y-10);
                        ctx.lineTo(x,y);ctx.lineTo(x+19,y+10);ctx.stroke();
                    }
                }
            }else if(op.id==='GARDEN'){
                const nodes=getGardenCenters();
                ctx.strokeStyle='#86ffe0';ctx.lineWidth=low?2:4;
                ctx.globalAlpha=op.completed?.9:.5;
                ctx.beginPath();ctx.moveTo(nodes[0].x,nodes[0].y);
                ctx.lineTo(nodes[1].x,nodes[1].y);
                ctx.lineTo(nodes[2].x,nodes[2].y);
                ctx.closePath();ctx.stroke();
                for(let i=0;i<nodes.length;i++){
                    const on=!!(op.flowerMask&(1<<i));
                    ctx.strokeStyle=on?'#fff5b2':'#86ffe0';
                    ctx.globalAlpha=on?1:.6;
                    ctx.lineWidth=on?6:3;
                    ctx.beginPath();ctx.arc(nodes[i].x,nodes[i].y,
                        CHAPTER_RULES.gardenRadius+22,0,Math.PI*2);ctx.stroke();
                    if(on){
                        ctx.beginPath();ctx.arc(nodes[i].x,nodes[i].y,
                            CHAPTER_RULES.gardenRadius+28,0,Math.PI*2);ctx.stroke();
                    }
                }
            }else if(op.id==='RIFT'){
                const gates=getRiftCenters();
                ctx.strokeStyle='#e3a6ff';ctx.lineWidth=3;
                ctx.globalAlpha=op.completed?.25:.95;
                if(!op.completed)ctx.setLineDash([10,8]);
                for(const target of op.targets){
                    const from=target.x<worldWidth*.5?gates[0]:gates[1];
                    ctx.beginPath();ctx.moveTo(from.x,from.y);
                    ctx.lineTo(target.x,target.y);ctx.stroke();
                    ctx.beginPath();
                    for(let k=0;k<4;k++){
                        const a=k*Math.PI/2;
                        const x=target.x+Math.cos(a)*50;
                        const y=target.y+Math.sin(a)*50;
                        if(k===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
                    }
                    ctx.closePath();ctx.stroke();
                    ctx.beginPath();ctx.arc(target.x,target.y,
                        20+Math.max(0,2.2-elapsed)*8,0,Math.PI*2);ctx.stroke();
                }
                ctx.setLineDash([]);
            }
            ctx.restore();
        }

        function updateArenaChapter(dt) {
            startChapterIfChanged();
            if(!arenaChapter || !chapterEffectsAllowed()){
                cancelChapterShowcase();
                // No banked garden charge or unseen foundry pulse through boss/mission.
                chapterGardenCharge.fill(0);
                chapterGardenContested.fill(0);
                if(arenaChapter==='RIFT'){
                    chapterRiftPursuit=null;
                    chapterRiftLastWarpAt=-Infinity;
                }
                if(arenaChapter==='FOUNDRY'){
                    chapterFoundryAnchor=null;
                    chapterFoundryLastPulse=-1;
                }
                return;
            }
            beginChapterShowcase();
            if(arenaChapter==='FOUNDRY'){
                if(!chapterShowcase){
                    if(chapterFoundryAnchor===null)chapterFoundryAnchor=totalTime;
                    updateFoundryChapter();
                }
            }
            else if(arenaChapter==='GARDEN')updateGardenChapter(dt);
            else if(arenaChapter==='RIFT')updateRiftChapter();
            updateChapterShowcase();
        }
        function getArenaChapterSnapshot(){
            return {id:arenaChapter, label:arenaChapter?
                ARENA_CHAPTERS[arenaChapter].label:null,
                enabled:!!arenaChapter&&chapterEffectsAllowed(),
                wave, showcase:chapterShowcaseSnapshot(),
                showcaseStats:{...chapterShowcaseStats},
                foundryPhase:arenaChapter==='FOUNDRY'?
                    Math.round(chapterFoundryPhase()*10)/10:null,
                foundryReadyIn:arenaChapter==='FOUNDRY'&&chapterFoundryAnchor!==null?
                    Math.max(0,Math.round((CHAPTER_RULES.foundryWarn-chapterFoundryPhase())*10)/10):null,
                gardenCharge:[...chapterGardenCharge],
                gardenContested:[...chapterGardenContested],
                riftPursuit:chapterRiftPursuit?{
                    enemyId:chapterRiftPursuit.enemyId,
                    remaining:Math.max(0,Math.round((chapterRiftPursuit.readyAt-totalTime)*10)/10)
                }:null,
                gardenReadyIn:chapterGardenReady.map(t=>Math.max(0,
                    Math.round((t-totalTime)*10)/10)),
                riftReadyIn:Math.max(0,
                    Math.round((chapterRiftReadyAt-totalTime)*10)/10),
                ...chapterStats};
        }
        function updateArenaChapterHud() {
            const hud=document.getElementById('hud');
            const badge=document.getElementById('arenaChapterBadge');
            const status=document.getElementById('arenaChapterStatus');
            const announcement=document.getElementById('arenaChapterAnnouncement');
            const mobile=document.getElementById('arenaChapterMobile');
            if(!hud||!badge||!status||!announcement)return;
            hud.setAttribute('data-arena-chapter',arenaChapter||'NONE');
            const d=arenaChapter?ARENA_CHAPTERS[arenaChapter]:null;
            badge.textContent=d?d.glyph+' '+d.short:'NORMAL';
            badge.title=d?d.caption:'Standart savaş alanı';
            let message='STANDARD ARENA';
            if(d){
                if(!chapterEffectsAllowed())message='BOSS / ETKİNLİK KORUMASI';
                else if(arenaChapter==='FOUNDRY'){
                    const phase=chapterFoundryPhase();
                    message=phase<CHAPTER_RULES.foundryWarn?
                        'ISI YÜKLENİYOR · '+(CHAPTER_RULES.foundryWarn-phase).toFixed(1)+' sn':
                        phase<CHAPTER_RULES.foundryActiveEnd?'RAYLARDAN KAÇ':
                        'RAYLAR SOĞUYOR';
                }else if(arenaChapter==='GARDEN')message=chapterGardenContested.some(Boolean)?
                    'İYON BASKISI · MUHAFIZI UZAKLAŞTIR':'HALKALARDA DUR · İYON DOLDUR';
                else if(chapterRiftPursuit)message='YARIK TAKİPÇİSİ · '+
                    (chapterRiftPursuit.readyAt-totalTime).toFixed(1)+' sn';
                else message=totalTime<chapterRiftReadyAt?
                    'GEÇİT ŞARJDA · '+Math.ceil(chapterRiftReadyAt-totalTime)+' sn':
                    'İKİ GEÇİT AKTİF';
            }
            if(chapterShowcase){
                const op=chapterShowcase;
                if(op.id==='FOUNDRY')message='KIZIL MAKAS · DİKEY PRESLERDEN KAÇ';
                else if(op.id==='GARDEN'){
                    const secured=[0,1,2].filter(i=>op.flowerMask&(1<<i)).length;
                    message=op.completed?'İYON KOROSU · REZONANS!':
                        'İYON KOROSU · '+secured+'/2 ÇİÇEK';
                }else message=op.completed?'FAZ KISKACI · TAMAMLANDI':
                    'FAZ KISKACI · İŞARETLERDEN UZAKLAŞ';
            }
            status.textContent=message;
            if(mobile){
                mobile.classList.toggle('hidden',!d);
                mobile.textContent=d?d.glyph+' '+d.short+' · '+message:'';
            }
            const show=!!d && gameState==='PLAYING'&&totalTime<chapterAnnounceUntil;
            announcement.classList.toggle('hidden',!show);
            if(show){
                const op=chapterShowcase;
                const spec=op&&CHAPTER_SHOWCASES[op.id];
                announcement.textContent=spec?spec.name+' · '+spec.hint:
                    d.label+' · '+d.caption;
                announcement.style.borderColor=spec?spec.color:d.color;
                announcement.style.color=spec?spec.color:d.accent;
            }
            const banner=document.getElementById('arenaShowcaseBanner');
            if(banner){
                banner.classList.toggle('hidden',!chapterShowcase);
                if(chapterShowcase){
                    const spec=CHAPTER_SHOWCASES[chapterShowcase.id];
                    const progress=Math.min(100,Math.max(0,
                        (totalTime-chapterShowcase.start)/
                        Math.max(.1,chapterShowcase.endAt-chapterShowcase.start)*100));
                    banner.textContent=spec.name+' · '+spec.hint;
                    banner.style.borderColor=spec.color;
                    banner.style.color=spec.color;
                    banner.style.setProperty?.('--operation-progress',progress.toFixed(1)+'%');
                }
            }
        }
        function drawArenaChapter(ctx) {
            if(gameState!=='PLAYING'||!arenaChapter)return;
            const d=ARENA_CHAPTERS[arenaChapter],active=chapterEffectsAllowed();
            const low=graphicsQuality==='low';
            const clock=PREFERS_REDUCED_VFX_MOTION?0:totalTime;
            ctx.save();
            // Each chapter has a different floor grammar; enemy/shot art remains
            // on top. Boss telegraphs retain their own higher-contrast palette.
            ctx.fillStyle=d.dark;
            ctx.globalAlpha=.23;
            ctx.fillRect(0,0,worldWidth,worldHeight);
            ctx.strokeStyle=d.color;
            ctx.lineWidth=2;
            ctx.globalAlpha=active ? .22 : .09;
            const cell=90;
            if(arenaChapter==='FOUNDRY'){
                for(let x=45;x<worldWidth;x+=cell){
                    ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x-22,worldHeight);
                    ctx.stroke();
                }
                const phase=chapterFoundryPhase();
                const danger=active&&phase>=CHAPTER_RULES.foundryWarn&&
                    phase<CHAPTER_RULES.foundryActiveEnd;
                const warning=active&&phase<CHAPTER_RULES.foundryWarn;
                for(const y of [worldHeight*.32,worldHeight*.68]){
                    ctx.save();
                    ctx.fillStyle=d.color;
                    ctx.globalAlpha=danger ? .21 : warning ? .09 : .025;
                    ctx.fillRect(0,y-CHAPTER_RULES.foundryHalfWidth,worldWidth,
                        CHAPTER_RULES.foundryHalfWidth*2);
                    ctx.globalAlpha=danger ? .9 : warning ? .65 : .16;
                    ctx.strokeStyle=danger?'#fff1c9':d.color;
                    ctx.lineWidth=danger?4:2;
                    if(warning)ctx.setLineDash([12,10]);
                    ctx.beginPath();ctx.moveTo(0,y-CHAPTER_RULES.foundryHalfWidth);
                    ctx.lineTo(worldWidth,y-CHAPTER_RULES.foundryHalfWidth);
                    ctx.moveTo(0,y+CHAPTER_RULES.foundryHalfWidth);
                    ctx.lineTo(worldWidth,y+CHAPTER_RULES.foundryHalfWidth);
                    ctx.stroke();
                    ctx.restore();
                }
            } else if(arenaChapter==='GARDEN'){
                const nodes=getGardenCenters();
                for(let index=0;index<nodes.length;index++){
                    const node=nodes[index];
                    const r=CHAPTER_RULES.gardenRadius;
                    ctx.save();
                    ctx.translate(node.x,node.y);
                    ctx.strokeStyle=d.color;
                    const readyIn=Math.max(0,chapterGardenReady[index]-totalTime);
                    ctx.globalAlpha=active ? (readyIn>0?.28:.85) : .25;
                    ctx.lineWidth=2;
                    for(let petal=0;petal<6;petal++){
                        ctx.beginPath();
                        const a=petal*Math.PI/3+clock*.15;
                        ctx.ellipse(Math.cos(a)*r*.46,Math.sin(a)*r*.46,
                            r*.5,r*.22,a,0,Math.PI*2);
                        ctx.stroke();
                    }
                    ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();
                    const progress=chapterGardenCharge[index]/CHAPTER_RULES.gardenCharge;
                    if(progress>0){
                        ctx.lineWidth=5;ctx.strokeStyle=d.accent;
                        ctx.beginPath();ctx.arc(0,0,r+6,-Math.PI/2,
                            -Math.PI/2+Math.PI*2*progress);ctx.stroke();
                    }
                    if(active&&readyIn===0&&chapterGardenContested[index]>0){
                        ctx.globalAlpha=.85;
                        ctx.lineWidth=4;ctx.strokeStyle='#ffc078';
                        ctx.setLineDash([8,6]);
                        ctx.beginPath();ctx.arc(0,0,r+13,0,Math.PI*2);ctx.stroke();
                        ctx.setLineDash([]);
                    }
                    if(readyIn>0){
                        ctx.globalAlpha=active?.8:.2;
                        ctx.lineWidth=4;ctx.strokeStyle=d.accent;
                        ctx.beginPath();ctx.arc(0,0,r+6,-Math.PI/2,
                            -Math.PI/2+Math.PI*2*(1-readyIn/CHAPTER_RULES.gardenCooldown));
                        ctx.stroke();
                    }
                    ctx.restore();
                }
            } else if(arenaChapter==='RIFT'){
                const nodes=getRiftCenters();
                ctx.save();
                ctx.strokeStyle=d.color;
                ctx.lineWidth=2;
                ctx.globalAlpha=active ? .42 : .17;
                ctx.setLineDash([8,12]);
                ctx.beginPath();ctx.moveTo(nodes[0].x,nodes[0].y);
                ctx.lineTo(nodes[1].x,nodes[1].y);ctx.stroke();
                ctx.setLineDash([]);
                for(let i=0;i<2;i++){
                    const node=nodes[i],r=CHAPTER_RULES.riftRadius;
                    ctx.save();ctx.translate(node.x,node.y);
                    ctx.strokeStyle=i?d.accent:d.color;
                    ctx.globalAlpha=active ? .85 : .3;
                    for(let ring=0;ring<(low?2:3);ring++){
                        const a=clock*(i?-.8:.8)+ring*.72;
                        ctx.lineWidth=ring?1.5:3;
                        ctx.beginPath();ctx.arc(0,0,r-ring*9,a,a+Math.PI*1.43);
                        ctx.stroke();
                    }
                    ctx.beginPath();ctx.moveTo(-15,0);ctx.lineTo(0,-18);
                    ctx.lineTo(15,0);ctx.lineTo(0,18);ctx.closePath();ctx.stroke();
                    if(chapterRiftPursuit&&i===chapterRiftPursuit.to&&active){
                        ctx.globalAlpha=.95;
                        ctx.lineWidth=5;ctx.strokeStyle='#ffc078';
                        ctx.setLineDash([9,7]);
                        ctx.beginPath();ctx.arc(0,0,r+17,0,Math.PI*2);ctx.stroke();
                        ctx.setLineDash([]);
                    }
                    if(totalTime<chapterRiftReadyAt){
                        ctx.globalAlpha=active?.7:.2;
                        ctx.lineWidth=4;ctx.strokeStyle=d.accent;
                        const remaining=chapterRiftReadyAt-totalTime;
                        ctx.beginPath();ctx.arc(0,0,r+7,-Math.PI/2,
                            -Math.PI/2+Math.PI*2*(1-remaining/CHAPTER_RULES.riftCooldown));
                        ctx.stroke();
                    }
                    ctx.restore();
                }
                ctx.restore();
            }
            ctx.restore();
        }


        // M5.21 Echo Hunter: a short, readable adaptation of ONE existing foe.
        // No enemy spawning, stat inflation, bonus reward or persistent learning.
        const NEMESIS_RULES=Object.freeze({
            firstWave:7,step:6,minAge:2,life:13,
            warning:1.45,interval:3.55,maxAttacks:3,
            lockRadius:72,trailRadius:55,crossHalfWidth:24,
            hit:8,historySeconds:2.6,historyCap:18
        });
        const NEMESIS_TITLES=Object.freeze({
            LOCK:'SABİT NOKTA',TRAIL:'HAREKET İZİ',CROSS:'ÇAPRAZ KİLİT'
        });
        let nemesis=null, nemesisAttemptWave=-1, nemesisHistory=[];
        let nemesisDashAt=-Infinity, nemesisSampleAt=-Infinity;
        let nemesisStats={started:0,completed:0,defeated:0,suppressed:0,
            attacks:0,hits:0,evaded:0,interrupted:0,
            lock:0,trail:0,cross:0};
        function resetNemesis(){
            nemesis=null;nemesisAttemptWave=-1;nemesisHistory=[];
            nemesisDashAt=-Infinity;nemesisSampleAt=-Infinity;
            nemesisStats={started:0,completed:0,defeated:0,suppressed:0,
                attacks:0,hits:0,evaded:0,interrupted:0,
                lock:0,trail:0,cross:0};
        }
        function nemesisAllowed(){
            return chapterEffectsAllowed()&&!chapterShowcase;
        }
        function sampleNemesisMovement(){
            if(!player)return;
            if(player.isDashing)nemesisDashAt=totalTime;
            if(totalTime-nemesisSampleAt<.18)return;
            nemesisSampleAt=totalTime;
            nemesisHistory.push({x:player.x,y:player.y,t:totalTime});
            const cutoff=totalTime-NEMESIS_RULES.historySeconds;
            while(nemesisHistory.length>0&&
                (nemesisHistory[0].t<cutoff||
                 nemesisHistory.length>NEMESIS_RULES.historyCap))
                nemesisHistory.shift();
        }
        function chooseNemesisPattern(){
            if(totalTime-nemesisDashAt<1.6)return 'CROSS';
            if(nemesisHistory.length>=3){
                const earliest=nemesisHistory[0];
                const moved=Math.hypot(player.x-earliest.x,player.y-earliest.y);
                if(moved>=125)return 'TRAIL';
            }
            return 'LOCK';
        }
        function nemesisSafePoint(p){
            return {x:Math.max(22,Math.min(worldWidth-22,p.x)),
                y:Math.max(22,Math.min(worldHeight-22,p.y))};
        }
        function makeNemesisAttack(kind){
            let centers=[];
            if(kind==='TRAIL'){
                const history=nemesisHistory;
                const indices=[0,Math.floor((history.length-1)/2),history.length-1];
                for(const index of indices){
                    const point=nemesisSafePoint(history[index]);
                    if(centers.every(q=>Math.hypot(q.x-point.x,q.y-point.y)>35))
                        centers.push(point);
                }
                if(centers.length<2)kind='LOCK';
            }
            if(kind!=='TRAIL')centers=[nemesisSafePoint(player)];
            return {kind,centers,at:totalTime,
                fireAt:totalTime+NEMESIS_RULES.warning};
        }
        function startNemesis(){
            if(nemesis||!nemesisAllowed()||wave<NEMESIS_RULES.firstWave||
                (wave-NEMESIS_RULES.firstWave)%NEMESIS_RULES.step!==0||
                nemesisAttemptWave===wave||waveTimer<NEMESIS_RULES.minAge)
                return false;
            const candidates=enemies.filter(e=>!e.dead&&!e.isBoss&&e.stunTimer<=0&&
                ['SHOOTER','SNIPER','DASHER','ASSASSIN','SHIELD_BEARER','TANK']
                    .includes(e.type)&&Math.hypot(e.x-player.x,e.y-player.y)>115);
            if(!candidates.length)return false;
            candidates.sort((a,b)=>
                Math.hypot(a.x-player.x,a.y-player.y)-
                Math.hypot(b.x-player.x,b.y-player.y)||a.id-b.id);
            const leader=candidates[0];
            nemesisAttemptWave=wave;
            nemesis={enemyId:leader.id,start:totalTime,
                endAt:totalTime+NEMESIS_RULES.life,
                nextAttackAt:totalTime+1.6,attacks:0,attack:null};
            nemesisStats.started++;
            createFloatingText(leader.x,leader.y-50,'YANKI AVCISI',
                '#ff87de',17);
            return true;
        }
        function endNemesis(reason){
            if(!nemesis)return;
            if(Object.prototype.hasOwnProperty.call(nemesisStats,reason))
                nemesisStats[reason]++;
            nemesis=null;
        }
        function nemesisAttackHit(attack){
            const point=player;
            if(attack.kind==='CROSS'){
                const c=attack.centers[0];
                return Math.abs((point.x-c.x)+(point.y-c.y))/
                    Math.SQRT2<NEMESIS_RULES.crossHalfWidth+player.radius ||
                    Math.abs((point.x-c.x)-(point.y-c.y))/
                    Math.SQRT2<NEMESIS_RULES.crossHalfWidth+player.radius;
            }
            const radius=attack.kind==='TRAIL'?
                NEMESIS_RULES.trailRadius:NEMESIS_RULES.lockRadius;
            return attack.centers.some(c=>Math.hypot(point.x-c.x,point.y-c.y)<
                radius+player.radius*.25);
        }
        function updateNemesis(dt){
            if(!player)return;
            if(gameState==='PLAYING')sampleNemesisMovement();
            if(nemesis&&!nemesisAllowed()){
                endNemesis('suppressed');
                return;
            }
            if(!nemesis){
                if(nemesisAllowed())startNemesis();
                return;
            }
            const leader=enemies.find(e=>e.id===nemesis.enemyId&&!e.dead);
            if(!leader){endNemesis('defeated');return;}
            if(totalTime>=nemesis.endAt){endNemesis('completed');return;}
            if(leader.stunTimer>0){
                if(nemesis.attack){
                    nemesis.attack=null;
                    nemesisStats.interrupted++;
                    nemesis.nextAttackAt=totalTime+1.2;
                }
                return;
            }
            if(nemesis.attack){
                if(totalTime<nemesis.attack.fireAt)return;
                const attack=nemesis.attack;
                nemesis.attack=null;
                // A suspended/lagged frame may not materialize a stale strike.
                if(totalTime-attack.fireAt>.32){
                    nemesisStats.evaded++;
                    return;
                }
                const hit=nemesisAttackHit(attack);
                if(hit) {
                    const before=player.hp;
                    player.takeDamage(NEMESIS_RULES.hit);
                    if(player.hp<before)nemesisStats.hits++;
                    else nemesisStats.evaded++;
                } else nemesisStats.evaded++;
                shockwaves.push(new Shockwave(attack.centers[0].x,
                    attack.centers[0].y,100,'#ff87de',.34));
                return;
            }
            if(nemesis.attacks>=NEMESIS_RULES.maxAttacks||
                totalTime<nemesis.nextAttackAt)return;
            const attack=makeNemesisAttack(chooseNemesisPattern());
            nemesis.attack=attack;
            nemesis.attacks++;
            nemesisStats.attacks++;
            nemesisStats[attack.kind.toLowerCase()]++;
            nemesis.nextAttackAt=attack.fireAt+NEMESIS_RULES.interval;
        }
        function getNemesisSnapshot(){
            return {active:!!nemesis,
                enemyId:nemesis?.enemyId??null,wave,
                remaining:nemesis?Math.max(0,
                    Math.round((nemesis.endAt-totalTime)*10)/10):0,
                attack:nemesis?.attack?{
                    kind:nemesis.attack.kind,
                    title:NEMESIS_TITLES[nemesis.attack.kind],
                    warning:Math.max(0,Math.round(
                        (nemesis.attack.fireAt-totalTime)*10)/10),
                    centers:nemesis.attack.centers.map(p=>({...p}))
                }:null,stats:{...nemesisStats}};
        }
        function updateNemesisHud(){
            const banner=document.getElementById('nemesisBanner');
            if(!banner)return;
            banner.classList.toggle('hidden',!nemesis);
            if(!nemesis)return;
            const attack=nemesis.attack;
            banner.textContent=attack?
                'YANKI AVCISI · '+NEMESIS_TITLES[attack.kind]+
                ' · '+Math.max(0,attack.fireAt-totalTime).toFixed(1)+' sn':
                'YANKI AVCISI · HEDEFİ SERSEMLET VEYA YOK ET';
            const elapsed=Math.max(0,totalTime-nemesis.start);
            banner.style.setProperty?.('--nemesis-progress',
                Math.min(100,elapsed/NEMESIS_RULES.life*100).toFixed(1)+'%');
        }
        function drawNemesisThreat(ctx){
            if(!nemesis||!nemesis.attack||!nemesisAllowed())return;
            const attack=nemesis.attack;
            const progress=Math.min(1,Math.max(0,
                (totalTime-attack.at)/NEMESIS_RULES.warning));
            ctx.save();
            ctx.strokeStyle='#ff87de';
            ctx.fillStyle='#ff2f9e';
            ctx.lineWidth=2+progress*2;
            ctx.globalAlpha=.55+.35*progress;
            ctx.setLineDash([12,8]);
            if(attack.kind==='CROSS'){
                const c=attack.centers[0];
                const span=Math.max(worldWidth,worldHeight);
                for(const sign of [-1,1]){
                    ctx.beginPath();ctx.moveTo(c.x-span,c.y-span*sign);
                    ctx.lineTo(c.x+span,c.y+span*sign);ctx.stroke();
                }
            }else{
                const radius=attack.kind==='TRAIL'?
                    NEMESIS_RULES.trailRadius:NEMESIS_RULES.lockRadius;
                for(const c of attack.centers){
                    ctx.globalAlpha=.11+.1*progress;
                    ctx.beginPath();ctx.arc(c.x,c.y,radius,0,Math.PI*2);
                    ctx.fill();
                    ctx.globalAlpha=.55+.35*progress;
                    ctx.beginPath();ctx.arc(c.x,c.y,radius,0,Math.PI*2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.beginPath();ctx.arc(c.x,c.y,Math.max(9,radius*(1-progress)),
                        0,Math.PI*2);ctx.stroke();
                    ctx.setLineDash([12,8]);
                }
            }
            ctx.restore();
        }
        function drawNemesisIdentity(ctx){
            if(!nemesis||!nemesisAllowed())return;
            const enemy=enemies.find(e=>e.id===nemesis.enemyId&&!e.dead);
            if(!enemy)return;
            ctx.save();
            ctx.translate(enemy.x,enemy.y);
            const size=enemy.radius+13;
            ctx.strokeStyle='#ff87de';
            ctx.lineWidth=graphicsQuality==='low'?2:3;
            ctx.globalAlpha=.9;
            ctx.beginPath();
            for(let i=0;i<6;i++){
                const a=i*Math.PI/3-Math.PI/2;
                const x=Math.cos(a)*size,y=Math.sin(a)*size;
                if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
            }
            ctx.closePath();ctx.stroke();
            ctx.fillStyle='#fff0fa';
            ctx.beginPath();ctx.moveTo(0,-size-13);
            ctx.lineTo(-8,-size-3);ctx.lineTo(8,-size-3);
            ctx.closePath();ctx.fill();
            ctx.restore();
        }


        // M5.22: a timed, frontal counter to enemy bullets, never a free shield
        // against contact attacks, arena hazards, or boss telegraph damage.
        const PRISM_RULES=Object.freeze({
            duration:.42,cooldown:8.5,radius:92,
            halfAngle:Math.PI*.38,maxDeflections:4,
            perfectTime:.17,perfectMomentum:12,
            boltSpeed:620,boltLife:1.65,maxFriendlyShots:250
        });
        let prismGuardUntil=-Infinity,prismGuardReadyAt=0;
        let prismGuardStartedAt=-Infinity,prismGuardX=1,prismGuardY=0;
        let prismGuardDeflections=0,prismGuardPerfect=false;
        let prismStats={activations:0,deflected:0,perfect:0,
            spent:0,whiffs:0,shotsReturned:0};
        function resetPrismGuard(){
            prismGuardUntil=-Infinity;prismGuardReadyAt=0;
            prismGuardStartedAt=-Infinity;prismGuardX=1;prismGuardY=0;
            prismGuardDeflections=0;prismGuardPerfect=false;
            prismStats={activations:0,deflected:0,perfect:0,
                spent:0,whiffs:0,shotsReturned:0};
        }
        function prismActive(){
            return gameState==='PLAYING'&&!!player&&
                totalTime<prismGuardUntil&&
                prismGuardDeflections<PRISM_RULES.maxDeflections;
        }
        function choosePrismDirection(){
            let choice=null,nearest=480;
            // Mobile and keyboard have identical aim assistance: face the
            // closest incoming hostile shot at activation, then LOCK the arc.
            for(const ep of enemyProjectiles){
                if(ep.dead)continue;
                const dx=ep.x-player.x,dy=ep.y-player.y;
                const d=Math.hypot(dx,dy);
                if(d<nearest && ep.vx*(-dx)+ep.vy*(-dy)>0){
                    nearest=d;choice={x:dx/(d||1),y:dy/(d||1)};
                }
            }
            if(choice)return choice;
            const a=Number.isFinite(player.aimAngle)?player.aimAngle:0;
            return {x:Math.cos(a),y:Math.sin(a)};
        }
        function activatePrismGuard(){
            if(gameState!=='PLAYING'||!player||
                totalTime<prismGuardReadyAt||player.isDashing||
                prismActive())return false;
            const dir=choosePrismDirection();
            prismGuardX=dir.x;prismGuardY=dir.y;
            prismGuardStartedAt=totalTime;
            prismGuardUntil=totalTime+PRISM_RULES.duration;
            prismGuardReadyAt=totalTime+PRISM_RULES.cooldown;
            prismGuardDeflections=0;prismGuardPerfect=false;
            prismStats.activations++;
            shockwaves.push(new Shockwave(player.x,player.y,
                PRISM_RULES.radius,'#a3f4ff',.22));
            return true;
        }
        function deflectPrismProjectile(ep){
            if(!prismActive()||ep.dead)return false;
            const dx=ep.x-player.x,dy=ep.y-player.y;
            const d=Math.hypot(dx,dy);
            if(d>PRISM_RULES.radius+ep.radius)return false;
            if(d>0.001&&(dx*prismGuardX+dy*prismGuardY)/d<
                Math.cos(PRISM_RULES.halfAngle))return false;
            // A shot travelling away from the player is not parryable.
            if(ep.vx*(-dx)+ep.vy*(-dy)<=0)return false;
            ep.dead=true;
            prismGuardDeflections++;
            prismStats.deflected++;
            const isPerfect=totalTime-prismGuardStartedAt<=PRISM_RULES.perfectTime;
            if(isPerfect&&!prismGuardPerfect){
                prismGuardPerfect=true;
                prismStats.perfect++;
                player.momentum=Math.min(100,
                    player.momentum+PRISM_RULES.perfectMomentum);
                createFloatingText(player.x,player.y-38,
                    'KUSURSUZ KARŞILIK','#bcfbff',12);
            }
            if(bullets.length<PRISM_RULES.maxFriendlyShots){
                let tx=-ep.vx,ty=-ep.vy;
                let best=Infinity;
                for(const e of enemies){
                    if(e.dead)continue;
                    const ex=e.x-ep.x,ey=e.y-ep.y;
                    const dist2=ex*ex+ey*ey;
                    if(dist2<best){best=dist2;tx=ex;ty=ey;}
                }
                const norm=Math.hypot(tx,ty)||1;
                const bolt=new Bullet(ep.x,ep.y,
                    tx/norm*PRISM_RULES.boltSpeed,
                    ty/norm*PRISM_RULES.boltSpeed,
                    Math.min(42,player.damage*1.25+ep.damage*.6),
                    5,1,0,false,false);
                bolt.life=PRISM_RULES.boltLife;
                bolt.prismRiposte=true;
                bullets.push(bolt);
                prismStats.shotsReturned++;
            }
            shockwaves.push(new Shockwave(ep.x,ep.y,43,'#bffaff',.17));
            emitMotionFx('PRISM',ep.x,ep.y,{angle:Math.atan2(-ep.vy,-ep.vx)});
            return true;
        }
        function updatePrismGuard(){
            if(prismGuardUntil===-Infinity||totalTime<prismGuardUntil)return;
            prismStats.spent++;
            if(prismGuardDeflections===0)prismStats.whiffs++;
            prismGuardUntil=-Infinity;
        }
        function getPrismGuardSnapshot(){
            return {active:prismActive(),
                remaining:prismActive()?Math.max(0,
                    Math.round((prismGuardUntil-totalTime)*100)/100):0,
                readyIn:Math.max(0,Math.round(
                    (prismGuardReadyAt-totalTime)*10)/10),
                deflections:prismGuardDeflections,
                cap:PRISM_RULES.maxDeflections,
                direction:{x:prismGuardX,y:prismGuardY},
                stats:{...prismStats}};
        }
        function drawPrismGuard(ctx){
            if(!prismActive())return;
            const center=Math.atan2(prismGuardY,prismGuardX);
            const begin=center-PRISM_RULES.halfAngle;
            const end=center+PRISM_RULES.halfAngle;
            const progress=Math.max(0,Math.min(1,
                (prismGuardUntil-totalTime)/PRISM_RULES.duration));
            ctx.save();
            ctx.translate(player.x,player.y);
            ctx.strokeStyle='#bffaff';
            ctx.fillStyle='#5df4ff';
            ctx.lineWidth=5;
            ctx.globalAlpha=.28+.48*progress;
            ctx.beginPath();ctx.moveTo(0,0);
            ctx.arc(0,0,PRISM_RULES.radius,begin,end);
            ctx.closePath();ctx.fill();
            ctx.globalAlpha=.9;
            ctx.beginPath();ctx.arc(0,0,PRISM_RULES.radius,begin,end);
            ctx.stroke();
            ctx.lineWidth=2;
            const facets=graphicsQuality==='low'?3:6;
            for(let i=0;i<=facets;i++){
                const a=begin+(end-begin)*i/facets;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a)*28,Math.sin(a)*28);
                ctx.lineTo(Math.cos(a)*PRISM_RULES.radius,
                    Math.sin(a)*PRISM_RULES.radius);
                ctx.stroke();
            }
            ctx.restore();
        }
        function updatePrismGuardHud(){
            const button=document.getElementById('prismBtn');
            const status=document.getElementById('prismStatus');
            const overlay=document.getElementById('prismCooldownOverlay');
            if(!button||!status||!overlay||!player)return;
            const ready=Math.max(0,prismGuardReadyAt-totalTime);
            overlay.style.height=(ready/PRISM_RULES.cooldown*100).toFixed(1)+'%';
            const active=prismActive();
            status.textContent=active?
                'KARŞILA '+(PRISM_RULES.maxDeflections-prismGuardDeflections):
                ready>0?ready.toFixed(1)+'s':'HAZIR';
            status.className='font-cyber text-xs font-bold relative z-10 '+
                (active?'text-cyan-200':ready>0?'text-blue-200':'text-green-400');
            button.setAttribute('aria-label',
                active?'Prizma Karşılığı aktif, kalan yansıma '+(PRISM_RULES.maxDeflections-prismGuardDeflections):
                ready>0?'Prizma Karşılığı şarj oluyor, '+ready.toFixed(1)+' saniye':
                'Prizma Karşılığı hazır; C tuşu');
        }

        const ARENA_EVENT_GAP = 82;
        const ARENA_EVENT_LIFETIME = 17;

        const ARENA_EVENT_SPECS=Object.freeze({
            RELAY:Object.freeze({minWave:4,label:'VERİ AKTARIMI · XP / CİNNET',color:'#00f3ff',duration:3.0,cost:0}),
            VAULT:Object.freeze({minWave:4,label:'RİSKLİ KASA · -12 CAN / ALTIN',color:'#ffe600',duration:4.1,cost:12}),
            STORM:Object.freeze({minWave:6,label:'ENERJİ FIRTINASI · MOMENTUM HARCА / XP',color:'#a5b4fc',duration:3.5,cost:0}),
            REACTOR:Object.freeze({minWave:7,label:'HASARLI REAKTÖR · -10 CAN / GÜÇ',color:'#fb923c',duration:3.7,cost:10}),
            CORRIDOR:Object.freeze({minWave:9,label:'GÜVENLİ KORİDOR · SIĞIN / CİNNET',color:'#6ee7b7',duration:4.0,cost:0}),
            ANOMALY:Object.freeze({minWave:11,label:'AKI ANOMALİSİ · HALKADA KAL',color:'#e879f9',duration:4.0,cost:0})
        });
        const ARENA_EVENT_SEQUENCE=Object.freeze([
            'RELAY','VAULT','STORM','REACTOR','CORRIDOR','ANOMALY'
        ]);
        function chooseArenaEventKind(index,currentWave){
            const eligible=ARENA_EVENT_SEQUENCE.filter(kind=>
                currentWave>=ARENA_EVENT_SPECS[kind].minWave);
            return eligible[Math.max(0,index)%eligible.length];
        }
        function isInsideArenaEvent(event,x,y,radius=0){
            const dx=x-event.x,dy=y-event.y;
            if(event.kind==='CORRIDOR') return Math.abs(dx)<143+radius*.1 &&
                Math.abs(dy)<43+radius*.1;
            const distance=Math.hypot(dx,dy);
            if(event.kind==='ANOMALY') return distance>=34 &&
                distance<event.radius-radius*.25;
            return distance<event.radius-radius*.25;
        }

        class ArenaEvent {
            constructor(kind, x, y) {
                this.kind = kind;
                this.x = x;
                this.y = y;
                this.radius = 73;
                this.dead = false;
                this.timeLeft = ARENA_EVENT_LIFETIME;
                this.progress = 0;
                const spec=ARENA_EVENT_SPECS[kind]||ARENA_EVENT_SPECS.RELAY;
                this.required=spec.duration;
                this.committed=false;
                this.cost=spec.cost;
                this.color=spec.color;
                this.label=spec.label;
                this.projectilesBlocked=0;
                this.momentumSpent=0;
            }

            update(dt) {
                if (this.dead || !player) return;
                this.timeLeft -= dt;
                if (this.timeLeft <= 0) {
                    this.dead = true;
                    if (combatDirector) combatDirector.finishArenaEvent(this, 'expired');
                    return;
                }
                const inside=isInsideArenaEvent(this,player.x,player.y,player.radius);
                if (inside && !this.committed) {
                    if (this.cost && player.hp <= this.cost + (this.kind==='VAULT'?10:14)) return;
                    this.committed = true;
                    if (this.cost) {
                        player.hp -= this.cost;
                        createFloatingText(player.x, player.y - 36,
                            '-'+this.cost+' CAN · '+(this.kind==='VAULT'?'KASA':'REAKTÖR'),this.color,15);
                    }
                }
                if (!this.committed) return;
                // Risk and benefits are strictly opt-in; ignored events stay harmless.
                if(this.kind==='STORM' && inside && player.momentum>0){
                    const drained=Math.min(player.momentum,dt*9);
                    player.momentum-=drained;
                    this.momentumSpent+=drained;
                }
                if(this.kind==='CORRIDOR' && inside && enemyProjectiles.length){
                    // The corridor shelters the player from a small number of bullets.
                    let removed=0;
                    for(let i=enemyProjectiles.length-1;i>=0&&removed<8;i--){
                        const b=enemyProjectiles[i];
                        if(isInsideArenaEvent(this,b.x,b.y)){
                            enemyProjectiles.splice(i,1);removed++;
                        }
                    }
                    this.projectilesBlocked+=removed;
                }
                this.progress = Math.max(0, Math.min(this.required,
                    this.progress + (inside ? dt : -dt * (this.kind==='ANOMALY'?1.35:1.1))));
                if (this.progress >= this.required) {
                    this.dead = true;
                    if (this.kind === 'VAULT') {
                        const gold = Math.min(65, 20 + wave * 3);
                        totalGold += gold;
                        sessionGold += gold;
                        if(combatDirector) combatDirector.onGoldGranted('arena',gold);
                        player.hp = Math.min(player.maxHp, player.hp + 6);
                        saveMetaProgress();
                        createFloatingText(this.x, this.y - 28, `+ ${gold} ALTIN · +6 CAN`, '#ffe600', 17);
                    } else if(this.kind==='RELAY'){
                        const xp = Math.min(140, player.xpToNext * 0.32);
                        player.addOverdrive(25);
                        player.gainXp(xp);
                        createFloatingText(this.x, this.y - 28, 'VERİ BAŞARILI · XP + CİNNET', '#00f3ff', 17);
                    } else if(this.kind==='STORM'){
                        player.momentum=Math.min(100,player.momentum+35);
                        player.gainXp(Math.min(155,player.xpToNext*.38));
                        createFloatingText(this.x,this.y-28,'FIRTINA DENGELENDİ · MOMENTUM + XP',
                            this.color,16);
                    } else if(this.kind==='REACTOR'){
                        const gold=Math.min(72,25+wave*3);
                        totalGold+=gold;sessionGold+=gold;
                        if(combatDirector) combatDirector.onGoldGranted('arena',gold);
                        saveMetaProgress();
                        player.hasteTimer=Math.max(player.hasteTimer,5);
                        createFloatingText(this.x,this.y-28,'REAKTÖR ONARILDI · ALTIN + HIZ',
                            this.color,16);
                    } else if(this.kind==='CORRIDOR'){
                        player.addOverdrive(38);
                        player.momentum=Math.min(100,player.momentum+20);
                        createFloatingText(this.x,this.y-28,'KORİDOR GÜVENDE · CİNNET + MOMENTUM',
                            this.color,16);
                    } else if(this.kind==='ANOMALY'){
                        player.invulnTimer=Math.max(player.invulnTimer,2.2);
                        player.addOverdrive(24);
                        createFloatingText(this.x,this.y-28,'ANOMALİ ÇÖZÜLDÜ · KORUMA + CİNNET',
                            this.color,16);
                    }
                    audio.playJackpot();
                    if (combatDirector) combatDirector.finishArenaEvent(this, 'completed');
                }
            }

            draw(ctx) {
                ctx.save();
                const pulse=.08*Math.sin(totalTime*5);
                const corridor=this.kind==='CORRIDOR';
                ctx.beginPath();
                if(corridor) ctx.rect(this.x-143,this.y-43,286,86);
                else ctx.arc(this.x,this.y,this.radius,0,Math.PI*2);
                ctx.fillStyle=this.kind==='VAULT'?'rgba(255,230,0,.09)':
                    this.kind==='REACTOR'?'rgba(251,146,60,.10)':
                    this.kind==='ANOMALY'?'rgba(232,121,249,.10)':
                    this.kind==='STORM'?'rgba(165,180,252,.10)':
                    'rgba(0,243,255,.07)';
                ctx.fill();
                ctx.lineWidth=2.5;
                ctx.strokeStyle=this.color;
                ctx.globalAlpha=.7+pulse;
                ctx.setLineDash([8,6]);ctx.stroke();ctx.setLineDash([]);
                if(this.kind==='ANOMALY'){
                    // Hollow center is intentionally unsafe for anomaly capture.
                    ctx.beginPath();ctx.arc(this.x,this.y,34,0,Math.PI*2);
                    ctx.strokeStyle='#ff809e';ctx.lineWidth=1.8;ctx.stroke();
                }
                if(this.kind==='STORM'){
                    ctx.beginPath();
                    ctx.arc(this.x,this.y,50,Math.PI*.1+totalTime*.8,
                        Math.PI*1.1+totalTime*.8);
                    ctx.lineWidth=2;ctx.stroke();
                }
                if(this.progress>0){
                    ctx.beginPath();ctx.lineWidth=5;
                    ctx.arc(this.x,this.y,this.radius+7,-Math.PI/2,
                        -Math.PI/2+Math.PI*2*(this.progress/this.required));
                    ctx.strokeStyle=this.color;ctx.stroke();
                }
                ctx.globalAlpha=1;ctx.fillStyle=this.color;ctx.textAlign='center';
                ctx.font="bold 12px 'Orbitron', sans-serif";
                ctx.fillText(this.label,this.x,this.y-(corridor?60:this.radius+18));
                ctx.font="bold 11px 'Orbitron', sans-serif";
                ctx.fillText(this.committed?
                    Math.ceil(this.required-this.progress)+'s KAL':
                    Math.ceil(this.timeLeft)+'s · İÇİNE GİR',this.x,this.y+4);
                ctx.restore();
            }
        }

        const DIRECTOR_PHASES = {
            BUILDUP: { label: 'HAZIRLIK', multiplier: 0.65, interval: 0.5, cap: 85 },
            PRESSURE: { label: 'BASKI', multiplier: 1.0, interval: 0.33, cap: 130 },
            CRISIS: { label: 'KRİZ', multiplier: 1.4, interval: 0.23, cap: 160 },
            RECOVERY: { label: 'NEFES', multiplier: 0.58, interval: 0.52, cap: 100 },
            WARNING: { label: 'BOSS UYARISI', multiplier: 0.15, interval: 1.0, cap: 80 },
            BOSS: { label: 'BOSS', multiplier: 0.4, interval: 0.85, cap: 105 }
        };

        function pickEnemyTypeForWave(currentWave, roll, theme = 'BALANCED', credits = Infinity) {
            const available = ENEMY_SPAWN_WEIGHTS.filter(entry =>
                currentWave >= entry.from && ENEMY_THREAT_COST[entry.type] <= credits);
            if (!available.length) return null;
            const bias = THEME_WEIGHTS[theme] || {};
            const totalWeight = available.reduce((sum, entry) => sum + entry.weight * (bias[entry.type] || 1), 0);
            let ticket = Math.max(0, Math.min(0.999999999, roll)) * totalWeight;
            for (const entry of available) {
                ticket -= entry.weight * (bias[entry.type] || 1);
                if (ticket < 0) return entry.type;
            }
            return available[available.length - 1].type;
        }

        function getDirectorProfile(seconds, currentWave, activeBossCount, nextBossAt, afterBossUntil, hpFraction, normalPhase = null) {
            const cycle = ((seconds % 64) + 64) % 64;
            let phase = cycle < 12 ? 'BUILDUP' : cycle < 34 ? 'PRESSURE' : cycle < 49 ? 'CRISIS' : 'RECOVERY';
            // Priority is non-negotiable: boss presence, post-boss relief and
            // telegraphed boss warning cannot be overwritten by adaptive tempo.
            if (activeBossCount > 0) phase = 'BOSS';
            else if (seconds < afterBossUntil) phase = 'RECOVERY';
            else if (Number.isFinite(nextBossAt) && seconds >= nextBossAt - 3.8 && seconds < nextBossAt) phase = 'WARNING';
            else if (normalPhase && ['BUILDUP', 'PRESSURE', 'CRISIS', 'RECOVERY'].includes(normalPhase))
                phase = normalPhase;

            const def = DIRECTOR_PHASES[phase];
            const hpAssist = hpFraction < 0.30 ? 0.78 : hpFraction < 0.50 ? 0.90 : 1;
            const theme = DIRECTOR_THEMES[Math.floor((Math.max(1, currentWave) - 1) / 3) % DIRECTOR_THEMES.length];
            return {
                phase, label: def.label, theme,
                interval: Math.max(0.19, def.interval * (currentWave >= 13 ? 0.91 : 1)),
                tokenRate: (2.25 + Math.min(4.4, currentWave * 0.16)) * def.multiplier * hpAssist,
                cap: def.cap,
                eliteChance: phase === 'RECOVERY' || phase === 'WARNING' ? 0 :
                    Math.min(0.12, (phase === 'CRISIS' ? 0.08 : phase === 'PRESSURE' ? 0.055 : 0.035) + currentWave * 0.0015)
            };
        }


        // Gameplay V2, stage 1: observe real player pressure without changing spawns.
        // High kill counts alone never imply panic. Nearby combat and damage do.
        const INTENSITY_OBSERVER = Object.freeze({
            nearbyEnemyRadius: 170, nearbyShotRadius: 125,
            scanSeconds: .25, historySeconds: 1, historyCapacity: 180,
            peakThreshold: 68, buildupMinimum: 8, buildupMaximum: 36,
            sustainSeconds: 4, fadeSeconds: 4, relaxMinimum: 12,
            relaxMaximum: 24, relaxThreshold: 38
        });
        const INTENSITY_PREVIEW_STAGES = Object.freeze([
            'BUILDUP', 'SUSTAIN', 'FADE', 'RELAX', 'BOSS_LOCK'
        ]);
        const clampIntensity = value => Math.max(0, Math.min(100, value));
        class AdaptiveTempoObserver {
            constructor() {
                this.eventStress = 0;
                this.localPressure = 0;
                this.intensity = 0;
                this.mastery = 0;
                this.nearbyEnemies = 0;
                this.nearbyProjectiles = 0;
                this.shieldBreaks = 0;
                this.hpHits = 0;
                this.nearKills = 0;
                this.kills = 0;
                this.lastDamageAt = -Infinity;
                this.scanElapsed = 0;
                this.previewPhase = 'BUILDUP';
                this.previewAge = 0;
                this.previewTransitions = 0;
                this.history = new Float32Array(INTENSITY_OBSERVER.historyCapacity * 6);
                this.historyNext = 0;
                this.historyCount = 0;
                this.nextHistoryAt = 0;
            }

            refreshIntensity() {
                this.intensity = clampIntensity(this.eventStress + this.localPressure);
            }

            recordShieldBreak() {
                this.shieldBreaks++;
                this.eventStress = clampIntensity(this.eventStress + 12);
                this.mastery = clampIntensity(this.mastery - 5);
                this.lastDamageAt = totalTime;
                this.refreshIntensity();
            }

            recordDamage(lost, maximumHp) {
                if (!(lost > 0)) return;
                this.hpHits++;
                const hpFraction = lost / Math.max(1, maximumHp);
                this.eventStress = clampIntensity(this.eventStress +
                    Math.min(34, 15 + hpFraction * 110));
                this.mastery = clampIntensity(this.mastery - 16);
                this.lastDamageAt = totalTime;
                this.refreshIntensity();
            }

            recordKill(enemy, survivor) {
                if (enemy.isBoss) return; // Boss rewards and recovery have their own rules.
                this.kills++;
                // Safe ranged kills represent control, not an overwhelming attack.
                this.mastery = clampIntensity(this.mastery +
                    (totalTime - this.lastDamageAt >= 4 ? 2 : .8));
                if (!survivor) return;
                const distance = Math.hypot(enemy.x - survivor.x, enemy.y - survivor.y);
                if (distance <= INTENSITY_OBSERVER.nearbyEnemyRadius) {
                    this.nearKills++;
                    this.eventStress = clampIntensity(this.eventStress +
                        (enemy.isElite ? 4 : 2.5));
                    this.refreshIntensity();
                }
            }

            setPreview(phase) {
                if (phase === this.previewPhase) return;
                this.previewPhase = phase;
                this.previewAge = 0;
                this.previewTransitions++;
            }

            advancePreview(dt, bossLocked) {
                if (bossLocked) {
                    this.setPreview('BOSS_LOCK');
                    return;
                }
                if (this.previewPhase === 'BOSS_LOCK') this.setPreview('BUILDUP');
                this.previewAge += dt;
                const age = this.previewAge;
                switch (this.previewPhase) {
                    case 'BUILDUP':
                        if (age >= INTENSITY_OBSERVER.buildupMinimum &&
                            (this.intensity >= INTENSITY_OBSERVER.peakThreshold ||
                             age >= INTENSITY_OBSERVER.buildupMaximum)) this.setPreview('SUSTAIN');
                        break;
                    case 'SUSTAIN':
                        if (age >= INTENSITY_OBSERVER.sustainSeconds) this.setPreview('FADE');
                        break;
                    case 'FADE':
                        if (age >= INTENSITY_OBSERVER.fadeSeconds) this.setPreview('RELAX');
                        break;
                    case 'RELAX':
                        if (age >= INTENSITY_OBSERVER.relaxMaximum ||
                            (age >= INTENSITY_OBSERVER.relaxMinimum &&
                             this.intensity <= INTENSITY_OBSERVER.relaxThreshold))
                            this.setPreview('BUILDUP');
                        break;
                }
            }

            observe(dt, seconds, survivor, foes, hostileShots, bossLocked) {
                if (!(dt > 0)) return;
                const elapsed = Math.min(dt, .1);
                this.scanElapsed += elapsed;
                if (this.scanElapsed >= INTENSITY_OBSERVER.scanSeconds) {
                    this.scanElapsed %= INTENSITY_OBSERVER.scanSeconds;
                    let closeEnemies = 0, closeShots = 0;
                    if (survivor) {
                        const enemyRangeSq = INTENSITY_OBSERVER.nearbyEnemyRadius ** 2;
                        const shotRangeSq = INTENSITY_OBSERVER.nearbyShotRadius ** 2;
                        for (const enemy of foes) {
                            if (enemy.dead) continue;
                            const dx = enemy.x - survivor.x, dy = enemy.y - survivor.y;
                            if (dx * dx + dy * dy <= enemyRangeSq) closeEnemies++;
                        }
                        for (const shot of hostileShots) {
                            if (shot.dead) continue;
                            const dx = shot.x - survivor.x, dy = shot.y - survivor.y;
                            if (dx * dx + dy * dy <= shotRangeSq) closeShots++;
                        }
                    }
                    this.nearbyEnemies = closeEnemies;
                    this.nearbyProjectiles = closeShots;
                    this.localPressure = Math.min(54, closeEnemies * 3.8 + closeShots * 2.7);
                }
                // Pressure does not instantly disappear during close combat.
                const inDanger = this.nearbyEnemies > 0 || this.nearbyProjectiles > 0;
                this.eventStress = Math.max(0, this.eventStress -
                    elapsed * (inDanger ? .7 : 5));
                this.mastery = Math.max(0, this.mastery - elapsed * .55);
                this.refreshIntensity();
                this.advancePreview(elapsed, bossLocked);
                if (seconds >= this.nextHistoryAt) {
                    this.nextHistoryAt = seconds + INTENSITY_OBSERVER.historySeconds;
                    const start = this.historyNext * 6;
                    this.history[start] = seconds;
                    this.history[start + 1] = this.intensity;
                    this.history[start + 2] = this.mastery;
                    this.history[start + 3] = this.nearbyEnemies;
                    this.history[start + 4] = this.nearbyProjectiles;
                    this.history[start + 5] = INTENSITY_PREVIEW_STAGES.indexOf(this.previewPhase);
                    this.historyNext = (this.historyNext + 1) % INTENSITY_OBSERVER.historyCapacity;
                    this.historyCount = Math.min(INTENSITY_OBSERVER.historyCapacity, this.historyCount + 1);
                }
            }

            getSnapshot() {
                return {
                    mode: 'observe-only',
                    stress: Math.round(this.intensity),
                    mastery: Math.round(this.mastery),
                    nearbyEnemies: this.nearbyEnemies,
                    nearbyProjectiles: this.nearbyProjectiles,
                    proposedPhase: this.previewPhase,
                    proposedPhaseAge: +this.previewAge.toFixed(1),
                    transitions: this.previewTransitions,
                    hpHits: this.hpHits,
                    shieldBreaks: this.shieldBreaks,
                    kills: this.kills,
                    nearKills: this.nearKills,
                    historySamples: this.historyCount
                };
            }

            getHistory() {
                const rows = [];
                for (let i = 0; i < this.historyCount; i++) {
                    const index = (this.historyNext - this.historyCount +
                        i + INTENSITY_OBSERVER.historyCapacity) % INTENSITY_OBSERVER.historyCapacity;
                    const k = index * 6;
                    rows.push({
                        second: +this.history[k].toFixed(1),
                        stress: +this.history[k + 1].toFixed(1),
                        mastery: +this.history[k + 2].toFixed(1),
                        nearbyEnemies: this.history[k + 3],
                        nearbyProjectiles: this.history[k + 4],
                        proposedPhase: INTENSITY_PREVIEW_STAGES[this.history[k + 5]]
                    });
                }
                return rows;
            }
        }

        // Gameplay V2 G2: opt-in live tempo via ?tempo=adaptive. Classic remains
        // the default until real playtests validate stress thresholds and pacing.
        function getTempoMode(search = '') {
            return /(?:^|[?&])tempo=adaptive(?:&|$)/i.test(search) ? 'adaptive' : 'classic';
        }
        function mapAdaptiveStageToDirectorPhase(stage, age) {
            if (stage === 'BUILDUP') return age < INTENSITY_OBSERVER.buildupMinimum ?
                'BUILDUP' : 'PRESSURE';
            if (stage === 'SUSTAIN') return 'CRISIS';
            if (stage === 'FADE') return 'BUILDUP';
            if (stage === 'RELAX') return 'RECOVERY';
            return null; // BOSS_LOCK: legacy boss/warning/post-boss handling owns the profile.
        }

        // G3: cumulative, allocation-free measurements. These never make
        // decisions about spawning, rewards, gameplay physics or difficulty.
        const TEMPO_RUN_THRESHOLDS = Object.freeze({
            highStress: 68, rearmStress: 38, calmStress: 20, calmWindowSeconds: 8
        });
        class TempoRunMetrics {
            constructor() {
                this.normalSeconds = 0;
                this.bossProtectedSeconds = 0;
                this.stressWeightedTotal = 0;
                this.masteryWeightedTotal = 0;
                this.peakStress = 0;
                this.highStressSeconds = 0;
                this.stressPeaks = 0;
                this.peakArmed = true;
                this.calmSeconds = 0;
                this.currentCalmSeconds = 0;
                this.longestCalmSeconds = 0;
                this.calmWindows = 0;
                this.reliefEntries = 0;
                this.previousNormalPhase = null;
            }
            finishCalmWindow() {
                this.longestCalmSeconds = Math.max(this.longestCalmSeconds, this.currentCalmSeconds);
                if (this.currentCalmSeconds >= TEMPO_RUN_THRESHOLDS.calmWindowSeconds)
                    this.calmWindows++;
                this.currentCalmSeconds = 0;
            }
            observe(dt, observer, phase, bossLocked) {
                if (!(dt > 0)) return;
                if (bossLocked) {
                    this.bossProtectedSeconds += dt;
                    this.finishCalmWindow();
                    this.previousNormalPhase = null;
                    return;
                }
                const stress = observer.intensity, mastery = observer.mastery;
                this.normalSeconds += dt;
                this.stressWeightedTotal += stress * dt;
                this.masteryWeightedTotal += mastery * dt;
                this.peakStress = Math.max(this.peakStress, stress);
                if (stress >= TEMPO_RUN_THRESHOLDS.highStress) {
                    this.highStressSeconds += dt;
                    if (this.peakArmed) {
                        this.stressPeaks++;
                        this.peakArmed = false;
                    }
                } else if (stress <= TEMPO_RUN_THRESHOLDS.rearmStress) {
                    this.peakArmed = true;
                }
                if (phase === 'RECOVERY' && this.previousNormalPhase !== 'RECOVERY')
                    this.reliefEntries++;
                this.previousNormalPhase = phase;
                // This measures low *local* threat, not a claim that the arena
                // has no enemies. Avoid calling it true empty/dead playtime.
                const calm = stress < TEMPO_RUN_THRESHOLDS.calmStress &&
                    observer.nearbyEnemies === 0 && observer.nearbyProjectiles === 0;
                if (calm) {
                    this.calmSeconds += dt;
                    this.currentCalmSeconds += dt;
                } else {
                    this.finishCalmWindow();
                }
            }
            getSnapshot() {
                const normal = this.normalSeconds;
                return {
                    normalSeconds: +normal.toFixed(2),
                    bossProtectedSeconds: +this.bossProtectedSeconds.toFixed(2),
                    averageStress: normal ? +(this.stressWeightedTotal / normal).toFixed(1) : 0,
                    averageMastery: normal ? +(this.masteryWeightedTotal / normal).toFixed(1) : 0,
                    peakStress: +this.peakStress.toFixed(1),
                    highStressSeconds: +this.highStressSeconds.toFixed(2),
                    stressPeaks: this.stressPeaks,
                    calmSeconds: +this.calmSeconds.toFixed(2),
                    longestCalmSeconds: +Math.max(this.longestCalmSeconds,
                        this.currentCalmSeconds).toFixed(2),
                    calmWindows: this.calmWindows +
                        (this.currentCalmSeconds >= TEMPO_RUN_THRESHOLDS.calmWindowSeconds ? 1 : 0),
                    reliefEntries: this.reliefEntries
                };
            }
        }


        // MLP1: Genuine online SGD learning, but predictions have NO spawn authority.
        // Learn P(at least one actual HP-loss hit in the next 8 game seconds)
        // from a feature snapshot taken BEFORE observing the outcome.
        const PLAYER_LEARNER_SAVE_KEY = 'neonCekirdek.playerLearner.v1';
        const PLAYER_LEARNER_VERSION = 1;
        const PLAYER_LEARNER_WINDOW = 8;
        const PLAYER_LEARNER_FEATURES = Object.freeze([
            'bias', 'nearEnemies', 'nearProjectiles', 'hpDeficit',
            'currentStress', 'mastery', 'previousKills', 'previousHits'
        ]);
        const PLAYER_LEARNER_CHASSIS = Object.freeze(['VANGUARD', 'PHANTOM', 'TITAN']);
        const clampLearner01 = v => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
        function isPlayerLearningEnabled(search = '') {
            return /(?:^|[?&])learn=on(?:&|$)/i.test(search);
        }
        function validPlayerLearnerState(row) {
            if (!row || typeof row !== 'object' || !Array.isArray(row.weights) ||
                row.weights.length !== PLAYER_LEARNER_FEATURES.length ||
                !row.weights.every(n=>typeof n==='number' && Number.isFinite(n) && Math.abs(n)<=8))
                return false;
            if (!Number.isSafeInteger(row.samples) || row.samples<0 || row.samples>1000000 ||
                !Number.isSafeInteger(row.positives) || row.positives<0 || row.positives>row.samples)
                return false;
            for(const key of ['modelBrier','baselineBrier']) {
                if (typeof row[key]!=='number' || !Number.isFinite(row[key]) ||
                    row[key]<0 || row[key]>row.samples+.0001) return false;
            }
            return true;
        }
        function readPlayerLearnerBank() {
            const models={};
            try {
                const row=JSON.parse(localStorage.getItem(PLAYER_LEARNER_SAVE_KEY)||'null');
                if (row?.version!==PLAYER_LEARNER_VERSION || !row.models ||
                    typeof row.models!=='object') return models;
                for (const chassis of PLAYER_LEARNER_CHASSIS) {
                    if (validPlayerLearnerState(row.models[chassis]))
                        models[chassis]={
                            weights:[...row.models[chassis].weights],
                            samples:row.models[chassis].samples,
                            positives:row.models[chassis].positives,
                            modelBrier:row.models[chassis].modelBrier,
                            baselineBrier:row.models[chassis].baselineBrier
                        };
                }
            } catch (e) { /* Invalid or blocked storage starts a clean learner. */ }
            return models;
        }
        class OnlinePlayerLearner {
            constructor(chassis, enabled = false) {
                this.chassis = PLAYER_LEARNER_CHASSIS.includes(chassis) ? chassis : 'VANGUARD';
                this.enabled = enabled;
                const stored=enabled?readPlayerLearnerBank()[this.chassis]:null;
                this.weights=stored?[...stored.weights]:new Array(PLAYER_LEARNER_FEATURES.length).fill(0);
                this.samples=stored?.samples||0;
                this.positives=stored?.positives||0;
                this.modelBrier=stored?.modelBrier||0;
                this.baselineBrier=stored?.baselineBrier||0;
                this.startSamples=this.samples;
                this.pending=null;
                this.previousKills=0;
                this.previousHits=0;
                this.skippedWindows=0;
                this.lastPrediction=null;
                this.lastOutcome=null;
            }
            features(actor, observer) {
                return [
                    1,
                    clampLearner01(observer.nearbyEnemies/12),
                    clampLearner01(observer.nearbyProjectiles/8),
                    clampLearner01(1-actor.hp/Math.max(1,actor.maxHp)),
                    clampLearner01(observer.intensity/100),
                    clampLearner01(observer.mastery/100),
                    clampLearner01(this.previousKills/20),
                    clampLearner01(this.previousHits/3)
                ];
            }
            predict(features) {
                let z=0;
                for(let i=0;i<this.weights.length;i++) z+=this.weights[i]*features[i];
                z=Math.max(-12,Math.min(12,z));
                return 1/(1+Math.exp(-z));
            }
            train(features, outcome) {
                if (!Array.isArray(features) || features.length!==this.weights.length ||
                    !features.every(v=>typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1) ||
                    (outcome!==0 && outcome!==1)) return false;
                // Evaluate BEFORE updating, against a simple prior-prevalence baseline.
                const probability=this.predict(features);
                const baseline=(this.positives+1)/(this.samples+2);
                this.modelBrier=Math.min(1000000,this.modelBrier+(probability-outcome)**2);
                this.baselineBrier=Math.min(1000000,this.baselineBrier+(baseline-outcome)**2);
                const rate=.18/Math.sqrt(1+this.samples/24);
                for(let i=0;i<this.weights.length;i++) {
                    const next=this.weights[i]*(1-rate*.002)+rate*(outcome-probability)*features[i];
                    this.weights[i]=Math.max(-8,Math.min(8,next));
                }
                this.samples=Math.min(1000000,this.samples+1);
                this.positives=Math.min(this.samples,this.positives+outcome);
                this.lastOutcome=outcome;
                return true;
            }
            observe(dt, seconds, actor, observer, bossLocked, hitCount, killCount, bossAt) {
                if (!this.enabled || !(dt>0) || !actor) return;
                // A boss warning/encounter interrupts the label window. Do not
                // train on boss outcomes or pretend a truncated window is valid.
                if (bossLocked || actor.hp<=0 || bossAt-seconds<=PLAYER_LEARNER_WINDOW+.2) {
                    if (this.pending) this.skippedWindows++;
                    this.pending=null;
                    this.previousKills=0;
                    this.previousHits=0;
                    return;
                }
                if (!this.pending) {
                    const features=this.features(actor,observer);
                    this.lastPrediction=this.predict(features);
                    this.pending={started:seconds,hits:hitCount,kills:killCount,features};
                    return;
                }
                if (seconds-this.pending.started<PLAYER_LEARNER_WINDOW) return;
                const finished=this.pending;
                const hits=Math.max(0,hitCount-finished.hits);
                this.previousHits=hits;
                this.previousKills=Math.max(0,killCount-finished.kills);
                this.train(finished.features,hits>0?1:0);
                // The next window is a new prediction, not retroactive leakage.
                const features=this.features(actor,observer);
                this.lastPrediction=this.predict(features);
                this.pending={started:seconds,hits:hitCount,kills:killCount,features};
            }
            exportState() {
                return {
                    weights:[...this.weights], samples:this.samples,
                    positives:this.positives, modelBrier:this.modelBrier,
                    baselineBrier:this.baselineBrier
                };
            }
            getSnapshot() {
                const ready=this.samples>=24 && this.positives>=4 &&
                    this.samples-this.positives>=4;
                return {
                    enabled:this.enabled,
                    mode:this.enabled?'online-training-shadow':'off',
                    learnsFrom:'actual HP-loss hit in next 8 game seconds',
                    chassis:this.chassis,
                    trainedWindows:this.samples,
                    thisRunWindows:this.samples-this.startSamples,
                    positiveWindows:this.positives,
                    skippedWindows:this.skippedWindows,
                    readyForEvaluation:ready,
                    // These are pre-update Brier scores, not retrospective training accuracy.
                    preUpdateBrier:this.samples?+(this.modelBrier/this.samples).toFixed(4):null,
                    baselineBrier:this.samples?+(this.baselineBrier/this.samples).toFixed(4):null,
                    predictedRisk:this.lastPrediction===null?null:
                        +this.lastPrediction.toFixed(3),
                    previousOutcome:this.lastOutcome,
                    weights:[...this.weights],
                    featureNames:[...PLAYER_LEARNER_FEATURES],
                    controlsSpawns:false
                };
            }
            save() {
                if (!this.enabled || this.samples<=this.startSamples) return false;
                const models=readPlayerLearnerBank();
                models[this.chassis]=this.exportState();
                try {
                    localStorage.setItem(PLAYER_LEARNER_SAVE_KEY,
                        JSON.stringify({version:PLAYER_LEARNER_VERSION,models}));
                    this.startSamples=this.samples;
                    return true;
                } catch (e) { return false; }
            }
        }

        class CombatDirector {
            constructor() {
                this.tokens = 4;
                this.intensityObserver = new AdaptiveTempoObserver();
                this.tempoRunMetrics = new TempoRunMetrics();
                this.playerLearner = new OnlinePlayerLearner(
                    player?.chassis || selectedChassis,
                    isPlayerLearningEnabled(window.location?.search || ''));
                this.tempoMode = getTempoMode(window.location?.search || '');
                this.adaptivePhase = null;
                this.baseProfile = null;
                this.tempoPhaseSwitches = 0;
                this.tempoPhaseSeconds = { BUILDUP: 0, PRESSURE: 0, CRISIS: 0, RECOVERY: 0 };
                this.afterBossUntil = -Infinity;
                this.lastEliteChestAt = -Infinity;
                this.lastBossCueEncounter = 0;
                this.eliteChanceWindow = -1;
                this.eliteDropsInWindow = 0;
                this.bossChestAwarded = false;
                this.pendingEncounter = null;
                this.tacticalMotion = {vx: 0, vy: 0, tracked: 0};
                this.lastTacticalSide = null;
                this.lastTacticalDecision = {side: null, mode: 'unobserved'};
                this.squadVolleyReady = new Map();
                this.activeArenaEvent = null;
                this.nextArenaAt = 88;
                this.arenaEventIndex = 0;
                this.bossAttackNextAt = -Infinity;
                this.nextBossPhaseWindowAt = -Infinity;
                this.nextEncounterAt = 26;
                this.encounterIndex = 0;
                this.lastEncounterAt = -Infinity;
                this.profile = getDirectorProfile(0, 1, 0, 55, -Infinity, 1);
                this.stats = {
                    spawned: 0, eliteSpawned: 0, eliteKills: 0, bossKills: 0,
                    encounters: 0, specialEncounters: 0, specialUnits: 0, specialCancelled: 0,
                    specialByKind:{},bossByPattern:{}, squadShotsDeferred: 0,
                    bossSpecialAttacks: 0, bossAttacksDeferred: 0,
                    arenaOffered: 0, arenaCompleted: 0, arenaExpired: 0, arenaCancelled: 0,
                    arenaByKind:{},
                    chestDrops: { elite: 0, boss: 0 },
                    chestDenied:{cooldown:0,groundCap:0,roll:0},
                    chestOpened: { goldHeal: 0, overdriveXp: 0, bulletNova: 0 },
                    chestRewards:{
                        elite:{opened:0,gold:0,heal:0,xp:0,charge:0,shots:0},
                        boss:{opened:0,gold:0,heal:0,xp:0,charge:0,shots:0}
                    },
                    goldBySource:{orbs:0,quests:0,arena:0,chests:0}
                };
            }

            update(dt) {
                const hpFraction = player ? player.hp / Math.max(1, player.maxHp) : 1;
                const previous = this.profile.phase;
                // Always calculate the old director profile separately so
                // special encounters / arena events keep their legacy eligibility.
                this.baseProfile = getDirectorProfile(totalTime, wave, activeBosses.length,
                    nextBossTime, this.afterBossUntil, hpFraction);
                const bossLocked = activeBosses.some(b => !b.dead) ||
                    nextBossTime - totalTime <= 3.8 || totalTime < this.afterBossUntil;
                this.intensityObserver.observe(dt, totalTime, player, enemies,
                    enemyProjectiles, bossLocked);
                this.playerLearner.observe(dt,totalTime,player,this.intensityObserver,
                    bossLocked,runMetrics.hitsTaken,kills,nextBossTime);
                const proposal = this.tempoMode === 'adaptive' && !bossLocked ?
                    mapAdaptiveStageToDirectorPhase(
                        this.intensityObserver.previewPhase, this.intensityObserver.previewAge) : null;
                this.adaptivePhase = proposal;
                this.profile = proposal ? getDirectorProfile(totalTime, wave, activeBosses.length,
                    nextBossTime, this.afterBossUntil, hpFraction, proposal) : this.baseProfile;
                // Normal spawns use the selected profile. The existing shared
                // token budget and hard caps still apply; no extra spawn paths.
                this.tokens = Math.min(14, this.tokens + dt * this.profile.tokenRate);
                this.observeTacticalMotion(dt, bossLocked);
                this.updateSpecialEncounter(dt);
                this.updateArenaEvent(dt);
                if (!bossLocked && this.tempoPhaseSeconds[this.profile.phase] !== undefined)
                    this.tempoPhaseSeconds[this.profile.phase] += dt;
                this.tempoRunMetrics.observe(dt, this.intensityObserver,
                    this.profile.phase, bossLocked);
                if (!bossLocked && this.profile.phase !== previous) this.tempoPhaseSwitches++;
                if (this.profile.phase !== previous && this.profile.phase !== 'BOSS' &&
                    this.profile.phase !== 'WARNING') {
                    createFloatingText(player.x, player.y - 52,
                        `TEHDİT: ${this.profile.label}`, '#00f3ff', 14);
                }
            }

            reserveBossPhase(phase) {
                // Existing single-boss timing stays unchanged. Only a simultaneous
                // multi-boss encounter needs serialized, pre-reserved telegraph slots.
                if (activeBosses.filter(b => !b.dead).length <= 1) return 0;
                const warning = phase === 3 ? 1.35 : 1.15;
                const start = Math.max(totalTime, this.nextBossPhaseWindowAt);
                this.nextBossPhaseWindowAt = start + warning + (activeBosses.length > 1 ? 1.1 : 0.35);
                return Math.max(0, start - totalTime);
            }

            allowBossAttack(boss, kind) {
                if (activeBosses.length > 1) {
                    // If several phase warnings finish together, "another boss is
                    // ready" would deny ALL of them forever. Elect the first
                    // eligible boss as owner of the phase slot; subsequent bosses
                    // wait for the existing shared cooldown. Regular attacks still
                    // give priority to announced phases.
                    const phaseOwner = activeBosses.find(other => !other.dead &&
                        other.stunTimer <= 0 && other.bossSpecial &&
                        other.bossSpecial.delay <= 0);
                    if (phaseOwner && (kind !== 'phase' || phaseOwner !== boss)) {
                        this.stats.bossAttacksDeferred++;
                        return false;
                    }
                }
                if (totalTime + 0.00001 < this.bossAttackNextAt) {
                    this.stats.bossAttacksDeferred++;
                    return false;
                }
                const interval = activeBosses.length > 1
                    ? (kind === 'phase' ? 1.5 : kind === 'titan' ? 1.65 : 0.95)
                    : 0;
                this.bossAttackNextAt = totalTime + interval;
                return true;
            }

            canBossReposition(boss) {
                return !activeBosses.some(other => other !== boss && !other.dead &&
                    other.bossSpecial && other.bossSpecial.delay <= 0);
            }

            updateArenaEvent(dt) {
                const bossApproaching = activeBosses.length > 0 || nextBossTime - totalTime < 19;
                if (this.activeArenaEvent) {
                    if (bossApproaching) {
                        const event = this.activeArenaEvent;
                        // Cancellation is not a player failure: reimburse committed HP.
                        if (event.committed && event.cost) {
                            player.hp = Math.min(player.maxHp, player.hp + event.cost);
                        }
                        event.dead = true;
                        this.finishArenaEvent(event, 'cancelled');
                    } else {
                        this.activeArenaEvent.update(dt);
                    }
                    return;
                }
                if (totalTime < this.nextArenaAt || bossApproaching ||
                    this.pendingEncounter || !['BUILDUP', 'PRESSURE'].includes(
                        (this.baseProfile || this.profile).phase) ||
                    wave < 4) return;
                const kind=chooseArenaEventKind(this.arenaEventIndex,wave);
                const safeMargin = 115;
                const minX = Math.min(safeMargin, worldWidth / 3);
                const minY = Math.min(safeMargin, worldHeight / 3);
                const x = minX + Math.random() * Math.max(0, worldWidth - 2 * minX);
                const y = minY + Math.random() * Math.max(0, worldHeight - 2 * minY);
                const fallbackX = Math.max(minX, Math.min(worldWidth - minX, player.x + (player.x < worldWidth / 2 ? 190 : -190)));
                const fallbackY = Math.max(minY, Math.min(worldHeight - minY, player.y + (player.y < worldHeight / 2 ? 150 : -150)));
                const farEnough = Math.hypot(x - player.x, y - player.y) >= 160;
                // Wide corridor lanes must stay visible, including near arena edges.
                const eventX=farEnough?x:fallbackX,eventY=farEnough?y:fallbackY;
                const finalX=kind==='CORRIDOR'?Math.max(154,Math.min(worldWidth-154,eventX)):eventX;
                this.activeArenaEvent=new ArenaEvent(kind,finalX,eventY);
                audio.playThreatCue('event');
                this.arenaEventIndex++;
                this.nextArenaAt = totalTime + ARENA_EVENT_GAP;
                this.stats.arenaOffered++;
                if(!this.stats.arenaByKind[kind]) this.stats.arenaByKind[kind]={
                    offered:0,completed:0,expired:0,cancelled:0,projectilesBlocked:0,momentumSpent:0};
                this.stats.arenaByKind[kind].offered++;
                createFloatingText(player.x, player.y - 68,
                    this.activeArenaEvent.label,
                    this.activeArenaEvent.color, 16);
            }

            finishArenaEvent(event, result) {
                if (this.activeArenaEvent !== event) return;
                this.activeArenaEvent = null;
                if (result === 'completed') this.stats.arenaCompleted++;
                else if (result === 'cancelled') this.stats.arenaCancelled++;
                else this.stats.arenaExpired++;
                const entry=this.stats.arenaByKind[event.kind];
                if(entry){
                    entry[result==='completed'?'completed':result==='cancelled'?'cancelled':'expired']++;
                    entry.projectilesBlocked+=event.projectilesBlocked||0;
                    entry.momentumSpent+=Math.round((event.momentumSpent||0)*10)/10;
                }
            }

            recordBossPattern(id){
                this.stats.bossByPattern[id]=(this.stats.bossByPattern[id]||0)+1;
            }
            observeTacticalMotion(dt, bossLocked) {
                if (bossLocked || !player || !(dt > 0 && dt <= 0.1) ||
                    player.isDashing || !Number.isFinite(player.vx) ||
                    !Number.isFinite(player.vy)) return;
                const alpha = 1 - Math.exp(-dt / 0.65);
                this.tacticalMotion.vx += (player.vx - this.tacticalMotion.vx) * alpha;
                this.tacticalMotion.vy += (player.vy - this.tacticalMotion.vy) * alpha;
                this.tacticalMotion.tracked = Math.min(6, this.tacticalMotion.tracked + dt);
            }

            // Only linked ranged squadmates share a short volley slot. Normal
            // enemies and bosses keep their exact previous fire rates.
            claimSquadVolley(enemy) {
                if (!enemy.formationId || enemy.tacticalRole !== 'payload' ||
                    !getFormationMates(enemy).some(mate => mate.tacticalRole === 'payload' &&
                        (mate.type === 'SHOOTER' || mate.type === 'SNIPER'))) return true;
                const next = this.squadVolleyReady.get(enemy.formationId) ?? -Infinity;
                if (totalTime < next) {
                    this.stats.squadShotsDeferred++;
                    return false;
                }
                this.squadVolleyReady.set(enemy.formationId, totalTime + 0.75);
                if (this.squadVolleyReady.size > 20) {
                    for (const [id, expiry] of this.squadVolleyReady) {
                        if (expiry < totalTime - 3) this.squadVolleyReady.delete(id);
                    }
                }
                return true;
            }
            trackSpecialOffer(plan){
                if(!this.stats.specialByKind[plan.type]){
                    this.stats.specialByKind[plan.type]={
                        offered:0,resolved:0,cancelled:0,units:0,tokensSpent:0};
                }
                this.stats.specialByKind[plan.type].offered++;
            }
            trackSpecialCancellation(plan){
                const bucket=this.stats.specialByKind[plan?.type];
                if(bucket) bucket.cancelled++;
            }
            updateSpecialEncounter(dt) {
                const specialProfile = this.baseProfile || this.profile;
                // Keep classic eligibility windows and never inject a brand-new
                // raid during adaptive RELAX/FADE. Already telegraphed raids
                // still resolve as promised unless original boss rules cancel.
                const inCombat = (specialProfile.phase === 'PRESSURE' || specialProfile.phase === 'CRISIS') &&
                    (this.tempoMode !== 'adaptive' ||
                     this.profile.phase === 'PRESSURE' || this.profile.phase === 'CRISIS');
                const bossImminent = activeBosses.length > 0 || nextBossTime - totalTime < 7;
                if (this.pendingEncounter) {
                    if (bossImminent || specialProfile.phase === 'RECOVERY' || specialProfile.phase === 'WARNING' ||
                        specialProfile.phase === 'BOSS') {
                        this.trackSpecialCancellation(this.pendingEncounter);
                        this.pendingEncounter = null;
                        this.stats.specialCancelled++;
                        return;
                    }
                    this.pendingEncounter.warning -= dt;
                    if (this.pendingEncounter.warning <= 0) this.resolveSpecialEncounter();
                    return;
                }
                if (!inCombat || bossImminent || this.activeArenaEvent || wave < 3 || totalTime < this.nextEncounterAt ||
                    enemies.length > specialProfile.cap - 12 || this.tokens < 8) return;
                const fallbackSide = Math.floor(Math.random() * 4);
                const placement = scoreTacticalDeployment(wave, this.profile.theme,
                    this.encounterIndex, fallbackSide, this.tacticalMotion, this.lastTacticalSide);
                const side = placement.side;
                this.lastTacticalSide = side;
                this.lastTacticalDecision = { ...placement };
                this.pendingEncounter = getSpecialEncounterPlan(wave, this.profile.theme, side, this.encounterIndex);
                this.pendingEncounter.placement = { ...placement };
                this.trackSpecialOffer(this.pendingEncounter);
                audio.playThreatCue('raid');
                this.encounterIndex++;
                this.lastEncounterAt = totalTime;
                this.nextEncounterAt = totalTime + SPECIAL_ENCOUNTER_GAP;
                createFloatingText(player.x, player.y - 70,
                    '⚠ ' + this.pendingEncounter.label + (placement.mode === 'reading-motion' ?
                        ': HAREKET HATTINA KARŞI!' : ': KENARLARDAN GELİYOR!'), '#ffe600', 16);
            }

            resolveSpecialEncounter() {
                const plan = this.pendingEncounter;
                this.pendingEncounter = null;
                if (!plan || activeBosses.length > 0) return 0;
                let spawned = 0;
                let tokensSpent=0;
                for (const unit of plan.units) {
                    const cost = ENEMY_THREAT_COST[unit.type];
                    if (this.tokens < cost || enemies.length >= Math.min(MAX_ACTIVE_ENEMIES,
                        (this.baseProfile || this.profile).cap)) break;
                    const pos = formationEdgePoint(unit.side, unit.slot, unit.count);
                    if (spawnEnemy(false, unit.type, false, pos, {
                        formationId: plan.formationId,
                        role: unit.role,
                        side: unit.side,
                        slot: unit.slot
                    })) {
                        this.tokens -= cost;
                        tokensSpent+=cost;
                        this.stats.spawned++;
                        spawned++;
                    }
                }
                const bucket=this.stats.specialByKind[plan.type];
                if(bucket){
                    bucket.resolved++;
                    bucket.units+=spawned;
                    bucket.tokensSpent=Math.round((bucket.tokensSpent+tokensSpent)*10)/10;
                }
                if (spawned) {
                    this.stats.specialEncounters++;
                    this.stats.specialUnits += spawned;
                }
                return spawned;
            }

            trySpawn() {
                // Give a formation its full telegraph interval without extra random flanks.
                if (this.pendingEncounter) return false;
                if (enemies.length >= Math.min(MAX_ACTIVE_ENEMIES, this.profile.cap) || this.tokens < 1) return false;
                const type = pickEnemyTypeForWave(wave, Math.random(), this.profile.theme, this.tokens);
                if (!type) return false;
                const elite = wave >= 2 && Math.random() < this.profile.eliteChance;
                const spawned = spawnEnemy(false, type, elite);
                if (!spawned) return false;
                this.tokens -= ENEMY_THREAT_COST[type];
                this.stats.spawned++;
                if (elite) this.stats.eliteSpawned++;
                return true;
            }

            onBossEncounter() {
                this.stats.encounters++;
                this.bossChestAwarded = false;
                this.bossAttackNextAt = -Infinity;
                this.nextBossPhaseWindowAt = -Infinity;
                if (this.pendingEncounter) {
                    this.trackSpecialCancellation(this.pendingEncounter);
                    this.pendingEncounter = null;
                    this.stats.specialCancelled++;
                }
            }

            onBossCleared() {
                // Short regroup, then resume the current pressure cycle.
                this.afterBossUntil = totalTime + 4;
            }
            getEliteChanceWindow() {
                return Math.floor(Math.max(0,totalTime)/CHEST_ECONOMY.resetSeconds);
            }
            getNextEliteChestChance() {
                const alreadyDropped=this.eliteChanceWindow===this.getEliteChanceWindow()?
                    this.eliteDropsInWindow:0;
                const tiers=CHEST_ECONOMY.eliteDropChances;
                return tiers[Math.min(alreadyDropped,tiers.length-1)];
            }

            registerChestDrop(source,x,y) {
                if(source==='boss'){
                    if(this.bossChestAwarded) return false;
                    this.bossChestAwarded=true;
                    this.stats.chestDrops.boss++;
                    lootChests.push(new LootChest(x,y,'boss'));
                    return true;
                }
                this.stats.eliteKills++;
                const currentWindow=this.getEliteChanceWindow();
                if(this.eliteChanceWindow!==currentWindow){
                    this.eliteChanceWindow=currentWindow;
                    this.eliteDropsInWindow=0;
                }
                if(totalTime-this.lastEliteChestAt<CHEST_ECONOMY.eliteCooldownSeconds){
                    this.stats.chestDenied.cooldown++;return false;
                }
                if(lootChests.filter(chest=>chest.source==='elite').length>=CHEST_ECONOMY.eliteGroundCap){
                    this.stats.chestDenied.groundCap++;return false;
                }
                if(Math.random()>=this.getNextEliteChestChance()){
                    this.stats.chestDenied.roll++;return false;
                }
                this.lastEliteChestAt=totalTime;
                this.eliteDropsInWindow++;
                this.stats.chestDrops.elite++;
                lootChests.push(new LootChest(x,y,'elite'));
                return true;
            }
            onGoldGranted(source,amount) {
                if(!Number.isFinite(amount)||amount<=0||!(source in this.stats.goldBySource)) return;
                this.stats.goldBySource[source]+=amount;
            }
            onChestOpened(reward,source='elite',granted={}) {
                if(this.stats.chestOpened[reward]!==undefined) this.stats.chestOpened[reward]++;
                const bucket=this.stats.chestRewards[source];
                if(!bucket) return;
                bucket.opened++;
                bucket.gold+=granted.gold||0;
                bucket.heal+=granted.healed||0;
                bucket.xp+=granted.xp||0;
                bucket.charge+=granted.charge||0;
                bucket.shots+=granted.shots||0;
            }
            getEconomySnapshot(){
                const d=this.stats.chestDrops;
                return {
                    timeSeconds:Math.round(totalTime),wave,
                    eliteKills:this.stats.eliteKills,bossKills:this.stats.bossKills,
                    chestDrops:{...d},chestDenied:{...this.stats.chestDenied},
                    chestOpened:{...this.stats.chestOpened},
                    chestRewards:{elite:{...this.stats.chestRewards.elite},
                        boss:{...this.stats.chestRewards.boss}},
                    goldBySource:{...this.stats.goldBySource},
                    goldSession:sessionGold,
                    goldTracked:Object.values(this.stats.goldBySource).reduce((a,v)=>a+v,0),
                    fieldDefense: { uses: bastionUses, goldSpent: bastionGoldSpent,
                        shotsBlocked: bastionShotsBlocked },
                    onGround:lootChests.length,
                    eliteChanceWindow:this.getEliteChanceWindow(),
                    eliteDropsInWindow:this.eliteChanceWindow===this.getEliteChanceWindow()?
                        this.eliteDropsInWindow:0,
                    nextEliteDropChance:this.getNextEliteChestChance(),
                    eliteCooldownRemaining:Math.max(0,
                        Math.round((CHEST_ECONOMY.eliteCooldownSeconds-
                            (totalTime-this.lastEliteChestAt))*10)/10),
                    eliteChestsPerMinute:totalTime>0?Math.round(600*d.elite/totalTime)/10:0,
                    totalChestsPerMinute:totalTime>0?Math.round(600*(d.elite+d.boss)/totalTime)/10:0
                };
            }

            getDiagnostics() {
                const drops = this.stats.chestDrops.elite + this.stats.chestDrops.boss;
                return {
                    timeSeconds: Math.round(totalTime), wave,
                    contract: getActiveNeonContract().id,
                    phase: this.profile.phase, theme: this.profile.theme,
                    tempoMode: this.tempoMode,
                    basePhase: (this.baseProfile || this.profile).phase,
                    adaptivePhase: this.adaptivePhase,
                    tempoPhaseSwitches: this.tempoPhaseSwitches,
                    tempoPhaseSeconds: { ...this.tempoPhaseSeconds },
                    tempoRunMetrics: this.tempoRunMetrics.getSnapshot(),
                    playerLearner: this.playerLearner.getSnapshot(),
                    adaptiveTempo: {
                        ...this.intensityObserver.getSnapshot(),
                        mode: this.tempoMode === 'adaptive' ? 'driving-spawns' : 'observe-only'
                    },
                    threatTokens: Math.round(this.tokens * 10) / 10,
                    pendingEncounter: this.pendingEncounter ? this.pendingEncounter.type : null,
                    tacticalPlacement: { ...this.lastTacticalDecision },
                    crowdSteering: getEnemyCrowdSteeringSnapshot(),
                    phaseEcho: getPhaseEchoSnapshot(),
                    circuitWeaver: getCircuitWeaverSnapshot(),
                    arenaChapter: getArenaChapterSnapshot(),
                    nemesis:getNemesisSnapshot(),
                    prismGuard:getPrismGuardSnapshot(),
                    bastion: getBastionStatus(),
                    warningRemaining: this.pendingEncounter ? Math.round(this.pendingEncounter.warning * 10) / 10 : 0,
                    arenaEvent: this.activeArenaEvent ? this.activeArenaEvent.kind : null,
                    arenaTimeLeft: this.activeArenaEvent ? Math.round(this.activeArenaEvent.timeLeft) : 0,
                    arenaProgress: this.activeArenaEvent ?
                        Math.round(100 * this.activeArenaEvent.progress / this.activeArenaEvent.required) : 0,
                    ...this.stats,
                    arenaByKind:Object.fromEntries(Object.entries(this.stats.arenaByKind)
                        .map(([kind,entry])=>[kind,{...entry}])),
                    specialByKind:Object.fromEntries(Object.entries(this.stats.specialByKind)
                        .map(([kind,entry])=>[kind,{...entry}])),
                    bossByPattern:{...this.stats.bossByPattern},
                    upcomingBossPattern:getBossEncounterPlan(bossEncounterCount+1).id,
                    chestDrops:{...this.stats.chestDrops},
                    chestDenied:{...this.stats.chestDenied},
                    chestOpened:{...this.stats.chestOpened},
                    chestRewards:{elite:{...this.stats.chestRewards.elite},
                        boss:{...this.stats.chestRewards.boss}},
                    goldBySource:{...this.stats.goldBySource},
                    economy:this.getEconomySnapshot(),
                    chestsPerMinute: totalTime > 0 ? Math.round(600 * drops / totalTime) / 10 : 0
                };
            }
        }


        function getBossCountForEncounter(encounterNumber) {
            if(encounterNumber<=3) return 1;
            if(encounterNumber===4) return 2;
            return encounterNumber%2===1?3:2;
        }

        // Fixed first three introductions remain untouched. The late game uses
        // distinct combinations of existing boss abilities, never extra boss count.
        const LATE_BOSS_ENCOUNTER_PATTERNS=Object.freeze([
            Object.freeze({id:'ARMOR_PRISM',label:'ZIRH + PRİZMA',
                types:Object.freeze(['BOSS_TITAN','BOSS_PRISM'])}),
            Object.freeze({id:'VOID_CROSSFIRE',label:'HİÇLİK ÇAPRAZI',
                types:Object.freeze(['BOSS_DESTROYER','BOSS_VOID','BOSS_PRISM'])}),
            Object.freeze({id:'BREAKING_LINE',label:'KIRICI HAT',
                types:Object.freeze(['BOSS_TITAN','BOSS_DESTROYER'])}),
            Object.freeze({id:'GRAVITY_NET',label:'GRAVİTASYON AĞI',
                types:Object.freeze(['BOSS_TITAN','BOSS_VOID','BOSS_PRISM'])}),
            Object.freeze({id:'SIEGE_BEAMS',label:'IŞIN KUŞATMASI',
                types:Object.freeze(['BOSS_DESTROYER','BOSS_PRISM'])}),
            Object.freeze({id:'VOID_IRON',label:'HİÇLİK VE ZIRH',
                types:Object.freeze(['BOSS_TITAN','BOSS_DESTROYER','BOSS_VOID'])})
        ]);
        function getBossEncounterPlan(encounterNumber){
            if(encounterNumber>=1&&encounterNumber<=OPENING_BOSS_ORDER.length){
                const type=OPENING_BOSS_ORDER[encounterNumber-1];
                return {id:'INTRO_'+encounterNumber,label:BOSS_VISUALS[type].tag,
                    types:[type]};
            }
            const pattern=LATE_BOSS_ENCOUNTER_PATTERNS[
                Math.max(0,encounterNumber-4)%LATE_BOSS_ENCOUNTER_PATTERNS.length];
            return {id:pattern.id,label:pattern.label,types:[...pattern.types]};
        }
        function getBossArchetypesForEncounter(encounterNumber){
            return getBossEncounterPlan(encounterNumber).types.map(type=>
                BOSS_ARCHETYPES.find(arch=>arch.type===type));
        }

        function spawnBossEncounter() {
            cancelFieldDevices();
            bossEncounterCount++;
            if (combatDirector) combatDirector.onBossEncounter();
            nextBossTime = Number.POSITIVE_INFINITY;
            const bossCount = getBossCountForEncounter(bossEncounterCount);
            const encounterPlan=getBossEncounterPlan(bossEncounterCount);
            const selectedArchetypes=getBossArchetypesForEncounter(bossEncounterCount);
            if(combatDirector) combatDirector.recordBossPattern(encounterPlan.id);
            const spawnedNames = [];

            for (let i = 0; i < bossCount; i++) {
                const arch=selectedArchetypes[i%selectedArchetypes.length];
                const pos = getRandomEdgePosition(55);
                const boss = new Enemy(pos.x, pos.y, arch.type, false);
                enemies.push(boss);
                activeBosses.push(boss);
                emitMotionFx('BOSS',boss.x,boss.y,{radius:150});
                spawnedNames.push(arch.name);
            }

            const hudBoss = document.getElementById('bossHudContainer');
            hudBoss.classList.remove('hidden');
            hudBoss.classList.add('flex');

            if (bossCount > 1) {
                showDopamineBanner(bossCount+' BOSS · '+encounterPlan.label, '#ff0055');
            } else {
                showDopamineBanner(`BOSS · ${spawnedNames[0]}`, '#ff0055');
            }
        }

        function spawnEnemy(forceBoss = false, typeOverride = null, eliteOverride = null,
            positionOverride = null, tacticalMeta = null) {
            if (forceBoss) {
                spawnBossEncounter();
                return true;
            }
            if (enemies.length >= MAX_ACTIVE_ENEMIES) return false;
            const type = typeOverride || pickEnemyTypeForWave(wave, Math.random());
            if (!type) return false;
            const isElite = eliteOverride === null
                ? wave >= 2 && Math.random() < Math.min(0.12, 0.03 + wave * 0.002)
                : eliteOverride;
            const pos = positionOverride || getRandomEdgePosition(45);
            enemies.push(new Enemy(pos.x, pos.y, type, isElite, tacticalMeta));
            return true;
        }

        function updateGame(dt) {
            if (hitStopTimer > 0) {
                hitStopTimer -= dt;
                return;
            }

            weaponImpactFrameCount = 0;
            motionFxFrameCount = 0;
            totalTime += dt;
            waveTimer += dt;
            if (slowMoTimer > 0) slowMoTimer = Math.max(0, slowMoTimer - dt);
            updatePrismGuard();
            updateBastion();
            updatePhaseEchoes();
            updateCircuitField();

            if (bannerHideTimer > 0) {
                bannerHideTimer -= dt;
                if (bannerHideTimer <= 0) {
                    document.getElementById('killstreakBanner').classList.add('hidden');
                }
            }

            const bossApproaching = activeBosses.length===0 &&
                totalTime >= nextBossTime-3.8 && totalTime<nextBossTime;
            audio.updateMusic(dt, gameState === 'PLAYING', !!player?.overdriveActive,
                activeBosses.length, bossApproaching);

            if (waveTimer >= 16) {
                waveTimer = 0;
                wave++;
                createFloatingText(player.x, player.y - 45, `DALGA ${wave} BAŞLADI!`, '#ff007f', 20);
                shockwaves.push(new Shockwave(player.x, player.y, 240, '#ff007f', 0.45));
                emitMotionFx('WAVE',player.x,player.y,{radius:150});
                maybeSpawnFieldDevice();
            }

            activeBosses = activeBosses.filter(b => !b.dead);

            if (totalTime >= nextBossTime - 3.8 && totalTime < nextBossTime && activeBosses.length === 0) {
                bossWarningTimer = 1;
                if (combatDirector && combatDirector.lastBossCueEncounter !== bossEncounterCount + 1) {
                    combatDirector.lastBossCueEncounter = bossEncounterCount + 1;
                    audio.playThreatCue('boss');
                }
                const warnBanner = document.getElementById('bossWarningBanner');
                const warnText = document.getElementById('bossWarningText');
                const upcomingCount=getBossCountForEncounter(bossEncounterCount+1);
                const upcomingPlan=getBossEncounterPlan(bossEncounterCount+1);
                if (warnText) {
                    const nextLabel = upcomingCount>1?
                        upcomingCount+' BOSS · '+upcomingPlan.label:
                        'BOSS YAKLAŞIYOR';
                    if (warnText.textContent !== nextLabel) warnText.textContent = nextLabel;
                    const nextTitle = upcomingPlan.types.map(type=>
                        BOSS_ARCHETYPES.find(arch=>arch.type===type).name).join(' + ');
                    if (warnText.title !== nextTitle) warnText.title = nextTitle;
                }
                warnBanner.classList.remove('hidden');
            } else {
                document.getElementById('bossWarningBanner').classList.add('hidden');
            }

            if (totalTime >= nextBossTime && activeBosses.length === 0) {
                document.getElementById('bossWarningBanner').classList.add('hidden');
                audio.playExplosion(true);
                screenShake = 20;
                spawnEnemy(true);
            }

            conduitSpawnTimer -= dt;
            if (conduitSpawnTimer <= 0) {
                conduitSpawnTimer = 15.0;
                if (conduitZones.length < 2) {
                    const cx = 110 + Math.random() * Math.max(100, worldWidth - 220);
                    const cy = 110 + Math.random() * Math.max(100, worldHeight - 220);
                    conduitZones.push(new ConduitZone(cx, cy));
                }
            }

            if (combo > 1) {
                comboTimer -= dt;
                if (comboTimer <= 0) {
                    combo = 1;
                }
            }

            if (screenShake > 0) {
                screenShake = Math.max(0, screenShake - dt * 32);
            }

            player.update(dt);
            sampleMotionDash(dt);

            gridOffset.x = (gridOffset.x - player.vx * 0.15 * dt) % 48;
            gridOffset.y = (gridOffset.y - player.vy * 0.15 * dt) % 48;

            combatDirector.update(dt);
            updateArenaChapter(dt);
            spawnTimer -= dt;
            if (spawnTimer <= 0) {
                spawnTimer += combatDirector.profile.interval;
                combatDirector.trySpawn();
            }

            for (let i = conduitZones.length - 1; i >= 0; i--) {
                conduitZones[i].update(dt);
                if (conduitZones[i].dead) conduitZones.splice(i, 1);
            }

            for (let i = bullets.length - 1; i >= 0; i--) {
                bullets[i].update(dt);
                if (bullets[i].dead) bullets.splice(i, 1);
            }
            updateFieldDevices(dt);

            const enemyTimeScale = slowMoTimer > 0 ? 0.45 : 1.0;

            for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
                const ep = enemyProjectiles[i];
                if (ep.dead) {
                    enemyProjectiles.splice(i, 1);
                    continue;
                }
                ep.update(dt * enemyTimeScale);
                if (!ep.dead && deflectPrismProjectile(ep)) {
                    enemyProjectiles.splice(i,1);
                    continue;
                }
                if (bastionIntercepts(ep)) {
                    ep.dead = true;
                    bastion.blocked++;
                    bastionShotsBlocked++;
                }
                if (!ep.dead && Math.hypot(ep.x - player.x, ep.y - player.y) < ep.radius + player.radius) {
                    player.takeDamage(ep.damage);
                    ep.dead = true;
                }
                if (ep.dead) enemyProjectiles.splice(i, 1);
            }

            const orbPositions = player.getOrbitalPositions();
            // Spatial broad phase: each enemy checks only projectiles in nearby cells.
            buildBulletCollisionGrid();
            sampleEnemyCrowdSteering(dt * enemyTimeScale);

            for (let i = enemies.length - 1; i >= 0; i--) {
                const e = enemies[i];
                e.update(dt * enemyTimeScale * getFieldEnemyTimeScale(e));

                for (const j of getNearbyBulletIndices(e.x, e.y, e.radius, bulletCandidateScratch)) {
                    const b = bullets[j];
                    if (b.dead || b.hitIds.has(e.id)) continue;
                    const dx = e.x - b.x;
                    const dy = e.y - b.y;
                    const hitRadius = e.radius + b.radius;
                    if (dx * dx + dy * dy < hitRadius * hitRadius) {
                        b.hitIds.add(e.id);
                        b.pierce--;
                        const kAngle = Math.atan2(b.vy, b.vx);
                        e.takeDamage(b.damage, Math.cos(kAngle) * 140, Math.sin(kAngle) * 140,
                            b.isCrit, true, b.forceChain);
                        emitWeaponImpact(b, e);
                        audio.playWeaponHit(getWeaponSoundFamily(b),b.isCrit,e.isBoss);
                        spawnClusterFragments(b, e);
                        if (b.pierce <= 0) {
                            b.dead = true;
                            break;
                        }
                    }
                }

                if (!e.dead) {
                    for (const op of orbPositions) {
                        if (e.orbitalHitCooldown <= 0 && Math.hypot(e.x - op.x, e.y - op.y) < e.radius + op.r) {
                            // Shared contact cooldown limits both DPS and damage-number spam.
                            e.orbitalHitCooldown = 0.12;
                            const angle = Math.atan2(e.y - player.y, e.x - player.x);
                            e.takeDamage(player.damage * 8 * 0.12, Math.cos(angle) * 13.2, Math.sin(angle) * 13.2, false, false);
                        }
                    }
                }

                if (!e.dead) {
                    const distToPlayer = Math.hypot(e.x - player.x, e.y - player.y);
                    if (distToPlayer < e.radius + player.radius) {
                        if (player.isDashing) {
                            const angle = Math.atan2(e.y - player.y, e.x - player.x);
                            e.takeDamage(player.damage * 1.9 + 18, Math.cos(angle) * 420, Math.sin(angle) * 420, true, true);
                        } else {
                            player.takeDamage(e.damage);
                            const angle = Math.atan2(e.y - player.y, e.x - player.x);
                            e.pushVx = Math.cos(angle) * 320;
                            e.pushVy = Math.sin(angle) * 320;
                            if (e.type === 'KAMIKAZE') {
                                e.die();
                            }
                        }
                    }
                }

                if (e.dead) {
                    enemies.splice(i, 1);
                }
            }

            updateNemesis(dt);

            for (let i = orbs.length - 1; i >= 0; i--) {
                orbs[i].update(dt);
                if (orbs[i].dead) orbs.splice(i, 1);
            }
            if (pendingMetaSave) {
                pendingMetaSave = false;
                saveMetaProgress();
            }

            for (let i = lootChests.length - 1; i >= 0; i--) {
                lootChests[i].update(dt);
                if (lootChests[i].dead) lootChests.splice(i, 1);
            }

            for (let i = powerups.length - 1; i >= 0; i--) {
                powerups[i].update(dt);
                if (powerups[i].dead) powerups.splice(i, 1);
            }

            updateMotionFx(dt);
            for (let i = particles.length - 1; i >= 0; i--) {
                particles[i].update(dt);
                if (particles[i].life <= 0) particles.splice(i, 1);
            }

            for (let i = shockwaves.length - 1; i >= 0; i--) {
                shockwaves[i].update(dt);
                if (shockwaves[i].elapsed >= shockwaves[i].duration) shockwaves.splice(i, 1);
            }

            for (let i = lightningBolts.length - 1; i >= 0; i--) {
                lightningBolts[i].life -= dt;
                if (lightningBolts[i].life <= 0) lightningBolts.splice(i, 1);
            }
            for (let i = bossDeathVfx.length - 1; i >= 0; i--) {
                bossDeathVfx[i].age += dt;
                if (bossDeathVfx[i].age >= bossDeathVfx[i].duration) bossDeathVfx.splice(i,1);
            }
            for (let i = weaponImpacts.length - 1; i >= 0; i--) {
                weaponImpacts[i].life -= dt;
                if (weaponImpacts[i].life <= 0) weaponImpacts.splice(i, 1);
            }

            updateQuest(dt);
            for (let i = floatingTexts.length - 1; i >= 0; i--) {
                const ft = floatingTexts[i];
                ft.y -= 38 * dt;
                ft.life -= dt;
                if (ft.life <= 0) floatingTexts.splice(i, 1);
            }

            hudRefreshAccumulator += dt;
            if (hudRefreshAccumulator >= HUD_REFRESH_INTERVAL) {
                hudRefreshAccumulator %= HUD_REFRESH_INTERVAL;
                updateHUD();
            }
        }

        // No shockwave: straight grid geometry needs only two path points per
        // line. Cover the full viewport so non-multiple-of-32 sizes do not
        // leave visually clipped grid lines at the right and bottom edges.
        function drawStraightGridLines(targetCtx, offset, width, height, spacing = 48) {
            for (let x = offset.x; x < width; x += spacing) {
                targetCtx.beginPath();
                targetCtx.moveTo(x, 0);
                targetCtx.lineTo(x, height);
                targetCtx.stroke();
            }
            for (let y = offset.y; y < height; y += spacing) {
                targetCtx.beginPath();
                targetCtx.moveTo(0, y);
                targetCtx.lineTo(width, y);
                targetCtx.stroke();
            }
        }

        function drawBackgroundGrid() {
            ctx.fillStyle = '#050816';
            ctx.fillRect(0, 0, worldWidth, worldHeight);
            const phase = combatDirector?.profile?.phase;
            const railColor = phase === 'BOSS' || phase === 'WARNING'
                ? 'rgba(255,82,104,.36)' : phase === 'CRISIS'
                    ? 'rgba(255,182,71,.28)' : 'rgba(0,226,236,.16)';
            ctx.fillStyle = railColor;
            const corner = Math.min(84, Math.max(28, Math.min(worldWidth, worldHeight) * .11));
            for (const [x,y,dx,dy] of [
                [10,10,1,1],[worldWidth-10,10,-1,1],
                [10,worldHeight-10,1,-1],[worldWidth-10,worldHeight-10,-1,-1]
            ]) {
                ctx.fillRect(dx > 0 ? x : x-corner*.65, y, corner*.65, 2);
                ctx.fillRect(x, dy > 0 ? y : y-corner*.65, 2, corner*.65);
            }

            const spacing = getGraphicsPreset().gridSpacing;
            ctx.strokeStyle = (player && player.overdriveActive) ? 'rgba(255, 0, 127, 0.14)' : 'rgba(0, 243, 255, 0.08)';
            ctx.lineWidth = 1;
            if (shockwaves.length === 0) {
                drawStraightGridLines(ctx, gridOffset, worldWidth, worldHeight, spacing);
                return;
            }
            // Only sample and distort the grid during a visible shockwave.
            // This branch retains the original shockwave path and geometry.
            const gridShockwaves = shockwaves.map(sw => {
                const progress = sw.elapsed / sw.duration;
                return { x: sw.x, y: sw.y, radius: sw.maxRadius * progress, displacement: 9 * (1 - progress) };
            });

            for (let x = gridOffset.x; x < worldWidth; x += spacing) {
                ctx.beginPath();
                for (let y = 0; y <= worldHeight; y += 32) {
                    let gx = x;
                    for (const sw of gridShockwaves) {
                        const dx = x - sw.x;
                        const dy = y - sw.y;
                        if (Math.abs(dx) > sw.radius + 42 || Math.abs(dy) > sw.radius + 42) continue;
                        const d = Math.hypot(dx, dy);
                        if (Math.abs(d - sw.radius) < 42) {
                            gx += (dx / (d || 1)) * sw.displacement;
                        }
                    }
                    if (y === 0) ctx.moveTo(gx, y);
                    else ctx.lineTo(gx, y);
                }
                // The last 32px sample may fall short of the canvas edge.
                // Continue the same shockwave deformation at the real boundary.
                if (worldHeight % 32 !== 0) {
                    let gx = x;
                    for (const sw of gridShockwaves) {
                        const dx = x - sw.x;
                        const dy = worldHeight - sw.y;
                        if (Math.abs(dx) > sw.radius + 42 ||
                            Math.abs(dy) > sw.radius + 42) continue;
                        const d = Math.hypot(dx, dy);
                        if (Math.abs(d - sw.radius) < 42) {
                            gx += (dx / (d || 1)) * sw.displacement;
                        }
                    }
                    ctx.lineTo(gx, worldHeight);
                }
                ctx.stroke();
            }

            for (let y = gridOffset.y; y < worldHeight; y += spacing) {
                ctx.beginPath();
                for (let x = 0; x <= worldWidth; x += 32) {
                    let gy = y;
                    for (const sw of gridShockwaves) {
                        const dx = x - sw.x;
                        const dy = y - sw.y;
                        if (Math.abs(dx) > sw.radius + 42 || Math.abs(dy) > sw.radius + 42) continue;
                        const d = Math.hypot(dx, dy);
                        if (Math.abs(d - sw.radius) < 42) {
                            gy += (dy / (d || 1)) * sw.displacement;
                        }
                    }
                    if (x === 0) ctx.moveTo(x, gy);
                    else ctx.lineTo(x, gy);
                }
                if (worldWidth % 32 !== 0) {
                    let gy = y;
                    for (const sw of gridShockwaves) {
                        const dx = worldWidth - sw.x;
                        const dy = y - sw.y;
                        if (Math.abs(dx) > sw.radius + 42 ||
                            Math.abs(dy) > sw.radius + 42) continue;
                        const d = Math.hypot(dx, dy);
                        if (Math.abs(d - sw.radius) < 42) {
                            gy += (dy / (d || 1)) * sw.displacement;
                        }
                    }
                    ctx.lineTo(worldWidth, gy);
                }
                ctx.stroke();
            }
        }

        // The ambient palette reacts to encounter pacing, never to random FX.
        // Boss warning contrast overrides player Overdrive so danger remains legible.
        // Immutable phase palettes prevent a short-lived object allocation
        // on every active render frame without reducing neon visual intensity.
        const ARENA_ATMOSPHERE_PROFILES = Object.freeze({
            danger: Object.freeze({ id:'danger', color:'#ff526d', accent:'#ffb15c', strength:0.83, speed:1.8 }),
            overdrive: Object.freeze({ id:'overdrive', color:'#ff3ba7', accent:'#5de7ff', strength:0.8, speed:2.1 }),
            crisis: Object.freeze({ id:'crisis', color:'#f4a44b', accent:'#ff6277', strength:0.68, speed:1.6 }),
            pressure: Object.freeze({ id:'pressure', color:'#00cde7', accent:'#9776ff', strength:0.54, speed:1.3 }),
            recovery: Object.freeze({ id:'recovery', color:'#39c7a5', accent:'#48a9db', strength:0.32, speed:0.65 }),
            buildup: Object.freeze({ id:'buildup', color:'#25b2d7', accent:'#567ad1', strength:0.39, speed:0.8 })
        });
        const CHASSIS_ATMOSPHERE_SKINS = Object.freeze({
            VANGUARD: Object.freeze({id:'AURORA_GRID',label:'AURORA GRID',accent:'#4de7ff',secondary:'#6f8cff',pulse:1.0}),
            PHANTOM: Object.freeze({id:'VIOLET_GHOST',label:'VIOLET GHOST',accent:'#ff62d0',secondary:'#b678ff',pulse:1.23}),
            TITAN: Object.freeze({id:'EMERALD_FURNACE',label:'EMERALD FURNACE',accent:'#62ff9a',secondary:'#ffd166',pulse:0.78})
        });
        function getChassisAtmosphereSkin(chassis = player?.chassis) {
            return CHASSIS_ATMOSPHERE_SKINS[chassis] || CHASSIS_ATMOSPHERE_SKINS.VANGUARD;
        }
        function getArenaAtmosphereProfile(phase, overdrive) {
            if (phase === 'WARNING' || phase === 'BOSS') return ARENA_ATMOSPHERE_PROFILES.danger;
            if (overdrive) return ARENA_ATMOSPHERE_PROFILES.overdrive;
            if (phase === 'CRISIS') return ARENA_ATMOSPHERE_PROFILES.crisis;
            if (phase === 'PRESSURE') return ARENA_ATMOSPHERE_PROFILES.pressure;
            if (phase === 'RECOVERY') return ARENA_ATMOSPHERE_PROFILES.recovery;
            return ARENA_ATMOSPHERE_PROFILES.buildup;
        }

        const PREFERS_REDUCED_VFX_MOTION =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function drawArenaAtmosphere() {
            if (gameState !== 'PLAYING') return;
            const profile = getArenaAtmosphereProfile(combatDirector?.profile?.phase,
                !!player?.overdriveActive);
            const skin = getChassisAtmosphereSkin(player?.chassis);
            const phaseTime = PREFERS_REDUCED_VFX_MOTION ? 0 : totalTime;
            const beat = (1 + Math.sin(phaseTime * profile.speed * 2.1 * skin.pulse)) * 0.5;
            const intensity = profile.strength * (0.7 + beat * 0.28);
            const side = Math.min(96, worldWidth * 0.09);
            ctx.save();
            // Peripheral circuitry. Never paint solid light over central projectiles.
            ctx.strokeStyle = profile.id === 'danger' ? profile.color : skin.accent;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.12 + intensity * 0.15;
            for (const x of [side, worldWidth - side]) {
                ctx.beginPath();
                ctx.moveTo(x, 38);
                ctx.lineTo(x, worldHeight * 0.25);
                ctx.moveTo(x, worldHeight * 0.75);
                ctx.lineTo(x, worldHeight - 38);
                ctx.stroke();
            }
            // Receding arcs hint at an industrial reactor beneath the arena floor.
            const cx = worldWidth / 2, cy = worldHeight / 2;
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.10 + intensity * 0.10;
            const atmosphereRings = graphicsQuality === 'low' ? 0 :
                graphicsQuality === 'medium' ? 1 : 3;
            for (let ring = 0; ring < atmosphereRings; ring++) {
                const radius = Math.min(worldWidth, worldHeight) * (0.27 + ring * 0.19);
                const offset = phaseTime * (ring % 2 ? -0.075 : 0.06);
                ctx.beginPath();
                ctx.arc(cx, cy, radius, offset + ring * 0.4, offset + ring * 0.4 + Math.PI * 0.68);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(cx, cy, radius, offset + Math.PI + ring * 0.4,
                    offset + Math.PI * 1.65 + ring * 0.4);
                ctx.stroke();
            }
            ctx.globalAlpha = 0.12 + intensity * 0.26;
            ctx.fillStyle = profile.id === 'danger' ? profile.accent : skin.secondary;
            const segmentSize = Math.min(95, Math.max(24, worldWidth * 0.06));
            for (const [x, y, sign] of [
                [20, 24, 1], [worldWidth - 20, 24, -1],
                [20, worldHeight - 24, 1], [worldWidth - 20, worldHeight - 24, -1]
            ]) {
                ctx.fillRect(sign > 0 ? x : x - segmentSize, y, segmentSize, 2);
                ctx.fillRect(x - 1, y - (y > cy ? 24 : 0), 2, 24);
            }
            // Subtle synchronized lane markers become sharper during crisis or boss.
            if (profile.id === 'crisis' || profile.id === 'danger') {
                ctx.fillStyle = profile.color;
                ctx.globalAlpha = intensity * (0.13 + beat * 0.13);
                for (let i = 0; i < 5; i++) {
                    const y = (i + 1) * worldHeight / 6;
                    ctx.fillRect(7, y - 1, Math.max(8, side * 0.35), 2);
                    ctx.fillRect(worldWidth - 7 - Math.max(8, side * 0.35), y - 1,
                        Math.max(8, side * 0.35), 2);
                }
            }
            ctx.restore();
        }

        function drawSpecialEncounterWarning() {
            if (!combatDirector || !combatDirector.pendingEncounter || gameState !== 'PLAYING') return;
            const plan = combatDirector.pendingEncounter;
            const progress = Math.max(0.2, Math.min(1, plan.warning / SPECIAL_ENCOUNTER_WARNING));
            const sides = [...new Set(plan.units.map(unit => unit.side))];
            ctx.save();
            ctx.lineWidth = 4;
            ctx.setLineDash([14, 9]);
            ctx.globalAlpha = 0.35 + 0.45 * (1 - progress);
            ctx.strokeStyle = plan.color||'#ffbf58';
            ctx.fillStyle = 'rgba(255, 180, 0, 0.04)';
            const band = Math.min(70, Math.min(worldWidth, worldHeight) * 0.13);
            for (const side of sides) {
                if (side === 0) {
                    ctx.fillRect(0, 0, worldWidth, band);
                    ctx.beginPath(); ctx.moveTo(0, band); ctx.lineTo(worldWidth, band); ctx.stroke();
                } else if (side === 1) {
                    ctx.fillRect(worldWidth - band, 0, band, worldHeight);
                    ctx.beginPath(); ctx.moveTo(worldWidth - band, 0); ctx.lineTo(worldWidth - band, worldHeight); ctx.stroke();
                } else if (side === 2) {
                    ctx.fillRect(0, worldHeight - band, worldWidth, band);
                    ctx.beginPath(); ctx.moveTo(0, worldHeight - band); ctx.lineTo(worldWidth, worldHeight - band); ctx.stroke();
                } else {
                    ctx.fillRect(0, 0, band, worldHeight);
                    ctx.beginPath(); ctx.moveTo(band, 0); ctx.lineTo(band, worldHeight); ctx.stroke();
                }
            }
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#ffdb75';
            const mark = Math.max(10, Math.round(26 * (1-progress)));
            for (const side of sides) {
                if (side === 0) ctx.fillRect(worldWidth/2-20,12,40,mark);
                else if (side === 1) ctx.fillRect(worldWidth-12-mark,worldHeight/2-20,mark,40);
                else if (side === 2) ctx.fillRect(worldWidth/2-20,worldHeight-12-mark,40,mark);
                else ctx.fillRect(12,worldHeight/2-20,mark,40);
            }
            if (graphicsQuality !== 'low') {
                const roleLabels = { guard: 'KALKAN', payload: 'MENZIL', flank: 'FLANK',
                    screen: 'EKRAN', lane: 'KORIDOR', anchor: 'CAPA', escape: 'KACIS' };
                const pulse = PREFERS_REDUCED_VFX_MOTION ? 1 :
                    0.82 + Math.sin(totalTime * 5.5) * 0.18;
                for (const unit of plan.units.slice(0, 4)) {
                    const edge = formationEdgePoint(unit.side, unit.slot, unit.count, 14);
                    const marker = { x: edge.x, y: edge.y };
                    if (unit.side === 0) marker.y = band + 9;
                    else if (unit.side === 1) marker.x = worldWidth - band - 9;
                    else if (unit.side === 2) marker.y = worldHeight - band - 9;
                    else marker.x = band + 9;
                    ctx.save();
                    ctx.globalAlpha = 0.72 * pulse;
                    ctx.strokeStyle = unit.role === 'guard' ? '#67e8f9' :
                        unit.role === 'payload' ? '#8af1eb' :
                        unit.role === 'flank' ? '#ff9f43' : plan.color || '#ffdb75';
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    if (unit.role === 'guard') {
                        ctx.arc(marker.x, marker.y, 8, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.beginPath(); ctx.moveTo(marker.x - 4, marker.y);
                        ctx.lineTo(marker.x + 4, marker.y); ctx.stroke();
                    } else if (unit.role === 'payload') {
                        ctx.arc(marker.x, marker.y, 7, 0, Math.PI * 2); ctx.stroke();
                        ctx.moveTo(marker.x - 10, marker.y); ctx.lineTo(marker.x + 10, marker.y);
                        ctx.moveTo(marker.x, marker.y - 10); ctx.lineTo(marker.x, marker.y + 10); ctx.stroke();
                    } else if (unit.role === 'flank' || unit.role === 'escape') {
                        ctx.moveTo(marker.x - 7, marker.y + 5); ctx.lineTo(marker.x + 7, marker.y);
                        ctx.lineTo(marker.x - 7, marker.y - 5); ctx.stroke();
                    } else {
                        ctx.strokeRect(marker.x - 6, marker.y - 6, 12, 12);
                    }
                    if (graphicsQuality === 'high') {
                        ctx.font = "700 8px 'Orbitron', sans-serif";
                        ctx.textAlign = 'center';
                        ctx.fillText(roleLabels[unit.role] || 'ROL', marker.x, marker.y - 12);
                    }
                    ctx.restore();
                }
            }
            ctx.font="bold 13px 'Orbitron',sans-serif";
            ctx.textAlign='center';
            ctx.fillStyle=plan.color||'#ffdb75';
            ctx.fillText(plan.label,worldWidth/2,Math.min(98,worldHeight*.19));
            ctx.restore();
        }

        function drawTacticalLinks() {
            if (!player || gameState !== 'PLAYING' || graphicsQuality === 'low') return;
            for (const payload of enemies) {
                if (payload.dead || payload.tacticalRole !== 'payload') continue;
                const escort = getTacticalEscort(payload);
                if (!escort) continue;
                ctx.save();
                ctx.globalAlpha = 0.24 + 0.06 * (0.5 + 0.5 * Math.sin(totalTime * 5));
                ctx.strokeStyle = escort.color || '#38bdf8';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 7]);
                ctx.beginPath();
                ctx.moveTo(escort.x, escort.y);
                ctx.lineTo(payload.x, payload.y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.globalAlpha *= 1.35;
                ctx.beginPath();
                ctx.arc(escort.x, escort.y, escort.radius + 7, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

        function drawOffscreenIndicators() {
            if (!player || gameState !== 'PLAYING') return;
            const pad = 34;
            const targets = [];

            for (const b of activeBosses) {
                if (!b.dead) targets.push({ x: b.x, y: b.y, col: b.color,
                    label: b.bossVisual?.tag || b.bossName || 'BOSS' });
            }
            if (combatDirector?.activeArenaEvent) {
                const event = combatDirector.activeArenaEvent;
                const names={RELAY:'◎ VERİ',VAULT:'◆ KASA',STORM:'◉ FIRTINA',
                    REACTOR:'◇ REAKTÖR',CORRIDOR:'⇥ KORİDOR',ANOMALY:'◌ ANOMALİ'};
                targets.push({x:event.x,y:event.y,col:event.color,label:names[event.kind]||'ETKİNLİK'});
            }
            for (const lc of lootChests.slice(0, 2)) {
                targets.push({ x: lc.x, y: lc.y, col: '#ffe600', label: '' });
            }
            for (const cz of conduitZones.slice(0, 2)) {
                targets.push({ x: cz.x, y: cz.y, col: '#00ff66', label: '' });
            }

            for (const t of targets.slice(0, 6)) {
                const dx = t.x - player.x;
                const dy = t.y - player.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 280) continue;

                const angle = Math.atan2(dy, dx);
                const radius = Math.min(worldWidth, worldHeight) * 0.42;
                const ix = Math.max(pad, Math.min(worldWidth - pad, player.x + Math.cos(angle) * radius));
                const iy = Math.max(pad + 45, Math.min(worldHeight - pad - 45, player.y + Math.sin(angle) * radius));

                ctx.save();
                ctx.translate(ix, iy);
                ctx.rotate(angle);
                ctx.shadowBlur = getGraphicsBlur(10);
                ctx.shadowColor = t.col;
                ctx.fillStyle = t.col;
                ctx.beginPath();
                ctx.moveTo(10, 0);
                ctx.lineTo(-6, -6);
                ctx.lineTo(-3, 0);
                ctx.lineTo(-6, 6);
                ctx.closePath();
                ctx.fill();
                ctx.restore();

                if (t.label) {
                    ctx.save();
                    ctx.fillStyle = t.col;
                    ctx.font = "700 9px 'Orbitron', sans-serif";
                    ctx.textAlign = 'center';
                    ctx.fillText(t.label, ix, iy - 10);
                    ctx.restore();
                }
            }
        }

        // Graphics-only culling: never skip simulation, collision, loot or audio.
        // A padded viewport includes glow and sprite size to avoid visible popping.
        function isFxInsideViewport(x, y, radius = 0, glowMargin = 0) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
            const extent = Math.max(0, radius) + glowMargin + 8;
            return x >= -extent && x <= worldWidth + extent &&
                y >= -extent && y <= worldHeight + extent;
        }
        function drawVisibleFxCollection(items, glowMargin = 0, drawRatio = 1) {
            // Only thin cosmetic sprites. Harmful shots and collision keep full fidelity.
            const visibleSlots = Math.max(0, Math.min(10, Math.round(drawRatio * 10)));
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (i % 10 >= visibleSlots) {
                    if (performanceOverlayOn) pc3RenderCounts.skipped++;
                    continue;
                }
                if (isFxInsideViewport(item.x, item.y,
                    item.radius ?? item.size ?? 0, glowMargin)) {
                    item.draw(ctx);
                    if (performanceOverlayOn) pc3RenderCounts.visible++;
                } else if (performanceOverlayOn) {
                    pc3RenderCounts.skipped++;
                }
            }
        }

        function renderGame() {
            if (performanceOverlayOn) {
                pc3RenderCounts.visible = 0;
                pc3RenderCounts.skipped = 0;
            }
            ctx.setTransform(currentDpr * viewScale, 0, 0, currentDpr * viewScale, 0, 0);
            ctx.save();

            if (screenShake > 0) {
                const sx = (Math.random() - 0.5) * screenShake * 1.5;
                const sy = (Math.random() - 0.5) * screenShake * 1.5;
                ctx.translate(sx, sy);
            }

            drawBackgroundGrid();
            drawArenaAtmosphere();
            drawMotionBackdrop(ctx);
            drawArenaChapter(ctx);
            drawChapterShowcase(ctx);
            drawNemesisThreat(ctx);
            drawPrismGuard(ctx);
            drawBossArenaPresence(ctx);
            drawSpecialEncounterWarning();
            drawTacticalLinks();
            drawPhaseEchoes(ctx);
            drawCircuitWeaver(ctx);
            drawBastion(ctx);
            drawBossAttackTelegraphs(ctx);

            if (gameState === 'MENU') {
                for (const n of menuDemoNodes) {
                    ctx.save();
                    ctx.translate(n.x, n.y);
                    ctx.rotate(n.rot);
                    ctx.shadowBlur = 14;
                    ctx.shadowColor = n.color;
                    ctx.strokeStyle = n.color;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    for (let s = 0; s < n.sides; s++) {
                        const a = (s * Math.PI * 2) / n.sides;
                        if (s === 0) ctx.moveTo(Math.cos(a) * n.r, Math.sin(a) * n.r);
                        else ctx.lineTo(Math.cos(a) * n.r, Math.sin(a) * n.r);
                    }
                    ctx.closePath();
                    ctx.stroke();
                    ctx.restore();
                }
            }

            drawQuestObjective(ctx);
            drawFieldDevices(ctx);
            for (const cz of conduitZones) cz.draw(ctx);
            if (combatDirector?.activeArenaEvent) combatDirector.activeArenaEvent.draw(ctx);
            for (const sw of shockwaves) sw.draw(ctx);
            drawMotionFx(ctx);
            for (const vfx of bossDeathVfx) drawBossDeathVfx(ctx,vfx);
            // A glow cannot affect visible pixels if its entire padded area
            // falls outside the canvas. Keep critical boss/beam/warning art uncullable.
            drawVisibleFxCollection(orbs, 22);
            drawVisibleFxCollection(lootChests, 32);
            drawVisibleFxCollection(powerups, 28);
            drawVisibleFxCollection(particles, 12, getGraphicsPreset().particleDrawRatio);
            drawVisibleFxCollection(enemyProjectiles, 20);
            const denseVolley = bullets.length > 150;
            for (const b of bullets) b.draw(ctx, denseVolley);
            drawWeaponImpacts();

            drawLightningArcs();

            for (const e of enemies) e.draw(ctx);
            drawNemesisIdentity(ctx);

            if (player && player.lockedTarget && !player.lockedTarget.dead && gameState === 'PLAYING') {
                const lt = player.lockedTarget;
                ctx.save();
                ctx.translate(lt.x, lt.y);
                ctx.rotate(totalTime * 3.5);
                ctx.strokeStyle = 'rgba(0, 243, 255, 0.75)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.arc(0, 0, lt.radius + 9, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            if (player) player.draw(ctx);
            drawOffscreenIndicators();

            for (const ft of floatingTexts) {
                // Text extends farther than a disc, so leave a conservative
                // 160px margin instead of clipping notifications at the edge.
                if (!isFxInsideViewport(ft.x, ft.y, 0, 160)) {
                    if (performanceOverlayOn) pc3RenderCounts.skipped++;
                    continue;
                }
                if (performanceOverlayOn) pc3RenderCounts.visible++;
                ctx.save();
                ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
                ctx.font = `700 ${ft.size}px 'Orbitron', sans-serif`;
                ctx.fillStyle = ft.color;
                ctx.textAlign = 'center';
                ctx.shadowBlur = getGraphicsBlur(6);
                ctx.shadowColor = ft.color;
                ctx.fillText(ft.text, ft.x, ft.y);
                ctx.restore();
            }

            ctx.restore();
        }

        function formatTime(sec) {
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = Math.floor(sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        }

        function getComboRank(c) {
            if (c >= 50) return { label: 'SİBER TANRI!', col: '#ff007f' };
            if (c >= 30) return { label: 'SSS', col: '#ffe600' };
            if (c >= 20) return { label: 'SS', col: '#00f3ff' };
            if (c >= 12) return { label: 'S', col: '#00ff66' };
            if (c >= 8) return { label: 'A', col: '#a855f7' };
            if (c >= 5) return { label: 'B', col: '#38bdf8' };
            if (c >= 3) return { label: 'C', col: '#94a3b8' };
            return { label: 'D', col: '#64748b' };
        }


        const MENU_CHASSIS_DETAILS = {
            VANGUARD: {
                title: 'ÖNCÜ · DENGELİ', difficulty: 'KOLAY',
                detail: 'İlk saldırıları %12 güçlendirir ve bir ek ücretsiz diriliş hakkı verir. Güvenli büyümek isteyen oyuncular için.',
                advice: 'ÖNERİ · Önce silah ve savunma modülü seç.',
                color: '#00f3ff'
            },
            PHANTOM: {
                title: 'HAYALET · ÇEVİK', difficulty: 'ORTA',
                detail: '%15 daha hızlı hareket eder, kritik şansına 15 yüzde puanı ekler. Atılım beklemesi %20 kısadır; mermi delme ve sekme bonusu ile başlar.',
                advice: 'ÖNERİ · Kritik ve sekme sinerjisini hedefle.',
                color: '#ff007f'
            },
            TITAN: {
                title: 'TİTAN · DAYANIKLI', difficulty: 'KOLAY',
                detail: '50 ek can, aktif enerji kalkanı ve bir uydu ile başlar. Yakın düşman baskısına karşı savunma odaklı ilerlemek için.',
                advice: 'ÖNERİ · Uydu ve kalkan modüllerini geliştir.',
                color: '#00ff66'
            }
        };
        function refreshSelectedChassisDetails() {
            const info = MENU_CHASSIS_DETAILS[selectedChassis] || MENU_CHASSIS_DETAILS.VANGUARD;
            const assign = (id, value) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            };
            assign('menuChassisDetailTitle', info.title);
            assign('menuChassisDetail', info.detail);
            assign('menuChassisDifficulty', 'ZORLUK · ' + info.difficulty);
            assign('menuChassisAdvice', info.advice);
            const preview = document.getElementById('menuCorePreview');
            if (preview) {
                preview.style.borderColor = info.color;
                preview.style.color = info.color;
            }
        }

        function renderNeonContractOptions() {
            const container = document.getElementById('neonContractOptions');
            if (!container) return;
            container.innerHTML = getNeonContractList().map(contract => {
                const mastery = contractMastery.contracts[contract.id];
                const tier = getContractMasteryTier(mastery);
                return `<button type="button" class="neon-contract-card mastery-tier-${tier} rounded-lg p-2.5 text-left${contract.id === selectedContractId ? ' is-selected' : ''}" data-neon-contract="${contract.id}" aria-pressed="${contract.id === selectedContractId ? 'true' : 'false'}" style="--contract-color:${contract.color}" title="EN İYİ SKOR ${mastery.bestScore} · EN UZUN ${Math.round(mastery.bestDurationSeconds)}s">
                    <div class="flex items-center justify-between gap-2"><strong class="font-cyber text-[10px]" style="color:${contract.color}">${contract.label}</strong><span class="text-[9px] text-gray-400">${contract.short}</span></div>
                    <p class="text-[10px] text-gray-300 leading-snug mt-1.5">${contract.desc}</p>
                    <div class="contract-mastery-line" style="color:${contract.color}">USTALIK ${tier}/3 · DALGA ${mastery.bestWave} · ${mastery.runs} KOŞU</div>
                </button>`;
            }).join('');
            for (const card of container.querySelectorAll?.('[data-neon-contract]') || []) {
                card.addEventListener('click', () => {
                    selectNeonContract(card.getAttribute('data-neon-contract'));
                    renderNeonContractOptions();
                });
            }
        }

        function updateMenuCounters() {
            document.getElementById('menuHighScore').textContent = savedHighScore.toLocaleString('tr-TR');
            document.getElementById('menuMaxWave').textContent = savedMaxWave;
            document.getElementById('menuGoldText').textContent = totalGold.toLocaleString('tr-TR');
            document.getElementById('shopGoldBalance').textContent = totalGold.toLocaleString('tr-TR');
            refreshSelectedChassisDetails();
            renderNeonContractOptions();

            const summaryEl = document.getElementById('menuLoadoutSummary');
            if (summaryEl) {
                const base = metaUpgrades.baseDamage || 0;
                const hpTotal = 100 + (metaUpgrades.maxHp || 0) * 18 +
                    (selectedChassis === 'TITAN' ? 50 : 0);
                const dmgPct = Math.round(100 * ((1 + base * 0.08) *
                    (selectedChassis === 'VANGUARD' ? 1.12 : 1) - 1));
                const critPct = Math.round(100 * (0.04 + base * 0.012 +
                    (selectedChassis === 'PHANTOM' ? 0.15 : 0)));
                const revives = 1 + (metaUpgrades.defibrillator || 0) +
                    (selectedChassis === 'VANGUARD' ? 1 : 0);
                const cards = [
                    { title:'SALDIRI', value:'+' + dmgPct + '% başlangıç hasarı',
                      detail:'Kritik şansı · ' + critPct + '%', color:'pink' },
                    { title:'DAYANIKLILIK', value:hpTotal + ' toplam can',
                      detail:selectedChassis === 'TITAN' ? 'Kalkan ve uydu hazır' : 'Kalkan modülle açılır',
                      color:'emerald' },
                    { title:'GÜVENLİK', value:revives + ' diriliş hakkı',
                      detail:'Can bittiğinde koşuyu kurtarır', color:'cyan' }
                ];
                summaryEl.innerHTML = cards.map(item =>
                    `<div class="min-w-0 bg-gray-900/75 border border-gray-700/50 rounded-lg p-2.5">
                        <div class="font-cyber text-[10px] text-gray-400">${item.title}</div>
                        <div class="font-bold text-${item.color}-300 text-xs mt-1">${item.value}</div>
                        <div class="text-[10px] text-gray-400 mt-1">${item.detail}</div>
                    </div>`).join('');
            }
        }

        // Cache source values, not serialized DOM strings: browsers can normalize
        // CSS gradients and inline style markup on readback.
        let lastBossGradientColor = null;
        let lastBossIdentityMarkup = null;
        function renderBossIdentityRows(bosses) {
            const escape = value => String(value ?? '').replace(/[&<>\"']/g, ch =>
                ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
            return (bosses || []).filter(b => b && !b.dead).map(b => {
                const hp = Math.max(0, Number(b.hp) || 0);
                const maxHp = Math.max(1, Number(b.maxHp) || 1);
                const pct = Math.max(0, Math.min(100, Math.round(hp / maxHp * 100)));
                const tag = escape(b.bossVisual?.tag || b.bossName || 'BOSS');
                const color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : '#ff5268';
                const target = player?.lockedTarget === b;
                const targetText = target ? ' · TARGET' : '';
                return '<span class="boss-id-chip" data-boss-id="'+escape(b.id ?? tag)+
                    '" data-target="'+target+'" aria-current="'+(target?'true':'false')+
                    '" aria-label="'+tag+', Faz '+(b.bossPhase || 1)+', HP '+Math.ceil(hp)+' / '+
                    Math.round(maxHp)+'" style="color:'+color+';border-color:'+color+'">'+
                    '<span class="boss-id-head"><strong>'+tag+' · F'+(b.bossPhase || 1)+
                    '</strong><span class="boss-id-hp">'+Math.ceil(hp)+'/'+Math.round(maxHp)+targetText+'</span></span>'+
                    '<span class="boss-id-meter"><span class="boss-id-fill" style="width:'+pct+'%;background:'+color+'"></span></span></span>';
            }).join('');
        }

        function getBossIdentityKey(bosses) {
            return (bosses || []).filter(b => b && !b.dead).map(b =>
                [b.id ?? b.bossName, b.bossVisual?.tag, b.bossPhase || 1,
                    b.color, player?.lockedTarget === b].join(':')).join('|');
        }

        function updateBossIdentityRows(bosses) {
            const strip = document.getElementById('bossIdentityStrip');
            if (!strip?.querySelectorAll) return;
            for (const b of (bosses || []).filter(x => x && !x.dead)) {
                const row = strip.querySelector('[data-boss-id="'+String(b.id ?? b.bossName).replace(/\"/g, '')+'"]');
                if (!row) continue;
                const hp = Math.max(0, Number(b.hp) || 0);
                const maxHp = Math.max(1, Number(b.maxHp) || 1);
                const pct = Math.max(0, Math.min(100, Math.round(hp / maxHp * 100)));
                const hpText = row.querySelector('.boss-id-hp');
                const fill = row.querySelector('.boss-id-fill');
                if (hpText) hpText.textContent = Math.ceil(hp)+'/'+Math.round(maxHp)+(player?.lockedTarget === b ? ' · TARGET' : '');
                if (fill) fill.style.width = pct+'%';
                row.setAttribute('aria-label', (b.bossVisual?.tag || b.bossName || 'BOSS')+', Faz '+(b.bossPhase || 1)+', HP '+Math.ceil(hp)+' / '+Math.round(maxHp));
            }
        }

        function updateTacticalHint() {
            const badge = document.getElementById('tacticalHintBadge');
            if (!badge) return;
            const hint = getTacticalHintState();
            if (!hint) {
                badge.textContent = '';
                badge.classList.add('hidden');
                return;
            }
            badge.textContent = hint.text;
            badge.style.color = hint.color;
            badge.style.borderColor = hint.color;
            badge.title = hint.kind === 'guard' ? 'Önce Shield Bearer düşürülürse menzilli tehdit açığa çıkar.' :
                'Flank düşmanları aynı çizgide değil, farklı açılardan yaklaşır.';
            badge.classList.remove('hidden');
        }

        function updateHUD() {
            if (!player) return;

            const contract = getActiveNeonContract();
            const contractBadge = document.getElementById('activeContractBadge');
            if (contractBadge) {
                contractBadge.textContent = contract.id;
                contractBadge.style.borderColor = contract.color;
                contractBadge.style.color = contract.color;
                contractBadge.title = contract.label + ' · ' + contract.desc;
            }
            updateTacticalHint();
            updateArenaChapterHud();
            updateNemesisHud();
            updatePrismGuardHud();
            updateFieldDeviceHud();

            const xpPct = Math.min(100, (player.xp / player.xpToNext) * 100);
            document.getElementById('xpBar').style.width = `${xpPct}%`;
            document.getElementById('levelText').textContent = player.level;
            document.getElementById('xpText').textContent = `${Math.floor(player.xp)} / ${player.xpToNext}`;

            const momPct = Math.min(100, Math.round(player.momentum));
            document.getElementById('momentumBar').style.width = `${momPct}%`;
            const momText = document.getElementById('momentumText');
            if (momPct >= 80) {
                momText.textContent = `MOMENTUM · %${momPct}`;
            } else {
                momText.textContent = `MOMENTUM · %${momPct}`;
            }

            const odPct = Math.min(100, player.overdrive);
            document.getElementById('overdriveBar').style.width = `${odPct}%`;
            const odText = document.getElementById('overdriveText');
            if (player.overdriveActive) {
                odText.textContent = `CİNNET · ${player.overdriveTimer.toFixed(1)}s`;
            } else {
                odText.textContent = `CİNNET · %${Math.floor(odPct)}`;
            }

            const hpPct = Math.max(0, (player.hp / player.maxHp) * 100);
            // M5.25: the cockpit changes priority with actual combat state.
            // Dataset updates only on transitions, not every HUD refresh.
            const cockpit=document.getElementById('hud');
            const vital=hpPct<=30&&hpPct>0?'critical':
                hpPct<=55?'wounded':'steady';
            const alert=activeBosses.some(b=>!b.dead)?'boss':
                combatDirector?.profile?.phase==='WARNING'?'warning':
                player.overdriveActive?'overdrive':'patrol';
            if(cockpit.dataset.vital!==vital)cockpit.dataset.vital=vital;
            if(cockpit.dataset.combatAlert!==alert)cockpit.dataset.combatAlert=alert;
            document.getElementById('hpBar').style.width = `${hpPct}%`;
            document.getElementById('hpText').textContent = `${Math.ceil(player.hp)}/${player.maxHp}`;

            const lowHpOverlay = document.getElementById('lowHpOverlay');
            if (hpPct > 0 && hpPct <= 30) {
                lowHpOverlay.classList.remove('hidden');
            } else {
                lowHpOverlay.classList.add('hidden');
            }

            const reviveCountEl = document.getElementById('reviveCountText');
            if (reviveCountEl) {
                reviveCountEl.textContent = `${player.freeRevives}x`;
            }

            document.getElementById('goldHudText').textContent = totalGold.toLocaleString('tr-TR');
            updateBastionHud();
            for(const [id,ready] of [
                ['bastionBtn',!document.getElementById('bastionBtn').disabled],
                ['novaBtn',player.novaCooldown<=0],
                ['prismBtn',totalTime>=prismGuardReadyAt&&!prismActive()],
                ['dashBtn',player.dashCooldown<=0&&!player.isDashing]
            ]){
                const button=document.getElementById(id);
                const next=ready?'true':'false';
                if(button.dataset.ready!==next)button.dataset.ready=next;
            }

            const shieldInd = document.getElementById('shieldIndicator');
            const shieldTxt = document.getElementById('shieldText');
            if (player.hasShield) {
                shieldInd.classList.remove('hidden');
                shieldInd.classList.add('flex');
                if (player.shieldActive) {
                    shieldTxt.textContent = 'AKTİF';
                    shieldInd.className = 'flex items-center gap-1 text-cyan-400 border-l border-gray-700 pl-2 text-xs sm:text-sm font-bold';
                } else {
                    shieldTxt.textContent = `${Math.ceil(player.shieldCooldown)}s`;
                    shieldInd.className = 'flex items-center gap-1 text-gray-500 border-l border-gray-700 pl-2 text-xs sm:text-sm font-bold';
                }
            } else {
                shieldInd.classList.add('hidden');
            }

            document.getElementById('waveText').textContent = wave;
            document.getElementById('timeText').textContent = formatTime(totalTime);
            const phaseEl = document.getElementById('directorPhaseText');
            if (phaseEl && combatDirector) phaseEl.textContent = combatDirector.profile.label;
            document.getElementById('scoreText').textContent = score.toLocaleString('tr-TR');
            for(const [id,value] of [
                ['xpBar',xpPct],['momentumBar',momPct],
                ['overdriveBar',odPct],['hpBar',hpPct]
            ]){
                const bar=document.getElementById(id);
                const next=String(Math.round(value));
                if(bar.getAttribute('aria-valuenow')!==next)
                    bar.setAttribute('aria-valuenow',next);
            }

            const comboContainer = document.getElementById('comboContainer');
            if (combo > 1) {
                comboContainer.classList.remove('hidden');
                comboContainer.classList.add('flex');
                document.getElementById('comboText').textContent = `x${combo}`;
                const rankInfo = getComboRank(combo);
                const rankEl = document.getElementById('comboRankText');
                rankEl.textContent = rankInfo.label;
                rankEl.style.color = rankInfo.col;
                const timerPct = Math.max(0, (comboTimer / COMBO_MAX_TIME) * 100);
                document.getElementById('comboTimerBar').style.width = `${timerPct}%`;
            } else {
                comboContainer.classList.add('hidden');
                comboContainer.classList.remove('flex');
            }

            if (activeBosses.length > 0) {
                let totalHp = 0;
                let totalMaxHp = 0;
                const names = [];
                for (const b of activeBosses) {
                    if (!b.dead) {
                        totalHp += Math.max(0, b.hp);
                        totalMaxHp += b.maxHp;
                        names.push(b.bossName);
                    }
                }
                const bPct = totalMaxHp > 0 ? Math.max(0, (totalHp / totalMaxHp) * 100) : 0;
                document.getElementById('bossHpBar').style.width = `${bPct}%`;
                document.getElementById('bossHpText').textContent = `${Math.ceil(totalHp)} / ${Math.round(totalMaxHp)}`;
                const nameEl = document.getElementById('bossNameText');
                if (nameEl) {
                    nameEl.textContent = activeBosses.length>1
                        ? '⚠ ÇOKLU BOSS · '+activeBosses.length+' HEDEF'
                        : '⚠ '+names.join(' + ');
                }
                const living=activeBosses.filter(b=>!b.dead);
                const primary=living[0];
                const color=living.length>1?'#ff738f':(primary?.color||'#ff0055');
                const hud=document.getElementById('bossHudContainer');
                hud.style.borderColor=color;
                const hpBar=document.getElementById('bossHpBar');
                if (lastBossGradientColor !== color) {
                    hpBar.style.background = 'linear-gradient(90deg,#630e28,'+color+' 72%,#eaffff)';
                    lastBossGradientColor = color;
                }
                if(nameEl && nameEl.style.color!==color)nameEl.style.color=color;
                const phaseEl=document.getElementById('bossPhaseText');
                if(phaseEl)phaseEl.textContent=living.length>1?'FAZLAR AYRI':
                    'FAZ '+(primary?.bossPhase||1)+' / 3';
                const strip=document.getElementById('bossIdentityStrip');
                if (strip) {
                    const identityKey = getBossIdentityKey(living);
                    if (lastBossIdentityMarkup !== identityKey) {
                        strip.innerHTML = renderBossIdentityRows(living);
                        lastBossIdentityMarkup = identityKey;
                    } else updateBossIdentityRows(living);
                }
            }

            const dashPct = (player.dashCooldown / player.dashMaxCooldown) * 100;
            document.getElementById('dashCooldownOverlay').style.height = `${dashPct}%`;
            const dashStatus = document.getElementById('dashStatus');
            if (player.dashCooldown <= 0) {
                dashStatus.textContent = 'HAZIR';
                const nextDashClass = 'font-cyber text-xs font-bold text-green-400 relative z-10';
                if (dashStatus.className !== nextDashClass) dashStatus.className = nextDashClass;
            } else {
                dashStatus.textContent = `${player.dashCooldown.toFixed(1)}s`;
                const nextDashClass = 'font-cyber text-xs font-bold text-cyan-300 relative z-10';
                if (dashStatus.className !== nextDashClass) dashStatus.className = nextDashClass;
            }

            const novaPct = (player.novaCooldown / player.novaMaxCooldown) * 100;
            document.getElementById('novaCooldownOverlay').style.height = `${novaPct}%`;
            const novaStatus = document.getElementById('novaStatus');
            if (player.novaCooldown <= 0) {
                novaStatus.textContent = 'HAZIR';
                const nextNovaClass = 'font-cyber text-xs font-bold text-green-400 relative z-10';
                if (novaStatus.className !== nextNovaClass) novaStatus.className = nextNovaClass;
            } else {
                novaStatus.textContent = `${player.novaCooldown.toFixed(1)}s`;
                const nextNovaClass = 'font-cyber text-xs font-bold text-purple-300 relative z-10';
                if (novaStatus.className !== nextNovaClass) novaStatus.className = nextNovaClass;
            }
        }

        function updateModulesDock() {
            const dock = document.getElementById('hudModulesDock');
            if (!dock || !player) return;
            updateBuildGuide();
            const entries = Object.entries(player.upgradeCounts);
            if (entries.length === 0) {
                dock.innerHTML = `<span class="text-[10px] font-cyber text-gray-500 px-1">HENÜZ MODÜL YOK</span>`;
                return;
            }
            dock.innerHTML = entries.map(([id, count]) => {
                const upg = UPGRADES_POOL.find(u => u.id === id);
                if (!upg) return '';
                const isEvolved = count >= 3 && !!EVOLUTION_DEFS[id];
                return `
                    <div title="${upg.name} · K${count}${isEvolved ? ' · ' + EVOLUTION_DEFS[id].name : ''}" class="flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-cyber font-bold" style="border-color:${isEvolved ? '#ffe600' : upg.color}; color:${isEvolved ? '#ffe600' : '#fff'}; background:rgba(0,0,0,0.6);">
                        <i class="${upg.icon}" style="color:${upg.color}"></i>
                        <span>${isEvolved ? '★' + count : count}</span>
                    </div>
                `;
            }).join('') + SYNERGY_DEFS.filter(syn => player.synergies.has(syn.id))
                .map(syn => `<span title="${syn.desc}" class="px-2 py-0.5 text-xs font-cyber text-cyan-200 border border-cyan-500 rounded-lg bg-cyan-950/60">✦ ${syn.name}</span>`)
                .join('');
        }

        function startNewGame() {
            clearGameplayInput();
            resetPc3Telemetry();
            resetEnemyCrowdSteering();
            resetChapterBiome();
            resetMotionFx();
            resetFieldDevices();
            resetNemesis();
            resetPrismGuard();
            phaseEchoes = [];
            circuitField = null;
            circuitFlash = null;
            bastion = null;
            bastionReadyAt = 0;
            bastionUses = 0;
            bastionGoldSpent = 0;
            bastionShotsBlocked = 0;
            activeContractId = selectedContractId;
            contractMasteryRecordedThisRun = false;
            lastBossGradientColor = null;
            lastBossIdentityMarkup = null;
            audio.init();
            resizeCanvas();
            player = new Player(worldWidth / 2, worldHeight / 2);
            bullets = [];
            enemyProjectiles = [];
            enemies = [];
            orbs = [];
            pendingMetaSave = false;
            lootChests = [];
            powerups = [];
            conduitZones = [];
            particles = [];
            floatingTexts = [];
            shockwaves = [];
            lightningBolts = [];
            lightningArcSequence = 0;
            weaponImpacts = [];
            weaponImpactFrameCount = 0;
            bossDeathVfx = [];

            score = 0;
            sessionGold = 0;
            combo = 1;
            comboTimer = 0;
            wave = 1;
            waveTimer = 0;
            totalTime = 0;
            nextBossTime = 55;
            bossEncounterCount = 0;
            combatDirector = new CombatDirector();
            activeBosses = [];
            manualBossTarget = null;
            bossWarningTimer = 0;
            kills = 0;
            spawnTimer = 0.5;
            conduitSpawnTimer = 3.0;
            hudRefreshAccumulator = 0;
            bulletCollisionGrid.clear();
            hitStopTimer = 0;
            slowMoTimer = 0;
            rerollCost = 15;
            dyingSequenceTimer = 0;
            reviveCountUsed = 0;
            paidRevivesUsed = 0;
            runMetrics={peakCombo:1,damageTaken:0,hitsTaken:0,shieldBlocks:0,
                freeRevivesUsed:0,paidReviveGoldSpent:0,paidRevivesUsed:0};
            finalRunReport=null;
            activeReportTab='summary';
            questHistory=[];
            questStats={offered:0,completed:0,byType:{},hitsReset:0};
            questHudPrevious='';
            generateNextQuest();

            document.getElementById('overdriveOverlay').classList.add('hidden');
            document.getElementById('lowHpOverlay').classList.add('hidden');
            document.getElementById('killstreakBanner').classList.add('hidden');
            document.getElementById('bossHudContainer').classList.add('hidden');
            document.getElementById('bossHudContainer').classList.remove('flex');
            document.getElementById('bossWarningBanner').classList.add('hidden');
            document.getElementById('startModal').classList.add('hidden');
            document.getElementById('reviveModal').classList.add('hidden');
            document.getElementById('reviveModal').classList.remove('flex');
            document.getElementById('gameOverModal').classList.add('hidden');
            document.getElementById('gameOverModal').classList.remove('flex');
            document.getElementById('pauseModal').classList.add('hidden');
            document.getElementById('pauseModal').classList.remove('flex');
            document.getElementById('upgradeModal').classList.add('hidden');
            document.getElementById('upgradeModal').classList.remove('flex');
            document.getElementById('shopModal').classList.add('hidden');
            document.getElementById('shopModal').classList.remove('flex');

            document.getElementById('hud').classList.remove('hidden');
            gameState = 'PLAYING';
            updateModulesDock();
            updateHUD();
        }

        function selectUpgradeOption(index) {
            if (gameState !== 'LEVEL_UP' || !currentUpgradeChoices[index]) return;
            const { upg, rarity } = currentUpgradeChoices[index];
            const currentLvl = player.upgradeCounts[upg.id] || 0;
            const nextLvl = currentLvl + 1;
            const newlyUnlockedSynergies = newSynergiesForUpgrade(player.upgradeCounts, upg.id);

            if (currentLvl >= MAX_MODULE_TIER) return;
            upg.apply(player, rarity);
            player.upgradeCounts[upg.id] = nextLvl;
            normalizePlayerBuildPower(player);
            player.refreshBuildTraits();

            if (nextLvl === 3 && EVOLUTION_DEFS[upg.id]) {
                audio.playJackpot();
                showDopamineBanner(`✦ MODÜL EVRİMİ: ${EVOLUTION_DEFS[upg.id].name.toUpperCase()} ✦`, '#ab83ff');
            }
            if (newlyUnlockedSynergies.length) {
                audio.playJackpot();
                showDopamineBanner(`★ SİNERJİ: ${newlyUnlockedSynergies.map(s => s.name.toUpperCase()).join(' + ')} ★`, '#00f3ff');
            }

            document.getElementById('upgradeModal').classList.add('hidden');
            document.getElementById('upgradeModal').classList.remove('flex');
            gameState = 'PLAYING';
            const isEvolutionReward = nextLvl === MAX_MODULE_TIER && !!EVOLUTION_DEFS[upg.id];
            shockwaves.push(new Shockwave(player.x, player.y, 170,
                isEvolutionReward && rarity.id !== 'LEGENDARY' ? '#ab83ff' : rarity.border, 0.4));
            createFloatingText(player.x, player.y - 30, `${upg.name} · K${nextLvl}`, rarity.textCol, 17);
            updateModulesDock();
            updateHUD();
            // A collected stacked orb may grant more than one full level.
            // Queue additional choices one at a time without discarding earned XP.
            if (player.xp >= player.xpToNext) player.gainXp(0);
        }


        // Visual role (evolution, weapon, module) and rarity are independent axes.
        // No extra item rolls, unlock conditions, or power calculations.
        const WEAPON_UPGRADE_IDS = new Set([
            'multishot','firerate','orbital','pierce_ricochet',
            'homing','lightning','crit_mastery','phase_echo','circuit_weaver'
        ]);
        function getUpgradeCardPresentation(upg, rarity, currentLvl) {
            const willEvolve=currentLvl+1===MAX_MODULE_TIER && !!EVOLUTION_DEFS[upg.id];
            const role=willEvolve?'evolution':WEAPON_UPGRADE_IDS.has(upg.id)?'weapon':'module';
            const labels={evolution:'EVRİM EŞİĞİ',weapon:'SİLAH MODÜLÜ',module:'SİSTEM MODÜLÜ'};
            const icons={evolution:'fa-solid fa-atom',weapon:'fa-solid fa-crosshairs',module:'fa-solid fa-microchip'};
            return {role,label:labels[role],roleIcon:icons[role],willEvolve,
                isLegendary:rarity.id==='LEGENDARY'};
        }

        // Cosmetic map only; rarity roll weights and power stay in RARITIES.
        const UPGRADE_RARITY_MOTIFS=Object.freeze({
            COMMON:Object.freeze({icon:'fa-solid fa-seedling',tag:'YAYGIN'}),
            RARE:Object.freeze({icon:'fa-solid fa-gem',tag:'NADİR'}),
            EPIC:Object.freeze({icon:'fa-solid fa-star-of-life',tag:'DESTANSI'}),
            LEGENDARY:Object.freeze({icon:'fa-solid fa-crown',tag:'EFSANEVİ'})
        });
        function renderUpgradeCardMarkup(upg,rarity,currentLvl,index,presentation,unlocks) {
            const {role,label,roleIcon,willEvolve,isLegendary}=presentation;
            const rarityMotif=UPGRADE_RARITY_MOTIFS[rarity.id] || UPGRADE_RARITY_MOTIFS.COMMON;
            const tiers=Array.from({length:MAX_MODULE_TIER},(_,i)=>
                `<span class="upgrade-tier-step ${i<currentLvl?'filled':i===currentLvl?'next':''}"></span>`).join('');
            const evolution=willEvolve?EVOLUTION_DEFS[upg.id]:null;
            return `
                <span class="upgrade-rarity-band" aria-hidden="true"></span>
                <span class="upgrade-rarity-crown" aria-hidden="true"></span>
                ${role==='evolution'?'<span class="upgrade-evolution-orbit" aria-hidden="true"></span>':''}
                ${role==='weapon'?'<span class="upgrade-weapon-brackets" aria-hidden="true"></span><span class="upgrade-weapon-scan" aria-hidden="true"></span>':''}
                <div class="upgrade-card-body">
                    <div class="upgrade-card-header">
                        <div class="upgrade-icon" aria-hidden="true"><i class="${upg.icon}"></i></div>
                        <div class="upgrade-card-labels">
                            <span class="upgrade-rarity-label">
                                <span class="upgrade-rarity-gem" aria-hidden="true"><i class="${rarityMotif.icon}"></i></span>
                                <span class="upgrade-rarity-title">[${index+1}] ${isLegendary?'✦ ':''}${rarityMotif.tag}</span>
                            </span>
                            <span class="upgrade-role-label"><i class="${roleIcon}"></i>${label}</span>
                        </div>
                    </div>
                    <h3 class="upgrade-card-name font-cyber font-black">${upg.name}</h3>
                    <p class="upgrade-card-desc">${upg.getDesc(rarity)}</p>
                    <div class="upgrade-card-tier-row">
                        <span class="upgrade-card-tier-label">KADEME ${currentLvl} → ${currentLvl+1}</span>
                        <span class="upgrade-tier-track" aria-label="${currentLvl} / ${MAX_MODULE_TIER} kademe">${tiers}</span>
                    </div>
                    ${evolution?`<div class="upgrade-evolution-benefit">
                        <strong class="upgrade-bonus-heading block mb-1 text-purple-200">✦ ${evolution.name}</strong>
                        ${evolution.desc}
                    </div>`:''}
                    ${unlocks.map(s=>`<p class="upgrade-synergy-benefit"><strong>YENİ SİNERJİ:</strong> ${s.name} · ${s.desc}</p>`).join('')}
                </div>
                <div class="upgrade-card-footer flex items-center justify-between gap-2 font-bold">
                    <span>${role==='evolution'?'[ '+(index+1)+' ] EVRİMİ AÇ':
                        role==='weapon'?'[ '+(index+1)+' ] SİLAHI GÜÇLENDİR':
                        '[ '+(index+1)+' ] MODÜLÜ ENTEGRE ET'}</span>
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </div>`;
        }

        // In-place Fisher-Yates avoids the biased/non-transitive random sort comparator.
        // Callers provide a new array, so the canonical upgrade pool keeps its order.
        function shuffleInPlace(items) {
            for (let i = items.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [items[i], items[j]] = [items[j], items[i]];
            }
            return items;
        }

        function populateUpgradeCards() {
            const shuffled = shuffleInPlace(UPGRADES_POOL.filter(u =>
                (player.upgradeCounts[u.id] || 0) < MAX_MODULE_TIER));
            // Keep one near-evolution module visible when possible without removing choice.
            const ready = shuffled.filter(u => (player.upgradeCounts[u.id] || 0) === 2 &&
                EVOLUTION_DEFS[u.id]);
            const featured = ready[0] || null;
            const choices = (featured ?
                [featured, ...shuffled.filter(u => u.id !== featured.id)] : shuffled).slice(0, 3);
            currentUpgradeChoices = [];

            const statsBar = document.getElementById('upgradeStatsSummary');
            if (statsBar && player) {
                statsBar.innerHTML = `
                    <div>HASAR: <span class="text-pink-400 font-bold">${Math.round(player.damage)}</span></div>
                    <div>KRİTİK: <span class="text-sky-300 font-bold">%${Math.round(player.critChance * 100)}</span></div>
                    <div>ÇOKLU ATIŞ: <span class="text-cyan-300 font-bold">${player.multishot}x</span></div>
                    <div>DELİCİ/SEKME: <span class="text-purple-400 font-bold">${player.pierce}/${player.ricochet}</span></div>
                    <div>UYDU: <span class="text-green-400 font-bold">${player.orbitals}</span></div>
                `;
            }

            const container = document.getElementById('upgradeCardsContainer');
            container.innerHTML = '';

            const rerollBtn = document.getElementById('rerollUpgradesBtn');
            document.getElementById('rerollCostText').textContent = rerollCost;
            rerollBtn.disabled = totalGold < rerollCost;
            rerollBtn.style.opacity = totalGold < rerollCost ? '0.45' : '1';

            choices.forEach((upg, idx) => {
                const rarity = rollRarity();
                currentUpgradeChoices.push({ upg, rarity });
                const currentLvl = player.upgradeCounts[upg.id] || 0;
                const unlocks = newSynergiesForUpgrade(player.upgradeCounts, upg.id);
                const presentation=getUpgradeCardPresentation(upg,rarity,currentLvl);
                const card=document.createElement('button');
                card.type='button';
                card.className='upgrade-card rounded-2xl text-left flex flex-col justify-between cursor-pointer group relative';
                card.setAttribute('data-role',presentation.role);
                card.setAttribute('data-rarity',rarity.id);
                card.setAttribute('aria-label',
                    `Seçenek ${idx+1}: ${rarity.name} ${upg.name}. ${presentation.label}. Kademe ${currentLvl+1}`);
                card.setAttribute('aria-keyshortcuts',String(idx+1));
                card.style.animationDelay=`${idx*65}ms`;
                card.innerHTML=renderUpgradeCardMarkup(upg,rarity,currentLvl,idx,presentation,unlocks);

                card.addEventListener('click', () => selectUpgradeOption(idx));
                container.appendChild(card);
            });
        }

        function triggerLevelUp() {
            if (UPGRADES_POOL.every(u => (player.upgradeCounts[u.id] || 0) >= MAX_MODULE_TIER)) {
                // Endless play stays playable after all module tiers; no empty choice modal.
                player.hp = Math.min(player.maxHp, player.hp + 20);
                player.addOverdrive(20);
                createFloatingText(player.x, player.y - 30, 'TÜM MODÜLLER TAM · +20 CAN', '#00ff88', 15);
                return;
            }
            gameState = 'LEVEL_UP';
            audio.playLevelUp();
            populateUpgradeCards();
            const modal = document.getElementById('upgradeModal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        document.getElementById('rerollUpgradesBtn').addEventListener('click', () => {
            if (totalGold < rerollCost) return;
            totalGold -= rerollCost;
            rerollCost += 10;
            saveMetaProgress();
            audio.playOrbPickup(5, true);
            populateUpgradeCards();
            updateHUD();
        });

        function togglePause() {
            if (gameState === 'PLAYING') {
                clearGameplayInput();
                gameState = 'PAUSED';
                const modal = document.getElementById('pauseModal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            } else if (gameState === 'PAUSED') {
                gameState = 'PLAYING';
                const modal = document.getElementById('pauseModal');
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        }

        function initiateDeathSequence() {
            if (gameState === 'DYING_SEQUENCE' || gameState === 'REVIVE_PROMPT' || gameState === 'GAME_OVER') return;
            gameState = 'DYING_SEQUENCE';
            dyingSequenceTimer = 1.05;
            screenShake = 22;
            audio.playExplosion(true);
            shockwaves.push(new Shockwave(player.x, player.y, 260, '#ff0055', 0.65));
            createFloatingText(player.x, player.y - 30, '⚠ KRİTİK ÇEKİRDEK HATASI! ⚠', '#ff0055', 20);
        }

        function showRevivePromptOrGameOver() {
            const goldReviveCost = 30 + paidRevivesUsed * 35;
            const canUseFree = player.freeRevives > 0;
            const canAffordGold = paidRevivesUsed < 2 && totalGold >= goldReviveCost;

            if (canUseFree || canAffordGold) {
                gameState = 'REVIVE_PROMPT';
                document.getElementById('reviveScoreText').textContent = score.toLocaleString('tr-TR');
                document.getElementById('reviveGoldText').textContent = totalGold.toLocaleString('tr-TR');
                document.getElementById('reviveFreeChargesText').textContent = canUseFree ? `${player.freeRevives} ÜCRETSİZ` : `${goldReviveCost} ALTIN`;

                const confirmBtn = document.getElementById('confirmReviveBtn');
                if (canUseFree) {
                    confirmBtn.innerHTML = `DİRİL · ${player.freeRevives} HAK · BOŞLUK`;
                } else {
                    confirmBtn.innerHTML = `DİRİL · ${goldReviveCost} ALTIN · BOŞLUK`;
                }

                const modal = document.getElementById('reviveModal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
            } else {
                triggerGameOver();
            }
        }

        function executePlayerRevive() {
            if (gameState !== 'REVIVE_PROMPT') return;
            const goldReviveCost = 30 + paidRevivesUsed * 35;
            if (player.freeRevives > 0) {
                player.freeRevives--;
                runMetrics.freeRevivesUsed++;
            } else if (paidRevivesUsed < 2 && totalGold >= goldReviveCost) {
                totalGold -= goldReviveCost;
                runMetrics.paidRevivesUsed++;
                runMetrics.paidReviveGoldSpent+=goldReviveCost;
                paidRevivesUsed++;
                saveMetaProgress();
            } else {
                triggerGameOver();
                return;
            }

            reviveCountUsed++;
            player.hp = Math.round(player.maxHp * 0.65);
            player.invulnTimer = 3.5;
            player.momentum = 100;
            player.addOverdrive(50);

            enemyProjectiles = [];
            for (const e of enemies) {
                const dx = e.x - player.x;
                const dy = e.y - player.y;
                const d = Math.hypot(dx, dy) || 1;
                if (d < 380) {
                    e.stunTimer = 2.2;
                    e.takeDamage(player.damage * 3.0, (dx / d) * 680, (dy / d) * 680, true, false);
                }
            }

            audio.playRevive();
            screenShake = 18;
            shockwaves.push(new Shockwave(player.x, player.y, 380, '#10b981', 0.6));
            showDopamineBanner('⚡ DİRİLİŞ · 3,5s KORUMA ⚡', '#10b981');

            const modal = document.getElementById('reviveModal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            gameState = 'PLAYING';
            updateHUD();
        }

        const RUN_REPORT_VERSION=1;
        // Only compact anonymized summaries survive page reloads. No complete
        // builds, saved economy, RNG state, identifiers or network telemetry.
        const TEMPO_COMPARE_SAVE_KEY = 'neonCekirdek.tempoCompare.v1';
        const TEMPO_COMPARE_VERSION = 1;
        function safeTempoNumber(value, max) {
            return typeof value === 'number' && Number.isFinite(value) &&
                value >= 0 && value <= max ? value : 0;
        }
        function sanitizeTempoComparisonRun(row, mode) {
            if (!row || typeof row !== 'object' || row.mode !== mode ||
                !['VANGUARD','PHANTOM','TITAN'].includes(row.chassis) ||
                !['high','medium','low'].includes(row.graphicsQuality))
                return null;
            const numberFields = {
                durationSeconds: 86400, wave: 100000, kills: 10000000,
                damageTaken: 10000000, bossKills: 100000, specialEncounters: 100000,
                averageStress: 100, peakStress: 100, averageMastery: 100,
                stressPeaks: 100000, highStressSeconds: 86400,
                calmSeconds: 86400, longestCalmSeconds: 86400,
                calmWindows: 100000, reliefEntries: 100000,
                crisisSeconds: 86400, recoverySeconds: 86400,
                normalSeconds: 86400, bossProtectedSeconds: 86400
            };
            for (const [key,max] of Object.entries(numberFields)) {
                if (typeof row[key] !== 'number' ||
                    !Number.isFinite(row[key]) || row[key] < 0 || row[key] > max)
                    return null;
            }
            if (row.wave < 1 || row.highStressSeconds > row.normalSeconds + .1 ||
                row.calmSeconds > row.normalSeconds + .1 ||
                row.longestCalmSeconds > row.calmSeconds + .1 ||
                row.crisisSeconds + row.recoverySeconds > row.normalSeconds + .1)
                return null;
            const safe={mode,chassis:row.chassis,graphicsQuality:row.graphicsQuality};
            for (const key of Object.keys(numberFields)) safe[key]=row[key];
            return safe;
        }
        function readTempoComparison() {
            const empty={classic:null,adaptive:null};
            try {
                const raw=localStorage.getItem(TEMPO_COMPARE_SAVE_KEY);
                if (!raw) return empty;
                const data=JSON.parse(raw);
                if (!data || data.version!==TEMPO_COMPARE_VERSION) return empty;
                return {
                    classic:sanitizeTempoComparisonRun(data.classic,'classic'),
                    adaptive:sanitizeTempoComparisonRun(data.adaptive,'adaptive')
                };
            } catch (e) { return empty; }
        }
        function makeTempoComparisonRun(report) {
            if (!report?.tempo) return null;
            const metrics=report.tempo.metrics;
            return sanitizeTempoComparisonRun({
                mode:report.tempo.mode,chassis:report.chassis,
                graphicsQuality:graphicsQuality,
                durationSeconds:report.result.durationSeconds,
                wave:report.result.wave,kills:report.result.kills,
                damageTaken:report.combat.damageTaken,
                bossKills:report.combat.bossKills,
                specialEncounters:report.combat.specialEncounters,
                averageStress:metrics.averageStress,
                peakStress:metrics.peakStress,
                averageMastery:metrics.averageMastery,
                stressPeaks:metrics.stressPeaks,
                highStressSeconds:metrics.highStressSeconds,
                calmSeconds:metrics.calmSeconds,
                longestCalmSeconds:metrics.longestCalmSeconds,
                calmWindows:metrics.calmWindows,
                reliefEntries:metrics.reliefEntries,
                crisisSeconds:report.tempo.phases.CRISIS,
                recoverySeconds:report.tempo.phases.RECOVERY,
                normalSeconds:metrics.normalSeconds,
                bossProtectedSeconds:metrics.bossProtectedSeconds
            },report.tempo.mode);
        }
        function saveTempoComparisonRun(report) {
            const current=makeTempoComparisonRun(report);
            if (!current) return false;
            const stored=readTempoComparison();
            stored[current.mode]=current;
            try {
                localStorage.setItem(TEMPO_COMPARE_SAVE_KEY,
                    JSON.stringify({version:TEMPO_COMPARE_VERSION,...stored}));
                return true;
            } catch (e) { return false; }
        }
        window.getNeonTempoComparison=()=>readTempoComparison();
        window.clearNeonTempoComparison=()=>{
            try { localStorage.setItem(TEMPO_COMPARE_SAVE_KEY,'');return true; }
            catch (e) { return false; }
        };

        function snapshotEndOfRun(reason='CORE_DEPLETED',isNewRecord=false){
            if(finalRunReport) return finalRunReport;
            const economy=combatDirector?combatDirector.getEconomySnapshot():null;
            const director=combatDirector?combatDirector.getDiagnostics():null;
            const guide=player?getBuildGuideModel(player):null;
            const modules=player?Object.entries(player.upgradeCounts).map(([id,tier])=>{
                const definition=UPGRADES_POOL.find(u=>u.id===id);
                return {id,name:definition?.name||id,icon:definition?.icon||'fa-solid fa-cube',
                    color:definition?.color||'#a5eaff',tier};
            }).sort((a,b)=>b.tier-a.tier||a.name.localeCompare(b.name,'tr')):[];
            const data={
                version:RUN_REPORT_VERSION,reason,newRecord:!!isNewRecord,
                result:{score,wave,durationSeconds:totalTime,kills,goldEarned:sessionGold,
                    totalGoldBalance:totalGold,bossEncounters:bossEncounterCount},
                contract:{id:getActiveNeonContract().id,label:getActiveNeonContract().label},
                chassis:player?.chassis||selectedChassis,
                combat:{...runMetrics,eliteKills:director?.eliteKills||0,
                    bossKills:director?.bossKills||0,
                    bossAttacksDeferred:director?.bossAttacksDeferred||0,
                    specialEncounters:director?.specialEncounters||0},
                build:{level:player?.level||1,modules,
                    evolutions:guide?.evolutions||[],synergies:guide?.synergies||[],
                    totalTiers:guide?.totalTiers||0,
                    effects:{...(player?.buildStats||{})},
                    stats:player?{damage:player.damage,critChance:player.critChance,
                        fireDelay:player.fireDelay,maxHp:player.maxHp,speed:player.speed}:null},
                economy:economy||{goldBySource:{},chestDrops:{},chestOpened:{},chestRewards:{}},
                missions:{offered:questStats.offered,completed:questStats.completed,
                    byType:{...questStats.byType},hitsReset:questStats.hitsReset},
                arena:director?{offered:director.arenaOffered,completed:director.arenaCompleted,
                    expired:director.arenaExpired,cancelled:director.arenaCancelled,
                    byKind:director.arenaByKind}:{offered:0,completed:0,expired:0,cancelled:0,byKind:{}},
                encounters:director?{bossByPattern:director.bossByPattern,
                    specialByKind:director.specialByKind}:{bossByPattern:{},specialByKind:{}},
                tempo:director?{
                    mode:director.tempoMode,
                    metrics:director.tempoRunMetrics,
                    phases:director.tempoPhaseSeconds,
                    switches:director.tempoPhaseSwitches
                }:null
            };
            // A serialization boundary prevents later game mutations and UI references
            // from ever modifying the finished run. Reports remain in this session only.
            finalRunReport=JSON.parse(JSON.stringify(data));
            recordContractMastery(finalRunReport);
            return finalRunReport;
        }
        window.getNeonFinalReport=()=>finalRunReport?
            JSON.parse(JSON.stringify(finalRunReport)):null;

        const REPORT_TABS=Object.freeze(['summary','combat','build','economy','objectives','tempo']);
        const REPORT_TAB_IDS=Object.freeze({
            summary:'reportSummaryContent',combat:'reportCombatContent',
            build:'reportBuildContent',economy:'reportEconomyContent',
            objectives:'reportObjectivesContent',tempo:'reportTempoContent'
        });
        const REPORT_EFFECT_NAMES=Object.freeze({
            railShots:'Ray atışı',clusterBursts:'Küme patlaması',
            arcSurges:'Elektrik sıçraması',orbitalPulses:'Uydu darbesi',
            aegisPulses:'Aegis atımı',prismBounces:'Prizma sekmesi',
            reactorBursts:'Reaktör salvosu',overdriveDischarges:'Cinnet deşarjı',
            weakpointMarks:'Zayıf nokta işareti',bloodReactorHeals:'Kan reaktörü iyileşmesi',
            aegisDeflections:'Kalkan karşı atışı',kineticVortices:'Kinetik girdap'
        });
        const REPORT_GOLD_NAMES=Object.freeze({
            orbs:'Altın küreler',quests:'Görev ödülleri',
            arena:'Arena etkinlikleri',chests:'Sandık ödülleri'
        });
        const REPORT_CHEST_NAMES=Object.freeze({
            goldHeal:'Altın / İyileşme',overdriveXp:'Cinnet / XP',bulletNova:'Mermi Novası'
        });
        const REPORT_CHASSIS_NAMES=Object.freeze({
            VANGUARD:'ÖNCÜ',PHANTOM:'HAYALET',TITAN:'TİTAN'
        });
        const reportNumber=n=>Math.round(Number.isFinite(n)?n:0).toLocaleString('tr-TR');
        const reportEscape=v=>String(v??'').replace(/[&<>"']/g,ch=>({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        })[ch]);
        function reportBlock(title,icon,body,wide=false){
            return '<article class="report-block'+(wide?' wide':'')+'">'+
                '<h3 class="report-block-head"><i class="fa-solid '+icon+
                '" aria-hidden="true"></i>'+reportEscape(title)+'</h3>'+body+'</article>';
        }
        function reportPair(label,value){
            return '<div class="report-pair"><span>'+reportEscape(label)+'</span><strong>'+
                reportEscape(value)+'</strong></div>';
        }
        function reportMeter(label,value,total,color='#56cde6',suffix=''){
            const pct=total>0?Math.max(0,Math.min(100,100*value/total)):0;
            return '<div class="report-meter"><span class="report-meter-label">'+
                reportEscape(label)+'</span><span class="report-meter-track"><span class="report-meter-fill" style="display:block;width:'+
                pct.toFixed(1)+'%;background:'+color+'"></span></span><strong class="report-meter-value">'+
                reportEscape(reportNumber(value)+suffix)+'</strong></div>';
        }
        function reportEmpty(message){
            return '<p class="report-empty">'+reportEscape(message)+'</p>';
        }
        function getRunReportInsights(r){
            const notes=[];
            const quests=r.missions;
            const arena=r.arena;
            const income=r.economy.goldBySource||{};
            const entries=Object.entries(income).filter(([,amount])=>amount>0)
                .sort((a,b)=>b[1]-a[1]);
            if(entries.length){
                const source=entries[0][0];
                notes.push({title:'EN GÜÇLÜ GELİR KAYNAĞI',
                    detail:'Bu koşuda en çok altını '+(REPORT_GOLD_NAMES[source]||source)+
                    ' üzerinden kazandın ('+reportNumber(entries[0][1])+' altın).'});
            }
            if(quests.offered>=3){
                const ratio=quests.completed/quests.offered;
                notes.push(ratio>=.6?
                    {title:'GÖREV VERİMLİLİĞİ',detail:'Sunulan görevlerin önemli bölümünü tamamladın ('+
                        reportNumber(quests.completed)+'/'+reportNumber(quests.offered)+').'}:
                    {title:'GÖREV FIRSATI',detail:'Görev tamamlama oranı '+
                        Math.round(ratio*100)+'%. Daha erişilebilir hedeflere odaklanmak ek altın ve Cinnet sağlayabilir.'});
            }
            if(arena.offered>=2){
                notes.push(arena.completed?{
                    title:'ARENA KARARLARI',detail:'Sunulan '+reportNumber(arena.offered)+
                        ' arena olayının '+reportNumber(arena.completed)+' tanesini tamamladın.'
                }:{title:'ARENA FIRSATI',detail:'Bu koşuda sunulan '+reportNumber(arena.offered)+
                        ' arena etkinliğini tamamlamadın. İsteğe bağlı risk/ödülleri değerlendirebilirsin.'});
            }
            if(r.combat.bossKills){
                notes.push({title:'BOSS KARŞILAŞMALARI',detail:reportNumber(r.combat.bossKills)+
                    ' boss imha ettin; '+reportNumber(r.result.bossEncounters)+
                    ' boss karşılaşmasına girdin.'});
            }
            if(r.combat.hitsTaken>=5){
                notes.push({title:'SAVUNMA DENGESİ',
                    detail:reportNumber(r.combat.hitsTaken)+' can kaybettiren isabet aldın. '+
                    'Dash ve koruyucu yetenekleri daha sık kullanmak yardımcı olabilir.'});
            }
            if(r.build.evolutions.length>=2){
                notes.push({title:'BUILD GELİŞİMİ',detail:reportNumber(r.build.evolutions.length)+
                    ' modül evrimine ulaştın. Sinerji uyumunu Build sekmesinden inceleyebilirsin.'});
            }
            if(!notes.length)notes.push({title:'İLK ADIM',
                detail:'Bu koşu temel savaş verilerini topladı. Bir sonraki koşuda daha fazla görev, modül ve arena olayını keşfedebilirsin.'});
            return notes.slice(0,3);
        }
        function renderTempoReportMarkup(report) {
            if (!report?.tempo)
                return reportEmpty('Bu koşu için tempo verisi bulunmuyor.');
            const m=report.tempo.metrics;
            const phases=report.tempo.phases;
            const mode=report.tempo.mode==='adaptive'?'ADAPTİF':'KLASİK';
            const normal=Math.max(1,m.normalSeconds);
            const pct=seconds=>Math.round(100*seconds/normal)+'%';
            const current=reportBlock('BU KOŞUNUN RİTMİ','fa-wave-square',
                reportPair('Aktif düzen',mode)+
                reportPair('Ortalama stres',m.averageStress+' / 100')+
                reportPair('Stres zirvesi',m.peakStress+' / 100')+
                reportPair('Zirve sayısı',m.stressPeaks)+
                reportPair('Yüksek stres süresi',Math.round(m.highStressSeconds)+' sn')+
                reportPair('Ortalama hâkimiyet',m.averageMastery+' / 100')+
                reportPair('Yakın tehditsiz sakin süre',Math.round(m.calmSeconds)+' sn')+
                reportPair('En uzun sakin aralık',Math.round(m.longestCalmSeconds)+' sn')+
                reportPair('8+ sn sakin aralık',m.calmWindows))+
                reportBlock('FAZ ZAMANLARI','fa-chart-pie',
                    reportPair('Hazırlık',Math.round(phases.BUILDUP)+' sn')+
                    reportPair('Baskı',Math.round(phases.PRESSURE)+' sn')+
                    reportPair('Kriz',Math.round(phases.CRISIS)+' sn · '+pct(phases.CRISIS))+
                    reportPair('Nefes',Math.round(phases.RECOVERY)+' sn · '+pct(phases.RECOVERY))+
                    reportPair('Normal savaş ölçümü',Math.round(m.normalSeconds)+' sn')+
                    reportPair('Boss korumalı süre',Math.round(m.bossProtectedSeconds)+' sn')+
                    reportPair('Nefes evresine giriş',m.reliefEntries));
            const saved=readTempoComparison();
            let comparison=reportEmpty('Karşılaştırma için her iki modda birer tamamlanmış koşu gerekiyor.');
            if(saved.classic&&saved.adaptive){
                const a=saved.adaptive,c=saved.classic;
                const comparable=a.chassis===c.chassis &&
                    a.graphicsQuality===c.graphicsQuality &&
                    Math.min(a.durationSeconds,c.durationSeconds)>=120;
                const format=row=>
                    reportPair('Süre',Math.round(row.durationSeconds)+' sn')+
                    reportPair('Dalga',row.wave)+
                    reportPair('İmha / dk',((row.kills/Math.max(1,row.durationSeconds))*60).toFixed(1))+
                    reportPair('HP kaybı / dk',((row.damageTaken/Math.max(1,row.durationSeconds))*60).toFixed(1))+
                    reportPair('Ortalama stres',row.averageStress)+
                    reportPair('Kriz oranı',Math.round(100*row.crisisSeconds/Math.max(1,row.normalSeconds))+'%')+
                    reportPair('Nefes oranı',Math.round(100*row.recoverySeconds/Math.max(1,row.normalSeconds))+'%')+
                    reportPair('Sakin aralık sayısı',row.calmWindows)+
                    reportPair('Özel baskın',row.specialEncounters)+
                    reportPair('Boss imhası',row.bossKills);
                comparison=reportBlock('KLASİK · SON KOŞU','fa-clock',format(c))+
                    reportBlock('ADAPTİF · SON KOŞU','fa-bolt',format(a))+
                    reportBlock('KARŞILAŞTIRMA GÜVENİ','fa-scale-balanced',
                        reportPair('Şasi aynı mı',a.chassis===c.chassis?'EVET':'HAYIR')+
                        reportPair('Grafik kalitesi aynı mı',
                            a.graphicsQuality===c.graphicsQuality?'EVET':'HAYIR')+
                        reportPair('İki koşu da 2+ dk mı',
                            Math.min(a.durationSeconds,c.durationSeconds)>=120?'EVET':'HAYIR')+
                        '<p class="report-micro">'+(comparable?
                        'Benzer koşul kontrolü sağlandı; farklı build, şans ve oyuncu kararları sonucu etkiler. Tek çift sonuç, daha eğlenceli olduğunu kanıtlamaz.':
                        'Koşullar farklı veya süre kısa. Sayılar görülebilir fakat sonuçlardan denge/oyuncu memnuniyeti hükmü çıkarılmamalı.')+
                        '</p>',true);
            }
            return '<div class="report-grid">'+current+
                reportBlock('SON KLASİK / ADAPTİF KOŞU','fa-code-compare',
                    '<p class="report-micro">Her modun son tamamlanan koşusunun kısa özeti yalnızca bu tarayıcıda tutulur. Tam oyun raporu veya kişisel veri gönderilmez. Bu ölçümler oyun keyfi/retention kanıtı değildir.</p>',true)+
                comparison+'</div>';
        }

        function renderRunReport(r=finalRunReport){
            if(!r) return false;
            const el=id=>document.getElementById(id);
            const income=r.economy.goldBySource||{};
            const goldTotal=Object.values(income).reduce((s,n)=>s+(Number(n)||0),0);
            const opened=r.economy.chestOpened||{};
            const drops=r.economy.chestDrops||{};
            const openedTotal=Object.values(opened).reduce((s,n)=>s+(Number(n)||0),0);
            const missionRatio=r.missions.offered?
                Math.round(100*r.missions.completed/r.missions.offered):0;
            el('reportSubtitle').textContent=r.reason==='REVIVE_DECLINED'?
                'Dirilişi reddederek operasyonu sonlandırdın. Bir sonraki koşu için kararlarını incele.':
                'Çekirdek bütünlüğü tükendi. Bir sonraki koşu için kararlarını incele.';
            el('reportRunStatus').textContent=r.reason==='REVIVE_DECLINED'?
                'DİRİLİŞ REDDEDİLDİ':'SİNYAL KESİLDİ';
            el('reportKillDetail').textContent=reportNumber(r.combat.eliteKills)+
                ' elit · '+reportNumber(r.combat.bossKills)+' boss';
            el('reportGoldDetail').textContent='Kazanç · mevcut bakiye '+
                reportNumber(r.result.totalGoldBalance);
            el('reportTimeDetail').textContent=REPORT_CHASSIS_NAMES[r.chassis]||r.chassis;
            el('reportScoreDetail').textContent=r.newRecord?'Yeni rekor':'Operasyon skoru';

            const insights=getRunReportInsights(r).map(note=>
                '<div class="report-insight"><strong>'+reportEscape(note.title)+'</strong>'+
                '<p>'+reportEscape(note.detail)+'</p></div>').join('');
            const summary=
                reportBlock('OPERASYONUN ÖZÜ','fa-chart-simple',
                    reportPair('Şasi',REPORT_CHASSIS_NAMES[r.chassis]||r.chassis)+
                    reportPair('Ulaşılan seviye',reportNumber(r.build.level))+
                    reportPair('Zirve kombo','x'+reportNumber(r.combat.peakCombo))+
                    reportPair('Boss karşılaşmaları',reportNumber(r.result.bossEncounters))+
                    reportPair('Kullanılan diriliş',reportNumber(r.combat.freeRevivesUsed+r.combat.paidRevivesUsed)))+
                reportBlock('KOŞU İÇGÖRÜLERİ','fa-lightbulb',insights)+
                reportBlock('BİR SONRAKİ ADIM','fa-arrow-trend-up',
                    '<p class="report-empty">Savaşta ne kadar dayandığını, build tercihlerini, altın kaynaklarını ve görev verimliliğini yukarıdaki sekmelerden incele. '+
                    'Yalnızca ölçülmüş olaylar raporlanır; silah başına gerçek hasar/DPS takibi henüz bulunmuyor.</p>',true);
            el('reportSummaryContent').innerHTML='<div class="report-grid">'+summary+'</div>';

            const combat=
                reportBlock('SALDIRI PERFORMANSI','fa-crosshairs',
                    reportPair('Toplam düşman',reportNumber(r.result.kills))+
                    reportPair('Elit imha',reportNumber(r.combat.eliteKills))+
                    reportPair('Boss imha',reportNumber(r.combat.bossKills))+
                    reportPair('Zirve kombo','x'+reportNumber(r.combat.peakCombo))+
                    reportPair('Tamamlanan özel baskın',reportNumber(r.combat.specialEncounters))+
                    reportPair('Çakışma önlenen boss saldırısı',reportNumber(r.combat.bossAttacksDeferred)))+
                reportBlock('HAYATTA KALMA','fa-shield-heart',
                    reportPair('Gerçek HP kaybı',reportNumber(r.combat.damageTaken))+
                    reportPair('HP azaltan isabet',reportNumber(r.combat.hitsTaken))+
                    reportPair('Kalkanla blok',reportNumber(r.combat.shieldBlocks))+
                    reportPair('Ücretsiz diriliş',reportNumber(r.combat.freeRevivesUsed))+
                    reportPair('Altınla diriliş',reportNumber(r.combat.paidRevivesUsed))+
                    reportPair('Diriliş harcaması',reportNumber(r.combat.paidReviveGoldSpent)+' altın'))+
                reportBlock('BUILD ETKİNLİĞİ','fa-bolt-lightning',
                    Object.entries(r.build.effects||{}).filter(([,n])=>n>0).length?
                        Object.entries(r.build.effects).filter(([,n])=>n>0)
                            .map(([name,n])=>reportPair(REPORT_EFFECT_NAMES[name]||name,reportNumber(n))).join(''):
                        reportEmpty('Bu koşuda ayrı bir gelişmiş silah etkisi tetiklenmedi.'),true);
            el('reportCombatContent').innerHTML='<div class="report-grid">'+combat+'</div>';

            const mods=r.build.modules||[];
            const chips=mods.length?mods.map(m=>
                '<span class="report-chip"><i class="'+reportEscape(m.icon)+
                '" aria-hidden="true" style="color:'+reportEscape(m.color)+'"></i>'+
                reportEscape(m.name)+' <strong>K'+reportNumber(m.tier)+'</strong></span>').join(''):
                reportEmpty('Bu koşuda yükseltme modülü seçilmedi.');
            const traits=(list,empty)=>list.length?
                '<div class="report-chip-list">'+list.map(n=>'<span class="report-chip">'+
                    reportEscape(n)+'</span>').join('')+'</div>':reportEmpty(empty);
            const build=
                reportBlock('MODÜL YÜKLERİ','fa-microchip',
                    '<p class="report-micro">Toplam '+reportNumber(r.build.totalTiers)+
                    ' modül kademesi · '+reportNumber(mods.length)+' farklı modül</p>'+
                    '<div class="report-chip-list" style="margin-top:14px">'+chips+'</div>',true)+
                reportBlock('AKTİF EVRİMLER','fa-dna',
                    traits(r.build.evolutions||[],'Bu koşuda modül evrimi tamamlanmadı.'))+
                reportBlock('AKTİF SİNERJİLER','fa-link',
                    traits(r.build.synergies||[],'Bu koşuda aktif sinerji açılmadı.'))+
                reportBlock('SON DURUM İSTATİSTİKLERİ','fa-gauge-high',
                    r.build.stats?
                        reportPair('Hasar',reportNumber(r.build.stats.damage))+
                        reportPair('Kritik şansı',Math.round(r.build.stats.critChance*100)+'%')+
                        reportPair('Ateş aralığı',r.build.stats.fireDelay.toFixed(2)+' sn')+
                        reportPair('Maksimum can',reportNumber(r.build.stats.maxHp))+
                        reportPair('Hareket hızı',reportNumber(r.build.stats.speed)):
                        reportEmpty('Build istatistiği bulunamadı.'),true);
            el('reportBuildContent').innerHTML='<div class="report-grid">'+build+'</div>';

            const sources=Object.entries(REPORT_GOLD_NAMES).map(([key,label],index)=>
                reportMeter(label,income[key]||0,Math.max(1,goldTotal),
                    ['#55d2ed','#c7a5ff','#7be8be','#ffe09a'][index],'')).join('');
            const rewards=r.economy.chestRewards||{};
            const allRewards=Object.values(rewards);
            const rewardSum=k=>allRewards.reduce((n,b)=>n+(Number(b[k])||0),0);
            const economy=
                reportBlock('ALTIN GELİRİ','fa-coins',
                    sources+reportPair('İzlenen toplam',reportNumber(goldTotal))+
                    reportPair('Koşu boyunca kazanılan',reportNumber(r.result.goldEarned))+
                    '<p class="report-micro">Kaynakların toplamı ile toplam kazanç farklıysa, fark ayrı bir kaynağın kayda girmediğini gösterir; toplam değerler sessizce düzeltilmez.</p>',true)+
                reportBlock('SANDIK EKONOMİSİ','fa-box-open',
                    reportPair('Elit sandığı düştü',reportNumber(drops.elite||0))+
                    reportPair('Boss sandığı düştü',reportNumber(drops.boss||0))+
                    reportPair('Toplam açılan',reportNumber(openedTotal))+
                    reportPair('Sandık / dakika',String(r.economy.totalChestsPerMinute||0))+
                    Object.entries(REPORT_CHEST_NAMES).map(([key,label])=>
                        reportPair(label,reportNumber(opened[key]||0))).join(''))+
                reportBlock('SANDIK ÖDÜL DETAYI','fa-gift',
                    reportPair('Altın',reportNumber(rewardSum('gold')))+
                    reportPair('İyileştirilen can',reportNumber(rewardSum('heal')))+
                    reportPair('Kazanılan XP',reportNumber(rewardSum('xp')))+
                    reportPair('Cinnet',reportNumber(rewardSum('charge')))+
                    reportPair('Nova mermisi',reportNumber(rewardSum('shots'))));
            el('reportEconomyContent').innerHTML='<div class="report-grid">'+economy+'</div>';

            const quests=Object.entries(r.missions.byType||{});
            const questBars=quests.length?quests.sort((a,b)=>b[1]-a[1])
                .map(([type,n])=>reportMeter(QUEST_LABELS[type]||type,n,
                    Math.max(1,r.missions.completed),'#b4a1ff')).join(''):
                reportEmpty('Bu koşuda henüz tamamlanan görev yok.');
            const arenaEntries=Object.entries(r.arena.byKind||{});
            const arenaBars=arenaEntries.length?arenaEntries
                .map(([kind,stat])=>reportPair(
                    ARENA_EVENT_SPECS[kind]?.label||kind,
                    reportNumber(stat.completed||0)+' / '+reportNumber(stat.offered||0)))
                .join(''):reportEmpty('Bu koşuda arena etkinliği henüz sunulmadı.');
            const objectives=
                reportBlock('GÖREV PERFORMANSI','fa-list-check',
                    reportPair('Sunulan',reportNumber(r.missions.offered))+
                    reportPair('Tamamlanan',reportNumber(r.missions.completed))+
                    reportPair('Tamamlama oranı',missionRatio+'%')+
                    reportPair('Hasarsız görev sıfırlaması',reportNumber(r.missions.hitsReset)))+
                reportBlock('TAMAMLANAN GÖREV TÜRLERİ','fa-medal',questBars)+
                reportBlock('ARENA ETKİNLİKLERİ','fa-map-location-dot',
                    reportPair('Sunulan',reportNumber(r.arena.offered))+
                    reportPair('Tamamlanan',reportNumber(r.arena.completed))+
                    reportPair('Süresi dolan',reportNumber(r.arena.expired))+
                    reportPair('İptal edilen',reportNumber(r.arena.cancelled)))+
                reportBlock('ARENA TÜRÜNE GÖRE SONUÇ','fa-bullseye',arenaBars)+
                reportBlock('KARŞILAŞMA ÇEŞİTLİLİĞİ','fa-skull',
                    Object.keys(r.encounters.bossByPattern||{}).length?
                        Object.entries(r.encounters.bossByPattern).map(([id,n])=>
                            reportPair(id.replaceAll('_',' '),reportNumber(n))).join(''):
                        reportEmpty('Bu koşuda henüz boss karşılaşması kaydedilmedi.'),true);
            el('reportObjectivesContent').innerHTML='<div class="report-grid">'+objectives+'</div>';
            el('reportTempoContent').innerHTML=renderTempoReportMarkup(r);
            showRunReportTab('summary');
            return true;
        }
        function showRunReportTab(name){
            if(!finalRunReport||!REPORT_TABS.includes(name)) return false;
            activeReportTab=name;
            for(const tab of REPORT_TABS){
                const selected=tab===name;
                const panel=document.getElementById(REPORT_TAB_IDS[tab]);
                panel.classList.toggle('hidden',!selected);
                panel.setAttribute('aria-hidden',String(!selected));
                const btn=document.getElementById('reportTab'+
                    tab.charAt(0).toUpperCase()+tab.slice(1));
                btn.classList.toggle('is-active',selected);
                btn.setAttribute('aria-selected',String(selected));
                btn.setAttribute('tabindex',selected?'0':'-1');
            }
            return true;
        }

        function triggerGameOver(reason='CORE_DEPLETED') {
            if(gameState==='GAME_OVER') return;
            gameState = 'GAME_OVER';
            document.getElementById('reviveModal').classList.add('hidden');
            document.getElementById('reviveModal').classList.remove('flex');
            document.getElementById('lowHpOverlay').classList.add('hidden');
            audio.playExplosion(true);

            let isNewRecord = false;
            if (score > savedHighScore) {
                savedHighScore = score;
                isNewRecord = true;
            }
            if (wave > savedMaxWave) {
                savedMaxWave = wave;
            }
            saveMetaProgress();
            snapshotEndOfRun(reason,isNewRecord);
            // Once per completed run; no writes during combat or card choices.
            saveTempoComparisonRun(finalRunReport);
            // Training updates occurred during completed normal combat windows;
            // save the tiny weight vector only at end of a finished run.
            combatDirector?.playerLearner.save();

            document.getElementById('newRecordBadge').classList.toggle('hidden', !isNewRecord);
            document.getElementById('finalScoreText').textContent = score.toLocaleString('tr-TR');
            document.getElementById('finalWaveText').textContent = wave;
            document.getElementById('finalTimeText').textContent = formatTime(totalTime);
            document.getElementById('finalKillsText').textContent = kills;
            document.getElementById('finalGoldEarnedText').textContent = `+${sessionGold.toLocaleString('tr-TR')}`;
            renderRunReport(finalRunReport);

            const modal = document.getElementById('gameOverModal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        let shopReturnTarget = 'MENU';
        function openShop(from) {
            shopReturnTarget = from;
            renderShopItems();
            const shopModal = document.getElementById('shopModal');
            shopModal.classList.remove('hidden');
            shopModal.classList.add('flex');
        }

        function closeShop() {
            const shopModal = document.getElementById('shopModal');
            shopModal.classList.add('hidden');
            shopModal.classList.remove('flex');
            updateMenuCounters();
        }

        function renderShopItems() {
            document.getElementById('shopGoldBalance').textContent = totalGold.toLocaleString('tr-TR');
            const container = document.getElementById('shopItemsContainer');
            container.innerHTML = '';

            META_SHOP_ITEMS.forEach(item => {
                const currentLvl = metaUpgrades[item.key] || 0;
                const isMax = currentLvl >= item.maxLevel;
                const cost = Math.round(item.baseCost * Math.pow(item.costScale, currentLvl));
                const canAfford = totalGold >= cost && !isMax;

                const card = document.createElement('div');
                card.className = 'bg-gray-900/90 border border-gray-800 rounded-xl p-4 flex flex-col justify-between text-left';
                card.innerHTML = `
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <div class="flex items-center gap-2.5">
                                <div class="w-10 h-10 rounded-lg flex items-center justify-center text-lg border" style="color:${item.color}; border-color:${item.color}; background:rgba(0,0,0,0.4);">
                                    <i class="${item.icon}"></i>
                                </div>
                                <div>
                                    <h4 class="font-cyber font-bold text-white text-sm">${item.name}</h4>
                                    <span class="text-xs font-cyber text-cyan-400">Kademe: ${currentLvl} / ${item.maxLevel}</span>
                                </div>
                            </div>
                        </div>
                        <p class="text-xs text-gray-400 leading-relaxed mb-4">${item.desc}</p>
                    </div>
                    <button type="button" class="buy-btn w-full py-2.5 rounded-lg font-cyber font-bold text-xs flex items-center justify-center gap-1.5 transition ${isMax ? 'bg-gray-800 text-green-400 cursor-default' : (canAfford ? 'bg-yellow-500 hover:bg-yellow-400 text-black cursor-pointer' : 'bg-gray-800 text-gray-500 cursor-not-allowed')}">
                        ${isMax ? '<i class="fa-solid fa-check"></i> MAKSİMUM SEVİYE' : `<i class="fa-solid fa-coins"></i> ${cost} ALTIN İLE YÜKSELT`}
                    </button>
                `;

                const btn = card.querySelector('.buy-btn');
                if (!isMax && canAfford) {
                    btn.addEventListener('click', () => {
                        totalGold -= cost;
                        metaUpgrades[item.key] = currentLvl + 1;
                        audio.init();
                        audio.playLevelUp();
                        saveMetaProgress();
                        renderShopItems();
                    });
                }
                container.appendChild(card);
            });
        }

        // Bound backing-store pixels rather than simulating fewer enemies or weaker effects.
        // Estimated one RGBA canvas buffer: width * height * 4 bytes, not total GPU memory.
        function getRenderDpr(w, h, nativeDpr = 1) {
            const compact = Math.min(w, h) < 900;
            const preset = getGraphicsPreset();
            const pixelBudget = compact ? Math.min(1800000, preset.pixelBudget) : preset.pixelBudget;
            const dprCap = compact ? Math.min(1.75, preset.dprCap) : preset.dprCap;
            const safeDpr = Number.isFinite(nativeDpr) && nativeDpr > 0 ? nativeDpr : 1;
            return Math.min(safeDpr, dprCap,
                Math.sqrt(pixelBudget / Math.max(1, w * h)));
        }
        function resizeCanvas() {
            canvasRenderInvalidated = true;
            const w = document.documentElement.clientWidth || window.innerWidth;
            const h = document.documentElement.clientHeight || window.innerHeight;
            currentDpr = getRenderDpr(w, h, window.devicePixelRatio || 1);

            const diag = Math.hypot(w, h);
            viewScale = Math.max(0.75, Math.min(1.9, diag / 1565));

            worldWidth = w / viewScale;
            worldHeight = h / viewScale;

            canvas.width = Math.floor(w * currentDpr);
            canvas.height = Math.floor(h * currentDpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;

            ctx.setTransform(currentDpr * viewScale, 0, 0, currentDpr * viewScale, 0, 0);

            if (player) {
                player.x = Math.min(worldWidth - player.radius, Math.max(player.radius, player.x));
                player.y = Math.min(worldHeight - player.radius, Math.max(player.radius, player.y));
            }
            if (menuDemoNodes.length === 0) {
                initMenuDemoNodes();
            }
        }
        window.addEventListener('resize', resizeCanvas);

        function togglePerformanceOverlay() {
            performanceOverlayOn = !performanceOverlayOn;
            resetPc3Telemetry();
            performanceSampleFrames = 0;
            performanceSampleMs = 0;
            perfRecentFrameCount = 0;
            perfRecentFrameIndex = 0;
            perfUpdateTotalMs = 0;
            perfRenderTotalMs = 0;
            document.getElementById('perfOverlay').classList.toggle('hidden', !performanceOverlayOn);
        }

        function toggleFullscreen() {
            try {
                if (!document.fullscreenElement) {
                    const req = document.documentElement.requestFullscreen();
                    if (req && req.catch) req.catch(() => {});
                } else if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
                setTimeout(resizeCanvas, 120);
            } catch (e) {}
        }

        document.addEventListener('fullscreenchange', () => {
            setTimeout(resizeCanvas, 50);
        });

        // M6.1.1: only PLAYING can latch movement keys; modals must not leave keys held.
        const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD',
            'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
        function clearGameplayInput() {
            for (const code of Object.keys(keys)) delete keys[code];
            mouse.active = false;
        }
        function isInteractiveKeyTarget(target) {
            return !!(target && typeof target.closest === 'function' &&
                target.closest('button, a, input, textarea, select, summary, [role="button"]'));
        }
        function pauseForLostFocus() {
            clearGameplayInput();
            if (gameState === 'PLAYING') togglePause();
        }
        window.addEventListener('blur', pauseForLostFocus);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) pauseForLostFocus();
        });

        window.addEventListener('keydown', (e) => {
            if (gameState === 'PLAYING' && MOVEMENT_KEYS.has(e.code)) keys[e.code] = true;
            // Native key repeat may otherwise buy multiple rerolls or toggle PAUSE repeatedly.
            if (e.repeat) return;
            if (e.code === 'F3') {
                e.preventDefault();
                togglePerformanceOverlay();
                return;
            }
            if (e.code === 'KeyF') {
                toggleFullscreen();
                return;
            }
            if (gameState === 'PLAYING') {
                if (e.code === 'Space') {
                    // Space on a focused HUD button should activate that button, not dash twice.
                    if (isInteractiveKeyTarget(e.target)) return;
                    e.preventDefault();
                    player.triggerDash();
                } else if (e.code === 'KeyE') {
                    player.triggerNova();
                } else if (e.code === 'KeyC') {
                    if (isInteractiveKeyTarget(e.target)) return;
                    e.preventDefault();
                    activatePrismGuard();
                } else if (e.code === 'KeyQ') {
                    // Do not spend gold while keyboard focus is on another control.
                    if (!isInteractiveKeyTarget(e.target)) {
                        e.preventDefault();
                        deployBastion();
                    }
                } else if (e.code === 'KeyM') {
                    toggleControlMode();
                } else if (e.code === 'Tab' && activeBosses.some(b => !b.dead)) {
                    e.preventDefault();
                    cycleBossTarget(e.shiftKey ? -1 : 1);
                } else if (e.code === 'Escape' || e.code === 'KeyP') {
                    e.preventDefault();
                    togglePause();
                }
            } else if (gameState === 'LEVEL_UP') {
                if (e.code === 'Digit1' || e.code === 'Numpad1') selectUpgradeOption(0);
                else if (e.code === 'Digit2' || e.code === 'Numpad2') selectUpgradeOption(1);
                else if (e.code === 'Digit3' || e.code === 'Numpad3') selectUpgradeOption(2);
                else if (e.code === 'KeyR') {
                    e.preventDefault();
                    document.getElementById('rerollUpgradesBtn').click();
                }
            } else if (gameState === 'REVIVE_PROMPT') {
                if (e.code === 'Space' || e.code === 'Enter') {
                    // Preserve native keyboard activation, especially "end run" button.
                    if (isInteractiveKeyTarget(e.target)) return;
                    e.preventDefault();
                    executePlayerRevive();
                }
            } else if (gameState === 'PAUSED' && (e.code === 'Escape' || e.code === 'KeyP')) {
                e.preventDefault();
                togglePause();
            }
        });

        window.addEventListener('keyup', (e) => {
            keys[e.code] = false;
        });

        canvas.addEventListener('mousemove', (e) => {
            if (gameState !== 'PLAYING' || e.sourceCapabilities?.firesTouchEvents) return;
            mouse.x = e.clientX / viewScale;
            mouse.y = e.clientY / viewScale;
            mouse.active = true;
        });

        canvas.addEventListener('mousedown', (e) => {
            if (gameState !== 'PLAYING') return;
            if (e.button === 0) {
                player.triggerDash();
            } else if (e.button === 2) {
                player.triggerNova();
            }
        });

        window.addEventListener('contextmenu', (e) => e.preventDefault());

        function updateTouchMovementTarget(touches) {
            if (gameState !== 'PLAYING' || !touches || touches.length === 0) {
                mouse.active = false;
                return;
            }
            mouse.x = touches[0].clientX / viewScale;
            mouse.y = touches[0].clientY / viewScale;
            mouse.active = true;
        }
        canvas.addEventListener('touchstart', e => updateTouchMovementTarget(e.touches),
            { passive: true });
        canvas.addEventListener('touchmove', e => updateTouchMovementTarget(e.touches),
            { passive: true });
        canvas.addEventListener('touchend', e => updateTouchMovementTarget(e.touches),
            { passive: true });
        canvas.addEventListener('touchcancel', () => { mouse.active = false; },
            { passive: true });

        function toggleControlMode() {
            controlMode = controlMode === 'HYBRID' ? 'KEYBOARD' : 'HYBRID';
            const txt = document.getElementById('ctrlModeText');
            txt.textContent = controlMode === 'HYBRID'
                ? 'HİBRİT · M'
                : 'KLAVYE · M';
        }

        const backupStatusText = document.getElementById('backupStatusText');
        document.getElementById('backupExportBtn').addEventListener('click', () => {
            let url = null;
            try {
                const json = JSON.stringify(createProgressBackup(), null, 2);
                url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'neon-cekirdek-kayit.json';
                link.click();
                backupStatusText.textContent = 'YEDEK İNDİRİLDİ';
            } catch (error) {
                console.warn('Kayıt yedeği indirilemedi.', error);
                backupStatusText.textContent = 'YEDEK ALINAMADI';
            } finally {
                if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
            }
        });
        const backupImportInput = document.getElementById('backupImportInput');
        document.getElementById('backupImportBtn').addEventListener('click', () => backupImportInput.click());
        backupImportInput.addEventListener('change', async () => {
            const file = backupImportInput.files?.[0];
            backupImportInput.value = '';
            if (!file) return;
            if (file.size > PROGRESS_BACKUP_MAX_BYTES) {
                backupStatusText.textContent = 'YEDEK BOYUTU GEÇERSİZ';
                return;
            }
            try {
                const json = await file.text();
                if (!parseProgressBackup(json)) {
                    backupStatusText.textContent = 'YEDEK DOSYASI GEÇERSİZ';
                    return;
                }
                if (!window.confirm('Bu yedek mevcut altın, rekor ve kalıcı yükseltmelerin üzerine yazacak. Devam edilsin mi?')) {
                    backupStatusText.textContent = 'İŞLEM İPTAL EDİLDİ';
                    return;
                }
                backupStatusText.textContent = restoreProgressBackup(json) ?
                    'YEDEK GERİ YÜKLENDİ' : 'GERİ YÜKLEME BAŞARISIZ';
            } catch (error) {
                console.warn('Yedek dosyası okunamadı.', error);
                backupStatusText.textContent = 'YEDEK OKUNAMADI';
            }
        });

        document.getElementById('startBtn').addEventListener('click', startNewGame);
        document.getElementById('restartBtn').addEventListener('click', startNewGame);
        document.getElementById('restartFromPauseBtn').addEventListener('click', startNewGame);
        document.getElementById('resumeBtn').addEventListener('click', togglePause);
        document.getElementById('pauseBtn').addEventListener('click', togglePause);
        document.getElementById('fullscreenBtn').addEventListener('click', toggleFullscreen);
        document.getElementById('menuFullscreenBtn').addEventListener('click', toggleFullscreen);
        document.getElementById('ctrlToggleBtn').addEventListener('click', toggleControlMode);

        document.getElementById('dashBtn').addEventListener('click', () => {
            if (gameState === 'PLAYING' && player) player.triggerDash();
        });
        document.getElementById('novaBtn').addEventListener('click', () => {
            if (gameState === 'PLAYING' && player) player.triggerNova();
        });
        document.getElementById('prismBtn').addEventListener('click', activatePrismGuard);
        document.getElementById('bastionBtn').addEventListener('click', () => {
            deployBastion();
        });

        document.getElementById('soundToggleBtn').addEventListener('click', () => {
            audio.enabled = !audio.enabled;
            document.getElementById('soundIcon').className = audio.enabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark text-gray-500';
        });

        document.getElementById('musicToggleBtn').addEventListener('click', () => {
            audio.musicEnabled = !audio.musicEnabled;
            document.getElementById('musicIcon').className = audio.musicEnabled ? 'fa-solid fa-music' : 'fa-solid fa-music text-gray-600 line-through';
        });

        document.getElementById('openShopFromMenuBtn').addEventListener('click', () => openShop('MENU'));
        document.getElementById('openShopFromOverBtn').addEventListener('click', () => openShop('GAME_OVER'));
        document.getElementById('closeShopBtn').addEventListener('click', closeShop);

        // Tabs are presentation only: switching never changes the frozen snapshot.
        for(const button of document.querySelectorAll('[data-report-tab]')){
            button.addEventListener('click',()=>showRunReportTab(button.getAttribute('data-report-tab')));
            button.addEventListener('keydown',event=>{
                if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
                event.preventDefault();
                const current=REPORT_TABS.indexOf(button.getAttribute('data-report-tab'));
                const index=event.key==='Home'?0:event.key==='End'?
                    REPORT_TABS.length-1:
                    (current+(event.key==='ArrowRight'?1:-1)+REPORT_TABS.length)%REPORT_TABS.length;
                showRunReportTab(REPORT_TABS[index]);
                document.getElementById('reportTab'+REPORT_TABS[index].charAt(0).toUpperCase()+
                    REPORT_TABS[index].slice(1)).focus();
            });
        }
        document.getElementById('confirmReviveBtn').addEventListener('click', executePlayerRevive);
        document.getElementById('declineReviveBtn').addEventListener('click', () => triggerGameOver('REVIVE_DECLINED'));

        document.querySelectorAll('.chassis-card').forEach((card) => {
            card.addEventListener('click', () => {
                document.querySelectorAll('.chassis-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                selectedChassis = card.getAttribute('data-chassis');
                const badge = document.getElementById('selectedChassisBadge');
                const dot = document.getElementById('menuCorePreviewDot');
                if (selectedChassis === 'VANGUARD') {
                    badge.textContent = 'ÖNCÜ';
                    dot.style.backgroundColor = '#00f3ff';
                } else if (selectedChassis === 'PHANTOM') {
                    badge.textContent = 'HAYALET';
                    dot.style.backgroundColor = '#ff007f';
                } else {
                    badge.textContent = 'TİTAN';
                    dot.style.backgroundColor = '#00ff66';
                }
                audio.init();
                audio.playOrbPickup(5, false);
                updateMenuCounters();
            });
        });


        // Desktop: fit the full menu including Start without hiding buttons.
        // Compact CSS handles most cases; proportional adjustment absorbs font/UI scaling.
        function fitStartMenuToViewport() {
            const modal = document.getElementById('startModal');
            const shell = document.getElementById('startMenuShell');
            if (!modal || !shell) return;
            shell.style.transform = '';
            if (window.innerWidth < 1024 || window.innerHeight < 680) {
                modal.style.overflowY = 'auto';
                return;
            }
            const available = modal.clientHeight || window.innerHeight;
            const needed = shell.scrollHeight || available;
            const factor = Math.min(1, (available - 4) / Math.max(needed, 1));
            if (factor < 0.78) {
                // Unusually short windows stay accessible; never clip the Start button.
                modal.style.overflowY = 'auto';
                return;
            }
            modal.style.overflowY = 'hidden';
            shell.style.transform = factor < 0.999 ? `scale(${factor.toFixed(4)})` : '';
        }

        let menuFitFramePending = false;
        function scheduleMenuFit() {
            if (menuFitFramePending) return;
            menuFitFramePending = true;
            requestAnimationFrame(() => {
                menuFitFramePending = false;
                fitStartMenuToViewport();
            });
        }

        window.addEventListener('resize', scheduleMenuFit);
        if (typeof ResizeObserver !== 'undefined') {
            const menuObserver = new ResizeObserver(scheduleMenuFit);
            menuObserver.observe(document.getElementById('startMenuShell'));
            menuObserver.observe(document.getElementById('preflightDashboard'));
        }
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleMenuFit);
        document.querySelectorAll('.menu-protocol-tip').forEach(
            el => el.addEventListener('toggle', scheduleMenuFit)
        );

        const tabProtocolBtn = document.getElementById('tabProtocolBtn');
        const tabCodexBtn = document.getElementById('tabCodexBtn');
        const tabProtocolContent = document.getElementById('tabProtocolContent');
        const tabCodexContent = document.getElementById('tabCodexContent');

        tabProtocolBtn.addEventListener('click', () => {
            tabProtocolContent.classList.remove('hidden');
            tabProtocolContent.classList.add('grid');
            tabCodexContent.classList.add('hidden');
            tabCodexContent.classList.remove('grid');
            tabProtocolBtn.className = 'px-4 py-2 rounded-lg font-cyber text-xs font-bold tracking-wider border border-cyan-400/60 text-cyan-300 bg-cyan-950/50 transition cursor-pointer';
            tabCodexBtn.className = 'px-4 py-2 rounded-lg font-cyber text-xs font-bold tracking-wider border border-transparent text-gray-400 hover:text-white hover:bg-gray-900 transition cursor-pointer';
            scheduleMenuFit();
        });

        tabCodexBtn.addEventListener('click', () => {
            tabCodexContent.classList.remove('hidden');
            tabCodexContent.classList.add('grid');
            tabProtocolContent.classList.add('hidden');
            tabProtocolContent.classList.remove('grid');
            tabCodexBtn.className = 'px-4 py-2 rounded-lg font-cyber text-xs font-bold tracking-wider border border-pink-500/60 text-pink-300 bg-pink-950/50 transition cursor-pointer';
            tabProtocolBtn.className = 'px-4 py-2 rounded-lg font-cyber text-xs font-bold tracking-wider border border-transparent text-gray-400 hover:text-white hover:bg-gray-900 transition cursor-pointer';
            scheduleMenuFit();
        });

        function returnToMainMenu() {
            gameState = 'MENU';
            document.getElementById('hud').classList.add('hidden');
            document.getElementById('overdriveOverlay').classList.add('hidden');
            document.getElementById('lowHpOverlay').classList.add('hidden');
            document.getElementById('reviveModal').classList.add('hidden');
            document.getElementById('reviveModal').classList.remove('flex');
            document.getElementById('pauseModal').classList.add('hidden');
            document.getElementById('pauseModal').classList.remove('flex');
            document.getElementById('gameOverModal').classList.add('hidden');
            document.getElementById('gameOverModal').classList.remove('flex');
            document.getElementById('startModal').classList.remove('hidden');
            updateMenuCounters();
            scheduleMenuFit();
        }

        for (const id of ['menuGraphicsQuality', 'pauseGraphicsQuality']) {
            document.getElementById(id).addEventListener('change', event => {
                applyGraphicsQuality(event.target.value);
            });
        }
        document.getElementById('menuFromPauseBtn').addEventListener('click', returnToMainMenu);
        document.getElementById('backToMenuBtn').addEventListener('click', returnToMainMenu);

        let lastFrameTime = performance.now();
        let lastCanvasRenderedState = null;

        function gameLoop(now) {
            const frameMs = Math.max(0, now - lastFrameTime);
            const dt = Math.min(0.05, frameMs / 1000);
            lastFrameTime = now;
            const frameCpuStart = performanceOverlayOn ? performance.now() : 0;

            if (gameState === 'MENU') {
                for (const n of menuDemoNodes) {
                    n.x = (n.x + n.vx * dt + worldWidth) % worldWidth;
                    n.y = (n.y + n.vy * dt + worldHeight) % worldHeight;
                    n.rot += dt * 1.2;
                }
            } else if (gameState === 'PLAYING') {
                updateGame(dt);
            } else if (gameState === 'DYING_SEQUENCE') {
                for (let i = particles.length - 1; i >= 0; i--) {
                    particles[i].update(dt * 0.35);
                    if (particles[i].life <= 0) particles.splice(i, 1);
                }
                for (let i = shockwaves.length - 1; i >= 0; i--) {
                    shockwaves[i].update(dt * 0.5);
                    if (shockwaves[i].elapsed >= shockwaves[i].duration) shockwaves.splice(i, 1);
                }
                if (screenShake > 0) screenShake = Math.max(0, screenShake - dt * 20);
                dyingSequenceTimer -= dt;
                if (dyingSequenceTimer <= 0) {
                    showRevivePromptOrGameOver();
                }
            }
            const renderCpuStart = performanceOverlayOn ? performance.now() : 0;
            // Keep menu and combat live. Frozen modal backgrounds only need
            // one redraw when state or render resolution changes.
            const liveCanvas = gameState === 'PLAYING' || gameState === 'MENU' ||
                gameState === 'DYING_SEQUENCE';
            if (liveCanvas || canvasRenderInvalidated || lastCanvasRenderedState !== gameState) {
                renderGame();
                canvasRenderInvalidated = false;
                lastCanvasRenderedState = gameState;
            }
            capturePc3LongRunSample();
            if (performanceOverlayOn && frameMs > 0) {
                const renderCpuEnd = performance.now();
                perfRecentFrameMs[perfRecentFrameIndex] = frameMs;
                perfRecentFrameIndex = (perfRecentFrameIndex + 1) % PERFORMANCE_FRAME_WINDOW;
                perfRecentFrameCount = Math.min(PERFORMANCE_FRAME_WINDOW, perfRecentFrameCount + 1);
                performanceSampleFrames++;
                performanceSampleMs += frameMs;
                perfUpdateTotalMs += Math.max(0, renderCpuStart - frameCpuStart);
                perfRenderTotalMs += Math.max(0, renderCpuEnd - renderCpuStart);
                if (performanceSampleMs >= 1000) {
                    const frames = Math.max(1, performanceSampleFrames);
                    const fps = Math.round(performanceSampleFrames * 1000 / performanceSampleMs);
                    const frame = getPerformanceFrameStats();
                    const bufferMiB = (canvas.width * canvas.height * 4 / 1048576).toFixed(1);
                    document.getElementById('perfOverlay').textContent =
                        `Kalite ${graphicsQuality.toUpperCase()} | FPS ${fps} | Kare Ort/P95 ${frame.avgMs.toFixed(1)}/${frame.p95Ms.toFixed(1)}ms (son ${frame.sampleCount} kare)` +
                        ` | CPU Güncelleme/Çizim ${(perfUpdateTotalMs / frames).toFixed(1)}/${(perfRenderTotalMs / frames).toFixed(1)}ms` +
                        ` | Canvas ${canvas.width}x${canvas.height} (~${bufferMiB} MiB / tek RGBA tampon) DPR ${currentDpr.toFixed(2)}` +
                        ` | Düşman ${enemies.length} | Mermi ${bullets.length} | Rakip Atış ${enemyProjectiles.length}` +
                        ` | Küre ${orbs.length} | Efekt ${particles.length} | Sandık ${lootChests.length}` +
                        ` | FX çiz/atla ${pc3RenderCounts.visible}/${pc3RenderCounts.skipped}` +
                        ` | JS heap ${pc3LastHeapMiB === null ? 'destek yok' : pc3LastHeapMiB.toFixed(1) + ' MiB'}` +
                        ` (örnek ${pc3HistoryCount}, tepe ${pc3HeapPeakMiB.toFixed(1)} MiB)`;
                    performanceSampleFrames = 0;
                    performanceSampleMs = 0;
                    perfUpdateTotalMs = 0;
                    perfRenderTotalMs = 0;
                }
            }

            requestAnimationFrame(gameLoop);
        }

        // Read-only run counters for balancing; no data leaves the local browser.
        window.getNeonPerformanceSnapshot = () => ({
            frame: getPerformanceFrameStats(),
            nativeDpr: window.devicePixelRatio || 1,
            renderDpr: currentDpr,
            canvasWidth: canvas.width,
            canvasHeight: canvas.height,
            canvasBufferMiB: +(canvas.width * canvas.height * 4 / 1048576).toFixed(2),
            state: gameState,
            longRun: getPc3TelemetrySummary()
        });
        // On-demand copy of the last 60 minutes of opt-in 5-second samples.
        // No background recording, network upload or localStorage writes.
        window.getNeonPerformanceHistory = () => {
            const records = [];
            for (let i = 0; i < pc3HistoryCount; i++) {
                const index = (pc3HistoryNext - pc3HistoryCount + i + PC3_HISTORY_LIMIT) % PC3_HISTORY_LIMIT;
                const k = index * PC3_HISTORY_STRIDE;
                records.push({
                    gameSeconds: pc3History[k],
                    jsHeapMiB: pc3History[k + 1] || null,
                    enemies: pc3History[k + 2], bullets: pc3History[k + 3],
                    enemyProjectiles: pc3History[k + 4],
                    orbs: pc3History[k + 5], particles: pc3History[k + 6]
                });
            }
            return records;
        };
        window.getNeonRunDiagnostics = () => combatDirector ? combatDirector.getDiagnostics() : null;
        window.getNeonPlayerLearner = () => combatDirector ?
            combatDirector.playerLearner.getSnapshot() : null;
        window.clearNeonPlayerLearner = () => {
            try {
                localStorage.setItem(PLAYER_LEARNER_SAVE_KEY,'');
                if (combatDirector) combatDirector.playerLearner =
                    new OnlinePlayerLearner(player?.chassis||selectedChassis,
                        combatDirector.playerLearner.enabled);
                return true;
            } catch (e) { return false; }
        };
        window.getNeonIntensityHistory = () => combatDirector ?
            combatDirector.intensityObserver.getHistory() : [];
        window.getNeonEconomySnapshot = () => combatDirector ? combatDirector.getEconomySnapshot() : null;
        window.getNeonBastionStatus = () => getBastionStatus();
        window.getNeonPhaseEcho = () => getPhaseEchoSnapshot();
        window.getNeonCircuitWeaver = () => getCircuitWeaverSnapshot();
        window.getNeonArenaChapter = () => getArenaChapterSnapshot();
        window.getNeonNemesis = () => getNemesisSnapshot();
        window.getNeonPrismGuard = () => getPrismGuardSnapshot();
        window.getNeonMotionFx = () => motionFxSnapshot();
        window.getNeonFieldDevices = () => getFieldDeviceSnapshot();
        window.getNeonBuildSnapshot = () => player ? {
            modules: { ...player.upgradeCounts },
            evolutions: [...player.evolutions],
            synergies: [...player.synergies],
            guide: getBuildGuideModel(player),
            effects: { ...player.buildStats }
        } : null;
        window.onload = function () {
            loadMetaProgress();
            loadContractMastery();
            loadGraphicsQuality();
            resizeCanvas();
            initMenuDemoNodes();
            updateMenuCounters();
            scheduleMenuFit();
            document.getElementById('perfOverlay').classList.toggle('hidden', !performanceOverlayOn);
            requestAnimationFrame(gameLoop);
        };
