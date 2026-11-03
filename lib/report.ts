import "server-only";

// 決算サマリー・銀行への相談用資料（POST /api/report、getReport）。Next.js に依存しない（テストから呼べる）。
//
// 守ること（CLAUDE.md「必ず守る動作」・オーナー指示 2026-11-03）：
// - AI への入力は次の5つだけ：お店の数字（financialsForPrompt）／試算（upsideForPrompt）／
//   公開用に変換した保存済みの診断（getDiagnosisFrom → toPublicDiagnosisRecord）／
//   90日計画の行動（文・担当・期限・状態だけ）／お店の概要（会社の設定。初期値は COMPANY_CONTEXT）。
//   決算の数字・会社名・業種・概要は会社の設定（lib/company-settings.ts）から。飲食店以外は試算（改善策あり案）を出さない
//   面談の要約・会話、AI参謀の会話、学習プラン（理由・希望を含む）は DB からも読まない（SEC-104）
// - 数字はすべてアプリが計算する。保存するのは AI の文だけで、数字の欄は表示のたびに lib/financials.ts から作る
//   （AI の出力で数字が上書きされることは無い）
// - 資料は作成時の診断（diagnosis_created_at）と結びつける（SEC-102 と同じ）。共有の取り消しでは
//   invalidateDiagnosisStatements が同じトランザクションで reports も消す（SEC-101）。読み出し側でも今の診断と照合し、
//   違えば返さずに消す
// - AI の呼び出しは callJsonAi（reserveAiCall で回数を予約。壊れた返事・一時エラーは1回だけ再送）
// - すべて demo_id で絞る。値はプレースホルダで渡す。入力本文・AI の返事はログに出さない
//
// 文の編集（PUT /api/report・updateReport。オーナー依頼 2026-11-03）：
// - 直せるのは AI が書いた文（ReportAiParts）だけ。数字の表・固定文は保存しないので、編集しても表は変わらない
// - 検証は AI の出力と同じ上限（REPORT_LIMITS）。ただし AI の出力は切り詰めるが、編集は切り詰めずに 400（どの欄かを field で返す）。
//   使えない文字は lib/validation.ts の validateText に合わせる。最後に parseReportAi も通す
// - 保存の条件：作成時の診断が今の診断と同じ／送られた updatedAt が今の updated_at と同じ／設定の rev が読んだときと同じ。
//   どれかが違えば 409（上書きしない）
// - 書き換えの回数は plan_edit_usage（90日計画・設定の書き換えと同じ枠・1日300回）で数える
// - 編集した日時は content の JSON の edited_at に入れる（表の列は増やさない）。言い切りの注記は表示のたびに今の文から作り直す
// - 資料を作り直す（createReport）と content を AI の新しい出力で丸ごと置き換えるので、編集した文と edited_at は消える

import type { Client } from "@libsql/client";
import {
  REPORT_LIMITS,
  type ReportAiParts,
  type ReportNumberRow,
  type ReportNumberTable,
  type ReportPoint,
  type ReportState,
} from "./report-types";
import type { PlanAction } from "./plan-types";
import { ServiceError } from "./errors";
import { getDb } from "./db";
import {
  computePeriod,
  financialsForPrompt,
  formatMan,
  formatManSigned,
  getFinancialSummary,
  getUpsideSummary,
  periodNames,
  round1,
  upsideForPrompt,
  type FinancialsInput,
} from "./financials";
import type { CompanySettings } from "./settings-types";
import { TSUGUMI_SETTINGS } from "./industry-presets";
import { loadCompanySettings, MSG_SETTINGS_CHANGED, settingsRevCondition } from "./company-settings";
import { companyContextFor, industryTextFor, isTsugumi } from "./settings-prompt";
import { getDiagnosisFrom, toPublicDiagnosisRecord } from "./diagnosis";
import { byDue, getActionPlanFrom, PHASE_LABEL } from "./action-plan";
import { REPORT_SYSTEM } from "./prompts/report";
import { arr, callJsonAi, dataBlock, DATA_NOTE, obj, str, type AiDeps, type JsonAiRequest } from "./ai/json-ai";
import { ASSERTIVE_CAUTION, cautionFor, findAssertiveClaims } from "./assertive";
import { jstDateTime, jstToday, nowIso } from "./util";
import { validateText } from "./validation";
import { PLAN_EDITS_DAILY_LIMIT } from "./action-plan";
import { usageDayKey } from "./ai/usage";
import type { Role } from "./role";

export const MSG_REPORT_NEED_DIAGNOSIS = "先に認識差の診断を行ってください（資料は診断の結果をもとに作ります）";
export const MSG_REPORT_CHANGED = "診断が変わりました。もう一度資料を作ってください";
export const REPORT_MAX_TOKENS = 4000;

