import "server-only";

// ② 学習プラン（後継者のみ）：POST /api/learning/plan・/quiz・/explain、getLearningState。
// - すべて demo_id で絞る（役割の確認は Route Handler 側で「後継者のみ」）
// - 講座は lib/courses.ts の一覧からだけ。AI が一覧外の course_id を返したら除外、完了済みも除外、
//   診断があるときは認識差の重要度で並べ替え（rankCoursesByDiagnosis）、
//   「復習をおすすめ」の講座を先頭へ並べ替え、order / week はアプリが振り直す
// - 採点はルールベース（lib/courses.ts）。講座1（cashflow）を完了したら Lv1 → Lv2
// - 解説：正誤はアプリが判定し、AI には正解と記事本文だけを渡して説明させる
// - 本人の希望（wants）は利用者の入力なので、AI にはデータとして区切って渡す

import type { Client } from "@libsql/client";
import type {
  CourseId,
  CourseProgress,
  Diagnosis,
  CourseProgressStatus,
  LearningPlan,
  LearningState,
} from "./plan-types";
import { MSG_CONFLICT, ServiceError } from "./errors";
import { getDb } from "./db";
import { DEMO_PROFILES } from "./demo-profiles";
import {
  COURSE_GAP_KEYWORDS,
  COURSE_IDS,
  getCourses,
  getQuestionForExplain,
  gradeQuiz,
  isCourseId,
  validateAnswers,
  type GradeResult,
} from "./courses";
import { getDiagnosisFrom } from "./diagnosis";
import { EXPLAIN_SYSTEM, LEARNING_SYSTEM_TEMPLATE, fillPlanTemplate, tagRef } from "./prompts/plan";
import { arr, callJsonAi, charLen, dataBlock, DATA_NOTE, obj, str, type AiDeps } from "./ai/json-ai";
import { invalidateDiagnosis, nowIso } from "./plan-store";
import type { Role } from "./role";

export const DEFAULT_WANTS = "ランチの売上を伸ばしたい";
export const WANTS_MAX_CHARS = 200;
export const LEARNING_MAX_TOKENS = 1500;
export const EXPLAIN_MAX_TOKENS = 800;
/** 解説の Route は maxDuration 60 秒。AI に使う時間はそれより短く（SEC-105） */
export const EXPLAIN_BUDGET_MS = 50_000;
const EXPLAIN_MAX_CHARS = 600;

type Level = LearningState["level"];
const LEVELS: readonly Level[] = ["Lv1", "Lv2", "Lv3", "Lv4"];
const PROGRESS_STATUSES: readonly CourseProgressStatus[] = ["未着手", "学習中", "完了", "復習をおすすめ"];

type StoredPlan = NonNullable<LearningState["current"]>;

// ---- 読み込み ----

type LearningRow = { level: Level; wants: string; current: StoredPlan | null; previous: StoredPlan | null; rev: number };

