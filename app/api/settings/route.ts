// GET /api/settings                        → { ok, ...SettingsView }
// PUT /api/settings  body { settings, rev } → { ok, ...SettingsView, invalidated }
//   会社の設定（設定ダッシュボード。docs/settings-dashboard.md）。二人の共有物なので先代・後継者どちらでも可。
//   中身が同じなら何もしない。変えたら診断・90日計画・資料・AI参謀の会話（両方の役割）を消す。面談の記録は残す。
//   入力誤りは 400 { ok:false, error, fieldErrors }、rev が古ければ 409、書き換え回数の上限は 429。
//   デモ用 ID はクッキーから読む（本文の値は使わない）。AI は使わない。設定の中身はログに出さない。

import type { NextRequest } from "next/server";
import { handleJsonApi } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { getSettingsView, saveSettings } from "@/lib/company-settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleJsonApi(request, { where: "settings.get", mutation: false }, async ({ session, db }) => ({
    ...(await getSettingsView(db, session.demoId, session.role)),
  }));
}

export async function PUT(request: NextRequest) {
  return handleJsonApi(request, { where: "settings.put", mutation: "json" }, async ({ session, db }) => {
    const body = await readJsonBody(request);
    return { ...(await saveSettings(db, session.demoId, session.role, body)) };
  });
}
