// POST /api/learning/ask  body: { courseId, articleNo, question } → { ok, answer: { text, terms } }  後継者のみ
// 記事の横の「AIに質問する」。AI にはその記事の本文・知識レベル・お店の概要・質問だけを渡す。会話は保存しない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { askAboutArticle, ASK_API_OPTIONS } from "@/lib/learning-ask";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, ASK_API_OPTIONS, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const answer = await askAboutArticle({ db, ai: claudeJsonAi }, session.demoId, session.role, body);
    return { answer };
  });
}
