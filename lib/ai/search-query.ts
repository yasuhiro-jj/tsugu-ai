// 検索つきの相談・質問の1段目（ウェブ検索）に渡す前に、本人の質問を一般化する（SEC-201 の続き。2026-11-03）。
// DB・秘密情報は使わない純粋な関数だけ。
//
// - 利用者が質問に会社名・名前・金額・連絡先を書いても、検索ツールに渡る言葉に混ざらないようにする
// - 置き換え：設定の会社名・業種の補足 →「この会社」、先代・後継者の名前 →「先代」「後継者」、
//   単位つきの数字（万円・円・％・人・名・年など）と3桁以上の数字 →「〇〇」、メール・電話番号・郵便番号 → 消す
// - 設定に無い会社名・人名は、「株式会社」「さん」などの目印があるものだけ置き換える（目印の無い名前は見分けられない）
// - 2段目（検索なし）には元の質問をそのまま渡す（呼び出し側）

import type { CompanySettings } from "../settings-types";

export const MSG_SEARCH_QUERY_EMPTY = "検索に使える一般的な言葉が残りませんでした。会社名や金額を除いて質問してください";
/** 画面への返り値に付ける文（置き換えたときだけ） */
export const SEARCH_QUERY_NOTE = "検索では会社名・名前・金額などを伏せて調べました";
/** 置き換えたあとに残る意味のある文字（「〇〇」・記号・空白を除く）の下限 */
export const SEARCH_QUERY_MIN_CHARS = 10;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;
// URL とドメインの形（英字を含む「xxx.yyy」）。ドメイン名から会社が分かるため消す（security SEC-301 2026-11-03）
const URL_LIKE = /https?:\/\/\S+/giu;
const DOMAIN_LIKE = /(?=[\w.-]*[a-z])[a-z0-9-]+(?:\.[a-z0-9-]+)+/giu;
const POSTAL = /〒?\s*\d{3}-\d{4}(?!\d)/gu;
// 住所の番地（1-2-3、3丁目、5番地 など。SEC-303）
const ADDRESS_NUMBER = /\d+(?:[-ー‐]\d+){1,3}|\d+\s*(?:丁目|番地|番|号)/gu;
// 漢数字を含む金額（三億円、二千三百六十万、3億5千万 など。SEC-304）
const KANJI_AMOUNT = /[\d〇一二三四五六七八九十百千]+(?:[億万][\d〇一二三四五六七八九十百千]*)*(?:億円|万円|千円|円|億|万)/gu;
const PHONE = /(?:\+81[-\s]?|0)\d{1,4}[-\s(（]?\d{1,4}[-\s)）]?\d{3,4}(?!\d)/gu;
const UNIT_NUMBER =
  /[約▲△+−-]?\d[\d,.]*\s*(?:億円|万円|千円|円|億|万|%|パーセント|ポイント|人|名|年|か月|ヶ月|カ月|ヵ月|件|回|歳|社|店|倍|組|食|坪|㎡)/gu;
const LONG_NUMBER = /\d[\d,.]{2,}/gu;
const CORP = /(?:株式会社|有限会社|合同会社|\(株\)|\(有\))\s*[^\s、。の,，]{1,20}|[^\s、。の,，]{1,20}?\s*(?:株式会社|有限会社|合同会社|\(株\)|\(有\))/gu;
// 屋号の目印（商店・商会・製作所・工業）と英字の社名（Co., Ltd. / Inc. / LLC / Corp.）。SEC-302 のうち目印があるもの
const SHOP = /[\p{Script=Han}\p{Script=Katakana}]{1,8}(?:商店|商会|製作所|工業)/gu;
const CORP_EN = /[A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*)*\s*,?\s*(?:Co\.?,?\s*Ltd\.?|Inc\.?|LLC|Corp\.?)/gu;
const HONORIFIC = /[\p{Script=Han}\p{Script=Katakana}]{1,6}\s?[\p{Script=Han}\p{Script=Katakana}]{0,4}(?:さん|様|氏|くん|ちゃん|先生|店長|社長|会長|専務|常務)/gu;
const NOT_MEANINGFUL = /[〇\s\p{P}\p{S}]/gu;

export type GeneralizedQuery = { query: string; changed: boolean };

/** 全角の英数字・記号や「㈱」などを標準の形にそろえる（NFKC。security SEC-305） */
function narrow(text: string): string {
  return text.normalize("NFKC");
}

/** 名前の書き方の揺れ（「（架空）」の有無・空白の有無・空白で分けた2文字以上の部分）を長い順に並べる */
function nameVariants(name: string): string[] {
  const base = narrow(name).replace(/[(（]架空[)）]/gu, "").trim();
  if (!base) return [];
  const set = new Set<string>([narrow(name).trim(), base, base.replace(/\s+/gu, "")]);
  for (const part of base.split(/\s+/u)) if (Array.from(part).length >= 2) set.add(part);
  return [...set].filter((s) => Array.from(s).length >= 2).sort((a, b) => b.length - a.length);
}

function replaceAllLiteral(text: string, words: string[], to: string): string {
  let t = text;
  for (const w of words) t = t.split(w).join(to);
  return t;
}

/**
 * 1段目の検索に渡す質問を一般化する。changed は何か置き換えたか。
 * 一般化したあとの文が空、または置き換えたあとに意味のある文字が SEARCH_QUERY_MIN_CHARS 未満なら null（呼び出し側で 400）
 */
export function generalizeForSearch(question: string, settings: CompanySettings): GeneralizedQuery | null {
  const original = narrow(question);
  let t = original;
  // 連絡先を先に消す（電話番号の数字を金額として扱わないため）
  t = t.replace(EMAIL, "").replace(URL_LIKE, "").replace(DOMAIN_LIKE, "").replace(POSTAL, "").replace(PHONE, "");
  t = t.replace(ADDRESS_NUMBER, "〇〇");
  // 設定の会社名・業種の補足
  t = replaceAllLiteral(t, nameVariants(settings.company.name), "この会社");
  if (settings.company.industryNote) t = replaceAllLiteral(t, nameVariants(settings.company.industryNote), "この会社");
  // 先代・後継者の名前。長い方から置き換える（名前全体を先に）。二人に共通の部分（同じ名字）は「その人」
  const predAll = nameVariants(settings.people.predecessorName);
  const succAll = nameVariants(settings.people.successorName);
  const common = predAll.filter((w) => succAll.includes(w));
  const people = [
    ...predAll.filter((w) => !common.includes(w)).map((w) => ({ w, to: "先代" })),
    ...succAll.filter((w) => !common.includes(w)).map((w) => ({ w, to: "後継者" })),
    ...common.map((w) => ({ w, to: "その人" })),
  ].sort((a, b) => b.w.length - a.w.length);
  for (const p of people) t = t.split(p.w).join(p.to);
  // 目印のある会社名・人名
  t = t.replace(CORP, "この会社").replace(CORP_EN, "この会社").replace(SHOP, "この会社").replace(HONORIFIC, "その人");
  // 数字
  t = t.replace(KANJI_AMOUNT, "〇〇").replace(UNIT_NUMBER, "〇〇").replace(LONG_NUMBER, "〇〇");
  t = t.replace(/[ \t]{2,}/gu, " ").trim();
  const changed = t !== original.trim();
  const meaningful = Array.from(t.replace(NOT_MEANINGFUL, "")).length;
  if (meaningful === 0) return null;
  if (changed && meaningful < SEARCH_QUERY_MIN_CHARS) return null;
  // 何も置き換えなかったときは元の文のまま（今までと同じ入力にする）
  return changed ? { query: t, changed } : { query: question, changed: false };
}
