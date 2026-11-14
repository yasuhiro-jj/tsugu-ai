import "server-only";

// 2.0 試作をサーバーで動かすための部品（保存先・モック・セッション用クッキー）。
// 注意：このクッキーは「同じブラウザの続き」を見分けるだけで、本人認証ではない。
// 実データを扱う前に、認証・認可を段階3で別途設計・検証する。

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { Env } from "./access";
import { createAuditLog, type AuditLog } from "./audit";
import { createLocalAuth } from "./auth";
import { mockInterviewAi, mockReportGenerator } from "./mock";
import { createLimiter, type Limiter } from "./rate-limit";
import type { Deps } from "./service";
import { createMemoryStore, type V2Store } from "./store";

export const SESSION_COOKIE = "tsugu_v2_sid";
const SID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const globalForV2 = globalThis as unknown as {
  __tsuguV2Store?: V2Store;
  __tsuguV2Audit?: AuditLog;
  __tsuguV2StartLimiter?: Limiter;
};

export function getDeps(): Deps {
  const store = (globalForV2.__tsuguV2Store ??= createMemoryStore());
  return {
    store,
    ai: mockInterviewAi,
    generator: mockReportGenerator,
    now: () => new Date().toISOString(),
    newId: () => randomBytes(12).toString("base64url"),
  };
}

/** 権限確認つきの入口で使う一式（認証は、ログインのない手元の試作用） */
export function getEnv(): Env {
  return {
    deps: getDeps(),
    auth: createLocalAuth(),
    audit: (globalForV2.__tsuguV2Audit ??= createAuditLog()),
  };
}

/**
 * 「面談を新しく始める」回数の上限（全体で1分に30回まで）。短時間の大量開始を遅らせる。
 * 全体で1つの上限なので、1人が使い切ると、その1分はほかの人も始められない。
 * 送信元ごと・利用者ごとの上限は、本物の認証につなぐときに加える（docs/v2/STAGE3.md）。
 */
export function allowNewInterview(): boolean {
  const limiter = (globalForV2.__tsuguV2StartLimiter ??= createLimiter({ max: 30, windowMs: 60_000 }));
  return limiter.allow();
}

/**
 * 手元の開発環境かどうか。
 * 公開用に組み立てたもの（本番ビルド）と、公開先（Vercel）では false。
 * ログインがなく、メモリ保存のままでは、外から使える状態にしてはいけないため、
 * 「開発用に動かしている」と分かるときだけ API を動かす。
 */
export function isLocalOnly(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL;
}

/** クッキーからセッション ID を読む。なければ null */
export async function readSessionId(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && SID_PATTERN.test(value) ? value : null;
}

/** 推測できないセッション ID をサーバーで発行し、httpOnly クッキーに入れる */
export async function issueSessionId(): Promise<string> {
  const sid = randomBytes(32).toString("base64url");
  (await cookies()).set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return sid;
}

export async function clearSessionId(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
