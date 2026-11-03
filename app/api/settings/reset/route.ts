// POST /api/settings/reset  body { rev } → { ok, ...SettingsView, invalidated }（PUT /api/settings と同じ形）
//   会社の設定を架空の「食事処 つぐみ」の初期値に戻す。すでに初期値なら何もしない。
//   先代・後継者どちらでも可。rev が古ければ 409。デモ用 ID はクッキーから読む。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { resetSettings } from "@/lib/company-settings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleJsonApi(request, { where: "settings.reset", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    return { ...(await resetSettings(db, session.demoId, session.role, body)) };
  });
}
