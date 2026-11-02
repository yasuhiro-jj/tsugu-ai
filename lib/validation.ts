// 入力検証（サーバー側）。失敗は ServiceError(400) で利用者向けの日本語を返す。

import { isThemeKey, type ThemeKey } from "./themes";
import type { ThemeSummary } from "./interview-types";
import { ServiceError } from "./errors";

export const MESSAGE_MAX_CHARS = 1000;
export const SUMMARY_ITEM_MAX_CHARS = 300;
export const SUMMARY_MAX_ITEMS = 10;

const SUMMARY_FIELDS = ["statements", "ai_observations", "unconfirmed"] as const;

/** 文字数（サロゲートペアを1文字として数える） */
function charLength(s: string): number {
  return Array.from(s).length;
}

/** 面談のメッセージ本文：前後の空白を除いて 1〜1000 文字 */
export function validateMessageText(value: unknown): string {
  if (typeof value !== "string") throw new ServiceError(400, "メッセージを入力してください");
  const text = value.trim();
  if (charLength(text) === 0) throw new ServiceError(400, "メッセージを入力してください");
  if (charLength(text) > MESSAGE_MAX_CHARS) {
    throw new ServiceError(400, `メッセージは${MESSAGE_MAX_CHARS}文字以内で入力してください`);
  }
  return text;
}

export function validateThemeKey(value: unknown): ThemeKey {
  if (!isThemeKey(value)) throw new ServiceError(400, "テーマの指定が正しくありません");
  return value;
}

export function validateDecision(value: unknown): "confirm" | "discard" {
  if (value === "confirm" || value === "discard") return value;
  throw new ServiceError(400, "操作の指定が正しくありません");
}

export function validateShared(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  throw new ServiceError(400, "共有するかどうかの指定が正しくありません");
}

/** 本人が編集した要約：各配列は文字列、各要素 300 文字以内、最大 10 件 */
export function validateSummary(value: unknown): ThemeSummary {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(400, "要約の形式が正しくありません");
  }
  const obj = value as Record<string, unknown>;
  const out: ThemeSummary = { statements: [], ai_observations: [], unconfirmed: [] };
  for (const field of SUMMARY_FIELDS) {
    const arr = obj[field];
    if (!Array.isArray(arr)) throw new ServiceError(400, "要約の形式が正しくありません");
    if (arr.length > SUMMARY_MAX_ITEMS) {
      throw new ServiceError(400, `要約の各項目は${SUMMARY_MAX_ITEMS}件までにしてください`);
    }
    const items: string[] = [];
    for (const item of arr) {
      if (typeof item !== "string") throw new ServiceError(400, "要約の形式が正しくありません");
      const t = item.trim();
      if (charLength(t) > SUMMARY_ITEM_MAX_CHARS) {
        throw new ServiceError(400, `要約の1項目は${SUMMARY_ITEM_MAX_CHARS}文字以内にしてください`);
      }
      if (t) items.push(t);
    }
    out[field] = items;
  }
  return out;
}

/** AI が返した要約を、上限に合わせて切り詰めて整える（AI 出力は検証ではなく整形） */
export function normalizeAiSummary(value: unknown): ThemeSummary {
  const out: ThemeSummary = { statements: [], ai_observations: [], unconfirmed: [] };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
  const obj = value as Record<string, unknown>;
  for (const field of SUMMARY_FIELDS) {
    const arr = obj[field];
    if (!Array.isArray(arr)) continue;
    out[field] = arr
      .filter((x): x is string => typeof x === "string")
      .map((x) => Array.from(x.trim()).slice(0, SUMMARY_ITEM_MAX_CHARS).join(""))
      .filter((x) => x.length > 0)
      .slice(0, SUMMARY_MAX_ITEMS);
  }
  return out;
}

export function isSummaryEmpty(s: ThemeSummary): boolean {
  return s.statements.length === 0 && s.ai_observations.length === 0 && s.unconfirmed.length === 0;
}
