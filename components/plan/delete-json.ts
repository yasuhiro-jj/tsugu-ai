// 90日計画の行動を消す DELETE /api/plan/action 用（components/post-json.ts の postJson と同じ約束・同じ文言）。
// 応答は { ok: true, ... } または { ok: false, error }。サーバーの文言（409・最後の1件など）はそのまま返す。

import type { PostResult } from "@/components/post-json";

const NETWORK_ERROR = "通信に失敗しました。接続を確認して、もう一度お試しください。";
const BUSY_ERROR = "ただいま混み合っています。少し時間をおいて、もう一度お試しください。";
const GENERIC_ERROR = "うまく処理できませんでした。時間をおいて、もう一度お試しください。";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

export async function deleteJson<T>(
  path: string,
  body: unknown,
  pick: (data: Record<string, unknown>) => T | undefined,
): Promise<PostResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "DELETE",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const data: unknown = await res.json().catch(() => null);
  const serverError =
    isObject(data) && typeof data.error === "string" && data.error.trim() !== "" ? data.error : null;
  if (res.status === 429) return { ok: false, error: serverError ?? BUSY_ERROR };
  if (res.ok && isObject(data) && data.ok === true) {
    const picked = pick(data);
    if (picked !== undefined) return { ok: true, data: picked };
  }
  return { ok: false, error: serverError ?? GENERIC_ERROR };
}
