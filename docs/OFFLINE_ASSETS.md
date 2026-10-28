# Yerel CSS, ikon ve font varlıkları

Oyunun ekran düzeni ve font/ikon görünümü artık üçüncü taraf CDN'den indirilmez. Gerekli dosyalar bu GitHub deposundadır.

| Kaynak | Sabit sürüm | Yerel dosyalar |
| --- | --- | --- |
| Tailwind CSS | 3.4.17 | `src/utilities.css` |
| Font Awesome Free | 6.5.1 | `src/vendor/fontawesome/` |
| Fontsource Orbitron | 5.2.8 | `src/vendor/fonts/orbitron-*.woff2` |
| Fontsource Rajdhani | 5.2.7 | `src/vendor/fonts/rajdhani-*.woff2` |

Oyun veya test açılırken npm kurulumu ve CDN gerekmez. Yalnızca bu dosyaları **yeniden üretmek için** Node.js, npm ve ağ erişimi gerekir:

```bash
bash scripts/build-offline-assets.sh
node --test tests/smoke.test.cjs
```

Yeni Tailwind utility sınıfları index.html veya src/game.js içine eklenirse yeniden derleme yapılmalıdır. Derlenmiş CSS ve lisanslı statik varlıklar ayrı commit'lerde takip edilir. Font Awesome lisansı `src/vendor/fontawesome/LICENSE.txt`, iki fontun SIL OFL lisansları ise `src/vendor/licenses/` altındadır.

Bu değişiklik görsel/işlevsel çevrimdışı bağımlılığı çözer; farklı cihazlar arasında oyun kaydını **bulutla eşitlemez**. Görsel değişikliklerde gerçek tarayıcı ekran ölçümlerini ayrıca kontrol edin.