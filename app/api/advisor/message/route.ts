// POST /api/advisor/message  body: { text, web?: boolean }（text は1〜1000文字。改行は可、ほかの制御文字は 400）→ { ok, state: AdvisorState }
// web: true なら、その1回の返事だけ公的機関・民間サービスのサイトを検索して出典つきで答える（返事のメッセージに sources・searched）
// 会話は本人（デモ用 ID ＋役割）だけのもの。上限20回（超えたら 400）。AI の回数上限は 429、AI の失敗は 502。
// AI が失敗したときは本人の発言も保存しない。入力本文はログに出さない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { sendAdvisorMessage } from "@/lib/advisor";
import { claudeJsonAi } from "@/lib/ai/claude-json";
import { claudeWebSearchAi } from "@/lib/ai/web-search";

export const dynamic = "force-dynamic";
// ウェブ検索の分を見込んで 90 秒（AI の時間の予算はふだん 50 秒・検索つき 75 秒。SEC-105）
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "advisor.message", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await sendAdvisorMessage(
      { db, ai: claudeJsonAi, webAi: claudeWebSearchAi },
      session.demoId,
      session.role,
      body.text,
      { web: body.web },
    );
    return { state };
  });
}