export const COMPANY_NAME = "食事処 つぐみ（架空）";
export const INDUSTRY = "飲食業（和食の食事処）";
export const DRAFT_NOTICE = "この資料は下書きです。本人が内容を確認・修正してから使ってください。AI が書いた文には誤りが含まれることがあります。";
export const MSG_NO_ACTION_PLAN = "90日計画を作るとここに入ります";

export const MSG_REPORT_NOT_FOUND = "資料が見つかりません。画面を読み込み直してください";
export const MSG_REPORT_EDIT_CONFLICT =
  "ほかの操作で資料が保存されました。画面を読み込み直してから、もう一度直してください（今の編集は保存されていません）";
export const MSG_REPORT_EDIT_LIMIT = `資料・設定・90日計画の書き換えは合わせて1日${PLAN_EDITS_DAILY_LIMIT}回までです。日本時間の朝9時に回数が戻ります`;
export const MSG_REPORT_EDIT_INVALID = "資料の文の形式が正しくありません。画面を読み込み直してください";

// 上限は画面と共通（lib/report-types.ts の REPORT_LIMITS）
const COMMENT_MAX = REPORT_LIMITS.commentMax;
const POINT_MAX = REPORT_LIMITS.itemMax;
const POINTS_MIN = REPORT_LIMITS.pointsMin;
const POINTS_MAX = REPORT_LIMITS.pointsMax;
const VIEWPOINTS_MAX = REPORT_LIMITS.viewpointsMax;
const CONSULT_MAX = REPORT_LIMITS.consultMax;
const PURPOSE_MAX = REPORT_LIMITS.purposeMax;
const QUESTIONS_MIN = REPORT_LIMITS.questionsMin;
const QUESTIONS_MAX = REPORT_LIMITS.questionsMax;

// 列の見出し・資料名は数字から決める（つぐみの数字なら「前期（2025年3月期）」、利用者入力なら「前期」。lib/financials.ts の periodNames）

// ---- AI の出力（保存するのはこれだけ） ----

// 形は lib/report-types.ts（画面の編集欄と共通）
export type { ReportAiParts };

const s = { type: "string" } as const;
const STR_LIST = { type: "array", items: s } as const;
const POINT_LIST = {
  type: "array",
  items: {
    type: "object",
    properties: { text: s, basis: s },
    required: ["text", "basis"],
    additionalProperties: false,
  },
} as const;

export const REPORT_SCHEMA = {
  type: "object",
  properties: {
    results_comment: s,
    financial_comment: s,
    strengths: POINT_LIST,
    issues: POINT_LIST,
    outlook_viewpoints: STR_LIST,
    consult: {
      type: "object",
      properties: { bank: STR_LIST, tax: STR_LIST, other: STR_LIST },
      required: ["bank", "tax", "other"],
      additionalProperties: false,
    },
    bank_doc: {
      type: "object",
      properties: { purpose: s, questions: STR_LIST },
      required: ["purpose", "questions"],
      additionalProperties: false,
    },
  },
  required: ["results_comment", "financial_comment", "strengths", "issues", "outlook_viewpoints", "consult", "bank_doc"],
  additionalProperties: false,
} as const;

function strList(raw: unknown, max: number, itemMax = POINT_MAX): string[] {
  return arr(raw)
    .map((x) => str(x, itemMax))
    .filter((x): x is string => !!x)
    .slice(0, max);
}

function pointList(raw: unknown): ReportPoint[] {
  const out: ReportPoint[] = [];
  for (const x of arr(raw)) {
    const o = obj(x);
    const text = str(o?.text, POINT_MAX);
    if (!text) continue;
    out.push({ text, basis: str(o?.basis, POINT_MAX) ?? "" });
    if (out.length >= POINTS_MAX) break;
  }
  return out;
}

/**
 * AI の出力を検証する（決まった項目だけに組み直す。それ以外の項目は持ち出さない）。
 * 必須：説明2つ、強み・課題 各1件以上、銀行・専門家の相談 各1件以上、相談内容、質問2件以上。足りなければ null（再送の対象）
 */
export function parseReportAi(v: Record<string, unknown>): ReportAiParts | null {
  const results_comment = str(v.results_comment, COMMENT_MAX);
  const financial_comment = str(v.financial_comment, COMMENT_MAX);
  const strengths = pointList(v.strengths);
  const issues = pointList(v.issues);
  const consultRaw = obj(v.consult);
  const bankRaw = obj(v.bank_doc);
  if (!results_comment || !financial_comment || !consultRaw || !bankRaw) return null;
  if (strengths.length < POINTS_MIN || issues.length < POINTS_MIN) return null;
  const consult = {
    bank: strList(consultRaw.bank, CONSULT_MAX),
    tax: strList(consultRaw.tax, CONSULT_MAX),
    other: strList(consultRaw.other, CONSULT_MAX),
  };
  if (consult.bank.length === 0 || consult.tax.length === 0) return null;
  const purpose = str(bankRaw.purpose, PURPOSE_MAX);
  const questions = strList(bankRaw.questions, QUESTIONS_MAX);
  if (!purpose || questions.length < QUESTIONS_MIN) return null;
  return {
    results_comment,
    financial_comment,
    strengths,
    issues,
    outlook_viewpoints: strList(v.outlook_viewpoints, VIEWPOINTS_MAX),
    consult,
    bank_doc: { purpose, questions },
  };
}

