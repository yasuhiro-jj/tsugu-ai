// 共有を取り消す前の確認文（「共有する」→「しない」）。
// 消えるものはサーバーが InterviewState.revokeImpact で返す（存在するものだけ true）。画面では判定しない。
// 並べるのは本人と二人の共有物だけ（相手の AI参謀の会話など、相手の情報には触れない）。

import type { RevokeImpact } from "@/lib/interview-types";

/** revokeImpact の項目と表示名（並べる順） */
const IMPACT_LABELS: readonly (readonly [keyof RevokeImpact, string])[] = [
  ["diagnosis", "認識差の診断"],
  ["learningPlanWithDiagnosis", "診断を反映した学習プラン"],
  ["actionPlan", "90日計画"],
  ["report", "資料"],
  ["myAdvisorChat", "あなたの AI参謀の会話"],
];

/** 取り消すと消えるものの表示名（true のものだけ。形が違えば空） */
export function revokedItems(impact: unknown): string[] {
  if (impact === null || typeof impact !== "object") return [];
  const m = impact as Record<string, unknown>;
  return IMPACT_LABELS.filter(([k]) => m[k] === true).map(([, label]) => label);
}

/** 確認の文。消えるものが無ければ null（確認を出さずに切り替える） */
export function revokeConfirmMessage(impact: unknown): string | null {
  const items = revokedItems(impact);
  if (items.length === 0) return null;
  return (
    `この共有を取り消すと、次のものが消えます：${items.join("／")}。\n` +
    "面談の記録とまとめは残ります。\n" +
    "消えたものは元に戻せません（もう一度共有すれば、診断から作り直せます）。"
  );
}

/** 取り消したあとの案内 */
export const REVOKED_NOTICE = "もう一度『共有する』を選べば、診断から作り直せます。";
