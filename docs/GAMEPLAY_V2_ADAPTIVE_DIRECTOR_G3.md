# Gameplay V2 G3: Tempo karşılaştırması ve oyun sonu RİTİM raporu

## Karar
Kullanıcı G2'nin zorluğunu iyi buldu. **Bu PR'da zorluk parametresi değiştirilmez**. Adaptif mod hâlâ yalnızca `?tempo=adaptive` ile açılır; varsayılan klasik korunur. G3, gerçek oynanış değerlendirmesi için dürüst, karşılaştırılabilir oyun içi ölçümler ekler.

## Neler ölçülüyor?
`CombatDirector.tempoRunMetrics` her aktif oyun güncellemesinde faz ve G1 gözlemci değerlerini okur. Ek düşman taraması, sort, Canvas veya ağ isteği yoktur. Sadece sabit sayıda sayısal sayaç tutulur.

- **Normal süre:** boss, boss ön uyarı ve boss sonrası korumalı geçiş dışında geçen aktif oyun saniyeleri.
- **Boss korumalı süre:** boss kilidinde geçen saniyeler; normal faz oranlarına katılmaz.
- **Ortalama stres/hâkimiyet:** normal saniyelerin zaman ağırlıklı ortalaması. Oyuncunun gerçek duygularını değil, G1 proxysini ölçer.
- **Stres tepe değeri** ve **yüksek stres saniyeleri**: G1 stres puanı >=68 iken.
- **Ayrık stres zirveleri**: 68 veya üstünde *ilk* girişte sayılır, tekrar saymak için puanın 38 veya altına düşmesi gerekir. 60 Hz'de bir tepeyi 100 defa saymaz.
- **Sakin süre / en uzun sakin aralık / 8+ saniyelik sakin bloklar**: yerel düşman ve düşman mermisi sıfırken ve stres 20'nin altındayken geçen süre. **Bu, tüm arenanın boş olduğu anlamına gelmez**. Oyuncunun uzaktan aktif ateş ediyor olabileceği bilinerek yorumlanmalıdır.
- **Nefes girişleri**, dört gerçek director fazının kümülatif süreleri; gerçekleşen gerçek fazları yansıtır.

Oyun duraklayınca, kart seçerken veya ölüm raporundayken oyun zamanı ve sayaçlar ilerlemez. Her yeni koşuda sıfırlanır. Boss süresi duraklama sanılmaz.

## RİTİM sekmesi ve kalıcılık
Oyun sonu raporuna erişilebilir bir **RİTİM** sekmesi eklendi:
1. Bu koşu: gerçek tempo modu, ortalama/tepe stres, ayrık zirveler, sakin dönemler.
2. Faz süreleri: HAZIRLIK, BASKI, KRİZ, NEFES saniyeleri ve normal savaştaki kriz/nefes oranları.
3. Son tamamlanan **KLASİK** ve **ADAPTİF** koşular: süre, dalga, kill/dk, gerçek HP kaybı/dk, stres, kriz/nefes oranı, sakin bloklar, özel baskın ve boss imhası.
4. Güven göstergeleri: aynı şasi, aynı **koşu sonunda seçili** grafik profili, her iki koşu >=2 dk. Uyuşmazlık varsa geçersiz hüküm uyarısı gösterilir. Bu kontroller yeter koşul değildir: build, oyuncu kararı, rastgele olaylar, cihaz/tarayıcı ve oyun seansı sırası hâlâ sonuçları etkiler.

Sadece **her modun son tamamlanan tek koşusunun küçük sayısal özeti** tarayıcı `localStorage` alanındaki yeni `neonCekirdek.tempoCompare.v1` anahtarına yazılır. Tam build, kayıt, skor geçmişi, e-posta, IP, hesap bilgisi, kişisel veri veya tam G1 zaman serisi kaydedilmez. Yalnızca GAME_OVER sonrası bir kez yazılır, savaş sırasında yazılmaz. Bozuk/engellenmiş localStorage oyunu kırmaz. `neonCekirdek.meta.v1` ile asla karıştırılmaz.

Yerel konsol:
```js
window.getNeonRunDiagnostics().tempoRunMetrics
window.getNeonFinalReport()?.tempo
window.getNeonTempoComparison() // {classic:null|{...}, adaptive:null|{...}}
window.clearNeonTempoComparison() // sadece G3 karşılaştırma anahtarını temizler
```

## G3 oyun deneyi planı
Test karşılaştırması için, mümkünse aynı cihaz, aynı tarayıcı, aynı grafik profili ve aynı şasi ile **ABBA** sırası uygula:
1. Klasik: `index.html?tempo=classic` 10-15 dakika ya da son koşuya kadar.
2. Adaptif: `index.html?tempo=adaptive` eş koşulda.
3. İkinci adaptif ve ikinci klasik oturumları ayrıca değerlendir; oyun şu an yalnızca **son birer koşuyu** tarayıcıda tutuyor. Her oturum sonundaki `window.getNeonFinalReport()` ve `window.getNeonTempoComparison()` çıktısını gerekirse ayrı metin olarak sakla.
4. Her koşuda 1–5 arasında öznel **heyecan**, **sıkılma**, **adil hissetme**, **toparlanma fırsatı** puanı ver. Bu algılar oyun kodu tarafından ölçülmez, manuel nottur.
5. 5/10/20+ dakikada boss warning/telegraph, özel baskınlar, XP/kart seçimi ve garantili boss sandıklarının doğru çalıştığını kontrol et.

Oyun sonu süresi/ölüm, kullanıcı **geri gelme oranı (retention)** değildir. Telemetriye bakarak otomatik olarak zorluk artırma, spawn ayarlama veya "oyuncu sıkılmadı" kararı alınmaz.

### Kabul kriterleri
- Eski 281 smoke PASS + G3 8 yeni test = **289 smoke hedefi**.
- Stres eşik histerezisi; sakin blok süreleri; boss ve duraklatma hariç normal savaş paydası; klasik/adaptif gerçek safhaların birbirine karıştırılmaması.
- End-of-run raporu ve sekme keyboard navigation önceki gibi çalışmalı.
- Önceki meta/grafik kaydı aynı; G3 yalnızca ayrı localStorage anahtarı.
- Klasik/adaptif birkaç gerçek oynanış deneyi olmadan G3 UX doğrulandı denemez ve varsayılan adaptif yapılmaz.

## Sonraki tasarım önerisi
Zorluk zaten iyi hissedildiği için yeni güç/HP artışı yerine G4'te **düşman yönü ve desen çeşitliliği**, **bir olayın diğerine bağlanan neden-sonuç ritmi**, ve zirve/nefes anlarında ses-görsel işaretlerin seyrek ve okunur kalması değerlendirilebilir. Bunlar önceki oynanışla A/B denenmelidir.
