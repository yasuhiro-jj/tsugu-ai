import "server-only";

// API の Route Handler 共通処理（入口は handleJsonApi の1つ。面談用の handleInterviewApi もこの上に作る。REV-003）。
// 1) 状態を変える操作なら Origin / Content-Type を確認
// 2) クッキーからデモ用 ID と役割を読む（クライアントから送られた値は使わない）。無ければ 401
// 3) roles の指定があり、その役割でなければ 403（文言は roles から作る）
// 4) 処理結果を { ok: true, ... } で返す。エラーは利用者向け日本語だけ

import { NextResponse, type NextRequest } from "next/server";
import type { Client } from "@libsql/client";
import type { InterviewState } from "./interview-types";
import { getSession, type Session } from "./demo";
import { getDb } from "./db";
import { DEMO_PROFILES } from "./demo-profiles";
import { checkMutation, errorJson, MSG_NEED_ROLE, toErrorResponse } from "./http";

type Ctx = { session: Session; db: Client };
type JsonHandler = (ctx: Ctx) => Promise<Record<string, unknown>>;

export type ApiOptions = {
  where: string;
  mutation: "json" | "no-body" | false;
  /** 指定すると、その役割以外は 403 */
  roles?: readonly Session["role"][];
};

/** テストから差し替えるための入口（本番は既定値のまま） */
export type ApiEnv = {
  getSession: () => Promise<Session | null>;
  getDb: () => Promise<Client>;
};

const DEFAULT_ENV: ApiEnv = { getSession, getDb };

/** roles から 403 の文言を作る（例：「この画面は後継者として入ると使えます」） */
export function forbiddenMessage(roles: readonly Session["role"][]): string {
  const labels = roles.map((r) => DEMO_PROFILES[r].roleLabel);
  return `この画面は${labels.join("または")}として入ると使えます`;
}

/**
 * 全 API の共通の入口（Origin / Content-Type → セッション → 役割 → 処理 → エラー変換）。
 * handler の戻り値を { ok: true, ...result } で返す。
 */
export async function handleJsonApi(
  request: NextRequest,
  opts: ApiOptions,
  handler: JsonHandler,
  env: ApiEnv = DEFAULT_ENV,
): Promise<NextResponse> {
  if (opts.mutation) {
    const bad = checkMutation(request, { requireJsonBody: opts.mutation === "json" });
    if (bad) return bad;
  }
  const session = await env.getSession();
  if (!session) return errorJson(401, MSG_NEED_ROLE);
  if (opts.roles && !opts.roles.includes(session.role)) {
    return errorJson(403, forbiddenMessage(opts.roles));
  }
  try {
    const db = await env.getDb();
    const result = await handler({ session, db });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toErrorResponse(err, opts.where);
  }
}

/** 面談 API 用：handleJsonApi の上で、結果を { ok: true, state } で返す。 */
export async function handleInterviewApi(
  request: NextRequest,
  opts: Omit<ApiOptions, "roles">,
  handler: (ctx: Ctx) => Promise<InterviewState>,
  env: ApiEnv = DEFAULT_ENV,
): Promise<NextResponse> {
  return handleJsonApi(request, opts, async (ctx) => ({ state: await handler(ctx) }), env);
}
