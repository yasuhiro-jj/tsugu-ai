import "server-only";

// 画面（サーバーコンポーネント）が使う、診断・学習・90日計画・会社の設定のデータ取得関数の入口。
// 実体は lib/ の各ファイル（型は lib/plan-types.ts・lib/settings-types.ts）。ここでは再 export だけを行う。
//
// 守ること：demoId は必ずサーバーでクッキーから読んだ値（lib/demo.ts の getDemoId() / getSession()）を渡す。
// 相手の非共有データの絞り込みは lib 側（サーバー）で行われる前提。画面は返ってきたものだけを描画する。

export { getDiagnosis } from "@/lib/diagnosis";
// 決算の数字・伸びる余地は会社の設定（デモ用 ID ごと）から計算する。伸びる余地は飲食店以外で null
export {
  getFinancialSummaryForDemo as getFinancialSummary,
  getUpsideSummaryForDemo as getUpsideSummary,
  getCompanySettings,
} from "@/lib/company-settings";
export { getCourses, getCourse, isCourseId } from "@/lib/courses";
export { getLearningState, WANTS_MAX_CHARS } from "@/lib/learning";
export { getActionPlan } from "@/lib/action-plan";
