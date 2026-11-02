// POST /api/learning/quiz  body: { courseId, answers: { "1": "B", ... } }  後継者のみ
// → { ok, result: { score, correct, wrongArticleNos, status }, state: LearningState }
// 採点はサーバーのルールベース（正解は画面へ送らない）。AI は使わない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { submitQuiz } from "@/lib/learning";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleJsonApi(
    request,
    { where: "learning.quiz", mutation: "json", roles: ["successor"] },
    async ({ session, db }) => {
      const body = await readJsonBody(request);
      return submitQuiz(db, session.demoId, body);
    },
  );
}
