# Değişiklik Günlüğü

## Odak 2.2 · Masaüstü HUD diyeti
- Üstte tek satır (can + kalkan + diriliş | ince XP ve seviye | DALGA üst yazılı süre + duraklat), altta yalnızca açık yeteneklerin 48 px ikonları: radyal bekleme, tek harf tuş ipucu, açıklamalar tooltip'te.
- Altın, görev, kombo (≥ 5), Momentum ve Cinnet (≥ %80), bölüm ikonu tek `showContextual(el, ms)` yardımcısıyla bağlamsal; HUD düğümleri `hudEls` ile bir kez önbelleğe alınır.
- TEHDİT etiketi, NORMAL rozeti, mobil bölüm şeridi, ayrı dalga paneli ve tek boss'taki ikinci can barı kalktı; skor, sözleşme, kontrol modu, müzik, ses, tam ekran, build ve kısayollar duraklatma menüsünde.
- Oynanacak alan: 1280×800 %59.8 → %84.5, 1366×768 %66.4 → %83.9. Geometri testi ölçümden önce komboyu sabitler, kombo açık hâli ayrı ölçülür.

## Odak 2.1 · HUD envanteri ve karar tablosu
- `docs/HUD_ENVANTERI.md`: `#hud` içindeki her öğe için (42 satır) ne gösterdiği, ne sıklıkla değiştiği ve kararı (HER ZAMAN / BAĞLAMSAL / DURAKLATMA MENÜSÜ / KALDIR).
- 5 görünümde sakin ve yoğun durum ölçümü; plan kuralının söz etmediği öğeler ★ ile işaretli, 4 açık soru onaya sunuldu.
- Kod değişmedi.

## Odak 1.5 · Koşu içi aralık kuralı
- İlk görünmeler ertelendi: ikmal 3→40 sn (`CONDUIT_RULES`), saha cihazları dalga 2→5, arena bölümleri 4→6 (gösteri dalgası 5→7), arena olayları 4→7 (`ARENA_EVENT_RULES`), Nemesis 7→10.
- 60 sn'de en fazla bir sistem ilk kez görünür; sırası gelmeyen 20 sn sonra yeniden dener ve kendi dalga takviminin dışına da düşebilir (`SYSTEM_INTRO_RULES`).
- Eski bölüm, Nemesis, saha cihazı ve arena testlerindeki dalgalar kaydırıldı; `?unlock=all` ile ilk 60 sn tarayıcı testi eklendi.

## Odak 1.4 · Kilit açma kuralı ve açılış anı
- Koşu sonunda ulaşılan dalga `UNLOCK_WAVE_GATES = [3, 5, 6, 8, 9, 11]` kapısını geçerse bir seviye açılır; 3 koşu üst üste geçilemezse yine açılır (sayaç meta kayıtta ve yedekte).
- Oyun sonu raporunun en üstünde "YENİ PROTOKOL AÇILDI" bloğu: her yeni sistem için bir cümle ve tuşu (dokunmatikte buton).
- Menü Kontroller sekmesi yalnızca açık sistemleri gösterir, altında "Dalga X'e ulaşınca açılır" satırı; sonraki koşunun ilk 20 sn'sinde yeni sistemin HUD öğesi nabız gibi yanar (azaltılmış harekette yalnızca kenarlık).
- `?unlock=all` kalıcı kilit ilerlemesini değiştirmez.

## Odak 1.3 · Sistemleri kilide bağla
- 12 sistem `isSystemUnlocked` ile tek satırlık erken dönüşlerle kapandı (EMP, Prizma, Siper, Görevler, Cinnet, Momentum, Bölümler, İkmal, Saha cihazları, Arena olayları, Nemesis, Sözleşmeler).
- Kilitli sistemin HUD/menü öğesi `system-locked` sınıfıyla gizlenir; kartlar `requires` alanıyla filtrelenir, Kinetik Türbin EMP kilitliyken EMP'siz anlatılır.
- Her kapı için kilitli/açık smoke testi ve 180 sn'lik kilitli koşu tarayıcı testi eklendi.

## Odak 1.2 · Testlerde varsayılan olarak tüm kilitler açık
- Smoke `setup()` artık `NEON_UNLOCK_ALL=true` ile başlar; kilitli davranış testleri `{ unlockAll: false }` geçer.
- Tarayıcı testleri oyunu `tests/browser.helpers.cjs` içindeki `gotoGame()` ile `?unlock=all` ekleyerek açar.
- Kural 5: capture testindeki `page.goto('/index.html'` regex kontrolü silindi; yerine yardımcının davranış testi yazıldı.

## Odak 1.1 · Tek kaynaklı kilit tablosu
- `SYSTEM_UNLOCKS` (13 sistem, seviye 0–6) ve `isSystemUnlocked(id)` eklendi; henüz hiçbir sistem kapatılmadı.
- Meta kayıt v2: kalıcı `unlockLevel`. v1 kayıtlar okunurken `maxWave >= 12` ise 6, değilse 0; bozuk değerler 0..6'ya sıkıştırılır.
- Yedek al/yükle `unlockLevel`'ı taşır; eski (v1) yedekler aynı kuralla göç eder.

## Odak 0.2 · Test kısayolu: dalga ve kilit parametreleri
- `?wave=N` (1–99) koşuyu N. dalgadan başlatır; süre `(N-1)*16` sn ileri alınır, ilk boss yine 55 sn sonra gelir.
- `?unlock=all` yalnızca `window.NEON_UNLOCK_ALL = true` bayrağını kaldırır; kilit sistemi Faz 1'de bu bayrağı okuyacak.
- İkisi de `readPlaytestParams` ile `?perf=1` okuyucusunun yanında okunur; smoke ve tarayıcı testleri eklendi.

## Odak 0.1 · HUD geometri testi
- `tests/hud.geometry.spec.cjs`: 5 görünümde (320×568, 390×664, 750×342 dokunmatik; 1280×800, 1366×768) oynanacak alan, HUD çakışması, metin taşması ve 44 px altı dokunma hedeflerini ölçer.
- Ölçümler console'a ve `test-results/hud-metrics.json` dosyasına yazılır; eşik testi `HUD_THRESHOLDS` ile `test.fixme` altında bekler.
- `playwright.config.cjs`: mevcut projelere dokunmadan ayrı `hud-geometry` projesi eklendi.

## Odak 0.0b · CI: Playwright 1.64.1
- GitHub `ubuntu-latest` etiketi Ubuntu 26.04'e geçti; Playwright 1.56.1 orada Chromium kuramadığı için `browser` ve `soak` işleri düşüyordu.
- CI, README ve M5.28 belgesindeki Playwright sürümü 1.64.1'e yükseltildi (Ubuntu 26.04 destekli).
