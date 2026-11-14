// 権限確認の入口。すべての操作は、ここを通ってから面談の処理（service.ts）へ進む。
//
// 順番は必ず「本人の確認 → 所属と役割の確認 → 対象が本人のものかの確認 → 必要な分だけ取り出す」。
// 画面から送られてきた会社の ID・面談の ID・役割は、信用しない。
// 権限が分からない・確かめられないときは、断る。
// ほかの人の面談を指定されたときは、「存在しない」ときと同じ返事をする（あるかどうかも教えない）。
//
// 注意：service.ts の関数は、仕組みとして直接呼べないようにはなっていない。
// 画面からの入口（app/api/v2/session/route.ts）は、必ずこのファイルの handle / view を使うこと。

import type { Actor, AuthProvider } from "./auth";
import type { AuditAction, AuditLog, AuditOutcome } from "./audit";
import { dispatch, isAction } from "./dispatch";
import { getView, type Deps } from "./service";
import { V2Error, type SessionView } from "./types";

export type Env = { deps: Deps; auth: AuthProvider; audit: AuditLog };

const DENIED_CODES = new Set(["unauthenticated", "forbidden", "not_yours"]);

/**
 * 面談の置き場所の名前。本人の確認ができた人の「会社＋本人」からだけ決まる。
 * 会社と本人の ID をそれぞれ別に変換してからつなぐ（ID に区切りの文字が含まれていても、別の人と重ならない）
 */
export function interviewKey(actor: Actor): string {
  return `${encodeURIComponent(actor.tenantId)}/${encodeURIComponent(actor.userId)}`;
}

/** 「ない」ときと「ほかの人のもの」のときで、同じ返事にする */
function notFound(code: "no_session" | "not_yours") {
  return new V2Error(code, "面談がまだ始まっていません。最初の画面から始めてください。", 409);
}

/** 本人の確認。要求ごとに1回だけ行い、その結果を最後まで使う（途中で確かめ直して結果が変わらないように） */
async function identify(env: Env, token: string | null): Promise<Actor | null> {
  try {
    return (await env.auth.resolve(token)) ?? null;
  } catch {
    // 確かめられなかったときは、本人ではないものとして扱う
    return null;
  }
}

function authorize(actor: Actor | null, requestedId: unknown): { actor: Actor; key: string } {
  // 1) 本人の確認
  if (!actor) throw new V2Error("unauthenticated", "もう一度、最初の画面から始めてください。", 401);
  // 2) 役割の確認：面談や資料の中身を扱えるのは、経営者本人だけ（運営担当者は見られない）
  if (actor.role !== "owner") throw new V2Error("forbidden", "この操作はできません。", 403);
  // 3) 対象の確認：面談を指定されても、本人のもの以外は「ない」として扱う
  const key = interviewKey(actor);
  if (requestedId !== undefined && requestedId !== key) throw notFound("not_yours");
  return { actor, key };
}

/** 権限確認を通った人を持ち主として、面談の処理に渡す。保存してある持ち主との照合は、処理の中（順番待ちの内側）で行う */
function scoped(env: Env, actor: Actor): Deps {
  return { ...env.deps, expectOwner: { tenantId: actor.tenantId, userId: actor.userId } };
}

function outcomeOf(e: unknown): { outcome: AuditOutcome; code: string } {
  if (e instanceof V2Error) return { outcome: DENIED_CODES.has(e.code) ? "denied" : "rejected", code: e.code };
  return { outcome: "error", code: "unexpected" };
}

function record(env: Env, at: string, actor: Actor | null, action: AuditAction, result: { outcome: AuditOutcome; code?: string }) {
  env.audit.record({ at, tenantId: actor?.tenantId ?? null, userId: actor?.userId ?? null, action, ...result });
}

/** 手元の試作用：その合言葉で始めた面談が、保存先にあるか */
export async function hasInterview(env: Env, token: string | null): Promise<boolean> {
  const actor = await identify(env, token);
  return actor !== null && env.deps.store.get(interviewKey(actor)) !== null;
}

/** 入口で断った操作（ほかのサイトからの操作、回数の上限など）を記録する。本文は受け取らない */
export function recordRefusal(env: Env, action: unknown, code: string) {
  record(env, env.deps.now(), null, isAction(action) ? action : "unknown", { outcome: "denied", code });
}

/** 今の面談の状態を返す。本人のもの以外は返さない */
export async function view(env: Env, token: string | null, requestedId?: unknown): Promise<SessionView | null> {
  const at = env.deps.now();
  const actor = await identify(env, token);
  try {
    const resolved = authorize(actor, requestedId);
    const session = getView(scoped(env, resolved.actor), resolved.key);
    record(env, at, actor, "view", { outcome: "ok" });
    return session;
  } catch (e) {
    record(env, at, actor, "view", outcomeOf(e));
    throw e;
  }
}

/** 操作を受け付ける。権限を確かめ、結果の種類だけを記録する（本文は記録しない） */
export async function handle(env: Env, token: string | null, body: Record<string, unknown>): Promise<SessionView | null> {
  const at = env.deps.now();
  const action: AuditAction = isAction(body.action) ? body.action : "unknown";
  const actor = await identify(env, token);
  try {
    const resolved = authorize(actor, body.interviewId);
    const session = await dispatch(scoped(env, resolved.actor), resolved.key, body);
    record(env, at, actor, action, { outcome: "ok" });
    return session;
  } catch (e) {
    record(env, at, actor, action, outcomeOf(e));
    throw e;
  }
}
