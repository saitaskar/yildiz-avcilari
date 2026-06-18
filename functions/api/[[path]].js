/* Yildiz Avcilari - Pages Functions API (/api/*)
   D1 (DB) + R2 (PROOFS) + Claude (ANTHROPIC_API_KEY). Token: HMAC (SESSION_SECRET).
   Gorev katalogu KODDA (frontend); worker ham veri doner, XP'yi frontend hesaplar. */

const enc = new TextEncoder();
const AI_TASKS = new Set(["ogren"]);          // sohbetli AI gorevi
const TOKEN_TTL = 1000*60*60*12;               // 12 saat (eski PIN/aile-kodu oturumu)
const ACCOUNT_TTL = 1000*60*60*24*400;         // ~400 gun: hesap oturumu pratikte sinirsiz (storage temizlenince biter)
const PBKDF2_ITER = 100000;                    // parola hash iterasyonu
const MAX_PHOTO_CHARS = 750000;                // ~550KB base64 foto siniri (R2 kotuye kullanim)
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_CHILD_TURNS = 4;                     // bu kadar mesajdan sonra AI karar vermek zorunda
// gorev XP'leri (frontend TASKS ile ESLESMELI; katalog kodda sabit oldugu icin burada da var)
const TASK_XP = {ogren:150, ekransiz:75, fiziksel:50, yatak:15, dis_sabah:10, dis_aksam:10,
  el:3, su:3, banyo:20, kahvalti:10, ogle:10, aksam:10, sofra:15, kitap:15};
const CUSTOM_WEEKLY_CAP = 150;   // aile gorevleri sezon toplamina haftada en fazla bu kadar katar (fazlasi gorunur, puana saymaz)
const VAPID_PUBLIC = "BNBvz-yPPKT19mgKU4sB3vipVo_Ft1O0B3QLcgGy9YiDOI85hzY6MNIS54lojNR2jqqecGHSz0MaYyPUX98oy28";  // public anahtar (frontend de kullanir)
const VAPID_SUBJECT = "mailto:yildiz@cryme.tr";
const WEEKLY_TASKS = new Set(["ogren","ekransiz","fiziksel"]);  // gerisi gunluk
const STREAK_MIN = 3;            // bir gunluk gorevi bu kadar gun ust uste yapinca bonus baslar
const STREAK_BONUS = 5;          // her bonus gunu icin ekstra yildiz (gun 3'ten itibaren)

function dayDiff(a,b){ return Math.round((Date.parse(b+"T00:00:00Z") - Date.parse(a+"T00:00:00Z"))/86400000); }
/* bir gorevin gun listesinden seri bonusu: her ardisik kosuda (uzunluk L) max(0,L-(MIN-1)) gun x BONUS */
function runStreakBonus(dates){
  const ds=[...new Set(dates)].sort();
  if(!ds.length) return 0;
  let bonus=0, run=1;
  for(let i=1;i<ds.length;i++){
    if(dayDiff(ds[i-1],ds[i])===1) run++;
    else { bonus += Math.max(0, run-(STREAK_MIN-1))*STREAK_BONUS; run=1; }
  }
  return bonus + Math.max(0, run-(STREAK_MIN-1))*STREAK_BONUS;
}

/* cocugun onayli toplam XP'si (kod gorevleri + ozel gorevler + gunluk seri bonusu) */
async function computeXP(env, userId){
  const comps = (await env.DB.prepare("SELECT task_id, week, date FROM completions WHERE user_id=? AND status='approved'").bind(userId).all()).results||[];
  let total=0; const customRows=[]; const dailyDates={};
  for(const c of comps){
    if(TASK_XP[c.task_id]!=null){
      total+=TASK_XP[c.task_id];
      if(!WEEKLY_TASKS.has(c.task_id)) (dailyDates[c.task_id]=dailyDates[c.task_id]||[]).push(c.date);
    } else customRows.push(c);
  }
  if(customRows.length){
    const cts=(await env.DB.prepare("SELECT id,xp FROM custom_tasks WHERE child_id=?").bind(userId).all()).results||[];
    const m={}; cts.forEach(c=>m[c.id]=c.xp);
    const byWeek={};
    for(const c of customRows){ byWeek[c.week]=(byWeek[c.week]||0)+(m[c.task_id]||0); }
    for(const w in byWeek) total += Math.min(CUSTOM_WEEKLY_CAP, byWeek[w]);   // haftalik custom tavani
  }
  for(const tid in dailyDates) total += runStreakBonus(dailyDates[tid]);       // gunluk seri bonusu
  return total;
}
/* hedefe ulastiysa ve daha once kaydedilmemisse odul kazanimini logla */
async function checkReward(env, userId){
  const u = await env.DB.prepare("SELECT role, family_id FROM users WHERE id=?").bind(userId).first();
  if(!u || u.role!=="child") return;
  const s = await env.DB.prepare("SELECT * FROM seasons WHERE family_id=? AND active=1 LIMIT 1").bind(u.family_id).first();
  if(!s) return;
  const xp = await computeXP(env, userId);
  if(xp < s.goal) return;
  const exists = await env.DB.prepare("SELECT id FROM rewards_log WHERE user_id=? AND season_id=?").bind(userId, s.id).first();
  if(exists) return;
  await env.DB.prepare("INSERT INTO rewards_log (id,user_id,season_id,prize,xp_at_win,ts,family_id) VALUES (?,?,?,?,?,?,?)")
    .bind("rw_"+Date.now()+"_"+Math.floor(Math.random()*1e6), userId, s.id, s.prize, xp, Date.now(), u.family_id).run();
}
/* cocugun XP'si bir ara odul esigini gectiyse 'reached' isaretle (idempotent) */
async function checkCheckpoints(env, userId){
  const u = await env.DB.prepare("SELECT role FROM users WHERE id=?").bind(userId).first();
  if(!u || u.role!=="child") return;
  const pend = (await env.DB.prepare("SELECT * FROM checkpoints WHERE child_id=? AND status='pending'").bind(userId).all()).results||[];
  if(!pend.length) return;
  const xp = await computeXP(env, userId);
  for(const cp of pend){
    if(xp >= cp.threshold){
      await env.DB.prepare("UPDATE checkpoints SET status='reached', reached_ts=? WHERE id=?").bind(Date.now(), cp.id).run();
    }
  }
}

/* ---------- yardimcilar ---------- */
const json = (data, status=200) =>
  new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json"}});
const bad = (msg, status=400) => json({error:msg}, status);
const firstName = (n) => String(n||"").split(" ")[0];   // login ekraninda mahremiyet: yalniz ilk ad
/* karisik-olmayan kod uret (aile/davet anahtari) */
function genCode(n){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; n=n||8; let s=""; const r=crypto.getRandomValues(new Uint8Array(n)); for(let i=0;i<n;i++) s+=A[r[i]%A.length]; return s; }
/* root admin denetimi icin deterministik, isimsiz takma kimlik (PII yok) */
function anonId(s){ let h=2166136261>>>0; s=String(s||""); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; } return h.toString(36).toUpperCase().slice(0,4).padStart(4,"0"); }
/* Turkce harf + casing katlama: tum varyantlari tek ASCII-kucuk uzaya indir.
   ş/Ş->s, ç/Ç->c, ğ/Ğ->g, ü/Ü->u, ö/Ö->o, ı/I/İ->i; telefonda diakritiksiz/BUYUK yazim ayni forma duser. */
