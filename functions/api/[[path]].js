/* Yildiz Avcilari - Pages Functions API (/api/*)
   D1 (DB) + R2 (PROOFS) + Claude (ANTHROPIC_API_KEY). Token: HMAC (SESSION_SECRET).
   Gorev katalogu KODDA (frontend); worker ham veri doner, XP'yi frontend hesaplar. */

const enc = new TextEncoder();
const AI_TASKS = new Set(["ogren"]);          // sohbetli AI gorevi
const TOKEN_TTL = 1000*60*60*12;               // 12 saat (calinan token riskini sinirla)
const MAX_PHOTO_CHARS = 750000;                // ~550KB base64 foto siniri (R2 kotuye kullanim)
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_CHILD_TURNS = 4;                     // bu kadar mesajdan sonra AI karar vermek zorunda

/* ---------- yardimcilar ---------- */
const json = (data, status=200) =>
  new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json"}});
const bad = (msg, status=400) => json({error:msg}, status);

function b64url(buf){
  const b = String.fromCharCode(...new Uint8Array(buf));
  return btoa(b).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromB64url(s){
  s = s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="=";
  return Uint8Array.from(atob(s), c=>c.charCodeAt(0));
}
async function hmacKey(secret, usage){
  return crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, usage);
}
async function signToken(payload, secret){
  const data = b64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return data + "." + b64url(sig);
}
async function verifyToken(token, secret){
  if(!token || token.indexOf(".")<0) return null;
  const [data, sig] = token.split(".");
  const key = await hmacKey(secret, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(data));
  if(!ok) return null;
  try{
    const p = JSON.parse(new TextDecoder().decode(fromB64url(data)));
    if(!p.exp || p.exp < Date.now()) return null;
    return p;
  }catch(e){ return null; }
}
function safeUser(u){
  return { id:u.id, role:u.role, name:u.name, age:u.age, av:u.av, title:u.title,
    theme:u.theme, parents:u.parents?JSON.parse(u.parents):null, kids:u.kids?JSON.parse(u.kids):null };
}
async function auth(request, env){
  const h = request.headers.get("Authorization")||"";
  let token = h.replace(/^Bearer\s+/i,"");
  if(!token){ try{ token = new URL(request.url).searchParams.get("t")||""; }catch(e){} } // <img> foto icin
  const p = await verifyToken(token, env.SESSION_SECRET || "dev-secret-change-me");
  if(!p) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(p.uid).first();
  return u || null;
}

/* ---------- ogrenme SOHBETI (Cloudflare Workers AI, sokratik) ----------
   action: "ask" (soru sor, devam) | "pass" (gercekten ogrenmis, tamamla) | "fail" (yetersiz, nazikce gonder) */
