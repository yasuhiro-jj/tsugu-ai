// ブラウザから API へ POST する共通処理（Content-Type: application/json 固定）。
// 応答は { ok: true, ... } または { ok: false, error } の約束（lib/plan-types.ts）。

export type PostResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NETWORK_ERROR = "通信に失敗しました。接続を確認して、もう一度お試しください。";
const BUSY_ERROR = "ただいま混み合っています。少し時間をおいて、もう一度お試しください。";
const GENERIC_ERROR = "うまく処理できませんでした。時間をおいて、もう一度お試しください。";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

/**
 * POST して、ok:true のときは pick で必要な部分を取り出す。
 * pick が undefined を返したら（形が約束と違う）一般的なエラーにする。
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  pick: (data: Record<string, unknown>) => T | undefined,
): Promise<PostResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
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

/** オブジェクトなら返す（pick 内での簡易チェック用） */
export function asObject<T>(v: unknown): T | undefined {
  return isObject(v) ? (v as T) : undefined;
}