function fold(s){
  return String(s==null?"":s)
    .replace(/[İIı]/g,"i").replace(/[Şş]/g,"s").replace(/[Çç]/g,"c")
    .replace(/[Ğğ]/g,"g").replace(/[Üü]/g,"u").replace(/[Öö]/g,"o")
    .toLowerCase();
}
const NAME_STOP = new Set(["aile","ailesi","ailem","anne","baba","abla","abi","dayi","teyze","amca","hala","kardes"]);
/* bir ismi KATLANMIS token'lara ayir (>=3 harf kelimeler; genel akrabalik/aile kelimelerini atla) */
function nameTokens(name){
  const out=new Set();
  for(const w of String(name||"").trim().split(/\s+/)){ const f=fold(w); if(f.length>=3 && !NAME_STOP.has(f)) out.add(f); }
  return [...out];
}
/* root sohbet denetiminde aile-uyesi adlarini/aile adini maskele: metni kelimelere bol,
   her kelimeyi katla, katlanmis token setinde varsa maskele (casing + diakritik bagimsiz) */
function redactNames(text, foldedTokens){
  const raw = String(text==null?"":text);
  const set = foldedTokens instanceof Set ? foldedTokens : new Set(foldedTokens||[]);
  if(!set.size) return raw;
  try{ return raw.replace(/\p{L}+/gu, w => set.has(fold(w)) ? "[…]" : w); }
  catch(e){ return raw; }
}

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

/* ---------- web push (VAPID, payloadsiz) ---------- */
let _vapidKey = null;
async function vapidKey(env){
  if(_vapidKey) return _vapidKey;
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK || "{}");
  _vapidKey = await crypto.subtle.importKey("jwk", jwk, {name:"ECDSA", namedCurve:"P-256"}, false, ["sign"]);
  return _vapidKey;
}
async function vapidJwt(env, audience){
  const header  = b64url(enc.encode(JSON.stringify({typ:"JWT", alg:"ES256"})));
  const payload = b64url(enc.encode(JSON.stringify({aud:audience, exp:Math.floor(Date.now()/1000)+12*3600, sub:VAPID_SUBJECT})));
  const input = header + "." + payload;
  const sig = await crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, await vapidKey(env), enc.encode(input));
  return input + "." + b64url(sig);
}
async function sendPush(env, sub){
  try{
    const jwt = await vapidJwt(env, new URL(sub.endpoint).origin);
    const res = await fetch(sub.endpoint, { method:"POST", headers:{ "TTL":"86400", "Authorization":"vapid t="+jwt+", k="+VAPID_PUBLIC } });
    if(res.status===404 || res.status===410) await env.DB.prepare("DELETE FROM push_subs WHERE endpoint=?").bind(sub.endpoint).run();  // gecersiz abonelik
    return res.status;
  }catch(e){ return 0; }
}
async function pushToUser(env, userId){
  const subs = (await env.DB.prepare("SELECT endpoint FROM push_subs WHERE user_id=?").bind(userId).all()).results||[];
  for(const s of subs) await sendPush(env, s);
}
/* cocugun onaylayicilarini bilgilendir (parents yoksa ailenin approver'lari; root'a ASLA gitmez) */
async function notifyApprovers(env, child){
  let ids=[]; try{ ids = child.parents ? JSON.parse(child.parents) : []; }catch(e){}
  if(!ids.length && child.family_id){
    const ap=(await env.DB.prepare("SELECT id FROM users WHERE role='approver' AND family_id=?").bind(child.family_id).all()).results||[];
    ids=ap.map(a=>a.id);
  }
  for(const id of ids) await pushToUser(env, id);
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
    theme:u.theme, parents:u.parents?JSON.parse(u.parents):null, kids:u.kids?JSON.parse(u.kids):null,
    familyId:u.family_id||null, isRoot:u.is_root_admin?1:0, hidden:u.hidden||0 };
}
async function auth(request, env){
  const h = request.headers.get("Authorization")||"";
  let token = h.replace(/^Bearer\s+/i,"");
  if(!token){ try{ token = new URL(request.url).searchParams.get("t")||""; }catch(e){} } // <img> foto icin
  const p = await verifyToken(token, env.SESSION_SECRET);
  if(!p || !p.uid) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(p.uid).first();
  return u || null;
}

/* ---------- hesap (account) auth: PBKDF2 parola + token (aid) ---------- */
async function hashPassword(password, saltB64, iter){
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const it = iter || PBKDF2_ITER;
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password)), {name:"PBKDF2"}, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({name:"PBKDF2", salt, iterations:it, hash:"SHA-256"}, key, 256);
  return { hash: b64url(bits), salt: b64url(salt), iter: it };
}
async function verifyPassword(password, hashB64, saltB64, iter){
  if(!hashB64 || !saltB64) return false;
  const r = await hashPassword(password, saltB64, iter);
  const a = r.hash, b = hashB64;                 // sabit-zamanli karsilastirma
  if(a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff===0;
}
async function authAccount(request, env){
  const h = request.headers.get("Authorization")||"";
  let token = h.replace(/^Bearer\s+/i,"");
  if(!token){ try{ token = new URL(request.url).searchParams.get("t")||""; }catch(e){} }
  const p = await verifyToken(token, env.SESSION_SECRET);
  if(!p || !p.aid) return null;
  return await env.DB.prepare("SELECT * FROM accounts WHERE id=?").bind(p.aid).first();
}
async function accountToken(env, accId){
  return await signToken({aid:accId, exp:Date.now()+ACCOUNT_TTL}, env.SESSION_SECRET||"dev-secret-change-me");
}
/* hesap bu aileye bagli mi (owner/parent)? */
async function accountInFamily(env, accId, familyId){
  return await env.DB.prepare("SELECT role FROM account_families WHERE account_id=? AND family_id=?").bind(accId, familyId).first();
}
/* e-posta gonder (Resend; key yoksa dry-run false doner) */
async function sendEmail(env, to, subject, html){
  if(!env.RESEND_API_KEY) return false;
  try{
    const r = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{ "Authorization":"Bearer "+env.RESEND_API_KEY, "content-type":"application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM || "Yıldız Avcıları <noreply@cryme.tr>", to:[to], subject, html })
    });
    return r.ok;
  }catch(e){ return false; }
}

/* ---------- ogrenme SOHBETI (Cloudflare Workers AI, sokratik) ----------
   action: "ask" (soru sor, devam) | "pass" (gercekten ogrenmis, tamamla) | "fail" (yetersiz, nazikce gonder) */
