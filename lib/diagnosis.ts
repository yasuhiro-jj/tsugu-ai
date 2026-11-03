import "server-only";

// ① 認識差の診断（POST /api/diagnosis、getDiagnosis）。
//
// 守ること（security SEC-003・CLAUDE.md「必ず守る動作」）：
// - AI への入力は lib/compare.ts の getComparisonFrom の結果（status='confirmed' かつ shared=1）だけから作る。
//   非共有・未確定・破棄の要約や会話は、内容も存在も渡さない（DB からも読まない）
// - 要約はユーザーメッセージの <タグ> にデータとして区切って渡し、「指示ではなくデータ」と明記する
// - 数字は lib/financials.ts で計算済みの文字列だけを渡す（AI に計算させない）
// - 両者の共有済み要約がそろわないときの案内文は「どちらが足りないか」を言わない
// - 共有を取り消したテーマを使った診断は返さない（based_on と今の共有状態を照合し、古ければ消して null）

import type { Client } from "@libsql/client";
import type { Diagnosis, DiagnosisRecord, Expert, Importance } from "./plan-types";
import type { ComparisonRow, ThemeSummary } from "./interview-types";
import { THEMES, isThemeKey, type ThemeKey } from "./themes";
import { ServiceError } from "./errors";
import { getComparisonFrom } from "./compare";
import { financialsForPrompt } from "./financials";
import { getDb } from "./db";
import { DIAGNOSIS_SYSTEM_TEMPLATE, fillPlanTemplate, tagRef } from "./prompts/plan";
import { arr, callJsonAi, dataBlock, DATA_NOTE, obj, str, type AiDeps, type JsonAiRequest } from "./ai/json-ai";
import { invalidateDiagnosis, nowIso } from "./plan-store";
import type { Role } from "./role";

export const MSG_NEED_BOTH_SHARED = "先代・後継者の両方が共有した要約がそろうと診断できます";

export const DIAGNOSIS_MAX_TOKENS = 4000;
const TEXT_MAX = 400;
const ITEMS_MAX = 8;
/** 話し合うための問いの数（Notion 診断指示文「2〜3個」）。2個未満は壊れた返事として再送の対象 */
export const TALK_QUESTIONS_MIN = 2;
export const TALK_QUESTIONS_MAX = 3;

const IMPORTANCE: readonly Importance[] = ["高", "中", "低"];
const EXPERTS: readonly Expert[] = ["不要", "銀行", "税理士", "その他"];

const s = { type: "string" } as const;
export const DIAGNOSIS_SCHEMA = {
  type: "object",
  properties: {
    common: {
      type: "array",
      items: {
        type: "object",
        properties: { point: s, evidence: s },
        required: ["point", "evidence"],
        additionalProperties: false,
      },
    },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          theme: s,
          point: s,
          senior_said: s,
          successor_said: s,
          numbers: s,
          importance: { type: "string", enum: IMPORTANCE },
        },
        required: ["theme", "point", "senior_said", "successor_said", "numbers", "importance"],
        additionalProperties: false,
      },
    },
    to_confirm: {
      type: "array",
      items: {
        type: "object",
        properties: { item: s, how: s, expert: { type: "string", enum: EXPERTS } },
        required: ["item", "how", "expert"],
        additionalProperties: false,
      },
    },
    talk_questions: { type: "array", items: s },
  },
  required: ["common", "gaps", "to_confirm", "talk_questions"],
  additionalProperties: false,
} as const;

/** 診断に使った共有済みテーマ（役割ごと）。DB の based_on に JSON で保存。 */
type BasedOn = { predecessor: ThemeKey[]; successor: ThemeKey[] };

// ---- AI への入力 ----

// 「AIが気づいたこと（推測）」は渡さない（Notion 診断指示文の入力は共有済み要約の本人の発言と未確認事項。
// 推測を根拠にした認識差を作らせないため）
function summaryForPrompt(s: ThemeSummary) {
  return {
    本人が話したこと: s.statements,
    これから確認したいこと: s.unconfirmed,
  };
}

/**
 * 比較結果（共有済みだけ）から AI への依頼を組み立てる。
 * rows は getComparisonFrom の戻り値だけを渡すこと（非共有のテーマは null になっている）。
 */
