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

-- AI参謀チャットの会話（2026-11-03 追加）。本人だけのもの：demo_id ＋ role ごとに1行で、相手の役割からは読まない。
-- 診断・学習プラン・90日計画の材料にもしない。DELETE /api/demo と保存期間の削除で消す。
-- pending_at は「送信中」の印（SEC-A01。AI を呼ぶ前に rev つきで書いて予約し、成功・失敗のどちらでも外す。90秒より古い印は無視）。
CREATE TABLE IF NOT EXISTS advisor_chats (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  messages TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  pending_at TEXT,
  PRIMARY KEY (demo_id, role)
);

-- 決算サマリー・相談用資料（2026-11-03 追加）。二人の共有物（90日計画と同じ扱い）：demo_id ごとに1行。
-- content は AI が書いた文だけ（数字は表示のたびに lib/financials.ts で計算する）。
-- diagnosis_created_at は作成時の診断。共有を取り消すと診断と一緒に消える。DELETE /api/demo と保存期間の削除でも消す。
CREATE TABLE IF NOT EXISTS reports (
  demo_id TEXT NOT NULL PRIMARY KEY,
  content TEXT NOT NULL,
  diagnosis_created_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 90日計画の書き換え（POST・DELETE /api/plan/action）の1日あたりの回数（2026-11-03 追加）。デモ用 ID ごと、AI の回数とは別。
-- day は usageDayKey（日本時間の朝9時で切り替わる）。デモのやり直しでは消さない。前日以前の行は保存期間の削除で消す。
CREATE TABLE IF NOT EXISTS plan_edit_usage (
  demo_id TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (demo_id, day)
);

-- 保存期間の削除（lib/retention.ts）などの定期処理の最後の実行時刻。1時間に1回だけ動かすために使う（SEC-201）。
-- demo_id は持たない（利用者のデータは入らない）。
CREATE TABLE IF NOT EXISTS maintenance (
  key TEXT NOT NULL PRIMARY KEY,
  last_run_at TEXT NOT NULL
);

-- 既存のデータベース向けの列追加（アプリは列が無いときだけ流す。lib/schema.ts の COLUMN_MIGRATIONS）
-- ALTER TABLE action_plans ADD COLUMN diagnosis_created_at TEXT;
-- ALTER TABLE advisor_chats ADD COLUMN pending_at TEXT;
-- ALTER TABLE advisor_chats ADD COLUMN diagnosis_created_at TEXT;
