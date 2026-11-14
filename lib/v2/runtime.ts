import "server-only";

// 2.0 試作をサーバーで動かすための部品（保存先・モック・セッション用クッキー）。
// 注意：このクッキーは「同じブラウザの続き」を見分けるだけで、本人認証ではない。
// 実データを扱う前に、認証・認可を段階3で別途設計・検証する。

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { mockInterviewAi, mockReportGenerator } from "./mock";
import type { Deps } from "./service";
import { createMemoryStore, type V2Store } from "./store";

export const SESSION_COOKIE = "tsugu_v2_sid";
const SID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const globalForV2 = globalThis as unknown as { __tsuguV2Store?: V2Store };

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

/**
 * 手元の開発環境かどうか。公開先（Vercel）では false。
 * メモリ保存は公開先では正しく動かない（消去や順番を保証できない）ため、公開先では API を止める。
 */
export function isLocalOnly(): boolean {
  return !process.env.VERCEL;
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
