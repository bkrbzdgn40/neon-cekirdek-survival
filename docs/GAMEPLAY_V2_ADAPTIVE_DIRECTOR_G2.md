# Gameplay V2 G2: Kontrollü adaptif savaş temposu

## Hedef
G1'deki stres/yönetim gözlemcisini, **yalnızca normal düşman doğuşu ve ortak tehdit bütçesi** üzerinde çalışan gerçek bir tempo sürücüsüne bağlamak. Left 4 Dead'in gerilim/nefes ritminden esinlenir, Valve algoritmasının aynısı değildir. Bu aşama **opt-in deney**, klasik ritim **varsayılan**. G3 oynanış kabulünden sonra varsayılanın değiştirilmesi ayrıca değerlendirilir.

## Çalıştırma / hemen geri dönüş
Yerel `index.html` URL'sinin sonuna:
- `?tempo=adaptive`: G2 etkin, gerçek normal düşman gelişine etkisi var.
- `?tempo=classic` veya parametresiz adres: G1 gözlem açık fakat normal düşmanlar **orijinal 64 saniyelik tempo döngüsü** ile gelir.

Bir `?perf=1` varsa `&tempo=adaptive` biçimini kullan. Bu seçim yalnızca URL ile yapılır, kalıcı oyuncu save/şasi/XP veya grafik kalitesi ayarına eklenmez. Karşılaştırmalar arasında oyun yeniden başlatılmalıdır; aktif oyunda modu değiştirme mekanizması bulunmaz. Bu, testte anında geri alınabilirlik ve kullanıcıların habersizce yeni dengeye geçirilmemesi içindir.

## Teknik bağlantı
- `CombatDirector.update(dt)` önce mevcut `getDirectorProfile` ile **`baseProfile`** üretir; G1 observer yakınlık ve olayları gözlemler.
- G2 seçiliyse, boss önceliği dışında önerilen gölge evre normal savaş profiline çevrilir. `getDirectorProfile` isteğe bağlı `normalPhase` parametresi kabul eder. Bu parametre **asla** boss, yaklaşan boss uyarısı veya boss sonrası 4 saniyelik mevcut `RECOVERY` önceliğini geçemez.
- Seçili gerçek `combatDirector.profile` normal `spawnTimer`, `trySpawn`, `tokenRate`, `interval`, `cap`, `eliteChance` hesaplarına bağlanır. Yeni bir düşman spawn yolu/çifte scheduler yoktur; mevcut `MAX_ACTIVE_ENEMIES`, `tokens<=14`, `ENEMY_THREAT_COST` ve mermi kuralları korunur. **Dalga, boss zamanı, HP, hasar, XP, altın ve sandık olasılıkları/garantileri değiştirilmedi.**
- Normal oyuncu stresinin yüksek olması `CRISIS` süresini sonsuza uzatmaz: G1 zaten 4sn SUSTAIN ve 4sn FADE, sonrasında 12–24sn RELAX sınırları uygular.
- Klasik modda `profile` önceki sürümle aynı değerdedir.

| G1 gözlem evresi | G2 normal savaş profili | Hedef |
|---|---|---|
| `BUILDUP` ilk 8sn | `BUILDUP` | Hazırlık ve doğal yükselme |
| `BUILDUP` 8sn sonrası | `PRESSURE` | Kararlı baskı |
| `SUSTAIN` (4sn) | `CRISIS` | Kısa, belirgin zirve |
| `FADE` (4sn) | `BUILDUP` | Zirveden kademeli çıkış |
| `RELAX` (12–24sn) | `RECOVERY` | Oyuncuya nefes |
| `BOSS_LOCK` | Mevcut boss/warning/recovery | Boss sistemine dokunma |

