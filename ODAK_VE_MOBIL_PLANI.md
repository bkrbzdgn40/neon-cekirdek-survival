# Neon Çekirdek · Odak ve Mobil Planı

> Bu dosya proje kökünde durur ve Claude Code ile adım adım uygulanır.
> Her adımda bir **Claude Code komutu** (kopyala-yapıştır), **kabul kriterleri** ve **dikkat** notları var.
> Tamamlanan adımın kutusunu işaretle: `- [x]`.

---

## 0. Neden bu plan var (ölçülen durum)

Ölçümler 3 Kasım 2026'da `main @ 9b810e8` üzerinde, Chromium + Playwright ile alındı.

**Sistem yoğunluğu.** Bir dalga 16 saniye. İlk iki dakikada açılanlar:

| Zaman | Açılan sistem |
|---|---|
| 0 sn | Otomatik ateş, Atılım, EMP, Prizma, Momentum, Cinnet, kombo, görev, sözleşme (menüde) |
| 4 sn | Conduit bölgesi (ikmal) |
| 16 sn (dalga 2) | Saha cihazları |
| 48 sn (dalga 4) | Arena bölümleri, arena olayları, Saha Siperi (Bastion) |
| 55 sn | İlk boss |
| ~96 sn (dalga 7) | Nemesis / Echo Hunter |

Yükseltme havuzunda ise yalnızca **13 modül** ve **tek bir temel silah** (plazma) var. Modüllerin çoğu bu silahı değiştiriyor. Yani çevre sistemler, oyunu taşıyan build çeşitliliğinden daha zengin.

