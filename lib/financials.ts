// お店の数字（Notion「デモ会社設定：食事処 つぐみ（架空）」が正。単位：万円。架空データのみ）。
// 比率・得点などの計算はすべてここでルールベースで行い、AI には計算済みの文字列だけを渡す。
// 秘密情報・実在の財務データは含まない（画面・サーバーどちらから import してもよい）。

import type { FinancialSummary, UpsideItem, UpsideSummary } from "./plan-types";

export const FINANCIAL_SOURCE = "決算書（架空）2025年3月期・2026年3月期";

export type PeriodData = {
  label: string;
  sales: number; // 売上高
  cogs: number; // 売上原価
  labor: number; // 人件費
  otherSga: number; // その他の販管費
  interest: number; // 支払利息
  netIncome: number; // 当期純利益
  cash: number; // 手元資金（期末）
  debt: number; // 借入残高（期末）
  principalRepayment: number; // 年間返済額（元本）
  depreciation: number; // 減価償却費
};

export const PREVIOUS_PERIOD: PeriodData = {
  label: "前期（2025年3月期）",
  sales: 5600,
  cogs: 2240,
  labor: 1960,
  otherSga: 1300,
  interest: 30,
  netIncome: 50,
  cash: 1200,
  debt: 2600,
  principalRepayment: 240,
  depreciation: 120,
};

export const CURRENT_PERIOD: PeriodData = {
  label: "当期（2026年3月期）",
  sales: 5400,
  cogs: 2268,
  labor: 1998,
  otherSga: 1370,
  interest: 34,
  netIncome: -272,
  cash: 808,
  debt: 2360,
  principalRepayment: 240,
  depreciation: 120,
};

export type Computed = {
  grossProfit: number; // 粗利 = 売上 − 売上原価
  operatingProfit: number; // 営業利益 = 粗利 − 人件費 − その他の販管費
  ordinaryProfit: number; // 経常利益 = 営業利益 − 支払利息
  costRate: number; // 原価率（%）
  laborRate: number; // 人件費率（%）
  flRate: number; // FL比率（%）= 原価率 + 人件費率
  operatingMargin: number; // 営業利益率（%）
  monthlySales: number; // 月商 = 売上 ÷ 12
  cashMonths: number; // 手元資金 ÷ 月商
  cashFlow: number; // 現金の動き（簡易）= 純利益 + 減価償却費 − 元本返済
};

export function computePeriod(p: PeriodData): Computed {
  const grossProfit = p.sales - p.cogs;
  const operatingProfit = grossProfit - p.labor - p.otherSga;
  const ordinaryProfit = operatingProfit - p.interest;
  const costRate = (p.cogs / p.sales) * 100;
  const laborRate = (p.labor / p.sales) * 100;
  const monthlySales = p.sales / 12;
  return {
    grossProfit,
    operatingProfit,
    ordinaryProfit,
    costRate,
    laborRate,
    flRate: ((p.cogs + p.labor) / p.sales) * 100,
    operatingMargin: (operatingProfit / p.sales) * 100,
    monthlySales,
    cashMonths: p.cash / monthlySales,
    cashFlow: p.netIncome + p.depreciation - p.principalRepayment,
  };
}

/** 小数1桁に四捨五入（負の数も絶対値で丸める：-4.37 → -4.4） */
export function round1(v: number): number {
  const r = Math.round(Math.abs(v) * 10) / 10;
  return v < 0 ? -r : r;
}

/** 万円の表記（3桁区切り、マイナスは ▲） */
export function formatMan(v: number): string {
  const abs = Math.round(Math.abs(v)).toLocaleString("ja-JP");
  return `${v < 0 ? "▲" : ""}${abs}万円`;
}

/** % の表記（小数1桁、マイナスは ▲） */
export function formatPercent(v: number): string {
  const r = round1(v);
  return `${r < 0 ? "▲" : ""}${Math.abs(r).toFixed(1)}%`;
}

