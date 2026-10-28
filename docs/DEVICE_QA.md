# Neon Çekirdek: gerçek cihaz ve uzun oturum QA protokolü

Bu belge **yapılmış ölçüm değildir**. [GitHub Actions](../.github/workflows/neon-smoke.yml) yalnızca Node VM regresyonları ve kısa Chromium smoke senaryoları çalıştırır. Görsel snapshot baseline karşılaştırması ve uzun süreli gerçek cihaz oyun hissi/performans sonuçları mevcut değildir. CI'da temel piksel doluluğu, 12 saniyelik gerçek Chromium oyun döngüsü ve entity sınırları denetlenir; bunlar görsel referans fotoğrafı ya da uzun süreli performans kanıtı değildir.

## Test matrisi

- Masaüstü: en az bir Windows Chrome/Edge 1920×1080, bir düşük donanım profili (varsa), mümkünse Firefox/Safari çapraz kontrol.
- Mobil: gerçek Android Chrome ve iOS Safari (varsa), portre ve yatay, dokunmatik hareket, dash/Nova, modal/scroll ve grafik seçenekleri.
- Her cihaz için: yüksek/orta/düşük kalite, klasik tempo; opsiyonel adaptif tempo ayrı raporlanır.
- İlk menü, şasi seçimi, görev, yükseltme kartı, reroll, duraklat/devam, boss uyarısı, 2/3 boss, ölüm/diriliş ve menüye dönüşü test et.
- Normal koşu **en az 30 dakika** veya oyun kapanana kadar; ayrıca 60 dakikalık bir seans tercih edilir. Hareketli sahnelerde ekran görüntüsü ve kısa kayıt al.
- `?perf=1` ile F3 panelini aç ve `window.getNeonPerformanceSnapshot()` ile `window.getNeonPerformanceHistory()` sonuçlarını **oturum sonunda** incele. JS heap tarayıcı tarafından sağlanmayabilir; `null` veriyi 0 MB sayma.
- Önemli kayıtlar: cihaz/OS/tarayıcı, viewport, DPR, grafik profili, dalga, boss adedi, koşu süresi, FPS ort./P95 kare süresi, CPU güncelleme/çizim, heap örnekleri, canlı enemy/bullet/orb/FX sayıları, görsel taşma, softlock, yeniden başlatma davranışı.
- Kayıt güvenliği: `YEDEK AL` ile meta ilerlemenin JSON dosyasını indir; farklı tarayıcıda `YEDEK YÜKLE` ile içe al, çevrimdışı statik sunucuda da dene. Bu bulut senkronizasyonu değildir.

## Performans ve görsel kabul

- Bilinen sabit FPS eşiği tüm cihazlar için geçerli değildir. Dalga büyüdükçe kare süreleri ve giriş gecikmesi anlamlı biçimde artıyor mu kaydet; donma, softlock, bozuk çizim veya kopuk HUD bir test hatasıdır.
- Gerçek cihazlara ait ilk kabul edilmiş ekran görüntülerinden sonra Playwright screenshot baseline eklenebilir; değişken Canvas animasyonu için donmuş frame/test seed veya mask gerekir.
- Yalnızca CI smoke başarısı **60 FPS**, 30 dakikalık stabilite, adil zorluk veya görsel doğruluk garantisi değildir.

Takip: [#44](https://github.com/bkrbzdgn40/neon-cekirdek-survival/issues/44).

## Otomatik süreli Chromium kontrolü

[neon-soak.yml](../.github/workflows/neon-soak.yml) içindeki ayrı job, bu dosyalardaki PR değişikliğinde 25 saniye, haftalık veya manuel tetiklemede 90 saniye **gerçek zamanlı** örnek alır. Dalga 16, gövdeye hasar vermeyen izole bir test fikstürü ve gerçek CombatDirector spawn akışı kullanılır. Her çalışmada sayım limitleri, Canvas, P95 kare süresi, zaman ilerlemesi, runtime JS hataları ve son ekran görüntüsü doğrulanır. 90 saniyelik otomasyon **30–60 dakika gerçek cihaz benchmarkı değildir**. Donanım ve oyun hissi testi ayrı yapılmalıdır.
