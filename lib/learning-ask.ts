import "server-only";

// 講座の記事の横の「AIに質問する」：POST /api/learning/ask（後継者のみ。/api/learning/explain と同じ）。
// - 講座・記事は lib/courses.ts の組み合わせだけ受け付ける
// - AI に渡すのは「その記事の本文（講座名・記事名つき）」「本人の知識レベル」「お店の概要」「質問」の4つだけ。
//   面談・診断・ほかの記事・正解の一覧は渡さない（getCourse() は正解を含まない形を返す）
// - 知識レベルは learning テーブルの level（explain と同じ。行が無ければ Lv1）。demo_id で絞る
// - 会話は保存しない（1問1答）
// - 質問は利用者の入力なので、AI にはデータとして区切って渡す
// - mode: "web"（省略時は "article"＝今までどおり）：2段階で答える（SEC-201）。
//   1段目：質問・立場・知識レベルだけでウェブ検索（公的機関6件＋民間サービス5件だけ。lib/ai/web-search.ts）。記事の本文は渡さない
//   2段目：検索なしで、記事・お店の概要と1段目の要点（<public_info>。データとして）を合わせて JSON で答える。
//   回数の予約は2回。出典（sources）と searched は1段目のものを付ける

import type { AskAnswer, CourseId, LearningState } from "./plan-types";
import type { ApiOptions } from "./api";
import { ServiceError } from "./errors";
import { validateText } from "./validation";
import { getLearningLevel } from "./learning";
import { COMPANY_CONTEXT } from "./demo-profiles";
import { getCourse, isCourseId } from "./courses";
import { ASK_LEVEL_GUIDE_LV1, ASK_LEVEL_GUIDE_LV2, ASK_SYSTEM_TEMPLATE, ASK_WEB_SYSTEM_TEMPLATE } from "./prompts/ask";
import { PUBLIC_INFO_NOTES } from "./prompts/web-search";
import {
  publicInfoForPrompt,
  publicSources,
  researchPublicInfo,
  secondStageBudget,
  type WebAiDeps,
} from "./ai/web-search";
import { fillPlanTemplate, tagRef } from "./prompts/plan";
import { arr, callJsonAi, charLen, dataBlock, DATA_NOTE, dataNote, obj, str } from "./ai/json-ai";
import type { Role } from "./role";
import { cautionFor } from "./assertive";
import { getCompanySettingsFrom } from "./company-settings";
import { allowedSet, groundingFor, logGrounding } from "./grounding";
import type { WebSource } from "./ai/web-search";

/**
 * 講座の質問の答えの根拠の照合（lib/grounding.ts）。根拠＝記事（講座名・記事名・本文）・お店の概要・本人の質問・出典の文。
 * 検索で出典があるのに引用の文（cited_text）が1つも取れなければ、数字の照合は対象外にする（誤検知を避ける）
 */
function groundAsk(
  answer: AskAnswer,
  where: string,
  base: string[],
  sources?: readonly WebSource[],
): AskAnswer {
  const cited = (sources ?? []).map((x) => x.citedText ?? "").filter(Boolean);
  const skip = sources !== undefined && sources.length > 0 && cited.length === 0;
  const g = groundingFor(
    [answer.text, ...answer.terms.map((t) => t.meaning)],
    skip ? null : allowedSet(base, cited),
  );
  logGrounding(where, g);
  return g ? { ...answer, grounding: g } : answer;
}

export const ASK_QUESTION_MAX_CHARS = 200;
export const ASK_MAX_TOKENS = 800;
/** 記事だけ（mode: "article"）の AI の時間の予算（explain と同じ 50 秒）。Route の maxDuration は検索の分を見込んで 90 秒（SEC-105） */
export const ASK_BUDGET_MS = 50_000;
const ASK_ANSWER_MAX_CHARS = 600;
/** mode: "web" の答えの文字数の上限（出典名・時点・資料と次の一歩を添えるため少し長め） */
const ASK_WEB_ANSWER_MAX_CHARS = 900;
export const ASK_WEB_MAX_TOKENS = 2000;

export type AskMode = "article" | "web";
export const MSG_ASK_BAD_MODE = "質問のしかたの指定が正しくありません";
export const MSG_WEB_UNAVAILABLE = "今は公的な情報の検索を使えません。記事の内容で質問してください";

