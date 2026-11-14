// 2.0 試作の API（1本だけ）。外部の AI・DB にはつながない。
// GET：今の面談の状態を返す。POST：{ action, ... } で操作する。
// 本文（回答・資料）はログに出さない。

import { NextResponse, type NextRequest } from "next/server";
import { dispatch } from "@/lib/v2/dispatch";
import { getView } from "@/lib/v2/service";
import { clearSessionId, getDeps, isLocalOnly, issueSessionId, readSessionId } from "@/lib/v2/runtime";
import { V2Error } from "@/lib/v2/types";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 20_000;
const NO_STORE = { "Cache-Control": "no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

const LOCAL_ONLY_MESSAGE =
  "この試作は、手元の開発環境でだけ動きます。公開された場所では使えません。";

/** ほかのサイトから送られた操作を受け付けない */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function GET() {
  if (!isLocalOnly()) return fail(503, LOCAL_ONLY_MESSAGE);
  const sid = await readSessionId();
  const session = sid ? getView(getDeps(), sid) : null;
  return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!isLocalOnly()) return fail(503, LOCAL_ONLY_MESSAGE);
  if (!isSameOrigin(req)) return fail(403, "この操作は受け付けられません。");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail(415, "送信の形式が正しくありません。");
  }
  // 大きすぎる送信は、読み込む前に断る
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return fail(413, "送信する内容が長すぎます。");
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "送信する内容が長すぎます。");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "送信の形式が正しくありません。");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "送信の形式が正しくありません。");
  }
  const input = body as Record<string, unknown>;

  try {
    const deps = getDeps();
    let sid = await readSessionId();
    // サーバーが発行して保存してある ID だけを使う。
    // 保存先にない ID（外から入れられた ID を含む）では面談を作らず、始めるときに必ず新しく発行する
    if (sid && getView(deps, sid) === null) sid = null;
    if (!sid) {
      if (input.action !== "start") return fail(409, "面談がまだ始まっていません。最初の画面から始めてください。");
      sid = await issueSessionId();
    }
    const session = await dispatch(deps, sid, input);
    if (input.action === "reset") await clearSessionId();
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof V2Error) return fail(e.status, e.message);
    // 内容は出さず、種類だけ記録する
    console.error("[v2] unexpected error:", e instanceof Error ? e.name : "unknown");
    return fail(500, "うまく処理できませんでした。少し待って、もう一度お試しください。");
  }
}
