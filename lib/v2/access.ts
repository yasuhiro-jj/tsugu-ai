// 権限確認の入口。すべての操作は、ここを通ってから面談の処理（service.ts）へ進む。
//
// 順番は必ず「本人の確認 → 所属と役割の確認 → 対象が本人のものかの確認 → 必要な分だけ取り出す」。
// 画面から送られてきた会社の ID・面談の ID・役割は、信用しない。
// 権限が分からない・確かめられないときは、断る。
// ほかの人の面談を指定されたときは、「存在しない」ときと同じ返事をする（あるかどうかも教えない）。

import type { Actor, AuthProvider } from "./auth";
import type { AuditLog, AuditOutcome } from "./audit";
import { dispatch, isAction } from "./dispatch";
import { getView, type Deps } from "./service";
import { V2Error, type SessionView } from "./types";

export type Env = { deps: Deps; auth: AuthProvider; audit: AuditLog };

const DENIED_CODES = new Set(["unauthenticated", "forbidden", "not_yours"]);

/** 面談の置き場所の名前。本人の確認ができた人の「会社＋本人」からだけ決まる */
export function interviewKey(actor: Actor): string {
  return `${actor.tenantId}/${actor.userId}`;
}

/** 「ない」ときと「ほかの人のもの」のときで、同じ返事にする */
function notFound(code: "no_session" | "not_yours") {
  return new V2Error(code, "面談がまだ始まっていません。最初の画面から始めてください。", 409);
}

function resolve(env: Env, token: string | null, requestedId: unknown): { actor: Actor; key: string } {
  // 1) 本人の確認
  const actor = env.auth.resolve(token);
  if (!actor) throw new V2Error("unauthenticated", "もう一度、最初の画面から始めてください。", 401);
  // 2) 役割の確認：面談や資料の中身を扱えるのは、経営者本人だけ（運営担当者は見られない）
  if (actor.role !== "owner") throw new V2Error("forbidden", "この操作はできません。", 403);
  // 3) 対象の確認：面談を指定されても、本人のもの以外は「ない」として扱う
  const key = interviewKey(actor);
  if (requestedId !== undefined && requestedId !== key) throw notFound("not_yours");
  // 念のため、保存してある持ち主とも照らし合わせる（置き場所の名前だけに頼らない）
  const record = env.deps.store.get(key);
  if (record && (record.owner?.tenantId !== actor.tenantId || record.owner?.userId !== actor.userId)) {
    throw notFound("not_yours");
  }
  return { actor, key };
}

function outcomeOf(e: unknown): { outcome: AuditOutcome; code: string } {
  if (e instanceof V2Error) return { outcome: DENIED_CODES.has(e.code) ? "denied" : "rejected", code: e.code };
  return { outcome: "error", code: "unexpected" };
}

/** 手元の試作用：その合言葉で始めた面談が、保存先にあるか */
export function hasInterview(env: Env, token: string | null): boolean {
  const actor = env.auth.resolve(token);
  return actor !== null && env.deps.store.get(interviewKey(actor)) !== null;
}

/** 今の面談の状態を返す。本人のもの以外は返さない */
export function view(env: Env, token: string | null, requestedId?: unknown): SessionView | null {
  const at = env.deps.now();
  let actor: Actor | null = null;
  try {
    const resolved = resolve(env, token, requestedId);
    actor = resolved.actor;
    const session = getView(env.deps, resolved.key);
    env.audit.record({ at, tenantId: actor.tenantId, userId: actor.userId, action: "view", outcome: "ok" });
    return session;
  } catch (e) {
    actor ??= env.auth.resolve(token);
    env.audit.record({ at, tenantId: actor?.tenantId ?? null, userId: actor?.userId ?? null, action: "view", ...outcomeOf(e) });
    throw e;
  }
}

/** 操作を受け付ける。権限を確かめ、結果の種類だけを記録する（本文は記録しない） */
export async function handle(env: Env, token: string | null, body: Record<string, unknown>): Promise<SessionView | null> {
  const at = env.deps.now();
  const action = isAction(body.action) ? body.action : "unknown";
  let actor: Actor | null = null;
  try {
    const resolved = resolve(env, token, body.interviewId);
    actor = resolved.actor;
    const session = await dispatch(env.deps, resolved.key, body, { tenantId: actor.tenantId, userId: actor.userId });
    env.audit.record({ at, tenantId: actor.tenantId, userId: actor.userId, action, outcome: "ok" });
    return session;
  } catch (e) {
    actor ??= env.auth.resolve(token);
    env.audit.record({ at, tenantId: actor?.tenantId ?? null, userId: actor?.userId ?? null, action, ...outcomeOf(e) });
    throw e;
  }
}
