// POST /api/diagnosis  body: {}  → { ok, record: DiagnosisRecord }
// 先代・後継者どちらからでも実行できる。AI への入力は双方が共有した要約（lib/compare.ts）とお店の数字だけ。
// 共有済み要約が両者そろっていなければ 409（どちらが足りないかは言わない）。
// 応答の basedOnThemeKeys は常に空配列（SEC-103）。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { runDiagnosis, toPublicDiagnosisRecord } from "@/lib/diagnosis";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "diagnosis.post", mutation: "json" }, async ({ session, db }) => {
    await readJsonBody(request);
    const record = await runDiagnosis({ db, ai: claudeJsonAi }, session.demoId, session.role);
    return { record: toPublicDiagnosisRecord(record) }; // basedOnThemeKeys は空（SEC-103）
  });
}