// ---- アプリが作る部分（数字・固定文） ----

/** getFinancialSummary() の行をラベルで取り出す（数字は必ずここから。AI の値は使わない） */
function pickRows(fin: FinancialsInput, labels: string[], changes: Record<string, string> = {}): ReportNumberRow[] {
  const all = getFinancialSummary(fin).rows;
  return labels.map((label) => {
    const r = all.find((x) => x.label === label);
    if (!r) throw new Error(`financial row missing: ${label}`);
    const row: ReportNumberRow = { label: r.label, previous: r.previous, current: r.current };
    if (changes[label] !== undefined) row.change = changes[label];
    if (r.note) row.note = r.note;
    return row;
  });
}

function table(fin: FinancialsInput, rows: ReportNumberRow[]): ReportNumberTable {
  const n = periodNames(fin);
  return { source: n.source, columns: { previous: n.previous, current: n.current }, rows };
}

/** 前期との差（金額は万円、比率はポイント） */
function changes(fin: FinancialsInput) {
  const p = fin.previous;
  const c = fin.current;
  const pc = computePeriod(p);
  const cc = computePeriod(c);
  const man = (a: number, b: number) => formatManSigned(b - a);
  const pt = (a: number, b: number) => {
    const d = round1(b - a);
    return `${d > 0 ? "+" : d < 0 ? "▲" : ""}${Math.abs(d).toFixed(1)}ポイント`;
  };
  return {
    売上高: man(p.sales, c.sales),
    粗利: man(pc.grossProfit, cc.grossProfit),
    営業利益: man(pc.operatingProfit, cc.operatingProfit),
    経常利益: man(pc.ordinaryProfit, cc.ordinaryProfit),
    当期純利益: man(p.netIncome, c.netIncome),
    "手元資金（期末）": man(p.cash, c.cash),
    "借入残高（期末）": man(p.debt, c.debt),
    "年間返済額（元本）": man(p.principalRepayment, c.principalRepayment),
    支払利息: man(p.interest, c.interest),
    原価率: pt(pc.costRate, cc.costRate),
    人件費率: pt(pc.laborRate, cc.laborRate),
    FL比率: pt(pc.flRate, cc.flRate),
    営業利益率: pt(pc.operatingMargin, cc.operatingMargin),
  } as Record<string, string>;
}

const RESULT_LABELS = ["売上高", "粗利", "営業利益", "経常利益", "当期純利益"];
const FINANCIAL_LABELS = [
  "手元資金（期末）",
  "手元資金は月商の何か月分",
  "借入残高（期末）",
  "年間返済額（元本）",
  "当期の現金の動き",
  "原価率",
  "人件費率",
  "FL比率",
  "営業利益率",
];
const BANK_LABELS = [
  "売上高",
  "営業利益",
  "経常利益",
  "手元資金（期末）",
  "手元資金は月商の何か月分",
  "借入残高（期末）",
  "年間返済額（元本）",
  "当期の現金の動き",
];

/** 資料の AI の文をすべて並べる（言い切りの確認用） */
export function reportAiTexts(ai: ReportAiParts): string[] {
  return [
    ai.results_comment,
    ai.financial_comment,
    ...ai.strengths.flatMap((p) => [p.text, p.basis]),
    ...ai.issues.flatMap((p) => [p.text, p.basis]),
    ...ai.outlook_viewpoints,
    ...ai.consult.bank,
    ...ai.consult.tax,
    ...ai.consult.other,
    ai.bank_doc.purpose,
    ...ai.bank_doc.questions,
  ];
}

function reportHasAssertive(ai: ReportAiParts): boolean {
  return reportAiTexts(ai).some((t) => findAssertiveClaims(t).length > 0);
}

