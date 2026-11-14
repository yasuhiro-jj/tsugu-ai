// 2.0 試作の API（1本だけ）。外部の AI・DB にはつながない。
// GET：今の面談の状態を返す。POST：{ action, ... } で操作する。
// 本文（回答・資料）はログに出さない。

import { NextResponse, type NextRequest } from "next/server";
import { handle, hasInterview, view } from "@/lib/v2/access";
import {
  allowNewInterview,
  clearSessionId,
  getEnv,
  isLocalOnly,
  issueSessionId,
  readSessionId,
} from "@/lib/v2/runtime";
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
  try {
    // 権限確認を通して読む（本人のもの以外は返らない）
    const session = sid ? view(getEnv(), sid) : null;
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof V2Error) return fail(e.status, e.message);
    console.error("[v2] unexpected error:", e instanceof Error ? e.name : "unknown");
    return fail(500, "うまく処理できませんでした。少し待って、もう一度お試しください。");
  }
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
    const env = getEnv();
    let sid = await readSessionId();
    // サーバーが発行して保存してある ID だけを使う。
    // 保存先にない ID（外から入れられた ID を含む）では面談を作らず、始めるときに必ず新しく発行する
    if (sid && !hasInterview(env, sid)) sid = null;
    if (!sid) {
      if (input.action !== "start") return fail(409, "面談がまだ始まっていません。最初の画面から始めてください。");
      // 短時間に大量に始められて、ほかの人の面談が押し出されるのを防ぐ
      if (!allowNewInterview()) return fail(429, "ただいま混み合っています。少し時間をおいて、もう一度お試しください。");
      sid = await issueSessionId();
    }
    // 権限確認（本人・役割・対象）を通してから、面談の処理へ進む
    const session = await handle(env, sid, input);
    if (input.action === "reset") await clearSessionId();
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof V2Error) return fail(e.status, e.message);
    // 内容は出さず、種類だけ記録する
    console.error("[v2] unexpected error:", e instanceof Error ? e.name : "unknown");
    return fail(500, "うまく処理できませんでした。少し待って、もう一度お試しください。");
  }
}
