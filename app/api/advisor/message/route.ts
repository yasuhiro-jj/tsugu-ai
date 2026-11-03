// POST /api/advisor/message  body: { text }（1〜1000文字。改行は可、ほかの制御文字は 400）→ { ok, state: AdvisorState }
// 会話は本人（デモ用 ID ＋役割）だけのもの。上限20回（超えたら 400）。AI の回数上限は 429、AI の失敗は 502。
// AI が失敗したときは本人の発言も保存しない。入力本文はログに出さない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { sendAdvisorMessage } from "@/lib/advisor";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "advisor.message", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await sendAdvisorMessage({ db, ai: claudeJsonAi }, session.demoId, session.role, body.text);
    return { state };
  });
}
