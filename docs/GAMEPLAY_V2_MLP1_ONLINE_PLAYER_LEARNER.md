# Gameplay V2 · MLP1: Gerçek çevrim içi oyuncu öğrenimi (güvenli gözlem)

## Tasarım kararı
Bu, G1/G2'deki "stres ölçen kural tabanlı sistem" ile aynı şey değildir. **MLP1**, oyuncunun geçmiş eylem ve tehlike bağlamından **gelecekteki bir olayın olasılığını tahmin etmeye çalışan, gerçek ağırlık güncellemesi yapan modeldir**.

Algoritma, tarayıcıdaki küçük **online lojistik regresyon / SGD** modelidir. Her **8 aktif oyun saniyesinin başlangıcında** sekiz özellikten bir vektör oluşturur, 8 saniye sonra gerçek sonuçla (bu sırada en az bir kez **HP azaltan hasar aldı mı?**, 0/1) karşılaştırır. Önce eski ağırlıklarıyla yapılan tahminin hatasını kaydeder; sonra `(label - probability) * feature` gradyanı ve düzenlileştirme ile ağırlıkları değiştirir.

*Bu model gerçekten eğitim yapar ama başlangıç aşamasında yalnızca tahmin/öğrenme yapar; oyun direktörünün kararları üzerinde yetkisi **yoktur**. "Oyuncuya özel öğrenen yönetmen" diye pazarlamak için daha erken.*

## Nasıl açılır?
- Orijinal oyun: `index.html` → klasik; oyuncu model eğitimi kapalı.
- Mevcut adaptif: `index.html?tempo=adaptive` → G2 gerçek tempo adaptasyonu; oyuncu model eğitimi kapalı.
- **Öğrenmeyi gözlemle:** `index.html?tempo=adaptive&learn=on` → G2 temposu değişmeden kalır, arka planda SGD eğitilir.
- Klasik referansla bağımsız öğrenim: `index.html?tempo=classic&learn=on`.

Konsol:
```js
window.getNeonPlayerLearner()
// enabled, mode, chassis, trainedWindows, thisRunWindows, positiveWindows,
// readyForEvaluation, preUpdateBrier, baselineBrier,
// predictedRisk, previousOutcome, weights, featureNames,
// controlsSpawns: false

window.clearNeonPlayerLearner()
// Yalnızca öğrenen modelin ayrı yerel kayıt anahtarını ve aktif modeli sıfırlar.
```

