import "server-only";

// 画面（サーバーコンポーネント）が使う、診断・学習・90日計画のデータ取得関数の入口。
// 実体は lib/ の各ファイル（型は lib/plan-types.ts）。ここでは再 export だけを行う。
//
// 守ること：demoId は必ずサーバーでクッキーから読んだ値（lib/demo.ts の getDemoId()）を渡す。
// 相手の非共有データの絞り込みは lib 側（サーバー）で行われる前提。画面は返ってきたものだけを描画する。

export { getDiagnosis } from "@/lib/diagnosis";
export { getFinancialSummary } from "@/lib/financials";
export { getCourses, getCourse, isCourseId } from "@/lib/courses";
export { getLearningState, WANTS_MAX_CHARS } from "@/lib/learning";
export { getActionPlan } from "@/lib/action-plan";