export function formatMonths(v: number): string {
  return `約${round1(v).toFixed(1)}か月分`;
}

export function getFinancialSummary(): FinancialSummary {
  const p = PREVIOUS_PERIOD;
  const c = CURRENT_PERIOD;
  const pc = computePeriod(p);
  const cc = computePeriod(c);
  const row = (label: string, prev: string, cur: string, note?: string) =>
    note ? { label, previous: prev, current: cur, note } : { label, previous: prev, current: cur };
  return {
    source: FINANCIAL_SOURCE,
    rows: [
      row("売上高", formatMan(p.sales), formatMan(c.sales)),
      row("売上原価", formatMan(p.cogs), formatMan(c.cogs), "材料費など"),
      row("粗利", formatMan(pc.grossProfit), formatMan(cc.grossProfit), "売上高 − 売上原価"),
      row("人件費", formatMan(p.labor), formatMan(c.labor)),
      row("その他の販管費", formatMan(p.otherSga), formatMan(c.otherSga), "家賃・光熱費など"),
      row("営業利益", formatMan(pc.operatingProfit), formatMan(cc.operatingProfit), "本業のもうけ（粗利 − 人件費 − その他の販管費）"),
      row("支払利息", formatMan(p.interest), formatMan(c.interest)),
      row("経常利益", formatMan(pc.ordinaryProfit), formatMan(cc.ordinaryProfit), "営業利益 − 支払利息"),
      row("当期純利益", formatMan(p.netIncome), formatMan(c.netIncome)),
      row("原価率", formatPercent(pc.costRate), formatPercent(cc.costRate), "売上原価 ÷ 売上高"),
      row("人件費率", formatPercent(pc.laborRate), formatPercent(cc.laborRate), "人件費 ÷ 売上高"),
      row("FL比率", formatPercent(pc.flRate), formatPercent(cc.flRate), "原価率 ＋ 人件費率"),
      row("営業利益率", formatPercent(pc.operatingMargin), formatPercent(cc.operatingMargin), "営業利益 ÷ 売上高"),
      row("手元資金（期末）", formatMan(p.cash), formatMan(c.cash)),
      row("手元資金は月商の何か月分", formatMonths(pc.cashMonths), formatMonths(cc.cashMonths), "手元資金 ÷（売上高 ÷ 12）"),
      row("借入残高（期末）", formatMan(p.debt), formatMan(c.debt)),
      row("年間返済額（元本）", formatMan(p.principalRepayment), formatMan(c.principalRepayment), "月20万円"),
      row("減価償却費", formatMan(p.depreciation), formatMan(c.depreciation)),
      row(
        "当期の現金の動き",
        "—",
        formatMan(cc.cashFlow),
        "純利益 ＋ 減価償却費 − 元本の返済（手元資金 1,200万円 → 808万円）",
      ),
    ],
  };
}

// ---- 踏ん張れば伸びる余地（仮定の試算。Notion「デモ会社設定」3章。単位：万円） ----
// 前提だけをデータとして持ち、効果は当期の数字（CURRENT_PERIOD）から計算する（直書きしない）。

export const UPSIDE_ASSUMPTIONS = {
  /** 月末棚卸＋仕入れ・メニューの見直し：原価率の目標（%） */
  targetCostRate: 40,
  /** ランチ価格の改定：1食あたりの値上げ（円） */
  lunchPriceUpYen: 40,
  /** ランチの年間食数（食） */
  lunchMealsPerYear: 25_000,
  /** 宴会・法事：年間の増加組数 */
  banquetExtraGroups: 8,
  /** 宴会・法事：1組あたりの売上（万円） */
  banquetPricePerGroup: 15,
  /** 宴会・法事：原価率（%） */
  banquetCostRate: 20,
  /** シフト見直し：人件費率の目標（%） */
  targetLaborRate: 36,
} as const;

export const UPSIDE_NOTE =
  "試算は仮定にもとづくもので、実現を保証しない。AIは『この策が正解』と断定せず、選択肢と前提条件を示す。";

