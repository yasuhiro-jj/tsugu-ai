// 2.0 試作の保存先：メモリの中だけ（外部の DB にはつながない）。
// サーバーを止めると消える。本番用の保存先は段階3で別途設計・承認する。

import type { Session } from "./types";

type Awaitable<T> = T | Promise<T>;

/**
 * 面談の保存先。メモリ（手元の試作）でも、データベース（lib/v2/store-libsql.ts）でも同じ形で使う。
 * データベースは返事を待つ必要があるので、呼ぶ側は必ず待つ（await）。
 */
export type V2Store = {
  get(id: string): Awaitable<Session | null>;
  put(session: Session): Awaitable<void>;
  delete(id: string): Awaitable<void>;
  size(): Awaitable<number>;
};

/** メモリの保存先。待たずに使える（テストで中身を直接確かめるため） */
export type MemoryStore = {
  get(id: string): Session | null;
  put(session: Session): void;
  delete(id: string): void;
  size(): number;
};

/**
 * 読んだあとで、ほかの操作が先に保存していた（同じ面談を、別の画面や別のサーバーが同時に変えた）。
 * 上書きして相手の変更を消さないよう、保存を断る
 */
export class StoreConflictError extends Error {
  constructor() {
    super("store_conflict");
    this.name = "StoreConflictError";
  }
}

/** 保存してある中身が壊れていて、面談として読めない */
export class StoreCorruptError extends Error {
  constructor() {
    super("store_corrupt");
    this.name = "StoreCorruptError";
  }
}

/** 保存先がいっぱいで、新しい面談を受け付けられない */
export class StoreFullError extends Error {
  constructor() {
    super("store_full");
    this.name = "StoreFullError";
  }
}

const DEFAULT_MAX_SESSIONS = 500;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createMemoryStore(opts?: { maxSessions?: number; ttlMs?: number; nowMs?: () => number }): MemoryStore {
  const max = opts?.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const nowMs = opts?.nowMs ?? (() => Date.now());
  const map = new Map<string, { session: Session; touchedAt: number }>();

  function sweep() {
    const limit = nowMs() - ttl;
    for (const [id, entry] of map) {
      if (entry.touchedAt < limit) map.delete(id);
    }
  }

  return {
    get(id) {
      sweep();
      const entry = map.get(id);
      // 呼び出し側の書き換えが保存内容に影響しないよう、必ず写しを返す
      return entry ? structuredClone(entry.session) : null;
    },
    put(session) {
      sweep();
      // いっぱいのときは、すでにある面談を消さずに、新しい面談を断る
      // （大量に始められて、ほかの人の面談が押し出されることがないように）
      if (!map.has(session.id) && map.size >= max) throw new StoreFullError();
      map.delete(session.id);
      map.set(session.id, { session: structuredClone(session), touchedAt: nowMs() });
    },
    delete(id) {
      map.delete(id);
    },
    size() {
      sweep();
      return map.size;
    },
  };
}
