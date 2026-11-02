-- TSUGU AI のテーブル定義（Turso / libSQL）。
-- アプリは初回利用時に lib/schema.ts の同じ文を ensureSchema() で流す（手で流す必要はない）。
-- ここは確認用の写し。変更するときは lib/schema.ts と両方を直す（tests/schema.test.ts が一致を確認）。
--
-- 方針：
-- - すべての行は demo_id（閲覧者ごとのデモ用 ID）配下。取得は必ず demo_id ＋ role で絞る。
-- - Turso には行ごとの権限制御（RLS）が無いので、絞り込みはサーバーの SQL の WHERE で行う。
-- - ai_usage / ai_usage_daily は AI 呼び出し回数の上限管理用。DELETE /api/demo でも消さない
--   （消すと上限がリセットされ、悪用対策にならないため。中身は回数だけで回答内容は無い）。

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
