// 設定ダッシュボード（docs/settings-dashboard.md）で画面とサーバーがやりとりするデータの形と、入力の上限。
// 画面・サーバーの両方から import してよい（server-only を付けない。秘密情報は含まない）。
//
// - 設定はデモ用 ID ごとに1つ（二人の共有物）。先代・後継者のどちらからでも読める・書ける
// - 何も保存していなければ架空の「食事処 つぐみ」の初期値（lib/industry-presets.ts の TSUGUMI_SETTINGS）
// - 検証はサーバー（lib/company-settings.ts の validateSettings）。画面は同じ上限（SETTINGS_LIMITS など）を表示に使う

import type { ThemeKey } from "./themes";

export const INDUSTRIES = ["restaurant", "manufacturing", "retail", "other"] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const RELATIONS = ["身内", "従業員", "第三者"] as const;
export type Relation = (typeof RELATIONS)[number];

export const LEVELS = ["Lv1", "Lv2", "Lv3", "Lv4"] as const;
export type Level = (typeof LEVELS)[number];

/**
 * テーマの補足を書き換えられるテーマ（締め closing は「締めの質問」で固定。面談の指示文の形を保つため）。
 * docs の Record<ThemeKey, string> から closing を除いた形。
 */
export type EditableThemeKey = Exclude<ThemeKey, "closing">;
export const EDITABLE_THEME_KEYS: readonly EditableThemeKey[] = ["policy", "suppliers", "operations", "people", "cashflow"];

/** 1期分の決算の数字（万円の整数。lib/financials.ts の PeriodData から label を除いたもの） */
export type PeriodInput = {
  sales: number; // 売上高
  cogs: number; // 売上原価
  labor: number; // 人件費
  otherSga: number; // その他の販管費
  interest: number; // 支払利息
  netIncome: number; // 当期純利益（マイナス可）
  cash: number; // 手元資金（期末）
  debt: number; // 借入残高（期末）
  principalRepayment: number; // 年間返済額（元本）
  depreciation: number; // 減価償却費
};

export const PERIOD_FIELDS: readonly (keyof PeriodInput)[] = [
  "sales",
  "cogs",
  "labor",
  "otherSga",
  "interest",
  "netIncome",
  "cash",
  "debt",
  "principalRepayment",
  "depreciation",
];

/** 画面の見出し（決算の表の行名と同じ言い方） */
export const PERIOD_FIELD_LABELS: Record<keyof PeriodInput, string> = {
  sales: "売上高",
  cogs: "売上原価",
  labor: "人件費",
  otherSga: "その他の販管費",
  interest: "支払利息",
  netIncome: "当期純利益",
  cash: "手元資金（期末）",
  debt: "借入残高（期末）",
  principalRepayment: "年間返済額（元本）",
  depreciation: "減価償却費",
};

export type CompanySettings = {
  industry: Industry;
  company: {
    name: string; // 会社名（1〜40字）
    industryNote: string; // 業種の補足（0〜60字。例：「和食の食事処」）
    overview: string; // 概要（0〜300字。改行可）
  };
  people: {
    predecessorName: string; // 1〜20字
    successorName: string; // 1〜20字
    relation: Relation;
    predecessorLevel: Level;
    successorLevel: Level;
  };
  /** 面談テーマの補足（各0〜80字。空なら補足なし） */
  themeHints: Record<EditableThemeKey, string>;
  financials: { previous: PeriodInput; current: PeriodInput };
};

/** 文字数の上限（サーバーの検証と同じ。サロゲートペアは1文字） */
export const SETTINGS_LIMITS = {
  companyName: 40,
  industryNote: 60,
  overview: 300,
  personName: 20,
  themeHint: 80,
} as const;

/** 数字の範囲（万円の整数） */
export const FINANCIAL_LIMITS = {
  /** 売上高 */
  sales: { min: 1, max: 1_000_000 },
  /** 当期純利益 */
  netIncome: { min: -1_000_000, max: 1_000_000 },
  /** それ以外 */
  other: { min: 0, max: 1_000_000 },
} as const;

export function financialRange(field: keyof PeriodInput): { min: number; max: number } {
  if (field === "sales") return FINANCIAL_LIMITS.sales;
  if (field === "netIncome") return FINANCIAL_LIMITS.netIncome;
  return FINANCIAL_LIMITS.other;
}

/** 設定を保存すると消えるもの（この役割から見てあるもの）。相手の AI参謀の会話の有無は返さない */
export type WillInvalidate = {
  diagnosis: boolean;
  actionPlan: boolean;
  report: boolean;
  /** 自分の AI参謀の会話（相手の会話も消えるが、有無は知らせない） */
  myAdvisorChat: boolean;
};

export type SettingsView = {
  settings: CompanySettings;
  /** つぐみの初期値と同じ中身か */
  isDefault: boolean;
  /** 保存のたびに1つ増える。PUT・reset ではこの値を送る（行が無ければ 0） */
  rev: number;
  updatedAt: string | null; // ISO（UTC）
  willInvalidate: WillInvalidate;
};

// ---- API ----
// GET  /api/settings                           → { ok: true, ...SettingsView }
// PUT  /api/settings        body { settings, rev } → { ok: true, ...SettingsView, invalidated: boolean }
// POST /api/settings/reset  body { rev }           → PUT と同じ形（つぐみの初期値を書く）
//   入力誤り 400 { ok: false, error, fieldErrors: { "financials.current.sales": "…", ... } }
//   rev が古い 409 { ok: false, error }。書き換え回数の上限 429
export type SettingsSaveResponse = SettingsView & {
  /** true なら診断・90日計画・資料・AI参謀の会話（両方の役割）を消した。中身が同じで何もしなかったら false */
  invalidated: boolean;
};

/** 400 のときの fieldErrors のキー（例："company.name"・"themeHints.policy"・"financials.current.sales"） */
export type SettingsFieldErrors = Record<string, string>;

/** 画面に出す注記（docs「画面」） */
export const SETTINGS_NOTICE =
  "ここに書いた内容は二人の両方に見え、AI にも渡ります。非公開にしたいことや、実在の会社・個人・実際の決算は書かないでください（公開デモ）";
export const SETTINGS_INVALIDATE_CONFIRM = "診断・90日計画・資料・AI参謀の会話が消えます。面談の記録は残ります";
/** 生成の途中で設定が変わったときの 409 の文言 */
export const MSG_SETTINGS_CHANGED = "設定が変わったため作り直してください";
