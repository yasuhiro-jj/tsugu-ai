// POST /api/plan  body: { startDate?: "YYYY-MM-DD" } → { ok, state: ActionPlanState }
// 90日計画の下書きを作る（作り直し）。先代・後継者どちらでも可（二人の共通計画）。診断が無ければ 409。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { createActionPlan } from "@/lib/action-plan";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "plan.post", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await createActionPlan({ db, ai: claudeJsonAi }, session.demoId, session.role, body);
    return { state };
  });
}
