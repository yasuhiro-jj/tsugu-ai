// 回数の上限。一定の時間内に受け付ける回数を決め、超えたら断る。
// 「面談を新しく始める」操作に使う（短時間に大量に始められて、ほかの人の面談が押し出されるのを防ぐ）。

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