/** 増減の表記（＋／▲つきの万円。0 は「0万円」） */
export function formatManSigned(v: number): string {
  return v > 0 ? `+${formatMan(v)}` : formatMan(v);
}

export function getUpsideSummary(): UpsideSummary {
  const a = UPSIDE_ASSUMPTIONS;
  const c = CURRENT_PERIOD;
  const cc = computePeriod(c);
  // 割り算の誤差を避けるため「金額 − 売上×目標率」で計算する（売上×(現在率−目標率) と同じ）
  const costEffect = c.cogs - (c.sales * a.targetCostRate) / 100;
  const lunchEffect = (a.lunchPriceUpYen * a.lunchMealsPerYear) / 10_000; // 円 → 万円
  const banquetEffect = (a.banquetExtraGroups * a.banquetPricePerGroup * (100 - a.banquetCostRate)) / 100;
  const laborEffect = c.labor - (c.sales * a.targetLaborRate) / 100;

  const item = (id: UpsideItem["id"], title: string, assumption: string, raw: number): UpsideItem => {
    const effect = round1(raw);
    return { id, title, assumption, effect, effectText: formatManSigned(effect) };
  };
  const items: UpsideItem[] = [
    item(
      "costrate",
      "月末棚卸＋仕入れ・メニューの見直し",
      `原価率 ${formatPercent(cc.costRate)} → ${formatPercent(a.targetCostRate)}`,
      costEffect,
    ),
    item(
      "lunchprice",
      "据え置いていたランチ価格の改定",
      `1食+${a.lunchPriceUpYen}円、年約${a.lunchMealsPerYear.toLocaleString("ja-JP")}食`,
      lunchEffect,
    ),
    item(
      "banquet",
      "宴会・法事の受注を「先代の人脈」から「仕組み」へ",
      `年+${a.banquetExtraGroups}組×${a.banquetPricePerGroup}万円、原価率${a.banquetCostRate}%`,
      banquetEffect,
    ),
    item(
      "shift",
      "曜日・時間帯別のシフト見直し",
      `人件費率 ${formatPercent(cc.laborRate)} → ${formatPercent(a.targetLaborRate)}`,
      laborEffect,
    ),
  ];
  const total = round1(items.reduce((n, i) => n + i.effect, 0));
  const before = round1(cc.operatingProfit);
  const after = round1(before + total);
  return {
    items,
    total,
    totalText: formatManSigned(total),
    operatingProfitBefore: before,
    operatingProfitBeforeText: formatMan(before),
    operatingProfitAfter: after,
    operatingProfitAfterText: formatManSigned(after),
    note: UPSIDE_NOTE,
  };
}

/** AI に渡す試算の文字列（計算済み。仮定であることを明記） */
export function upsideForPrompt(): string {
  const u = getUpsideSummary();
  const lines = [
    "踏ん張れば伸びる余地（仮定の試算。単位：万円。当期＝2026年3月期の数字から計算）",
    "※実現を保証しない。断定せず、前提条件と選択肢として扱うこと。",
  ];
  for (const i of u.items) lines.push(`- ${i.title}：前提 ${i.assumption}／営業利益への効果 ${i.effectText}`);
  lines.push(`- 合計：${u.totalText}（営業利益 当期 ${u.operatingProfitBeforeText} → 改善後 約${u.operatingProfitAfterText}）`);
  lines.push(`注記：${u.note}`);
  return lines.join("\n");
}

/** AI に渡す文字列（計算済み。資料名と対象期間つき）。 */
export function financialsForPrompt(): string {
  const s = getFinancialSummary();
  const lines = [`資料：${s.source}（単位：万円。前期＝2025年3月期、当期＝2026年3月期）`];
  for (const r of s.rows) {
    lines.push(`- ${r.label}：前期 ${r.previous}／当期 ${r.current}${r.note ? `（${r.note}）` : ""}`);
  }
  return lines.join("\n");
}
