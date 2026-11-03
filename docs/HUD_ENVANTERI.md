# HUD envanteri ve karar tablosu (Odak 2.1)

`#hud` içindeki her öğe, ne gösterdiği, ne sıklıkla değiştiği ve Faz 2'de ne olacağı.
Kod bu adımda değişmedi. Kararlar onaylandı; 2.2–2.5 bu tabloya göre uygulanır.

- **Kaynak:** `index.html` (satır 30–244) ve `src/game.js` (`updateHUD` saniyede 10 kez çalışır, `HUD_REFRESH_INTERVAL = 0.10`).
- **Karar türleri:** HER ZAMAN · BAĞLAMSAL (yalnızca ilgiliyken görünür, sonra solar) · DURAKLATMA MENÜSÜ · KALDIR.
- **★** işaretli satırlar: plandaki kural bu öğeden söz etmiyor; karar önerildi ve onaylandı.

## Karar tablosu

### Üst blok · durum çubukları (`.hud-signal-deck`)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `.hud-meter-xp` (`#xpBar`, `#levelText`, `#xpText`) | XP çubuğu, seviye, "XP 40 / 125" | XP her öldürme ve toplamada; seviye ilk dakikalarda 20–40 sn'de bir | **HER ZAMAN** · ince bar ve seviye. "XP 40 / 125" sayısı kalkar |
| `.hud-meter-momentum` (`#momentumBar`, `#momentumText`) | Momentum yüzdesi (ateş hızı bonusu) | Hareket ve öldürmeyle sürekli | ★ **BAĞLAMSAL** · yalnızca ≥ %80 iken, Cinnet ile aynı eşik. Mobilde 2.4 gereği tamamen kalkar |
| `.hud-meter-overdrive` (`#overdriveBar`, `#overdriveText`) | Cinnet doluluğu, aktifken kalan süre | Öldürmeyle dolar; aktifken saniyede bir | **BAĞLAMSAL** · ≥ %80 ya da aktifken |

### Üst blok · can ve kaynaklar (`.hud-vitals-group`)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `.hud-vitals` (`#hpBar`, `#hpText`) | Can çubuğu ve "100/100" | Hasar ya da iyileşmede, olay anında | **HER ZAMAN** · sayı barın içine girer |
| `#shieldIndicator` | Kalkan: AKTİF ya da bekleme saniyesi | Kalkan modülü alınınca görünür; beklemede saniyede bir | **HER ZAMAN** · can barının yanında ikon. Yalnızca kalkan modülü varken |
| `#reviveIndicator` | Diriliş hakkı "1x" | Koşuda en fazla birkaç kez | ★ **HER ZAMAN** · can barının yanında metinsiz küçük ikon; hak bitince ikon söner |
| `.hud-gold-panel` (`#goldHudText`) | Altın bakiyesi | Toplamada, sık | **BAĞLAMSAL** · toplayınca 2 sn |
| `#questHudBox` (≥ 1280 px) ve `#questMobileText` kutusu (< 1280 px) | Görev: "AV · 3/15 · +40" | Görev ilerledikçe; yenisi tamamlanınca | **BAĞLAMSAL** · ilerleme ya da tamamlanmada 3 sn. İki ayrı öğe tek öğede birleşir |

### Üst blok · dalga paneli (`.hud-wave-panel`)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `#waveText` (DALGA kutusu) | Dalga numarası | 16 sn'de bir | **KALDIR** (ayrı panel olarak) · süre kutusunun üstüne küçük "DALGA 4" yazısı olur |
| `#timeText` (SÜRE kutusu) | Koşu süresi | Saniyede bir | **HER ZAMAN** |
| `#directorPhaseText` (TEHDİT) | Yönetmen evresi: HAZIRLIK / BASKI / KRİZ / NEFES / BOSS | Evre geçişlerinde, 10–30 sn'de bir | **KALDIR** |
| `#activeContractBadge` | Aktif sözleşme kimliği ("STANDARD") | Koşu içinde hiç | **DURAKLATMA MENÜSÜ** |
| `#arenaChapterChip`, bölüm yokken | "NORMAL · STANDARD ARENA" | Hiç | **KALDIR** |
| `#arenaChapterChip`, bölüm varken | Bölüm adı ve durum: "ISI YÜKLENİYOR · 2.1 sn" | Bölüm 3 dalgada (48 sn) bir değişir; durum saniyede 10 kez | **BAĞLAMSAL** · duyurudan sonra küçük ikon. Durum metni yalnızca tehlike anında görünür ★ |
| `#arenaChapterMobile` (< 640 px) | Bölüm çipinin mobil kopyası | Bölüm çipiyle aynı | **KALDIR** · bölüm ikonunda birleşir |

### Üst blok · skor ve düğmeler (`.hud-score-panel`)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `#comboContainer` (`#comboRankText`, `#comboText`, `#comboTimerBar`) | Kombo rütbesi, çarpanı ve süre çubuğu | Her öldürmede; süre çubuğu sürekli | **BAĞLAMSAL** · ≥ 5 iken. Bugün > 1 iken görünüyor |
| `#scoreText` (SKOR) | Skor | Her öldürmede | ★ **DURAKLATMA MENÜSÜ** · ayrıca oyun sonu raporunda var. Hızlı değişiyor ama savaşta karar verdirmiyor |
| `#fullscreenBtn` | Tam ekran düğmesi | Hiç | **DURAKLATMA MENÜSÜ** · F tuşu kalır |
| `#pauseBtn` | Duraklat düğmesi | Hiç | **HER ZAMAN** |

