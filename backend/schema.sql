-- Yildiz Avcilari - D1 sema (Faz 2)
-- Gorev katalogu KODDA sabit (index.html TASKS); burada sadece kullanici/tamamlama/sezon.

DROP TABLE IF EXISTS completions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS seasons;

CREATE TABLE seasons (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  end_date  TEXT NOT NULL,        -- YYYY-MM-DD
  prize     TEXT NOT NULL,        -- switch vb. (UI'da siluet/odul anahtari)
  goal      INTEGER NOT NULL,     -- her cocuk icin hedef yildiz
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id       TEXT PRIMARY KEY,
  role     TEXT NOT NULL,         -- child | approver | admin
  name     TEXT NOT NULL,
  age      INTEGER,               -- child icin
  pin      TEXT NOT NULL,         -- 4 hane (server-side dogrulama; rate-limit Faz 2.1)
  av       TEXT,                  -- emoji avatar
  title    TEXT,                  -- approver/admin: Anne/Baba/Teyze/Dayi
  theme    TEXT,                  -- child secilen RPG temasi (scifi|fantasy|pixel)
  parents  TEXT,                  -- JSON array<approver_id> (child)
  kids     TEXT,                  -- JSON array<child_id> (approver/admin)
  fail_count INTEGER DEFAULT 0,   -- ardisik yanlis PIN (brute-force korumasi)
  lock_until INTEGER DEFAULT 0    -- bu zamana kadar kilitli (epoch ms)
);

CREATE TABLE completions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  task_id         TEXT NOT NULL,  -- KODDAKI katalog id (ogren, dis_sabah, ...)
  date            TEXT NOT NULL,  -- YYYY-MM-DD (gunluk pencere)
  week            TEXT NOT NULL,  -- YYYY-Www (haftalik pencere)
  ts              INTEGER NOT NULL,
  status          TEXT NOT NULL,  -- pending | approved | rejected
  proof_text      TEXT,
  proof_photo_key TEXT,           -- R2 nesne anahtari (varsa)
  ai_ok           INTEGER,        -- AI on-degerlendirme (0/1/null)
  ai_note         TEXT,
  approver_id     TEXT,           -- onaylayan/reddeden
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_comp_user   ON completions(user_id);
CREATE INDEX idx_comp_status ON completions(status);
CREATE INDEX idx_comp_week   ON completions(user_id, week);
