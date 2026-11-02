"use client";

import { useState } from "react";
// 型のみ import（ビルド時に消えるため、サーバー専用コードはクライアントに入らない）
import type { Role } from "@/lib/role";

type RoleResponse = { ok: true; role: Role } | { ok: false };

const OPTIONS: ReadonlyArray<{ role: Role; label: string }> = [
  { role: "predecessor", label: "先代として入る" },
  { role: "successor", label: "後継者として入る" },
];

export default function RoleSwitcher() {
  const [pending, setPending] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectRole(role: Role) {
    setPending(role);
    setError(null);
    try {
      const res = await fetch("/api/role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as RoleResponse;
      if (!res.ok || !data.ok) {
        setError("役割を設定できませんでした。時間をおいてもう一度お試しください。");
        setPending(null);
        return;
      }
      // ページを丸ごと読み直して、ヘッダーの役割表示を確実に更新する
      window.location.assign("/interview");
    } catch {
      setError("通信に失敗しました。接続を確認してもう一度お試しください。");
      setPending(null);
    }
  }

  return (
    <div>
      <div className="button-row">
        {OPTIONS.map((opt, i) => (
          <button
            key={opt.role}
            type="button"
            className={i === 0 ? "button" : "button button--secondary"}
            onClick={() => selectRole(opt.role)}
            disabled={pending !== null}
            aria-busy={pending === opt.role}
          >
            {pending === opt.role ? "設定中…" : opt.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
