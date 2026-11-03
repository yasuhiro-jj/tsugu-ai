// 小さな共通処理（Next.js に依存しない。重複していたものをここに集めた。REV-006）。

import type { ThemeSummary } from "./interview-types";

/** 今の時刻（UTC の ISO 文字列。DB の時刻はすべてこの形なので文字列の大小で比べられる） */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 日本時間の今日（YYYY-MM-DD） */
export function jstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 日本時間の日時（YYYY-MM-DD HH:mm）。iso は UTC の ISO 文字列 */
export function jstDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

/** 文字数（サロゲートペアを1文字として数える） */
export function charLen(s: string): number {
  return Array.from(s).length;
}

/**
 * {{name}} を1回の走査で置き換える（差し込んだ値の中の {{ }} は再展開しない）。
 * 未知のキーはそのまま残す。
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole,
  );
}

/** DB に保存した要約（JSON 文字列）を読む。形が違う項目は捨てる。読めなければ null。 */
export function parseStoredSummary(raw: unknown): ThemeSummary | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
    const pick = (k: string): string[] =>
      Array.isArray(v[k]) ? v[k].filter((x: unknown): x is string => typeof x === "string") : [];
    return {
      statements: pick("statements"),
      ai_observations: pick("ai_observations"),
      unconfirmed: pick("unconfirmed"),
    };
  } catch {
    return null;
  }
}
