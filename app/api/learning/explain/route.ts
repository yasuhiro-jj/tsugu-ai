// POST /api/learning/explain  body: { courseId, questionNo, chosen } → { ok, explanation }  後継者のみ
// 間違えた問題だけ。正誤はサーバーが判定し、AI には正解と記事本文だけを渡して説明させる。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { explainQuestion } from "@/lib/learning";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return handleJsonApi(
    request,
    { where: "learning.explain", mutation: "json", roles: ["successor"] },
    async ({ session, db }) => {
      const body = await readJsonBody(request);
      const explanation = await explainQuestion({ db, ai: claudeJsonAi }, session.demoId, session.role, body);
      return { explanation };
    },
  );
}