async function aiChat(env, messages, age, botName, themeMood, childTurns){
  if(!env.AI){ return { action:"pass", reply:"Aferin, görevi tamamladın!" }; }
  const force = childTurns >= MAX_CHILD_TURNS;
  const sys =
    "Sen "+botName+", "+age+" yaşındaki bir çocukla sohbet eden meraklı, sıcak bir rehbersin. "+themeMood+" "+
    "Çocuk bugün öğrendiği YENİ bir şeyi anlatıyor. Amacın kısa bir sohbetle gerçekten öğrenip öğrenmediğini ve konuyu ANLADIĞINI test etmek.\n\n"+
    "NASIL DAVRAN:\n"+
    "- Çocuğa 'sen' de, KISA konuş (1-2 cümle), çocuk diliyle, sıcak ve teşvik edici ol.\n"+
    "- Çocuk sadece konuyu söyleyip açıklamadıysa MERAKLA sor: 'nasıl oluyormuş?', 'neden?', 'bir örnek verir misin?'.\n"+
    "- Açıkladıkça, gerçekten anladığını sınayan 1 takip sorusu daha sor.\n"+
    "- Metin ansiklopedi/ders kitabı gibi kusursuz ve yetişkin ağzındaysa kopya şüphelidir: 'kendi cümlelerinle anlatır mısın?' diye iste.\n\n"+
    "KARAR:\n"+
    "- Çocuk konuyu KENDİ cümleleriyle, BİRKAÇ CÜMLEYLE açıklayıp en az 2 sorunu yanıtladıysa ve anladığı belliyse: action='pass', reply='kutlama'.\n"+
    "- Hâlâ yüzeysel, tek kelimelik, sadece konu adı veya eksikse: action='ask', reply='kısa bir soru'.\n"+
    "- Çocuk açıklayamıyor, bilmiyor ya da konu dışıysa: action='fail', reply='nazikçe biraz daha araştırıp gelmesini söyle'.\n"+
    "ÇOK ÖNEMLİ: İlk mesajlar genelde yüzeyseldir. Çocuk gerçek bir AÇIKLAMA yapana ve en az 2 sorunu cevaplayana kadar ASLA 'pass' verme. Tek kelime ('neptün') ya da sadece konu adı ('gezegenleri öğrendim') KESİNLİKLE pass değildir, daha derine in.\n"+
    (force ? "NOT: Sohbet uzadı, ARTIK karar ver. action SADECE 'pass' veya 'fail' olsun, 'ask' KULLANMA.\n" : "")+
    "SADECE şu JSON ile yanıt ver, başka hiçbir şey yazma: {\"action\":\"ask|pass|fail\",\"reply\":\"...\"}";
  const raw = await callAI(env, sys, messages);
  if(raw == null){
    // iki saglayici da basarisiz: gecirme; devam et (force ise pass)
    return force ? {action:"pass", reply:"Bugünlük bu kadar yeter, güzeldi! ⭐"}
                 : {action:"ask", reply:"Hmm tam anlayamadım, biraz daha anlatır mısın?"};
  }
  const m = raw.match(/\{[\s\S]*\}/);
  let p=null; try{ p = m ? JSON.parse(m[0]) : null; }catch(e){ p=null; }
  if(!p) return force ? {action:"pass", reply:"Güzel sohbetti, tamamladın! ⭐"}
                      : {action:"ask", reply:"Biraz daha açar mısın?"};
  let action = ["ask","pass","fail"].includes(p.action) ? p.action : "ask";
  if(force && action==="ask") action = "pass";  // guvenlik: sonsuz dongu olmasin
  return { action, reply: (p.reply||"Anlat bakalım.").slice(0,400) };
}

/* Claude (birincil, ANTHROPIC_API_KEY) -> Workers AI (yedek). Her biri 1 retry. Ham metin doner ya da null. */
async function callAI(env, sys, messages){
  // Claude
  if(env.ANTHROPIC_API_KEY){
    let cm = messages;
    if(cm.length && cm[0].role==="assistant") cm = cm.slice(1); // Claude user ile baslamali
    if(!cm.length) cm = [{role:"user", content:"merhaba"}];
    for(let i=0;i<2;i++){
      try{
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method:"POST",
          headers:{ "content-type":"application/json", "x-api-key":env.ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
          body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:300, system:sys, messages:cm })
        });
        if(r.ok){ const d = await r.json(); const t = d.content && d.content[0] && d.content[0].text; if(t) return t; }
      }catch(e){}
    }
  }
  // Workers AI yedek
  if(env.AI){
    for(let i=0;i<2;i++){
      try{
        const r = await env.AI.run(AI_MODEL, { max_tokens:300, messages:[{role:"system",content:sys}].concat(messages) });
        let raw = (r && (r.response != null ? r.response : r.result));
        if(typeof raw === "string" && raw) return raw;
        if(raw) return JSON.stringify(raw);
      }catch(e){}
    }
  }
  return null;
}

