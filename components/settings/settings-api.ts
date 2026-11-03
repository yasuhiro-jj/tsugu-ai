import type { SettingsFieldErrors, SettingsView } from "@/lib/settings-types";

// 設定 API（PUT /api/settings・POST /api/settings/reset）をブラウザから呼ぶ処理。
// 応答の形は lib/settings-types.ts の約束（SettingsSaveResponse）。400 は fieldErrors、409 は rev の食い違い。

export type SaveResult =
  | { kind: "ok"; view: SettingsView; invalidated: boolean }
  | { kind: "fieldErrors"; error: string; fieldErrors: SettingsFieldErrors }
  | { kind: "conflict" }
  | { kind: "error"; error: string };

export const CONFLICT_MESSAGE = "ほかの操作と重なりました。読み込み直してください。";
const NETWORK_ERROR = "通信に失敗しました。接続を確認して、もう一度お試しください。";
const BUSY_ERROR = "ただいま混み合っています。少し時間をおいて、もう一度お試しください。";
const GENERIC_ERROR = "保存できませんでした。時間をおいて、もう一度お試しください。";

/** 消えたものの表示名（SettingsView.willInvalidate のキー） */
const INVALIDATE_LABELS: Record<keyof SettingsView["willInvalidate"], string> = {
  diagnosis: "認識差の診断",
  actionPlan: "90日計画",
  report: "資料",
  myAdvisorChat: "AI参謀の会話",
};

/** 保存前の willInvalidate から、実際にあったもの（＝消えたもの）の表示名を並べる */
export function invalidateLabels(w: SettingsView["willInvalidate"] | undefined): string[] {
  if (!w) return [];
  return (Object.keys(INVALIDATE_LABELS) as (keyof typeof INVALIDATE_LABELS)[])
    .filter((k) => w[k] === true)
    .map((k) => INVALIDATE_LABELS[k]);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toView(data: Record<string, unknown>): SettingsView | null {
  if (!isObject(data.settings) || typeof data.rev !== "number" || !isObject(data.willInvalidate)) return null;
  return {
    settings: data.settings as SettingsView["settings"],
    isDefault: data.isDefault === true,
    rev: data.rev,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    willInvalidate: data.willInvalidate as SettingsView["willInvalidate"],
  };
}

export async function sendSettings(method: "PUT" | "POST", path: string, body: unknown): Promise<SaveResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: "error", error: NETWORK_ERROR };
  }
  const data: unknown = await res.json().catch(() => null);
  const serverError = isObject(data) && typeof data.error === "string" && data.error.trim() !== "" ? data.error : null;

  if (res.status === 409) return { kind: "conflict" };
  if (res.status === 429) return { kind: "error", error: serverError ?? BUSY_ERROR };
  if (res.status === 400 && isObject(data) && isObject(data.fieldErrors)) {
    const fieldErrors = Object.fromEntries(
      Object.entries(data.fieldErrors).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    return { kind: "fieldErrors", error: serverError ?? "入力を確かめてください。", fieldErrors };
  }
  if (res.ok && isObject(data) && data.ok === true) {
    const view = toView(data);
    if (view) return { kind: "ok", view, invalidated: data.invalidated === true };
  }
  return { kind: "error", error: serverError ?? GENERIC_ERROR };
}
