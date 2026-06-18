-- Yildiz Avcilari - D1 sema (Faz 2, COK-AILELI / multi-tenant)
-- DIKKAT: bu script DROP TABLE icerir -> SADECE bos/yeni DB icin. PROD'da CALISTIRMA.
--   Mevcut prod'u cok-aileliye gecirmek icin: backend/migrations/001_multitenant.sql (ekleme + veri bolme).
-- Gorev katalogu hala KODDA sabit (frontend TASKS); burada kullanici/tamamlama/sezon + aile (tenant).

DROP TABLE IF EXISTS completions;
DROP TABLE IF EXISTS custom_tasks;
DROP TABLE IF EXISTS checkpoints;
DROP TABLE IF EXISTS chat_logs;
DROP TABLE IF EXISTS rewards_log;
DROP TABLE IF EXISTS push_subs;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS seasons;
DROP TABLE IF EXISTS families;

-- ===================== FAMILIES (tenant) =====================
CREATE TABLE families (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,   -- aile giris kodu (cihaz hatirlar; cocuk/ebeveyn PIN ekrani buna gore acilir)
  owner_id   TEXT,                   -- sahip ebeveyn (Faz B: email + parola)
  created_ts INTEGER NOT NULL
);

CREATE TABLE seasons (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  end_date  TEXT NOT NULL,           -- YYYY-MM-DD
  prize     TEXT NOT NULL,           -- switch vb. (UI'da siluet/odul anahtari)
  goal      INTEGER NOT NULL,        -- her cocuk icin hedef yildiz
  active    INTEGER NOT NULL DEFAULT 1,
  family_id TEXT                     -- hangi aileye ait (her aile kendi sezonu)
);
CREATE INDEX idx_season_family ON seasons(family_id, active);

CREATE TABLE users (
  id        TEXT PRIMARY KEY,
  role      TEXT NOT NULL,           -- child | approver | root
  name      TEXT NOT NULL,
  age       INTEGER,                 -- child icin
  pin       TEXT NOT NULL,           -- 4-8 hane (server-side dogrulama; brute-force kilidi)
  av        TEXT,                    -- emoji avatar
  title     TEXT,                    -- approver: Anne/Baba/Teyze/Dayi
  theme     TEXT,                    -- child secilen RPG temasi (scifi|fantasy|pixel)
  parents   TEXT,                    -- JSON array<approver_id> (child)
  kids      TEXT,                    -- JSON array<child_id> (approver)
  fail_count    INTEGER DEFAULT 0,   -- ardisik yanlis PIN
  lock_until    INTEGER DEFAULT 0,   -- bu zamana kadar kilitli (epoch ms)
  hidden        INTEGER DEFAULT 0,   -- login listesinde gizli (test vb.)
  family_id     TEXT,                -- ait oldugu aile (root: NULL)
  is_root_admin INTEGER DEFAULT 0,   -- technical root admin (aile disinda; GDPR: aile PII'si gormez)
  email     TEXT,                    -- owner/ebeveyn girisi (Faz B)
  pw_hash   TEXT,                    -- PBKDF2-SHA256 (Faz B)
  pw_salt   TEXT,
  login_code TEXT                    -- yalniz root admin (aile kodu yerine)
);
CREATE INDEX idx_users_family ON users(family_id);

CREATE TABLE completions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  task_id         TEXT NOT NULL,     -- kod katalogu id (ogren, dis_sabah, ...) ya da ct_/custom
  date            TEXT NOT NULL,     -- YYYY-MM-DD (gunluk pencere)
  week            TEXT NOT NULL,     -- YYYY-Www (haftalik pencere)
  ts              INTEGER NOT NULL,
  status          TEXT NOT NULL,     -- pending | approved | rejected
  proof_text      TEXT,
  proof_photo_key TEXT,              -- R2 nesne anahtari (varsa)
  ai_ok           INTEGER,           -- AI on-degerlendirme (0/1/null)
  ai_note         TEXT,
  approver_id     TEXT,              -- onaylayan/reddeden
  family_id       TEXT,              -- tenant kapsami
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_comp_user   ON completions(user_id);
CREATE INDEX idx_comp_status ON completions(status);
CREATE INDEX idx_comp_week   ON completions(user_id, week);
CREATE INDEX idx_comp_family ON completions(family_id);

-- Ebeveynin cocuga ozel tanimladigi gorevler (kod katalogu disi)
CREATE TABLE custom_tasks (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL,
  created_by TEXT NOT NULL,
  title      TEXT NOT NULL,
  emoji      TEXT DEFAULT '⭐',
  xp         INTEGER NOT NULL DEFAULT 10,
  status     TEXT NOT NULL DEFAULT 'active',  -- active | done | cancelled
  ts         INTEGER NOT NULL,
  family_id  TEXT
);
CREATE INDEX idx_custom_child  ON custom_tasks(child_id, status);
CREATE INDEX idx_custom_family ON custom_tasks(family_id);

-- Ara odul checkpoint'leri (aile tanimlar; cocuk esige ulasinca reached)
CREATE TABLE checkpoints (
  id         TEXT PRIMARY KEY,
  child_id   TEXT NOT NULL,
  created_by TEXT NOT NULL,
  threshold  INTEGER NOT NULL,
  reward     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | reached | given | cancelled
  reached_ts INTEGER,
  ts         INTEGER NOT NULL,
  family_id  TEXT
);
CREATE INDEX idx_cp_child  ON checkpoints(child_id, status);
CREATE INDEX idx_cp_family ON checkpoints(family_id);

-- Ogrenme sohbeti loglari (ebeveyn parental control; root anonim denetim)
CREATE TABLE chat_logs (
  id        TEXT PRIMARY KEY,
  child_id  TEXT NOT NULL,
  messages  TEXT NOT NULL,           -- JSON [{role,content}] tam diyalog
  result    TEXT NOT NULL,           -- pass | fail
  ts        INTEGER NOT NULL,
  family_id TEXT
);
CREATE INDEX idx_chatlog_child  ON chat_logs(child_id, ts);
CREATE INDEX idx_chat_family    ON chat_logs(family_id);

-- Kazanilan hediye/odul kayitlari (metrics + log)
CREATE TABLE rewards_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  season_id  TEXT,
  prize      TEXT,
  xp_at_win  INTEGER,
  ts         INTEGER NOT NULL,
  family_id  TEXT
);
CREATE INDEX idx_rewards_user ON rewards_log(user_id);

-- Web push abonelikleri (ebeveyn cihazlari; anlik onay-bekliyor bildirimi)
CREATE TABLE push_subs (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  endpoint  TEXT NOT NULL,
  p256dh    TEXT,
  auth      TEXT,
  ts        INTEGER NOT NULL,
  family_id TEXT
);
CREATE UNIQUE INDEX idx_push_endpoint ON push_subs(endpoint);
CREATE INDEX idx_push_user ON push_subs(user_id);
