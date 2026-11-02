// 面談データの読み書き（DB アクセスだけ）。
// すべての関数は demoId と role を必須引数に取り、SQL の WHERE で必ず両方を絞る。
// 値は必ずプレースホルダ（?）で渡す。文字列連結で SQL を組み立てない。

import type { Client } from "@libsql/client";
import { THEMES, isThemeKey, type ThemeKey } from "../themes";
import type { ChatMessage, ThemeStatus, ThemeSummary } from "../interview-types";
import type { Role } from "../role";
import { ServiceError } from "../errors";
import { deletePlanDataStatements } from "../plan-store";

export type ThemeRecord = {
  themeKey: ThemeKey;
  messages: ChatMessage[];
  followupCount: number;
  status: ThemeStatus;
  summary: ThemeSummary | null;
  shared: boolean | null;
  rev: number;
};

const STATUSES: readonly ThemeStatus[] = [
  "not_started",
  "in_progress",
  "awaiting_confirmation",
  "confirmed",
  "discarded",
];

function nowIso(): string {
  return new Date().toISOString();
}

function emptyRecord(themeKey: ThemeKey): ThemeRecord {
  return {
    themeKey,
    messages: [],
    followupCount: 0,
    status: "not_started",
    summary: null,
    shared: null,
    rev: 0,
  };
}

function parseMessages(raw: unknown): ChatMessage[] {
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (m): m is ChatMessage =>
        m !== null &&
        typeof m === "object" &&
        (m.from === "ai" || m.from === "me") &&
        typeof m.text === "string",
    );
  } catch {
    return [];
  }
}

function parseSummary(raw: unknown): ThemeSummary | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== "object") return null;
    const pick = (k: string): string[] =>
      Array.isArray(v[k]) ? v[k].filter((x: unknown): x is string => typeof x === "string") : [];
    return {
      statements: pick("statements"),
      ai_observations: pick("ai_observations"),
      unconfirmed: pick("unconfirmed"),
    };
  } catch {
    return null;
  }
}

/** 自分（demoId ＋ role）の全テーマを読む。行が無いテーマは未着手として補う。 */
export async function loadRecords(
  db: Client,
  demoId: string,
  role: Role,
): Promise<Map<ThemeKey, ThemeRecord>> {
  const rs = await db.execute({
    sql: `SELECT theme_key, messages, followup_count, status, summary, shared, rev
          FROM theme_records WHERE demo_id = ? AND role = ?`,
    args: [demoId, role],
  });
  const map = new Map<ThemeKey, ThemeRecord>();
  for (const t of THEMES) map.set(t.key, emptyRecord(t.key));
  for (const row of rs.rows) {
    const key = row.theme_key;
    if (!isThemeKey(key)) continue;
    const status = STATUSES.includes(row.status as ThemeStatus)
      ? (row.status as ThemeStatus)
      : "not_started";
    map.set(key, {
      themeKey: key,
      messages: parseMessages(row.messages),
      followupCount: Number(row.followup_count ?? 0),
      status,
      summary: parseSummary(row.summary),
      shared: row.shared === null || row.shared === undefined ? null : Number(row.shared) === 1,
      rev: Number(row.rev ?? 0),
    });
  }
  return map;
}