### Üst blok · boss paneli (`#bossHudContainer`)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `#bossHudContainer` + `#bossHpBar` | Toplam boss canı çubuğu | Boss varken sürekli; ilk boss 55. sn'de, sonra 42–58 sn arayla | **BAĞLAMSAL** · yalnızca boss varken, tek bar |
| `#bossNameText` | Boss adı ya da "ÇOKLU BOSS · 2 HEDEF" | Boss başına bir kez | **BAĞLAMSAL** · barla birlikte |
| `#bossPhaseText` | "FAZ 2 / 3" | Boss başına 2 kez | **BAĞLAMSAL** · barla birlikte |
| `#bossHpText` | "1840 / 2500" | Boss varken sürekli | **BAĞLAMSAL** · barın içinde |
| "TAB HEDEF DEĞİŞTİR" yazısı | Klavye ipucu | Hiç | ★ **DURAKLATMA MENÜSÜ** · kontrol listesine taşınır; dokunmatikte zaten anlamsız |
| `#bossIdentityStrip`, tek boss | Her boss için çip: ad, faz, can, ikinci can barı | Boss varken sürekli | **KALDIR** · ana barı tekrarlıyor |
| `#bossIdentityStrip`, çoklu boss | Boss başına çip | Boss varken sürekli | **BAĞLAMSAL** · 2.2 gereği barın altında tek satırlık adlar; ikinci can barları kalkar |
| `#bossWarningBanner` | "BOSS YAKLAŞIYOR" | Her boss'tan önce 3.8 sn | ★ **BAĞLAMSAL** · bugünkü gibi |

### Üst blok · olay şeritleri

Hepsi bugün de yalnızca olay sırasında görünüyor.

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `#arenaChapterAnnouncement` | Bölüm ya da gösteri adı ve ipucu | Bölüm başında 5 sn, gösteride 3 sn | **BAĞLAMSAL** · bu duyurudan sonra bölüm küçük ikona iner |
| `#arenaShowcaseBanner` | Gösteri operasyonu ve ilerleme | Gösteri boyunca (bölüm başına bir kez) | ★ **BAĞLAMSAL** · bugünkü gibi |
| `#nemesisBanner` | "YANKI AVCISI · ÇAPRAZ KİLİT · 1.2 sn" | Nemesis sahadayken (13 sn), saniyede 10 kez | ★ **BAĞLAMSAL** · bugünkü gibi |
| `#fieldDeviceBadge` | Saha cihazı durumu ("REAKTÖR PATLAYACAK · 2.4sn · UZAKLAŞ") | Cihaz sahadayken (13.5 sn) | ★ **BAĞLAMSAL** · bugünkü gibi, metin kısalır |
| `#tacticalHintBadge` | Kalkanlı ya da yandan gelen düşman ipucu | Bu düşmanlar sahadayken | ★ **BAĞLAMSAL** · bugünkü gibi |
| `#killstreakBanner` | "KOMBO SERİSİ" gibi ödül şeridi | Olayda 2.4 sn | ★ **BAĞLAMSAL** · bugünkü gibi |

### Alt blok · ayarlar ve build (`.hud-command-deck`, sol)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `#ctrlToggleBtn` (`#ctrlModeText`) | Kontrol modu "HİBRİT · M" | Yalnızca oyuncu değiştirince | **DURAKLATMA MENÜSÜ** · M tuşu kalır |
| `#musicToggleBtn` | Müzik aç/kapat | Yalnızca oyuncu değiştirince | **DURAKLATMA MENÜSÜ** |
| `#soundToggleBtn` | Ses efektleri aç/kapat | Yalnızca oyuncu değiştirince | **DURAKLATMA MENÜSÜ** |
| `#hudModulesDock` (≥ 1024 px) | Alınan modül ikonları ve sinerjiler | Her seviye atlamada | ★ **DURAKLATMA MENÜSÜ** · build rehberiyle aynı bölümde |
| `#buildGuidePanel` | "BUILD · 0 EVRİM / 0 SİNERJİ" ve açılır rehber | Her seviye atlamada | **DURAKLATMA MENÜSÜ** |

### Alt blok · yetenekler (`.hud-action-bay`)

| id / sınıf | Ne gösteriyor | Ne sıklıkla değişiyor | Karar |
|---|---|---|---|
| `#dashBtn` | Siber Atılım: ad, tuş, bekleme | Kullanımda; bekleme saniyede 10 kez | **HER ZAMAN** · dokunmatikte buton. Masaüstünde 2.2 gereği 48 px ikon, radyal bekleme, tek harf tuş; ad ve uzun tuş metni tooltip'e gider |
| `#novaBtn` | EMP Nova | Aynı | **HER ZAMAN** · açıksa (1.3 kilidi) |
| `#prismBtn` | Prizma Karşılığı | Aynı | **HER ZAMAN** · açıksa |
| `#bastionBtn` (`#bastionCostText`, `#bastionStatus`) | Saha Siperi: maliyet, hak, durum | Altın ve hak değiştikçe | **HER ZAMAN** · açıksa. Maliyet ve hak metni tooltip'e, ikonda yalnızca durum |

