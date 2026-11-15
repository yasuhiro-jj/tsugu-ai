import "server-only";

// 2.0 をサーバーで動かすための部品（保存先・認証・モック・セッション用クッキー）。
// 動かし方（手元／検証用／止める）は lib/v2/mode.ts が決め、入口（route.ts）が決めた結果をここへ渡す。
// ここでは、動かし方を決め直さない（入口と食い違って、ログインなしの認証が選ばれることがないように）。
//
// 手元（local）：ログインなし・メモリ保存。クッキーは「同じブラウザの続き」を見分けるだけで、本人認証ではない。
// 検証用（verify）：Clerk でログインし、2.0 専用の Turso に保存する。架空データだけで使う。
//   会社ごとにデータベースを分ける作りはまだなく、検証用は1つのデータベースを使う
//   （行は会社と本人の ID で必ず絞る。実データを扱う前に、会社ごとに分ける）。
// AI は、どちらの動かし方でもモック（外部の AI にはつながない）。

import { randomBytes } from "node:crypto";
import { createClient, type Client } from "@libsql/client";
import { cookies } from "next/headers";
import type { Env } from "./access";
import { createAuditLog, type AuditLog } from "./audit";
import { createLocalAuth } from "./auth";
import { createClerkAuth } from "./auth-clerk";
import { mockInterviewAi, mockReportGenerator } from "./mock";
import { isProductionBuild, v2Database } from "./mode";
import { createKeyedLimiter, createLimiter, type KeyedLimiter, type Limiter } from "./rate-limit";
import type { Deps } from "./service";
import { createMemoryStore, type V2Store } from "./store";
import { createLibsqlStore } from "./store-libsql";

export const SESSION_COOKIE = "tsugu_v2_sid";
const SID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 検証用の保存先に置ける面談の数の上限（検証は少人数・架空データなので、小さく決める） */
const VERIFY_MAX_ROWS = 200;

const globalForV2 = globalThis as unknown as {
  __tsuguV2Store?: V2Store;
  __tsuguV2Verify?: { url: string; authToken: string | undefined; db: Client; store: V2Store };
  __tsuguV2Audit?: AuditLog;
  __tsuguV2StartLimiter?: Limiter;
  __tsuguV2UserLimiter?: KeyedLimiter;
};

/**
 * 検証用の保存先（2.0 専用の Turso）。
 * 実際につなぐのは、最初に読み書きするとき（ログインしていない人の要求では、つなぎにいかない）。
 * 接続先や鍵の設定が変わっていたら、古い接続を使い続けずに作り直す。
 */
function verifyStore(): V2Store {
  const real = (): V2Store => {
    const target = v2Database();
    if (!target) throw new Error("v2 database is not configured");
    const cached = globalForV2.__tsuguV2Verify;
    if (cached && cached.url === target.url && cached.authToken === target.authToken) return cached.store;
    const db = createClient(target);
    // 検証用は、どの会社も同じデータベースを使う。接続先に会社の ID を埋め込まない
    const store = createLibsqlStore(() => db, { maxRows: VERIFY_MAX_ROWS });
    globalForV2.__tsuguV2Verify = { ...target, db, store };
    return store;
  };
  return {
    get: (id) => real().get(id),
    put: (session) => real().put(session),
    delete: (id) => real().delete(id),
    size: () => real().size(),
  };
}

export function getDeps(mode: "local" | "verify" = "local"): Deps {
  const store = mode === "verify" ? verifyStore() : (globalForV2.__tsuguV2Store ??= createMemoryStore());
  return {
    store,
    ai: mockInterviewAi,
    generator: mockReportGenerator,
    now: () => new Date().toISOString(),
    newId: () => randomBytes(12).toString("base64url"),
  };
}

/** 権限確認つきの入口で使う一式。入口が決めた動かし方を受け取る（検証用は Clerk、手元はログインなし） */
export function getEnv(mode: "local" | "verify"): Env {
  return {
    deps: getDeps(mode),
    auth: mode === "verify" ? createClerkAuth() : createLocalAuth(),
    audit: (globalForV2.__tsuguV2Audit ??= createAuditLog()),
  };
}

/**
 * 「面談を新しく始める」回数の上限（全体で1分に30回まで）。短時間の大量開始を遅らせる。
 * 全体で1つの上限なので、1人が使い切ると、その1分はほかの人も始められない（手元の試作用）。
 */
export function allowNewInterview(): boolean {
  const limiter = (globalForV2.__tsuguV2StartLimiter ??= createLimiter({ max: 30, windowMs: 60_000 }));
  return limiter.allow();
}

/** 検証用：新しく始める回数の、利用者ごとの上限（1人につき1分に5回まで）。1人が使い切っても、ほかの人は始められる */
export function allowNewInterviewFor(userId: string): boolean {
  const limiter = (globalForV2.__tsuguV2UserLimiter ??= createKeyedLimiter({ max: 5, windowMs: 60_000 }));
  return limiter.allow(userId);
}

/** クッキーからセッション ID を読む（手元の試作用）。なければ null */
export async function readSessionId(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && SID_PATTERN.test(value) ? value : null;
}

/** 推測できないセッション ID をサーバーで発行し、httpOnly クッキーに入れる（手元の試作用） */
export async function issueSessionId(): Promise<string> {
  const sid = randomBytes(32).toString("base64url");
  (await cookies()).set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProductionBuild(),
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return sid;
}

export async function clearSessionId(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