async function aiChat(env, messages, age, botName, themeMood, childTurns, alreadyPassed){
  if(!env.AI){ return { action: alreadyPassed?"ask":"pass", reply: alreadyPassed?"Güzel! Başka ne öğrendin?":"Aferin, görevi tamamladın!" }; }
  const force = !alreadyPassed && childTurns >= MAX_CHILD_TURNS;
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
    (alreadyPassed ? "ÖNEMLİ: Çocuk bu görevi ZATEN geçti ve yıldızını aldı. Artık SADECE sohbet et, merakını besle, konuyu biraz daha aç, başka ilginç sorular sor. action HER ZAMAN 'ask' olsun, asla 'pass'/'fail' verme.\n" : "")+
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
  if(alreadyPassed) action = "ask";             // zaten gecti: sadece sohbet devam
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

/* ---------- root admin: anonim sistem gorunumu (GDPR/KVKK: hicbir aile PII'si donmez) ---------- */
async function getRootState(env, me){
  const stats = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM families) families,"+
    " (SELECT COUNT(*) FROM users WHERE role='child') children,"+
    " (SELECT COUNT(*) FROM users WHERE role='approver') parents,"+
    " (SELECT COUNT(*) FROM completions) comps,"+
    " (SELECT COUNT(*) FROM completions WHERE status='pending') pending,"+
    " (SELECT COUNT(*) FROM completions WHERE status='approved') approved,"+
    " (SELECT COUNT(*) FROM chat_logs) chats,"+
    " (SELECT COUNT(*) FROM chat_logs WHERE result='pass') chatPass,"+
    " (SELECT COUNT(*) FROM rewards_log) rewards"
  ).first();
  // aile basina toplamlar (isimsiz, yalniz takma kimlik + sayac)
  const famRows = (await env.DB.prepare("SELECT id, created_ts FROM families").all()).results||[];
  const families = [];
  for(const f of famRows){
    const c = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM users WHERE family_id=? AND role='child') children,"+
      " (SELECT COUNT(*) FROM completions WHERE family_id=?) comps,"+
      " (SELECT MAX(ts) FROM completions WHERE family_id=?) lastTs"
    ).bind(f.id, f.id, f.id).first();
    families.push({ id:anonId(f.id), children:c.children||0, comps:c.comps||0, lastTs:c.lastTs||null, created:f.created_ts });
  }
  // GLOBAL redaksiyon token seti: TUM kullanici adlari + TUM aile adlari (katlanmis).
  // YALNIZ maskelemek icin yuklenir, root'a DONMEZ. Global olmasi capraz-aile isim gecislerini de yakalar.
  const tokSet = new Set();
  const allUsers = (await env.DB.prepare("SELECT name FROM users").all()).results||[];
  for(const u of allUsers) nameTokens(u.name).forEach(t=>tokSet.add(t));
  const famNameRows = (await env.DB.prepare("SELECT name FROM families").all()).results||[];
  for(const f of famNameRows) nameTokens(f.name).forEach(t=>tokSet.add(t));
  // anonim sohbet denetimi: kimlik takma + mesaj govdesinde bilinen TUM ad/aile adlari maskelenir
  const logs = (await env.DB.prepare("SELECT id, child_id, family_id, messages, result, ts FROM chat_logs ORDER BY ts DESC LIMIT 80").all()).results||[];
  const chatLogs = logs.map(l=>{
    let msgs = [];
    try{ msgs = JSON.parse(l.messages||"[]").map(m=>({ role:m.role, content: redactNames(m.content, tokSet) })); }catch(e){ msgs=[]; }
    return { id:l.id, child:"Çocuk #"+anonId(l.child_id), family:"Aile #"+anonId(l.family_id||""), messages: msgs, result:l.result, ts:l.ts };
  });
  // geri bildirimler: cocuk anonim + mesaj isim-maskeli; ebeveyn iletisim e-postasiyla (gonullu destek)
  const fbRows = (await env.DB.prepare("SELECT id,family_id,kind,ref_id,theme,type,rating,message,contact,ts FROM feedback ORDER BY ts DESC LIMIT 100").all()).results||[];
  const feedback = fbRows.map(f=>({
    id:f.id, kind:f.kind, type:f.type, rating:f.rating, theme:f.theme,
    who: f.kind==="child" ? ("Çocuk #"+anonId(f.ref_id)) : ("Ebeveyn"+(f.contact?" · "+f.contact:"")),
    family: "Aile #"+anonId(f.family_id||""),
    message: f.kind==="child" ? redactNames(f.message, tokSet) : f.message,
    ts:f.ts
  }));
  return { root:true, stats, families, chatLogs, feedback, me: safeUser(me) };
}

/* ---------- aile durumu (account-parent gorunumu icin; aile-kapsamli) ---------- */
async function getFamilyState(env, fid, acc){
  const sr = await env.DB.prepare("SELECT * FROM seasons WHERE family_id=? AND active=1 LIMIT 1").bind(fid).first();
  const season = sr ? {id:sr.id, name:sr.name, end:sr.end_date, prize:sr.prize, goal:sr.goal} : null;
  const fam = await env.DB.prepare("SELECT id,name FROM families WHERE id=?").bind(fid).first();
  const users = ((await env.DB.prepare("SELECT * FROM users WHERE family_id=?").bind(fid).all()).results||[]).map(safeUser);
  const completions = ((await env.DB.prepare("SELECT * FROM completions WHERE family_id=? ORDER BY ts DESC").bind(fid).all()).results||[]).map(c=>({
    id:c.id, userId:c.user_id, taskId:c.task_id, date:c.date, week:c.week, ts:c.ts, status:c.status,
    proof:{text:c.proof_text||"", photoKey:c.proof_photo_key||null}, aiNote:c.ai_note?{ok:c.ai_ok,note:c.ai_note}:null, approverId:c.approver_id }));
  const customTasks = ((await env.DB.prepare("SELECT * FROM custom_tasks WHERE family_id=? AND status IN ('active','done')").bind(fid).all()).results||[]).map(c=>({id:c.id,childId:c.child_id,title:c.title,emoji:c.emoji,xp:c.xp,by:c.created_by,status:c.status}));
  const checkpoints = ((await env.DB.prepare("SELECT * FROM checkpoints WHERE family_id=? AND status!='cancelled' ORDER BY threshold").bind(fid).all()).results||[]).map(c=>({id:c.id,childId:c.child_id,threshold:c.threshold,reward:c.reward,status:c.status,by:c.created_by,reachedTs:c.reached_ts}));
  const rewards = (await env.DB.prepare("SELECT * FROM rewards_log WHERE family_id=? ORDER BY ts DESC").bind(fid).all()).results||[];
  const chatLogs = ((await env.DB.prepare("SELECT * FROM chat_logs WHERE family_id=? ORDER BY ts DESC LIMIT 60").bind(fid).all()).results||[]).map(l=>({id:l.id,childId:l.child_id,messages:JSON.parse(l.messages||"[]"),result:l.result,ts:l.ts}));
  return { family: fam?{id:fam.id,name:fam.name}:null, season, users, completions, customTasks, checkpoints, rewards, chatLogs, account:{id:acc.id,email:acc.email,name:acc.name} };
}

