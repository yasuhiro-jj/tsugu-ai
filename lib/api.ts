import "server-only";

// 面談 API の Route Handler 共通処理。
// 1) 状態を変える操作なら Origin / Content-Type を確認
// 2) クッキーからデモ用 ID と役割を読む（クライアントから送られた値は使わない）。無ければ 401
// 3) 処理結果を { ok: true, state } で返す。エラーは利用者向け日本語だけ

import { NextResponse, type NextRequest } from "next/server";
import type { Client } from "@libsql/client";
import type { InterviewState } from "./interview-types";
import { getSession, type Session } from "./demo";
import { getDb } from "./db";
import { checkMutation, errorJson, MSG_NEED_ROLE, toErrorResponse } from "./http";

type Handler = (ctx: { session: Session; db: Client }) => Promise<InterviewState>;

export async function handleInterviewApi(
  request: NextRequest,
  opts: { where: string; mutation: "json" | "no-body" | false },
  handler: Handler,
): Promise<NextResponse> {
  if (opts.mutation) {
    const bad = checkMutation(request, { requireJsonBody: opts.mutation === "json" });
    if (bad) return bad;
  }
  const session = await getSession();
  if (!session) return errorJson(401, MSG_NEED_ROLE);
  try {
    const db = await getDb();
    const state = await handler({ session, db });
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    return toErrorResponse(err, opts.where);
  }
}

type JsonHandler = (ctx: { session: Session; db: Client }) => Promise<Record<string, unknown>>;

/**
 * 診断・学習・90日計画の API の共通処理。handler の戻り値を { ok: true, ...result } で返す。
 * roles を指定すると、その役割以外は 403（例：学習は後継者のみ）。
 */
export async function handleJsonApi(
  request: NextRequest,
  opts: { where: string; mutation: "json" | "no-body" | false; roles?: readonly Session["role"][] },
  handler: JsonHandler,
): Promise<NextResponse> {
  if (opts.mutation) {
    const bad = checkMutation(request, { requireJsonBody: opts.mutation === "json" });
    if (bad) return bad;
  }
  const session = await getSession();
  if (!session) return errorJson(401, MSG_NEED_ROLE);
  if (opts.roles && !opts.roles.includes(session.role)) {
    return errorJson(403, "この画面は後継者として入ると使えます");
  }
  try {
    const db = await getDb();
    const result = await handler({ session, db });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toErrorResponse(err, opts.where);
  }
}
