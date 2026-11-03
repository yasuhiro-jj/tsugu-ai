// POST /api/advisor/reset  body: {}  → { ok, state: AdvisorState }
// 本人（デモ用 ID ＋役割）の AI参謀の会話だけを消す。相手の役割の会話や、面談・診断などは消さない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { resetAdvisor } from "@/lib/advisor";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "advisor.reset", mutation: "json" }, async ({ session, db }) => {
    await readJsonBody(request);
    return { state: await resetAdvisor(db, session.demoId, session.role) };
  });
}
