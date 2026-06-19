/* Yildiz Avcilari - Cron Worker (basit tetik)
   Gunde 2 kez (13:00 / 20:00 Istanbul) Pages fonksiyonundaki /api/cron-remind
   ucunu gizli anahtarla cagirir; asil push mantigi (VAPID) orada.
   Boylece VAPID anahtari tek yerde (Pages secret) kalir. */
export default {
  async scheduled(event, env, ctx){
    ctx.waitUntil(
      fetch((env.CRON_TARGET || "https://yildizavcilari.com/api/cron-remind"), {
        method: "POST",
        headers: { "X-Cron-Secret": env.CRON_SECRET || "" }
      }).catch((e) => { console.error("cron-remind tetiklenemedi:", e && e.message); })
    );
  }
};
