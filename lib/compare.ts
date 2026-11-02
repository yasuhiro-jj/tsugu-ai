import "server-only";

// 比較画面用のデータ（サーバー専用。サーバーコンポーネントから直接呼ぶ）。
//
// 守ること（CLAUDE.md「必ず守る動作」）：
// - 双方が共有を許可した回答だけを使う。共有されていないテーマは、内容だけでなく存在も出さない
// - 絞り込みは SQL の WHERE で行う（status='confirmed' かつ shared=1 以外の行はそもそも読まない）
// - 未回答・非公開・破棄・確認待ちはすべて null（区別できる手がかりを返さない）

import type { Client } from "@libsql/client";
import { THEMES, isThemeKey, type ThemeKey } from "./themes";
import type { ComparisonRow, ThemeSummary } from "./interview-types";
import { getDb } from "./db";
import { parseStoredSummary } from "./util";

/** DB を指定して比較データを作る（テスト用にも使う）。 */
export async function getComparisonFrom(db: Client, demoId: string): Promise<ComparisonRow[]> {
  const rs = await db.execute({
    sql: `SELECT role, theme_key, summary
          FROM theme_records
          WHERE demo_id = ?
            AND status = 'confirmed'
            AND shared = 1
            AND summary IS NOT NULL
            AND role IN ('predecessor', 'successor')`,
    args: [demoId],
  });
  const pred = new Map<ThemeKey, ThemeSummary>();
  const succ = new Map<ThemeKey, ThemeSummary>();
  for (const row of rs.rows) {
    if (!isThemeKey(row.theme_key)) continue;
    const s = parseStoredSummary(row.summary);
    if (!s) continue;
    if (row.role === "predecessor") pred.set(row.theme_key, s);
    else if (row.role === "successor") succ.set(row.theme_key, s);
  }
  return THEMES.map((t) => ({
    key: t.key,
    label: t.label,
    predecessor: pred.get(t.key) ?? null,
    successor: succ.get(t.key) ?? null,
  }));
}

/**
 * 比較画面のデータ。demoId はサーバーでクッキーから読んだ値（lib/demo.ts の getDemoId()）を渡すこと。
 * クライアントから送られた値を渡さない。
 */
export async function getComparison(demoId: string): Promise<ComparisonRow[]> {
  return getComparisonFrom(await getDb(), demoId);
}
