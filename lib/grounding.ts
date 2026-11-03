// AI が作った数字・発言を見つける仕組み（外部評価の指摘への対応。オーナー承認 2026-11-03）。
// 画面からも import してよい（server-only は付けない。DB・秘密情報は使わない純粋な関数だけ）。
//
// - 数字の照合（findUngroundedNumbers）：AI の文から単位つきの数字を取り出し、根拠の集合に無いものを返す
//   根拠＝アプリが計算した数字（lib/financials.ts）・共有済み要約の本文・出典の文（cited_text）など。呼び出し側が集める
// - 発言の照合（findUnsupportedQuotes）：診断の「先代／後継者が話したこと」「共通点の根拠」が、
//   その人の共有済み要約の文と十分に重なるかを、文字の 2-gram の重なり率で確かめる
// - 見つかっても AI の文は変えない。結果（Grounding）を出力に付け、画面は groundingNotice の決まった文を出す
// - これは「誤りの疑い」を拾う念のための確認で、すべての作り話を見つけるものではない（誤検知もありうる）
// - ログ（logGrounding）には種類と件数だけを出す（本文・数字そのものは出さない）

import type { Grounding } from "./plan-types";
import {
  computePeriod,
  getFinancialSummary,
  getUpsideSummary,
  round1,
  upsideForPrompt,
  UPSIDE_ASSUMPTIONS,
  type FinancialsInput,
  type UpsideInput,
} from "./financials";
import type { PeriodInput } from "./settings-types";

export type { Grounding };

/** 決まった注記の前置き（後ろに見つかった数字・発言を「、」でつなぐ） */
export const GROUNDING_NOTICE_PREFIX = "根拠を確認できない数字・発言があります。元の資料や本人に確かめてください：";

/** 発言の照合のしきい値：発言の 2-gram のうち、この割合以上が要約に出てくれば「重なる」とみなす */
export const QUOTE_OVERLAP_MIN = 0.5;

/** 注記・ログに出す件数の上限（長くなりすぎないように） */
export const GROUNDING_ITEMS_MAX = 10;
const ITEM_MAX_CHARS = 120;

// ---- 数字の取り出し ----

type Category = "yen" | "rate" | "month" | "year" | "count" | "times" | "group" | "meal" | "person" | "age";

