# main dalı koruması (repo yöneticisi uygulayacak)

GitHub Actions başarıyla koşsa bile `main` kuralı etkin değilse, başarısız testli bir commit doğrudan gönderilebilir. GitHub bağlantımızın mevcut işlem araçları `branch protection/ruleset` **yazma** desteği sağlamıyor. Bu dosya **etkin koruma değildir**.

GitHub web arayüzünde depo yöneticisi:

1. **Settings → Rules → Rulesets → New branch ruleset** menüsünü açar.
2. Hedef dal olarak `main` seçer ve kuralların **Active** olduğunu doğrular.
3. **Require a pull request before merging**, **Require status checks to pass**, **Block force pushes** ve **Restrict deletions** seçeneklerini etkinleştirir.
4. Gerekli statü kontrolleri olarak workflow job adları **`smoke`** ve **`browser`** seçilir. Bunlar `.github/workflows/neon-smoke.yml` içindeki işlerdir.
5. Geçersiz bir PR veya başarısız check ile merge/direkt push engelinin çalıştığını doğrular. Acil durum admin bypass kuralları varsa açıkça belgelendirir.

İlgili takip işi: [#46](https://github.com/bkrbzdgn40/neon-cekirdek-survival/issues/46).
## Bu depodaki mevcut kontroller

Birleştirmeyi engellemesi gereken iki kontrol: **smoke** ve **browser**. [neon-soak.yml](../.github/workflows/neon-soak.yml) altındaki **soak** haftalık/manüel performans örneklemesi içindir; zorunlu bir PR kontrolü olması gerekmez. Bu belgenin varlığı GitHub Ruleset'i etkinleştirmez. `branches/main` üzerinde `protected: true` görülene ve başarısız check birleşmesi engellenene kadar risk açık tutulur.
