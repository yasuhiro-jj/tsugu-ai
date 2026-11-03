import "server-only";

// ③ 90日計画（先代・後継者どちらでも作成・閲覧・編集できる「二人の共通計画」）：
// POST /api/plan、POST・DELETE /api/plan/action、getActionPlan。
// - 診断が無ければ作らない（409）
// - AI の出力はアプリが検証：owner は 先代|後継者|二人 のみ、phase は 1-30|31-60|61-90、
//   due は開始日から見てその phase の範囲内（外れたら phase の末日に丸める）、5〜8件
// - id はサーバーが付与、status は「未着手」で始める
// - すべて demo_id で絞る

import { randomBytes } from "node:crypto";
import type { Client } from "@libsql/client";
import type { ActionPlanState, ActionStatus, PlanAction } from "./plan-types";
import { MSG_CONFLICT, ServiceError } from "./errors";
import { getDb } from "./db";
import { getCourses } from "./courses";
import { getDiagnosisFrom } from "./diagnosis";
import { getLearningStateFrom } from "./learning";
import { ACTION_EXAMPLES, ACTION_PLAN_SYSTEM_TEMPLATE, fillPlanTemplate, tagRef } from "./prompts/plan";
import { arr, callJsonAi, dataBlock, DATA_NOTE, obj, str, type AiDeps } from "./ai/json-ai";
import { jstToday, nowIso } from "./plan-store";
import { usageDayKey } from "./ai/usage";
import type { Role } from "./role";

export const MSG_NEED_DIAGNOSIS = "先に認識差の診断を行ってください";
export const ACTION_PLAN_MAX_TOKENS = 3000;
export const ACTIONS_MIN = 5;
export const ACTIONS_MAX = 8;

type Owner = PlanAction["owner"];
type Phase = PlanAction["phase"];
const OWNERS: readonly Owner[] = ["先代", "後継者", "二人"];
const PHASES: readonly Phase[] = ["1-30", "31-60", "61-90"];
const STATUSES: readonly ActionStatus[] = ["未着手", "進行中", "完了"];

// ---- 日付 ----

/** YYYY-MM-DD の実在する日付か */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** phase の日付の範囲（開始日を1日目とする）。1-30 → 開始日〜開始日+29 */
export function phaseRange(start: string, phase: Phase): { from: string; to: string } {
  const offset = phase === "1-30" ? 0 : phase === "31-60" ? 30 : 60;
  return { from: addDays(start, offset), to: addDays(start, offset + 29) };
}

/** 日付がどの phase に入るか（90日の外なら null） */
export function phaseOf(start: string, date: string): Phase | null {
  for (const p of PHASES) {
    const r = phaseRange(start, p);
    if (date >= r.from && date <= r.to) return p;
  }
  return null;
}

function validateStartDate(value: unknown): string {
  const today = jstToday();
  if (value === undefined) return today;
  if (!isIsoDate(value)) throw new ServiceError(400, "開始日は YYYY-MM-DD の形で指定してください");
  if (value < addDays(today, -365) || value > addDays(today, 365)) {
    throw new ServiceError(400, "開始日は今日から1年以内の日付にしてください");
  }
  return value;
}

function newActionId(): string {
  return `a_${randomBytes(8).toString("hex")}`;
}

// ---- AI の出力の検証 ----

const s = { type: "string" } as const;
export const ACTION_PLAN_SCHEMA = {
  type: "object",
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: s,
          owner: { type: "string", enum: OWNERS },
          due: s,
          phase: { type: "string", enum: PHASES },
          linked_gap: s,
          linked_course: s,
          status: { type: "string", enum: ["未着手"] },
        },
        required: ["title", "owner", "due", "phase", "linked_gap", "linked_course", "status"],
        additionalProperties: false,
      },
    },
    message: s,
  },
  required: ["actions", "message"],
  additionalProperties: false,
} as const;