/** 保存済みの AI の文と、今の数字・90日計画から、画面にそのまま出せる形を組み立てる */
export function buildReportState(
  ai: ReportAiParts,
  meta: { createdAt: string; updatedAt: string; editedAt?: string; diagnosisCreatedAt: string; actions: PlanAction[] },
  /** 会社の設定（省略時はつぐみの初期値）。会社名・業種・概要・決算の数字・伸びる余地を出すか */
  settings: CompanySettings = TSUGUMI_SETTINGS,
): ReportState {
  const fin = settings.financials;
  const names = periodNames(fin);
  const ch = changes(fin);
  // 飲食店以外は null（改善策あり案を出さない。現状維持案だけ）
  const up = getUpsideSummary(settings);
  const createdDate = jstToday(new Date(meta.createdAt));
  const hasPlan = meta.actions.length > 0;
  const sources = [
    `${names.source}（単位：万円）`,
    `認識差の診断（${jstDateTime(meta.diagnosisCreatedAt)} 作成。二人とも共有したテーマから作成）`,
  ];
  if (up) sources.push("改善策の試算（当期の数字から計算した仮定。実現を保証しない）");
  if (hasPlan) sources.push("二人の90日計画");
  const def = isTsugumi(settings);
  const companyName = def ? COMPANY_NAME : settings.company.name;

  const pick = (labels: string[]) => pickRows(fin, labels, ch);
  const indicator = (labels: string[]) => pick(labels);
  // 今の営業利益（現状維持案）。伸びる余地が無い業種でもここで計算する
  const opBefore = round1(computePeriod(fin.current).operatingProfit);
  const statusQuoBasis = `${names.current}の営業利益がそのまま続くと仮定（${names.source}）`;
  const pendingNote = "要確認：この版では外部の統計データは扱っていません。自店の数字で見るべき指標だけを示します。";

  // 言い切りに見える表現の確認（SEC-302）。表示のたびに保存済みの AI の文から決める（ログは作成時だけ）
  const caution = reportHasAssertive(ai) ? ASSERTIVE_CAUTION : undefined;

  return {
    isDraft: true,
    draftNotice: caution ? `${DRAFT_NOTICE}${caution}。` : DRAFT_NOTICE,
    ...(caution ? { caution } : {}),
    createdAt: meta.createdAt,
    basedOnDiagnosisAt: meta.diagnosisCreatedAt,
    updatedAt: meta.updatedAt,
    ...(meta.editedAt ? { editedAt: meta.editedAt } : {}),
    // 編集欄の初期値（表示用の欄と同じ配列を共有しないよう複製する）
    editable: structuredClone(ai),
    summary: {
      title: "決算サマリー（下書き）",
      basic: {
        no: 1,
        title: "基本情報",
        by: "app",
        companyName,
        industry: def ? INDUSTRY : industryTextFor(settings),
        overview: settings.company.overview,
        period: names.userInput ? "当期（比較：前期）" : "2026年3月期（比較：2025年3月期）",
        createdDate,
        sources,
      },
      results: { no: 2, title: "決算の要点", by: "app+ai", table: table(fin, pick(RESULT_LABELS)), comment: ai.results_comment },
      financial: {
        no: 3,
        title: "財務の状態",
        by: "app+ai",
        table: table(fin, pick(FINANCIAL_LABELS)),
        comment: ai.financial_comment,
      },
      strengthsAndIssues: {
        no: 4,
        title: "強みと課題",
        by: "ai",
        strengths: ai.strengths,
        issues: ai.issues,
        basisNote: "材料：二人とも共有したテーマから作った認識差の診断と、決算書（架空）の数字。AI が整理した下書きです。",
      },
      external: {
        no: 5,
        title: "外部環境の影響",
        by: "app",
        topics: [
          { theme: "物価高", status: "要確認", note: pendingNote, officialSource: null, indicators: indicator(["原価率"]) },
          { theme: "人件費（最低賃金）", status: "要確認", note: pendingNote, officialSource: null, indicators: indicator(["人件費率"]) },
          {
            theme: "金利",
            status: "要確認",
            note: pendingNote,
            officialSource: null,
            indicators: indicator(["支払利息", "借入残高（期末）", "年間返済額（元本）"]),
          },
        ],
        source: `自社の指標：${names.source}`,
      },
      outlook: {
        no: 6,
        title: "今後の展望",
        by: "app+ai",
        forecastLabel: "予測（試算）です。実現を保証するものではありません。",
        scenarios: {
          status_quo: {
            name: "現状維持案",
            operatingProfit: up ? up.operatingProfitBefore : opBefore,
            operatingProfitText: up ? up.operatingProfitBeforeText : formatMan(opBefore),
            basis: statusQuoBasis,
          },
          ...(up
            ? {
                improved: {
                  name: "改善策あり案" as const,
                  operatingProfit: up.operatingProfitAfter,
                  operatingProfitText: up.operatingProfitAfterText,
                  totalEffectText: up.totalText,
                  items: up.items,
                  basis: `当期の営業利益 ${up.operatingProfitBeforeText} に、${up.items.length}つの改善策の効果の合計 ${up.totalText} を足した試算`,
                },
              }
            : {}),
        },
        assumptions: up
          ? [
              `${names.current}の数字をもとに、1年分の効果を計算しています。`,
              ...up.items.map((i) => `${i.title}：${i.assumption}（効果 ${i.effectText}）`),
              `${up.items.length}つの改善策をすべて実施し、ほかの条件（客数・物価・金利など）は変わらないと仮定しています。`,
              ...(up.exampleNote ? [`${up.exampleNote}（この会社の実績ではありません）。`] : []),
              up.note,
            ]
          : [
              `${names.current}の営業利益がそのまま続くと仮定しています。ほかの条件（売上・物価・金利など）は変わらないと仮定しています。`,
              "この業種では改善策の試算（改善策あり案）は用意していません。",
              "試算は仮定にもとづくもので、実現を保証しない。",
            ],
        viewpoints: ai.outlook_viewpoints,
      },
      actions: {
        no: 7,
        title: "対策と優先順位",
        by: "app",
        items: [...meta.actions]
          .sort(byDue)
          .map((a) => ({ title: a.title, owner: a.owner, due: a.due, phaseLabel: PHASE_LABEL[a.phase], status: a.status })),
        emptyMessage: hasPlan ? null : MSG_NO_ACTION_PLAN,
        source: hasPlan ? "二人の90日計画（期限の早い順）" : "90日計画（未作成）",
      },
      consult: {
        no: 8,
        title: "相談事項",
        by: "ai",
        bank: ai.consult.bank,
        tax: ai.consult.tax,
        other: ai.consult.other,
        note: "融資の可否・条件、税金・法律、会社の値段についての結論は、この資料では出していません。銀行・税理士などの専門家に確認してください。",
      },
    },
    bankDoc: {
      title: "銀行への相談用資料（下書き）",
      isDraft: true,
      createdDate,
      companyName,
      purpose: ai.bank_doc.purpose,
      numbers: table(fin, pick(BANK_LABELS)),
      questions: ai.bank_doc.questions,
      note: "融資の可否や条件は銀行が判断します。この資料は相談のための下書きで、結果を約束するものではありません。",
    },
  };
}

