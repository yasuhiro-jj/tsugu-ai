"use client";

import { useEffect, useState } from "react";

// 講座の数字・例が「飲食店」「つぐみ」のものであることを、設定に応じて小さく知らせる。
// 設定は GET /api/settings（このデモの設定。二人の共有物）から業種と「初期値かどうか」だけを使う。
// 読み込み中・読み込めないときは何も出さない（初期値のつぐみなら注記は不要なため）。

type NoteState = { notRestaurant: boolean; notDefault: boolean } | null;

export default function CourseExampleNote({ className }: { className?: string }) {
  const [state, setState] = useState<NoteState>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (!alive || data === null || typeof data !== "object") return;
        const d = data as { ok?: unknown; isDefault?: unknown; settings?: { industry?: unknown } };
        if (d.ok !== true) return;
        setState({
          notRestaurant: typeof d.settings?.industry === "string" && d.settings.industry !== "restaurant",
          notDefault: d.isDefault === false,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!state || (!state.notRestaurant && !state.notDefault)) return null;

  return (
    <p className={className ?? "muted"} role="note">
      <small>
        {state.notRestaurant && "飲食店向けの例です。"}
        {state.notDefault && "講座の数字は架空の「つぐみ」の例です。"}
      </small>
    </p>
  );
}
