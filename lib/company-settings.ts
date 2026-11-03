import "server-only";

// 会社の設定（設定ダッシュボード。docs/settings-dashboard.md）の読み込み・検証・保存（Next.js に依存しない。テストから呼べる）。
//
// 守ること：
// - 読み書きは必ず demo_id で絞る（クッキーから読んだ値だけ。本文の ID は使わない）。設定は二人の共有物なので role では絞らない
// - 行が無い・JSON が壊れている・形が違うときは、架空の「つぐみ」の初期値（TSUGUMI_SETTINGS）
// - 検証はサーバーで行う（画面の表示と同じ上限は lib/settings-types.ts）。AI の指示文に入るので、
//   改行・制御文字・見えない書式文字・`{{`・`<`・`>`・バッククォート3つを拒否する（概要だけ改行可）
// - 保存：正規化した JSON が前と同じなら何もしない。変わったら1つの batch で
//   設定の UPSERT（rev 条件つき）＋ 診断と派生物の削除（invalidateDiagnosisStatements）＋ AI参謀の会話の削除（両方の役割）
//   ＋（後継者の Lv が変わったら）learning.level の更新。削除と更新は「この保存が書けたとき」だけ効く条件（guard）つき
// - 面談の記録（theme_records）は残す
// - 書き換えの回数は 90日計画の書き換えと同じ表・同じ1日の上限で数える（plan_edit_usage）
// - 返す内容に、相手の AI参謀の会話の有無や面談の中身は入れない
// - SQL はすべてプレースホルダ。ログに設定の中身は出さない

import type { Client } from "@libsql/client";
import {
  EDITABLE_THEME_KEYS,
  INDUSTRIES,
  LEVELS,
  MSG_SETTINGS_CHANGED,
  PERIOD_FIELDS,
  PERIOD_FIELD_LABELS,
  RELATIONS,
  SETTINGS_LIMITS,
  financialRange,
  type CompanySettings,
  type EditableThemeKey,
  type Industry,
  type Level,
  type PeriodInput,
  type Relation,
  type SettingsFieldErrors,
  type SettingsSaveResponse,
  type SettingsView,
} from "./settings-types";
import { INDUSTRY_PRESETS, TSUGUMI_SETTINGS, cloneSettings } from "./industry-presets";
import { ServiceError } from "./errors";
import { hasBadTextChars, ZWJ_MISUSE } from "./validation";
import { charLen, nowIso } from "./util";
import { invalidateDiagnosisStatements } from "./plan-store";
import { usageDayKey } from "./ai/usage";
import type { Role } from "./role";
import { getDb } from "./db";
import { getFinancialSummary, getUpsideSummary } from "./financials";
import type { FinancialSummary, UpsideSummary } from "./plan-types";

export { MSG_SETTINGS_CHANGED };

/** 設定の JSON の形の版（形を変えたら上げ、古い版は初期値として読む） */
export const SETTINGS_VERSION = 1;
export const MSG_SETTINGS_INVALID = "入力に誤りがあります。表示された欄を直してください";
export const MSG_SETTINGS_CONFLICT = "ほかの操作で設定が変わりました。画面を読み込み直してください";
/** 書き換えの1日の上限（lib/action-plan.ts の PLAN_EDITS_DAILY_LIMIT と同じ値・同じ表。一致はテストで確認） */
export const SETTINGS_EDITS_DAILY_LIMIT = 300;
export const MSG_SETTINGS_EDIT_LIMIT = `設定や90日計画の書き換えは1日${SETTINGS_EDITS_DAILY_LIMIT}回までです。日本時間の朝9時に回数が戻ります`;

// ---- 検証 ----