/** DB に保存した学習プランを読む。形が違う項目は捨てる（REV-009：保存した JSON も軽く確かめる） */
function parseStoredPlan(raw: unknown): StoredPlan | null {
  if (typeof raw !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = obj(v);
  const p = o ? obj(o.plan) : null;
  if (!o || !p || !Array.isArray(p.plan)) return null;
  const items: LearningPlan["plan"] = [];
  for (const it of p.plan) {
    const x = obj(it);
    if (!x || !isCourseId(x.course_id)) continue;
    items.push({
      order: Number.isFinite(Number(x.order)) ? Number(x.order) : items.length + 1,
      course_id: x.course_id,
      week: Number.isFinite(Number(x.week)) ? Number(x.week) : 1,
      reason: typeof x.reason === "string" ? x.reason : "",
      linked_gap: typeof x.linked_gap === "string" ? x.linked_gap : "",
    });
  }
  return {
    plan: { plan: items, message: typeof p.message === "string" ? p.message : "" },
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    usedDiagnosis: o.usedDiagnosis === true,
  };
}

async function loadLearningRow(db: Client, demoId: string): Promise<LearningRow | null> {
  const rs = await db.execute({
    sql: `SELECT level, wants, current_plan, previous_plan, rev FROM learning WHERE demo_id = ?`,
    args: [demoId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return {
    level: parseLevel(row.level),
    wants: typeof row.wants === "string" ? row.wants : DEFAULT_WANTS,
    current: parseStoredPlan(row.current_plan),
    previous: parseStoredPlan(row.previous_plan),
    rev: Number(row.rev ?? 0),
  };
}

function parseLevel(v: unknown): Level {
  return LEVELS.includes(v as Level) ? (v as Level) : "Lv1";
}

/**
 * 後継者の今の知識レベル（learning.level。行が無い・値が正しくなければ Lv1）。
 * 講座の解説・講座の質問（lib/learning-ask.ts）・AI参謀（lib/advisor.ts）で共通に使う（REV-005）。demo_id で絞る
 */
export async function getLearningLevel(db: Client, demoId: string): Promise<Level> {
  const rs = await db.execute({ sql: `SELECT level FROM learning WHERE demo_id = ?`, args: [demoId] });
  return parseLevel(rs.rows[0]?.level);
}

async function ensureLearningRow(db: Client, demoId: string): Promise<LearningRow> {
  await db.execute({
    sql: `INSERT OR IGNORE INTO learning (demo_id, level, wants, current_plan, previous_plan, rev, updated_at)
          VALUES (?, 'Lv1', ?, NULL, NULL, 0, ?)`,
    args: [demoId, DEFAULT_WANTS, nowIso()],
  });
  return (await loadLearningRow(db, demoId))!;
}

async function loadProgress(db: Client, demoId: string): Promise<CourseProgress[]> {
  const rs = await db.execute({
    sql: `SELECT course_id, status, score, wrong_article_nos FROM course_progress WHERE demo_id = ?`,
    args: [demoId],
  });
  const map = new Map<CourseId, CourseProgress>();
  for (const row of rs.rows) {
    if (!isCourseId(row.course_id)) continue;
    let wrong: number[] = [];
    try {
      const v = JSON.parse(String(row.wrong_article_nos));
      if (Array.isArray(v)) wrong = v.filter((n): n is number => Number.isInteger(n));
    } catch {
      wrong = [];
    }
    map.set(row.course_id, {
      courseId: row.course_id,
      status: PROGRESS_STATUSES.includes(row.status as CourseProgressStatus)
        ? (row.status as CourseProgressStatus)
        : "未着手",
      score: row.score === null || row.score === undefined ? null : Number(row.score),
      wrongArticleNos: wrong,
    });
  }
  return COURSE_IDS.map(
    (id) => map.get(id) ?? { courseId: id, status: "未着手", score: null, wrongArticleNos: [] },
  );
}

/**
 * 学習の状態。有効な診断が無いのに「診断を使った学習プラン」が残っていたら、返さずに消す（SEC-101 の読み出し側の確認）。
 * 消すのに失敗しても、診断を使ったプランは返さない。
 */
export async function getLearningStateFrom(db: Client, demoId: string): Promise<LearningState> {
  const diag = await getDiagnosisFrom(db, demoId);
  const row = await loadLearningRow(db, demoId);
  let current = row?.current ?? null;
  let previous = row?.previous ?? null;
  if (!diag && (current?.usedDiagnosis || previous?.usedDiagnosis)) {
    try {
      await invalidateDiagnosis(db, demoId);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", where: "learning.invalidate", error: err instanceof Error ? err.name : "UnknownError" }));
    }
    if (current?.usedDiagnosis) current = null;
    if (previous?.usedDiagnosis) previous = null;
    if (!current && previous) {
      current = previous;
      previous = null;
    }
  }
  return {
    level: row?.level ?? "Lv1",
    wants: row?.wants ?? DEFAULT_WANTS,
    current,
    previous,
    progress: await loadProgress(db, demoId),
  };
}

/**
 * 画面（サーバーコンポーネント）用。demoId はサーバーでクッキーから読んだ値を渡すこと。
 * 学習は後継者の画面だけで表示する（役割の確認は呼び出し側で getRole() を見ること）。
 */
export async function getLearningState(demoId: string): Promise<LearningState> {
  return getLearningStateFrom(await getDb(), demoId);
}

// ---- 入力検証 ----

export function validateWants(value: unknown): string {
  if (typeof value !== "string") throw new ServiceError(400, "学びたいことを入力してください");
  const t = value.trim();
  if (charLen(t) === 0) throw new ServiceError(400, "学びたいことを入力してください");
  if (charLen(t) > WANTS_MAX_CHARS) {
    throw new ServiceError(400, `学びたいことは${WANTS_MAX_CHARS}文字以内で入力してください`);
  }
  return t;
}

function validateCourseId(value: unknown): CourseId {
  if (!isCourseId(value)) throw new ServiceError(400, "講座の指定が正しくありません");
  return value;
}

// ---- 学習プラン ----

const s = { type: "string" } as const;
export const LEARNING_SCHEMA = {
  type: "object",
  properties: {
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          order: { type: "integer" },
          course_id: { type: "string", enum: COURSE_IDS },
          week: { type: "integer" },
          reason: s,
          linked_gap: s,
        },
        required: ["order", "course_id", "week", "reason", "linked_gap"],
        additionalProperties: false,
      },
    },
    message: s,
  },
  required: ["plan", "message"],
  additionalProperties: false,
} as const;

const IMPORTANCE_SCORE: Record<Diagnosis["gaps"][number]["importance"], number> = { 高: 3, 中: 2, 低: 1 };

/**
 * 講座の点数＝その講座のキーワード（COURSE_GAP_KEYWORDS）を theme か point に含む認識差の重要度の最大値
 * （高=3・中=2・低=1・該当なし=0）。
 * 根拠：Notion「学習講座コンテンツ v1」の「診断とのつながり」（①資金繰り ②原価 ③試算表）と、
 * Notion デモ会社設定「資金繰りの認識差 → 後継者の学習プランで『資金繰りの基本』が最優先に」。
 * 順番を AI 任せにすると、希望欄や AI が書いた theme の言い方で入れ替わることがあったため、アプリが決める。
 */
export function courseGapScore(courseId: CourseId, diagnosis: Diagnosis): number {
  const keywords = COURSE_GAP_KEYWORDS[courseId];
  let best = 0;
  for (const g of diagnosis.gaps) {
    const text = `${g.theme ?? ""} ${g.point ?? ""}`;
    if (keywords.some((k) => text.includes(k))) best = Math.max(best, IMPORTANCE_SCORE[g.importance] ?? 0);
  }
  return best;
}

/** 点数の高い順、同点なら講座一覧の順（COURSE_IDS：①→②→③）に並べる。AI が書いた reason などは変えない */
function rankCoursesByDiagnosis<T extends { course_id: CourseId }>(items: T[], diagnosis: Diagnosis): T[] {
  const score = new Map(COURSE_IDS.map((id) => [id, courseGapScore(id, diagnosis)]));
  return [...items].sort(
    (a, b) => score.get(b.course_id)! - score.get(a.course_id)! || COURSE_IDS.indexOf(a.course_id) - COURSE_IDS.indexOf(b.course_id),
  );
}

/**
 * AI のプランを検証・整形する。
 * - 一覧外・完了済み・重複の course_id は除外
 * - 診断があるときだけ、認識差の重要度で並べ替え（rankCoursesByDiagnosis）。診断が無いときは AI の順番のまま
 * - 「復習をおすすめ」を先頭へ（上の並べ替えより優先）
 * - order / week は 1 から振り直す（1週間に1講座）
 * - 未完了の講座が残っているのにプランが空なら null（再送の対象）
 */
export function parseLearningPlan(
  v: Record<string, unknown>,
  progress: CourseProgress[],
  diagnosis: Diagnosis | null = null,
): LearningPlan | null {
  const message = str(v.message, 600);
  if (!message || !Array.isArray(v.plan)) return null;
  const statusOf = new Map(progress.map((p) => [p.courseId, p.status]));
  const items = arr(v.plan)
    .map((x) => obj(x))
    .filter((o): o is Record<string, unknown> => o !== null)
    .sort((a, b) => Number(a.order) - Number(b.order));
  const seen = new Set<CourseId>();
  const picked: { course_id: CourseId; reason: string; linked_gap: string }[] = [];
  for (const o of items) {
    const id = o.course_id;
    if (!isCourseId(id) || seen.has(id) || statusOf.get(id) === "完了") continue;
    seen.add(id);
    picked.push({ course_id: id, reason: str(o.reason, 300) ?? "", linked_gap: str(o.linked_gap, 200) ?? "" });
  }
  const ranked = diagnosis ? rankCoursesByDiagnosis(picked, diagnosis) : picked;
  const review = ranked.filter((p) => statusOf.get(p.course_id) === "復習をおすすめ");
  const others = ranked.filter((p) => statusOf.get(p.course_id) !== "復習をおすすめ");
  const ordered = [...review, ...others];
  const remaining = COURSE_IDS.filter((id) => statusOf.get(id) !== "完了");
  if (remaining.length > 0 && ordered.length === 0) return null;
  return {
    plan: ordered.map((p, i) => ({ order: i + 1, course_id: p.course_id, week: i + 1, reason: p.reason, linked_gap: p.linked_gap })),
    message,
  };
}

export async function createLearningPlan(
  deps: AiDeps,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<LearningState> {
  const wantsInput = body.wants === undefined ? undefined : validateWants(body.wants);
  // 診断の読み出しを先に行う（使えない診断なら getDiagnosisFrom が無効化して learning.rev を進めるため、
  // rev を読む ensureLearningRow より後だと AI を呼んだあと必ず 409 になっていた。REV-005）
  const diag = await getDiagnosisFrom(deps.db, demoId);
  const row = await ensureLearningRow(deps.db, demoId);
  const wants = wantsInput ?? row.wants;
  const progress = await loadProgress(deps.db, demoId);
  const profile = DEMO_PROFILES.successor;

  const courses = getCourses().map((c) => ({ course_id: c.id, title: c.title, level: c.level, goal: c.goal, 診断とのつながり: c.linkedGap }));
  const progressForPrompt = progress.map((p) => ({ course_id: p.courseId, status: p.status, score: p.score === null ? "未受験" : `${p.score}/5` }));
  const system = [
    fillPlanTemplate(LEARNING_SYSTEM_TEMPLATE, {
      role: profile.roleLabel,
      name: profile.name,
      level: row.level,
      wants: tagRef("wants"),
      diagnosis: diag ? tagRef("diagnosis") : "まだ診断はありません",
      courses: tagRef("courses"),
      progress: tagRef("progress"),
    }),
    DATA_NOTE,
  ].join("\n\n");
  const blocks = ["次の入力をもとに、出力形式どおりの JSON だけを返してください。", dataBlock("wants", wants)];
  if (diag) blocks.push(dataBlock("diagnosis", diag.diagnosis));
  blocks.push(dataBlock("courses", courses), dataBlock("progress", progressForPrompt));

  const plan = await callJsonAi(
    deps,
    demoId,
    role,
    {
      purpose: "learning_plan",
      system,
      messages: [{ role: "user", content: blocks.join("\n\n") }],
      schema: LEARNING_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: LEARNING_MAX_TOKENS,
    },
    (v) => parseLearningPlan(v, progress, diag?.diagnosis ?? null),
  );

  const stored: StoredPlan = { plan, createdAt: nowIso(), usedDiagnosis: diag !== null };
  const rs = await deps.db.execute({
    sql: `UPDATE learning SET wants = ?, previous_plan = current_plan, current_plan = ?, rev = rev + 1, updated_at = ?
          WHERE demo_id = ? AND rev = ?`,
    args: [wants, JSON.stringify(stored), nowIso(), demoId, row.rev],
  });
  if (rs.rowsAffected !== 1) {
    throw new ServiceError(409, MSG_CONFLICT);
  }
  return getLearningStateFrom(deps.db, demoId);
}

// ---- 小テスト ----

export async function submitQuiz(
  db: Client,
  demoId: string,
  body: Record<string, unknown>,
): Promise<{ result: GradeResult; state: LearningState }> {
  const courseId = validateCourseId(body.courseId);
  const answers = validateAnswers(courseId, body.answers);
  const result = gradeQuiz(courseId, answers);
  const row = await ensureLearningRow(db, demoId);
  const now = nowIso();
  const stmts: { sql: string; args: (string | number | null)[] }[] = [
    {
      sql: `INSERT INTO course_progress (demo_id, course_id, status, score, wrong_article_nos, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(demo_id, course_id) DO UPDATE SET status = excluded.status, score = excluded.score,
              wrong_article_nos = excluded.wrong_article_nos, updated_at = excluded.updated_at`,
      args: [demoId, courseId, result.status, result.score, JSON.stringify(result.wrongArticleNos), now],
    },
  ];
  if (courseId === "cashflow" && result.status === "完了" && row.level === "Lv1") {
    // Notion：資金繰りの学習を終えると Lv2 へ（上がったレベルは下げない）
    stmts.push({
      sql: `UPDATE learning SET level = 'Lv2', rev = rev + 1, updated_at = ? WHERE demo_id = ? AND level = 'Lv1'`,
      args: [now, demoId],
    });
  }
  await db.batch(stmts, "write");
  return { result, state: await getLearningStateFrom(db, demoId) };
}

// ---- 解説 ----

export const EXPLAIN_SCHEMA = {
  type: "object",
  properties: { explanation: s },
  required: ["explanation"],
  additionalProperties: false,
} as const;

export async function explainQuestion(
  deps: AiDeps,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<string> {
  const courseId = validateCourseId(body.courseId);
  const { question, article } = getQuestionForExplain(courseId, body.questionNo);
  const chosen = body.chosen;
  if (typeof chosen !== "string" || !question.choices.some((c) => c.key === chosen)) {
    throw new ServiceError(400, "選んだ答えの指定が正しくありません");
  }
  if (chosen === question.answer) throw new ServiceError(400, "この問題は正解です。解説は間違えた問題だけに出します");
  const level = await getLearningLevel(deps.db, demoId);
  const textOf = (key: string) => question.choices.find((c) => c.key === key)!.text;
  const user = [
    `知識レベル：${level}`,
    "次の問題で間違えた本人に、出力形式どおりの JSON だけで解説を返してください。",
    dataBlock("question", {
      問題: question.question,
      選択肢: question.choices.map((c) => `${c.key}. ${c.text}`),
      本人が選んだ答え: `${chosen}. ${textOf(chosen)}`,
      正解: `${question.answer}. ${textOf(question.answer)}`,
    }),
    dataBlock("article", { 記事: `記事${article.no} ${article.title}`, 本文: article.body }),
  ].join("\n\n");
  return callJsonAi(
    deps,
    demoId,
    role,
    {
      purpose: "learning_explain",
      system: [EXPLAIN_SYSTEM, DATA_NOTE].join("\n\n"),
      messages: [{ role: "user", content: user }],
      schema: EXPLAIN_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: EXPLAIN_MAX_TOKENS,
      budgetMs: EXPLAIN_BUDGET_MS,
    },
    (v) => str(v.explanation, EXPLAIN_MAX_CHARS) || null,
  );
}
