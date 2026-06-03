# 🌟 Yıldız Avcıları

> 🇬🇧 [English README](README.md)

Çocuklara oyunlaştırma ile iyi alışkanlık kazandıran, RPG temalı bir aile görev portalı.

Çocuklar günlük ve haftalık görevleri tamamlar, kanıt yükler, ebeveyn onaylar ve topladıkları **yıldızlarla** ortadaki **gizemli ödül** adım adım ortaya çıkar ("Who's That Pokémon?" mantığında bir merak mekaniği). Hedefe ulaşınca ödül açılır.

Amaç: gerçek bir ödülü bedavadan vermek yerine, çocukların güzel alışkanlıklarla **hak etmesini** sağlamak, eğlenceli bir oyuna dönüştürmek.

**🕹️ Canlı tanıtım:** [yildizavcilari.cryme.tr/demo.html](https://yildizavcilari.cryme.tr/demo.html) (TR/EN)

> "Vibe coding" ile yapıldı — baştan sona bir yapay zeka kodlama ajanıyla tasarlanıp yayına alındı.

---

## ✨ Öne çıkanlar

- **RPG başlangıç sihirbazı** — Çocuk ilk girişte sinematik bir intro görür, bir *sınıf* seçer, kılavuz bot sistemi oyun gibi anlatır.
- **3 sürükleyici tema** — seçilen temaya göre tüm arayüz, renkler ve görev dili değişir:
  - 🚀 **Galaktik Kaşif** (Sci-Fi) — "Yer Çekimi Kalkanlarını Aktif Et", kılavuz: NOVA
  - ⚔️ **Fantastik Diyarlar** (RPG) — "Beyaz Zırh Bakımı", kılavuz: Eldric
  - 🧱 **Piksel Evreni** (Voxel) — "Spawn Noktasını Düzenle", kılavuz: Bit
- **Yapay zeka öğrenme sohbeti** — Haftalık "yeni bir şey öğren" görevi bir *sokratik sohbet*: kılavuz bot ne öğrendiğini sorar, sorularla gerçekten anlayıp anlamadığını sınar, ancak ondan sonra yıldızı verir. Ezber ve kopyala-yapıştır geçmez. Claude Haiku ile çalışır (Cloudflare Workers AI yedeğiyle).
- **Zaman pencereli görevler** — her görev günün belli saatlerinde aktif (yatak sabah, diş sabah+akşam).
- **Yaşa göre içerik** — 8 yaş "günün hayvanı", 13 yaş "yapay zeka nasıl çalışır".
- **Onay akışı** — çocuk kanıt gönderir, ebeveyn/teyze tek dokunuşla onaylar/reddeder, yıldız havuza düşer.
- **Ekstra görevler** — ebeveynler çocuğa özel, tek seferlik görev tanımlayabilir.
- **Ara ödül checkpoint'leri** — aile (ve admin) büyük ödüle giderken ara hedefler koyar (örn "1000 ⭐ → dondurma"). Çocuğun barında işaretli görünür; büyük ödül gizli kalır, ara ödüller görünür. Ulaşınca kutlama + ebeveyne "ödülü ver" bildirimi.
- **Hediye kaydı & metrikler** — admin panelinde kim ne kazandı, toplam yıldız ve görev sayısı izlenir. Ebeveynler de tam sıralamayı görür.
- **Dinamik siluet** — yıldız doldukça tema diline göre metin değişir ("Mühür çatlıyor", "Yapı %50 craft edildi").
- **Dostça sıralama** — her çocuk kendi barını doldurur, ortak tablo motive eder.
- **Güvenlik** — sunucu taraflı PIN doğrulama (HMAC token), brute-force kilidi, mahremiyet-minimal public uçlar, foto boyut limiti.

---

## 🧱 Teknoloji

Tek sayfa vanilla JS arayüz (build step yok) + tamamen serverless Cloudflare backend:

- **Hosting + API:** Cloudflare Pages + Pages Functions (aynı domainde `/api/*`, CORS yok)
- **Veritabanı:** Cloudflare D1 (kullanıcılar, tamamlamalar, özel görevler, sezonlar, hediye kaydı)
- **Depolama:** Cloudflare R2 (fotoğraf kanıtları)
- **AI:** Claude Haiku (birincil) + Cloudflare Workers AI (Llama) yedek
- **Auth:** HMAC imzalı oturum token'ı, rate-limit'li PIN girişi

Görev kataloğu kodda; kullanıcı verisi D1'de.

---

## 📂 Yapı

```
yildiz-avcilari/
├── public/
│   ├── index.html        # tüm uygulama (arayüz)
│   └── demo.html          # çift dilli (TR/EN) tanıtım sayfası
├── functions/
│   └── api/[[path]].js    # Pages Functions API (auth, görev, onay, AI sohbet, hediye)
├── backend/
│   ├── schema.sql         # D1 şema
│   └── seed.sql           # demo seed (jenerik isimler; gerçek aile verisi asla repoda değil)
├── wrangler.toml
├── README.md / README.tr.md
└── LICENSE
```

---

## 🚀 Kendin çalıştır

Cloudflare hesabı ve [Wrangler](https://developers.cloudflare.com/workers/wrangler/) gerekir.

```bash
wrangler d1 create yildiz-db                    # 1. D1 oluştur, id'yi wrangler.toml'a koy
wrangler r2 bucket create yildiz-proofs         # 2. R2 bucket
wrangler d1 execute yildiz-db --remote --file backend/schema.sql   # 3. şema
wrangler d1 execute yildiz-db --remote --file backend/seed.sql     # + demo seed
wrangler pages secret put SESSION_SECRET --project-name=yildiz-avcilari   # 4. oturum secret
wrangler pages deploy                           # 5. deploy
```

`ANTHROPIC_API_KEY` olmadan AI sohbet otomatik olarak Cloudflare Workers AI (ücretsiz kota) kullanır, başlamak için ekstra anahtar gerekmez.

Demo seed girişleri: çocuklar `1111` / `2222` / `3333`, onaylayıcılar `1234`, admin `0000`.

---

## 🗺️ Yol haritası

- [x] Faz 1 — Frontend prototip (tema motoru, sihirbaz, onay akışı, siluet)
- [x] Faz 2 — Cloudflare backend (Pages Functions + D1 + R2), sunucu taraflı PIN auth, AI öğrenme sohbeti
- [x] Ekstra görevler (ebeveyn tanımlı) + ara ödül checkpoint'leri + hediye kaydı & metrikler
- [ ] Aylık sezon döngüsü (her ay yeni ödül)
- [ ] Admin'den düzenlenebilir görev kataloğu
- [ ] Bildirimler (görev zamanı, onay bekliyor)

---

## 📝 Lisans

MIT — bkz [LICENSE](LICENSE).

---

*Sevgiyle, çocuklara iyi alışkanlıkları oyuna dönüştürmek için. 💙*
