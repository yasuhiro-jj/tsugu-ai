// POST /api/plan/action  body: { id, status?, owner?, due? } → { ok, state: ActionPlanState }
// 90日計画の行動1件の状態・担当・期限を変える。先代・後継者どちらでも可。AI は使わない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { updateAction } from "@/lib/action-plan";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "plan.action", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await updateAction(db, session.demoId, body);
    return { state };
  });
}
