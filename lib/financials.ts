// お店の数字（Notion「デモ会社設定：食事処 つぐみ（架空）」が正。単位：万円。架空データのみ）。
// 比率・得点などの計算はすべてここでルールベースで行い、AI には計算済みの文字列だけを渡す。
// 秘密情報・実在の財務データは含まない（画面・サーバーどちらから import してもよい）。

import type { FinancialFormulaTerm, FinancialGroup, FinancialRow, FinancialSummary, UpsideItem, UpsideSummary } from "./plan-types";
import type { PeriodInput } from "./settings-types";

export const FINANCIAL_SOURCE = "決算書（架空）2025年3月期・2026年3月期";
/** 設定ダッシュボードで数字を書き換えたときの資料名（docs/settings-dashboard.md「呼び出し側」） */
export const USER_FINANCIAL_SOURCE = "設定に入力した決算の数字（利用者入力）";

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

/** 前期・当期の数字（設定の financials と同じ形。初期値はつぐみ） */
export type FinancialsInput = { previous: PeriodInput; current: PeriodInput };
/** 伸びる余地の計算に使う設定（CompanySettings の一部） */
export type UpsideInput = { industry: string; financials: FinancialsInput };

export const TSUGUMI_FINANCIALS: FinancialsInput = { previous: PREVIOUS_PERIOD, current: CURRENT_PERIOD };
const TSUGUMI_UPSIDE_INPUT: UpsideInput = { industry: "restaurant", financials: TSUGUMI_FINANCIALS };

