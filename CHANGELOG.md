# Değişiklik Günlüğü

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