// ---- AI への依頼 ----

/**
 * AI への依頼を組み立てる。渡すのは5つ（お店の概要・数字・試算・公開用の診断・90日計画の行動の文/担当/期限/状態）だけ。
 * diagnosis は toPublicDiagnosisRecord(...).diagnosis を渡すこと。
 */
export function buildReportRequest(
  diagnosis: unknown,
  actions: PlanAction[],
  settings: CompanySettings = TSUGUMI_SETTINGS,
): JsonAiRequest {
  const plan = actions.length
    ? actions.map((a) => ({ 文: a.title, 担当: a.owner, 期限: a.due, 状態: a.status }))
    : "未作成";
  const def = isTsugumi(settings);
  const upside = upsideForPrompt(settings);
  const user = [
    "次の入力をもとに、出力形式どおりの JSON だけを返してください。",
    dataBlock(
      "company",
      def
        ? { 会社名: COMPANY_NAME, 業種: INDUSTRY, 概要: companyContextFor(settings) }
        : { 会社名: settings.company.name, 業種: industryTextFor(settings), 概要: settings.company.overview || "未記入" },
    ),
    dataBlock("financials", financialsForPrompt(settings.financials)),
    dataBlock("upside", upside ?? "この業種では改善策の試算を用意していません（改善策あり案は無い）"),
    dataBlock("diagnosis", diagnosis),
    dataBlock("action_plan", plan),
  ].join("\n\n");
  // 初期値（つぐみ）以外で、指示文の前提と違うところだけ補足する（指示文の本文は変えない）
  const notes: string[] = [];
  if (periodNames(settings.financials).userInput) {
    notes.push("- 数字は利用者が設定に入力したもの。期の名前は「前期」「当期」とだけ書き、決算期の年月（2025年3月期など）は書かない。");
  }
  if (!upside) {
    notes.push(
      "- この業種では改善策の試算は無い。outlook_viewpoints は「現状維持案」を見るときの観点（2〜4件）にし、改善策の効果の金額を作らない。",
    );
  }
  return {
    purpose: "report",
    system: [REPORT_SYSTEM, DATA_NOTE, ...(notes.length ? [["# アプリからの補足", ...notes].join("\n")] : [])].join("\n\n"),
    messages: [{ role: "user", content: user }],
    schema: REPORT_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: REPORT_MAX_TOKENS,
  };
}

// ---- 保存・取得 ----

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** 保存する日時。前の updated_at より必ず後にする（同じミリ秒に2回保存しても updatedAt の照合で見分けられるように） */
function nextStamp(prev: string | null): string {
  const now = nowIso();
  if (!prev || now > prev) return now;
  const t = Date.parse(prev);
  return Number.isFinite(t) ? new Date(t + 1).toISOString() : now;
}