/* ---------- state (rol bazli) ---------- */
async function getState(env, me){
  const sr = await env.DB.prepare("SELECT * FROM seasons WHERE active=1 LIMIT 1").first();
  const season = sr ? {id:sr.id, name:sr.name, end:sr.end_date, prize:sr.prize, goal:sr.goal} : null;
  const usersRs = await env.DB.prepare("SELECT * FROM users").all();
  const users = (usersRs.results||[]).map(safeUser);
  // tum tamamlamalar (8 kullanicilik aile, pragmatik; pin asla donmez)
  const compRs = await env.DB.prepare("SELECT * FROM completions ORDER BY ts DESC").all();
  const completions = (compRs.results||[]).map(c=>({
    id:c.id, userId:c.user_id, taskId:c.task_id, date:c.date, week:c.week, ts:c.ts,
    status:c.status, proof:{text:c.proof_text||"", photoKey:c.proof_photo_key||null},
    aiNote: c.ai_note?{ok:c.ai_ok, note:c.ai_note}:null, approverId:c.approver_id
  }));
  return { season, users, completions, me: safeUser(me) };
}

/* ====================== ROUTER ====================== */
export async function onRequest(context){
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path : [params.path].filter(Boolean);
  const route = seg.join("/");
  const method = request.method;
  let body = {};
  if(method==="POST"){ try{ body = await request.json(); }catch(e){ body = {}; } }

  try{
    /* --- public: login ekrani icin (PIN yok, mahremiyet: ilk ad + avatar, yas/soyad yok) --- */
    if(route==="users" && method==="GET"){
      const rs = await env.DB.prepare("SELECT id,role,name,av,title FROM users").all();
      const users = (rs.results||[]).map(u=>({
        id:u.id, role:u.role, av:u.av, title:u.title,
        name: String(u.name||"").split(" ")[0]   // sadece ilk ad
      }));
      return json({ users });
    }

    /* --- login: PIN dogrulama + brute-force korumasi --- */
    if(route==="login" && method==="POST"){
      const { userId, pin } = body;
      const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first();
      if(!u) return bad("PIN hatalı", 401);
      const now = Date.now();
      if(u.lock_until && u.lock_until > now){
        const sec = Math.ceil((u.lock_until - now)/1000);
        return bad("Çok fazla deneme. "+sec+" saniye sonra tekrar dene.", 429);
      }
      if(String(u.pin) !== String(pin)){
        const fc = (u.fail_count||0) + 1;
        if(fc >= 5) await env.DB.prepare("UPDATE users SET fail_count=0, lock_until=? WHERE id=?").bind(now+5*60*1000, userId).run();
        else        await env.DB.prepare("UPDATE users SET fail_count=? WHERE id=?").bind(fc, userId).run();
        return bad("PIN hatalı", 401);
      }
      if(u.fail_count || u.lock_until) await env.DB.prepare("UPDATE users SET fail_count=0, lock_until=0 WHERE id=?").bind(userId).run();
      const token = await signToken({uid:u.id, role:u.role, exp:now+TOKEN_TTL}, env.SESSION_SECRET||"dev-secret-change-me");
      return json({ token, user: safeUser(u) });
    }

    /* --- bundan sonrasi auth ister --- */
    const me = await auth(request, env);
    if(!me) return bad("Yetkisiz", 401);

    if(route==="state" && method==="GET"){
      return json(await getState(env, me));
    }

    /* --- cocuk: gorev tamamla (AI olmayan gorevler; ogren sohbetten gelir) --- */
    if(route==="completion" && method==="POST"){
      if(me.role!=="child") return bad("Sadece çocuk görev gönderebilir", 403);
      const { taskId, date, week, proofText, photoB64 } = body;
      if(!taskId) return bad("taskId gerekli");
      if(AI_TASKS.has(taskId)) return bad("Bu görev sohbet ile yapılır", 400);
      const id = "c_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
      const ts = Date.now();
      let photoKey = null;
      if(photoB64){
        if(photoB64.length > MAX_PHOTO_CHARS) return bad("Fotoğraf çok büyük, daha küçük bir tane seç", 413);
        photoKey = "proofs/"+me.id+"/"+id+".jpg";
        const bin = fromB64url(photoB64.replace(/^data:image\/\w+;base64,/, "").replace(/\+/g,"-").replace(/\//g,"_"));
        await env.PROOFS.put(photoKey, bin, {httpMetadata:{contentType:"image/jpeg"}});
      }
      await env.DB.prepare(
        "INSERT INTO completions (id,user_id,task_id,date,week,ts,status,proof_text,proof_photo_key,ai_ok,ai_note,approver_id) "+
        "VALUES (?,?,?,?,?,?,'pending',?,?,NULL,NULL,NULL)"
      ).bind(id, me.id, taskId, date, week, ts, proofText||null, photoKey).run();
      return json({ ok:true, id });
    }

    /* --- cocuk: ogrenme sohbeti --- */
    if(route==="learn-chat" && method==="POST"){
      if(me.role!=="child") return bad("Yetkisiz", 403);
      const { messages, date, week } = body;
      if(!Array.isArray(messages) || !messages.length) return bad("messages gerekli");
      const clean = messages.filter(m=>m && (m.role==="user"||m.role==="assistant") && m.content)
        .map(m=>({role:m.role, content:String(m.content).slice(0,1000)})).slice(-12);
      const childTurns = clean.filter(m=>m.role==="user").length;
      const ev = await aiChat(env, clean, me.age, body.botName||"rehber", body.themeMood||"", childTurns);
      if(ev.action==="pass"){
        const id = "c_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        const proof = clean.filter(m=>m.role==="user").map(m=>m.content).join(" / ").slice(0,500);
        await env.DB.prepare(
          "INSERT INTO completions (id,user_id,task_id,date,week,ts,status,proof_text,proof_photo_key,ai_ok,ai_note,approver_id) "+
          "VALUES (?,?,?,?,?,?,'approved',?,NULL,1,?,'ai')"
        ).bind(id, me.id, "ogren", date, week, Date.now(), proof, ev.reply).run();
        return json({ reply:ev.reply, done:true, passed:true });
      }
      if(ev.action==="fail") return json({ reply:ev.reply, done:true, passed:false });
      return json({ reply:ev.reply, done:false });
    }

    /* --- onaylayici/admin: karar --- */
    if(route==="decide" && method==="POST"){
      if(me.role!=="approver" && me.role!=="admin") return bad("Yetkisiz", 403);
      const { compId, decision } = body; // approved | rejected
      if(!["approved","rejected"].includes(decision)) return bad("Geçersiz karar");
      const comp = await env.DB.prepare("SELECT * FROM completions WHERE id=?").bind(compId).first();
      if(!comp) return bad("Kayıt yok", 404);
      // approver sadece kendi cocuklarini onaylar
      if(me.role==="approver"){
        const kids = me.kids?JSON.parse(me.kids):[];
        if(!kids.includes(comp.user_id)) return bad("Bu çocuk sizin değil", 403);
      }
      await env.DB.prepare("UPDATE completions SET status=?, approver_id=? WHERE id=?")
        .bind(decision, me.id, compId).run();
      return json({ ok:true });
    }

    /* --- cocuk: tema kaydet --- */
    if(route==="theme" && method==="POST"){
      if(me.role!=="child") return bad("Yetkisiz", 403);
      const { theme } = body;
      if(!["scifi","fantasy","pixel"].includes(theme)) return bad("Geçersiz tema");
      await env.DB.prepare("UPDATE users SET theme=? WHERE id=?").bind(theme, me.id).run();
      return json({ ok:true });
    }

    /* --- foto getir (R2) --- */
    if(seg[0]==="proof" && method==="GET"){
      const key = seg.slice(1).join("/");
      const obj = await env.PROOFS.get(key);
      if(!obj) return bad("Foto yok", 404);
      return new Response(obj.body, {headers:{"content-type":"image/jpeg","cache-control":"private, max-age=3600"}});
    }

    /* --- admin: gorev kayitlarini sifirla --- */
    if(route==="admin/reset" && method==="POST"){
      if(me.role!=="admin") return bad("Yetkisiz", 403);
      await env.DB.prepare("DELETE FROM completions").run();
      return json({ ok:true });
    }

    return bad("Bilinmeyen uç: "+route, 404);
  }catch(e){
    return json({error:"Sunucu hatası", detail:String(e)}, 500);
  }
}
