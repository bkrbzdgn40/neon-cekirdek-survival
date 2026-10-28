# Neon Çekirdek: Hayatta Kal

Tarayıcıda çalışan, tek dosyalı bir Canvas 2D arena-survival oyunu. Kodun ve çalışma davranışının kaynağı GitHub'daki **main** dalında yer alan [index.html](index.html) dosyasıdır. [Geliştirme yol haritası](Neon_Cekirdek_Gelistirme_Yol_Haritasi.txt) tarihsel tasarım ve değişiklik notları da içerir; güncel CI/test sayısını ya da mevcut PR durumunu temsil etmez.

## Oyunu çalıştırma

[**index.html**](index.html) dosyasını modern bir tarayıcıyla açın. Yerel HTTP sunucusu tercih ederseniz depo kökünden:

```sh
python -m http.server 8000
```

Ardından `http://localhost:8000` adresine gidin. Oyun için `npm install`, derleme, ayrı bir API veya veritabanı gerekmiyor. Ancak görünüm için kullanılan **Tailwind CDN**, **Font Awesome CDN** ve **Google Fonts** internet bağlantısı ister; tam çevrimdışı sunum garanti edilmez.

## Çalışma modları

| Parametre | Davranış |
| --- | --- |
| Yok / `?tempo=classic` | Varsayılan klasik savaş temposu |
| `?tempo=adaptive` | Yerel gözlemciye dayalı adaptif normal spawn temposu |
| `?learn=on` | Oyuncu risk tahmin modeli için **gölge öğrenme**; düşman üretimini/ödülleri yönetmez |
| `?tempo=adaptive&learn=on` | Adaptif tempo ve birbirinden ayrı gölge öğrenme |
| `?perf=1` | Performans telemetrisi seçeneği; masaüstünde F3 ile panel açılıp kapatılabilir |

Altın, meta yükseltmeler, grafik ayarları ve isteğe bağlı karşılaştırma/öğrenme kayıtları tarayıcının `localStorage` alanında tutulur. Sunucu hesabına senkronize edilmez; site verileri silinirse kayıtlar kaybolabilir.

## Geliştirici notları

- Oyun mantığı, stil ve markup: [index.html](index.html)
- Node.js 22 ile çalışan, gerçek oyun kodunu VM sahte DOM ortamında sınayan regresyon seti: [tests/smoke.test.cjs](tests/smoke.test.cjs)
- Her PR ve `main` push'unda smoke testleri: [.github/workflows/neon-smoke.yml](.github/workflows/neon-smoke.yml)
- Mimari ve tamamlanan geliştirmelerin ayrıntıları: [docs/](docs/)

```sh
node --test tests/smoke.test.cjs
```

**Doğrulama sınırı:** Bu smoke testleri gerçek tarayıcıda görsel yerleşimi, giriş gecikmesini, uzun oturum FPS değerlerini veya mobil cihaz davranışını ölçmez. Bu başlıklar için ayrıca gerçek tarayıcı ve cihaz testleri gerekir.

## Katkı düzeni

Değişiklikleri ayrı dalda yapın, etkilenen davranış için regresyon testi ekleyin, GitHub Actions sonucunu kontrol edin ve PR incelemesinden sonra `main` dalına birleştirin. Büyük tek dosyayı parçalara ayırma işi, çalışan oyunu bir defada yeniden yazmadan, bağımsız testlenebilir adımlarla yapılmalıdır.
