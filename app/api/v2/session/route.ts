// 2.0 の API（1本だけ）。外部の AI にはつながない（面談の返事と資料づくりはモック）。
// GET：今の面談の状態を返す。POST：{ action, ... } で操作する。
// 本文（回答・資料）はログに出さない。
//
// 動かし方（lib/v2/mode.ts）
// - 手元（local）：ログインなし。クッキーの ID で「同じブラウザの続き」を見分ける
// - 検証用（verify）：Clerk でログインした人だけが使える。クッキーの ID は使わない
// - 止める（off）：503 を返す（ハッカソン版の本番サイトは、これ）
//
// 動かし方は、要求ごとに1回だけ決め、その結果を部品（runtime.ts）へ渡す。
// 本人の確認も、要求ごとに1回だけ行い、その結果を最後まで使う。

import { NextResponse, type NextRequest } from "next/server";
import { handle, hasInterview, recordRefusal, view, type Env } from "@/lib/v2/access";
import type { Actor } from "@/lib/v2/auth";
import { isCourseId } from "@/lib/v2/courses";
import { getMode } from "@/lib/v2/mode";
import {
  allowNewInterview,
  allowNewInterviewFor,
  clearSessionId,
  getEnv,
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

const STOPPED_MESSAGE = "この試作は、手元の開発環境でだけ動きます。公開された場所では使えません。";
const LOGIN_MESSAGE = "ログインが必要です。ログインしてから、もう一度お試しください。";
const BUSY_MESSAGE = "ただいま混み合っています。少し時間をおいて、もう一度お試しください。";
const NO_SESSION_MESSAGE = "面談がまだ始まっていません。最初の画面から始めてください。";

/**
 * 検証用では、合言葉は Clerk が持つ。権限確認には、決まった名前だけを渡す（中身は使われない）。
 * 手元用の認証は、この名前を合言葉として受け付けない（発行した ID の形だけを受け付ける）。
 */
const SIGNED_IN_TOKEN = "signed-in";

/** 入れ物がなくても始められる操作（「面談を始める」と「講座の記録を保存する」） */
const isCreating = (action: unknown) => action === "start" || action === "saveLearning";

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

function failure(e: unknown) {
  if (e instanceof V2Error) return fail(e.status, e.status === 401 ? LOGIN_MESSAGE : e.message);
  // 内容は出さず、種類だけ記録する
  console.error("[v2] unexpected error:", e instanceof Error ? e.name : "unknown");
  return fail(500, "うまく処理できませんでした。少し待って、もう一度お試しください。");
}

/**
 * 本人の確認を、要求ごとに1回だけにする。
 * 確認そのものが失敗したとき（認証サービスの不調など）は、本人ではないものとして扱う。
 */
function once(env: Env): { env: Env; actor: () => Promise<Actor | null> } {
  let cached: Promise<Actor | null> | null = null;
  const actor = (token: string | null) =>
    (cached ??= Promise.resolve()
      .then(() => env.auth.resolve(token))
      .then((a) => a ?? null)
      .catch(() => null));
  return { env: { ...env, auth: { resolve: actor } }, actor: () => actor(SIGNED_IN_TOKEN) };
}

/** 講座の記録の保存は、講座の指定が正しいと分かってから先へ進む（正しくない送信で、回数の上限を消費させない） */
function badCourse(input: Record<string, unknown>) {
  return input.action === "saveLearning" && !isCourseId(input.courseId)
    ? fail(400, "講座の指定が正しくありません。")
    : null;
}

export async function GET() {
  const mode = getMode();
  if (mode === "off") return fail(503, STOPPED_MESSAGE);
  try {
    if (mode === "verify") {
      const { env, actor } = once(getEnv("verify"));
      // ログインしていなければ、保存先には触れずに断る
      if ((await actor()) === null) return fail(401, LOGIN_MESSAGE);
      // 本人のもの以外は返らない
      return NextResponse.json({ ok: true, session: await view(env, SIGNED_IN_TOKEN) }, { headers: NO_STORE });
    }
    const sid = await readSessionId();
    const session = sid ? await view(getEnv("local"), sid) : null;
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: NextRequest) {
  const mode = getMode();
  if (mode === "off") return fail(503, STOPPED_MESSAGE);
  if (!isSameOrigin(req)) {
    recordRefusal(getEnv(mode), undefined, "cross_origin");
    return fail(403, "この操作は受け付けられません。");
  }
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
    if (mode === "verify") {
      const { env, actor } = once(getEnv("verify"));
      // まず、ログインしているかを確かめる（していない人に、保存先や回数の上限を使わせない）
      const who = await actor();
      if (who === null) {
        recordRefusal(env, input.action, "unauthenticated");
        return fail(401, LOGIN_MESSAGE);
      }
      // 新しく入れ物を作ることになる操作だけ、作る前の確認をする
      if (isCreating(input.action) && !(await hasInterview(env, SIGNED_IN_TOKEN))) {
        const refused = badCourse(input);
        if (refused) return refused;
        // 回数の上限は、利用者ごと（1人が使い切っても、ほかの人は始められる）
        if (!allowNewInterviewFor(who.userId)) {
          recordRefusal(env, input.action, "rate_limited");
          return fail(429, BUSY_MESSAGE);
        }
      }
      // 権限確認（本人・役割・対象）を通してから、面談の処理へ進む
      const session = await handle(env, SIGNED_IN_TOKEN, input);
      return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
    }

    // 手元：ログインなし。サーバーが発行して保存してある ID だけを使う。
    // 保存先にない ID（外から入れられた ID を含む）では面談を作らず、始めるときに必ず新しく発行する。
    // 他人が自分で始めた面談の ID を別の人のブラウザに入れられる場合、その人の回答が他人の面談に
    // 書かれるおそれがある。ログインがない以上、ここでは防ぎきれない（だから手元でしか動かさない）。
    const env = getEnv("local");
    let sid = await readSessionId();
    if (sid && !(await hasInterview(env, sid))) sid = null;
    if (!sid) {
      if (!isCreating(input.action)) {
        recordRefusal(env, input.action, "no_session");
        return fail(409, NO_SESSION_MESSAGE);
      }
      const refused = badCourse(input);
      if (refused) return refused;
      // 短時間に大量に始められるのを遅らせる
      if (!allowNewInterview()) {
        recordRefusal(env, input.action, "rate_limited");
        return fail(429, BUSY_MESSAGE);
      }
      sid = await issueSessionId();
    }
    const session = await handle(env, sid, input);
    if (input.action === "reset") await clearSessionId();
    return NextResponse.json({ ok: true, session }, { headers: NO_STORE });
  } catch (e) {
    return failure(e);
  }
}
