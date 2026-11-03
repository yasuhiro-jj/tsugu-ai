// POST /api/report  body: {} → { ok, state: ReportState }
// 決算サマリーと銀行への相談用資料の下書きを作る（作り直し）。先代・後継者どちらでも可（二人の共有物）。
// 診断が無ければ 409。AI への入力・数字の扱いは lib/report.ts を参照。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { createReport } from "@/lib/report";
import { claudeJsonAi } from "@/lib/ai/claude-json";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "report.post", mutation: "json" }, async ({ session, db }) => {
    await readJsonBody(request);
    const state = await createReport({ db, ai: claudeJsonAi }, session.demoId, session.role);
    return { state };
  });
}