`#hud` dışında kalan `#lowHpOverlay` (düşük can kızıllığı) bu tabloya dahil değil, olduğu gibi kalır.

## Ölçüm: bugün hangi öğe nerede görünüyor

Ölçüm `?unlock=all` ile, oyun başladıktan yaklaşık 2 sn sonra yapıldı. Kombo 1'e sabitlendi; 0.1'deki notta söylendiği gibi kombo kutusu ölçümü koşudan koşuya değiştiriyor.

- **Sakin:** Dalga 1.
- **Yoğun:** Dalga 8, boss, kombo 6, Cinnet aktif, kalkan, ödül şeridi.

| Öğe | 320×568 | 390×664 | 750×342 | 1280×800 | 1366×768 |
|---|---|---|---|---|---|
| XP / Momentum / Cinnet barları | 3 bar (2 satır) | 3 bar (2 satır) | 3 bar | 3 bar | 3 bar |
| Can, diriliş, altın | ✓ | ✓ | ✓ | ✓ | ✓ |
| Görev | mobil kutu | mobil kutu | mobil kutu | masaüstü kutu | masaüstü kutu |
| Dalga + süre | ✓ | ✓ | ✓ | ✓ | ✓ |
| TEHDİT, sözleşme, bölüm çipi | – | – | ✓ | ✓ | ✓ |
| Skor, tam ekran, duraklat | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kontrol modu, müzik, ses, build | ✓ | ✓ | ✓ | ✓ | ✓ |
| Modül dock'u | – | – | – | ✓ | ✓ |
| 4 yetenek butonu | 71×46 | 87×46 | 146–212 × 87–102 | 189–270 × 50–60 | 189–270 × 50–60 |
| Yoğunda boss paneli | 308×115 | 372×103 | 672×111 | 672×111 | 672×111 |
| Yoğunda ödül şeridi | 308×43 | 372×43 | 710×46 | 1232×46 | 1318×46 |

Ölçümde öne çıkanlar:
- **Tam ekran, duraklat, müzik ve ses düğmeleri** her görünümde 44 px'in altında (36×36, 22×14, 26×20). Duraklat düğmesi HER ZAMAN kalacağı için 2.4–2.5'te büyümesi gerekiyor.
- **750×342'de yetenek butonları** 87–102 px yükseklikte. Alttaki blok ekranın yaklaşık üçte birini kaplıyor. Bu, %5'lik oynanacak alanın asıl sebebi.
- **İlk koşuda (kilitler kapalı)** 1.3'ün kabul listesinin dışında hâlâ görünenler: altın, diriliş, tam ekran, kontrol modu, müzik, ses ve build rehberi; ≥ 1280 px'te TEHDİT ve modül dock'u da. Yukarıdaki kararlar uygulanınca bunların hepsi ya duraklatma menüsüne gidiyor ya da kalkıyor.

## Sonraki adımlara etkisi

- **Duraklatma menüsü:** Bugün yalnızca grafik, devam, yeniden başla ve menü düğmeleri var. 2.2 buna şunları ekler:
  - kontrol modu, müzik, ses;
  - build rehberi ve modül listesi;
  - aktif sözleşme, skor, tam ekran;
  - klavye ipuçları.
- **1.4 vurgusuyla çakışma:** 1.4'ün 20 sn'lik vurgusu Cinnet, Momentum, görev ve bölüm öğelerinin üzerinde yanıyor. Bu öğeler BAĞLAMSAL olunca vurgu süresince görünür tutulmaları gerekiyor; yoksa vurgu gizli bir öğeye düşer. 2.2'de `showContextual` bu durumu da kapsamalı.
- **Kaldırılan ya da taşınan öğeleri okuyan testler:** Smoke ve tarayıcı testleri `#arenaChapterBadge`, `#arenaChapterStatus`, `#arenaChapterMobile`, `#scoreText` ve `#momentumText` öğelerine bakıyor; tarayıcı testleri ayrıca `#activeContractBadge` öğesine. 2.2'de bunlar kural 5'e göre davranış testine çevrilecek.

## Onaylanan kararlar (3 Kasım 2026)

Tablo, ★ işaretli öneriler dahil olduğu gibi onaylandı. Açık kalan dört soru şöyle karara bağlandı:

1. **Momentum:** Masaüstünde yalnızca ≥ %80 iken bağlamsal görünür. Mobilde kalkar.
2. **Skor:** Savaş sırasında gizlenir. Yalnızca duraklatma menüsünde ve oyun sonu raporunda görünür.
3. **Diriliş hakkı:** Can barının yanında metinsiz ikon olarak kalır.
4. **Bölüm durum metni:** Yalnızca tehlike anında görünür; geri kalan zamanda yalnızca bölüm ikonu kalır.