/** 省略（undefined）は "article"（今までどおり）。それ以外の値は 400 */
export function validateAskMode(value: unknown): AskMode {
  if (value === undefined) return "article";
  if (value === "article" || value === "web") return value;
  throw new ServiceError(400, MSG_ASK_BAD_MODE);
}
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
  return parseAskAnswerWith(v, ASK_ANSWER_MAX_CHARS);
}

/** parseAskAnswer の文字数の上限を変えられる版（mode: "web" は少し長め） */
export function parseAskAnswerWith(v: Record<string, unknown>, maxChars: number): AskAnswer | null {
  const text = str(v.answer, maxChars);
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
  deps: WebAiDeps,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<AskAnswer> {
  // Route Handler でも確認するが、ここでも後継者以外は通さない
  if (!ASK_ROLES.includes(role)) throw new ServiceError(403, "この画面は後継者として入ると使えます");
  const { course, article } = validateAskCourse(body.courseId, body.articleNo);
  const question = validateAskQuestion(body.question);
  const mode = validateAskMode(body.mode);
  const level = await getLearningLevel(deps.db, demoId);
  const groundBase = [course.title, article.title, ...article.body, COMPANY_CONTEXT, question];

  if (mode === "web") {
    const webAi = deps.webAi;
    if (!webAi) throw new ServiceError(503, MSG_WEB_UNAVAILABLE);
    const now = deps.now ?? Date.now;
    const startedAt = now();
    // 1段目：質問・立場・知識レベルだけで検索する（記事の本文・お店の概要は渡さない。SEC-201）
    const research = await researchPublicInfo({ ...deps, webAi }, demoId, role, {
      purpose: "learning_ask_web",
      question,
      roleLabel: "後継者",
      level,
      settings: await getCompanySettingsFrom(deps.db, demoId),
    });
    // 2段目：検索なしのふだんの呼び出し。記事・お店の概要と、1段目の要点（データとして）を合わせて答える
    const system = [
      fillPlanTemplate(ASK_WEB_SYSTEM_TEMPLATE, {
        article: tagRef("article"),
        company: tagRef("company"),
        question: tagRef("question"),
        public_info: tagRef("public_info"),
        level_guide: levelGuide(level),
      }),
      dataNote(undefined, PUBLIC_INFO_NOTES),
    ].join("\n\n");
    const user = [
      `知識レベル：${level}`,
      "次の記事についての質問に、公的な情報の要約も使って、出力形式どおりの JSON だけで答えてください。",
      dataBlock("article", { 講座: course.title, 記事: `記事${article.no} ${article.title}`, 本文: article.body }),
      dataBlock("company", COMPANY_CONTEXT),
      dataBlock("question", question),
      dataBlock("public_info", publicInfoForPrompt(research)),
    ].join("\n\n");
    const out = await callJsonAi(
      deps,
      demoId,
      role,
      {
        purpose: "learning_ask_web2",
        system,
        messages: [{ role: "user", content: user }],
        schema: ASK_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: ASK_WEB_MAX_TOKENS,
        budgetMs: secondStageBudget(startedAt, now),
      },
      (v) => parseAskAnswerWith(v, ASK_WEB_ANSWER_MAX_CHARS),
    );
    // 出典は1段目の sources をそのまま付ける
    const answer: AskAnswer = {
      ...out,
      sources: publicSources(research.sources),
      searched: research.searched,
      ...(research.searchQueryNote ? { searchQueryNote: research.searchQueryNote } : {}),
    };
    const caution = cautionFor("learning.ask", [answer.text, ...answer.terms.map((t) => t.meaning)]);
    const grounded = groundAsk(answer, "learning.ask", groundBase, research.sources);
    return caution ? { ...grounded, caution } : grounded;
  }

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

  const answer = await callJsonAi(
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
  // 言い切りに見える表現があれば固定の注記を足す（答えは変えない。ログは種類だけ。SEC-A02）
  const caution = cautionFor("learning.ask", [answer.text, ...answer.terms.map((t) => t.meaning)]);
  const grounded = groundAsk(answer, "learning.ask", groundBase);
  return caution ? { ...grounded, caution } : grounded;
}
