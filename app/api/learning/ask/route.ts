// POST /api/learning/ask  body: { courseId, articleNo, question, mode?: "article" | "web" }
//   → { ok, answer: { text, terms, caution?, sources?, searched? } }  後継者のみ
// mode を省略したときは "article"（記事の本文だけで答える）。"web" は公的機関・民間サービスのサイトだけを検索して出典つきで答える
// 記事の横の「AIに質問する」。AI にはその記事の本文・知識レベル・お店の概要・質問だけを渡す。会話は保存しない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { askAboutArticle, ASK_API_OPTIONS } from "@/lib/learning-ask";
import { claudeJsonAi } from "@/lib/ai/claude-json";
import { claudeWebSearchAi } from "@/lib/ai/web-search";

export const dynamic = "force-dynamic";
// ウェブ検索の分を見込んで 90 秒（AI の時間の予算は記事だけ 50 秒・検索つき 75 秒。SEC-105）
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, ASK_API_OPTIONS, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const answer = await askAboutArticle({ db, ai: claudeJsonAi, webAi: claudeWebSearchAi }, session.demoId, session.role, body);
    return { answer };
  });
}