async function loadRow(db: Client, demoId: string) {
  const rs = await db.execute({
    sql: `SELECT content, diagnosis_created_at, created_at, updated_at FROM reports WHERE demo_id = ?`,
    args: [demoId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  let ai: ReportAiParts | null = null;
  let editedAt: string | undefined;
  try {
    const v = obj(JSON.parse(String(row.content)));
    ai = v ? parseReportAi(v) : null; // 保存した JSON も同じ検証を通す（REV-009）
    // 編集した日時（updateReport が入れる。作り直すと無くなる）
    if (v && typeof v.edited_at === "string" && ISO_RE.test(v.edited_at)) editedAt = v.edited_at;
  } catch {
    ai = null;
  }
  return {
    ai,
    editedAt,
    diagnosisCreatedAt: String(row.diagnosis_created_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * 今の有効な診断から作られた資料だけを返す（SEC-101 の読み出し側の確認・SEC-102）。
 * 有効な診断が無い、作成時の診断と今の診断が違う、中身が読めない、のどれかなら返さずに消す（消すのに失敗しても返さない）。
 */
export async function getReportFrom(db: Client, demoId: string): Promise<ReportState | null> {
  // 資料を先に読み、そのあと診断を照合する（間に共有の取り消しが確定しても、取り消し前の資料を返さないため。security SEC-301）
  const loaded = await loadRow(db, demoId);
  if (!loaded) return null;
  const diag = await getDiagnosisFrom(db, demoId);
  if (diag && loaded.ai && loaded.diagnosisCreatedAt === diag.createdAt) {
    const plan = await getActionPlanFrom(db, demoId);
    // 設定を変えると資料は消える（lib/company-settings.ts）ので、残っている資料は今の設定で作ったもの
    const { settings } = await loadCompanySettings(db, demoId);
    return buildReportState(
      loaded.ai,
      {
        createdAt: loaded.createdAt,
        updatedAt: loaded.updatedAt,
        editedAt: loaded.editedAt,
        diagnosisCreatedAt: loaded.diagnosisCreatedAt,
        actions: plan.actions,
      },
      settings,
    );
  }
  try {
    await db.execute({
      sql: diag && loaded.ai
        ? `DELETE FROM reports WHERE demo_id = ? AND diagnosis_created_at <> ?`
        : `DELETE FROM reports WHERE demo_id = ?`,
      args: diag && loaded.ai ? [demoId, diag.createdAt] : [demoId],
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", where: "report.invalidate", error: err instanceof Error ? err.name : "UnknownError" }));
  }
  return null;
}

/** 画面（サーバーコンポーネント）用。demoId はサーバーでクッキーから読んだ値を渡すこと。 */
export async function getReport(demoId: string): Promise<ReportState | null> {
  return getReportFrom(await getDb(), demoId);
}

/**
 * POST /api/report：資料を作る（作り直し）。先代・後継者どちらでも可（二人の共有物）。
 * 作り直すと、PUT /api/report で編集した文と editedAt は消え、AI の新しい下書きに置き換わる（content を丸ごと書き直すため）
 */
export async function createReport(deps: AiDeps, demoId: string, role: Role): Promise<ReportState> {
  const diag = await getDiagnosisFrom(deps.db, demoId);
  if (!diag) throw new ServiceError(409, MSG_REPORT_NEED_DIAGNOSIS);
  const plan = await getActionPlanFrom(deps.db, demoId);
  const cfg = await loadCompanySettings(deps.db, demoId);
  const req = buildReportRequest(toPublicDiagnosisRecord(diag).diagnosis, plan.actions, cfg.settings);
  const ai = await callJsonAi(deps, demoId, role, req, parseReportAi);
  // 言い切りに見える表現があれば、種類だけをログに出す（本文は出さない。注記は buildReportState で付く。SEC-302）
  cautionFor("report.create", reportAiTexts(ai));

  // 前の資料の updated_at より後の日時にする（作り直しの前に読んだ画面からの PUT を、必ず 409 にするため）
  const prev = await deps.db.execute({ sql: `SELECT updated_at FROM reports WHERE demo_id = ?`, args: [demoId] });
  const now = nextStamp(prev.rows[0] ? String(prev.rows[0].updated_at) : null);
  // 今の診断がまだ同じで、設定も変わっていないときだけ書く（AI を待つ間に取り消し・作り直し・設定の変更があれば書かない）
  const sameSettings = settingsRevCondition(demoId, cfg.rev);
  const ins = await deps.db.execute({
    sql: `INSERT INTO reports (demo_id, content, diagnosis_created_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM diagnoses WHERE demo_id = ? AND created_at = ?)
            AND ${sameSettings.sql}
          ON CONFLICT(demo_id) DO UPDATE SET content = excluded.content,
            diagnosis_created_at = excluded.diagnosis_created_at,
            created_at = excluded.created_at, updated_at = excluded.updated_at`,
    args: [demoId, JSON.stringify(ai), diag.createdAt, now, now, demoId, diag.createdAt, ...sameSettings.args],
  });
  if (ins.rowsAffected !== 1) {
    const nowCfg = await loadCompanySettings(deps.db, demoId);
    if (nowCfg.rev !== cfg.rev) throw new ServiceError(409, MSG_SETTINGS_CHANGED);
  }
  // 書いたあとにも照合する（共有の取り消しで診断が無効になっていれば、ここで消えて null）
  const saved = await getReportFrom(deps.db, demoId);
  if (!saved) throw new ServiceError(409, MSG_REPORT_CHANGED);
  return saved;
}

// ---- 文の編集（PUT /api/report） ----

/** 1つの欄の文を検証する（validateText に合わせる。切り詰めない）。失敗は 400 で field（欄の場所）を付ける */
function editText(
  v: unknown,
  field: string,
  label: string,
  max: number,
  opts: { allowNewline: boolean; allowEmpty?: boolean },
): string {
  if (opts.allowEmpty && typeof v === "string" && v.trim() === "") return "";
  try {
    return validateText(v, {
      max,
      allowNewline: opts.allowNewline,
      emptyMessage: `${label}を入力してください`,
      tooLongMessage: `${label}は${max}文字以内にしてください`,
      badCharMessage: `${label}に使えない文字（${opts.allowNewline ? "" : "改行・"}制御文字など）が含まれています`,
    });
  } catch (err) {
    if (err instanceof ServiceError) throw new ServiceError(400, err.userMessage, { field });
    throw err;
  }
}

/** 一覧の件数を確かめる（足りない・多すぎは 400） */
function editList(v: unknown, field: string, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(v)) throw new ServiceError(400, MSG_REPORT_EDIT_INVALID, { field });
  if (v.length > max) throw new ServiceError(400, `${label}は${max}件までにしてください`, { field });
  if (v.length < min) throw new ServiceError(400, `${label}は${min}件以上にしてください`, { field });
  return v;
}

function editStrList(v: unknown, field: string, label: string, min: number, max: number): string[] {
  return editList(v, field, label, min, max).map((x, i) =>
    editText(x, `${field}.${i}`, `${label}の${i + 1}件目`, POINT_MAX, { allowNewline: false }),
  );
}

function editPoints(v: unknown, field: string, label: string): ReportPoint[] {
  return editList(v, field, label, POINTS_MIN, POINTS_MAX).map((x, i) => {
    const o = obj(x);
    if (!o) throw new ServiceError(400, MSG_REPORT_EDIT_INVALID, { field: `${field}.${i}` });
    return {
      text: editText(o.text, `${field}.${i}.text`, `${label}の${i + 1}件目の文`, POINT_MAX, { allowNewline: false }),
      basis: editText(o.basis ?? "", `${field}.${i}.basis`, `${label}の${i + 1}件目の根拠`, POINT_MAX, {
        allowNewline: false,
        allowEmpty: true,
      }),
    };
  });
}

/**
 * 編集した AI の文を検証して、決まった項目だけに組み直す（それ以外の項目は無視する。数字を混ぜても使わない）。
 * 上限は AI の出力と同じ（REPORT_LIMITS）。改行は説明文（results_comment・financial_comment）と相談内容（bank_doc.purpose）だけ可。
 * 最後に AI の出力の検証 parseReportAi も通す（必須の項目・件数がそろっているか）
 */
export function validateReportEdit(raw: unknown): ReportAiParts {
  const v = obj(raw);
  if (!v) throw new ServiceError(400, MSG_REPORT_EDIT_INVALID, { field: "ai" });
  const consult = obj(v.consult);
  if (!consult) throw new ServiceError(400, MSG_REPORT_EDIT_INVALID, { field: "consult" });
  const bank = obj(v.bank_doc);
  if (!bank) throw new ServiceError(400, MSG_REPORT_EDIT_INVALID, { field: "bank_doc" });
  const out: ReportAiParts = {
    results_comment: editText(v.results_comment, "results_comment", "決算の要点の説明", COMMENT_MAX, { allowNewline: true }),
    financial_comment: editText(v.financial_comment, "financial_comment", "財務の状態の説明", COMMENT_MAX, {
      allowNewline: true,
    }),
    strengths: editPoints(v.strengths, "strengths", "強み"),
    issues: editPoints(v.issues, "issues", "課題"),
    outlook_viewpoints: editStrList(v.outlook_viewpoints, "outlook_viewpoints", "今後の展望の観点", 0, VIEWPOINTS_MAX),
    consult: {
      bank: editStrList(consult.bank, "consult.bank", "銀行に相談すること", 1, CONSULT_MAX),
      tax: editStrList(consult.tax, "consult.tax", "専門家に確認すること", 1, CONSULT_MAX),
      other: editStrList(consult.other, "consult.other", "その他の相談事項", 0, CONSULT_MAX),
    },
    bank_doc: {
      purpose: editText(bank.purpose, "bank_doc.purpose", "相談内容", PURPOSE_MAX, { allowNewline: true }),
      questions: editStrList(bank.questions, "bank_doc.questions", "質問リスト", QUESTIONS_MIN, QUESTIONS_MAX),
    },
  };
  // AI の出力と同じ検証を通す（ここで欠けたり変わったりするなら受け付けない）
  const parsed = parseReportAi(out as unknown as Record<string, unknown>);
  if (!parsed || JSON.stringify(parsed) !== JSON.stringify(out)) throw new ServiceError(400, MSG_REPORT_EDIT_INVALID);
  return parsed;
}

/** 書き換えを1回分数える（plan_edit_usage。90日計画・設定と同じ枠・同じ1日の区切り）。上限を超えたら 429 */
async function reserveReportEdit(db: Client, demoId: string): Promise<void> {
  const rs = await db.execute({
    sql: `INSERT INTO plan_edit_usage (demo_id, day, calls) VALUES (?, ?, 1)
          ON CONFLICT(demo_id, day) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    args: [demoId, usageDayKey(nowIso()), PLAN_EDITS_DAILY_LIMIT],
  });
  if (rs.rowsAffected !== 1) throw new ServiceError(429, MSG_REPORT_EDIT_LIMIT);
}

/**
 * PUT /api/report：AI が書いた文を直して保存する。body { ai: ReportAiParts, updatedAt: string }。先代・後継者どちらでも可。
 * 数字の表は保存しない（表示のたびに計算）。作り直す（createReport）と、ここで保存した文は消える
 */
export async function updateReport(db: Client, demoId: string, body: Record<string, unknown>): Promise<ReportState> {
  const ai = validateReportEdit(body.ai);
  const base = body.updatedAt;
  if (typeof base !== "string" || base.length === 0 || base.length > 40) {
    throw new ServiceError(400, MSG_REPORT_EDIT_INVALID, { field: "updatedAt" });
  }
  await reserveReportEdit(db, demoId);

  const loaded = await loadRow(db, demoId);
  if (!loaded) throw new ServiceError(404, MSG_REPORT_NOT_FOUND);
  const diag = await getDiagnosisFrom(db, demoId);
  if (!diag || !loaded.ai || loaded.diagnosisCreatedAt !== diag.createdAt) throw new ServiceError(409, MSG_REPORT_CHANGED);
  if (loaded.updatedAt !== base) throw new ServiceError(409, MSG_REPORT_EDIT_CONFLICT);
  const cfg = await loadCompanySettings(db, demoId);

  const now = nextStamp(loaded.updatedAt);
  const sameSettings = settingsRevCondition(demoId, cfg.rev);
  // 3つの条件（送られた updatedAt・作成時の診断が今の診断・設定の rev）がそろったときだけ書く
  const rs = await db.execute({
    sql: `UPDATE reports SET content = ?, updated_at = ?
          WHERE demo_id = ? AND updated_at = ? AND diagnosis_created_at = ?
            AND diagnosis_created_at = (SELECT created_at FROM diagnoses WHERE diagnoses.demo_id = ?)
            AND ${sameSettings.sql}`,
    args: [JSON.stringify({ ...ai, edited_at: now }), now, demoId, base, loaded.diagnosisCreatedAt, demoId, ...sameSettings.args],
  });
  if (rs.rowsAffected !== 1) {
    // 書けなかった理由を見分ける：設定が変わった／診断が変わった（資料が消えた）／ほかの保存と重なった
    const nowCfg = await loadCompanySettings(db, demoId);
    if (nowCfg.rev !== cfg.rev) throw new ServiceError(409, MSG_SETTINGS_CHANGED);
    const nowDiag = await getDiagnosisFrom(db, demoId);
    const nowRow = await loadRow(db, demoId);
    if (
      !nowDiag ||
      !nowRow ||
      nowDiag.createdAt !== loaded.diagnosisCreatedAt ||
      nowRow.diagnosisCreatedAt !== loaded.diagnosisCreatedAt
    ) {
      throw new ServiceError(409, MSG_REPORT_CHANGED);
    }
    throw new ServiceError(409, MSG_REPORT_EDIT_CONFLICT);
  }
  // 言い切りに見える表現があれば種類だけをログに出す（注記は buildReportState が今の文から付け直す。SEC-302）
  cautionFor("report.edit", reportAiTexts(ai));
  const saved = await getReportFrom(db, demoId);
  if (!saved) throw new ServiceError(409, MSG_REPORT_CHANGED);
  return saved;
}

/** テスト・確認用：資料の数字の欄がアプリの計算値と同じかを見るための元データ */
export const REPORT_ROW_LABELS = { results: RESULT_LABELS, financial: FINANCIAL_LABELS, bank: BANK_LABELS } as const;
