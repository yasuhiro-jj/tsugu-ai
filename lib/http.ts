import "server-only";

// API 共通の小道具（サーバー専用）。
// - 状態を変える API（POST / DELETE）は checkMutation() を最初に呼ぶ
// - エラー応答は利用者に見せてよい日本語だけを返す（内部例外・SQL・スタックは返さない）

import { NextResponse, type NextRequest } from "next/server";
import { ServiceError } from "./errors";

export type ApiError = { ok: false; error: string };

export { ServiceError };

export function errorJson(status: number, error: string): NextResponse<ApiError> {
  return NextResponse.json({ ok: false, error }, { status });
}

export const MSG_NEED_ROLE = "先に役割を選んでください";
export const MSG_SERVER = "サーバーで問題が起きました。少し時間をおいてもう一度お試しください。";

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}

/** 実際のプロトコルが https かどうか（NODE_ENV ではなくリクエストで判断する）。 */
export function isSecureRequest(request: NextRequest): boolean {
  if (request.nextUrl.protocol === "https:") return true;
  return firstHeaderValue(request.headers.get("x-forwarded-proto")) === "https";
}

/** httpOnly クッキーの共通属性。 */
export function cookieOptions(request: NextRequest, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: isSecureRequest(request),
    maxAge: maxAgeSeconds,
  };
}

/**
 * Origin ヘッダがあれば、リクエスト先のホストと一致することを確かめる。
 * 一致しなければ 403 の応答を返す。問題なければ null。
 */
export function checkOrigin(request: NextRequest): NextResponse<ApiError> | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return errorJson(403, "この操作は受け付けられません");
  }
  const allowed = new Set<string>();
  const host = firstHeaderValue(request.headers.get("host"));
  if (host) allowed.add(host);
  const fwdHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  if (fwdHost) allowed.add(fwdHost);
  allowed.add(request.nextUrl.host.toLowerCase());
  if (!originHost || !allowed.has(originHost)) {
    return errorJson(403, "この操作は受け付けられません");
  }
  return null;
}

/** Content-Type が application/json か。 */
export function isJsonContentType(request: Request): boolean {
  const ct = request.headers.get("content-type");
  if (!ct) return false;
  return ct.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * 状態を変える API の入口チェック。
 * - Origin が別ホストなら 403
 * - requireJsonBody=true のとき Content-Type: application/json 以外は 415
 */
export function checkMutation(
  request: NextRequest,
  opts: { requireJsonBody: boolean },
): NextResponse<ApiError> | null {
  const originErr = checkOrigin(request);
  if (originErr) return originErr;
  if (opts.requireJsonBody && !isJsonContentType(request)) {
    return errorJson(415, "送信形式が正しくありません（JSON で送ってください）");
  }
  return null;
}

const MAX_BODY_BYTES = 32 * 1024;

/** JSON 本文を読む。大きすぎる・壊れている場合は ServiceError(400)。 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ServiceError(400, "送信内容が大きすぎます");
  }
  let body: unknown;
  try {
    body = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw new ServiceError(400, "送信内容を読み取れませんでした");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ServiceError(400, "送信内容を読み取れませんでした");
  }
  return body as Record<string, unknown>;
}

/** 例外を利用者向けの応答に変換する。ログには種類だけを出す（本文・入力は出さない）。 */
export function toErrorResponse(err: unknown, where: string): NextResponse<ApiError> {
  if (err instanceof ServiceError) return errorJson(err.status, err.userMessage);
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(JSON.stringify({ level: "error", where, error: name }));
  return errorJson(500, MSG_SERVER);
}
