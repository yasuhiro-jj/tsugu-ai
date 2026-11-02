import "server-only";

// AI 呼び出し回数の予約（上限管理）。値はすべてプレースホルダで渡す。
// - デモ用 ID × 役割ごとの上限と、アプリ全体の1日あたりの上限
// - 再送（一時エラー・壊れた返事）も1回として数える（lib/ai/retry.ts）

import type { Client } from "@libsql/client";
import type { Role } from "../role";
import { ServiceError } from "../errors";
import { nowIso } from "../util";

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
