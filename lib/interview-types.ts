// AI面談・比較の API で画面とサーバーがやりとりするデータの形（CTO が定義した約束事）。
// 画面・サーバーの両方から `import type` してよい。変更は CTO を通すこと。

import type { Role } from "./role";
import type { ThemeKey } from "./themes";

/** テーマの状態 */
export type ThemeStatus =
  | "not_started" // 未着手
  | "in_progress" // 面談中
  | "awaiting_confirmation" // AI が要約を出し、本人の確認待ち
  | "confirmed" // 本人が要約を確定
  | "discarded"; // 本人が「このテーマは保存しない」を選んだ

/** AI が作り、本人が確認・編集する要約 */
export type ThemeSummary = {
  statements: string[]; // あなたが話したこと
  ai_observations: string[]; // AIが気づいたこと（推測です）
  unconfirmed: string[]; // これから確認したいこと
};

export type ChatMessage = {
  from: "ai" | "me";
  text: string;
};

/** 自分のテーマ一覧の1件（自分のデータだけ。相手のデータは絶対に含めない） */
export type MyTheme = {
  key: ThemeKey;
  label: string;
  status: ThemeStatus;
  /** confirmed のときだけ値あり。共有はまだ選んでいなければ null */
  shared: boolean | null;
  /** awaiting_confirmation（下書き）または confirmed（確定版）のとき値あり */
  summary: ThemeSummary | null;
};

/** GET /api/interview の応答。POST 系も最新状態としてこれを `state` で返す */
export type InterviewState = {
  role: Role;
  displayName: string; // 例：森川 修（架空）
  partnerLabel: string; // 例：「後継者」「先代」（共有の選択文に使う）
  themes: MyTheme[];
  /** 今話しているテーマ。全テーマ終了なら null */
  currentThemeKey: ThemeKey | null;
  /** 今のテーマの会話（自分の分だけ） */
  messages: ChatMessage[];
  /** 確定後、共有をまだ選んでいないテーマ（あれば画面で共有の選択を先に出す） */
  pendingShareThemeKey: ThemeKey | null;
  finished: boolean;
  /**
   * 会話履歴：確定したテーマの会話（自分の分だけ。オーナー指示 2026-11-03）。
   * 破棄したテーマは会話を残さない作りなので含まれない。相手の会話は絶対に含めない。
   */
  history: { key: ThemeKey; label: string; messages: ChatMessage[] }[];
  /**
   * 共有を取り消すと消えるもの（2026-11-03 追加）。今このデモ用 ID に存在するものだけ true。
   * 取り消しの確認の文に使う。相手の AI参謀の会話の有無は返さない（myAdvisorChat は本人の会話だけ）
   */
  revokeImpact: RevokeImpact;
};

/** 共有を取り消したときに一緒に消えるもの（lib/plan-store.ts の invalidateDiagnosisStatements と同じ範囲） */
export type RevokeImpact = {
  /** 認識差の診断 */
  diagnosis: boolean;
  /** 診断を使った学習プラン（今のプラン。取り消すと診断を使う前のプランに戻るか、無くなる） */
  learningPlanWithDiagnosis: boolean;
  /** 90日計画 */
  actionPlan: boolean;
  /** 決算サマリー・相談用資料 */
  report: boolean;
  /** 本人の AI参謀の会話のうち、診断を使ったもの */
  myAdvisorChat: boolean;
};

// ---- リクエスト ----
// POST /api/interview/start      body: {}                     → 今のテーマの最初の問いかけを AI が作る（すでに会話があれば何もしない）
// POST /api/interview/message    body: { text: string }       → 1〜1000文字
// POST /api/interview/summary    body: { themeKey, decision: "confirm" | "discard", summary?: ThemeSummary }
// POST /api/interview/share      body: { themeKey, shared: boolean }  → confirmed のテーマだけ。後から何度でも変更可
// DELETE /api/demo                                             → このブラウザのデモデータを全部消す
// 応答はすべて { ok: true, state: InterviewState } または { ok: false, error: string }（error は利用者に見せてよい日本語）

/** GET /api/compare 相当（比較画面は lib/compare.ts の関数をサーバーコンポーネントから直接呼ぶ） */
export type ComparisonRow = {
  key: ThemeKey;
  label: string;
  /** 共有されていなければ null。「未回答」と「非公開」は区別しない（存在を伝えないため） */
  predecessor: ThemeSummary | null;
  successor: ThemeSummary | null;
};