## Özellikler ve etiket
Tamamı pencerenin **başında** ölçülür, 0–1 ölçeğine çekilir:
1. Bias.
2. 170 oyun biriminde yakındaki düşman sayısı (12'ye bölünmüş ve sınırlı).
3. 125 birimde düşman mermisi (8'e bölünmüş ve sınırlı).
4. HP açığı: `1 - hp/maxHp`.
5. G1 mevcut stres puanı / 100.
6. G1 hâkimiyet puanı / 100.
7. Önceki *tamamlanan* öğrenme penceresinin kill sayısı / 20.
8. Önceki öğrenme penceresinde gerçek HP alan hit sayısı / 3.

8 saniye sonundaki HP azaltan hit sayısı > 0 ise etiket **1**, değilse **0**. *Bu bir ölüm tahmini değil, bir risk proxy'sidir.* Kalkan blokları hedef etiketine dahil edilmez. Eski özellikleri sonuçtan sonra değiştirmek yasak; eğitim **geleceği görmeden** başlar.

Boss varsa, boss yaklaşmasına 8.2 saniyeden az kalmışsa, boss warning veya boss sonrası koruma penceresindeyse, ya da oyuncunun HP'si sıfırsa bekleyen örnek **atılır**. Böylece boss karşılaşmaları normal çatışmadaki kişisel risk kalibrasyonunu kirletmez. Duraklatma / LEVEL_UP dönemlerinde modelin oyun saati ilerlemez.

## Matematik ve kontrol
- `p = sigmoid(clamp(w·x, -12,12))`; doğrudan 0 ile 1 arasında.
- Örneğin tamamlanmasından sonra: `w_i = clamp(w_i * (1 - lr * 0.002) + lr * (label - p) * x_i, -8,8)`.
- `lr = 0.18 / sqrt(1 + n/24)`: veri geldikçe adım azaltılır. Bu değerler başlangıç hipotezidir; araştırmayla kanıtlanmış optimumlar değildir.
- Basit kontrol modeli: *sadece geçmişte kaç pencerenin pozitif çıktığı* ile `(positives+1)/(samples+2)` tahmini.
- `preUpdateBrier` ve `baselineBrier` ortalamaları **eğitimden önceki** gerçek tahmin hatasını tutar. Brier küçükse tahmin daha iyidir. Başlangıç/az örnekle bu karşılaştırma güvenilir sayılmaz.
- `readyForEvaluation`, en az 24 pencere ve en az 4 pozitif/4 negatif varsa true olur. Bu **doğrulanmış başarılı model** anlamına gelmez; sadece değerlendirmeye yetecek en basit veri eşiğidir.
- Eğitim sırasında spawn ayarı, normal/özel düşman cap, boss, elite, XP, ekonomi, oyuncu HP/hasarı ve RNG kesinlikle değiştirilmez.

## Hafıza ve gizlilik
- **Şasi başına ayrı** parametre seti (`VANGUARD`, `PHANTOM`, `TITAN`), yanlışlıkla şasiler birbirini eğitmez.
- `neonCekirdek.playerLearner.v1` anahtarında yalnızca 8 ağırlık, toplam örnek/pozitif sayısı ve iki hata toplamı saklanır. Oyuncu kimliği, ham savaş olayı, koordinatlar, kill geçmişi, IP veya analiz dökümleri saklanmaz.
- Bu kayıt sadece **koşu GAME_OVER ile tamamlandığında** yapılır. Devam eden oyunda disk/storage yazma yok; sayfa kapanırsa son bitmeyen koşunun eğitimi taşınmaz. Bozuk/engel koyulmuş localStorage oyunu bozmaz.
- Aynı cihazın aynı tarayıcısındaki diğer kullanıcılar şasiyi paylaşır. Bu bir gerçek kişi hesabı/profili değildir. Çoklu oyuncu ayırımı istenirse açık, yerel profil seçimi ayrı tasarlanmalı.
- Model opt-in `?learn=on`. Her koşuda tekrar ayrı model başlatılsa da son **kaydedilmiş** ağırlıkları geri yükler.

## İlerleme / sonraki aşamalar
**MLP1:** gerçek trainable learner, eski klasik/adaptif gameplay ile gölgede kalır. Bu PR sadece test edilebilir altyapıdır.

**MLP2, offline değerlendir:** yeterli pozitif ve negatif örneklerde, *önceden yapılan tahminlerin* Brier puanını naif tabanla karşılaştır; istatistiksel stabilite, sınıf dengesizliği, oyuncu/şasi farklılığı ve yön değişen oyun koşullarına bak. Sadece pozitif birim testiyle gerçek oyuncu tahmin başarısı kanıtlanmaz. Ölçmeden modüle etki yetkisi vermeyelim.

**MLP3, güvenli politika pilotu:** yeterli veri ve doğrulama varsa öğrenilen risk tahmininden kontrollü `PRESSURE/RECOVERY` zamanlaması üret; min/max süre ve token cap korunacak, 4 saniyelik boss önceliklerine dokunulmayacak. Kapalı default, feature flag, risk modeli yanlışsa klasik/Adaptive G2'ye dönüş.

## Kabul
- Önceki **289** smoke + **10** model testi = hedef **299** PASS.
- Pozitif/negatif örneklerden **ağırlıklar gerçekten güncellenmeli**, ayrışabilir sentetik örneklerde yeni model öncül taban çizgisinden daha iyi Brier göstermeli.
- Oyunda eğitim penceresi bitmeden öğrenim yok; boss/kart/duraklatma örnekleri etiketlenmiyor.
- Karar/tokens/temel profil RNG değişmeden kalıyor.
- Şasi bazında kalıcılık, güvenli bozuk kayıt, açıklanabilir snapshot ve silme testleri.
- **Gerçek oyunla manuel uzun test henüz yapılmadı**. Başarılı eğitim mekanizması oyuncunun sıkılmasının otomatik ölçülmesi değildir.
