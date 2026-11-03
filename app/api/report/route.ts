// POST /api/report  body: {} → { ok, state: ReportState }
// 決算サマリーと銀行への相談用資料の下書きを作る（作り直し）。先代・後継者どちらでも可（二人の共有物）。
// 診断が無ければ 409。AI への入力・数字の扱いは lib/report.ts を参照。
// 作り直すと、PUT で編集した文は消えて AI の新しい下書きに戻る。
//
// PUT /api/report  body: { ai: ReportAiParts, updatedAt: string } → { ok, state: ReportState }
// AI が書いた文だけを直して保存する（数字の表は直せない）。先代・後継者どちらでも可。AI は使わない。
// 400（field つき）／404（資料が無い）／409（updatedAt が古い・診断や設定が変わった）／429（1日の書き換え上限）。
// デモ用 ID はクッキーから読む（本文の値は使わない）。型と文言は lib/report-types.ts・lib/report.ts。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { createReport, updateReport } from "@/lib/report";
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

export async function PUT(request: NextRequest) {
  return handleJsonApi(request, { where: "report.put", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    const state = await updateReport(db, session.demoId, body);
    return { state };
  });
}
