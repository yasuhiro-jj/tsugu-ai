// 業種の型と、架空の「食事処 つぐみ」の初期値（docs/settings-dashboard.md「データ」）。
// 画面・サーバーの両方から import してよい（server-only を付けない。秘密情報・実在のデータは含まない）。
//
// - 飲食店（restaurant）は今の THEMES の hint と DEFAULT_WANTS（＝今のデモと同じ）
// - 製造業・小売・その他は下書き（オーナー確認待ち。2026-11-03）
// - TSUGUMI_SETTINGS は今の DEMO_PROFILES・COMPANY_CONTEXT・THEMES・PREVIOUS_PERIOD/CURRENT_PERIOD から組み立てる
//   （元の定数は残す。何も変えなければ今のデモと同じ文字列になることを tests/settings-golden.test.ts で守る）

import type { CompanySettings, EditableThemeKey, Industry, Level, PeriodInput, Relation } from "./settings-types";
import { THEMES } from "./themes";
import { COMPANY_CONTEXT, DEMO_PROFILES } from "./demo-profiles";
import { CURRENT_PERIOD, PREVIOUS_PERIOD, type PeriodData } from "./financials";

export type IndustryPreset = {
  /** 画面の選択肢の名前 */
  label: string;
  /** 資料の「業種」欄で使う名前（例：「飲食業（和食の食事処）」の「飲食業」） */
  businessLabel: string;
  /** 面談テーマの補足の型 */
  themeHints: Record<EditableThemeKey, string>;
  /** 後継者の「学びたいこと」の初期値（学習の行が無いときだけ使う） */
  defaultWants: string;
  /** 踏ん張れば伸びる余地（ランチ・宴会などの試算）を出すか。飲食店だけ */
  upsideEnabled: boolean;
};

function hintOf(key: EditableThemeKey): string {
  return THEMES.find((t) => t.key === key)!.hint;
}

export const INDUSTRY_PRESETS: Record<Industry, IndustryPreset> = {
  restaurant: {
    label: "飲食店",
    businessLabel: "飲食業",
    themeHints: {
      policy: hintOf("policy"),
      suppliers: hintOf("suppliers"),
      operations: hintOf("operations"),
      people: hintOf("people"),
      cashflow: hintOf("cashflow"),
    },
    // lib/learning.ts の DEFAULT_WANTS と同じ（循環 import を避けるためここにも書く。一致はテストで確認）
    defaultWants: "ランチの売上を伸ばしたい",
    upsideEnabled: true,
  },
  // ---- 以下は下書き（オーナー確認待ち） ----
  manufacturing: {
    label: "製造業",
    businessLabel: "製造業",
    themeHints: {
      policy: "守りたい技術やこだわり、変えてもよいもの",
      suppliers: "主な納品先・仕入れ先と、約束や条件",
      operations: "段取り・品質の見方・設備の判断",
      people: "職人・従業員についての気がかり",
      cashflow: "会社の借金の返済や、毎月のお金の出入り",
    },
    defaultWants: "製品ごとのもうけを知りたい",
    upsideEnabled: false,
  },
  retail: {
    label: "小売",
    businessLabel: "小売業",
    themeHints: {
      policy: "守りたい品ぞろえや接客、変えてもよいもの",
      suppliers: "主な仕入れ先・問屋と、約束や条件",
      operations: "仕入れ・在庫・値付けの判断",
      people: "スタッフについての気がかり",
      cashflow: "お店の借金の返済や、毎月のお金の出入り",
    },
    defaultWants: "在庫と仕入れのお金の流れを知りたい",
    upsideEnabled: false,
  },
  other: {
    label: "その他",
    businessLabel: "その他の業種",
    themeHints: {
      policy: "守りたいもの、変えてもよいもの",
      suppliers: "主な取引先と、約束や条件",
      operations: "日々の仕事の判断の勘どころ",
      people: "従業員についての気がかり",
      cashflow: "会社の借金の返済や、毎月のお金の出入り",
    },
    defaultWants: "毎月のお金の流れを知りたい",
    upsideEnabled: false,
  },
};

function toInput(p: PeriodData): PeriodInput {
  return {
    sales: p.sales,
    cogs: p.cogs,
    labor: p.labor,
    otherSga: p.otherSga,
    interest: p.interest,
    netIncome: p.netIncome,
    cash: p.cash,
    debt: p.debt,
    principalRepayment: p.principalRepayment,
    depreciation: p.depreciation,
  };
}

/** 架空の「食事処 つぐみ」の初期値（設定の行が無い・壊れているときもこれ） */
export const TSUGUMI_SETTINGS: CompanySettings = {
  industry: "restaurant",
  company: {
    name: "食事処 つぐみ（架空）",
    industryNote: "和食の食事処",
    overview: COMPANY_CONTEXT,
  },
  people: {
    predecessorName: DEMO_PROFILES.predecessor.name,
    successorName: DEMO_PROFILES.successor.name,
    relation: DEMO_PROFILES.predecessor.route as Relation,
    predecessorLevel: DEMO_PROFILES.predecessor.level as Level,
    successorLevel: DEMO_PROFILES.successor.level as Level,
  },
  themeHints: { ...INDUSTRY_PRESETS.restaurant.themeHints },
  financials: { previous: toInput(PREVIOUS_PERIOD), current: toInput(CURRENT_PERIOD) },
};

/** 深いコピー（初期値を書き換えられないように） */
export function cloneSettings(s: CompanySettings): CompanySettings {
  return JSON.parse(JSON.stringify(s)) as CompanySettings;
}
