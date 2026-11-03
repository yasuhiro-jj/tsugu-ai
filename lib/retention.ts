import "server-only";

// デモデータの保存期間（Next.js に依存しない。テストからメモリ DB で呼べる）。
//
// - クッキー tsugu_demo の有効期限は7日。7日間使われていないデモ用 ID のデータは、もう誰も開けないので消す
// - 実行のきっかけ：POST /api/role で新しいデモ用 ID を発行するとき（cron・秘密情報は使わない）
// - 1回あたり最大 PURGE_MAX_DEMOS 件のデモ用 ID まで（重い処理にしない。残りは次の発行時に消える）
// - 実行は PURGE_INTERVAL_MS（1時間）に1回まで（SEC-201）。クッキー無しの POST /api/role を繰り返されても、
//   全表の走査は1時間に1回しか起きない。maintenance 表の1行を条件つき UPDATE で取り合い、
//   rowsAffected=1 になった1回だけが削除へ進む（同時に来ても SQLite の UPDATE は原子的なので1回だけ）
//   - 索引は足していない：判定は demo_id ごとの最大時刻で、どの索引でも全行を読むことは変わらないため。
//     読み取り量は実行間隔の制限で抑える
//
// 「最後に使った日時」の判定（決めごと）：
//   demo_id ごとに、次の時刻の最大値を「最後に使った日時」とする。
//     interviews.updated_at / theme_records.updated_at / diagnoses.created_at（updated_at 列が無いため）/
//     learning.updated_at / course_progress.updated_at / action_plans.updated_at / advisor_chats.updated_at /
//     reports.updated_at / ai_usage.updated_at
//   これが保存期間より古いものだけを消す。ai_usage は AI を呼ぶたびに更新されるので「使った」の目印に含める
//   （ただし ai_usage 自体は消さない）。削除の対象は「消す表に行が残っている demo_id」だけに絞る
//   （ai_usage だけが残る demo_id を毎回拾って件数枠を使い切らないため）。
//   時刻はすべて toISOString() の UTC 文字列なので、文字列の大小で比べられる。
//
// - ai_usage / ai_usage_daily は消さない（AI 回数の上限の意味を保つため）。
//   ai_usage_daily の古い日付の行（AI_USAGE_DAILY_KEEP_DAYS より前）だけは消す（上限の判定は当日の行しか使わない）
// - SQL はすべてプレースホルダで値を渡す（表の名前は下の固定文字列だけ）
// - ログは件数と種類だけ。demo_id の値は出さない

import type { Client } from "@libsql/client";
import { deleteDemoDataStatements } from "./interview/store";

export const DEMO_RETENTION_DAYS_DEFAULT = 7;
/** 環境変数で上書きできる範囲（誤設定で全部消えたり、ずっと残ったりしないように） */
const RETENTION_DAYS_MIN = 1;
const RETENTION_DAYS_MAX = 365;
export const PURGE_MAX_DEMOS = 50;
export const AI_USAGE_DAILY_KEEP_DAYS = 30;
/** 保存期間の削除を動かす最短の間隔 */
export const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_KEY = "purge";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 保存日数（環境変数 DEMO_RETENTION_DAYS。1〜365 の整数でなければ既定の 7） */
export function demoRetentionDays(): number {
  const raw = process.env.DEMO_RETENTION_DAYS?.trim();
  if (!raw) return DEMO_RETENTION_DAYS_DEFAULT;
  const v = Number(raw);
  return Number.isInteger(v) && v >= RETENTION_DAYS_MIN && v <= RETENTION_DAYS_MAX
    ? v
    : DEMO_RETENTION_DAYS_DEFAULT;
}

