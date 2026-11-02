// デモ用の役割切り替え API。
// これは認証ではない。「先代として入る／後継者として入る」をクッキーで切り替えるだけ。
// 誰でも任意の役割に切り替えられる前提なので、架空のデモデータ以外を扱わないこと。

import { NextResponse } from "next/server";
import { isRole, ROLE_COOKIE } from "@/lib/role";

export const dynamic = "force-dynamic";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7日

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const role =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>).role
      : undefined;
  if (!isRole(role)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(ROLE_COOKIE, role, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ROLE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return res;
}
