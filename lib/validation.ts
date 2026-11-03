// 入力検証（サーバー側）。失敗は ServiceError(400) で利用者向けの日本語を返す。

import { isThemeKey, type ThemeKey } from "./themes";
import type { ThemeSummary } from "./interview-types";
import { ServiceError } from "./errors";
import { charLen as charLength } from "./util";

export const MESSAGE_MAX_CHARS = 1000;
export const SUMMARY_ITEM_MAX_CHARS = 300;
export const SUMMARY_MAX_ITEMS = 10;

const SUMMARY_FIELDS = ["statements", "ai_observations", "unconfirmed"] as const;

/**
 * 画面の表示を崩す文字：制御文字（改行・タブを含む）、見えない書式文字（\p{Cf}：向きの制御 U+200E/200F・
 * U+202A〜202E・U+2066〜2069・U+061C、幅のない文字 U+200B〜200D、U+FEFF など）、行区切り U+2028/2029
 */
export const BAD_TEXT_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/**
 * \u5e45\u306e\u306a\u3044\u63a5\u5408\u5b50 ZWJ\uff08U+200D\uff09\u3002\u5bb6\u65cf\u306e\u7d75\u6587\u5b57\u306a\u3069\u306e\u5408\u6210\u306b\u4f7f\u3046\u306e\u3067\u3001BAD_TEXT_CHARS \u306e\u4f8b\u5916\u3068\u3057\u3066\u8a31\u3059\uff08SEC-A03\uff09\u3002
 * \u305f\u3060\u3057\u6587\u306e\u5148\u982d\u30fb\u672b\u5c3e\u306b\u3042\u308b\u3068\u304d\u30012\u3064\u4ee5\u4e0a\u7d9a\u304f\u3068\u304d\u306f 400\uff08ZWJ_MISUSE\uff09\u3002
 */
export const ZWJ = /\u200d/gu;
export const ZWJ_MISUSE = /^\u200d|\u200d$|\u200d\u200d/u;

/** \u4f7f\u3048\u306a\u3044\u6587\u5b57\u304c\u3042\u308b\u304b\uff08ZWJ \u306f ZWJ_MISUSE \u306e\u5f62\u306e\u3068\u304d\u3060\u3051\u4f7f\u3048\u306a\u3044\uff09 */
export function hasBadTextChars(value: string): boolean {
  if (ZWJ_MISUSE.test(value)) return true;
  return BAD_TEXT_CHARS.test(value.replace(ZWJ, ""));
}

export type TextRule = {
  /** 文字数の上限（サロゲートペアは1文字） */
  max: number;
  /** true なら改行（LF）だけは許す。CRLF・CR は LF にそろえる */
  allowNewline: boolean;
  emptyMessage: string;
  tooLongMessage: string;
  badCharMessage: string;
};

/**
 * 利用者が入力する1つの文の共通の検証（REV-006。AI参謀・講座の質問・90日計画の行動の文）。
 * 文字列でない・前後の空白を除いて空 → emptyMessage、使えない文字 → badCharMessage、長すぎ → tooLongMessage（すべて 400）。
 * 前後の空白は取り除いて返す。切り詰めはしない。
 */
export function validateText(value: unknown, rule: TextRule): string {
  if (typeof value !== "string") throw new ServiceError(400, rule.emptyMessage);
  const normalized = rule.allowNewline ? value.replace(/\r\n?/g, "\n") : value;
  const text = normalized.trim();
  if (charLength(text) === 0) throw new ServiceError(400, rule.emptyMessage);
  // 使えない文字は前後の空白を除く前の文で確かめる（末尾の改行・タブも、改行を許さない欄では 400）
  // ZWJ の先頭・末尾は前後の空白を除いた文でも確かめる（「 ZWJ」のような入力も弾く）
  if (hasBadTextChars(rule.allowNewline ? normalized.replace(/\n/g, "") : normalized) || ZWJ_MISUSE.test(text)) {
    throw new ServiceError(400, rule.badCharMessage);
  }
  if (charLength(text) > rule.max) throw new ServiceError(400, rule.tooLongMessage);
  return text;
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