export function parseActionPlan(
  v: Record<string, unknown>,
  startDate: string,
  makeId: () => string = newActionId,
): { actions: PlanAction[]; message: string } | null {
  const message = str(v.message, 600);
  if (!message || !Array.isArray(v.actions)) return null;
  const actions: PlanAction[] = [];
  for (const x of arr(v.actions)) {
    const o = obj(x);
    if (!o) continue;
    const title = str(o.title, 200);
    const owner = o.owner as Owner;
    if (!title || !OWNERS.includes(owner)) continue;
    let phase: Phase | null = PHASES.includes(o.phase as Phase) ? (o.phase as Phase) : null;
    const dueRaw = isIsoDate(o.due) ? o.due : null;
    if (!phase && dueRaw) phase = phaseOf(startDate, dueRaw);
    if (!phase) continue;
    const range = phaseRange(startDate, phase);
    const due = dueRaw && dueRaw >= range.from && dueRaw <= range.to ? dueRaw : range.to;
    actions.push({
      id: makeId(),
      title,
      owner,
      due,
      phase,
      linked_gap: str(o.linked_gap, 200) ?? "",
      linked_course: str(o.linked_course, 200) ?? "",
      status: "未着手",
    });
    if (actions.length >= ACTIONS_MAX) break;
  }
  if (actions.length < ACTIONS_MIN) return null;
  actions.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return { actions, message };
}

// ---- 保存・取得 ----

const EMPTY: ActionPlanState = { startDate: null, actions: [], message: null, createdAt: null };

/** DB に保存した行動の一覧を読む。形が合わない行動は捨てる（REV-009：保存した JSON も軽く確かめる） */
function parseActions(raw: unknown): PlanAction[] {
  if (typeof raw !== "string") return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: PlanAction[] = [];
  for (const it of v) {
    if (it === null || typeof it !== "object" || Array.isArray(it)) continue;
    const a = it as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.title !== "string" || typeof a.due !== "string") continue;
    if (!OWNERS.includes(a.owner as PlanAction["owner"])) continue;
    if (!PHASES.includes(a.phase as PlanAction["phase"])) continue;
    out.push({
      id: a.id,
      title: a.title,
      owner: a.owner as PlanAction["owner"],
      due: a.due,
      phase: a.phase as PlanAction["phase"],
      linked_gap: typeof a.linked_gap === "string" ? a.linked_gap : "",
      linked_course: typeof a.linked_course === "string" ? a.linked_course : "",
      status: STATUSES.includes(a.status as PlanAction["status"]) ? (a.status as PlanAction["status"]) : "未着手",
    });
  }
  return out;
}

