-- TSUGU AI のテーブル定義（Turso / libSQL）。
-- アプリは初回利用時に lib/schema.ts の同じ文を ensureSchema() で流す（手で流す必要はない）。
-- ここは確認用の写し。変更するときは lib/schema.ts と両方を直す（tests/schema.test.ts が一致を確認）。
--
-- 方針：
-- - すべての行は demo_id（閲覧者ごとのデモ用 ID）配下。取得は必ず demo_id ＋ role で絞る。
-- - Turso には行ごとの権限制御（RLS）が無いので、絞り込みはサーバーの SQL の WHERE で行う。
-- - ai_usage / ai_usage_daily は AI 呼び出し回数の上限管理用。DELETE /api/demo でも消さない
--   （消すと上限がリセットされ、悪用対策にならないため。中身は回数だけで回答内容は無い）。
-- - diagnoses / learning / course_progress / action_plans も demo_id 単位。DELETE /api/demo で消す。
--   diagnoses.based_on は診断に使った共有済みテーマ（役割ごと）。共有を取り消すと診断と、
--   診断から作った学習プラン・90日計画を消す（取り消した内容が残らないように）。

CREATE TABLE IF NOT EXISTS interviews (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  current_theme TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, role)
);

CREATE TABLE IF NOT EXISTS theme_records (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  theme_key TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  followup_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'awaiting_confirmation', 'confirmed', 'discarded')),
  summary TEXT,
  shared INTEGER CHECK (shared IS NULL OR shared IN (0, 1)),
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, role, theme_key)
);

CREATE TABLE IF NOT EXISTS ai_usage (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  calls INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, role)
);

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  day TEXT NOT NULL PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS diagnoses (
  demo_id TEXT NOT NULL PRIMARY KEY,
  diagnosis TEXT NOT NULL,
  based_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning (
  demo_id TEXT NOT NULL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('Lv1', 'Lv2', 'Lv3', 'Lv4')),
  wants TEXT NOT NULL,
  current_plan TEXT,
  previous_plan TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS course_progress (
  demo_id TEXT NOT NULL,
  course_id TEXT NOT NULL CHECK (course_id IN ('cashflow', 'costrate', 'trialbalance')),
  status TEXT NOT NULL CHECK (status IN ('未着手', '学習中', '完了', '復習をおすすめ')),
  score INTEGER,
  wrong_article_nos TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, course_id)
);

CREATE TABLE IF NOT EXISTS action_plans (
  demo_id TEXT NOT NULL PRIMARY KEY,
  start_date TEXT NOT NULL,
  actions TEXT NOT NULL,
  message TEXT,
  diagnosis_created_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 既存のデータベース向けの列追加（アプリは列が無いときだけ流す。lib/schema.ts の COLUMN_MIGRATIONS）
-- ALTER TABLE action_plans ADD COLUMN diagnosis_created_at TEXT;