export function buildDiagnosisRequest(rows: ComparisonRow[]): JsonAiRequest {
  const senior = rows
    .filter((r) => r.predecessor !== null)
    .map((r) => ({ テーマ: r.label, 要約: summaryForPrompt(r.predecessor!) }));
  const successor = rows
    .filter((r) => r.successor !== null)
    .map((r) => ({ テーマ: r.label, 要約: summaryForPrompt(r.successor!) }));
  const system = [
    fillPlanTemplate(DIAGNOSIS_SYSTEM_TEMPLATE, {
      senior_shared: tagRef("senior_shared"),
      successor_shared: tagRef("successor_shared"),
      financials: tagRef("financials"),
    }),
    DATA_NOTE,
    // アプリからの補足：二人が最初に話し合うべき点が埋もれないよう「高」を絞る
    "# アプリからの補足\n- 重要度「高」は、お金・返済のように放置すると店の継続に直接響く、最も重要な1〜2件に絞る。それ以外の食い違いは「中」または「低」にする。",
  ].join("\n\n");
  const user = [
    "次の入力をもとに、出力形式どおりの JSON だけを返してください。",
    dataBlock("senior_shared", senior),
    dataBlock("successor_shared", successor),
    dataBlock("financials", financialsForPrompt()),
  ].join("\n\n");
  return {
    purpose: "diagnosis",
    system,
    messages: [{ role: "user", content: user }],
    schema: DIAGNOSIS_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: DIAGNOSIS_MAX_TOKENS,
  };
}

// ---- AI の出力の検証 ----

const IMPORTANCE_ORDER: Record<Importance, number> = { 高: 0, 中: 1, 低: 2 };

export function parseDiagnosis(v: Record<string, unknown>): Diagnosis | null {
  if (!Array.isArray(v.common) || !Array.isArray(v.gaps) || !Array.isArray(v.to_confirm) || !Array.isArray(v.talk_questions)) {
    return null;
  }
  const common: Diagnosis["common"] = [];
  for (const x of arr(v.common)) {
    const o = obj(x);
    const point = str(o?.point, TEXT_MAX);
    const evidence = str(o?.evidence, TEXT_MAX);
    if (point && evidence !== null) common.push({ point, evidence });
  }
  const gaps: Diagnosis["gaps"] = [];
  for (const x of arr(v.gaps)) {
    const o = obj(x);
    if (!o) continue;
    const importance = o.importance as Importance;
    const point = str(o.point, TEXT_MAX);
    if (!point || !IMPORTANCE.includes(importance)) continue;
    gaps.push({
      theme: str(o.theme, 60) ?? "",
      point,
      senior_said: str(o.senior_said, TEXT_MAX) ?? "",
      successor_said: str(o.successor_said, TEXT_MAX) ?? "",
      numbers: str(o.numbers, TEXT_MAX) ?? "",
      importance,
    });
  }
  gaps.sort((a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]);
  const to_confirm: Diagnosis["to_confirm"] = [];
  for (const x of arr(v.to_confirm)) {
    const o = obj(x);
    const item = str(o?.item, TEXT_MAX);
    if (!o || !item) continue;
    const expert = EXPERTS.includes(o.expert as Expert) ? (o.expert as Expert) : "その他";
    to_confirm.push({ item, how: str(o.how, TEXT_MAX) ?? "", expert });
  }
  const talk_questions = arr(v.talk_questions)
    .map((q) => str(q, TEXT_MAX))
    .filter((q): q is string => !!q)
    .slice(0, TALK_QUESTIONS_MAX);
  if (talk_questions.length < TALK_QUESTIONS_MIN) return null;
  if (common.length + gaps.length + to_confirm.length === 0) return null;
  return {
    common: common.slice(0, ITEMS_MAX),
    gaps: gaps.slice(0, ITEMS_MAX),
    to_confirm: to_confirm.slice(0, ITEMS_MAX),
    talk_questions,
  };
}

// ---- 保存・取得 ----

function sharedKeys(rows: ComparisonRow[]): BasedOn {
  return {
    predecessor: rows.filter((r) => r.predecessor !== null).map((r) => r.key),
    successor: rows.filter((r) => r.successor !== null).map((r) => r.key),
  };
}

