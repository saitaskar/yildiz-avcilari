# Google Play — Gönderim Föyü (doldur-yapıştır)

App ID: `com.yildizavcilari.app` · Web: https://yildizavcilari.com
Bu föy, Play Console'da "uygulama oluştur" sonrası her bölümün cevabı. Metinler `listing.md`'de.

---

## 1. Uygulama içeriği (App content) — sırayla doldur

### Gizlilik politikası
- URL: **https://yildizavcilari.com/gizlilik.html**

### Hesap silme (Data deletion)
- "Uygulama kullanıcı hesabı oluşturmaya izin veriyor mu?" → **Evet**
- Hesap + veri silme URL'si: **https://yildizavcilari.com/hesap-sil.html**
- (Uygulama içinden de silinebiliyor: Hesap > profil/aile/hesabı sil.)

### Reklamlar
- Uygulama reklam içeriyor mu? → **Hayır**

### Hedef kitle ve içerik (Target audience) — DİKKAT: çocuk uygulaması
- Hedef yaş grupları: **13 yaş altı dahil** (ör. 6-8, 9-12) + yetişkin (ebeveyn).
- → Bu seçim **Google Play "Families" politikasını** tetikler. Aşağıdaki Families bölümünü doldurman gerekir.
- "Çocuklara mı yönelik?" → Evet (ebeveyn-yönetimli çocuk uygulaması).
- Reklam yok, üçüncü-taraf veri paylaşımı yok → Families uyumu kolaylaşır.

### İçerik derecelendirmesi (Content rating anketi)
- Kategori: **Uygulama (Eğitim / Ebeveynlik)**
- Şiddet/cinsellik/küfür/kumar/madde → **hepsi Hayır**
- Kullanıcı etkileşimi: uygulama içi mesajlaşma var mı? → çocuğun **AI rehberle öğrenme sohbeti** var (kişiler arası sohbet DEĞİL, kullanıcılar birbiriyle yazışmıyor). Ebeveyn bu sohbetleri denetler. → "kullanıcılar arası iletişim" = **Hayır**.
- Beklenen sonuç: **Herkes / 3+ (PEGI 3 / ESRB Everyone)**.

### Data safety (Veri güvenliği) — toplanan veriler
Topla + işle, **satış YOK, reklam-amaçlı paylaşım YOK**, aktarımda şifreli (HTTPS), kullanıcı silebilir:
| Veri | Toplanıyor mu | Amaç |
|---|---|---|
| E-posta (ebeveyn) | Evet | Hesap, kimlik doğrulama |
| İsim (ebeveyn + çocuk profil adı) | Evet | Uygulama işlevi |
| Yaş (çocuk, opsiyonel) | Evet | Uygulama işlevi (yaşa uygun içerik) |
| Fotoğraf (görev kanıtı) | Evet | Uygulama işlevi (ebeveyn onayı) |
| Uygulama içi metin (öğrenme sohbeti) | Evet | Uygulama işlevi (öğrenme değerlendirme) |
| Push token | Evet | Bildirim (ebeveyn onay hatırlatma) |
- Üçüncü taraflarla paylaşım: **Hayır** (altyapı sağlayıcısı = veri işleyen, paylaşım değil).
- Tüm veriler aktarımda şifreli: **Evet**.
- Kullanıcı silme talep edebilir: **Evet** (uygulama içi + e-posta).

---

## 2. Mağaza kaydı (Store listing)
- Uygulama adı: **Yıldız Avcıları** (`listing.md` Başlık)
- Kısa + uzun açıklama: `listing.md` (TR varsayılan; EN dil ekle)
- Kategori: **Eğitim** (veya Ebeveynlik)
- İletişim e-postası: **iletisim@yildizavcilari.com** (DNS kurulunca; o zamana kadar mevcut adresin)
- Grafikler:
  - Uygulama ikonu: 512×512 (var: `icon-512.png`)
  - Öne çıkan grafik (Feature graphic): **1024×500** (GEREKLİ — Sait üretmeli/üretiriz)
  - Telefon ekran görüntüleri: **en az 2, önerilen 5** (`listing.md` listesi; Sait çekecek)

---

## 3. Sürüm (Release)
- AAB: `app/android-twa/app-release-bundle.aab` (Claude Code üretti, yerel Bubblewrap)
- İlk yükleme: **Internal testing** (kapalı) → cihazda doğrula → sonra Production.
- Play App Signing: **açık bırak** (varsayılan). Yükledikten sonra:
  - Play Console > Test/Release > Setup > **App signing** > **App signing key certificate SHA-256**'yı kopyala.
  - Bu parmak izini `public/.well-known/assetlinks.json`'a EKLE (upload key parmak izi zaten orada; ikisi bir arada durur) → frontend redeploy.
  - Doğrula: https://yildizavcilari.com/.well-known/assetlinks.json iki parmak izi de döner.

---

## 4. Üretilmesi gerekenler (Sait/Claude)
- [ ] Feature graphic 1024×500
- [ ] 5 telefon ekran görüntüsü (`listing.md` listesi)
- [ ] (Sonra) Play App Signing SHA-256 → assetlinks + redeploy
