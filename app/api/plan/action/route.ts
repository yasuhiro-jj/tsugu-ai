// POST   /api/plan/action  body: { id, title?, status?, owner?, due? } → { ok, state: ActionPlanState }
//   90日計画の行動1件の文・状態・担当・期限を変える（期限はその行動の期間の中だけ）。
// DELETE /api/plan/action  body: { id } → { ok, state: ActionPlanState }
//   行動1件を消す（最後の1件は消せない）。
// 先代・後継者どちらでも可。AI は使わない。デモ用 ID はクッキーから読む（本文の値は使わない）。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { deleteAction, updateAction } from "@/lib/action-plan";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "plan.action", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await updateAction(db, session.demoId, body);
    return { state };
  });
}

export async function DELETE(request: NextRequest) {
  return handleJsonApi(request, { where: "plan.action.delete", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await deleteAction(db, session.demoId, body);
    return { state };
  });
}
