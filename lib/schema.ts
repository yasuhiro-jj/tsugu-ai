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
];
