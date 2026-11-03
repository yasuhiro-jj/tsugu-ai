import {
  PERIOD_FIELD_LABELS,
  PERIOD_FIELDS,
  financialRange,
  type CompanySettings,
  type PeriodInput,
} from "@/lib/settings-types";

// 設定画面の入力の手助け（決算の下書きと数字の読み取り）。上限・範囲は lib/settings-types.ts の定数を使う。
// 最終的な検証はサーバー（PUT /api/settings）が行う。フックなし。

export type PeriodKey = "previous" | "current";
export type FinKey = keyof PeriodInput;

export const PERIOD_LABELS: Record<PeriodKey, string> = { previous: "前期", current: "当期" };

/** 文字数（サーバーと同じく、サロゲートペアは1文字） */
export function charCount(s: string): number {
  return Array.from(s).length;
}

export type FinDraft = Record<PeriodKey, Record<FinKey, string>>;

export function toFinDraft(f: CompanySettings["financials"]): FinDraft {
  const one = (p: PeriodInput) =>
    Object.fromEntries(PERIOD_FIELDS.map((key) => [key, String(p[key])])) as Record<FinKey, string>;
  return { previous: one(f.previous), current: one(f.current) };
}

/** 入力欄の文字（全角数字・カンマ・全角のマイナスも受け付ける）を整数にする。整数でなければ null */
export function parseInteger(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，]/g, "")
    .replace(/^[−ー－]/, "-");
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/** 決算の下書きを数字にする。誤りがあれば fieldErrors（キーはサーバーと同じ "financials.current.sales" の形） */
export function parseFinancials(draft: FinDraft): {
  value: CompanySettings["financials"] | null;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const out: Record<PeriodKey, Partial<PeriodInput>> = { previous: {}, current: {} };
  for (const period of ["previous", "current"] as const) {
    for (const key of PERIOD_FIELDS) {
      const label = PERIOD_FIELD_LABELS[key];
      const path = `financials.${period}.${key}`;
      const n = parseInteger(draft[period][key]);
      const { min, max } = financialRange(key);
      if (n === null) {
        errors[path] = `${PERIOD_LABELS[period]}の${label}は整数（万円）で入れてください`;
      } else if (n < min || n > max) {
        errors[path] = `${PERIOD_LABELS[period]}の${label}は ${min.toLocaleString("ja-JP")}〜${max.toLocaleString("ja-JP")} の範囲で入れてください`;
      } else {
        out[period][key] = n;
      }
    }
  }
  if (Object.keys(errors).length > 0) return { value: null, errors };
  return { value: { previous: out.previous as PeriodInput, current: out.current as PeriodInput }, errors };
}
