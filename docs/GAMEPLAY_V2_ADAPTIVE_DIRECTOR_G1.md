# Gameplay V2 · Adaptif Savaş Yönetmeni: G1 yoğunluk gözlemcisi

## Fikir ve kapsam
Kullanıcının sunduğu Left 4 Dead AI Director videosundaki ana fikir, **oyuncunun yaşadığı gerilimin** (intensity) ve **baskı/rahatlama ritminin** yönetilmesi. Kill sayısına bakıp otomatik düşman cezalandırması yapılmaz. Bu algoritma Valve'in bire bir sayısal uygulamasını kopyalamaz; Neon Çekirdek'e uyarlanmış bir başlangıç hipotezidir.

Neon Çekirdek'te önceden `CombatDirector` mevcuttu. Normal dönemler `getDirectorProfile()` içinde 64 saniyelik saate göre belirleniyor; boss/warning/afterBoss override'ları mevcut. G1, bu yönetmeni değiştirmeden **öneri modunda (observe-only)** çalışan bir yoğunluk modeli ekler. Bu sürümde herhangi bir spawn oranı, can, boss süresi, hasar veya ödül değeri **değişmez**.

## Ayrı tutulan iki ölçüm
1. `stress` 0–100: oyuncunun gerçekten tehlike altında olmasının yaklaşık göstergesi.
   - Oyuncunun gerçek HP kaybı: kayıp HP oranına göre 15–34 yoğunluk katkısı.
   - Kalkan kırılması: +12 yoğunluk.
   - Oyuncunun 170 dünya birimi yakınındaki sıradan düşman ölümü: +2.5; elit ise +4.
   - 170 birim yakınındaki canlı düşman başına 3.8, 125 birim yakınındaki düşman mermisi başına 2.7 geçici baskı (üst sınır 54).
   - Yakında tehlike varken olay stresinin sönümü çok yavaş (.7/sn); tehdit kalkınca 5/sn.
2. `mastery` 0–100: hasar almadan başarılı öldürme göstergesi.
   - Güvenli öldürmeler +2, son 4 saniyede darbe alınmışsa +0.8.
   - Gerçek HP kaybı -16; kalkan kırılması -5; zamanla .55/sn düşer.
   - `mastery`, **şu an oyuncu zorluğunu veya düşman kuvvetini artırmaz**; yalnızca ileride oyunu tek düze yapmamak için ayrı bir sinyal sağlar.

Bu ölçekler, oyun tasarımı için başlangıç sabitleridir; gerçek oyuncu verisiyle doğrulanmadan optimum kabul edilmez. Oyuncu HP kaybı hesabı yalnızca canı gerçekten düştüğünde yapılır. Hasar kalkanla durdurulursa HP kaybı yazılmaz; ayrı kalkan olayı işlenir. Boss ölümü normal kill-stress olayına yazılmaz ve mevcut boss-düşüş kurtarma sistemiyle çakışmaz.

## Gölgede çalışan ritim tahmini
`AdaptiveTempoObserver` normal `CombatDirector` bileşeni olarak saklanır, fakat **gerçek** `profile.phase`, `profile.interval`, `tokenRate`, normal karşılaşma/special algoritması ve boss planına dokunmaz.

Gölge ritmi:
- `BUILDUP`: en az 8 sn, yoğunluk >= 68 ise zirve hazırlığı; 36 sn sonra bir üst evreye geçmeyi *önerir*.
- `SUSTAIN`: 4 sn zirve tutma *önerisi*.
- `FADE`: 4 sn düşüş geçişi.
- `RELAX`: en az 12 sn, stres <= 38 ise yeniden BUILDUP; aşırı uzamaması için 24 sn üst sınır.
- `BOSS_LOCK`: canlı boss, 3.8 sn boss yaklaşma penceresi veya mevcut boss-sonrası nefes süresinde devreye girer. Normal ritim ilerlemez; bittiğinde BUILDUP'tan başlar.

