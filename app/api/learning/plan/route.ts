// POST /api/learning/plan  body: { wants?: string }（200文字以内） → { ok, state: LearningState }  後継者のみ
// 診断があれば使い、無ければ本人の希望だけで作る。新しいプランを作ると今のプランは previous へ移る。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { createLearningPlan } from "@/lib/learning";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return handleJsonApi(
    request,
    { where: "learning.plan", mutation: "json", roles: ["successor"] },
    async ({ session, db }) => {
      const body = await readJsonBody(request);
      const state = await createLearningPlan({ db, ai: claudeJsonAi }, session.demoId, session.role, body);
      return { state };
    },
  );
}