async function loadRow(db: Client, demoId: string) {
  const rs = await db.execute({
    sql: `SELECT start_date, actions, message, rev, created_at, diagnosis_created_at FROM action_plans WHERE demo_id = ?`,
    args: [demoId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    state: {
      startDate: String(row.start_date),
      actions: parseActions(row.actions),
      message: row.message === null || row.message === undefined ? null : String(row.message),
      createdAt: String(row.created_at),
    } satisfies ActionPlanState,
    rev: Number(row.rev ?? 0),
    diagnosisCreatedAt:
      row.diagnosis_created_at === null || row.diagnosis_created_at === undefined ? null : String(row.diagnosis_created_at),
  };
}

/**
 * 今の有効な診断から作られた計画だけを返す（SEC-101 の読み出し側の確認・SEC-102）。
 * 有効な診断が無い、または計画を作ったときの診断（diagnosis_created_at）と今の診断が違えば、計画は返さずに消す。
 * 消すのに失敗しても返さない。
 */
async function loadValidRow(db: Client, demoId: string) {
  const diag = await getDiagnosisFrom(db, demoId);
  const loaded = await loadRow(db, demoId);
  if (!loaded) return null;
  if (diag && loaded.diagnosisCreatedAt === diag.createdAt) return loaded;
  try {
    // 古い計画だけを消す（同時に今の診断から作られた計画は消さない）
    await db.execute({
      sql: diag
        ? `DELETE FROM action_plans WHERE demo_id = ? AND (diagnosis_created_at IS NULL OR diagnosis_created_at <> ?)`
        : `DELETE FROM action_plans WHERE demo_id = ?`,
      args: diag ? [demoId, diag.createdAt] : [demoId],
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", where: "plan.invalidate", error: err instanceof Error ? err.name : "UnknownError" }));
  }
  return null;
}

export async function getActionPlanFrom(db: Client, demoId: string): Promise<ActionPlanState> {
  return (await loadValidRow(db, demoId))?.state ?? EMPTY;
}

/** 画面（サーバーコンポーネント）用。demoId はサーバーでクッキーから読んだ値を渡すこと。 */
export async function getActionPlan(demoId: string): Promise<ActionPlanState> {
  return getActionPlanFrom(await getDb(), demoId);
}

// ---- 作成（作り直し） ----

export async function createActionPlan(
  deps: AiDeps,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<ActionPlanState> {
  const startDate = validateStartDate(body.startDate);
  const diag = await getDiagnosisFrom(deps.db, demoId);
  if (!diag) throw new ServiceError(409, MSG_NEED_DIAGNOSIS);
  const learning = await getLearningStateFrom(deps.db, demoId);
  const titles = new Map(getCourses().map((c) => [c.id, c.title]));
  // 学習プランは「講座（course_id とタイトル）・順番・週」だけを渡す。reason・linked_gap・message・wants は渡さない
  // （後継者の希望や学習の理由が、先代も見る90日計画へ流れないため。SEC-104）
  // 診断（directions を含む）は二人が共有する診断そのものなので、そのまま渡す。directions は共有済み・確定の要約だけから作られている
  const learningPlan = learning.current
    ? learning.current.plan.plan.map((p) => ({
        順番: p.order,
        course_id: p.course_id,
        講座: titles.get(p.course_id) ?? p.course_id,
        週: p.week,
      }))
    : null;

  const system = [
    fillPlanTemplate(ACTION_PLAN_SYSTEM_TEMPLATE, {
      diagnosis: tagRef("diagnosis"),
      learning_plan: learningPlan ? tagRef("learning_plan") : "未作成",
      action_examples: "\n" + ACTION_EXAMPLES.map((e) => `  - ${e}`).join("\n"),
      start_date: startDate,
    }),
    DATA_NOTE,
    `# アプリからの補足\n- due は開始日（${startDate}）を1日目として、phase の範囲内の日付にしてください（1-30：${phaseRange(startDate, "1-30").from}〜${phaseRange(startDate, "1-30").to}、31-60：${phaseRange(startDate, "31-60").from}〜${phaseRange(startDate, "31-60").to}、61-90：${phaseRange(startDate, "61-90").from}〜${phaseRange(startDate, "61-90").to}）。\n- 期限は画面の「期限」欄に表示されるので、title には日付を書かない（「誰が・何を」を書き、「いつまでに」は due で表す）。
- 診断の directions.tryNew（新しく試したいこと）があれば、小さく試す行動を1つ、31-60 か 61-90 の期間に入れる。成功を約束する書き方にしない。`,
  ].join("\n\n");
  const blocks = ["次の入力をもとに、出力形式どおりの JSON だけを返してください。", dataBlock("diagnosis", diag.diagnosis)];
  if (learningPlan) blocks.push(dataBlock("learning_plan", learningPlan));

  const out = await callJsonAi(
    deps,
    demoId,
    role,
    {
      purpose: "action_plan",
      system,
      messages: [{ role: "user", content: blocks.join("\n\n") }],
      schema: ACTION_PLAN_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: ACTION_PLAN_MAX_TOKENS,
    },
    (v) => parseActionPlan(v, startDate),
  );

  const now = nowIso();
  await deps.db.execute({
    sql: `INSERT INTO action_plans (demo_id, start_date, actions, message, diagnosis_created_at, rev, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(demo_id) DO UPDATE SET start_date = excluded.start_date, actions = excluded.actions,
            message = excluded.message, diagnosis_created_at = excluded.diagnosis_created_at,
            rev = action_plans.rev + 1, created_at = excluded.created_at, updated_at = excluded.updated_at`,
    args: [demoId, startDate, JSON.stringify(out.actions), out.message, diag.createdAt, now, now],
  });
  // AI を待っている間に共有が取り消された／診断が作り直されていたら、作った計画は残さない（SEC-102）
  const saved = await loadValidRow(deps.db, demoId);
  if (!saved) throw new ServiceError(409, MSG_PLAN_CHANGED);
  return saved.state;
}

// ---- 1件の編集・削除（POST / DELETE /api/plan/action） ----
// 先代・後継者のどちらでも編集できる（計画は二人のもの）。すべて demo_id で絞り、
// 書き込みは「読んだときの rev」と「計画を作ったときの診断（diagnosis_created_at）」の両方が変わっていないときだけ行う。
// どちらかが変わっていたら 409（SEC-102：途中で診断が作り直された計画は書き換えない）。

/** 行動の文の上限（AI の出力の検証 parseActionPlan の title と同じ） */
export const ACTION_TITLE_MAX = 200;
export const MSG_LAST_ACTION = "90日計画には行動が1件以上必要なため、最後の1件は消せません。先に別の行動を残すか、文を書き換えてください";
export const MSG_PLAN_CHANGED = "診断が変わりました。もう一度90日計画を作ってください";

const PHASE_LABEL: Record<Phase, string> = { "1-30": "1〜30日目", "31-60": "31〜60日目", "61-90": "61〜90日目" };

/** 制御文字・改行・見えない書式文字（画面の表示を崩すもの）を含むか */
// \p{Cf} は向きの制御（U+200E/200F・U+202A〜202E・U+2066〜2069・U+061C）、幅のない文字（U+200B〜200D）、U+FEFF などをまとめて含む。U+2028/2029 は行区切り
const BAD_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

function validateActionId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || id.length > 40) {
    throw new ServiceError(400, "行動の指定が正しくありません");
  }
  return id;
}

/** 行動の文：前後の空白を取り、空・長すぎ・制御文字は弾く（切り詰めはしない） */
export function validateActionTitle(v: unknown): string {
  if (typeof v !== "string") throw new ServiceError(400, "行動の文を入力してください");
  const t = v.trim();
  if (t.length === 0) throw new ServiceError(400, "行動の文を入力してください");
  if (BAD_CHARS.test(t)) throw new ServiceError(400, "行動の文に使えない文字（改行・制御文字など）が含まれています");
  if (Array.from(t).length > ACTION_TITLE_MAX) {
    throw new ServiceError(400, `行動の文は${ACTION_TITLE_MAX}文字以内にしてください`);
  }
  return t;
}

const byDue = (x: PlanAction, y: PlanAction) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0);

// ---- 書き換えの回数制限（AI を使わない書き込み。AI の回数とは別） ----

/** 90日計画の書き換え（POST・DELETE /api/plan/action）の、デモ用 ID ごとの1日あたりの上限 */
export const PLAN_EDITS_DAILY_LIMIT = 300;
export const MSG_PLAN_EDIT_LIMIT = `90日計画の書き換えは1日${PLAN_EDITS_DAILY_LIMIT}回までです。日本時間の朝9時に回数が戻ります`;

/**
 * 書き換えを1回分数える（上限内なら +1）。上限を超えたら 429。
 * 1日の区切りは usageDayKey（AI の1日上限と同じ。日本時間の朝9時）。条件つき UPSERT は原子的なので同時に来ても上限を超えない。
 * デモのやり直しでは消さない（lib/retention.ts が前日以前の行だけを消す）
 */
export async function reservePlanEdit(
  db: Client,
  demoId: string,
  limit: number = PLAN_EDITS_DAILY_LIMIT,
): Promise<void> {
  const rs = await db.execute({
    sql: `INSERT INTO plan_edit_usage (demo_id, day, calls) VALUES (?, ?, 1)
          ON CONFLICT(demo_id, day) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    args: [demoId, usageDayKey(nowIso()), limit],
  });
  if (rs.rowsAffected !== 1) throw new ServiceError(429, MSG_PLAN_EDIT_LIMIT);
}

/** 有効な計画を読み、change で作った行動の一覧を条件つきで保存する（書き換えの回数を先に数える） */
async function mutateActions(
  db: Client,
  demoId: string,
  change: (state: ActionPlanState) => PlanAction[],
): Promise<ActionPlanState> {
  await reservePlanEdit(db, demoId);
  const loaded = await loadValidRow(db, demoId);
  if (!loaded) throw new ServiceError(404, "90日計画がまだありません");
  const actions = change(loaded.state);
  actions.sort(byDue);
  const rs = await db.execute({
    sql: `UPDATE action_plans SET actions = ?, rev = rev + 1, updated_at = ?
          WHERE demo_id = ? AND rev = ? AND diagnosis_created_at = ?
            AND diagnosis_created_at = (SELECT created_at FROM diagnoses WHERE diagnoses.demo_id = ?)`,
    args: [JSON.stringify(actions), nowIso(), demoId, loaded.rev, loaded.diagnosisCreatedAt, demoId],
  });
  if (rs.rowsAffected !== 1) {
    // 書き込めなかった理由を見分ける：診断が変わった（作り直し・取り消し）なら作り直しを案内、それ以外は重なり
    const diag = await getDiagnosisFrom(db, demoId);
    const now = await loadRow(db, demoId);
    if (!diag || !now || diag.createdAt !== loaded.diagnosisCreatedAt || now.diagnosisCreatedAt !== loaded.diagnosisCreatedAt) {
      throw new ServiceError(409, MSG_PLAN_CHANGED);
    }
    throw new ServiceError(409, MSG_CONFLICT);
  }
  return getActionPlanFrom(db, demoId);
}

/** POST /api/plan/action：body { id, title?, status?, owner?, due? } のうち指定したものだけ変える */
export async function updateAction(db: Client, demoId: string, body: Record<string, unknown>): Promise<ActionPlanState> {
  const id = validateActionId(body.id);
  if (body.title === undefined && body.status === undefined && body.owner === undefined && body.due === undefined) {
    throw new ServiceError(400, "変更する内容を指定してください");
  }
  const title = body.title === undefined ? undefined : validateActionTitle(body.title);
  if (body.status !== undefined && !STATUSES.includes(body.status as ActionStatus)) {
    throw new ServiceError(400, "状態の指定が正しくありません");
  }
  if (body.owner !== undefined && !OWNERS.includes(body.owner as Owner)) {
    throw new ServiceError(400, "担当の指定が正しくありません");
  }
  if (body.due !== undefined && !isIsoDate(body.due)) {
    throw new ServiceError(400, "期限は YYYY-MM-DD の形で指定してください");
  }

  return mutateActions(db, demoId, (state) => {
    const idx = state.actions.findIndex((a) => a.id === id);
    if (idx < 0) throw new ServiceError(404, "その行動は見つかりませんでした");
    const a = { ...state.actions[idx] };
    if (title !== undefined) a.title = title;
    if (body.status !== undefined) a.status = body.status as ActionStatus;
    if (body.owner !== undefined) a.owner = body.owner as Owner;
    if (body.due !== undefined) {
      // 期限はその行動の期間の中だけ（期間をまたいで別の期間へ移さない）
      const due = body.due as string;
      const r = phaseRange(state.startDate!, a.phase);
      if (due < r.from || due > r.to) {
        throw new ServiceError(400, `期限は${PHASE_LABEL[a.phase]}（${r.from}〜${r.to}）の中の日付にしてください`);
      }
      a.due = due;
    }
    const actions = [...state.actions];
    actions[idx] = a;
    return actions;
  });
}

/** DELETE /api/plan/action：body { id }。最後の1件は消せない */
export async function deleteAction(db: Client, demoId: string, body: Record<string, unknown>): Promise<ActionPlanState> {
  const id = validateActionId(body.id);
  return mutateActions(db, demoId, (state) => {
    if (!state.actions.some((a) => a.id === id)) throw new ServiceError(404, "その行動は見つかりませんでした");
    if (state.actions.length <= 1) throw new ServiceError(400, MSG_LAST_ACTION);
    return state.actions.filter((a) => a.id !== id);
  });
}
