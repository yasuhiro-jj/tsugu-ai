// 回数の上限。一定の時間内に受け付ける回数を決め、超えたら断る。
// 「面談を新しく始める」操作に使う（短時間に大量に始められるのを遅らせる）。

export type Limiter = { allow(): boolean };

export function createLimiter(opts: { max: number; windowMs: number; nowMs?: () => number }): Limiter {
  const nowMs = opts.nowMs ?? (() => Date.now());
  let stamps: number[] = [];
  return {
    allow() {
      const limit = nowMs() - opts.windowMs;
      stamps = stamps.filter((t) => t > limit);
      if (stamps.length >= opts.max) return false;
      stamps.push(nowMs());
      return true;
    },
  };
}

export type KeyedLimiter = { allow(key: string): boolean };

/**
 * 利用者ごとの回数の上限。1人が上限に達しても、ほかの人には影響しない。
 * 覚えておく利用者の数にも上限を置く（覚えきれなくなったら、古い記録から捨てる）。
 */
export function createKeyedLimiter(opts: {
  max: number;
  windowMs: number;
  maxKeys?: number;
  nowMs?: () => number;
}): KeyedLimiter {
  const nowMs = opts.nowMs ?? (() => Date.now());
  const maxKeys = opts.maxKeys ?? 1000;
  const stamps = new Map<string, number[]>();
  return {
    allow(key) {
      const limit = nowMs() - opts.windowMs;
      const recent = (stamps.get(key) ?? []).filter((t) => t > limit);
      stamps.delete(key);
      if (recent.length >= opts.max) {
        stamps.set(key, recent);
        return false;
      }
      recent.push(nowMs());
      stamps.set(key, recent);
      while (stamps.size > maxKeys) {
        const oldest = stamps.keys().next().value;
        if (oldest === undefined) break;
        stamps.delete(oldest);
      }
      return true;
    },
  };
}
