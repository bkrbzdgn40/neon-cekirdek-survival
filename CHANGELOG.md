# Değişiklik Günlüğü

## Odak 5.9 · Elit özellikleri
- Her elit bir özellikle doğar, başında etiketi görünür: Kalkanlı (yenilenen kalkan), Bölünen (ölünce ikiye ayrılır), Hızlandırıcı (yakındakileri %30 hızlandırır), Hırsız (XP kürelerini çalar, ölünce ×1,5 geri verir), Yansıtıcı (her 5. vuruşta geri ateş eder).
- Özellikler dalgayla açılır (1, 4, 6, 8, 10); düşman sözlüğündeki elit kaydı bunları anlatır.
- Düzeltme: 5.8'deki hasar çarpanı zincir şimşeğinde iki kez uygulanıyordu.

## Odak 5.8 · Geç oyun gücü
- Düşmanların verdiği XP dalgayla büyür (dalga başına +%8, en çok ×3,5): ileri dalgalarda seviye atlamak yavaşlamaz.
- Altın Rezonansı: koşuda toplanan her 100 altın o koşu için +%3 hasar (en çok +%60). Laboratuvar bakiyesinden bir şey harcanmaz; bonus HUD'da altının yanında görünür.
- Aşırı Yük kartları: build dolduğunda (veya 3'ten az modül kaldığında) seviye atlamak birikimli kartlar sunar: +%5 hasar, +10 maks can, +%3 kritik.

## Odak 5.7 · Ana menü tek ekran
- Masaüstünde ana menü artık kaydırılmaz: 1280×600 ile 1920×1080 arası her pencerede, ilerlemesi dolu oyuncuda bile tek ekrana sığar (540 px altı kaydırmaya döner).
- Neon Sözleşmesi sağ sütundan ortadaki sahnenin altına taşındı; kısa pencerelerde ikincil açıklamalar gizlenir, sözleşme açıklaması kartın ipucunda kalır.
- Düzeltme: son operasyon hücreleri tek sütuna düşüyordu, artık 2×2. Büyük rekor skorları kutusundan taşmaz.

## Odak 5.6 · Teknik temizlik
- Test aracı (Playwright 1.64.1) artık `package.json` ve `package-lock.json` içinde tek yerde sabit; CI `npm ci` ile kurar. `npm test`, `npm run test:browser`, `npm run serve` komutları eklendi. Oyunun kendisi kurulum istemez.
- YEDEK AL artık sözleşme ustalığını da taşır. Eski yedekler ustalığa dokunmaz; bozuk bir ustalık bloğu yedeği reddeder, yazma hatasında eski kayıt geri gelir.

## Odak 5.5 · Koşu sonu hedefi
- Koşu raporunda SIRADAKİ HEDEF kartı: en yakın açılım, bu koşuda kazanılan altın ayrı renkle, "BİR KOŞU DAHA YETER" ya da "YAKLAŞIK N KOŞU" tahmini.
- Hedef hazırsa kart LABORATUVARDA AÇ düğmesiyle doğrudan ilgili bölüme götürür; laboratuvardan dönünce kart güncellenir.
- Yeni rekor rozeti artık farkı ve eski skoru yazar ("+1.380 (ESKİSİ 2.100)"), parlar ve ses çalar. Kısa masaüstü pencerelerde kart tek satıra iner.

## Odak 5.3 · Veri Kapsülü
- Gardırobun başına VERİ KAPSÜLÜ eklendi: 300 altına, sahip olmadığın kostümlerden birini rastgele verir. Aynı kostüm asla tekrar çıkmaz.
- Çıkan kostüm kapsülün altında gösterilir ve ızgarada parlar; otomatik giyilmez, GİY ile takarsın. 16 kostümün hepsi sende olunca kapsül kapanır.

## Odak 5.2 · Kostümler
- Laboratuvara GARDIROP eklendi: 4 yuvada 16 kostüm (çekirdek rengi, iz efekti, çekirdek şekli, arena paleti), 400–1500 altın.
- Kostümler yalnızca görünüşü değiştirir; can, hasar ve hız aynı kalır. Alınan kostüm hemen giyilir, tekrar tıklayınca çıkar; hangarda ve koşuda görünür.
- Kostümler kayıtla ve yedekle saklanır; menüdeki sıradaki hedef artık en ucuz kostümü de gösterir.

## Odak 5.1 · Düşman sözlüğü
- Nasıl Oynanır › TEHDİTLER artık bir sözlük: 10 düşman, elit ve 4 boss. Bir koşuda karşılaştığın düşman kalıcı olarak kaydedilir; adı, ne yaptığı, nasıl yenileceği ve kaç tane imha ettiğin görünür.
- Görmediğin düşmanlar adı gizli bir siluet olarak durur ve hangi dalga civarında çıktığını söyler. Yeni bir düşman görünce koşu sırasında "SÖZLÜĞE EKLENDİ" yazar.
- Sözlük kayıtla ve yedekle birlikte saklanır; bozuk kayıt satırları atlanır.

## Odak 4.10 · İyon Bahçesi ve Yarık Geçidi canlanır
- İyon Bahçesi: polenler yukarı süzülür, çiçekleri yumuşak kökler bağlar ve hazır çiçekten köke ışık akar. Çiçekler nefes alır; hazırken açık durur ve dalga yayar, dolarken iyice açılıp iyonları çekirdeğine çeker, harcanınca tomurcuk olur, patlarken parlar.
- Yarık Geçidi: geçitler içe kıvrılan kollarıyla dönen birer girdap olur ve toz yutar. Hazır geçit nefes verir, ışınlanmada iki geçit birden parlar, bağlantı çizgisinde enerji paketleri akar.
- İyon Korosu sahnesinin kenarları titreşen ses dalgası olur, uyumda çiçekler altın taç yaprak saçar. Faz Kıskacı çemberini iki kıskaç çenesi saran ve geri sayımla kapanan bir halka sarar; ışında paketler akar, inişte yarıktan kıymıklar saçılır, kaçınca yeşil halka çıkar. "DURDUR" yazısı artık can çubuğunun üstünde kalır.

## Odak 4.9 · Kızıl Makas yatay raylar ve rastgele çeneler
- Dökümhanenin ısı rayları da artık dişli çelik çeneler: uyarıda çeneler kapanır, sayaç geri sayar, darbede kıvılcım ve hafif sarsıntı olur, sonra hat soğuyarak söner.
- Her darbe yönünü (yatay ya da dikey) ve beş hattan ikisini rastgele seçer; iki hat hiç yan yana gelmez, aralarında ya da yanlarında her zaman güvenli bir hat kalır. Uyarı süresi 1,5 sn aynı.
- Kızıl Makas olayında ilk pres rastgele yön ve yerde; ikincisi ilk pres indiğinde rastgele bir yön seçip oyuncunun durduğu hatta kilitlenir.

## Odak 4.8 · Rapor ve laboratuvar ekrana sığar
- Rapordaki SİBER LABORATUVAR butonu çalışıyordu ama laboratuvar raporun arkasında açılıyordu; artık önde açılır.
- Ana menüye dönünce arkada açık kalan laboratuvar kapanır. Menüde görülen kaydırma çubuğu bu gizli laboratuvardı.
- Masaüstünde rapor pencereye sığar: başlık, sekmeler ve butonlar yerinde durur, sadece sekme içeriği kayar; kısa pencerelerde başlık sıkışır.

## Odak 4.7 · Faz Kıskacı görseli
- Oyuncunun çevresinde terk edilmesi gereken kesikli kaçış çemberi: dışa akan oklar, üstünde "UZAKLAŞ · 1,2" geri sayımı; çemberin dışına çıkınca yeşile döner, "GÜVENDESİN" yazar.
- İşaretli düşmandan iniş noktasına akan ışın, düşmanın üstünde "DURDUR"; iniş noktasında dönen, tarama çizgili hologram ve kapanan geri sayım halkası. Düşman ölür ya da sersemlerse işaret yeşil çarpıyla iptal görünür.
- Işınlanmada iniş noktasında açılıp kapanan bir yarık; kaçınca hologramlar parçalanır ve "KISKAÇTAN KAÇTIN" yazar. Kural aynı; düşük grafikte ok, tarama ve parlama yok.

## Odak 4.6 · İyon Korosu görseli
- Doldurulmamış çiçekler dışa yayılan işaret halkalarıyla çağırır, üstünde "DOLDUR" ya da yüzde yazar; dolan çiçeğin içi büyüyerek parlar.
- Alınan çiçek altın renkte açar, taç yaprakları döner; sahne üçgeninin kenarlarında ondan diğer çiçeklere iyon ışıkları akar, iki ucu alınan kenar altına döner.
- Uyumda üçgen bir an altınla dolar ve merkezden üç ses halkası yayılır. Kural ve ödül aynı. Düşük grafikte parlama ve ikinci halkalar yok, kenar başına tek iyon.

## Odak 4.5 · Kızıl Makas görseli ve tehlikesi
- Presler artık dişli çelik çeneler: uyarı boyunca kapanır, zemin ısınır ve kenarlarda akan tehlike şeritleri var; çarpmada kapanır, ekran sarsılır, iki yandan kıvılcım saçılır. Sütunun üstünde geri sayım.
- Pres hasarı 8 → 20 (her pres oyuncuya bir kez). İkinci pres ilkinin çarptığı anda oyuncunun durduğu yere kilitlenir ("SENİ İZLİYOR"), 2 sn uyarır: uzaklaşan kurtulur.
- Düşük grafikte şerit ve parlama yok, daha az diş ve kıvılcım. Olay sürerken bölüm duyurusu aynı adı ikinci kez yazmaz.

## Odak 4.4 · Dirilme ekonomisi
- En fazla 3 ücretsiz diriliş (1 temel, 1 Laboratuvar kademesi, 1 Öncü); koşu başına 1 altınlı diriliş, fiyatı 60 + 10 × dalga (eskiden 2 hak, 30 ve 65 altın).
- Dirilme canı her seferinde azalır: %60, %45, sonra %30. Dirilişteki +50 Cinnet kalktı; koruma ve EMP patlaması aynı. Dirilme ekranı o dirilişin canını yazar.
- Laboratuvarda 2-3. kademeyi almış kayıt ve yedeklere o kademelerin altını bir kez iade edilir (132 + 290); bozuk değerler (999 gibi) iade almaz.

## Odak 4.3 · Kart enderliği her kartta güç farkı
- Enderlikten etkilenmeyen dört kart artık büyür (YAYGIN / NADİR / DESTANSI / EFSANEVİ): Soğutucu %8/10/13/16 bekleme kısaltması, Toplayıcı %12/15/19/24 XP, Devre Örücü 12/16/20/24 hedef, Faz Yankısı 5/6/8/10 düşman.
- Her kademe kendi enderliğini saklar; hedef sınırında en ender kademe geçerli. NADİR eski sabit değere eşit, kaydı olmayan kademe NADİR sayılır.
- Kart açıklamaları gerçek sayıyı yazar; hiçbir kartın yaygın ve efsanevi açıklaması aynı değil (testle korunur).

## Odak 4.2 · Tek seferlik görev rehberi
- Görev, ikmal halkası, saha cihazı, 6 arena olayı ve Devre Örücü ilk göründüğünde oyun durur: gerçek nesne ekranda halkayla vurgulanır, yanında döngülü canlı mini demo ve NE / NASIL / KAZANÇ satırları çıkar.
- Video yok: demo oyunun kendi çizimi, metin canlı kuralları okur (süreler değişince rehber de değişir). Her rehber bir kez çıkar, kayıtta `guides` olarak tutulur; Nasıl Oynanır ekranında "Rehberleri yeniden göster" var.
- Sıra: koşunun ilk 1,2 sn sonrası, iki rehber arası en az 4 sn; hedefi kaybolan rehber atlanır ama görülmüş sayılmaz. Testler rehberi `NEON_GUIDES=false` ile kapatır.

## Odak 4.1 · Devre süresi ve sayaç
- Devre Örücü penceresi 9 → 14 sn, en fazla 72 nokta, kapanma yarıçapı 56 px (oyuncular süreyi yetiştiremiyordu).
- Sarı başlangıç halkasında kalan süre yayı (son %25 kırmızı) ve yol yarılanınca "BAŞLANGICA DÖN" yazısı.

## Odak 3.10 · Koleksiyonda dalga şartı
- Koleksiyon içeriği önce rekor dalga şartı ister, sonra altınla alınır: Soğutucu 3, Titan 4, Toplayıcı 5, Mayın İzi 6, Hayalet 7, Bumerang Disk 8, Şok Halkası 10.
- Şartı sağlanmamış kart ve kilitli şasi rozeti "DALGA 7'YE ULAŞ · 1.200 ALTIN" gibi yazar. "Sıradaki hedef" alınabilecek içerik yoksa en yakın dalga şartını mor çubukla gösterir.
- Önceden alınan içerik açık kalır. Türkçe yönelme eki tek yardımcıda (`waveDative`).

## Odak 3.9 · Alan savunma görevi
- Savunma ilerlemesi artık alanda durunca dolar; yakında düşman varsa 1,6 kat hızlı dolar (`DEFEND_RULES`). Önceden yakında düşman şartı vardı ve ilk dalgalarda düşmanlar alana varmadan öldüğü için ilerleme geri sayıyordu.
- Geri sayım yalnız alan dışındayken, 0,65 yerine 0,4 hızla. Hedef 5 → 8 sn; gerçek koşuda 5–7 sn'de tamamlanıyor.

## Odak 3.8 · Hangar ana menüsü
- Menü üç sütun: solda kimlik ve şasi seçimi; ortada seçili şasinin canlı önizlemesi (`hangarPreview`; düşmanlar yaklaşır, çekirdek ateş eder) ve başlat; sağda sıradaki hedef, başlangıç gücü ve son operasyon. Sütunlar aynı çizgide bitiyor, 1280×800 ve 1920×1080'de kaydırma yok.
- "Sıradaki hedef" en ucuz kilitli içeriği altın çubuğuyla gösteriyor, koleksiyon bitince Laboratuvara, o da bitince rekora geçiyor. Son koşu kayıtta (`lastRun`); ilk açılışta yerine 3 adımlık rehber çıkıyor.
- Kontroller ve tehditler "Nasıl oynanır" penceresine taşındı (Escape kapatır). Altı yerleşim regex testi davranış testleriyle değiştirildi.

## Odak 3.7 · Altınla içerik açma
- Siber Laboratuvarda yeni Koleksiyon bölümü: Hayalet (1.200) ve Titan (1.800) şasileri, Mayın İzi, Bumerang Disk, Şok Halkası, Soğutucu ve Toplayıcı (700–1.300) bir kez alınır. Toplam 7.800 altın.
- Açılmamış silah ve pasifler yükseltme kartlarında çıkmaz. Kilitli şasi kartı fiyatı gösterir ve tıklanınca Laboratuvarı açar. Satın alınan şasi hemen seçilir.
- Kayıt ve yedek `owned` listesini taşıyor; eski kayıt ve yedekler boş listeyle açılır, bilinmeyen kimlik içeren yedek reddedilir. `?unlock=all` her şeyi açar.

## Odak 3.6 · Altın geliri ayarı
- Altın küresi ve sandık altını dalga 20'den sonra büyümüyor (`GOLD_ECONOMY.waveCap`). Önceden dalga 75'te küre başına 39 altın düşüyordu, şimdi en fazla 12.
- Açgözlülük kademe başına +%10 altın veriyor; XP artışı kalktı (kendini besleyen döngüydü). Açgözlülük 8'de 20 dk'lık koşu 4.300–5.500 altından ≈650'ye indi.
- Kayıtlı altına dokunulmadı; birikmiş altın 3.7'de açılacak içeriklerde harcanacak.

## Odak 3.5 · Eski silahlar ±%25 bandında
- Çatallı Plazma, Plazma Uydusu, Güdümlü Füze ve Zincirleme Yıldırım artık kademe başına hasar tablosu kullanıyor (`LEGACY_WEAPON_RULES`), değerler `sim-dps` ile ayarlandı.
- Uydu en çok zayıfladı: temas hasarı oyuncu hasarının 0,96 katından 0,13 / 0,105 / 0,06 katına, evrim darbesi 0,62'den 0,35'e indi. TITAN şasisinin başlangıç uydusu da K1 gibi vurur.
- Güdümlü Füze ve Yıldırım K1'de güçlendi, Çatallı Plazma salvodaki her mermiyi biraz zayıflatıyor (kartta yazıyor). Mayın İzi K2 hasar çarpanı 0,5 → 0,45.

## Odak 3.4 · Sinerjiler genişledi (4 → 9)
- Her yeni silah bir pasifle eşleşiyor; her sinerji bir davranış değişikliği: Mayın Fırlatıcı (Mayın İzi + Kinetik Türbin: Atılım bittiği yere 3 mayın), Sekme Disk (Bumerang Disk + Kuantum Sekme: disk dönmeden en yakın düşmana seker), Şok Kalkanı (Şok Halkası + Aegis: kalkan kırılınca halka), Hasat Uyduları (Plazma Uydusu + Toplayıcı: uydu değdiği XP küresini çeker), Buzlu Disk (Bumerang Disk + Soğutucu: yakalanan disk Atılımı 0,5 sn öne alır).
- Sinerjiyi tamamlayan kart bunu "YENİ SİNERJİ" satırıyla gösterir (davranış testiyle doğrulandı). Sayılar `SYNERGY_RULES` içinde.

## Odak 3.2d · Yeni pasifler: Soğutucu ve Toplayıcı
- Soğutucu: kademe başına tüm beklemeler −%10 (bileşik; 3. kademede ×0,73): Atılım, EMP, kalkan, Prizma, Faz Yankısı ve zamanlı silahlar (disk, halka, devre). Evrim Kriyo Döngü: her Atılım bitişinde EMP ve Prizma 1 sn erken hazır.
- Toplayıcı: XP küresi değeri kademe başına +%15. Evrim Hasat Dalgası: her 40 kürede ekrandaki bütün küreler oyuncuya çekilir.
- Havuz: 8 silah (plazma + 7 yuvalı) ve 10 pasif.

## Odak 3.2c · Yeni silah: Şok Halkası
- Çekirdekten 3,2/2,9/2,6 sn'de bir genişleyen halka (130/145/160 px); her düşmana halka başına bir kez vurur. Hasar merkezde tam, kenarda %30'a iner: kalabalığın içine dalmak ödüllenir. Kendi dizisi ve sınırı var (`MAX_SHOCK_RINGS = 3`).
- 3. kademe evrimi Artçı Şok: her halkadan 0,35 sn sonra yarı hasarlı ikinci halka. Yeni ses ailesi ve görsel; DÜŞÜK grafikte parıltı ve iç halka yok.
- DPS (dalga 6, 5 tohum): K1 +22,8 · K2 +32,4 · K3 +63,0; üç kademe de ±%25 bandında. Silah sayısı 8 oldu (plazma + 7).

## Odak 3.2b · Yeni silah: Bumerang Disk
- Hareket yönüne delici bir disk fırlatır (2,2/1,9/1,8 sn'de bir, 260/290/320 px); disk oyuncuya geri döner ve dönüşte aynı düşmana bir kez daha vurur. Kendi dizisi ve sınırı var (`MAX_BOOMERANG_DISCS = 4`), 4 sn'de dönemeyen disk kaybolur.
- 3. kademe evrimi Ayna Disk: her atışta ikinci disk ters yöne fırlar. Yeni ses ailesi ve görsel; DÜŞÜK grafikte iz ve parıltı yok.
- DPS (dalga 6, 5 tohum): K1 +21,3 · K2 +31,1 · K3 +65,1; üç kademe de ±%25 bandında.

## Odak 3.2a · Yeni silah: Mayın İzi
- Hareket ettikçe arkada mayın bırakır (kademeye göre 3/4/5, her 300/260/220 px'te bir). Kurulduktan sonra yaklaşan düşman patlatır; iz dolunca en eski mayın yenilenir. Kendi dizisi ve sınırı var (`MAX_TRAIL_MINES = 6`); mermi havuzunu kullanmaz.
- 3. kademe evrimi Zincir Mayın: patlayan mayın 150 px içindeki diğerlerini de patlatır, bir ek mayın taşınır. Yeni ses ailesi ve görsel; DÜŞÜK grafikte parıltı ve tetik halkası çizilmez.
- DPS (dalga 6, 5 tohum): K1 +20,1 · K2 +37,7 · K3 +63,0; üç kademe de ±%25 bandında. Havuz boyutunu sabit yazan testler tek bir `UPGRADE_IDS` listesine bağlandı.

## Odak 3.3 · DPS ve hayatta kalma simülasyonu
- Smoke testinin VM düzeneği `tests/harness.cjs`'e taşındı (görünüm boyutu ve süre sınırı seçenekleriyle); smoke testi ve simülasyon onu kullanıyor.
- `node scripts/sim-dps.cjs [--seeds=5] [--seconds=30] [--only=id,id]`: sabit tohum, dalga 6, plazma + tek silah, 120 px dairede dönen bot. Silah × kademe için DPS, plazmaya eklenen DPS, öldürme ve alınan hasar; tablo stdout'a, ham veri `sim-results.json`'a (git dışı). CI'da çalışmaz.
- İlk ölçüm: mevcut silahlar ±%25 bandının dışında (Plazma Uydusu K1'de medyanın ~5 katı). Yeni silahlar kademe medyanına göre ayarlanacak.

## Odak 3.1 · Silah / pasif ayrımı ve slot sınırı
- Her yükseltmenin `kind` alanı var: 5 silah (Çatallı Plazma plazmanın yükseltmesi, yuva harcamaz), 8 pasif. Plazma 1. silah yuvasını kalıcı tutar; sınır 4 silah, 5 pasif (`BUILD_SLOT_LIMITS`). Tür doluysa yalnızca sahip olunan, kademesi < 3 kartlar gelir.
- Yükseltme ekranında ince yuva satırı (dolu yuva ikon, boş yuva çerçeve); kart etiketi `kind`'a bağlı (Faz Yankısı artık SİSTEM MODÜLÜ).
- ATLA: koşuda 2 kez, seçmeden devam ve sonraki barın %15'i kadar XP iadesi (`X` tuşu). Tuş akışını kaynak regex'iyle bakan testler davranış testine çevrildi.

## Odak 3.0 · Tohumlu rastgelelik
- `rng()` (mulberry32) ve `setRunSeed(n)` eklendi. Savaş, spawn, ganimet, görev ve yükseltme çekilişleri `rng()` kullanıyor; parçacık, sarsıntı, hasar yazısı titremesi ve menü demosu `Math.random`'da kaldı.
- `?seed=N` her koşunun tohumunu sabitler; parametre yoksa her koşu yeni bir tohumla başlar (`runSeed`).
- Smoke: aynı tohum + aynı girdi → aynı ilk 3 yükseltme ve aynı ilk 20 spawn. Rastgeleliği sabitleyen eski testler artık `rng`'yi sahteliyor.

## Odak 2.7 · Cihaz turu ve karar
- Gerçek cihaz turu TECNO CK6n üzerinde yapıldı; sonuçlar `docs/DEVICE_QA.md`'de, düzeltmeler 2.7a–2.7e.
- Karar: masaüstü öncelikli. Mobil ileride telefona özel ekranlar, yalnızca yatay oyun ve tam ekran paketle ayrıca ele alınacak; Faz 3'te mobil tasarım işi yok.

## Odak 2.7e · Dokunmatik rötuşlar
- Dokunmatik ekranda klavye ipuçları (`.key-hint`) gizli: diriliş butonundaki "BOŞLUK", kartlardaki [1] [2] [3], "R", menü kısayolları. Kontrol kartları dokunmatik karşılığını gösterir (`.touch-hint`: ATILIM BUTONU, EMP BUTONU…).
- Telefon dikeyde yükseltme ekranı 1342 → 840 px (360×668): ilk iki kart tamamen görünür, yazı boyutları (M5.23) aynı.
- Yatayda adres çubuğu açıkken (724×280) yetenek butonları sığacak kadar küçülür (en az 44 px); Siper artık duraklat butonuna değmiyor.

## Odak 2.7d · Otomatik grafik düşürme
- Gerçek cihazda (TECNO CK6n) boss sırasında YÜKSEK 18 fps, ORTA 16 fps, DÜŞÜK 60 fps ölçüldü; varsayılan YÜKSEK telefonda ağır çekim gibi akıyordu.
- Oyuncu elle kalite seçmediyse, oynanan her 3 sn'nin ortanca karesi 28 ms'yi aşınca kalite bir kademe, 40 ms'yi aşınca doğrudan DÜŞÜK'e iner; asla kendiliğinden yükselmez. Sonuç ayrı bir anahtarda saklanır, menüden seçim her zaman önceliklidir.
- Telefonda: 5. sn ORTA, 12. sn DÜŞÜK, sonra 60 fps. Tarayıcı testleri kaliteyi `NEON_GRAPHICS_AUTO=false` ile sabitler; yeni test gerçek döngüyü yavaşlatıp düşüşü ölçer.

## Odak 2.7c · Mobil adres çubuğu gizlenince canvas tam ekran
- Gerçek cihazda (TECNO CK6n, Android 14, Chrome) bulundu: menü kaydırılınca adres çubuğu gizleniyor; `clientHeight` eski boyda kaldığı için canvas ekranın altını boş bırakıyordu (yatay 280/336 px, dikey 668/724 px). Atılım butonu oyun alanının dışında kalıyordu.
- `resizeCanvas` artık `clientHeight` ile `innerHeight`'ın büyüğünü kullanıyor; yatay dünya 965×373 → 965×448. Smoke testi eklendi.

## Odak 2.7b · Masaüstü HUD daha az seyrek
- Cihaz turu bulgusu: masaüstü fazla boştu. Masaüstünde (≥ 1024 px, fareli) skor (yeni üst satır çipi), altın, görev ve kombo artık hep görünür; kombo x5'in altında soluk.
- Momentum, Cinnet ve bölüm çipi bağlamsal kaldı; telefon düzeni değişmedi (testle doğrulanıyor). Üst satır 38 px, 1024–1440 px'te taşma yok; oynanacak alan ≥ %80 korunuyor.
- `docs/HUD_ENVANTERI.md` karar 2 masaüstü için güncellendi.

## Odak 2.7a · Küçük ekranda düşman yoğunluğu
- Cihaz turu bulgusu: telefonda arena yarı büyüklükte (390×844'te 520×1125, masaüstünde ~1327×829) ama düşman akışı aynıydı, hayatta kalma yarıya iniyordu.
- Alan 1 000 000 birimin altındaysa düşman jetonu ve aynı anda yaşayan düşman sınırı alan oranının karekökü kadar azalır (en az %50). Masaüstü değerleri değişmez.
- 10 tohumlu simülasyon, hareket eden oyuncu: 390×844 ortalama 29 sn → 65 sn, masaüstü 53 sn. Tam orantılı ölçek telefonu fazla boşaltıyordu (öldürme 111 → 87).

## Odak 2.6 · Geometri testi etkin
- `tests/hud.geometry.spec.cjs` içindeki `test.fixme` kalktı; sakin HUD her görünümde eşikleri geçiyor ve CI browser job'ında çalışıyor.
- İkinci varyant: `?wave=8`, gerçek boss, Cinnet aktif, kombo 6. Eşik 5 puan düşük (`contextualFreePlayDrop`): 320×568 %65.7, 390×664 %69.1, 750×342 %69.1, 1280×800 %79.1, 1366×768 %78.2; çakışma, taşma ve küçük hedef 0.
- Dikeyde bölüm çipi yalnızca ikon (tehlike anında durum metni), boss barı daha ince.
- Oyun başlarken odak kapanan menüdeki butondan alınır; ilk tuşun (ör. Prizma için C) yutulması önlendi. M5.22'nin ara sıra düşmesinin sebebi buydu.

## Odak 2.5 · Mobil yatay HUD
- Telefon yatayda (`orientation:landscape` + `max-height:500px`): sol üstte can ve seviye halkası (36 px), sağ üstte süre ve duraklat, sağ kenarda 52 px yuvarlak yetenek kolonu; altta HUD öğesi yok. "DALGA" etiketi artık kırpılmıyor.
- Dokunmatik telefon dikey tutulunca ilk koşuda bir kereliğine "Daha geniş görüş için telefonu yatay çevir" ipucu (4 sn, `localStorage`).
- Geometri ölçümü dar ve uzun bir yetenek kolonunu alt blok değil yan kolon sayar. 750×342 %48.2 → %79.1.
- Kırılgan testler sağlamlaştı: M5.22 döngüyü test boyunca dondurur; 1.3'ün 3 dakikalık koşusu sabit adım yerine 180 sn oyun süresine kadar ilerler; 1.3 ikmal testi duyuru aralığından etkilenmez.

## Odak 2.4 · Mobil dikey HUD
- Telefon dikeyde (`max-width:639px` + `hover:none`) üstte 44 px tek satır: can, XP'yi halka olarak gösteren seviye, DALGA üst yazılı süre, duraklat. Bağlamsal çipler yalnızca görünürken ince ikinci satıra iner; görev ödülü mobilde gizlenir.
- Yetenekler sağ altta başparmak yayında: 64 px Atılım, 56 px EMP/Prizma/Siper; yalnızca ikon ve radyal bekleme. Kısa ekranda yay yassılaşır, sol alt joystick için boş kalır.
- Momentum mobilde kalktı; Cinnet bar yerine ≥ %80 ya da aktifken parlayan çip. Dokunmatikte HUD'da hiçbir klavye/fare ipucu görünmez.
- Oynanacak alan (görev çipi açıkken): 320×568 %71.1, 390×664 %73.8; çakışma, taşma ve küçük hedef 0.

## Odak 2.3 · Dokunmatik kontrol: göreli joystick
- Ekranın sol %60'ında parmağın değdiği yer joystick merkezi olur: 8 px ölü bölge, 56 px'te tam hız; kanvas üzerinde iki yarı saydam halka çizilir.
- Hareket parmağı `Touch.identifier` ile izlenir; ikinci parmak joystick'i çalmaz. Yetenek butonları dokunmatikte `pointerdown` ile tetiklenir (çoklu dokunmada `click` gelmediği için), ardından gelen `click` yutulur.
- Eski mutlak hedef duraklatma menüsünde "PARMAĞI TAKİP ET" seçeneği olarak kaldı (yalnızca dokunmatik ekranda görünür, `localStorage`'da saklanır); varsayılan joystick.
- Gerçek çoklu dokunma (CDP) tarayıcı testi eklendi; M5.22 Prizma testi canlı döngüyü dondurur ve mobilde `tap()` kullanır.

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
