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