const PERIOD_KEYS: readonly (keyof PeriodInput)[] = [
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

/** 数字がつぐみの決算（架空）と同じか */
export function isTsugumiFinancials(f: FinancialsInput): boolean {
  return PERIOD_KEYS.every((k) => f.previous[k] === PREVIOUS_PERIOD[k] && f.current[k] === CURRENT_PERIOD[k]);
}

/** 資料名と期の名前。つぐみの数字なら決算期つき、利用者入力なら「前期」「当期」だけ */
export type PeriodNames = { userInput: boolean; source: string; previous: string; current: string };

export function periodNames(f: FinancialsInput = TSUGUMI_FINANCIALS): PeriodNames {
  if (isTsugumiFinancials(f)) {
    return { userInput: false, source: FINANCIAL_SOURCE, previous: PREVIOUS_PERIOD.label, current: CURRENT_PERIOD.label };
  }
  return { userInput: true, source: USER_FINANCIAL_SOURCE, previous: "前期", current: "当期" };
}

export function computePeriod(p: PeriodInput): Computed {
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

/** 年間返済額（元本）の注記（例：「月20万円」）。前期と当期で違えば当期の分 */
function repaymentNote(p: PeriodInput, c: PeriodInput): string {
  const m = c.principalRepayment / 12;
  const text = Number.isInteger(m) ? `月${m.toLocaleString("ja-JP")}万円` : `月約${round1(m).toFixed(1)}万円`;
  return p.principalRepayment === c.principalRepayment ? text : `当期は${text}`;
}

// ---- 損益（もうけ）とお金の動き（資金繰り）を分ける（外部評価の指摘への対応 2026-11-03） ----

/** 元本の返済の注記（画面・資料・AI への入力で同じ文を使う） */
export const PRINCIPAL_REPAYMENT_NOTE = "元本の返済は費用ではないので営業利益には入りません。ただし手元のお金は減ります";

/** 診断・資料・AI参謀の指示文（アプリ側の補足）に足す一文 */
export const PL_CASH_SEPARATION_RULE =
  "営業赤字と元本の返済を足し合わせて1つの損失や赤字のように書かない。損益（もうけ）と資金繰り（お金の動き）は分けて書く";

export const PROFIT_AND_LOSS_TITLE = "もうけ（損益）";
export const CASH_MOVEMENT_TITLE = "お金の動き（資金繰り）";
export const CASH_FLOW_FORMULA = "当期純利益 ＋ 減価償却費 − 元本の返済 ＝ 現金の増減";

/** 今までの行（rows）のうち、もうけ（損益）に入る行。ほかの行はお金の動き（資金繰り）に入る（AI への入力の分け方） */
const PL_ROW_LABELS: ReadonlySet<string> = new Set([
  "売上高",
  "売上原価",
  "粗利",
  "人件費",
  "その他の販管費",
  "営業利益",
  "支払利息",
  "経常利益",
  "当期純利益",
  "原価率",
  "人件費率",
  "FL比率",
  "営業利益率",
]);

function row(label: string, prev: string, cur: string, note?: string): FinancialRow {
  return note ? { label, previous: prev, current: cur, note } : { label, previous: prev, current: cur };
}

/** 符号つきの項の表記（「▲272万円」「＋ 120万円」「− 240万円」）。引く項はマイナスの値を括弧で囲む */
function termText(t: FinancialFormulaTerm): string {
  if (t.op === "start") return t.value;
  const v = t.value.startsWith("▲") && t.op !== "=" ? `（${t.value}）` : t.value;
  return `${t.op === "+" ? "＋" : t.op === "−" ? "−" : "＝"} ${v}`;
}

function profitAndLossGroup(p: PeriodInput, c: PeriodInput, pc: Computed, cc: Computed): FinancialGroup {
  return {
    title: PROFIT_AND_LOSS_TITLE,
    rows: [
      row("売上高", formatMan(p.sales), formatMan(c.sales)),
      row("粗利", formatMan(pc.grossProfit), formatMan(cc.grossProfit), "売上高 − 売上原価"),
      row("営業利益", formatMan(pc.operatingProfit), formatMan(cc.operatingProfit), "本業のもうけ（粗利 − 人件費 − その他の販管費）。元本の返済は入らない"),
      row("経常利益", formatMan(pc.ordinaryProfit), formatMan(cc.ordinaryProfit), "営業利益 − 支払利息"),
      row("当期純利益", formatMan(p.netIncome), formatMan(c.netIncome)),
    ],
  };
}

function cashMovementGroup(p: PeriodInput, c: PeriodInput, pc: Computed, cc: Computed): FinancialSummary["cashMovement"] {
  const breakdown: FinancialFormulaTerm[] = [
    { label: "当期純利益", op: "start", value: formatMan(c.netIncome) },
    { label: "減価償却費", op: "+", value: formatMan(c.depreciation) },
    { label: "元本の返済", op: "−", value: formatMan(c.principalRepayment) },
    { label: "現金の増減", op: "=", value: formatMan(cc.cashFlow) },
  ];
  return {
    title: CASH_MOVEMENT_TITLE,
    rows: [
      row("当期純利益", formatMan(p.netIncome), formatMan(c.netIncome), "出発点（もうけの最後の数字）"),
      row("減価償却費", formatMan(p.depreciation), formatMan(c.depreciation), "足す（費用だが、お金は出ていかない）"),
      row("元本の返済", formatMan(p.principalRepayment), formatMan(c.principalRepayment), `引く（費用ではないが、お金は出ていく。${repaymentNote(p, c)}）`),
      row("現金の増減", formatMan(pc.cashFlow), formatMan(cc.cashFlow), CASH_FLOW_FORMULA.replace(" ＝ 現金の増減", "")),
      row("手元資金（期末）", formatMan(p.cash), formatMan(c.cash), `前期末 ${formatMan(p.cash)} → 当期末 ${formatMan(c.cash)}`),
      row("手元資金は月商の何か月分", formatMonths(pc.cashMonths), formatMonths(cc.cashMonths), "手元資金 ÷（売上高 ÷ 12）"),
    ],
    formula: CASH_FLOW_FORMULA,
    breakdown,
    breakdownText: breakdown.map(termText).join(" "),
    cashChangeText: `手元資金 ${formatMan(p.cash)} → ${formatMan(c.cash)}（${formatManSigned(c.cash - p.cash)}）`,
  };
}

/** 比較画面・資料の数字の表。f は設定の数字（初期値はつぐみ） */
export function getFinancialSummary(f: FinancialsInput = TSUGUMI_FINANCIALS): FinancialSummary {
  const p = f.previous;
  const c = f.current;
  const pc = computePeriod(p);
  const cc = computePeriod(c);
  return {
    source: periodNames(f).source,
    profitAndLoss: profitAndLossGroup(p, c, pc, cc),
    cashMovement: cashMovementGroup(p, c, pc, cc),
    principalNote: PRINCIPAL_REPAYMENT_NOTE,
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
      row("年間返済額（元本）", formatMan(p.principalRepayment), formatMan(c.principalRepayment), repaymentNote(p, c)),
      row("減価償却費", formatMan(p.depreciation), formatMan(c.depreciation)),
      row(
        "当期の現金の動き",
        "—",
        formatMan(cc.cashFlow),
        `純利益 ＋ 減価償却費 − 元本の返済（手元資金 ${formatMan(p.cash)} → ${formatMan(c.cash)}）`,
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

/** 飲食店で数字を書き換えたときに添える文（ランチ・宴会の前提はつぐみのまま） */
export const UPSIDE_EXAMPLE_NOTE = "ランチ・宴会の前提はつぐみの例です";

/** 目標の率への改善の前提と効果。今の率がもう目標以下なら効果は 0（マイナスの「改善」を出さない） */
function rateStep(name: string, rate: number, target: number, amount: number, sales: number) {
  if (round1(rate) <= target) {
    return { assumption: `${name} ${formatPercent(rate)}（目標 ${formatPercent(target)} 以下のため試算しない）`, raw: 0 };
  }
  // 割り算の誤差を避けるため「金額 − 売上×目標率」で計算する（売上×(現在率−目標率) と同じ）
  return { assumption: `${name} ${formatPercent(rate)} → ${formatPercent(target)}`, raw: amount - (sales * target) / 100 };
}

/**
 * 踏ん張れば伸びる余地。引数なしはつぐみ。設定を渡したときは、飲食店以外なら null（比較画面・AI参謀・資料に出さない）。
 * 飲食店で数字を書き換えていれば exampleNote を添える。
 */
export function getUpsideSummary(): UpsideSummary;
export function getUpsideSummary(s: UpsideInput): UpsideSummary | null;
export function getUpsideSummary(s: UpsideInput = TSUGUMI_UPSIDE_INPUT): UpsideSummary | null {
  if (s.industry !== "restaurant") return null;
  const a = UPSIDE_ASSUMPTIONS;
  const c = s.financials.current;
  const cc = computePeriod(c);
  const cost = rateStep("原価率", cc.costRate, a.targetCostRate, c.cogs, c.sales);
  const lunchEffect = (a.lunchPriceUpYen * a.lunchMealsPerYear) / 10_000; // 円 → 万円
  const banquetEffect = (a.banquetExtraGroups * a.banquetPricePerGroup * (100 - a.banquetCostRate)) / 100;
  const labor = rateStep("人件費率", cc.laborRate, a.targetLaborRate, c.labor, c.sales);

  const item = (id: UpsideItem["id"], title: string, assumption: string, raw: number): UpsideItem => {
    const effect = round1(raw);
    return { id, title, assumption, effect, effectText: formatManSigned(effect) };
  };
  const items: UpsideItem[] = [
    item(
      "costrate",
      "月末棚卸＋仕入れ・メニューの見直し",
      cost.assumption,
      cost.raw,
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
      labor.assumption,
      labor.raw,
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
    ...(isTsugumiFinancials(s.financials) ? {} : { exampleNote: UPSIDE_EXAMPLE_NOTE }),
  };
}

/** AI に渡す試算の文字列（計算済み。仮定であることを明記） */
export function upsideForPrompt(): string;
export function upsideForPrompt(s: UpsideInput): string | null;
export function upsideForPrompt(s: UpsideInput = TSUGUMI_UPSIDE_INPUT): string | null {
  const u = getUpsideSummary(s);
  if (!u) return null;
  const lines = [
    u.exampleNote
      ? "踏ん張れば伸びる余地（仮定の試算。単位：万円。当期の数字から計算）"
      : "踏ん張れば伸びる余地（仮定の試算。単位：万円。当期＝2026年3月期の数字から計算）",
    "※実現を保証しない。断定せず、前提条件と選択肢として扱うこと。",
  ];
  if (u.exampleNote) lines.push(`※${u.exampleNote}（この会社の実績ではない）。`);
  for (const i of u.items) lines.push(`- ${i.title}：前提 ${i.assumption}／営業利益への効果 ${i.effectText}`);
  lines.push(`- 合計：${u.totalText}（営業利益 当期 ${u.operatingProfitBeforeText} → 改善後 約${u.operatingProfitAfterText}）`);
  lines.push(`注記：${u.note}`);
  return lines.join("\n");
}

/**
 * AI に渡す文字列（計算済み。資料名と対象期間つき）。
 * 「もうけ（損益）」と「お金の動き（資金繰り）」の2つのまとまりに分けて渡す（2026-11-03。元本の返済を損失と混ぜさせないため）
 */
export function financialsForPrompt(f: FinancialsInput = TSUGUMI_FINANCIALS): string {
  const s = getFinancialSummary(f);
  const lines = [
    periodNames(f).userInput
      ? `資料：${s.source}（単位：万円。前期・当期の2期分。決算期の年月は入力されていない）`
      : `資料：${s.source}（単位：万円。前期＝2025年3月期、当期＝2026年3月期）`,
  ];
  const line = (r: FinancialRow) =>
    `- ${r.label}：前期 ${r.previous}／当期 ${r.current}${r.note ? `（${r.note}）` : ""}`;
  lines.push(`## ${PROFIT_AND_LOSS_TITLE}`);
  for (const r of s.rows) if (PL_ROW_LABELS.has(r.label)) lines.push(line(r));
  lines.push(`## ${CASH_MOVEMENT_TITLE}`);
  for (const r of s.rows) if (!PL_ROW_LABELS.has(r.label)) lines.push(line(r));
  lines.push(`- 計算式：${s.cashMovement.formula}`);
  lines.push(`- 当期の内訳：${s.cashMovement.breakdownText}`);
  lines.push(`- ${s.cashMovement.cashChangeText}`);
  lines.push(`注記：${s.principalNote}`);
  return lines.join("\n");
}
