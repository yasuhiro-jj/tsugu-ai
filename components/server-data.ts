import "server-only";

// 画面（サーバーコンポーネント）が使う、診断・学習・90日計画のデータ取得関数の入口。
// 実体は backend が lib/ に実装する（名前とシグネチャは lib/plan-types.ts の約束どおり）。
// lib 側のファイル名が異なる場合は、このファイルの import 元だけを直せばよい。
//
// 守ること：demoId は必ずサーバーでクッキーから読んだ値（lib/demo.ts の getDemoId()）を渡す。
// 相手の非共有データの絞り込みは lib 側（サーバー）で行われる前提。画面は返ってきたものだけを描画する。

export { getDiagnosis } from "@/lib/diagnosis";
export { getFinancialSummary } from "@/lib/financials";
export { getCourses, getCourse, isCourseId } from "@/lib/courses";
export { getLearningState, WANTS_MAX_CHARS } from "@/lib/learning";
export { getActionPlan } from "@/lib/action-plan";
