// POST /api/interview/share  body: { themeKey, shared: boolean }
// 確定（confirmed）したテーマだけ。後から何度でも変更・取り消しできる。

import type { NextRequest } from "next/server";
import { handleInterviewApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { setShared } from "@/lib/interview/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleInterviewApi(request, { where: "interview.share", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    return setShared(db, session.demoId, session.role, body);
  });
}
