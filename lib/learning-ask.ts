import "server-only";

// 講座の記事の横の「AIに質問する」：POST /api/learning/ask（後継者のみ。/api/learning/explain と同じ）。
// - 講座・記事は lib/courses.ts の組み合わせだけ受け付ける
// - AI に渡すのは「その記事の本文（講座名・記事名つき）」「本人の知識レベル」「お店の概要」「質問」の4つだけ。
//   面談・診断・ほかの記事・正解の一覧は渡さない（getCourse() は正解を含まない形を返す）
// - 知識レベルは learning テーブルの level（explain と同じ。行が無ければ Lv1）。demo_id で絞る
// - 会話は保存しない（1問1答）
// - 質問は利用者の入力なので、AI にはデータとして区切って渡す

import type { AskAnswer, CourseId, LearningState } from "./plan-types";
import type { ApiOptions } from "./api";
import { ServiceError } from "./errors";
import { validateText } from "./validation";
import { getLearningLevel } from "./learning";
import { COMPANY_CONTEXT } from "./demo-profiles";
import { getCourse, isCourseId } from "./courses";
import { ASK_LEVEL_GUIDE_LV1, ASK_LEVEL_GUIDE_LV2, ASK_SYSTEM_TEMPLATE } from "./prompts/ask";
import { fillPlanTemplate, tagRef } from "./prompts/plan";
import { arr, callJsonAi, charLen, dataBlock, DATA_NOTE, obj, str, type AiDeps } from "./ai/json-ai";
import type { Role } from "./role";

export const ASK_QUESTION_MAX_CHARS = 200;
export const ASK_MAX_TOKENS = 800;
/** Route の maxDuration は 60 秒。AI に使う時間はそれより短く（explain と同じ 50 秒。SEC-105） */
export const ASK_BUDGET_MS = 50_000;
const ASK_ANSWER_MAX_CHARS = 600;
const ASK_TERMS_MAX = 3;
const TERM_MAX_CHARS = 30;
const MEANING_MAX_CHARS = 120;

/** 使える役割（/api/learning/explain と同じく後継者のみ） */
export const ASK_ROLES: readonly Role[] = ["successor"];
export const ASK_API_OPTIONS: ApiOptions = { where: "learning.ask", mutation: "json", roles: ASK_ROLES };

type Level = LearningState["level"];

// ---- 入力検証 ----

export function validateAskCourse(courseId: unknown, articleNo: unknown) {
  if (!isCourseId(courseId)) throw new ServiceError(400, "講座の指定が正しくありません");
  const course = getCourse(courseId as CourseId);
  const article =
    typeof articleNo === "number" && Number.isInteger(articleNo)
      ? course?.articles.find((a) => a.no === articleNo)
      : undefined;
  if (!course || !article) throw new ServiceError(400, "記事の指定が正しくありません");
  return { course, article };
}

export function validateAskQuestion(value: unknown): string {
  // 1行の質問：改行・タブなどの制御文字は不可
  return validateText(value, {
    max: ASK_QUESTION_MAX_CHARS,
    allowNewline: false,
    emptyMessage: "質問を入力してください",
    tooLongMessage: `質問は${ASK_QUESTION_MAX_CHARS}文字以内で入力してください`,
    badCharMessage: "質問に使えない文字（改行など）が含まれています",
  });
}

// ---- AI の返事 ----

export const ASK_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, meaning: { type: "string" } },
        required: ["term", "meaning"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "terms"],
  additionalProperties: false,
} as const;

/** 返事を検証・整形する。answer が空なら null（再送の対象）。terms は形の正しいものを先頭から3件まで */
export function parseAskAnswer(v: Record<string, unknown>): AskAnswer | null {
  const text = str(v.answer, ASK_ANSWER_MAX_CHARS);
  if (!text || !Array.isArray(v.terms)) return null;
  const terms: AskAnswer["terms"] = [];
  for (const x of arr(v.terms)) {
    const o = obj(x);
    const term = o ? str(o.term, TERM_MAX_CHARS) : null;
    const meaning = o ? str(o.meaning, MEANING_MAX_CHARS) : null;
    if (!term || !meaning) continue;
    terms.push({ term, meaning });
    if (terms.length >= ASK_TERMS_MAX) break;
  }
  return { text, terms };
}

// ---- 本体 ----

export function levelGuide(level: Level): string {
  return level === "Lv1" ? ASK_LEVEL_GUIDE_LV1 : ASK_LEVEL_GUIDE_LV2;
}

export async function askAboutArticle(
  deps: AiDeps,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<AskAnswer> {
  // Route Handler でも確認するが、ここでも後継者以外は通さない
  if (!ASK_ROLES.includes(role)) throw new ServiceError(403, "この画面は後継者として入ると使えます");
  const { course, article } = validateAskCourse(body.courseId, body.articleNo);
  const question = validateAskQuestion(body.question);
  const level = await getLearningLevel(deps.db, demoId);

  const system = [
    fillPlanTemplate(ASK_SYSTEM_TEMPLATE, {
      article: tagRef("article"),
      company: tagRef("company"),
      question: tagRef("question"),
      level_guide: levelGuide(level),
    }),
    DATA_NOTE,
  ].join("\n\n");
  const user = [
    `知識レベル：${level}`,
    "次の記事についての質問に、出力形式どおりの JSON だけで答えてください。",
    dataBlock("article", { 講座: course.title, 記事: `記事${article.no} ${article.title}`, 本文: article.body }),
    dataBlock("company", COMPANY_CONTEXT),
    dataBlock("question", question),
  ].join("\n\n");

  return callJsonAi(
    deps,
    demoId,
    role,
    {
      purpose: "learning_ask",
      system,
      messages: [{ role: "user", content: user }],
      schema: ASK_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: ASK_MAX_TOKENS,
      budgetMs: ASK_BUDGET_MS,
    },
    parseAskAnswer,
  );
}
