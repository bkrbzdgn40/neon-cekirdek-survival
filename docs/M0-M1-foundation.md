# M0 / M1 ilk stabilizasyon turu

Bu tur mevcut REV 3.6 tek HTML girişini (index.html) korur. Harici paket gerektirmez.
Kararlı başlangıç: d3eb18ffaa3e418109f513470cc5043d98d0b4fb (Initial playable version v3.6).

## Değişiklikler
- localStorage için sürümlü meta kayıt: altın, rekor, dalga ve market seviyeleri.
- Bozuk kayıt/kapalı depolama durumlarında oyun varsayılan değerlerle açılır.
- Market açıklamaları gerçek uygulanan bonuslarla eşlendi.
- Ücretsiz diriliş hakları tamamen kullanılabilir; ayrıca en çok iki ücretli diriliş.
- Düşman canı, hızı, hasarı ve elit çarpanları kontrollü artar.
- Erken dalgalarda ağırlıklı tür havuzu kullanılır, 160 aktif düşman bütçesi.
- XP eşiği daha ılımlı artar, mermi ölüyse tekrar hasar vermez.
- Uydu temas hasarı kare sayısı yerine saniyeye göre hesaplanır.
- Boss sonrası yeni saldırı için toparlanma süresi tanımlandı.

## Doğrulama
`node --test tests/smoke.test.cjs` Node 22+ ile çalışır.
GitHub Actions aynı testi her PR ve main push için çalıştırır.
Testler: script parse, kaydet/yükle, bozuk veri, düşman çeşitliliği ve can,
boss aralığı, diriliş kullanımı.

## Eksik kalan kapsam
Bu sürüm tam M1 tamamlandı anlamına gelmez. Gerçek Chromium/mobile uzun oynanış,
30 dakikalık performans, spatial hash, entity pool, Combat Director ve görsel
yenileme ayrı turlarda yapılacak. Oyuncu geri bildirimiyle HP/spawn oranı ayarlanmalı.

## Yerel çalıştırma
index.html doğrudan açılabilir. Daha güvenilir yerel test için
`python -m http.server 8000` ardından http://localhost:8000 kullan.
Dış CDN font/ikonlar çevrimdışı yüklenmeyebilir.
