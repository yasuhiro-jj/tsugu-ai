import "server-only";

// AI 呼び出しの共通の再送ルール（面談 lib/interview/service.ts と JSON 系 lib/ai/json-ai.ts の両方で使う）。
// Next.js に依存しない。テストから時計・待ち時間・DB・AI を差し替えて呼べる。
//
// ルール（オーナー指示 2026-11-02）：
// - 一時的な失敗（SDK の接続エラー／接続タイムアウト、HTTP 429・500・502・503・504・529）のときだけ1回再送する
// - 返事が壊れていた（JSON 不正など）ときの再送は従来どおり1回
// - 1回の呼び出しあたり最大 3 回（最初の1回＋一時エラーの再送1回＋壊れた返事の再送1回）。それ以上は重ねない
// - 再送も reserveAiCall で回数に数える（数えない再送は上限の抜け道になるため。security 指摘）。
//   上限に達していれば reserveAiCall が 429（ServiceError）を投げ、再送しない
// - 一時エラーの再送の前に TRANSIENT_RETRY_DELAY_MS 待つ。時間の予算の残りが
//   「待ち時間＋MIN_RETRY_MS」より少なければ再送しない
// - 初回を含む各試行の前に残り時間が MIN_RETRY_MS 未満なら、回数を予約せずに 502（SEC-202）
// - ログは種類（クラス名）とステータスだけ。入力本文・AI の返事・SDK のエラー本文は出さない

import type { Client } from "@libsql/client";
import { APIConnectionError } from "@anthropic-ai/sdk";
import type { Role } from "../role";
import { ServiceError } from "../errors";
import { reserveAiCall } from "./usage";

/** 一時エラーの再送の前に待つ時間 */
export const TRANSIENT_RETRY_DELAY_MS = 1_500;
/** 再送するのに最低限必要な残り時間。これより短ければ再送せず 502 */
export const MIN_RETRY_MS = 20_000;
/** 一時的な失敗とみなす HTTP ステータス */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504, 529]);

export const MAX_TRANSIENT_RETRIES = 1;
export const MAX_INVALID_RETRIES = 1;

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

/** 一時的な失敗（再送してよい）かどうか。ServiceError（アプリの判断）は対象外。 */
export function isTransientAiError(err: unknown): boolean {
  if (err instanceof ServiceError) return false;
  // APIConnectionTimeoutError は APIConnectionError の子クラス
  if (err instanceof APIConnectionError) return true;
  if (err instanceof Error) {
    const s = statusOf(err);
    return s !== undefined && TRANSIENT_STATUSES.has(s);
  }
  return false;
}

/** ログ用：エラーの種類とステータスだけ（本文は出さない） */
export function errorKind(err: unknown): { error: string; status: string } {
  // SDK のエラーは name が "Error" のことがあるため、クラス名で種類を記録する
  const error = err instanceof Error ? err.constructor?.name || err.name : "UnknownError";
  const s = statusOf(err);
  return { error, status: s === undefined ? "-" : String(s) };
}

export const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type RetryOptions<T> = {
  db: Client;
  demoId: string;
  role: Role;
  /** ログ用（例 interview.ai / diagnosis.ai） */
  where: string;
  /** この操作で AI に使ってよい時間（再送・待ち時間を含む） */
  budgetMs: number;
  /** 時間の予算の起点（省略時は呼び出した時刻）。同じ操作で何度か呼ぶときに共有する */
  startedAt?: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** 1回呼ぶ。timeoutMs はこの1回の待ち時間の上限（残り時間） */
  call: (timeoutMs: number) => Promise<string>;
  /** 返事を読む。だめなら null（壊れた返事として1回だけ再送） */
  parse: (raw: string) => T | null;
  /** 失敗時に利用者へ見せる日本語 */
  failMessage: string;
};

export async function callAiWithRetry<T>(o: RetryOptions<T>): Promise<T> {
  const started = o.startedAt ?? o.now();
  const remaining = () => o.budgetMs - (o.now() - started);
  let transientRetries = 0;
  let invalidRetries = 0;

  for (let attempt = 0; ; attempt++) {
    // 初回を含む各試行の前に、残り時間を確かめる。足りなければ回数を予約せずに止める
    // （面談の要約の依頼し直しなどで、予算切れなのに1回分を消費しないため。SEC-202）
    if (remaining() < MIN_RETRY_MS) {
      console.warn(JSON.stringify({ level: "warn", where: o.where, event: "no_time_for_attempt", attempt }));
      throw new ServiceError(502, o.failMessage);
    }
    // 再送を含め、毎回の呼び出しを回数に数える（上限なら 429 を投げてここで止まる）
    await reserveAiCall(o.db, o.demoId, o.role);
    let raw: string;
    try {
      raw = await o.call(Math.max(1_000, remaining()));
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      const transient = isTransientAiError(err);
      console.error(JSON.stringify({ level: "error", where: o.where, ...errorKind(err), transient, attempt }));
      if (transient && transientRetries < MAX_TRANSIENT_RETRIES) {
        if (remaining() - TRANSIENT_RETRY_DELAY_MS < MIN_RETRY_MS) {
          console.warn(JSON.stringify({ level: "warn", where: o.where, event: "no_time_for_retry" }));
          throw new ServiceError(502, o.failMessage);
        }
        transientRetries++;
        console.warn(JSON.stringify({ level: "warn", where: o.where, event: "retry_transient", attempt }));
        await o.sleep(TRANSIENT_RETRY_DELAY_MS);
        continue;
      }
      throw new ServiceError(502, o.failMessage);
    }
    const parsed = o.parse(raw);
    if (parsed !== null) return parsed;
    console.warn(JSON.stringify({ level: "warn", where: o.where, event: "invalid_output", attempt }));
    if (invalidRetries >= MAX_INVALID_RETRIES) break;
    if (remaining() < MIN_RETRY_MS) {
      console.warn(JSON.stringify({ level: "warn", where: o.where, event: "no_time_for_retry" }));
      break;
    }
    invalidRetries++;
  }
  throw new ServiceError(502, o.failMessage);
}
