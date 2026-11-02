// GET /api/interview：自分（デモ用 ID ＋ 役割）の面談の状態を返す。相手のデータは含めない。

import type { NextRequest } from "next/server";
import { handleInterviewApi } from "@/lib/api";
import { getInterviewState } from "@/lib/interview/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleInterviewApi(request, { where: "interview.get", mutation: false }, ({ session, db }) =>
    getInterviewState(db, session.demoId, session.role),
  );
}
