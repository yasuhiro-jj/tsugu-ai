"use client";

import { useEffect, useState } from "react";

/** active の間、経過秒数を数える（AI の処理待ちの表示用） */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}
