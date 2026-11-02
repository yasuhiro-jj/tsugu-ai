// お店の数字（Notion「デモ会社設定：食事処 つぐみ（架空）」が正。単位：万円。架空データのみ）。
// 比率・得点などの計算はすべてここでルールベースで行い、AI には計算済みの文字列だけを渡す。
// 秘密情報・実在の財務データは含まない（画面・サーバーどちらから import してもよい）。

import type { FinancialSummary } from "./plan-types";

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

/** AI に渡す文字列（計算済み。資料名と対象期間つき）。 */
export function financialsForPrompt(): string {
  const s = getFinancialSummary();
  const lines = [`資料：${s.source}（単位：万円。前期＝2025年3月期、当期＝2026年3月期）`];
  for (const r of s.rows) {
    lines.push(`- ${r.label}：前期 ${r.previous}／当期 ${r.current}${r.note ? `（${r.note}）` : ""}`);
  }
  return lines.join("\n");
}
