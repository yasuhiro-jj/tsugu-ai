// 会社の設定から、AI の指示文・資料に入れる文字列を作る（DB は読まない。純粋な関数だけ）。
//
// - 設定がつぐみの初期値のままなら、設定ダッシュボードを入れる前と同じ文字列を返す（tests/settings-golden.test.ts）
// - 初期値でないときは、利用者が書いた文を「」で囲む（指示文の中で、どこからどこまでが利用者の文かを分けるため）。
//   概要の改行は「／」にする（指示文の1行の中に入るため）。`{{`・`<`・`>`・バッククォート3つは保存の時点で弾いている

import type { CompanySettings, Level } from "./settings-types";
import type { Role } from "./role";
import { COMPANY_CONTEXT, DEMO_PROFILES, type DemoProfile } from "./demo-profiles";
import { THEMES, type ThemeKey } from "./themes";
import { INDUSTRY_PRESETS, TSUGUMI_SETTINGS } from "./industry-presets";

const TSUGUMI_JSON = JSON.stringify(TSUGUMI_SETTINGS);

/** つぐみの初期値と同じ中身か（lib/company-settings.ts の isDefaultSettings と同じ判定。検証済みの設定を渡すこと） */
export function isTsugumi(s: CompanySettings): boolean {
  return s === TSUGUMI_SETTINGS || JSON.stringify(s) === TSUGUMI_JSON;
}

/**
 * 利用者の文を指示文に入れる形にする（初期値なら何もしない）。
 * 利用者が書いた「」『』は［］に置き換え、囲みの外へ抜け出して指示のように読まれないようにする（security SEC-401）。
 */
export function quoteUser(text: string, isDefault: boolean): string {
  if (isDefault) return text;
  const safe = text.replace(/\n+/g, "／").replace(/[「『]/g, "［").replace(/[」』]/g, "］");
  return `「${safe}」`;
}

/** 面談相手・相談相手の情報（DEMO_PROFILES と同じ形）。名前・関係・知識レベルを設定から */
export function profileFor(s: CompanySettings, role: Role): DemoProfile {
  const base = DEMO_PROFILES[role];
  const def = isTsugumi(s);
  const name = role === "predecessor" ? s.people.predecessorName : s.people.successorName;
  const level: Level = role === "predecessor" ? s.people.predecessorLevel : s.people.successorLevel;
  return { ...base, name: quoteUser(name, def), route: s.people.relation, level };
}

/** 画面に出す名前（「」で囲まない） */
export function displayNameFor(s: CompanySettings, role: Role): string {
  return role === "predecessor" ? s.people.predecessorName : s.people.successorName;
}

/** 資料の「業種」欄（例：「飲食業（和食の食事処）」） */
export function industryTextFor(s: CompanySettings): string {
  const business = INDUSTRY_PRESETS[s.industry].businessLabel;
  return s.company.industryNote ? `${business}（${s.company.industryNote}）` : business;
}

/** 指示文の「お店の情報」「お店の概要」に入れる文。初期値なら COMPANY_CONTEXT のまま */
export function companyContextFor(s: CompanySettings): string {
  if (isTsugumi(s)) return COMPANY_CONTEXT;
  const business = INDUSTRY_PRESETS[s.industry].businessLabel;
  const note = s.company.industryNote ? `（${quoteUser(s.company.industryNote, false)}）` : "";
  const overview = s.company.overview ? quoteUser(s.company.overview, false) : "未記入";
  return `会社名${quoteUser(s.company.name, false)}、業種：${business}${note}、概要：${overview}`;
}

/** テーマの補足（締めは「締めの質問」で固定）。空なら null */
function hintFor(s: CompanySettings, key: ThemeKey): string | null {
  const t = THEMES.find((x) => x.key === key)!;
  if (key === "closing") return t.hint;
  const hint = s.themeHints[key];
  return hint ? quoteUser(hint, isTsugumi(s)) : null;
}

/** 指示文の「今のテーマ」（例：「経営方針（守りたいもの、変えてもよいもの）」） */
export function currentThemeFor(s: CompanySettings, key: ThemeKey): string {
  const t = THEMES.find((x) => x.key === key)!;
  const hint = hintFor(s, key);
  return hint ? `${t.label}（${hint}）` : t.label;
}

/** 指示文の「# テーマ」の一覧（{{theme_list}}） */
export function themeListFor(s: CompanySettings): string {
  return THEMES.map((t, i) => {
    if (t.key === "closing") return `${i + 1}. 締め：${t.label}`;
    const hint = hintFor(s, t.key);
    return hint ? `${i + 1}. ${t.label}：${hint}` : `${i + 1}. ${t.label}`;
  }).join("\n");
}