/** 面談の行と6テーマの行を用意する（既にあれば何もしない）。 */
export async function ensureInterviewRows(db: Client, demoId: string, role: Role): Promise<void> {
  const now = nowIso();
  await db.batch(
    [
      {
        sql: `INSERT OR IGNORE INTO interviews (demo_id, role, current_theme, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [demoId, role, THEMES[0].key, now, now],
      },
      ...THEMES.map((t) => ({
        sql: `INSERT OR IGNORE INTO theme_records
                (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
              VALUES (?, ?, ?, '[]', 0, 'not_started', NULL, NULL, 0, ?)`,
        args: [demoId, role, t.key, now],
      })),
    ],
    "write",
  );
}

/**
 * テーマの行を更新する（楽観ロック：読んだときの rev と一致するときだけ書く）。
 * 同時に別の操作が書いていたら 409。
 */
/** saveRecord の UPDATE 文（db.batch にほかの文と一緒に入れるため）。実行後 rowsAffected が 1 でなければ 409。 */
export function saveRecordStatement(
  demoId: string,
  role: Role,
  rec: ThemeRecord,
  expectedRev: number,
): { sql: string; args: (string | number | null)[] } {
  return {
    sql: `UPDATE theme_records
          SET messages = ?, followup_count = ?, status = ?, summary = ?, shared = ?, rev = rev + 1, updated_at = ?
          WHERE demo_id = ? AND role = ? AND theme_key = ? AND rev = ?`,
    args: [
      JSON.stringify(rec.messages),
      rec.followupCount,
      rec.status,
      rec.summary === null ? null : JSON.stringify(rec.summary),
      rec.shared === null ? null : rec.shared ? 1 : 0,
      nowIso(),
      demoId,
      role,
      rec.themeKey,
      expectedRev,
    ],
  };
}

export const MSG_CONFLICT = "ほかの操作と重なりました。画面を読み込み直してください";

export async function saveRecord(
  db: Client,
  demoId: string,
  role: Role,
  rec: ThemeRecord,
  expectedRev: number,
): Promise<void> {
  const rs = await db.execute(saveRecordStatement(demoId, role, rec, expectedRev));
  if (rs.rowsAffected !== 1) {
    throw new ServiceError(409, MSG_CONFLICT);
  }
}

export async function setCurrentTheme(
  db: Client,
  demoId: string,
  role: Role,
  themeKey: ThemeKey | null,
): Promise<void> {
  await db.execute({
    sql: `UPDATE interviews SET current_theme = ?, updated_at = ? WHERE demo_id = ? AND role = ?`,
    args: [themeKey, nowIso(), demoId, role],
  });
}

/**
 * その demo_id のデータ（両方の役割の面談・診断・学習・講座の進み具合・90日計画）を全部消す。
 * AI 呼び出し回数の記録は消さない。
 */
export async function deleteDemoData(db: Client, demoId: string): Promise<void> {
  await db.batch(
    [
      { sql: `DELETE FROM theme_records WHERE demo_id = ?`, args: [demoId] },
      { sql: `DELETE FROM interviews WHERE demo_id = ?`, args: [demoId] },
      ...deletePlanDataStatements(demoId),
    ],
    "write",
  );
}

export const AI_CALLS_PER_ROLE_LIMIT = 150;
export const AI_CALLS_DAILY_LIMIT_DEFAULT = 500; // 通し1回で約40回。リハーサル込みの目安（security SEC-001）

function dailyLimit(): number {
  const v = Number(process.env.AI_DAILY_CALL_LIMIT);
  return Number.isInteger(v) && v > 0 ? v : AI_CALLS_DAILY_LIMIT_DEFAULT;
}

/**
 * AI 呼び出しを1回分予約する（上限内なら回数を +1）。上限を超えたら 429。
 * - デモ用 ID × 役割ごとの上限（150回）
 * - アプリ全体の1日あたりの上限（デモ用 ID を作り直す悪用への保険。既定 500回、AI_DAILY_CALL_LIMIT で変更可）
 */
export async function reserveAiCall(
  db: Client,
  demoId: string,
  role: Role,
  perRoleLimit: number = AI_CALLS_PER_ROLE_LIMIT,
): Promise<void> {
  const now = nowIso();
  await db.execute({
    sql: `INSERT OR IGNORE INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, ?, 0, ?)`,
    args: [demoId, role, now],
  });
  const perRole = await db.execute({
    sql: `UPDATE ai_usage SET calls = calls + 1, updated_at = ?
          WHERE demo_id = ? AND role = ? AND calls < ?`,
    args: [now, demoId, role, perRoleLimit],
  });
  if (perRole.rowsAffected !== 1) {
    throw new ServiceError(
      429,
      "このデモで AI と話せる回数の上限に達しました。「デモをやり直す」では回数は戻りません。ご了承ください",
    );
  }
  const day = now.slice(0, 10);
  const daily = await db.execute({
    sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 1)
          ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    args: [day, dailyLimit()],
  });
  if (daily.rowsAffected !== 1) {
    throw new ServiceError(429, "本日は AI の利用が混み合っています。時間をおいてもう一度お試しください");
  }
}