/** 単位 → 種類と倍率（円は円に、万円・億円も円にそろえて比べる） */
const UNITS: Record<string, { cat: Category; mul: number }> = {
  億円: { cat: "yen", mul: 1e8 },
  万円: { cat: "yen", mul: 1e4 },
  千円: { cat: "yen", mul: 1e3 },
  円: { cat: "yen", mul: 1 },
  "%": { cat: "rate", mul: 1 },
  パーセント: { cat: "rate", mul: 1 },
  // 比率の差（「+2.0ポイント」）と % は同じ物差しで比べる（書き分けの違いで誤検知しないため）
  ポイント: { cat: "rate", mul: 1 },
  か月: { cat: "month", mul: 1 },
  ヶ月: { cat: "month", mul: 1 },
  カ月: { cat: "month", mul: 1 },
  ケ月: { cat: "month", mul: 1 },
  ヵ月: { cat: "month", mul: 1 },
  箇月: { cat: "month", mul: 1 },
  年: { cat: "year", mul: 1 },
  件: { cat: "count", mul: 1 },
  回: { cat: "times", mul: 1 },
  組: { cat: "group", mul: 1 },
  食: { cat: "meal", mul: 1 },
  人: { cat: "person", mul: 1 },
  名: { cat: "person", mul: 1 },
  歳: { cat: "age", mul: 1 },
};
const UNIT_ALT = Object.keys(UNITS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
/** 「約」「▲」「−」「+」などの前置き（いくつでも）＋数字（範囲「2〜3」も可）＋単位 */
const NUMBER_RE = new RegExp(
  String.raw`(?<![\d.,A-Za-z])((?:約|およそ|▲|△|-|−|\+)*)\s*(${NUM})(?:\s*[〜~\-–]\s*(${NUM}))?\s*(${UNIT_ALT})`,
  "gu",
);
/** 和暦の年（「令和7年」）は日付として除く */
const ERA_BEFORE = /(?:令和|平成|昭和|大正|明治)\s*$/u;

/** 取り出した数字（value は単位をそろえた値の絶対値。step は書かれた桁の細かさ＝四捨五入の幅） */
export type ExtractedNumber = { surface: string; cat: Category; value: number; step: number };

function normalizeText(text: string): string {
  // 全角の数字・記号（％・，・．・～）を半角にそろえる
  return text.normalize("NFKC");
}

function parseNum(raw: string, approx: boolean, mul: number): { value: number; step: number } {
  const plain = raw.replace(/,/g, "");
  const value = Math.abs(Number(plain)) * mul;
  const dot = plain.indexOf(".");
  let step = dot >= 0 ? Math.pow(10, -(plain.length - dot - 1)) : 1;
  // 「約800万円」は 808 を丸めた書き方なので、末尾の 0 の桁まで丸めとみなす（「約」が付いたときだけ）
  if (approx && dot < 0) {
    const zeros = /0+$/.exec(plain)?.[0].length ?? 0;
    if (zeros > 0 && zeros < plain.length) step = Math.pow(10, zeros);
  }
  return { value, step: step * mul };
}

/** 日付や決まった数字として照合の対象から外すか */
function isExcluded(n: { cat: Category; value: number; step: number }, before: string): boolean {
  if (n.cat === "year") {
    // 西暦（2026年など）と和暦は日付
    if (n.value >= 1900 && n.value <= 2100) return true;
    if (ERA_BEFORE.test(before)) return true;
  }
  return false;
}

/** 決まった数字（いつ書いてもよいもの。90日計画の「3か月」、月商の「12か月」、「1年分」、「100%」など） */
const ALWAYS_ALLOWED: ExtractedNumber[] = [
  ...[1, 2, 3, 6, 12].map((v) => ({ surface: `${v}か月`, cat: "month" as const, value: v, step: 0 })),
  { surface: "1年", cat: "year", value: 1, step: 0 },
  { surface: "100%", cat: "rate", value: 100, step: 0 },
  { surface: "1回", cat: "times", value: 1, step: 0 },
];

/**
 * 文から単位つきの数字を取り出す（万円・％・か月・年・円・件・回・組・食・人など）。
 * 「約」「▲」「−」、全角の数字、3桁区切りのカンマ、範囲（「2〜3件」は2つ）に対応。日付（2026年・令和7年）は除く。
 * 「90日」「1〜30日」「3月期」のように 日・月 だけの数字は単位の対象外なので取り出さない
 */
export function extractNumbers(text: string): ExtractedNumber[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const t = normalizeText(text);
  const out: ExtractedNumber[] = [];
  for (const m of t.matchAll(NUMBER_RE)) {
    const prefix = m[1] ?? "";
    const unit = UNITS[m[4]];
    if (!unit) continue;
    const approx = /約|およそ/u.test(prefix);
    const before = t.slice(0, m.index ?? 0);
    const surface = m[0].replace(/\s+/g, "");
    for (const raw of [m[2], m[3]]) {
      if (!raw) continue;
      const { value, step } = parseNum(raw, approx, unit.mul);
      const n = { surface, cat: unit.cat, value, step };
      if (!isExcluded(n, before)) out.push(n);
    }
  }
  return out;
}

// ---- 根拠の集合 ----

const KEY_RE = /^#(yen|rate|month|year|count|times|group|meal|person|age)\|([0-9.eE+-]+)\|([0-9.eE+-]+)$/;

/** 計算した数値を根拠の集合に入れる形（キーの文字列）にする。step 0 は「丸める前の正確な値」 */
export function numberKey(cat: Category, value: number, step = 0): string {
  return `#${cat}|${Math.abs(value)}|${step}`;
}

/** 根拠の集合の1件を読む：numberKey の形ならそれ、それ以外は文として数字を取り出す */
function parseAllowed(entry: string): ExtractedNumber[] {
  const k = KEY_RE.exec(entry);
  if (k) return [{ surface: entry, cat: k[1] as Category, value: Number(k[2]), step: Number(k[3]) }];
  return extractNumbers(entry);
}

/** 四捨五入による差を許して同じ数字か（書かれた桁の細かい方ではなく、粗い方の半分まで） */
function sameNumber(a: ExtractedNumber, b: ExtractedNumber): boolean {
  if (a.cat !== b.cat) return false;
  const tol = Math.max(a.step, b.step) / 2;
  return Math.abs(a.value - b.value) <= tol + 1e-9 * Math.max(1, Math.abs(a.value));
}

/**
 * AI の文のうち、根拠の集合に無い数字を返す（書かれていた形のまま。重複なし）。
 * allowed は文（例：「▲236万円」「共有済み要約の本文」）か numberKey の形の文字列の集合。
 * 四捨五入による差（1.8 と 1.79、236 と 235.6）は許す。符号（▲・−）の違いは見ない（「236万円の赤字」と書くことがあるため）
 */
export function findUngroundedNumbers(text: string, allowed: Set<string>): string[] {
  const found = extractNumbers(text);
  if (found.length === 0) return [];
  const pool: ExtractedNumber[] = [...ALWAYS_ALLOWED];
  for (const e of allowed) pool.push(...parseAllowed(e));
  const out: string[] = [];
  for (const n of found) {
    if (pool.some((p) => sameNumber(n, p))) continue;
    if (!out.includes(n.surface)) out.push(n.surface);
  }
  return out;
}

/** 文の集まりと数値のキーから根拠の集合を作る */
export function allowedSet(...parts: (readonly string[] | Set<string>)[]): Set<string> {
  const s = new Set<string>();
  for (const p of parts) for (const x of p) if (typeof x === "string" && x) s.add(x);
  return s;
}

/** 1期分の数字（入力と計算値）を根拠に入れる */
function periodKeys(p: PeriodInput): string[] {
  const c = computePeriod(p);
  const money = [
    p.sales,
    p.cogs,
    p.labor,
    p.otherSga,
    p.interest,
    p.netIncome,
    p.cash,
    p.debt,
    p.principalRepayment,
    p.depreciation,
    p.principalRepayment / 12,
    c.grossProfit,
    c.operatingProfit,
    c.ordinaryProfit,
    c.monthlySales,
    c.cashFlow,
    p.labor + p.otherSga,
    p.cogs + p.labor,
  ];
  const rates = [c.costRate, c.laborRate, c.flRate, c.operatingMargin];
  return [
    // 万円単位（正確な値と、小数第1位に丸めた値の両方）
    ...money.flatMap((v) => [numberKey("yen", v * 1e4), numberKey("yen", round1(v) * 1e4)]),
    // 比率（小数第1位に丸めた値と正確な値）
    ...rates.flatMap((v) => [numberKey("rate", v), numberKey("rate", round1(v))]),
    numberKey("month", c.cashMonths),
    numberKey("month", round1(c.cashMonths)),
  ];
}

/**
 * アプリが計算したお店の数字（financials）と伸びる余地（upside）の全項目を根拠の集合に入れる。
 * 表示用の文字列（表の行・注記・試算の文）と数値（万円単位・比率の小数第1位）の両方。前期との差も入れる
 */
export function financialAllowedNumbers(f: FinancialsInput, upside?: UpsideInput | null): string[] {
  const sum = getFinancialSummary(f);
  const texts: string[] = [];
  for (const r of [...sum.rows, ...sum.profitAndLoss.rows, ...sum.cashMovement.rows]) {
    texts.push(r.previous, r.current, r.note ?? "");
  }
  texts.push(sum.cashMovement.breakdownText, sum.cashMovement.cashChangeText);
  const p = f.previous;
  const c = f.current;
  const pc = computePeriod(p);
  const cc = computePeriod(c);
  const diffs = [
    c.sales - p.sales,
    c.cogs - p.cogs,
    c.labor - p.labor,
    c.otherSga - p.otherSga,
    c.interest - p.interest,
    c.netIncome - p.netIncome,
    c.cash - p.cash,
    c.debt - p.debt,
    c.principalRepayment - p.principalRepayment,
    c.depreciation - p.depreciation,
    cc.grossProfit - pc.grossProfit,
    cc.operatingProfit - pc.operatingProfit,
    cc.ordinaryProfit - pc.ordinaryProfit,
    cc.monthlySales - pc.monthlySales,
  ].flatMap((v) => [numberKey("yen", v * 1e4), numberKey("yen", round1(v) * 1e4)]);
  const rateDiffs = [
    cc.costRate - pc.costRate,
    cc.laborRate - pc.laborRate,
    cc.flRate - pc.flRate,
    cc.operatingMargin - pc.operatingMargin,
  ].flatMap((v) => [numberKey("rate", v), numberKey("rate", round1(v))]);
  const keys = [...periodKeys(p), ...periodKeys(c), ...diffs, ...rateDiffs];
  if (upside) {
    const u = getUpsideSummary(upside);
    const prompt = upsideForPrompt(upside);
    if (u) {
      for (const i of u.items) texts.push(i.assumption, i.effectText);
      texts.push(u.totalText, u.operatingProfitBeforeText, u.operatingProfitAfterText);
      keys.push(
        ...[...u.items.map((i) => i.effect), u.total, u.operatingProfitBefore, u.operatingProfitAfter].map((v) =>
          numberKey("yen", v * 1e4),
        ),
      );
      const a = UPSIDE_ASSUMPTIONS;
      keys.push(
        numberKey("rate", a.targetCostRate),
        numberKey("rate", a.targetLaborRate),
        numberKey("rate", a.banquetCostRate),
        numberKey("yen", a.lunchPriceUpYen),
        numberKey("meal", a.lunchMealsPerYear),
        numberKey("group", a.banquetExtraGroups),
        numberKey("yen", a.banquetPricePerGroup * 1e4),
      );
    }
    if (prompt) texts.push(prompt);
  }
  return [...texts.filter(Boolean), ...keys];
}

// ---- 発言の照合 ----

/** 発言の枠の言葉（「先代は」「二人とも」など）。重なり率を計算する前に除く */
const FRAME_WORDS = /先代|後継者|二人とも|二人|両者|両方|ともに|本人|要約|発言|回答|共有/gu;
const PUNCT = /[\s「」『』（）()［］\[\]、。，．,.!！?？・…〜~：:；;"'“”‘’]/gu;
const HIRAGANA = /^[ぁ-ゟ]+$/u;
/** 「話に出ていない」「言及なし」など、何も話していないことを示す短い文は照合しない */
const NO_MENTION = /(?:言及|触れ|話して|話に出て|記載|出てい)[^。]{0,4}(?:ない|なし|ありません|いません)|^(?:なし|特になし|不明|—|-)$/u;

function bigrams(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

function quoteText(text: string): string {
  return normalizeText(text).replace(FRAME_WORDS, "").replace(PUNCT, "");
}

/**
 * 発言が、根拠の文と十分に重なるか（重なり率 0〜1）。照合しない文（短い・「話していない」など）は null。
 * ひらがなだけの 2-gram（「ている」「ます」など）は、内容の言葉が1つでもあれば数えない（たまたま重なるのを避ける）
 */
export function quoteOverlap(quote: string, sources: readonly string[]): number | null {
  if (typeof quote !== "string") return null;
  const raw = normalizeText(quote).trim();
  if (raw.length === 0 || NO_MENTION.test(raw)) return null;
  const q = quoteText(raw);
  const all = [...new Set(bigrams(q))];
  if (all.length === 0) return null;
  const content = all.filter((b) => !HIRAGANA.test(b));
  const target = content.length >= 2 ? content : all;
  const src = new Set(sources.flatMap((s) => bigrams(quoteText(s))));
  const hit = target.filter((b) => src.has(b)).length;
  return hit / target.length;
}

/** 重なりが QUOTE_OVERLAP_MIN 未満の発言を返す（元の文のまま。重複なし） */
export function findUnsupportedQuotes(items: readonly { quote: string; sources: readonly string[] }[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const r = quoteOverlap(it.quote, it.sources);
    if (r === null || r >= QUOTE_OVERLAP_MIN) continue;
    const q = it.quote.trim();
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

// ---- 結果のまとめ ----

function cap(list: string[]): string[] {
  return list.slice(0, GROUNDING_ITEMS_MAX).map((s) => Array.from(s).slice(0, ITEM_MAX_CHARS).join(""));
}

/** 複数の文の数字をまとめて照合し、発言の照合結果と合わせる。どちらも無ければ undefined（出力に付けない） */
export function groundingFor(
  texts: readonly string[],
  allowed: Set<string> | null,
  unsupportedQuotes: string[] = [],
): Grounding | undefined {
  const numbers: string[] = [];
  if (allowed) {
    for (const t of texts) for (const n of findUngroundedNumbers(t, allowed)) if (!numbers.includes(n)) numbers.push(n);
  }
  if (numbers.length === 0 && unsupportedQuotes.length === 0) return undefined;
  return { ungroundedNumbers: cap(numbers), unsupportedQuotes: cap(unsupportedQuotes) };
}

/** 保存した照合結果を読み直す（形の正しいものだけ。無い・空なら undefined） */
export function sanitizeGrounding(v: unknown): Grounding | undefined {
  if (v === null || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? cap(x.filter((s): s is string => typeof s === "string" && s.length > 0)) : []);
  const g = { ungroundedNumbers: list(o.ungroundedNumbers), unsupportedQuotes: list(o.unsupportedQuotes) };
  return g.ungroundedNumbers.length + g.unsupportedQuotes.length > 0 ? g : undefined;
}

/**
 * 画面に出す決まった注記（例：「根拠を確認できない数字・発言があります。元の資料や本人に確かめてください：35万円、「店を売るつもりだ」」）。
 * 何も無ければ null
 */
export function groundingNotice(g: Grounding | undefined | null): string | null {
  if (!g) return null;
  const items = [...g.ungroundedNumbers, ...g.unsupportedQuotes.map((q) => `「${q}」`)];
  if (items.length === 0) return null;
  return `${GROUNDING_NOTICE_PREFIX}${items.join("、")}`;
}

/** ログには種類と件数だけを出す（本文・数字は出さない）。where はログの出どころ */
export function logGrounding(where: string, g: Grounding | undefined): void {
  if (!g) return;
  console.warn(
    JSON.stringify({
      level: "warn",
      where,
      event: "ungrounded_output",
      numbers: g.ungroundedNumbers.length,
      quotes: g.unsupportedQuotes.length,
    }),
  );
}