**HUD ve oynanacak alan ölçümü** (HUD'un üst bloğu ile alt bloğu arasındaki dikey boşluk):

| Görünüm | Ekran | Görünür HUD metni | Oynanacak alan |
|---|---|---|---|
| iPhone 13 dikey | 390×664 | 31 | **%47** |
| iPhone SE dikey | 320×568 | 31 | **%39** |
| iPhone 13 yatay | 750×342 | 45 | **%5**: oynanamaz |

Ek mobil sorunları:
- Dokunmatik ekranda klavye ipuçları gösteriliyor (`[E] veya [SAĞ TIK]`).
- Yatay görünümde "DALGA" etiketi kırpılıyor.
- Hareket mutlak dokunma konumuna bağlı (`updateTouchMovementTarget`). Bu yüzden parmak, çekirdeğin ve çevresindeki düşmanların üstünü kapatıyor.

---

## 1. Çalışma kuralları (her adımda geçerli)

1. **Özellikler donduruldu.** Bu plan bitene kadar yeni bir oyun sistemi eklenmez. Faz 3'teki yeni silahlar istisna; onlar yükseltme havuzunun içinde kalır.
2. **Bir adım = bir branch = bir PR.** Branch adı `odak/<adım-no>-<kısa-ad>`, örneğin `odak/1.2-unlock-tablosu`.
3. **Her adımın sonunda** şunlar çalıştırılır ve geçmelidir:
   ```sh
   node --test tests/smoke.test.cjs
   npx playwright test
   ```
4. **Yeni `docs/Mx.y-*.md` dosyası açılmaz.** Bu dosyadaki kutu işaretlenir. Değişiklikler kökteki tek bir `CHANGELOG.md` dosyasına 2–4 satırla yazılır.
5. **Kaynak koduna regex ile bakan testler** (`assert.match(html, /.../)` gibi): bir adım o kodu değiştiriyorsa, test silinir ve yerine davranışı ölçen bir test yazılır. Sırf regex'i tutturmak için kod biçimi korunmaz.
6. **Her PR'dan sonra en az 5 dakika kendin oyna.** Testlerin geçmesi oyunun iyi hissettirdiği anlamına gelmez.

Claude Code'a her oturumun başında şunu ver:

```
Proje kökündeki ODAK_VE_MOBIL_PLANI.md dosyasını oku. "Çalışma kuralları" bölümüne uy.
Şimdi yalnızca <ADIM NO> adımını uygula; başka adımlara geçme.
Bitince test komutlarını çalıştır, sonuçları ve değiştirdiğin dosyaları özetle.
```

---

## Faz 0 · Ölçüm altyapısı (yarım gün)

Önce mevcut durumu otomatik ölçen testler kurulur. Böylece Faz 1 ve 2'nin işe yarayıp yaramadığı sayılarla görülür.

### - [x] 0.1 HUD geometri testi

```
tests/hud.geometry.spec.cjs adında yeni bir Playwright testi yaz.
Oyunu index.html'den başlat (#startBtn), 4 saniye bekle ve şu görünümlerde ölç:
320x568 (iPhone SE), 390x664 (iPhone 13 dikey), 750x342 (iPhone 13 yatay, isMobile+hasTouch),
1280x800 ve 1366x768 masaüstü.

Her görünümde #hud içindeki görünür öğelerden şunları hesapla:
- "freePlayPct": ekranın ortasındaki en büyük HUD'suz dikdörtgenin alanı / ekran alanı.
  Basit yaklaşım: üst bloğun alt kenarı ile alt bloğun üst kenarı arasındaki dikey boşluk,
  sağ/sol kolonlar varsa yatayda da düş.
- Birbirinin üstüne binen görünür HUD öğesi çiftleri (iç içe olanlar hariç).
- scrollWidth > clientWidth olan, yani metni taşan öğeler.
- Dokunmatik görünümde 44x44 px'ten küçük tıklanabilir öğeler.

Hedef eşikler: dikey >= %70, yatay >= %65, masaüstü >= %80; çakışma 0; taşma 0; küçük hedef 0.
Şu an çoğu görünüm bu eşikleri geçemeyecek. Bu yüzden eşikleri tek bir sabit
nesnede tut ve testi şimdilik test.fixme ile işaretle. Ölçülen değerleri console'a
ve test-results/hud-metrics.json dosyasına yaz.
playwright.config.cjs içindeki mevcut projeleri bozma.
```

**Kabul:** `hud-metrics.json` üretiliyor ve değerler bu dosyadaki tabloya yakın çıkıyor (%47 / %39 / %5).

### - [x] 0.2 Test kısayolu: dalga ve kilit parametreleri

```
src/game.js içine yalnızca test ve playtest amaçlı iki URL parametresi ekle:
- ?wave=N  → startNewGame sonrası wave=N, totalTime=(N-1)*16, nextBossTime ileri alınır.
- ?unlock=all → Faz 1'de eklenecek kilit sisteminin hepsini açık sayar (şimdilik sadece
  okunan bir bayrak: window.NEON_UNLOCK_ALL).
Bunları mevcut ?perf=1 okuma deseniyle aynı yerde, tek bir fonksiyonla oku.
Smoke testine her iki parametrenin okunduğunu doğrulayan davranış testi ekle.
```

**Kabul:** `index.html?wave=10` ile oyun doğrudan 10. dalgadan başlıyor.

---

## Faz 1 · Kademeli açılım: sistemleri zamana yay (2–3 gün)

**Hedef:** İlk koşu yalnızca çekirdek döngüyü göstersin: hareket, otomatik ateş, Atılım, seviye atlama, boss. Diğer sistemler **koşular arası ilerlemeyle** açılsın ve her açılış bir ödül anı olsun. Bu, meta ilerlemeye de yeni bir anlam kazandırır.

### - [x] 1.1 Tek kaynaklı kilit tablosu

```
src/game.js içinde, META_SAVE_KEY tanımlarının yakınına şu yapıyı ekle:

const SYSTEM_UNLOCKS = Object.freeze([
  {id:'dash',        level:0, name:'Siber Atılım'},
  {id:'emp',         level:1, name:'EMP Nova'},
  {id:'quests',      level:1, name:'Görevler'},
  {id:'overdrive',   level:2, name:'Siber Cinnet'},
  {id:'prism',       level:2, name:'Prizma Karşılığı'},
  {id:'chapters',    level:3, name:'Arena Bölümleri'},
  {id:'conduits',    level:3, name:'İkmal Bölgeleri'},
  {id:'momentum',    level:4, name:'Momentum'},
  {id:'fieldDevices',level:4, name:'Saha Cihazları'},
  {id:'arenaEvents', level:4, name:'Arena Olayları'},
  {id:'bastion',     level:5, name:'Saha Siperi'},
  {id:'nemesis',     level:5, name:'Nemesis'},
  {id:'contracts',   level:6, name:'Neon Sözleşmeleri'}
]);

Kilit seviyesi (unlockLevel) kalıcı bir sayı olarak meta kayda eklenir
(META_SAVE_VERSION'ı 2'ye çıkar). loadMetaProgress v1 kaydı okurken
savedMaxWave >= 12 ise unlockLevel=6, değilse 0 kabul etsin. Bozuk ya da sınır dışı
değerler mevcut safeSaveInteger desenine göre 0..6 aralığına sıkıştırılsın.

isSystemUnlocked(id) fonksiyonu yaz: window.NEON_UNLOCK_ALL true ise her zaman true,
değilse SYSTEM_UNLOCKS'taki level <= unlockLevel.

Bu adımda henüz hiçbir sistemi kapatma; sadece tabloyu, kaydı ve fonksiyonu ekle.
YEDEK AL / YEDEK YÜKLE (createProgressBackup/parseProgressBackup) unlockLevel'ı da taşısın.
Smoke testleri: v1→v2 göçü, bozuk değer, yedekten geri yükleme.
```

### - [x] 1.2 Smoke test düzeneğini varsayılan olarak tüm kilitler açık hâle getir

```
tests/smoke.test.cjs içindeki setup() fonksiyonuna options.unlockAll ekle; varsayılan true.
true ise oyun kodu çalıştırılmadan önce sandbox.window.NEON_UNLOCK_ALL=true ayarlansın.
Tarayıcı testlerinde de (tests/*.spec.cjs) sayfa adresine ?unlock=all ekleyen ortak bir
yardımcı fonksiyon yaz ve mevcut page.goto çağrılarını ona taşı.
Amaç: 1.3'te sistemler kapatıldığında mevcut 424 testin anlamı değişmesin.
Kilitli davranışı test eden yeni testler unlockAll:false ile yazılacak.
```

**Kabul:** Tüm testler hiçbir kod değişmeden geçiyor.

### - [x] 1.3 Sistemleri kilide bağla

```
isSystemUnlocked kullanarak şu kapıları ekle (her biri tek satırlık erken dönüş olsun):
- EMP: Player'daki nova tetikleme ve #novaBtn görünürlüğü
- Prizma: activatePrismGuard ve #prismBtn
- Bastion: deployBastion ve #bastionBtn
- Görevler: generateNextQuest / updateQuest / #questHudBox
- Cinnet: Player.addOverdrive ve overdrive HUD barı
- Momentum: momentum artışı ve #momentumBar bloğu (kilitliyken momentum 0 kalır,
  ateş hızı bonusu uygulanmaz)
- Arena bölümleri: chapterIdForWave kilitliyken null dönsün
- Conduit: updateGame içindeki conduitSpawnTimer bloğu
- Saha cihazları: maybeSpawnFieldDevice
- Arena olayları: ArenaEvent üretimi
- Nemesis: nemesisAllowed
- Sözleşmeler: menüdeki #neonContractPanel gizlensin, activeContractId 'STANDARD' kalsın

Ayrıca UPGRADES_POOL öğelerine isteğe bağlı bir requires alanı ekle ve populateUpgradeCards
kilitli sisteme bağlı kartları filtrelesin:
overdrive_boost → 'overdrive', kinetic_magnet içindeki EMP kısmı → açıklamayı EMP
kilitliyken EMP'siz göster, phase_echo → 'dash' (zaten açık).

Kilitli bir sistemin HUD öğesi DOM'da gizlenir (hidden sınıfı); "kilitli" diye gösterilmez.
Her kapı için unlockAll:false ile davranış testi yaz.
```

**Kabul:** `?unlock=all` olmadan ilk koşuda HUD'da yalnızca XP, can, süre/dalga, skor, duraklat ve Atılım görünüyor. Oyun 3 dakika boyunca hatasız oynanıyor.

### - [x] 1.4 Kilit açma kuralı ve açılış anı

```
unlockLevel'ın nasıl artacağını uygula. Kural, koşu sonunda (triggerGameOver) değerlendirilir:
seviye L+1 açılır, eğer bu koşuda ulaşılan dalga >= UNLOCK_WAVE_GATES[L] ise.
UNLOCK_WAVE_GATES = [3, 5, 6, 8, 9, 11] (L=0..5).
Ayrıca 3 koşu üst üste kapı geçilemezse de bir sonraki seviye açılsın (takılıp kalmayı önler;
sayaç meta kayda girer).

Açılış anı: oyun sonu raporunun (renderRunReport) en üstünde, yeni açılan sistemleri
gösteren bir "YENİ PROTOKOL AÇILDI" bloğu. Her sistem için 1 cümlelik açıklama ve tuşu
(dokunmatikte buton). Menüdeki Kontroller sekmesi yalnızca açık sistemleri listelesin;
kilitli olanlar için tek satırlık "Dalga X'e ulaşınca açılır" ipucu yeterli.

Bir sonraki koşunun ilk 20 saniyesinde yeni açılan sistemin butonu nabız gibi
yanıp sönsün (prefers-reduced-motion'da yalnızca kenarlık).
```

**Kabul:** Temiz bir kayıtla dalga 3'e ulaşınca EMP ve Görevler açılıyor, rapor bunu gösteriyor ve sonraki koşuda EMP butonu vurgulanıyor.

### - [x] 1.5 Koşu içi aralık kuralı

```
Tüm kilitler açıkken bile ilk 2 dakikada çok fazla şey oluyor. Koşu içi ilk görünme
zamanlarını şu şekilde değiştir (değerleri ilgili *_RULES sabitlerinde tut):
- Conduit ilk spawn: 4 sn → 40 sn
- Saha cihazları firstWave: 2 → 5
- Arena bölümü başlangıcı: dalga 4 → dalga 6 (chapterIdForWave)
- Arena olayları minWave: 4 → 7
- Nemesis firstWave: 7 → 10
Ayrıca "60 saniyede en fazla bir yeni sistem duyurusu" kuralı koy: bir duyuru gösterilirken
başka bir sistem ilk kez geliyorsa, o sistemin ilk görünüşünü 20 sn ertele.
Etkilenen eski testlerdeki dalga sayılarını güncelle; regex testlerini davranış testine çevir.
```

**Kabul:** `?unlock=all` ile oynarken ilk 60 saniyede, dash ve ateş dışında en fazla 2 yeni sistem görünüyor.

---

## Faz 2 · HUD ve mobil yeniden tasarım (4–6 gün)

**Hedef:** Faz 0'daki geometri testinin bütün eşikleri geçmesi ve testin `fixme` işaretinin kaldırılması.

### - [x] 2.1 HUD envanteri ve karar tablosu

```
#hud içindeki her öğe için docs/HUD_ENVANTERI.md tablosu üret:
id/sınıf | ne gösteriyor | ne sıklıkla değişiyor | karar.
Karar sütununu şu kurala göre doldur ve bana sun, kod değiştirme:
- HER ZAMAN: can (+kalkan), XP/seviye, süre, duraklat; dokunmatikte yetenek butonları
- BAĞLAMSAL (sadece ilgiliyken görünür, sonra solar): boss barı (yalnız boss varken),
  kombo (>=5 iken), Cinnet (>=%80 veya aktifken), görev (ilerleme/tamamlanınca 3 sn),
  bölüm (duyuru sonrası küçük ikon), altın (toplayınca 2 sn)
- DURAKLATMA MENÜSÜ: kontrol modu, müzik, ses, build rehberi, aktif sözleşme, tam ekran
- KALDIR: TEHDİT/director phase etiketi, "NORMAL · STANDARD ARENA" rozeti, boss
  panelindeki ikinci (tekrar eden) can barı, dalga numarasının ayrı paneli (süreyle birleşir)
```

**Kabul:** Tabloyu sen onaylıyorsun. Gerekirse kararları değiştir, sonra 2.2'ye geç.

### - [x] 2.2 Masaüstü HUD diyeti

```
HUD_ENVANTERI.md'deki onaylı kararları masaüstünde uygula.
- Üst kısım tek satır: solda can barı (sayı içinde) + kalkan, ortada ince XP barı ve
  seviye, sağda süre (DALGA küçük üst yazı) + duraklat. Yükseklik en fazla 56 px.
- Alt kısım: yalnızca açık yeteneklerin küçük ikonları (48 px), radyal cooldown,
  altında tek harflik tuş ipucu. Metin açıklaması yok; açıklama tooltip ve duraklatma
  menüsünde.
- Bağlamsal öğeler için tek bir yardımcı yaz: showContextual(el, ms), CSS opacity
  geçişiyle; her öğe için ayrı zamanlayıcı yazma.
- updateHUD içinde her çağrıda getElementById yerine, HUD öğelerini bir kez önbelleğe al
  (const hudEls = {...}).
Boss barı: üst-ortada tek bar, en fazla 40 px; çoklu boss'ta isimler barın altında tek satır.
```

**Kabul:** 1366×768 ve 1280×800'de `freePlayPct >= %80`. Ekran görüntüsünü `press-capture/` altında karşılaştır.

### - [x] 2.3 Dokunmatik kontrol: göreli joystick

```
updateTouchMovementTarget mutlak konum kullanıyor ve parmak çekirdeği kapatıyor.
Bunu "dokunduğun yerde beliren sanal joystick"e çevir:
- touchstart'ta dokunma noktası joystick merkezi olur (ekranın sol %60'ında).
- touchmove'da merkezden olan fark → hareket yönü; 56 px'te tam hız; ölü bölge 8 px.
- Joystick'i canvas üzerinde yarı saydam iki halka olarak çiz (UI katmanında değil).
- Eski davranış ayarlarda "Parmağı takip et" seçeneği olarak kalsın, varsayılan joystick.
- Çoklu dokunma: hareket parmağı touch.identifier ile takip edilsin; yetenek butonlarına
  basmak hareketi kesmesin.
Playwright mobil testi: joystick ile 1 sn sağa sürükleyince player.x artmalı ve
sürükleme sırasında bir yetenek butonuna dokununca hareket durmamalı.
```

### - [x] 2.4 Mobil dikey HUD

```
max-width:639px ve (hover:none) için:
- Üst: tek satır, en fazla 48 px: can barı + seviye halkası + süre + duraklat.
  Momentum/Cinnet barları kaldırılır. Cinnet hazır olunca Cinnet butonu parlar.
- Alt sağ: yetenek butonları başparmak bölgesinde, yay şeklinde dizilmiş 56–64 px daireler;
  yalnızca ikon + radyal cooldown. Hiçbir klavye/fare ipucu görünmez:
  [E], [SAĞ TIK], [BOŞLUK] gibi metinleri (hover:none) ile gizle.
- Alt sol: joystick bölgesi boş kalır.
- Build rehberi, müzik/ses, kontrol modu yalnızca duraklatma menüsünde.
```

**Kabul:** 390×664'te `>= %70`, 320×568'de `>= %70`, çakışma 0, 44 px'ten küçük hedef 0.

### - [x] 2.5 Mobil yatay HUD

```
(orientation:landscape) and (max-height:500px) için ayrı yerleşim:
- Sol üst köşede kompakt can + seviye (tek satır, en fazla 36 px).
- Sağ üst: süre + duraklat.
- Yetenek butonları sağ kenarda dikey kolon (52 px).
- Alt kısımda hiçbir HUD öğesi olmasın.
Ayrıca dikey ekranda oyun başlarken bir kereliğine "Daha geniş görüş için telefonu yatay
çevir" ipucu göster (localStorage'da bir kez; zorlama yok).
```

**Kabul:** 750×342'de `freePlayPct >= %65`, "DALGA" etiketi kırpılmıyor, taşma 0.

### - [x] 2.6 Geometri testini etkinleştir

```
tests/hud.geometry.spec.cjs içindeki test.fixme'yi kaldır. Eşikleri sabit nesnede bırak.
Ayrıca bu görünümlerde kombo, boss barı ve Cinnet aktifken de (bağlamsal öğeler görünürken)
ölçüm yapan ikinci bir varyant ekle (?wave=8 ve boss'u tetikleyerek): bu durumda eşikler
5 puan düşük olabilir. CI'daki browser job'ı bu testi otomatik çalıştırır.
```

### - [x] 2.7 Gerçek cihaz turu (sen yaparsın)

- `python3 -m http.server 8000 --bind 0.0.0.0` çalıştır, telefondan aynı ağ üzerinden `http://<bilgisayar-ip>:8000` adresine gir.
- Telefonu hem dikey hem yatay tutarak 10'ar dakika oyna. `docs/DEVICE_QA.md` kontrol listesini doldur.
- Özellikle şunlara bak: başparmak hiçbir butonu yanlışlıkla tetikliyor mu, joystick kayıyor mu, boss sırasında okunabilirlik nasıl.

**Sonuç (4 Kasım 2026).** Tur TECNO CK6n (Android 14, Chrome) üzerinde yapıldı; ölçümler `docs/DEVICE_QA.md` içinde. Bulunan sorunlar 2.7a–2.7e olarak düzeltildi (PR #89–#93).

**Karar: masaüstü öncelikli.** Bu hâliyle telefon, masaüstündeki oyun hissini vermiyor: menü ve yükseltme kartları masaüstü için tasarlandığından kaydırma gerektiriyor. Oyun motoru telefonda yeterli (DÜŞÜK grafikte 60 fps), yeniden yazım gerekmiyor. Mobil ileride ayrı bir yaklaşımla ele alınacak: telefona özel ekranlar (tek ekran menü, kaydırmasız yükseltme seçimi), yalnızca yatay oyun ve tam ekran uygulama paketi. Faz 3'te mobil için yeni tasarım işi yapılmaz; mevcut mobil testler geçmeye devam eder.

---

## Faz 3 · Build derinliği (1–2 hafta)

**Hedef:** 13 modül ve tek silahtan, birbirinden farklı oynanan **8 silah + 10 pasif**e çıkmak. Faz 1 ve 2 bitmeden başlama: önce gösterilen şey sadeleşmeli, sonra içerik derinleşmeli.

### - [x] 3.0 Tohumlu rastgelelik (denge ölçümünün ön şartı)

```
src/game.js'e küçük bir tohumlu RNG ekle (mulberry32 yeterli): rng() ve setRunSeed(n).
Savaş/spawn/yükseltme ile ilgili Math.random çağrılarını rng()'ye çevir; yalnızca görsel
efektler (parçacık, sarsıntı, menü demo) Math.random'da kalabilir. Ayrımı fonksiyon
adına göre yap ve listeyi PR açıklamasına yaz.
?seed=N parametresi koşunun tohumunu sabitlesin. Smoke testi: aynı seed + aynı girdi
dizisi → aynı ilk 3 yükseltme seçeneği ve aynı ilk 20 spawn.
```

### - [x] 3.1 Silah / pasif ayrımı ve slot sınırı

```
UPGRADES_POOL öğelerine kind:'weapon'|'passive' alanı ekle.
Temel plazma silahı 1. silah slotunu kalıcı olarak kaplar. multishot onun yükseltmesidir:
kind:'weapon' olarak işaretlenir ama ayrı bir slot harcamaz.
Diğer silahlar: homing, orbital, lightning, circuit_weaver. Pasif: firerate, pierce_ricochet, crit_mastery,
vampiric, aegis_shield, kinetic_magnet, overdrive_boost, phase_echo.
Slot sınırı: 4 silah, 5 pasif (sabitlerde). Bir tür doluysa populateUpgradeCards o
türden yalnızca sahip olunan ve kademesi < 3 olan kartları önersin.
Yükseltme ekranında slotları gösteren ince bir satır: dolu slotlar ikon, boşlar çerçeve.
Kart üstünde yazan "SİLAH MODÜLÜ / SİSTEM MODÜLÜ" etiketlerini kind'a bağla
(getUpgradeCardPresentation).
Seviye atlama ekranına bir koşuda 2 kez kullanılabilen ücretsiz "ATLA" seçeneği ekle
(seçmeden devam, +%15 XP iadesi).
```

### - [x] 3.2 Silah ekleme şablonu

Faz 3'teki her yeni silah **ayrı bir PR**'dır ve şu komutla eklenir:

```
UPGRADES_POOL'a kind:'weapon' olan yeni bir silah ekle: <SİLAH ADI>.
Kurallar:
- Mevcut plazma silahından farklı bir konumlanma kararı yaratmalı (aşağıdaki tanımı uygula).
- Kendi update/draw fonksiyonları ve kendi MAX_* üst sınırı olsun; mevcut havuz
  dizilerini (bullets vb.) kullanabilir ama MAX_PLAYER_PROJECTILES'ı aşmasın.
- 3 kademe: kademe başına değerler bir *_RULES sabit nesnesinde.
- 3. kademede EVOLUTION_DEFS'e bir evrim ekle.
- WEAPON_SFX/HIT_SFX'e bir ses ailesi ekle, PROJECTILE_VISUAL_STYLES'a görsel.
- Grafik kalite "low"da efektleri azalt (getGraphicsPreset desenine uy).
- Smoke testi: kademe değerleri, üst sınır, evrim tetiklenmesi.
- scripts/sim-dps.cjs ile (3.3) DPS'i ölç ve PR açıklamasına yaz.
Tanım: <AŞAĞIDAN BİRİNİ YAPIŞTIR>
```

Önerilen silahlar (her biri farklı bir oyuncu davranışını ödüllendiriyor):

| Silah | Tanım (komuta yapıştır) | Ödüllendirdiği davranış |
|---|---|---|
| **Işın Kesici** | En yakın düşmana kilitlenen, yavaş dönen sürekli bir lazer; hareket ettikçe ışın sürüye doğru süpürülür. | Sürüyü bir çizgiye dizmek |
| **Mayın İzi** | Oyuncu hareket ettikçe arkasında 3–5 mayın bırakır, düşman yaklaşınca patlar. | Düşmanı peşinden sürüklemek (kite) |
| **Bumerang Disk** | Hareket yönüne fırlar, delip geçer ve oyuncuya geri döner; dönüşte de vurur. | Dönüş yoluna göre konum almak |
| **Şok Halkası** | Her 2,5 sn'de çekirdekten genişleyen bir halka; yakında daha çok hasar. | Kalabalığın içine dalmak |
| **Kuyruk Topu** | Hareket yönünün tersine ateş eder. | Kaçarken savaşmak |
| **Gravite Tohumu** | Bir noktaya düşer, 1,5 sn çevresindeki düşmanları çeker, sonra patlar. | Diğer silahlarla kombo kurmak |

Pasif hedefi: mevcut 8'e 2 yeni pasif (ör. **Soğutucu**: tüm cooldown'lar −%10/kademe; **Toplayıcı**: XP küresi değeri +%15/kademe).

### - [x] 3.3 DPS ve hayatta kalma simülasyonu

```
scripts/sim-dps.cjs yaz: smoke testindeki VM düzeneğini (setup) bir modüle taşı
(tests/harness.cjs) ve iki test dosyası da onu kullansın.
Simülasyon: ?seed sabit, oyuncu tek silah + belirli kademede, 30 saniye boyunca
120 px yarıçaplı bir dairede dönen bir bot; arena dalga 6 dengesinde.
Çıktı: silah × kademe için ortalama DPS, öldürme sayısı, alınan hasar.
Tablo olarak stdout'a ve sim-results.json'a yaz. CI'ye ekleme; elle çalıştırılır.
```

**Hedef denge bandı:** Aynı kademedeki silahların DPS'i birbirinin ±%25'i içinde kalmalı. Destek silahları (Gravite Tohumu gibi) bu kuralın dışında; onların PR açıklamasında gerekçesi yazılır.

### - [x] 3.4 Sinerjileri genişlet

```
SYNERGY_DEFS'i her yeni silah için en az bir pasifle eşleşecek şekilde genişlet (hedef 8+).
Her sinerjinin etkisi tek cümlede anlatılabilmeli. Sayısal küçük bonuslar değil,
davranış değişikliği olmalı (ör. Mayın İzi + Kinetik Türbin: dash bittiği yerde 3 mayın).
Yükseltme kartı bir sinerjiyi tamamlıyorsa bunu kartta göster (newSynergiesForUpgrade zaten var).
```

---

## Faz 3.6 · Ekonomi ve ilk izlenim (oyuncu testinden önce)

Kullanıcı kararı (2026-11-05): Laboratuvar bitince 40.000 altın boşta kalıyordu, menü de ilk izlenim için zayıftı. Seçilen yol: gelir ayarı (E1) + altınla içerik açma (E2) + Hangar menüsü (M2). Kural 1'in istisnası: yeni sistem eklenmez, mevcut şasi ve silahlar altına bağlanır.

### - [x] 3.6 Altın geliri ayarı

Ölçüm (ölümsüz bot, 20 dk, 2 tohum): Açgözlülük 8'de koşu başına 4.300–5.500 altın, Laboratuvarın tamamı ≈15.600. Altın küresi ve sandık altını dalga 20'den sonra büyümez; Açgözlülük kademe başına +%10 altın verir, XP'ye etkisi kalkar. Sonuç: koşu başına ≈350–700 altın.

### - [x] 3.7 Altınla içerik açma

Hayalet ve Titan şasileri ile Faz 3'te eklenen silah ve pasifler Laboratuvarda altınla açılır. Dalgayla açılan sistemler (Faz 1) değişmez. `?unlock=all` hepsini açar.

Sonuç: 7 içerik (`CONTENT_UNLOCKS`), toplam 7.800 altın. Hayalet 1.200, Titan 1.800, Mayın İzi 900, Bumerang Disk 1.100, Şok Halkası 1.300, Soğutucu 700, Toplayıcı 800. Kilitli şasi kartı fiyatını gösterir, tıklanınca Laboratuvarın Koleksiyon bölümü açılır.

### - [x] 3.8 Hangar ana menüsü

Ortada seçili şasi canlı ve büyük, solda şasi seçimi, sağda "sıradaki hedef" ve son koşu özeti. Kontroller ayrı bir sekmeye taşınır. 1280×800 ve 1920×1080'de boş bant kalmaz.

Sonuç: üç sütun aynı çizgide bitiyor (fark ≤2 px). Ortada canvas önizleme (DÜŞÜK grafikte ve azaltılmış harekette tek kare), sağda sıradaki hedef, başlangıç gücü ve son operasyon. Kontroller ve tehditler "Nasıl oynanır" penceresinde. Altı eski yerleşim regex testi silindi, yerine davranış testleri geldi.

### - [x] 3.9 Alan savunma görevi

Kullanıcı geri bildirimi: ilk dalgalarda düşmanlar alana varmadan ölüyor, savunma ilerlemesi geri sayıyordu (ilerleme yakında düşman şartına bağlıydı). Yeni kural (`DEFEND_RULES`): alanda durmak her zaman ilerletir, yakında düşman varsa 1,6 kat hızlı; geri sayım yalnız alan dışında, 0,4 hızla. Hedef 5 → 8 sn. Gerçek koşuda (dalga 3, 4 tohum) 5,2–6,9 sn'de tamamlanıyor.

### - [x] 3.10 Koleksiyonda dalga şartı

Koleksiyon içeriği önce bir dalga şartı ister, sonra altınla alınır. Şart sağlanmadan kart "Dalga X'e ulaş" der ve satın alınamaz.

Sonuç (rekor dalgaya göre): Soğutucu 3, Titan 4, Toplayıcı 5, Mayın İzi 6, Hayalet 7, Bumerang Disk 8, Şok Halkası 10. Önceden alınan içerik açık kalır. "Sıradaki hedef" alınabilecek içerik yoksa en yakın dalga şartını mor çubukla gösterir.

---

## Faz 4 · Kapalı test kapısı (oyunculara sunmadan önce)

Plan bittiğinde, oyunu herkese açmadan önce **3–5 tanıdığa** oynat. Onları izle ama yardım etme.

Sorulacak beş soru:
1. İlk 30 saniyede ne yapman gerektiğini anladın mı?
2. Seni ilk öldüren şey neydi, adil miydi?
3. Hangi yükseltmeyi neden seçtin?
4. Tekrar oynamak ister misin, neden?
5. Ekranda gereksiz bulduğun bir şey var mıydı?

**Çıkış kriteri:** 5 kişiden en az 3'ü kendiliğinden ikinci kez oynuyor ve kimse ilk 3 dakikada "ne oluyor?" demiyor. Bu kriter sağlanınca GitHub Pages açılır.

---

## Faz 4 geri bildirimi

### - [x] 4.1 Devre süresi ve sayaç
Devre penceresi 9 → 14 sn, kapanma yarıçapı 42 → 56. Başlangıç halkasında geri sayım yayı ve "BAŞLANGICA DÖN" yazısı.

### - [x] 4.2 Görev rehberi
Her görev/olay ilk görüldüğünde oyunu durduran tek seferlik rehber: hedef vurgulanır, canlı mini-demo oynar.

### - [x] 4.3 Kart enderliği her kartta güç farkı
Soğutucu, Toplayıcı, Devre Örücü ve Faz Yankısı enderlikle büyür (NADİR = eski değer). Kart açıklaması gerçek sayıyı yazar.

### - [x] 4.4 Dirilme ekonomisi
En fazla 3 ücretsiz hak, koşu başına 1 altınlı dirilme (fiyat dalgayla artar), azalan dirilme canı, +50 Cinnet kalkar; fazla Laboratuvar kademesi iade edilir.

### - [x] 4.5 Kızıl Makas görseli ve tehlikesi
### - [x] 4.6 İyon Korosu görseli
### - [x] 4.7 Faz Kıskacı görseli
Biyom olayları animasyonlu tuval çizimi olur; dosya eklenmez, düşük grafikte sadeleşir.

### - [x] 4.8 Rapor ve laboratuvar ekrana sığar
Laboratuvar raporun üstünde açılır; menüye dönünce açık kalan laboratuvar kapanır. Masaüstünde rapor pencereye sığar, sadece sekme içeriği kayar.

### - [x] 4.9 Kızıl Makas yatay raylar ve rastgele çeneler
Biyomun yatay ısı rayları da dişli çenelerle canlanır; olayda preslerin yönü ve yeri rastgele seçilir, uyarı süresi aynı kalır.

### - [x] 4.10 İyon Korosu ve Faz Kıskacı ikinci tur
İki biyomun zemini ve iki olayın sahnesi daha zengin animasyon alır; kural aynı, düşük grafikte sadeleşir.

## Faz 5 · Eklenebilirler
Kaynak: eklenebilirler.txt. Kostümler sadece görünüşü değiştirir, güç vermez.

### - [x] 5.1 Düşman sözlüğü
TEHDİTLER sekmesi sözlük olur: karşılaşılan düşman (ve elit) kaydedilir, adı, ne yaptığı, nasıl yenileceği ve imha sayısı görünür; görülmeyenler siluet olarak durur.

### - [x] 5.2 Kostümler
4 kategoride 16 kostüm: çekirdek rengi, iz efekti, çekirdek şekli, arena paleti. Laboratuvarda doğrudan satılır.

### - [x] 5.3 Veri Kapsülü
Daha ucuz kapsül, sahip olunmayan kostümlerden birini rastgele verir; asla tekrar çıkmaz.

### - [ ] 5.4 Yeni şasi
Kapalı test verisi bekliyor: hangi şasinin ne kadar seçildiğine göre 1–2 rol eklenir.

### - [x] 5.5 Koşu sonu hedefi
Rapor, sıradaki hedefi bu koşunun altınıyla gösterir ("bir koşu daha yeter" / "yaklaşık N koşu"); hazırsa doğrudan laboratuvarda açar. Yeni rekor eski skoru ve farkı yazar, parlar ve ses çalar.

### - [x] 5.6 Teknik temizlik
Test bağımlılığı `package.json` + kilit dosyasında tek yerde; CI `npm ci` kullanır. Sözleşme ustalığı yedeğe girer; eski yedekler ustalığa dokunmaz.

### - [x] 5.7 Ana menü tek ekran
Masaüstünde ana menü 540 px yüksekliğe kadar kaydırmasız sığar: sözleşmeler ortadaki boşluğa taşınır, kısa pencerede ikincil açıklamalar gizlenir. Mobilde sözleşmeler artık başlat düğmelerinin hemen üstünde.

## Özet takvim

| Faz | Süre (tahmini) | Sonuç |
|---|---|---|
| 0 | ½ gün | HUD ölçülüyor, test parametreleri var |
| 1 | 2–3 gün | İlk koşu sade; sistemler koşular arasında açılıyor |
| 2 | 4–6 gün | Mobil dikey ve yatay oynanabilir; HUD testleri CI'da |
| 3 | 1–2 hafta | 8 silah + 10 pasif, slot sınırı, denge simülasyonu |
| 4 | 1 hafta | Kapalı test → yayın kararı |
