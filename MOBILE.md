# 📱 Yıldız Avcıları — Mobil App Paketleme

PWA zaten hazır (`manifest.json` + `sw.js`): kullanıcılar bugün bile telefonda **"Ana Ekrana Ekle"** ile uygulama gibi kullanabilir; web push iPhone'da yalnız bu şekilde çalışır.

Mağaza yayını için iki paket var. Kod tarafı (iskelet) hazır; aşağıdaki adımlar **Sait'e** kalıyor (hesaplar + imza + ekran görüntüleri).

App ID (ikisinde de aynı): **`com.yildizavcilari.app`**

---

## 🤖 Android (Google Play, TWA)

TWA = web sitesini tam ekran saran ince Android kabuğu. **AAB yerelde Bubblewrap ile üretildi + imzalandı** (Claude Code, 2026-06-22).

**Üretilen dosya:** `app/android-twa/app-release-bundle.aab` (imzalı, ~1.5 MB, package `com.yildizavcilari.app`, v1.0.0).
İmza = upload key `app/android-twa/android.keystore` (şifre `keystore-credentials.txt`, **gitignored, YEDEKLE**), SHA-256 `15:75:AA:C0:F1:E3:24:A6:82:93:51:20:80:4E:BD:29:BB:09:DD:73:7A:D7:35:07:F5:91:DA:C8:DC:3A:03:68`.

Yeniden derleme (sürüm bump'ta): `twa-manifest.json`'da `appVersionCode`+`appVersionName` artır → `pwsh app/android-twa/build-aab.ps1`.
(Toolchain: JDK 17 Temurin + Android SDK `C:\dev\android-sdk` [platforms;android-36, build-tools;36.0.0] + Bubblewrap CLI. Bubblewrap'in kendi `gradlew` çağrısı Windows'ta tutmadığı için derleme `build-aab.ps1` ile elle sürülüyor: `gradlew bundleRelease` + `jarsigner`.)

**Sait'in adımları (Play Console, elle — bkz. `store-assets/play-submission.md`):**
1. **Play Console**'da uygulamayı oluştur (App ID `com.yildizavcilari.app`).
2. Hedef kitle/Families, **Veri güvenliği**, İçerik derecelendirme, gizlilik (yildizavcilari.com/gizlilik.html) + hesap silme (yildizavcilari.com/hesap-sil.html) bölümlerini doldur (cevaplar föyde).
3. **Internal testing** track'ine `app-release-bundle.aab`'yi yükle (Play App Signing açık bırak).
4. Yükleme sonrası **Setup > App signing > App signing key certificate SHA-256**'yı kopyala → bana ver.
5. Ben o parmak izini `public/.well-known/assetlinks.json`'a ekleyip frontend'i deploy ederim (yoksa adres çubuğu görünür, tam-ekran olmaz). **İKİ AŞAMA: assetlinks ancak Play App Signing parmak izi eklenince tamamlanır.**
6. Mağaza kaydı (`store-assets/listing.md`) + feature graphic 1024×500 + 5 ekran görüntüsü → **incelemeye gönder**.

> assetlinks.json `https://yildizavcilari.com/.well-known/assetlinks.json` adresinden servis edilmeli (Cloudflare Pages `.well-known`'ı servis eder). Şu an placeholder; Play App Signing SHA-256 eklenince geçerli olur.

---

## 🍎 iOS (App Store, Capacitor — Mac gerekmez)

Mac yok → **Codemagic** bulut Mac'inde derlenir. İskelet `app/ios-wrapper/` altında hazır (`capacitor.config.json` siteyi sarar, `codemagic.yaml` CI).

1. **Apple Developer Program** hesabı (yıllık 99 $).
2. `app/ios-wrapper/codemagic.yaml` başındaki adımları izle (Codemagic'e repo ekle + App Store Connect API key).
3. Workflow'u çalıştır → IPA üretilir → **TestFlight**'a yüklenir.
4. App Store Connect'te mağaza kaydını doldur (`store-assets/listing.md`), ekran görüntüleri, **incelemeye gönder**.

---

## 📋 Her ikisi için gereken
- **İkon:** `public/icon-512.png` (mevcut) mağaza ikonu olur. Daha büyük gerekirse 1024×1024 üretilebilir.
- **Ekran görüntüleri:** Sait 5 adet versin (login, çocuk ekranı, tema seçimi, ödül siluet, aile onay). Telefon çözünürlüğünde.
- **Kategori:** Eğitim / Ebeveynlik. **İçerik derecesi:** Herkes / 3+.
- **Gizlilik:** çocuk uygulaması; veri minimizasyonu + veli rızası (yasal sayfalar + `store-assets/listing.md`'de özet).
- **Mağaza metni:** `store-assets/listing.md` (TR + EN).

## Açık uçlar (Sait kararı)
- Google Play + Apple developer hesapları (Gelsene'de açıldı, aynı hesaplar kullanılabilir).
- Bundle id `com.yildizavcilari.app` onayı (istersen `tr.yildizavcilari.app`).
