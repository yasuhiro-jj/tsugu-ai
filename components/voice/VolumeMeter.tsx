"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./MicButton.module.css";

const BAR_COUNT = 6;
/** 「動きを減らす」設定のときは、ゆっくり（この間隔ごとに）だけ更新する */
const REDUCED_INTERVAL_MS = 500;

/**
 * 聞き取り中だけ表示する音量メーター（飾り。aria-hidden）。
 * 表示されている間だけマイクの音量を取り、外れたら必ずマイクを離して AudioContext を閉じる。
 * マイクの許可が取れないなどで失敗したら何も出さない（音声入力そのものは続ける）。
 */
export default function VolumeMeter() {
  const [ready, setReady] = useState(false);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;

    function cleanup() {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
      ctx = null;
    }

    async function begin() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        // 声の主な高さの範囲（低い方の 1/3 ほど）を、バーの本数に分ける
        const usable = Math.max(BAR_COUNT, Math.floor(data.length / 3));
        const band = Math.floor(usable / BAR_COUNT);
        const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        let last = 0;

        const tick = (now: number) => {
          raf = requestAnimationFrame(tick);
          if (reduced && now - last < REDUCED_INTERVAL_MS) return;
          last = now;
          analyser.getByteFrequencyData(data);
          for (let b = 0; b < BAR_COUNT; b++) {
            let sum = 0;
            for (let i = b * band; i < (b + 1) * band; i++) sum += data[i];
            const level = Math.min(1, sum / band / 180);
            const el = barsRef.current[b];
            if (el) el.style.transform = `scaleY(${(0.15 + level * 0.85).toFixed(3)})`;
          }
        };
        raf = requestAnimationFrame(tick);
        setReady(true);
      } catch {
        cleanup(); // 失敗したらメーターは出さない
      }
    }

    void begin();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return (
    <span className={styles.meter} aria-hidden="true" data-ready={ready ? "true" : "false"} hidden={!ready}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          className={styles.bar}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
        />
      ))}
    </span>
  );
}
