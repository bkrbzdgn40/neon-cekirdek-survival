# Neon Çekirdek: Hayatta Kal

Tarayıcıda çalışan, statik Canvas 2D arena-survival oyunu. GitHub **main** dalındaki [index.html](index.html) giriş sayfasıdır; gerçek oyun kodu [src/game.js](src/game.js), stil katmanı [src/game.css](src/game.css) ve yerel [src/utilities.css](src/utilities.css) dosyalarındadır. Bunların tamamı birlikte güncel uygulamanın kaynaklarıdır. [Geliştirme yol haritası](Neon_Cekirdek_Gelistirme_Yol_Haritasi.txt) tarihsel tasarım ve değişiklik notları da içerir; güncel CI/test sayısını ya da mevcut PR durumunu temsil etmez.

## Oyunu çalıştırma

[**index.html**](index.html) dosyasını modern bir tarayıcıyla açın. Yerel HTTP sunucusu tercih ederseniz depo kökünden:

```sh
python -m http.server 8000
```

Ardından `http://localhost:8000` adresine gidin. Oyun için `npm install`, derleme, ayrı bir API veya veritabanı gerekmiyor. CSS, ikonlar ve Orbitron/Rajdhani fontları artık **depodaki statik dosyalardan** yüklenir. Oyun açılırken Tailwind, Font Awesome veya Google Fonts CDN bağlantısı gerekmez. CSS/bağımlılıklar güncellendiğinde [yeniden derleme rehberi](docs/OFFLINE_ASSETS.md) kullanılır.

## Çalışma modları

| Parametre | Davranış |
| --- | --- |
| Yok / `?tempo=classic` | Varsayılan klasik savaş temposu |
| `?tempo=adaptive` | Yerel gözlemciye dayalı adaptif normal spawn temposu |
| `?learn=on` | Oyuncu risk tahmin modeli için **gölge öğrenme**; düşman üretimini/ödülleri yönetmez |
| `?tempo=adaptive&learn=on` | Adaptif tempo ve birbirinden ayrı gölge öğrenme |
| `?perf=1` | Performans telemetrisi seçeneği; masaüstünde F3 ile panel açılıp kapatılabilir |

Altın, meta yükseltmeler, grafik ayarları ve isteğe bağlı karşılaştırma/öğrenme kayıtları tarayıcının `localStorage` alanında tutulur. Sunucu hesabına senkronize edilmez; site verileri silinirse kayıtlar kaybolabilir. **Başlangıç menüsündeki YEDEK AL / YEDEK YÜKLE**, altın, rekor, dalga, kalıcı geliştirmeler ve grafik profilini JSON dosyasıyla **elle** aktarır. Öğrenen model ve tempo karşılaştırma kayıtları bu yedeğe dahil değildir. Yedek dosyası güvenli bir yerde saklanmalıdır.

## Geliştirici notları

- HTML: [index.html](index.html); oyun kodu: [src/game.js](src/game.js); stil: [src/game.css](src/game.css); üretim CSS'i: [src/utilities.css](src/utilities.css)
- Node.js 22 ile çalışan, gerçek oyun kodunu VM sahte DOM ortamında sınayan regresyon seti: [tests/smoke.test.cjs](tests/smoke.test.cjs)
- Her PR ve `main` push'unda Node ve Chromium smoke testleri: [.github/workflows/neon-smoke.yml](.github/workflows/neon-smoke.yml)
- Mimari ve tamamlanan geliştirmelerin ayrıntıları: [docs/](docs/)

```sh
node --test tests/smoke.test.cjs
```

**Doğrulama sınırı:** Node smoke seti oyun mantığını sınar. GitHub Actions içindeki Playwright, gerçek Chromium'da masaüstü ve mobil viewport ile temel menü/oyun etkileşimlerini sınar. Masaüstü/mobil temel akışlar, üç viewport'ta yatay taşma ve kısa canlı savaş/çizim ilerlemesi CI kapsamındadır. Ekran görüntüsü baseline karşılaştırması ve uzun oturum gerçek cihaz FPS ölçümü henüz kapsamda değildir; [cihaz QA protokolü](docs/DEVICE_QA.md) uygulanmalıdır. Yerel tarayıcı testleri için `npm install --no-save --no-package-lock @playwright/test@1.56.1`, `npx playwright install chromium`, `npx playwright test` komutları kullanılabilir.

## Katkı düzeni

HTML, CSS ve klasik JavaScript dosyaları yerel statik yollarla yüklenir; derleme gerekmez. Değişiklikleri ayrı dalda yapın, etkilenen davranış için regresyon testi ekleyin, GitHub Actions sonucunu kontrol edin ve PR incelemesinden sonra `main` dalına birleştirin. Büyük tek dosyayı parçalara ayırma işi, çalışan oyunu bir defada yeniden yazmadan, bağımsız testlenebilir adımlarla yapılmalıdır.

Ayrı [haftalık Chromium soak workflow'u](.github/workflows/neon-soak.yml) gerçek 90 saniyelik ileri-dalga render, hata ve entity limitlerini sınar. Bu gerçek mobil/masaüstü cihazda 30–60 dakikalık manuel ölçümün yerine geçmez.
