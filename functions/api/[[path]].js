/* Yildiz Avcilari - Pages Functions API (/api/*)
   D1 (DB) + R2 (PROOFS) + Claude (ANTHROPIC_API_KEY). Token: HMAC (SESSION_SECRET).
   Gorev katalogu KODDA (frontend); worker ham veri doner, XP'yi frontend hesaplar. */

const enc = new TextEncoder();
const AI_TASKS = new Set(["ogren"]);          // AI on-degerlendirme gereken gorevler
const TOKEN_TTL = 1000*60*60*24*30;            // 30 gun

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

/* ---------- ogrenme degerlendirmesi (Cloudflare Workers AI) ---------- */
async function aiEvaluate(env, text, age){
  if(!env.AI){
    return { ok:1, note:"Otomatik değerlendirme kapalı, lütfen siz kontrol edin." };
  }
  const sys = "Sen bir çocuk ödül sisteminde 'yeni bir şey öğren' görevini değerlendiren nazik bir yardımcısın. "+
    "Sana "+age+" yaşındaki bir çocuğun Türkçe yazdığı metin verilecek. Değerlendir: (1) metin çocuğun KENDİ cümleleri mi, "+
    "(2) anlamlı, gerçek bir bilgi/öğrenme içeriyor mu, yaşına uygun mu. "+
    "Kısa, teşvik edici, çocuğa 'sen' diye hitap eden tek cümlelik Türkçe bir yorum yaz. "+
    "SADECE şu JSON ile yanıt ver, başka hiçbir şey yazma: {\"ok\": true, \"note\": \"...\"}. ok alanı öğrenme geçerliyse true, çok kısa/anlamsız/kopyala-yapıştırsa false.";
  let r = null;
  try{
    r = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      max_tokens:200,
      messages:[{role:"system",content:sys},{role:"user",content:text}]
    });
    let raw = (r && (r.response != null ? r.response : r.result));
    if(typeof raw !== "string") raw = JSON.stringify(raw||{});
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {ok:true, note:raw.slice(0,200)};
    return { ok: parsed.ok===false?0:1, note: (parsed.note||"").slice(0,300) };
  }catch(e){
    return { ok:1, note:"Değerlendirme yapılamadı, lütfen siz kontrol edin." };
  }
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
    /* --- public: login ekrani icin isim listesi (PIN yok) --- */
    if(route==="users" && method==="GET"){
      const rs = await env.DB.prepare("SELECT id,role,name,age,av,title FROM users").all();
      return json({ users: rs.results||[] });
    }

    /* --- login: PIN dogrulama --- */
    if(route==="login" && method==="POST"){
      const { userId, pin } = body;
      const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first();
      if(!u || String(u.pin)!==String(pin)) return bad("PIN hatalı", 401);
      const token = await signToken({uid:u.id, role:u.role, exp:Date.now()+TOKEN_TTL}, env.SESSION_SECRET||"dev-secret-change-me");
      return json({ token, user: safeUser(u) });
    }

    /* --- bundan sonrasi auth ister --- */
    const me = await auth(request, env);
    if(!me) return bad("Yetkisiz", 401);

    if(route==="state" && method==="GET"){
      return json(await getState(env, me));
    }

    /* --- cocuk: gorev tamamla --- */
    if(route==="completion" && method==="POST"){
      if(me.role!=="child") return bad("Sadece çocuk görev gönderebilir", 403);
      const { taskId, date, week, proofText, photoB64 } = body;
      if(!taskId) return bad("taskId gerekli");
      const id = "c_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
      const ts = Date.now();
      // foto -> R2
      let photoKey = null;
      if(photoB64){
        photoKey = "proofs/"+me.id+"/"+id+".jpg";
        const bin = fromB64url(photoB64.replace(/^data:image\/\w+;base64,/, "").replace(/\+/g,"-").replace(/\//g,"_"));
        await env.PROOFS.put(photoKey, bin, {httpMetadata:{contentType:"image/jpeg"}});
      }
      // AI on-degerlendirme
      let aiOk=null, aiNote=null;
      if(AI_TASKS.has(taskId) && proofText){
        const ev = await aiEvaluate(env, proofText, me.age);
        aiOk = ev.ok; aiNote = ev.note;
      }
      await env.DB.prepare(
        "INSERT INTO completions (id,user_id,task_id,date,week,ts,status,proof_text,proof_photo_key,ai_ok,ai_note,approver_id) "+
        "VALUES (?,?,?,?,?,?,'pending',?,?,?,?,NULL)"
      ).bind(id, me.id, taskId, date, week, ts, proofText||null, photoKey, aiOk, aiNote).run();
      return json({ ok:true, id, aiNote: aiNote?{ok:aiOk,note:aiNote}:null });
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
