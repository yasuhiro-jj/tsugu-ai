// POST /api/interview/summary  body: { themeKey, decision: "confirm" | "discard", summary? }
// 確定・破棄したら、アプリが次の未着手テーマへ移る。

import type { NextRequest } from "next/server";
import { handleInterviewApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { decideSummary } from "@/lib/interview/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleInterviewApi(request, { where: "interview.summary", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    return decideSummary(db, session.demoId, session.role, body);
  });
}