/** AI の指示文の形を崩す並び（`{{`・`<`・`>`・バッククォート3つ） */
const PROMPT_BREAKERS = /\{\{|<|>|```/;

type TextSpec = { key: string; label: string; min: number; max: number; multiline: boolean };

function checkText(value: unknown, spec: TextSpec, errors: SettingsFieldErrors): string {
  if (typeof value !== "string") {
    errors[spec.key] = `${spec.label}を入力してください`;
    return "";
  }
  const normalized = spec.multiline ? value.replace(/\r\n?/g, "\n") : value;
  const text = normalized.trim();
  const len = charLen(text);
  if (spec.min > 0 && len === 0) {
    errors[spec.key] = `${spec.label}を入力してください`;
    return "";
  }
  // 改行を許す欄は改行（LF）だけを除いてから確かめる。前後の空白を除く前の文で確かめる（末尾の改行・タブも弾く）
  const forCheck = spec.multiline ? normalized.replace(/\n/g, "") : normalized;
  if (hasBadTextChars(forCheck) || ZWJ_MISUSE.test(text)) {
    errors[spec.key] = spec.multiline
      ? `${spec.label}に使えない文字（制御文字など）が含まれています`
      : `${spec.label}に使えない文字（改行・制御文字など）が含まれています`;
    return "";
  }
  if (PROMPT_BREAKERS.test(text)) {
    errors[spec.key] = `${spec.label}に「{{」「<」「>」「\`\`\`」は使えません`;
    return "";
  }
  if (len > spec.max) {
    errors[spec.key] = `${spec.label}は${spec.max}文字以内で入力してください`;
    return "";
  }
  return text;
}

function checkChoice<T extends string>(value: unknown, choices: readonly T[], key: string, label: string, errors: SettingsFieldErrors): T {
  if (typeof value === "string" && (choices as readonly string[]).includes(value)) return value as T;
  errors[key] = `${label}は選択肢から選んでください`;
  return choices[0];
}

function checkNumber(value: unknown, field: keyof PeriodInput, key: string, periodLabel: string, errors: SettingsFieldErrors): number {
  const label = `${periodLabel}の${PERIOD_FIELD_LABELS[field]}`;
  let n: number | null = null;
  if (typeof value === "number") n = value;
  else if (typeof value === "string" && /^\s*-?\d+\s*$/.test(value)) n = Number(value.trim());
  if (n === null || !Number.isFinite(n) || !Number.isInteger(n)) {
    errors[key] = `${label}は万円の整数で入力してください`;
    return 0;
  }
  const { min, max } = financialRange(field);
  if (n < min || n > max) {
    errors[key] = `${label}は${min.toLocaleString("ja-JP")}〜${max.toLocaleString("ja-JP")}（万円）の範囲で入力してください`;
    return 0;
  }
  return n === 0 ? 0 : n; // -0 を 0 にそろえる
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * 設定の検証と正規化。決まった項目だけを決まった順番で組み直して返す（ほかの項目は捨てる）。
 * 誤りがあれば ServiceError(400)。extra.fieldErrors に「financials.current.sales」などの欄ごとの文言を入れる。
 */
export function validateSettings(raw: unknown): CompanySettings {
  const errors: SettingsFieldErrors = {};
  const root = asObject(raw);
  if (!root) {
    throw new ServiceError(400, MSG_SETTINGS_INVALID, { fieldErrors: { settings: "設定の形式が正しくありません" } });
  }
  const company = asObject(root.company) ?? {};
  const people = asObject(root.people) ?? {};
  const hints = asObject(root.themeHints) ?? {};
  const fin = asObject(root.financials) ?? {};

  const industry = checkChoice<Industry>(root.industry, INDUSTRIES, "industry", "業種", errors);
  const L = SETTINGS_LIMITS;
  const out: CompanySettings = {
    industry,
    company: {
      name: checkText(company.name, { key: "company.name", label: "会社名", min: 1, max: L.companyName, multiline: false }, errors),
      industryNote: checkText(
        company.industryNote ?? "",
        { key: "company.industryNote", label: "業種の補足", min: 0, max: L.industryNote, multiline: false },
        errors,
      ),
      overview: checkText(
        company.overview ?? "",
        { key: "company.overview", label: "会社の概要", min: 0, max: L.overview, multiline: true },
        errors,
      ),
    },
    people: {
      predecessorName: checkText(
        people.predecessorName,
        { key: "people.predecessorName", label: "先代の名前", min: 1, max: L.personName, multiline: false },
        errors,
      ),
      successorName: checkText(
        people.successorName,
        { key: "people.successorName", label: "後継者の名前", min: 1, max: L.personName, multiline: false },
        errors,
      ),
      relation: checkChoice<Relation>(people.relation, RELATIONS, "people.relation", "二人の関係", errors),
      predecessorLevel: checkChoice<Level>(people.predecessorLevel, LEVELS, "people.predecessorLevel", "先代の知識レベル", errors),
      successorLevel: checkChoice<Level>(people.successorLevel, LEVELS, "people.successorLevel", "後継者の知識レベル", errors),
    },
    themeHints: Object.fromEntries(
      EDITABLE_THEME_KEYS.map((k) => [
        k,
        checkText(hints[k] ?? "", { key: `themeHints.${k}`, label: "テーマの補足", min: 0, max: L.themeHint, multiline: false }, errors),
      ]),
    ) as Record<EditableThemeKey, string>,
    financials: {
      previous: checkPeriod(fin.previous, "previous", "前期", errors),
      current: checkPeriod(fin.current, "current", "当期", errors),
    },
  };
  if (Object.keys(errors).length > 0) {
    throw new ServiceError(400, MSG_SETTINGS_INVALID, { fieldErrors: errors });
  }
  return out;
}

function checkPeriod(raw: unknown, which: "previous" | "current", label: string, errors: SettingsFieldErrors): PeriodInput {
  const o = asObject(raw) ?? {};
  const p = {} as PeriodInput;
  for (const f of PERIOD_FIELDS) p[f] = checkNumber(o[f], f, `financials.${which}.${f}`, label, errors);
  return p;
}

/** 比べる・保存するための正規化した JSON（validateSettings を通したものを渡すこと） */
export function settingsJson(s: CompanySettings): string {
  return JSON.stringify(s);
}

const TSUGUMI_JSON = settingsJson(validateSettings(TSUGUMI_SETTINGS));

/** つぐみの初期値と同じ中身か */
export function isDefaultSettings(s: CompanySettings): boolean {
  return settingsJson(s) === TSUGUMI_JSON;
}

// ---- 読み込み ----

export type LoadedSettings = {
  settings: CompanySettings;
  isDefault: boolean;
  /** 行が無ければ 0 */
  rev: number;
  updatedAt: string | null;
};

/** このデモ用 ID の設定を読む（行が無い・壊れていればつぐみの初期値。rev は行の値） */
export async function loadCompanySettings(db: Client, demoId: string): Promise<LoadedSettings> {
  const rs = await db.execute({
    sql: `SELECT settings, version, rev, updated_at FROM company_settings WHERE demo_id = ?`,
    args: [demoId],
  });
  const row = rs.rows[0];
  if (!row) return { settings: cloneSettings(TSUGUMI_SETTINGS), isDefault: true, rev: 0, updatedAt: null };
  let settings: CompanySettings | null = null;
  if (Number(row.version) === SETTINGS_VERSION && typeof row.settings === "string") {
    try {
      settings = validateSettings(JSON.parse(row.settings));
    } catch {
      settings = null; // 壊れた JSON・形の違う JSON は初期値として扱う（中身はログに出さない）
    }
  }
  settings ??= cloneSettings(TSUGUMI_SETTINGS);
  return {
    settings,
    isDefault: isDefaultSettings(settings),
    rev: Number(row.rev ?? 0),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** 設定だけを返す（面談・診断・資料・AI参謀・学習が使う） */
export async function getCompanySettingsFrom(db: Client, demoId: string): Promise<CompanySettings> {
  return (await loadCompanySettings(db, demoId)).settings;
}

/** 設定画面・GET /api/settings 用。willInvalidate の AI参謀の会話は自分（role）の分だけ */
export async function getSettingsView(db: Client, demoId: string, role: Role): Promise<SettingsView> {
  const loaded = await loadCompanySettings(db, demoId);
  const rs = await db.execute({
    sql: `SELECT
            EXISTS (SELECT 1 FROM diagnoses WHERE demo_id = ?) AS d,
            EXISTS (SELECT 1 FROM action_plans WHERE demo_id = ?) AS p,
            EXISTS (SELECT 1 FROM reports WHERE demo_id = ?) AS r,
            EXISTS (SELECT 1 FROM advisor_chats WHERE demo_id = ? AND role = ? AND messages <> '[]') AS a`,
    args: [demoId, demoId, demoId, demoId, role],
  });
  const row = rs.rows[0];
  return {
    settings: loaded.settings,
    isDefault: loaded.isDefault,
    rev: loaded.rev,
    updatedAt: loaded.updatedAt,
    willInvalidate: {
      diagnosis: Number(row?.d) === 1,
      actionPlan: Number(row?.p) === 1,
      report: Number(row?.r) === 1,
      myAdvisorChat: Number(row?.a) === 1,
    },
  };
}

// ---- 生成の途中で設定が変わっていないかの照合（診断・90日計画・資料・AI参謀） ----

/** SQL の条件：今の設定の rev が rev と同じ（行が無ければ 0）。INSERT ... SELECT ... WHERE や UPDATE の WHERE に AND でつなぐ */
export function settingsRevCondition(demoId: string, rev: number): { sql: string; args: (string | number)[] } {
  return { sql: `COALESCE((SELECT rev FROM company_settings WHERE demo_id = ?), 0) = ?`, args: [demoId, rev] };
}

/** 今の設定の rev が rev と違えば 409（設定が変わったため作り直してください） */
export async function assertSettingsRev(db: Client, demoId: string, rev: number): Promise<void> {
  const rs = await db.execute({ sql: `SELECT rev FROM company_settings WHERE demo_id = ?`, args: [demoId] });
  const now = rs.rows[0] ? Number(rs.rows[0].rev) : 0;
  if (now !== rev) throw new ServiceError(409, MSG_SETTINGS_CHANGED);
}

// ---- 保存 ----

function validateRev(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new ServiceError(400, "設定の版の指定が正しくありません。画面を読み込み直してください");
  }
  return v;
}

/** 書き換えを1回分数える（90日計画の書き換えと同じ表・同じ上限）。上限を超えたら 429 */
async function reserveSettingsEdit(db: Client, demoId: string): Promise<void> {
  const rs = await db.execute({
    sql: `INSERT INTO plan_edit_usage (demo_id, day, calls) VALUES (?, ?, 1)
          ON CONFLICT(demo_id, day) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    args: [demoId, usageDayKey(nowIso()), SETTINGS_EDITS_DAILY_LIMIT],
  });
  if (rs.rowsAffected !== 1) throw new ServiceError(429, MSG_SETTINGS_EDIT_LIMIT);
}

type Stmt = { sql: string; args: (string | number | null)[] };

async function writeSettings(
  db: Client,
  demoId: string,
  role: Role,
  next: CompanySettings,
  expectedRev: number,
): Promise<SettingsSaveResponse> {
  const cur = await loadCompanySettings(db, demoId);
  const json = settingsJson(next);
  if (json === settingsJson(cur.settings)) {
    // 中身が同じなら何もしない（派生物も消さない・回数も数えない）
    return { ...(await getSettingsView(db, demoId, role)), invalidated: false };
  }
  if (expectedRev !== cur.rev) throw new ServiceError(409, MSG_SETTINGS_CONFLICT);
  await reserveSettingsEdit(db, demoId);

  const now = nowIso();
  const newRev = cur.rev + 1;
  // 削除・更新は「この保存が書けたとき」だけ効く（rev の照合で UPSERT が書けなかったら、何も消さない）
  const guard = {
    sql: `EXISTS (SELECT 1 FROM company_settings WHERE demo_id = ? AND rev = ? AND settings = ?)`,
    args: [demoId, newRev, json],
  };
  const stmts: Stmt[] = [
    {
      // 行が無ければ（expectedRev が 0 のときだけ）rev 1 で作る。あれば rev が expectedRev のときだけ書く
      sql: `INSERT INTO company_settings (demo_id, settings, version, rev, updated_at, updated_by_role)
            SELECT ?, ?, ?, 1, ?, ?
            WHERE ? = 0 OR EXISTS (SELECT 1 FROM company_settings WHERE demo_id = ?)
            ON CONFLICT(demo_id) DO UPDATE SET settings = excluded.settings, version = excluded.version,
              rev = company_settings.rev + 1, updated_at = excluded.updated_at, updated_by_role = excluded.updated_by_role
            WHERE company_settings.rev = ?`,
      args: [demoId, json, SETTINGS_VERSION, now, role, expectedRev, demoId, expectedRev],
    },
    // 診断・90日計画・資料・診断を使った学習プラン・診断に結びついた AI参謀の会話（lib/plan-store.ts）
    ...invalidateDiagnosisStatements(demoId, guard),
    // AI参謀の会話は診断を使っていないものも、両方の役割とも消す（古い会社の前提で話した内容を残さない）
    { sql: `DELETE FROM advisor_chats WHERE demo_id = ? AND ${guard.sql}`, args: [demoId, ...guard.args] },
  ];
  if (next.people.successorLevel !== cur.settings.people.successorLevel) {
    stmts.push({
      sql: `UPDATE learning SET level = ?, rev = rev + 1, updated_at = ? WHERE demo_id = ? AND ${guard.sql}`,
      args: [next.people.successorLevel, now, demoId, ...guard.args],
    });
  }
  const results = await db.batch(stmts, "write");
  if (results[0].rowsAffected !== 1) throw new ServiceError(409, MSG_SETTINGS_CONFLICT);
  return { ...(await getSettingsView(db, demoId, role)), invalidated: true };
}

/** PUT /api/settings：body { settings, rev } */
export async function saveSettings(
  db: Client,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<SettingsSaveResponse> {
  const next = validateSettings(body.settings);
  const rev = validateRev(body.rev);
  return writeSettings(db, demoId, role, next, rev);
}

/** POST /api/settings/reset：body { rev }。つぐみの初期値を書く（PUT と同じ扱い） */
export async function resetSettings(
  db: Client,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<SettingsSaveResponse> {
  const rev = validateRev(body.rev);
  return writeSettings(db, demoId, role, validateSettings(cloneSettings(TSUGUMI_SETTINGS)), rev);
}

// ---- 呼び出し側で使う小道具 ----

/** 業種の型（設定の業種から） */
export function presetOf(s: CompanySettings) {
  return INDUSTRY_PRESETS[s.industry];
}

// ---- 画面（サーバーコンポーネント）用。demoId・role はサーバーでクッキーから読んだ値（getSession()）を渡すこと ----

/** 設定画面用（GET /api/settings と同じ中身） */
export async function getCompanySettings(demoId: string, role: Role): Promise<SettingsView> {
  return getSettingsView(await getDb(), demoId, role);
}

/** 比較画面・資料の数字の表（設定の決算の数字から計算） */
export async function getFinancialSummaryForDemo(demoId: string): Promise<FinancialSummary> {
  return getFinancialSummary((await getCompanySettingsFrom(await getDb(), demoId)).financials);
}

/** 踏ん張れば伸びる余地。飲食店以外は null（出さない） */
export async function getUpsideSummaryForDemo(demoId: string): Promise<UpsideSummary | null> {
  return getUpsideSummary(await getCompanySettingsFrom(await getDb(), demoId));
}
