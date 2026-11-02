"use client";

import { useEffect, useRef, useState } from "react";

/** このブラウザのデモデータを消してやり直す（画面内で確認してから実行） */
export default function ResetDemoButton() {
  const [mode, setMode] = useState<"idle" | "confirm" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (mode === "confirm") confirmRef.current?.focus();
  }, [mode]);

  async function reset() {
    setMode("pending");
    setError(null);
    try {
      const res = await fetch("/api/demo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data: unknown = await res.json().catch(() => null);
      const ok = res.ok && data !== null && typeof data === "object" && (data as { ok?: unknown }).ok === true;
      if (!ok) {
        const msg =
          data !== null && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
            ? (data as { error: string }).error
            : "やり直しできませんでした。時間をおいてもう一度お試しください。";
        setError(msg);
        setMode("confirm");
        return;
      }
      window.location.reload();
    } catch {
      setError("通信に失敗しました。接続を確認してもう一度お試しください。");
      setMode("confirm");
    }
  }

  if (mode === "idle") {
    return (
      <div className="button-row">
        <button type="button" className="button button--secondary" onClick={() => setMode("confirm")}>
          このブラウザのデモをやり直す
        </button>
      </div>
    );
  }

  return (
    <div className="inline-confirm" role="group" aria-labelledby="reset-confirm-text">
      <p id="reset-confirm-text" ref={confirmRef} tabIndex={-1}>
        このブラウザのデモで作った、面談の回答・共有の設定・認識差の診断・学習プラン・90日計画（先代・後継者の両方）がすべて消えます。元に戻せません。よろしいですか？
      </p>
      <div className="button-row">
        <button
          type="button"
          className="button button--danger-solid"
          onClick={() => void reset()}
          disabled={mode === "pending"}
          aria-busy={mode === "pending"}
        >
          {mode === "pending" ? "消しています…" : "消してやり直す"}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            setMode("idle");
            setError(null);
          }}
          disabled={mode === "pending"}
        >
          やめる
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
