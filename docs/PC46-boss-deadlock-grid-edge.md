# PC46 regresyonu: çoklu boss saldırı kilidi ve arena kenar çizgileri

## Kullanıcı kabulü (25.10.2026)
- PC oyun testi 46 dalgaya kadar ulaştı.
- Kullanıcı **FPS sorunu gözlemlemedi**. Bu tek başına tüm PC cihazlarında ve 5/10/20/30 dakikada performans hedefinin karşılandığını kanıtlamaz.
- Geç dalgalarda bazen boss saldırı göstergesi olmasına rağmen saldırı çıkmadı.
- Bazı dalga geçişlerinde ekran kenarında kesik çizgiler görüldü.

## Doğrulanmış kök neden: çoklu boss faz saldırısı kilidi
`CombatDirector.allowBossAttack()` önceden `activeBosses` içinde *başka herhangi bir bossun* `bossSpecial.delay <= 0` ise saldırıyı reddediyordu. İki boss aynı anda faz saldırısına hazırsa A, B yüzünden; B de A yüzünden reddediliyordu. `bossSpecial` süresiz aktif kalıyor, çizilen faz telegraph'ı sona ulaşmasına rağmen `fireBossPhaseAttack()` çalışamıyordu. Durum 2+ bossun bekleme pencereleri çakıştığında ortaya çıkabilir.

### Düzeltme
- Canlı ve sersemletilmemiş faz saldırısı sahiplerinden `activeBosses` sırasındaki ilk boss, faz önceliğini alır. Bu basit, deterministik seçim çift taraflı veto kilidini kırar.
- Diğer bosslar mevcut ortak `bossAttackNextAt` saldırı aralığını bekler; genel saldırılar hazırlanmış faz saldırısından önceye geçmez.
- Uzun süre sersemlemiş boss, başka hazırlanmış bossun ateşlenmesini sonsuza kadar engellemez.
- Boss hasarı, mermi sayısı, faz eşikleri, salvo açıları, ilk üç boss sırası ve bekleme sabitleri korunur.
- Otomatik test: geç dalga, üç bossun aynı anda hazır faz 2 salvo durumunda ilk/ikinci/üçüncü atış sırası, toplam 13 mermi, hiçbir fazın takılı kalmaması, ortak cooldown ve stun önceliği.

## Ekran kenarındaki kesik çizgiler: iki ayrı kaynak
1. **Kasıtlı baskın uyarısı:** `drawSpecialEncounterWarning()` özel düşman baskını öncesi ekranın geliş kenarına renkli bant ve `setLineDash([14,9])` kesikli sınır çizer. `plan.label` da gösterilir. Bu bir hata değil; baskının nereden geleceğini anlatan telegraph. Kod ve uyarı süresi korunmuştur. Kullanıcının gördüğü çizginin bu olup olmadığı ekran kaydı olmadan kesin söylenemez.
2. **Gerçek kenar kesilmesi ihtimali:** `drawStraightGridLines()` ve dalgalı `drawBackgroundGrid()`, 32 dünya birimi örneklemesi nedeniyle son 0–31 birimi sağ/alt kenarda çizmeden bırakabiliyordu. PC2'nin hızlı düz yolunda da eski son örnek korunmuştu. Düz çizgiler şimdi tamamen kenara uzatılır; dalgalı çizgiler gerçek sınırda aynı deformasyon formülüyle tamamlanır.
- Şok dalgası şekli, neon renkleri, baskın göstergesi, saldırı telegraph'ları ve oyun dünya koordinatları değişmez.

## Regresyon doğrulaması
`node --test tests/smoke.test.cjs`. Önceden 249 test vardı. Beş yeni test ile beklenen sayı **254**; PC2 düz grid örneğinin beklediği yeni sağ/alt kenar koordinatları da güncellendi.

## Gerçek PC'de manuel kabul
1. Güncel `main` üzerinden normal oyunu başlat; `F3` ile FPS ve P95'i aç. 30–50 dalga arasında oynarken herhangi bir çizgisel yavaşlamayı ve çoklu boss durumlarını gözlemle.
2. İki veya üç bossla karşılaştığında faz 2/3 renkli saldırı ışınları dolduktan sonra ilgili bossun mermilerini gönderdiğini kontrol et. Başka boss aynı anda hazırlanırsa saldırılar aralıklı gerçekleşmeli; uyarı süresiz takılı kalmamalı.
3. Dalga değişiminde kısa süreli merkezden gelen çember, arena ızgarası ve tam ekran sağ/alt kenarlarını kontrol et: ızgara çizgileri kesilmemeli. Ekran kenarında **renkli kesik kenar bandı + baskın adı** görürsen bu normal, yaklaşan özel düşman baskını uyarısıdır.
4. Düzeltme kod seviyesinde regresyon testleriyle doğrulandı; 46+ dalga gerçek oyun kabulü bu turda *henüz tekrar edilmedi*.

## Takip
M6.2-PC3 Canvas draw/paint/FX profili ve M6.2-PC4 uzun koşu heap/GC ölçümlerine devam etmeden önce PC46 hatalarının gerçek PC'de kabulünü tamamla. Mobil UI ve PC V2 ayrı kapsamdadır.