/* ---------- state (aile-kapsamli) ---------- */
async function getState(env, me){
  if(me.is_root_admin) return getRootState(env, me);   // root: anonim sistem gorunumu
  const fid = me.family_id;
  if(!fid) return { season:null, users:[], completions:[], customTasks:[], checkpoints:[], rewards:[], chatLogs:[], me: safeUser(me) };
  const sr = await env.DB.prepare("SELECT * FROM seasons WHERE family_id=? AND active=1 LIMIT 1").bind(fid).first();
  const season = sr ? {id:sr.id, name:sr.name, end:sr.end_date, prize:sr.prize, goal:sr.goal} : null;
  const fam = await env.DB.prepare("SELECT id,name,code FROM families WHERE id=?").bind(fid).first();
  const usersRs = await env.DB.prepare("SELECT * FROM users WHERE family_id=?").bind(fid).all();
  const users = (usersRs.results||[]).map(safeUser);
  // bu ailenin tamamlamalari (pin asla donmez)
  const compRs = await env.DB.prepare("SELECT * FROM completions WHERE family_id=? ORDER BY ts DESC").bind(fid).all();
  const completions = (compRs.results||[]).map(c=>({
    id:c.id, userId:c.user_id, taskId:c.task_id, date:c.date, week:c.week, ts:c.ts,
    status:c.status, proof:{text:c.proof_text||"", photoKey:c.proof_photo_key||null},
    aiNote: c.ai_note?{ok:c.ai_ok, note:c.ai_note}:null, approverId:c.approver_id
  }));
  const ctRs = await env.DB.prepare("SELECT * FROM custom_tasks WHERE family_id=? AND status IN ('active','done')").bind(fid).all();
  const customTasks = (ctRs.results||[]).map(c=>({ id:c.id, childId:c.child_id, title:c.title, emoji:c.emoji, xp:c.xp, by:c.created_by, status:c.status }));
  const cpRs = await env.DB.prepare("SELECT * FROM checkpoints WHERE family_id=? AND status!='cancelled' ORDER BY threshold").bind(fid).all();
  const checkpoints = (cpRs.results||[]).map(c=>({ id:c.id, childId:c.child_id, threshold:c.threshold, reward:c.reward, status:c.status, by:c.created_by, reachedTs:c.reached_ts }));
  // ailenin kazanilan odulleri (tum aile gorur, kutlama)
  const rewards = (await env.DB.prepare("SELECT * FROM rewards_log WHERE family_id=? ORDER BY ts DESC").bind(fid).all()).results||[];
  // ogrenme sohbeti loglari (parental control): approver yalniz kendi cocuklari
  let chatLogs = [];
  if(me.role==="approver"){
    const kids = me.kids?JSON.parse(me.kids):[];
    if(kids.length){
      const ph = kids.map(()=>"?").join(",");
      chatLogs = (await env.DB.prepare("SELECT * FROM chat_logs WHERE family_id=? AND child_id IN ("+ph+") ORDER BY ts DESC LIMIT 60").bind(fid, ...kids).all()).results||[];
    }
  }
  chatLogs = chatLogs.map(l=>({ id:l.id, childId:l.child_id, messages:JSON.parse(l.messages||"[]"), result:l.result, ts:l.ts }));
  return { season, users, completions, customTasks, checkpoints, rewards, chatLogs, family: fam?{id:fam.id, name:fam.name, code:fam.code}:null, me: safeUser(me) };
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
    // GUVENLIK: imza sirri yoksa fail-closed (sabit fallback YOK; token sahteciligini onler)
    if(!env.SESSION_SECRET) return json({error:"Sunucu yapılandırması eksik (SESSION_SECRET)"}, 500);
    const appUrl = env.APP_URL || "https://yildizavcilari.com";   // domain cutover: APP_URL env'i set et
    /* --- public: aile kodu -> o ailenin login uyeleri (PIN yok; mahremiyet: yalniz ilk ad + avatar).
       Cok-aileli: kodu bilmeyen kimse baska ailenin cocuklarini goremez (GDPR/KVKK).
       Root admin: kendi login_code'u ile girer (aile listesine cikmaz). --- */
    if(route==="lookup" && method==="POST"){
      const code = String(body.code||"").trim().toUpperCase();
      if(!code) return bad("Kod gerekli");
      const root = await env.DB.prepare("SELECT id,role,av FROM users WHERE is_root_admin=1 AND login_code=? LIMIT 1").bind(code).first();
      if(root) return json({ kind:"root", family:null, members:[{ id:root.id, role:root.role, av:root.av||"🛡️", name:"Yönetici" }] });   // gercek ad donmez
      const fam = await env.DB.prepare("SELECT id,name FROM families WHERE code=?").bind(code).first();
      if(!fam) return bad("Kod bulunamadı", 404);
      const rs = await env.DB.prepare("SELECT id,role,av,name FROM users WHERE family_id=? AND role IN ('child','approver') AND COALESCE(hidden,0)=0 ORDER BY role, name").bind(fam.id).all();
      const members = (rs.results||[]).map(u=>({ id:u.id, role:u.role, av:u.av, name: firstName(u.name) }));
      return json({ kind:"family", family:{ id:fam.id, name:fam.name }, members });
    }

    /* --- login: PIN dogrulama + brute-force korumasi --- */
    if(route==="login" && method==="POST"){
      const { userId, pin } = body;
      const u = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first();
      if(!u) return bad("PIN hatalı", 401);
      if(!u.is_root_admin) return bad("Bu giriş yöntemi kapalı", 403);   // sadece root; cocuklar account/child-token, yetiskinler /auth/login
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

    /* --- cron tetigi (gizli anahtar): bekleyen onaylari olan cocuklarin ebeveynlerine hatirlatma push'u --- */
    if(route==="cron-remind" && method==="POST"){
      if((request.headers.get("X-Cron-Secret")||"") !== (env.CRON_SECRET||"__unset__")) return bad("Yetkisiz", 403);
      const cutoff = Date.now() - 30*60*1000;   // >30 dk bekleyenler (anlik push'la cakismasin)
      const rows = (await env.DB.prepare("SELECT user_id, COUNT(*) n FROM completions WHERE status='pending' AND ts < ? GROUP BY user_id").bind(cutoff).all()).results||[];
      const approvers = new Set();
      for(const r of rows){
        const u = await env.DB.prepare("SELECT parents, family_id FROM users WHERE id=?").bind(r.user_id).first();
        let ps=[]; try{ ps = u && u.parents ? JSON.parse(u.parents) : []; }catch(e){}
        if(!ps.length && u && u.family_id){   // parents yoksa ailenin approver'lari (root degil)
          const ap=(await env.DB.prepare("SELECT id FROM users WHERE role='approver' AND family_id=?").bind(u.family_id).all()).results||[];
          ps=ap.map(a=>a.id);
        }
        ps.forEach(id=>approvers.add(id));
      }
      for(const id of approvers) await pushToUser(env, id);
      return json({ ok:true, reminded: approvers.size });
    }

    /* ====================== HESAP (account) AUTH ====================== */
    /* --- kayit (email + parola) --- */
    if(route==="auth/register" && method==="POST"){
      const email = String(body.email||"").trim().toLowerCase();
      const pw = String(body.password||"");
      const name = String(body.name||"").trim().slice(0,60);
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Geçerli bir e-posta gir");
      if(pw.length<6) return bad("Parola en az 6 karakter olmalı");
      if(await env.DB.prepare("SELECT id FROM accounts WHERE email=?").bind(email).first()) return bad("Bu e-posta zaten kayıtlı", 409);
      const ph = await hashPassword(pw);
      const id = "acc_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
      const nm = name || email.split("@")[0];
      await env.DB.prepare("INSERT INTO accounts (id,email,email_verified,pw_hash,pw_salt,pw_iter,name,created_ts,last_login) VALUES (?,?,0,?,?,?,?,?,?)")
        .bind(id, email, ph.hash, ph.salt, ph.iter, nm, Date.now(), Date.now()).run();
      context.waitUntil(sendEmail(env, email, "Yıldız Avcıları'na hoş geldin! 🌟",
        "<p>Merhaba "+nm+",</p><p>Yıldız Avcıları hesabın hazır. Ailenle başlamak için <a href=\""+appUrl+"\">giriş yap</a>, bir aile kur ve çocuk profillerini ekle.</p><p>İyi maceralar! 🌟</p>"));
      return json({ token: await accountToken(env, id), account:{id, email, name:nm} });
    }
    /* --- giris (email + parola) --- */
    if(route==="auth/login" && method==="POST"){
      const email = String(body.email||"").trim().toLowerCase();
      const pw = String(body.password||"");
      const a = await env.DB.prepare("SELECT * FROM accounts WHERE email=?").bind(email).first();
      let ok = false;
      if(a && a.pw_hash){ ok = await verifyPassword(pw, a.pw_hash, a.pw_salt, a.pw_iter); }
      else { await hashPassword(pw, "ZGVjb3lzYWx0", PBKDF2_ITER); }   // sabit-zaman: hesap yok/parolasiz da KDF calissin (enumeration onler)
      if(!ok) return bad("E-posta veya parola hatalı", 401);
      await env.DB.prepare("UPDATE accounts SET last_login=? WHERE id=?").bind(Date.now(), a.id).run();
      return json({ token: await accountToken(env, a.id), account:{id:a.id, email:a.email, name:a.name} });
    }

    /* --- hangi giris yontemleri acik (frontend butonlari) --- */
    if(route==="config" && method==="GET"){
      return json({ google: !!env.GOOGLE_CLIENT_ID, googleClientId: env.GOOGLE_CLIENT_ID || null, emailCode: !!env.RESEND_API_KEY });
    }

    /* --- Google SSO: frontend ID token (credential) yollar, tokeninfo ile dogrula --- */
    if(route==="auth/google" && method==="POST"){
      const cid = env.GOOGLE_CLIENT_ID;
      if(!cid) return bad("Google girişi henüz yapılandırılmadı", 501);
      const cred = String(body.credential||"");
      if(!cred) return bad("credential gerekli");
      let info=null;
      try{ const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token="+encodeURIComponent(cred)); if(r.ok) info = await r.json(); }catch(e){}
      const everified = info && (info.email_verified===true || info.email_verified==="true");
      const issOk = info && (info.iss==="accounts.google.com" || info.iss==="https://accounts.google.com");
      if(!info || info.aud !== cid || !info.email || !everified || !issOk) return bad("Google doğrulaması başarısız", 401);   // email_verified + iss zorunlu (hesap ele gecirme onler)
      const email = String(info.email).toLowerCase(), sub = info.sub;
      let a = await env.DB.prepare("SELECT * FROM accounts WHERE google_sub=? OR email=?").bind(sub, email).first();
      if(!a){
        const id = "acc_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        await env.DB.prepare("INSERT INTO accounts (id,email,email_verified,google_sub,name,created_ts,last_login) VALUES (?,?,1,?,?,?,?)")
          .bind(id, email, sub, info.name||email.split("@")[0], Date.now(), Date.now()).run();
        a = {id, email, name: info.name||email.split("@")[0]};
      } else if(!a.google_sub){
        await env.DB.prepare("UPDATE accounts SET google_sub=?, email_verified=1, last_login=? WHERE id=?").bind(sub, Date.now(), a.id).run();
      } else {
        await env.DB.prepare("UPDATE accounts SET last_login=? WHERE id=?").bind(Date.now(), a.id).run();
      }
      return json({ token: await accountToken(env, a.id), account:{id:a.id, email:a.email||email, name:a.name||info.name} });
    }

    /* --- e-postaya kod iste (passwordless) --- */
    if(route==="auth/email-code/request" && method==="POST"){
      if(!env.RESEND_API_KEY) return bad("E-posta ile kod henüz yapılandırılmadı", 501);
      const email = String(body.email||"").trim().toLowerCase();
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Geçerli bir e-posta gir");
      // rate-limit: ayni e-postaya 45 sn'de bir koddan fazla yok (spam/e-posta bombasi onler)
      const prev = await env.DB.prepare("SELECT exp FROM email_codes WHERE email=?").bind(email).first();
      if(prev && (Date.now() - (prev.exp - 10*60*1000)) < 45000) return bad("Az önce kod gönderildi, biraz bekle", 429);
      const code = ""+(100000+Math.floor(Math.random()*900000));
      const ph = await hashPassword(code, null, 50000);
      await env.DB.prepare("INSERT INTO email_codes (email,code_hash,exp,tries) VALUES (?,?,?,0) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, exp=excluded.exp, tries=0")
        .bind(email, ph.salt+":"+ph.hash, Date.now()+10*60*1000).run();
      await sendEmail(env, email, "Yıldız Avcıları giriş kodu", "<p>Giriş kodun: <b style='font-size:22px'>"+code+"</b></p><p>10 dakika geçerli. Sen istemediysen yok say.</p>");
      return json({ ok:true });
    }
    /* --- e-posta kodunu dogrula -> hesap olustur/giris --- */
    if(route==="auth/email-code/verify" && method==="POST"){
      const email = String(body.email||"").trim().toLowerCase();
      const code = String(body.code||"").trim();
      const row = await env.DB.prepare("SELECT * FROM email_codes WHERE email=?").bind(email).first();
      if(!row || row.exp < Date.now()) return bad("Kodun süresi doldu, yeniden iste", 401);
      if((row.tries||0) >= 5) return bad("Çok fazla deneme, yeni kod iste", 429);
      const sp = String(row.code_hash).split(":");
      const ok = await verifyPassword(code, sp[1]||"", sp[0]||"", 50000);
      if(!ok){ await env.DB.prepare("UPDATE email_codes SET tries=tries+1 WHERE email=?").bind(email).run(); return bad("Kod hatalı", 401); }
      await env.DB.prepare("DELETE FROM email_codes WHERE email=?").bind(email).run();
      let a = await env.DB.prepare("SELECT * FROM accounts WHERE email=?").bind(email).first();
      if(!a){
        const id = "acc_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        await env.DB.prepare("INSERT INTO accounts (id,email,email_verified,name,created_ts,last_login) VALUES (?,?,1,?,?,?)").bind(id, email, email.split("@")[0], Date.now(), Date.now()).run();
        a = {id, email, name: email.split("@")[0]};
      } else { await env.DB.prepare("UPDATE accounts SET email_verified=1, last_login=? WHERE id=?").bind(Date.now(), a.id).run(); }
      return json({ token: await accountToken(env, a.id), account:{id:a.id, email:a.email, name:a.name} });
    }

    /* --- account/* : hesap oturumu gerekir --- */
    if(route==="account" || route.startsWith("account/")){
      const acc = await authAccount(request, env);
      if(!acc) return bad("Yetkisiz", 401);

      // hesap durumu: aileler + cocuk profilleri + co-parent'lar + bekleyen davetler
      if(route==="account/state" && method==="GET"){
        const fams = (await env.DB.prepare("SELECT f.id, f.name, af.role FROM account_families af JOIN families f ON f.id=af.family_id WHERE af.account_id=? ORDER BY af.added_ts").bind(acc.id).all()).results||[];
        const families=[];
        for(const f of fams){
          const kids = (await env.DB.prepare("SELECT id,name,age,av,theme,pin FROM users WHERE family_id=? AND role='child'").bind(f.id).all()).results||[];
          const co = (await env.DB.prepare("SELECT a.email, af.role FROM account_families af JOIN accounts a ON a.id=af.account_id WHERE af.family_id=? AND af.account_id!=?").bind(f.id, acc.id).all()).results||[];
          const inv = (await env.DB.prepare("SELECT email, role FROM family_invites WHERE family_id=? AND status='pending'").bind(f.id).all()).results||[];
          families.push({ id:f.id, name:f.name, role:f.role,
            children: kids.map(k=>({id:k.id, name:k.name, age:k.age, av:k.av, theme:k.theme, hasPin: !!(k.pin && String(k.pin)!=="")})),
            coParents: co.map(c=>({email:c.email, role:c.role})),
            pendingInvites: inv.map(i=>({email:i.email, role:i.role})) });
        }
        return json({ account:{id:acc.id, email:acc.email, name:acc.name}, families });
      }

      // ebeveyn: kanit fotografi (R2) - aile yetkisiyle (token URL'de degil, header ile)
      if(seg[0]==="account" && seg[1]==="proof" && method==="GET"){
        const key = seg.slice(2).join("/");
        const childId = key.split("/")[1] || "";
        const owner = await env.DB.prepare("SELECT family_id FROM users WHERE id=?").bind(childId).first();
        if(!owner || !await accountInFamily(env, acc.id, owner.family_id)) return bad("Yetkisiz", 403);
        const obj = await env.PROOFS.get(key);
        if(!obj) return bad("Foto yok", 404);
        return new Response(obj.body, {headers:{"content-type":"image/jpeg","cache-control":"private, max-age=3600"}});
      }

      // aile olustur (sahip = bu hesap) + varsayilan sezon
      if(route==="account/create-family" && method==="POST"){
        const name = String(body.name||"").trim().slice(0,40);
        if(!name) return bad("Aile adı gir");
        const fid = "fam_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        await env.DB.prepare("INSERT INTO families (id,name,code,owner_id,created_ts,owner_account_id) VALUES (?,?,?,?,?,?)")
          .bind(fid, name, genCode(8), null, Date.now(), acc.id).run();
        await env.DB.prepare("INSERT INTO account_families (account_id,family_id,role,added_ts) VALUES (?,?,'owner',?)").bind(acc.id, fid, Date.now()).run();
        const end = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
        await env.DB.prepare("INSERT INTO seasons (id,name,end_date,prize,goal,active,family_id) VALUES (?,?,?,?,?,1,?)")
          .bind("s_"+Date.now()+"_"+Math.floor(Math.random()*1e6), "1. Sezon", end, "sürpriz", 1000, fid).run();
        return json({ ok:true, family:{id:fid, name} });
      }

      // e-postasiz cocuk profili ekle (PIN opsiyonel)
      if(route==="account/add-child" && method==="POST"){
        const { familyId, name, age, av, pin } = body;
        if(!familyId || !name || !String(name).trim()) return bad("Aile ve çocuk adı gerekli");
        if(!await accountInFamily(env, acc.id, familyId)) return bad("Bu aile sizin değil", 403);
        const cid = "u_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        const pinVal = (pin!=null && String(pin).trim()!=="") ? String(pin).trim().slice(0,8) : "";
        await env.DB.prepare("INSERT INTO users (id,role,name,age,pin,av,family_id) VALUES (?,'child',?,?,?,?,?)")
          .bind(cid, String(name).trim().slice(0,40), parseInt(age)||null, pinVal, (av||"🙂").slice(0,4), familyId).run();
        return json({ ok:true, child:{id:cid, name:String(name).trim(), av:av||"🙂"} });
      }

      // cocuk profiline gec: aile-bagli hesap, cocugun PIN'i varsa dogrula -> cocuk token'i
      if(route==="account/child-token" && method==="POST"){
        const child = await env.DB.prepare("SELECT id, family_id, pin FROM users WHERE id=? AND role='child'").bind(body.childId).first();
        if(!child) return bad("Çocuk yok", 404);
        if(!await accountInFamily(env, acc.id, child.family_id)) return bad("Yetkisiz", 403);
        if(child.pin && String(child.pin)!=="" && String(child.pin)!==String(body.pin||"")) return bad("PIN hatalı", 401);
        const token = await signToken({uid:child.id, role:"child", exp:Date.now()+ACCOUNT_TTL}, env.SESSION_SECRET||"dev-secret-change-me");
        return json({ token, childId:child.id });
      }

      // ebeveyn aile panosu (onay vb.) - aile-kapsamli veri
      if(route==="account/family-state" && method==="GET"){
        const familyId = (()=>{ try{ return new URL(request.url).searchParams.get("familyId")||""; }catch(e){ return ""; } })();
        if(!await accountInFamily(env, acc.id, familyId)) return bad("Yetkisiz", 403);
        return json(await getFamilyState(env, familyId, acc));
      }

      // ebeveyn karar (onay/ret)
      if(route==="account/decide" && method==="POST"){
        const { compId, decision } = body;
        if(!["approved","rejected"].includes(decision)) return bad("Geçersiz karar");
        const comp = await env.DB.prepare("SELECT * FROM completions WHERE id=?").bind(compId).first();
        if(!comp) return bad("Kayıt yok", 404);
        if(!await accountInFamily(env, acc.id, comp.family_id)) return bad("Yetkisiz", 403);
        await env.DB.prepare("UPDATE completions SET status=?, approver_id=? WHERE id=?").bind(decision, "acc:"+acc.id, compId).run();
        if(decision==="approved" && String(comp.task_id).startsWith("ct_")) await env.DB.prepare("UPDATE custom_tasks SET status='done' WHERE id=?").bind(comp.task_id).run();
        if(decision==="approved"){ await checkReward(env, comp.user_id); await checkCheckpoints(env, comp.user_id); }
        return json({ ok:true });
      }

      // ebeveyn: cocuga ozel gorev ekle
      if(route==="account/custom-task" && method==="POST"){
        const { familyId, childId, title, emoji, xp } = body;
        if(!familyId || !childId || !title || !String(title).trim()) return bad("Çocuk ve görev adı gerekli");
        if(!await accountInFamily(env, acc.id, familyId)) return bad("Yetkisiz", 403);
        const ch = await env.DB.prepare("SELECT family_id FROM users WHERE id=? AND role='child'").bind(childId).first();
        if(!ch || ch.family_id !== familyId) return bad("Bu çocuk bu ailede değil", 403);
        const id = "ct_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        const x = Math.max(1, Math.min(50, parseInt(xp)||10));
        await env.DB.prepare("INSERT INTO custom_tasks (id,child_id,created_by,title,emoji,xp,status,ts,family_id) VALUES (?,?,?,?,?,?, 'active', ?, ?)")
          .bind(id, childId, "acc:"+acc.id, String(title).trim().slice(0,60), (emoji||"⭐").slice(0,4), x, Date.now(), familyId).run();
        return json({ ok:true, id });
      }
      // ebeveyn: ozel gorev iptal
      if(route==="account/custom-cancel" && method==="POST"){
        const ct = await env.DB.prepare("SELECT * FROM custom_tasks WHERE id=?").bind(body.id).first();
        if(!ct) return bad("Görev yok", 404);
        if(!await accountInFamily(env, acc.id, ct.family_id)) return bad("Yetkisiz", 403);
        await env.DB.prepare("UPDATE custom_tasks SET status='cancelled' WHERE id=?").bind(body.id).run();
        return json({ ok:true });
      }
      // ebeveyn: ara odul ekle
      if(route==="account/checkpoint" && method==="POST"){
        const { familyId, childId, threshold, reward } = body;
        const th = parseInt(threshold);
        if(!familyId || !childId || !reward || !String(reward).trim() || !th || th<1) return bad("Çocuk, eşik ve ödül gerekli");
        if(!await accountInFamily(env, acc.id, familyId)) return bad("Yetkisiz", 403);
        const ch = await env.DB.prepare("SELECT family_id FROM users WHERE id=? AND role='child'").bind(childId).first();
        if(!ch || ch.family_id !== familyId) return bad("Bu çocuk bu ailede değil", 403);
        const id = "cp_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        await env.DB.prepare("INSERT INTO checkpoints (id,child_id,created_by,threshold,reward,status,ts,family_id) VALUES (?,?,?,?,?, 'pending', ?, ?)")
          .bind(id, childId, "acc:"+acc.id, th, String(reward).trim().slice(0,60), Date.now(), familyId).run();
        await checkCheckpoints(env, childId);
        return json({ ok:true, id });
      }
      // ebeveyn: checkpoint iptal / verildi
      if((route==="account/checkpoint-cancel" || route==="account/checkpoint-given") && method==="POST"){
        const cp = await env.DB.prepare("SELECT * FROM checkpoints WHERE id=?").bind(body.id).first();
        if(!cp) return bad("Kayıt yok", 404);
        if(!await accountInFamily(env, acc.id, cp.family_id)) return bad("Yetkisiz", 403);
        await env.DB.prepare("UPDATE checkpoints SET status=? WHERE id=?").bind(route==="account/checkpoint-given"?"given":"cancelled", body.id).run();
        return json({ ok:true });
      }

      // e-posta daveti olustur (cocuk|ebeveyn olarak isaretle). Link doner; e-posta gonderimi servis gelince sarilir.
      if(route==="account/invite" && method==="POST"){
        const r = body.role==="child" ? "child" : "parent";
        const em = String(body.email||"").trim().toLowerCase();
        if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return bad("Geçerli bir e-posta gir");
        const link = await accountInFamily(env, acc.id, body.familyId);
        if(!link) return bad("Yetkisiz", 403);
        const tok = genCode(20);
        await env.DB.prepare("INSERT INTO family_invites (id,family_id,email,role,invited_by,token,status,ts) VALUES (?,?,?,?,?,?, 'pending', ?)")
          .bind("inv_"+Date.now()+"_"+Math.floor(Math.random()*1e6), body.familyId, em, r, acc.id, tok, Date.now()).run();
        const inviteLink = appUrl+"/?invite="+tok;
        context.waitUntil(sendEmail(env, em, "Yıldız Avcıları aile daveti ✉️",
          "<p>Bir aileye "+(r==="child"?"çocuk":"ebeveyn")+" olarak davet edildin.</p><p>Kabul etmek için bu e-posta ile giriş yap / kayıt ol ve linke tıkla:</p><p><a href=\""+inviteLink+"\">Daveti kabul et</a></p>"));
        return json({ ok:true, inviteToken:tok, role:r });   // e-posta varsa gonderilir; yoksa link UI'da paylasilir
      }
      // daveti kabul et (giris yapmis hesap aileye baglanir). Su an parent daveti; e-postali cocuk ileride.
      if(route==="account/accept-invite" && method==="POST"){
        const inv = await env.DB.prepare("SELECT * FROM family_invites WHERE token=? AND status='pending'").bind(String(body.token||"")).first();
        if(!inv) return bad("Davet bulunamadı veya kullanılmış", 404);
        if(inv.role!=="parent") return bad("E-postalı çocuk daveti yakında; şimdilik e-postasız çocuk profili ekleyin", 400);
        // davet, gonderildigi e-postaya BAGLI: linki ele geciren baskasi katilamaz (yetki yukseltme onler)
        if(!acc.email || String(inv.email).toLowerCase() !== String(acc.email).toLowerCase())
          return bad("Bu davet bu hesaba ait değil. Davetin gönderildiği e-posta ile giriş yap.", 403);
        await env.DB.prepare("INSERT OR IGNORE INTO account_families (account_id,family_id,role,added_ts) VALUES (?,?,'parent',?)").bind(acc.id, inv.family_id, Date.now()).run();
        await env.DB.prepare("UPDATE family_invites SET status='accepted' WHERE id=?").bind(inv.id).run();
        return json({ ok:true, familyId: inv.family_id });
      }

      // ebeveyn: geri bildirim (degerlendirme/oneri/ariza); iletisim icin hesap e-postasi (gonullu)
      if(route==="account/feedback" && method==="POST"){
        const t = ["rating","suggestion","bug","other"].includes(body.type) ? body.type : "other";
        const r = body.rating!=null ? (Math.max(1,Math.min(5,parseInt(body.rating)||0))||null) : null;
        const fid = (body.familyId && await accountInFamily(env, acc.id, body.familyId)) ? body.familyId : null;
        await env.DB.prepare("INSERT INTO feedback (id,family_id,kind,ref_id,theme,type,rating,message,contact,ts) VALUES (?,?,'parent',?,NULL,?,?,?,?,?)")
          .bind("fb_"+Date.now()+"_"+Math.floor(Math.random()*1e6), fid, acc.id, t, r, String(body.message||"").slice(0,1000), acc.email||null, Date.now()).run();
        return json({ ok:true });
      }

      return bad("Bilinmeyen hesap ucu: "+route, 404);
    }

    /* --- bundan sonrasi (eski PIN/cocuk) auth ister --- */
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
        "INSERT INTO completions (id,user_id,task_id,date,week,ts,status,proof_text,proof_photo_key,ai_ok,ai_note,approver_id,family_id) "+
        "VALUES (?,?,?,?,?,?,'pending',?,?,NULL,NULL,NULL,?)"
      ).bind(id, me.id, taskId, date, week, ts, proofText||null, photoKey, me.family_id).run();
      context.waitUntil(notifyApprovers(env, me));   // ebeveyne anlik "onay bekliyor" push'u (yaniti bloklamaz)
      return json({ ok:true, id });
    }

    /* --- ebeveyn/admin: web push aboneligi kaydet --- */
    if(route==="push-subscribe" && method==="POST"){
      const sub = body.subscription || body;
      if(!sub || !sub.endpoint) return bad("subscription gerekli");
      const keys = sub.keys || {};
      await env.DB.prepare(
        "INSERT INTO push_subs (id,user_id,endpoint,p256dh,auth,ts,family_id) VALUES (?,?,?,?,?,?,?) "+
        "ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, ts=excluded.ts, family_id=excluded.family_id"
      ).bind("ps_"+Date.now()+"_"+Math.floor(Math.random()*1e6), me.id, sub.endpoint, keys.p256dh||"", keys.auth||"", Date.now(), me.family_id).run();
      return json({ ok:true });
    }

    /* --- cocuk: ogrenme sohbeti --- */
    if(route==="learn-chat" && method==="POST"){
      if(me.role!=="child") return bad("Yetkisiz", 403);
      const { messages, date, week } = body;
      if(!Array.isArray(messages) || !messages.length) return bad("messages gerekli");
      const clean = messages.filter(m=>m && (m.role==="user"||m.role==="assistant") && m.content)
        .map(m=>({role:m.role, content:String(m.content).slice(0,1000)})).slice(-12);
      const childTurns = clean.filter(m=>m.role==="user").length;
      const already = await env.DB.prepare("SELECT id FROM completions WHERE user_id=? AND task_id='ogren' AND week=? AND status='approved'").bind(me.id, week).first();
      const ev = await aiChat(env, clean, me.age, body.botName||"rehber", body.themeMood||"", childTurns, !!already);
      const logChat = async (result) => {
        const msgs = clean.concat([{role:"assistant", content:ev.reply}]);
        await env.DB.prepare("INSERT INTO chat_logs (id,child_id,messages,result,ts,family_id) VALUES (?,?,?,?,?,?)")
          .bind("cl_"+Date.now()+"_"+Math.floor(Math.random()*1e6), me.id, JSON.stringify(msgs).slice(0,9000), result, Date.now(), me.family_id).run();
      };
      if(ev.action==="pass"){
        const id = "c_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
        const proof = clean.filter(m=>m.role==="user").map(m=>m.content).join(" / ").slice(0,500);
        await env.DB.prepare(
          "INSERT INTO completions (id,user_id,task_id,date,week,ts,status,proof_text,proof_photo_key,ai_ok,ai_note,approver_id,family_id) "+
          "VALUES (?,?,?,?,?,?,'approved',?,NULL,1,?,'ai',?)"
        ).bind(id, me.id, "ogren", date, week, Date.now(), proof, ev.reply, me.family_id).run();
        await logChat("pass");
        await checkReward(env, me.id); await checkCheckpoints(env, me.id);   // hedef + ara odul kontrolu
        return json({ reply:ev.reply, done:false, passed:true, justWon:true });  // yildiz verildi ama sohbet ACIK kalir
      }
      if(ev.action==="fail"){ await logChat("fail"); return json({ reply:ev.reply, done:true, passed:false }); }
      return json({ reply:ev.reply, done:false });
    }

    /* --- onaylayici/admin: karar --- */
    if(route==="decide" && method==="POST"){
      if(me.role!=="approver" && me.role!=="admin") return bad("Yetkisiz", 403);
      const { compId, decision } = body; // approved | rejected
      if(!["approved","rejected"].includes(decision)) return bad("Geçersiz karar");
      const comp = await env.DB.prepare("SELECT * FROM completions WHERE id=?").bind(compId).first();
      if(!comp) return bad("Kayıt yok", 404);
      if(comp.family_id !== me.family_id) return bad("Yetkisiz", 403);   // aile izolasyonu (defense-in-depth)
      // approver sadece kendi cocuklarini onaylar
      if(me.role==="approver"){
        const kids = me.kids?JSON.parse(me.kids):[];
        if(!kids.includes(comp.user_id)) return bad("Bu çocuk sizin değil", 403);
      }
      await env.DB.prepare("UPDATE completions SET status=?, approver_id=? WHERE id=?")
        .bind(decision, me.id, compId).run();
      // ozel gorev onaylaninca tamamlandi (listeden kalksin)
      if(decision==="approved" && String(comp.task_id).startsWith("ct_")){
        await env.DB.prepare("UPDATE custom_tasks SET status='done' WHERE id=?").bind(comp.task_id).run();
      }
      if(decision==="approved"){ await checkReward(env, comp.user_id); await checkCheckpoints(env, comp.user_id); }
      return json({ ok:true });
    }

    /* --- ebeveyn/admin: cocuga ozel gorev ekle --- */
    if(route==="custom-task" && method==="POST"){
      if(me.role!=="approver" && me.role!=="admin") return bad("Yetkisiz", 403);
      const { childId, title, emoji, xp } = body;
      if(!childId || !title || !String(title).trim()) return bad("Çocuk ve görev adı gerekli");
      const child = await env.DB.prepare("SELECT family_id FROM users WHERE id=? AND role='child'").bind(childId).first();
      if(!child || child.family_id !== me.family_id) return bad("Bu çocuk sizin ailenizde değil", 403);   // aile izolasyonu
      if(me.role==="approver"){
        const kids = me.kids?JSON.parse(me.kids):[];
        if(!kids.includes(childId)) return bad("Bu çocuk sizin değil", 403);
      }
      const id = "ct_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
      const x = Math.max(1, Math.min(50, parseInt(xp)||10));
      await env.DB.prepare("INSERT INTO custom_tasks (id,child_id,created_by,title,emoji,xp,status,ts,family_id) VALUES (?,?,?,?,?,?,'active',?,?)")
        .bind(id, childId, me.id, String(title).trim().slice(0,60), (emoji||"⭐").slice(0,4), x, Date.now(), me.family_id).run();
      return json({ ok:true, id });
    }

    /* --- ebeveyn/admin: ozel gorevi iptal et --- */
    if(route==="custom-cancel" && method==="POST"){
      if(me.role!=="approver" && me.role!=="admin") return bad("Yetkisiz", 403);
      const ct = await env.DB.prepare("SELECT * FROM custom_tasks WHERE id=?").bind(body.id).first();
      if(!ct) return bad("Görev yok", 404);
      if(ct.family_id !== me.family_id) return bad("Yetkisiz", 403);   // aile izolasyonu
      if(me.role==="approver"){
        const kids = me.kids?JSON.parse(me.kids):[];
        if(!kids.includes(ct.child_id)) return bad("Yetkisiz", 403);
      }
      await env.DB.prepare("UPDATE custom_tasks SET status='cancelled' WHERE id=?").bind(body.id).run();
      return json({ ok:true });
    }

    /* --- ebeveyn/admin: ara odul checkpoint ekle --- */
    if(route==="checkpoint" && method==="POST"){
      if(me.role!=="approver" && me.role!=="admin") return bad("Yetkisiz", 403);
      const { childId, threshold, reward } = body;
      if(!childId || !reward || !String(reward).trim()) return bad("Çocuk ve ödül adı gerekli");
      const th = parseInt(threshold);
      if(!th || th<1) return bad("Geçerli bir yıldız eşiği gir");
      const cpChild = await env.DB.prepare("SELECT family_id FROM users WHERE id=? AND role='child'").bind(childId).first();
      if(!cpChild || cpChild.family_id !== me.family_id) return bad("Bu çocuk sizin ailenizde değil", 403);   // aile izolasyonu
      if(me.role==="approver"){
        const kids = me.kids?JSON.parse(me.kids):[];
        if(!kids.includes(childId)) return bad("Bu çocuk sizin değil", 403);
      }
      const id = "cp_"+Date.now()+"_"+Math.floor(Math.random()*1e6);
      await env.DB.prepare("INSERT INTO checkpoints (id,child_id,created_by,threshold,reward,status,ts,family_id) VALUES (?,?,?,?,?,'pending',?,?)")
        .bind(id, childId, me.id, th, String(reward).trim().slice(0,60), Date.now(), me.family_id).run();
      await checkCheckpoints(env, childId);   // dusuk esikse hemen ulasilmis olabilir
      return json({ ok:true, id });
    }

    /* --- ebeveyn/admin: checkpoint iptal / verildi --- */
    if((route==="checkpoint-cancel" || route==="checkpoint-given") && method==="POST"){
      if(me.role!=="approver" && me.role!=="admin") return bad("Yetkisiz", 403);
      const cp = await env.DB.prepare("SELECT * FROM checkpoints WHERE id=?").bind(body.id).first();
      if(!cp) return bad("Kayıt yok", 404);
      if(cp.family_id !== me.family_id) return bad("Yetkisiz", 403);   // aile izolasyonu
      if(me.role==="approver"){
        const kids = me.kids?JSON.parse(me.kids):[];
        if(!kids.includes(cp.child_id)) return bad("Yetkisiz", 403);
      }
      const newStatus = route==="checkpoint-given" ? "given" : "cancelled";
      await env.DB.prepare("UPDATE checkpoints SET status=? WHERE id=?").bind(newStatus, body.id).run();
      return json({ ok:true });
    }

    /* --- cocuk: tema kaydet --- */
    if(route==="theme" && method==="POST"){
      if(me.role!=="child") return bad("Yetkisiz", 403);
      const { theme } = body;
      if(!["scifi","fantasy","pixel","ocean","hero"].includes(theme)) return bad("Geçersiz tema");
      await env.DB.prepare("UPDATE users SET theme=? WHERE id=?").bind(theme, me.id).run();
      return json({ ok:true });
    }

    /* --- cocuk: geri bildirim (degerlendirme/oneri/ariza) --- */
    if(route==="feedback" && method==="POST"){
      if(me.role!=="child") return bad("Yetkisiz", 403);
      const t = ["rating","suggestion","bug","other"].includes(body.type) ? body.type : "other";
      const r = body.rating!=null ? (Math.max(1,Math.min(5,parseInt(body.rating)||0))||null) : null;
      await env.DB.prepare("INSERT INTO feedback (id,family_id,kind,ref_id,theme,type,rating,message,contact,ts) VALUES (?,?,'child',?,?,?,?,?,NULL,?)")
        .bind("fb_"+Date.now()+"_"+Math.floor(Math.random()*1e6), me.family_id, me.id, me.theme||null, t, r, String(body.message||"").slice(0,1000), Date.now()).run();
      return json({ ok:true });
    }

    /* --- foto getir (R2) --- aile izolasyonu: yalniz ayni ailedekiler gorebilir (PII) --- */
    if(seg[0]==="proof" && method==="GET"){
      const key = seg.slice(1).join("/");
      const childId = key.split("/")[1] || "";            // anahtar: proofs/<childId>/<id>.jpg
      const owner = await env.DB.prepare("SELECT family_id FROM users WHERE id=?").bind(childId).first();
      if(!owner || !me.family_id || owner.family_id !== me.family_id) return bad("Yetkisiz", 403);
      const obj = await env.PROOFS.get(key);
      if(!obj) return bad("Foto yok", 404);
      return new Response(obj.body, {headers:{"content-type":"image/jpeg","cache-control":"private, max-age=3600"}});
    }

    /* --- ebeveyn: kendi ailesinin gorev kayitlarini sifirla (aile-kapsamli; root degil) --- */
    if(route==="admin/reset" && method==="POST"){
      if(me.role!=="approver" || !me.family_id) return bad("Yetkisiz", 403);
      await env.DB.prepare("DELETE FROM completions WHERE family_id=?").bind(me.family_id).run();
      return json({ ok:true });
    }

    return bad("Bilinmeyen uç: "+route, 404);
  }catch(e){
    return json({error:"Sunucu hatası", detail:String(e)}, 500);
  }
}
