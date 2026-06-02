-- Yildiz Avcilari - DEMO seed (public, repo'ya commit edilir)
-- Gercek aile verisi BURADA DEGIL; Sait repo-disi ayri SQL ile D1'e girer.

DELETE FROM completions;
DELETE FROM users;
DELETE FROM seasons;

INSERT INTO seasons (id,name,end_date,prize,goal,active) VALUES
  ('s1','Karne Sezonu','2026-06-26','switch',2500,1);

-- cocuklar
INSERT INTO users (id,role,name,age,pin,av,title,theme,parents,kids) VALUES
  ('c1','child','Demir',13,'1111','🦁',NULL,NULL,'["p1","p2","p3"]',NULL),
  ('c2','child','Kuzey',8,'2222','🐯',NULL,NULL,'["p1","p2","p3"]',NULL),
  ('c3','child','Toprak',13,'3333','🦊',NULL,NULL,'["p4","p5"]',NULL),
-- onaylayicilar
  ('p1','approver','Elif',NULL,'1234','👩','Anne',NULL,NULL,'["c1","c2"]'),
  ('p2','approver','Mert',NULL,'1234','👨','Baba',NULL,NULL,'["c1","c2"]'),
  ('p3','approver','Selin',NULL,'1234','👩‍🦰','Teyze',NULL,NULL,'["c1","c2"]'),
  ('p4','approver','Derya',NULL,'1234','👩','Anne',NULL,NULL,'["c3"]'),
  ('p5','approver','Can',NULL,'1234','👨','Baba',NULL,NULL,'["c3"]'),
-- admin
  ('admin','admin','Yönetici',NULL,'0000','⭐','Dayı',NULL,NULL,'["c1","c2","c3"]');
