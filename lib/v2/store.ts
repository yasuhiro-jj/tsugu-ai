// 2.0 試作の保存先：メモリの中だけ（外部の DB にはつながない）。
// サーバーを止めると消える。本番用の保存先は段階3で別途設計・承認する。

import type { Session } from "./types";

export type V2Store = {
  get(id: string): Session | null;
  put(session: Session): void;
  delete(id: string): void;
  size(): number;
};

const DEFAULT_MAX_SESSIONS = 500;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createMemoryStore(opts?: { maxSessions?: number; ttlMs?: number; nowMs?: () => number }): V2Store {
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
      map.delete(session.id);
      // 上限を超えたら古いものから消す（メモリの使い切りを防ぐ）
      while (map.size >= max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
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
