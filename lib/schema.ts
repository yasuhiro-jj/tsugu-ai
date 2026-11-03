// DB のテーブル定義（db/schema.sql と同じ内容。tests/schema.test.ts で一致を確認している）。
// すべて CREATE ... IF NOT EXISTS なので、何度流しても安全。
// 秘密情報は含まない。

export const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS interviews (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  current_theme TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, role)
)`,
  `CREATE TABLE IF NOT EXISTS theme_records (
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
)`,
  `CREATE TABLE IF NOT EXISTS ai_usage (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  calls INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, role)
)`,
  `CREATE TABLE IF NOT EXISTS ai_usage_daily (
  day TEXT NOT NULL PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE IF NOT EXISTS diagnoses (
  demo_id TEXT NOT NULL PRIMARY KEY,
  diagnosis TEXT NOT NULL,
  based_on TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS learning (
  demo_id TEXT NOT NULL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('Lv1', 'Lv2', 'Lv3', 'Lv4')),
  wants TEXT NOT NULL,
  current_plan TEXT,
  previous_plan TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS course_progress (
  demo_id TEXT NOT NULL,
  course_id TEXT NOT NULL CHECK (course_id IN ('cashflow', 'costrate', 'trialbalance')),
  status TEXT NOT NULL CHECK (status IN ('未着手', '学習中', '完了', '復習をおすすめ')),
  score INTEGER,
  wrong_article_nos TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (demo_id, course_id)
)`,
  `CREATE TABLE IF NOT EXISTS action_plans (
  demo_id TEXT NOT NULL PRIMARY KEY,
  start_date TEXT NOT NULL,
  actions TEXT NOT NULL,
  message TEXT,
  diagnosis_created_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  // AI参謀チャットの会話（本人だけのもの。demo_id ＋ role ごとに1行。相手の役割からは読まない）
  `CREATE TABLE IF NOT EXISTS advisor_chats (
  demo_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('predecessor', 'successor')),
  messages TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  pending_at TEXT,
  PRIMARY KEY (demo_id, role)
)`,
  // 決算サマリー・相談用資料（二人の共有物。demo_id ごとに1行。content は AI の文だけで、数字は表示のたびにアプリが計算する）。
  // diagnosis_created_at は作成時の診断。共有の取り消し・診断の作り直しで資料は消える（SEC-101・SEC-102 と同じ）
  `CREATE TABLE IF NOT EXISTS reports (
  demo_id TEXT NOT NULL PRIMARY KEY,
  content TEXT NOT NULL,
  diagnosis_created_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  // 90日計画の書き換え（POST・DELETE /api/plan/action）の1日あたりの回数（デモ用 ID ごと。AI の回数とは別）。
  // day は usageDayKey（日本時間の朝9時で切り替わる）。デモのやり直しでは消さない（上限の意味を保つ）。前日以前の行は保存期間の削除で消す
  `CREATE TABLE IF NOT EXISTS plan_edit_usage (
  demo_id TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (demo_id, day)
)`,
  // 保存期間の削除などの定期処理の実行時刻（1処理1行。SEC-201：実行間隔の制限に使う。demo_id は持たない）
  `CREATE TABLE IF NOT EXISTS maintenance (
  key TEXT NOT NULL PRIMARY KEY,
  last_run_at TEXT NOT NULL
)`,
];

/**
 * 既にあるテーブルへの列の追加（CREATE TABLE IF NOT EXISTS では列が増えないため）。
 * applySchema が PRAGMA table_info で列の有無を確かめ、無いときだけ ALTER TABLE を流す。
 */
export const COLUMN_MIGRATIONS: readonly { table: string; column: string; ddl: string }[] = [
  {
    // SEC-102：90日計画を作ったときに使った診断の createdAt
    table: "action_plans",
    column: "diagnosis_created_at",
    ddl: "ALTER TABLE action_plans ADD COLUMN diagnosis_created_at TEXT",
  },
  {
    // SEC-A01：AI参謀の「送信中」の印（AI を呼ぶ前に予約する。古い印は無視）
    table: "advisor_chats",
    column: "pending_at",
    ddl: "ALTER TABLE advisor_chats ADD COLUMN pending_at TEXT",
  },
];
