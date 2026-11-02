// DELETE /api/demo：このブラウザ（デモ用 ID）の面談データを両方の役割とも全部消す（デモ撮影のやり直し用）。
// 本文は不要。Origin は確認する。AI 呼び出し回数の記録は消さない（上限の悪用対策）。

import type { NextRequest } from "next/server";
import { handleInterviewApi } from "@/lib/api";
import { resetDemo } from "@/lib/interview/service";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  return handleInterviewApi(request, { where: "demo.delete", mutation: "no-body" }, ({ session, db }) =>
    resetDemo(db, session.demoId, session.role),
  );
}
