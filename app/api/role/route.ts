// デモ用の役割切り替え API。
// これは認証ではない。「先代として入る／後継者として入る」をクッキーで切り替えるだけ。
// 誰でも任意の役割に切り替えられる前提なので、架空のデモデータ以外を扱わないこと。
//
// 閲覧者ごとの分離：デモ用 ID（tsugu_demo）がまだ無ければ、ここでサーバーが発行してクッキーに入れる。
// データはすべてこの ID の配下に保存されるので、他の閲覧者のデータは見えない。
//
// 保存期間：新しいデモ用 ID を発行したときだけ、応答を返したあと（after）に、保存期間（既定7日）を
// 過ぎたデモデータを消す（lib/retention.ts）。削除が失敗しても役割の設定は成功のまま（ログは種類だけ）。

import { after, NextResponse, type NextRequest } from "next/server";
import { isRole, ROLE_COOKIE } from "@/lib/role";
import { DEMO_COOKIE, getDemoId, newDemoId } from "@/lib/demo";
import { getDb } from "@/lib/db";
import { purgeExpiredDemosSafely } from "@/lib/retention";
import { checkMutation, cookieOptions, errorJson, readJsonBody, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7日

export async function POST(request: NextRequest) {
  const bad = checkMutation(request, { requireJsonBody: true });
  if (bad) return bad;

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch (err) {
    return toErrorResponse(err, "role.post");
  }
  const role = body.role;
  if (!isRole(role)) {
    return errorJson(400, "役割の指定が正しくありません");
  }

  const res = NextResponse.json({ ok: true, role });
  const opts = cookieOptions(request, MAX_AGE_SECONDS);
  res.cookies.set(ROLE_COOKIE, role, opts);
  const existing = await getDemoId();
  const demoId = existing ?? newDemoId();
  if (!existing) {
    // 応答のあとに実行する（役割の設定を待たせない・失敗させない）。例外は purgeExpiredDemosSafely の中で止める
    after(() => purgeExpiredDemosSafely(getDb));
  }
  // 既存の ID でも期限を延ばすため毎回セットし直す（値はそのまま）
  res.cookies.set(DEMO_COOKIE, demoId, opts);
  return res;
}

export async function DELETE(request: NextRequest) {
  const bad = checkMutation(request, { requireJsonBody: false });
  if (bad) return bad;
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ROLE_COOKIE, "", cookieOptions(request, 0));
  return res;
}
