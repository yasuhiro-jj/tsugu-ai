import type { ReportAiParts, ReportPoint, ReportState } from "@/lib/report-types";

// 資料の「AI が書いた部分」を画面で編集するための変換と、PUT /api/report の呼び出し。
// 約束（lib/report-types.ts）：PUT /api/report 本文 { ai: ReportAiParts, updatedAt } → { ok, state }
//   400 { ok:false, error, field? }（field は "strengths.0.text"・"consult.bank.2" など。分かれば該当の欄に出す）
//   409 ほかの操作と重なった・診断や設定が変わった（どれも「読み込み直してください」を出す）
// 数字・固定文は編集しない（アプリが計算・用意したもの）。上限は REPORT_LIMITS（サーバーの検証と同じ値）。

/** 画面で編集中の形。箇条書きは「1行＝1項目」の文字列で持つ */
export type ReportDraft = {
  results_comment: string;
  financial_comment: string;
  strengths: ReportPoint[];
  issues: ReportPoint[];
  outlook_viewpoints: string;
  consult_bank: string;
  consult_tax: string;
  consult_other: string;
  bank_purpose: string;
  bank_questions: string;
};

export type DraftKey = keyof ReportDraft;

export function countChars(s: string): number {
  return Array.from(s).length;
}

/** 「1行＝1項目」の文字列を項目に分ける（前後の空白を除き、空の行は数えない） */
export function splitLines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

export function toDraft(e: ReportAiParts): ReportDraft {
  return {
    results_comment: e.results_comment,
    financial_comment: e.financial_comment,
    strengths: e.strengths.map((p) => ({ ...p })),
    issues: e.issues.map((p) => ({ ...p })),
    outlook_viewpoints: e.outlook_viewpoints.join("\n"),
    consult_bank: e.consult.bank.join("\n"),
    consult_tax: e.consult.tax.join("\n"),
    consult_other: e.consult.other.join("\n"),
    bank_purpose: e.bank_doc.purpose,
    bank_questions: e.bank_doc.questions.join("\n"),
  };
}

function oneLine(s: string): string {
  return s.replace(/\s*\r?\n\s*/g, " ").trim();
}

function cleanPoints(list: ReportPoint[]): ReportPoint[] {
  // 強み・課題の文と根拠は改行できない（サーバーの約束）。改行は空白にする
  return list
    .map((p) => ({ text: oneLine(p.text), basis: oneLine(p.basis) }))
    .filter((p) => p.text !== "" || p.basis !== "");
}

export function fromDraft(d: ReportDraft): ReportAiParts {
  return {
    results_comment: d.results_comment.trim(),
    financial_comment: d.financial_comment.trim(),
    strengths: cleanPoints(d.strengths),
    issues: cleanPoints(d.issues),
    outlook_viewpoints: splitLines(d.outlook_viewpoints),
    consult: { bank: splitLines(d.consult_bank), tax: splitLines(d.consult_tax), other: splitLines(d.consult_other) },
    bank_doc: { purpose: d.bank_purpose.trim(), questions: splitLines(d.bank_questions) },
  };
}

/** サーバーの項目名（例："consult.bank"、"strengths.0.text"）→ 画面の欄 */
const FIELD_PREFIX: [string, DraftKey][] = [
  ["results_comment", "results_comment"],
  ["financial_comment", "financial_comment"],
  ["strengths", "strengths"],
  ["issues", "issues"],
  ["outlook_viewpoints", "outlook_viewpoints"],
  ["consult.bank", "consult_bank"],
  ["consult.tax", "consult_tax"],
  ["consult.other", "consult_other"],
  ["bank_doc.purpose", "bank_purpose"],
  ["bank_doc.questions", "bank_questions"],
];

export function draftKeyOf(field: string): DraftKey | null {
  const f = field.replace(/\[(\d+)\]/g, ".$1").replace(/^ai\./, "");
  for (const [prefix, key] of FIELD_PREFIX) {
    if (f === prefix || f.startsWith(`${prefix}.`)) return key;
  }
  return null;
}

export type FieldErrors = Partial<Record<DraftKey, string>>;

export type SaveReportResult =
  | { kind: "ok"; state: ReportState }
  | { kind: "invalid"; error: string; fieldErrors: FieldErrors }
  | { kind: "conflict" }
  | { kind: "error"; error: string };

export const MSG_CONFLICT = "ほかの操作と重なりました。読み込み直してください。";
const NETWORK_ERROR = "通信に失敗しました。接続を確認して、もう一度お試しください。";
const BUSY_ERROR = "ただいま混み合っています。少し時間をおいて、もう一度お試しください。";
const GENERIC_ERROR = "保存できませんでした。時間をおいて、もう一度お試しください。";
const INVALID_ERROR = "入力を確かめてください。";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function collectFieldErrors(data: Record<string, unknown>, message: string): FieldErrors {
  const out: FieldErrors = {};
  const put = (field: string, msg: string) => {
    const key = draftKeyOf(field);
    if (key && !out[key]) out[key] = msg;
  };
  if (isObject(data.fieldErrors)) {
    for (const [field, msg] of Object.entries(data.fieldErrors)) {
      if (typeof msg === "string" && msg.trim() !== "") put(field, msg);
    }
  }
  if (typeof data.field === "string") put(data.field, message);
  return out;
}

export async function saveReport(ai: ReportAiParts, updatedAt: string): Promise<SaveReportResult> {
  let res: Response;
  try {
    res = await fetch("/api/report", {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai, updatedAt }),
    });
  } catch {
    return { kind: "error", error: NETWORK_ERROR };
  }
  const data: unknown = await res.json().catch(() => null);
  const serverError = isObject(data) && typeof data.error === "string" && data.error.trim() !== "" ? data.error : null;

  if (res.status === 409) return { kind: "conflict" };
  if (res.status === 429) return { kind: "error", error: serverError ?? BUSY_ERROR };
  if (res.status === 400) {
    const message = serverError ?? INVALID_ERROR;
    return { kind: "invalid", error: message, fieldErrors: isObject(data) ? collectFieldErrors(data, message) : {} };
  }
  if (res.ok && isObject(data) && data.ok === true && isObject(data.state)) {
    const state = data.state as ReportState;
    if (typeof state.updatedAt === "string" && isObject(state.editable)) return { kind: "ok", state };
  }
  return { kind: "error", error: serverError ?? GENERIC_ERROR };
}
