# 🌟 Yıldız Avcıları

> Çocuklara oyunlaştırma ile iyi alışkanlık kazandıran, RPG temalı bir aile görev portalı.

Çocuklar haftalık ve günlük görevleri tamamlar, kanıt yükler, ebeveyn/onaylayıcı onaylar ve topladıkları **yıldızlarla** (XP) ortadaki **gizemli siluet** netleşir. Hedefe ulaşınca ödül açılır. "Who's That Pokémon?" mantığında bir merak mekaniği üstüne kurulu.

Gerçek hayatta bir karne hediyesi (Nintendo Switch Lite) bedavadan verilmek yerine, çocukların güzel alışkanlıklarla "hak etmesi" için tasarlandı.

---

## ✨ Öne çıkanlar

- **RPG Başlangıç Sihirbazı** — Çocuk ilk girişte sinematik bir intro ile karşılanır, bir *sınıf* seçer ve bir kılavuz bot sistemi anlatır.
- **3 sürükleyici tema** — seçilen temaya göre tüm arayüz, renkler ve görev dili değişir:
  - 🚀 **Galaktik Kaşif** (Sci-Fi) — "Yer Çekimi Kalkanlarını Aktif Et", kılavuz: NOVA
  - ⚔️ **Fantastik Diyarlar** (RPG) — "Beyaz Zırh Bakımı", kılavuz: Eldric
  - 🧱 **Piksel Evreni** (Voxel) — "Spawn Noktasını Düzenle", kılavuz: Bit
- **Zaman pencereli görevler** — her görev günün belli saatlerinde aktif (yatak toplama sabah, diş fırçalama sabah+akşam).
- **Yaşa göre içerik** — 8 yaş "günün hayvanı", 13 yaş "yapay zeka nasıl çalışır".
- **Yapay zeka onaylı öğrenme görevi** — çocuğun yazdığı "yeni öğrendiğim şey" metnini bir bot okuyup yaşına uygun, kendi cümleleri mi diye değerlendirir (prototipte simüle, backend'de gerçek model).
- **Onay akışı** — çocuk kanıt gönderir, ebeveyn/teyze tek dokunuşla onaylar/reddeder, XP havuza düşer.
- **Dinamik siluet** — XP doldukça tema diline göre metin değişir ("Mühür çatlamaya başladı", "Yapı %50 craft edildi").
- **Dostça sıralama** — her çocuk kendi barını doldurur, ortak liderlik tablosu motive eder.

---

## 🕹️ Demo

`index.html` tek dosya, hiçbir kurulum gerektirmez. Tarayıcıda aç, veriler `localStorage`'da tutulur.

**Demo giriş bilgileri:**

| Rol | İsim | PIN |
|---|---|---|
| 🧒 Çocuk | Demir (13) | `1111` |
| 🧒 Çocuk | Kuzey (8) | `2222` |
| 🧒 Çocuk | Toprak (13) | `3333` |
| 👪 Onaylayıcı | Elif / Mert / Selin / Derya / Can | `1234` |
| ⭐ Yönetici | Yönetici | `0000` |

> Yönetici panelinden "Demo veri ekle" ile sistemi dolu görebilirsin. İsimler tamamen demo amaçlıdır.

---

## 🧱 Teknoloji

**Faz 1 (bu repo):** Tek dosya HTML + CSS + vanilla JS, `localStorage` ile çalışan tam akışlı prototip. Build step yok.

**Faz 2 (planlanan):** Cloudflare üzerinde production
- **Backend:** Cloudflare Worker (API)
- **Veritabanı:** D1 (görevler, kullanıcılar, tamamlamalar)
- **Depolama:** R2 (fotoğraf kanıtları)
- **AI:** Öğrenme görevini değerlendiren dil modeli

---

## 🗺️ Yol haritası

- [x] Faz 1 — Frontend prototip (tema motoru, sihirbaz, onay akışı, siluet)
- [ ] Faz 2 — Cloudflare backend (Worker + D1 + R2), gerçek PIN auth, AI değerlendirme
- [ ] Faz 3 — Deploy + her ay yeni sezon / yeni ödül
- [ ] Ebeveynin özel görev tanımlaması
- [ ] Bildirimler (görev zamanı geldi, onay bekliyor)

---

## 📂 Yapı

```
yildiz-avcilari/
├── index.html      # tüm uygulama (Faz 1 prototip)
├── README.md
└── LICENSE
```

---

## 📝 Lisans

MIT. Detay için [LICENSE](LICENSE).

---

*Sevgiyle, oyunlaştırma ile çocuklara iyi alışkanlıklar için. 💙*
