// POST /api/interview/start：今のテーマの会話が空なら、最初の問いかけを AI が作る（あれば何もしない）。

import type { NextRequest } from "next/server";
import { handleInterviewApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { startInterview } from "@/lib/interview/service";
import { claudeInterviewAi } from "@/lib/interview/claude-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleInterviewApi(request, { where: "interview.start", mutation: "json" }, async ({ session, db }) => {
    await readJsonBody(request); // 本文は使わないが、形式だけ確認する
    return startInterview({ db, ai: claudeInterviewAi }, session.demoId, session.role);
  });
}
