// POST /api/interview/message  body: { text }（1〜1000文字）
// AI の返事に失敗したときは入力文を保存しない（画面側で入力を残してもらう）。入力本文はログに出さない。

import type { NextRequest } from "next/server";
import { handleInterviewApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { sendMessage } from "@/lib/interview/service";
import { claudeInterviewAi } from "@/lib/interview/claude-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleInterviewApi(request, { where: "interview.message", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    return sendMessage({ db, ai: claudeInterviewAi }, session.demoId, session.role, body.text);
  });
}