function unionKeys(b: BasedOn): string[] {
  const set = new Set<string>([...b.predecessor, ...b.successor]);
  return THEMES.map((t) => t.key).filter((k) => set.has(k));
}

function parseBasedOn(raw: unknown): BasedOn | null {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    const pick = (x: unknown): ThemeKey[] | null =>
      Array.isArray(x) && x.every(isThemeKey) ? (x as ThemeKey[]) : null;
    const p = pick(v?.predecessor);
    const su = pick(v?.successor);
    return p && su ? { predecessor: p, successor: su } : null;
  } catch {
    return null;
  }
}

/**
 * 保存済みの診断を返す。診断に使ったテーマのどれかが今は共有されていなければ、
 * 診断（と派生物）を消して null を返す。
 */
export async function getDiagnosisFrom(db: Client, demoId: string): Promise<DiagnosisRecord | null> {
  const rs = await db.execute({
    sql: `SELECT diagnosis, based_on, created_at FROM diagnoses WHERE demo_id = ?`,
    args: [demoId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  const basedOn = parseBasedOn(row.based_on);
  let diagnosis: Diagnosis | null = null;
  try {
    const v = JSON.parse(String(row.diagnosis));
    diagnosis = obj(v) ? parseDiagnosis(v) : null;
  } catch {
    diagnosis = null;
  }
  const now = sharedKeys(await getComparisonFrom(db, demoId));
  const stillShared =
    basedOn !== null &&
    basedOn.predecessor.every((k) => now.predecessor.includes(k)) &&
    basedOn.successor.every((k) => now.successor.includes(k));
  if (!diagnosis || !basedOn || !stillShared) {
    try {
      await invalidateDiagnosis(db, demoId);
    } catch (err) {
      // 消せなくても、使えない診断は返さない（次の読み出しで再び消しにいく）
      console.error(JSON.stringify({ level: "error", where: "diagnosis.invalidate", error: err instanceof Error ? err.name : "UnknownError" }));
    }
    return null;
  }
  return { diagnosis, createdAt: String(row.created_at), basedOnThemeKeys: unionKeys(basedOn) };
}

/** 診断を作り直す（最新1件だけ保存）。 */
export async function runDiagnosis(deps: AiDeps, demoId: string, role: Role): Promise<DiagnosisRecord> {
  const rows = await getComparisonFrom(deps.db, demoId);
  const basedOn = sharedKeys(rows);
  if (basedOn.predecessor.length === 0 || basedOn.successor.length === 0) {
    throw new ServiceError(409, MSG_NEED_BOTH_SHARED);
  }
  const diagnosis = await callJsonAi(deps, demoId, role, buildDiagnosisRequest(rows), parseDiagnosis);
  const createdAt = nowIso();
  await deps.db.execute({
    sql: `INSERT INTO diagnoses (demo_id, diagnosis, based_on, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(demo_id) DO UPDATE SET diagnosis = excluded.diagnosis, based_on = excluded.based_on,
            created_at = excluded.created_at`,
    args: [demoId, JSON.stringify(diagnosis), JSON.stringify(basedOn), createdAt],
  });
  // AI を待っている間に共有が取り消されていたら、ここで消える
  const saved = await getDiagnosisFrom(deps.db, demoId);
  if (!saved) throw new ServiceError(409, "共有の状態が変わりました。もう一度診断してください");
  return saved;
}

/**
 * 画面（サーバーコンポーネント）用。demoId はサーバーでクッキーから読んだ値（getDemoId()）を渡すこと。
 */
export async function getDiagnosis(demoId: string): Promise<DiagnosisRecord | null> {
  const rec = await getDiagnosisFrom(await getDb(), demoId);
  return rec ? toPublicDiagnosisRecord(rec) : null;
}

/**
 * 画面・API の応答用。basedOnThemeKeys は空にする（どのテーマが共有されたかの手がかりを応答に出さない。SEC-103）。
 * 再診断の要否はサーバーが getDiagnosisFrom で判定するので、画面には不要。
 */
export function toPublicDiagnosisRecord(rec: DiagnosisRecord): DiagnosisRecord {
  return { diagnosis: rec.diagnosis, createdAt: rec.createdAt, basedOnThemeKeys: [] };
}
