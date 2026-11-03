import "server-only";

// AI 呼び出し回数の予約（上限管理）。値はすべてプレースホルダで渡す。
// - デモ用 ID × 役割ごとの上限と、アプリ全体の1日あたりの上限
// - 再送（一時エラー・壊れた返事）も1回として数える（lib/ai/retry.ts）

import type { Client } from "@libsql/client";
import type { Role } from "../role";
import { ServiceError } from "../errors";
import { nowIso } from "../util";

export const AI_CALLS_PER_ROLE_LIMIT = 150;
// 通し1回で約35〜40回。審査期間に多くの人が試せるよう 2,000 回（オーナー決定 2026-11-03。元は 500 回、security SEC-001）
export const AI_CALLS_DAILY_LIMIT_DEFAULT = 2000;

export function dailyLimit(): number {
  const v = Number(process.env.AI_DAILY_CALL_LIMIT);
  return Number.isInteger(v) && v > 0 ? v : AI_CALLS_DAILY_LIMIT_DEFAULT;
}

/**
 * 1日上限を数える「日」の区切り。UTC の日付をそのまま使うので、日本時間の毎朝 9:00 に切り替わる
 * （UTC 0:00 = 日本時間 9:00）。例：日本時間 11/4 8:59 は "2026-11-03"、9:00 は "2026-11-04"。
 */
export function usageDayKey(nowIsoString: string): string {
  return nowIsoString.slice(0, 10);
}

/**
 * AI 呼び出しを1回分予約する（上限内なら回数を +1）。上限を超えたら 429。
 * - デモ用 ID × 役割ごとの上限（150回）
 * - アプリ全体の1日あたりの上限（デモ用 ID を作り直す悪用への保険。既定 2,000回、AI_DAILY_CALL_LIMIT で変更可。日本時間の毎朝 9:00 に戻る）
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
  const day = usageDayKey(now);
  const daily = await db.execute({
    sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 1)
          ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    args: [day, dailyLimit()],
  });
  if (daily.rowsAffected !== 1) {
    throw new ServiceError(
      429,
      "本日分の AI の利用回数（アプリ全体）の上限に達しました。日本時間の朝9時に回数が戻ります。時間をおいてもう一度お試しください",
    );
  }
}

// ---- 検索つきの呼び出しだけの1日の上限（SEC-202） ----

/** 検索つきの呼び出しの1日の上限の既定値（1回 約 $0.2 の目安でオーナーに報告済み） */
export const WEB_SEARCH_DAILY_LIMIT_DEFAULT = 200;
export const MSG_WEB_SEARCH_DAILY_LIMIT =
  "本日の『公的な情報で調べる』の上限に達しました。日本時間の朝9時に戻ります。記事の内容だけで答える［質問する］は使えます";

export function webSearchDailyLimit(): number {
  const v = Number(process.env.AI_WEB_SEARCH_DAILY_LIMIT);
  return Number.isInteger(v) && v > 0 ? v : WEB_SEARCH_DAILY_LIMIT_DEFAULT;
}

/**
 * ai_usage_daily に入れる検索用の日のキー（"web:2026-11-03"）。日の区切りは usageDayKey と同じ（日本時間の朝9時）。
 * ai_usage_daily と同じく、デモをやり直しても消さない（古い日付だけ lib/retention.ts が消す）
 */
export function webSearchDayKey(nowIsoString: string): string {
  return `web:${usageDayKey(nowIsoString)}`;
}

/** 検索つきの呼び出しを1回分予約する。アプリ全体の1日の上限を超えたら 429 */
export async function reserveWebSearchCall(db: Client): Promise<void> {
  const rs = await db.execute({
    sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 1)
          ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    args: [webSearchDayKey(nowIso()), webSearchDailyLimit()],
  });
  if (rs.rowsAffected !== 1) throw new ServiceError(429, MSG_WEB_SEARCH_DAILY_LIMIT);
}