// 消す表（deleteDemoDataStatements と同じ8表）の時刻を demo_id ごとに集め、ai_usage の時刻も加えて判定する
const SELECT_EXPIRED_SQL = `
WITH data_times AS (
  SELECT demo_id, updated_at AS t FROM interviews
  UNION ALL SELECT demo_id, updated_at FROM theme_records
  UNION ALL SELECT demo_id, created_at FROM diagnoses
  UNION ALL SELECT demo_id, updated_at FROM learning
  UNION ALL SELECT demo_id, updated_at FROM course_progress
  UNION ALL SELECT demo_id, updated_at FROM action_plans
  UNION ALL SELECT demo_id, updated_at FROM advisor_chats
  UNION ALL SELECT demo_id, updated_at FROM reports
),
last_data AS (
  SELECT demo_id, MAX(t) AS last_at FROM data_times GROUP BY demo_id
)
SELECT d.demo_id AS demo_id
FROM last_data d
WHERE d.last_at < ?
  AND NOT EXISTS (SELECT 1 FROM ai_usage u WHERE u.demo_id = d.demo_id AND u.updated_at >= ?)
ORDER BY d.last_at
LIMIT ?`;

export type PurgeOptions = {
  /** テスト用の現在時刻 */
  now?: Date;
  retentionDays?: number;
  maxDemos?: number;
};

/** 保存期間を過ぎたデモ用 ID のデータを消す。消した demo_id の件数を返す。 */
export async function purgeExpiredDemos(db: Client, opts: PurgeOptions = {}): Promise<{ demos: number }> {
  const now = opts.now ?? new Date();
  const days = opts.retentionDays ?? demoRetentionDays();
  const max = opts.maxDemos ?? PURGE_MAX_DEMOS;
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();

  const rs = await db.execute({ sql: SELECT_EXPIRED_SQL, args: [cutoff, cutoff, max] });
  const ids = rs.rows.map((r) => r.demo_id).filter((v): v is string => typeof v === "string");

  const usageCutoffDay = new Date(now.getTime() - AI_USAGE_DAILY_KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
  await db.batch(
    [
      ...ids.flatMap((id) => deleteDemoDataStatements(id)),
      { sql: `DELETE FROM ai_usage_daily WHERE day < ?`, args: [usageCutoffDay] },
    ],
    "write",
  );
  return { demos: ids.length };
}

/**
 * 前回の実行から intervalMs 以上たっていれば、実行の権利を取って true を返す（原子的。同時に来ても1つだけ true）。
 * 取れたら last_run_at を now に進める（このあとの削除が失敗しても、次は間隔のあとにやり直す）。
 */
export async function claimPurgeRun(
  db: Client,
  now: Date = new Date(),
  intervalMs: number = PURGE_INTERVAL_MS,
): Promise<boolean> {
  // 行が無ければ「ずっと前に実行した」扱いで作る（'' はどの ISO 時刻よりも小さい）
  await db.execute({
    sql: `INSERT OR IGNORE INTO maintenance (key, last_run_at) VALUES (?, '')`,
    args: [PURGE_KEY],
  });
  const rs = await db.execute({
    sql: `UPDATE maintenance SET last_run_at = ? WHERE key = ? AND last_run_at <= ?`,
    args: [now.toISOString(), PURGE_KEY, new Date(now.getTime() - intervalMs).toISOString()],
  });
  return rs.rowsAffected === 1;
}

/**
 * 失敗しても例外を投げない版（POST /api/role から、応答のあとに呼ぶ）。
 * 前回から PURGE_INTERVAL_MS たっていなければ何もしない（走査もしない）。ログは種類と件数だけ。
 */
export async function purgeExpiredDemosSafely(
  getDb: () => Promise<Client>,
  opts: PurgeOptions & { intervalMs?: number } = {},
): Promise<void> {
  try {
    const db = await getDb();
    if (!(await claimPurgeRun(db, opts.now ?? new Date(), opts.intervalMs ?? PURGE_INTERVAL_MS))) return;
    const { demos } = await purgeExpiredDemos(db, opts);
    if (demos > 0) {
      console.info(JSON.stringify({ level: "info", where: "retention.purge", demos }));
    }
  } catch (err) {
    const error = err instanceof Error ? err.constructor?.name || err.name : "UnknownError";
    console.error(JSON.stringify({ level: "error", where: "retention.purge", error }));
  }
}
