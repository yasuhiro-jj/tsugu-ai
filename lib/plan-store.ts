import "server-only";

// 診断・学習・90日計画のデータの削除と無効化（DB アクセスだけ。Next.js に依存しない）。
// すべて demo_id で絞る。値はプレースホルダで渡す。

import type { Client } from "@libsql/client";

// nowIso / jstToday は lib/util.ts に集めた。既存の import のためここからも公開する
import { nowIso } from "./util";
export { jstToday, nowIso } from "./util";

/** DELETE /api/demo 用：診断・学習・講座の進み具合・90日計画を全部消す。 */
export function deletePlanDataStatements(demoId: string) {
  return [
    { sql: `DELETE FROM diagnoses WHERE demo_id = ?`, args: [demoId] },
    { sql: `DELETE FROM learning WHERE demo_id = ?`, args: [demoId] },
    { sql: `DELETE FROM course_progress WHERE demo_id = ?`, args: [demoId] },
    { sql: `DELETE FROM action_plans WHERE demo_id = ?`, args: [demoId] },
  ];
}

type Stmt = { sql: string; args: (string | number | null)[] };

/** 学習プラン（JSON）を残してよいか：NULL でなく、JSON として読めて、usedDiagnosis が true でない */
const KEEP = (col: string) =>
  `(CASE WHEN ${col} IS NULL THEN 0
         WHEN json_valid(${col}) THEN (CASE WHEN json_extract(${col}, '$.usedDiagnosis') = 1 THEN 0 ELSE 1 END)
         ELSE 0 END)`;

/**
 * 共有の取り消しなどで診断が使えなくなったときに流す文。診断と、診断から作ったもの
 * （90日計画・診断を使った学習プラン）を消す。取り消した内容が派生物に残らないようにするため。
 * 本人の希望・知識レベル・小テストの結果は残す（診断の内容を含まないため）。
 *
 * - 呼び出し側で、ほかの文（shared の UPDATE など）と同じ db.batch(..., "write") に入れること（SEC-101）
 * - 学習プランは SQL の中だけで判定して書き換える（JS で読んでから書く間に別の操作が入る余地を作らない。SEC-107）。
 *   消すものが無くても rev を必ず進める。診断を読んだあと AI を待っている学習プラン作成（rev 条件つき UPDATE）は 409 になり、
 *   取り消し前の診断を使ったプランが後から書き込まれない
 * - UPDATE の SET は更新前の値で評価されるため、previous_plan の判定に元の current_plan を使える
 */
export function invalidateDiagnosisStatements(demoId: string): Stmt[] {
  return [
    { sql: `DELETE FROM diagnoses WHERE demo_id = ?`, args: [demoId] },
    { sql: `DELETE FROM action_plans WHERE demo_id = ?`, args: [demoId] },
    {
      sql: `UPDATE learning SET
              current_plan = CASE WHEN ${KEEP("current_plan")} = 1 THEN current_plan
                                  WHEN ${KEEP("previous_plan")} = 1 THEN previous_plan
                                  ELSE NULL END,
              previous_plan = CASE WHEN ${KEEP("current_plan")} = 1 AND ${KEEP("previous_plan")} = 1 THEN previous_plan
                                   ELSE NULL END,
              rev = rev + 1,
              updated_at = ?
            WHERE demo_id = ?`,
      args: [nowIso(), demoId],
    },
  ];
}

export async function invalidateDiagnosis(db: Client, demoId: string): Promise<void> {
  await db.batch(invalidateDiagnosisStatements(demoId), "write");
}