## Baskın ve arena kuralları
- `updateSpecialEncounter` ve `updateArenaEvent` **klasik `baseProfile`** evre uygunluklarına bakar. Bu, eski timer/uyarı/ödül sistemini G2'nin yeni evre isimleriyle karıştırmamayı sağlar.
- Yeni bir baskın, adaptif `RELAX` veya `FADE` anında **teklif edilmez**. Önceden uyarısı başlayan baskın, G2'nin faz değişimi nedeniyle ortadan kaldırılmaz. Yalnızca mevcut boss/klasik yasak koşulları onu iptal edebilir.
- Özel baskınların tehdit puanı bütçesi **normal spawn ile ortaktır**. G2 token kazanımını etkilediğinden baskınların *fiilen* oluşma sıklığı/harcanabilir token miktarı dolaylı değişebilir. Bu durum birinci deneme kapsamının bilinen sınırıdır, "özel karşılaşma sıklığı bire bir aynı kalıyor" diye iddia edilmez. G3'te gözlemleyeceğiz.
- Sabit ilk boss tanıtımları, çoklu boss faz saldırıları, telegraph, son boss öldükten sonra açılan sandık ve boss zamanlayıcısı etkilenmez. Boss öncelikleri otomatik testle korunur.

## Yerel tanılama
```js
window.getNeonRunDiagnostics()
/*
tempoMode: "adaptive" | "classic"
phase: gerçek phase, basePhase: klasik 64sn fazı
adaptivePhase: yalnız normal savaş anında map edilen faz, başka zaman null
tempoPhaseSwitches: boss dışında geçiş sayısı
tempoPhaseSeconds: gerçek profil içinde geçen saniyeler
adaptiveTempo.mode: "driving-spawns" | "observe-only"
adaptiveTempo.stress, mastery, proposedPhase...
*/
window.getNeonIntensityHistory()  // son 180sn, kopya
```
`window.getNeonRunDiagnostics()` görünür modla birlikte gerçek ve klasik fazı yan yana tutar. Ölçümler yereldir ve her koşuda sıfırlanır.

## Test hedefi
Önceki 273 smoke + 8 yeni = **281 hedef**:
1. Parametresiz klasik ve ?tempo flag parser güvenliği.
2. Klasik 64sn orijinal cycle + interval + tokenRate eşitliği.
3. Normal dört gözlem fazının gerçek profile dönüşmesi, stres / dinlenme ayrımı.
4. Gerçek yoğunluk zirvesiyle normal düşman gelir aralığının kısalması, cap/HP/XP korunması.
5. Boss warning / aktif boss / boss sonrası dört saniye, adaptif CRISIS tarafından asla geçirilmemeli.
6. Adaptif dinlenmede yeni özel baskın teklifi olmaması; ilan edilmiş uyarının iptal edilmemesi.
7. Normal `updateGame` akışında yeni ritimle spawnTimer'ın gerçekten değişmesi.
8. Mod, sayaçlar ve koşu sıfırlama.

## Manuel G2 oynanış kabulü
1. Aynı PC/tarayıcı/DPR/şasi ve benzer build ile iki yeni oyun yap: `?tempo=classic` ve `?tempo=adaptive`.
2. 5–10+ dakika dalga/yoğunluk, krizin belirginliği, nefes aralığının hissedilmesi, gereksiz boş kalma ve saldırı uyarısının anlaşılırlığını karşılaştır.
3. 46+ dalga çoklu boss uyarısı -> mermi çıkışı PC46 regresyonu açıktır. Özel baskınlar, arena etkinlikleri, guaranteed chest, reroll ve XP aynı doğru kurallarla çalışmalı.
4. Adaptif modda `window.getNeonRunDiagnostics()` ile `phase` ve `basePhase` ayrımını izle; `tempoPhaseSeconds` her oyun sırasında artar.
5. Farklı oyuncu hâkimiyet seviyelerinde **oyun keyfi** ölçülmeden bu deneyin daha eğlenceli olduğu ilan edilmemelidir.

## Sonraki
**G3**: iki modun oyun kayıtlarında gerçek dalga, run uzunluğu, ölüm oranı, gerilim tepesi/nefes süresi ve özel karşılaşma sayısını karşılaştır. Adaptif mod fazla kolay / fazla stresli veya boss yakınında adaletsizse sabitlere geri dön ve yeniden dene. Kalıcı açma için oyun içi açık seçim gerekebilir.
