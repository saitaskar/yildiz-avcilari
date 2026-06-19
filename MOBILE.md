# 📱 Yıldız Avcıları — Mobil App Paketleme

PWA zaten hazır (`manifest.json` + `sw.js`): kullanıcılar bugün bile telefonda **"Ana Ekrana Ekle"** ile uygulama gibi kullanabilir; web push iPhone'da yalnız bu şekilde çalışır.

Mağaza yayını için iki paket var. Kod tarafı (iskelet) hazır; aşağıdaki adımlar **Sait'e** kalıyor (hesaplar + imza + ekran görüntüleri).

App ID (ikisinde de aynı): **`com.yildizavcilari.app`**

---

## 🤖 Android (Google Play, TWA)

TWA = web sitesini tam ekran saran ince Android kabuğu. En kolay yol PWABuilder.

1. **Google Play Console** hesabı aç (tek seferlik 25 $).
2. **PWABuilder** ile paket üret: https://www.pwabuilder.com → `https://yildizavcilari.com` → **Android (Google Play)** → AAB indir. (Alternatif: `bubblewrap init --manifest https://yildizavcilari.com/manifest.json`, package id `com.yildizavcilari.app`.)
3. Play Console'da uygulamayı oluştur, AAB'yi yükle.
4. Play Console > **Setup > App integrity > App signing** ekranından **SHA-256** parmak izini kopyala.
5. O parmak izini `public/.well-known/assetlinks.json` içindeki `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` yerine yapıştır, **frontend'i yeniden deploy et** (yoksa adres çubuğu görünür, tam-ekran olmaz).
6. Mağaza kaydını doldur (`store-assets/listing.md`), ekran görüntülerini ekle, **incelemeye gönder**.

> assetlinks.json `https://yildizavcilari.com/.well-known/assetlinks.json` adresinden servis edilmeli. Deploy sonrası tarayıcıda aç, JSON döndüğünü doğrula. (Cloudflare Pages `.well-known`'ı servis eder.)

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