**Henüz düşman yaratımını etkilemediği için** bu faz adları yalnızca karşılaştırma verisidir. Boss kilidi, çoklu boss faz saldırılarına ve zorunlu sandık/ödül garantilerine müdahale etmez.

## Kaynaklar ve maliyet
- Olay kaynakları: `Player.takeDamage()` HP kaybı / kalkan blok, `Enemy.die()` sıradan yakın/distant düşman öldürmesi.
- Yalnızca `updateGame()` akışında `CombatDirector.update(dt)` üzerinden gözlem ilerler. `PAUSED` ve `LEVEL_UP` sırasında oyun zamanı ve gözlemci donuktur.
- Yakınlık sayımı 0.25 oyun saniyesinde bir yapılır; çizim/Canvas yok. Var olan `enemies` ve `enemyProjectiles` listelerini okur, `sort`/rastgele seçim yapmaz, RNG sırasını değiştirmez.
- Son 180 saniyenin yaklaşık 1 saniyelik örnekleri **sabit uzunluklu** `Float32Array(1080)` halka tamponda tutulur. Dışarı aktarım yalnızca kullanıcı talep ettiğinde kopya oluşturur. Oyun kayıtlarına yazılmaz, ağ isteği gönderilmez.
- Her yeni koşuda `new CombatDirector()` ile sıfırlanır. Olaylar seviye atlarken üretilmez.

### Konsoldan yerel görüntüleme
```js
window.getNeonRunDiagnostics().adaptiveTempo
// mode: "observe-only", stress, mastery, proposedPhase,
// proposedPhaseAge, transitions, nearbyEnemies, nearbyProjectiles,
// hpHits, shieldBreaks, kills, nearKills, historySamples

window.getNeonIntensityHistory()
// son 180 sn: second, stress, mastery, nearbyEnemies,
// nearbyProjectiles, proposedPhase
```

## Sınırlamalar ve test hipotezleri
- Oyuncu stresini fizyolojik olarak ölçmüyoruz; oyun olaylarından **proxy** tahmini yapıyoruz.
- G1 yoğunluk puanını gerçek oyuncuların deneyimiyle karşılaştırmadan otomatik karar mekanizmasına bağlamıyoruz.
- Yakın düşman sayımı, ekran dışı spawn'ları değil yakın çevreyi baz alır. Aşırı güçlenmiş karakterin ıskalanan atışları bu turda sinyal değildir.
- Sistem şu an 64 saniyelik savaş döngüsünü değiştirmez. Başarılı adaptif tempo iddiası veya daha uzun oynanma/retention artışı yapılamaz.
- 265 mevcut + 8 yeni otomatik test = **273 hedef**. HP/shield olayı, öldürme yakınlığı, baskı sönümü, gölge döngü, boss kilidi, duraklatma/sıfırlama, bounded history/kopya güvenliği ve mevcut normal profil ile loot eşitliği test edilir.

## Sonraki adımlar
1. **G2, kontrollü entegrasyon:** gözlem değerlerinden normal `BUILDUP/PRESSURE/CRISIS/RECOVERY` döngüsüne **yalnızca normal spawn düzeninde** geçiş; bossların, özel baskın uyarılarının ve ödül haklarının önceliği korunur. Bir feature flag / karşılaştırma modu ve kolay geri dönüş gerekir.
2. **G3, tempo deneyi:** aynı oyuncu/şasi/build için sabit ve adaptif profile bak; 5/10/20/30. dakika stres zirveleri, rahatlama aralıkları, tekrarlanan dipler ve ölüm oranı. Kullanıcıların keyfi ve okunurluğu esas kabul.
3. **Opsiyonel tasarım:** mastery yüksekken yalnızca görsel/konumsal çeşitliliği ve tahmin edilebilirlik riskini artıran düşman kompozisyonu, panikte üretim azaltma, net tehlike uyarısı, oyun sonu tempo grafiği. Gizli HP/damage çarpanları yok.

G2'ye yalnızca G1 gözlem ve test kabulünden sonra geçilmeli.
