// AI面談 API の呼び出し（ブラウザ側）。
// 応答は { ok: true, state } または { ok: false, error } に揃える（lib/interview-types.ts の約束）。

import type { InterviewState, ThemeSummary } from "@/lib/interview-types";
import type { ThemeKey } from "@/lib/themes";

export type ApiResult =
  | { ok: true; state: InterviewState }
  | { ok: false; error: string };

const NETWORK_ERROR = "通信に失敗しました。接続を確認して、もう一度お試しください。";
const BUSY_ERROR = "ただいま混み合っています。少し時間をおいて、もう一度お試しください。";
const GENERIC_ERROR = "うまく処理できませんでした。時間をおいて、もう一度お試しください。";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }

  const data: unknown = await res.json().catch(() => null);
  const serverError =
    isObject(data) && typeof data.error === "string" && data.error.trim() !== ""
      ? data.error
      : null;

  if (res.status === 429) {
    return { ok: false, error: serverError ?? BUSY_ERROR };
  }
  if (res.ok && isObject(data) && data.ok === true && isObject(data.state)) {
    return { ok: true, state: data.state as InterviewState };
  }
  return { ok: false, error: serverError ?? GENERIC_ERROR };
}

export const interviewApi = {
  get: () => request("GET", "/api/interview"),
  start: () => request("POST", "/api/interview/start", {}),
  message: (text: string) => request("POST", "/api/interview/message", { text }),
  confirm: (themeKey: ThemeKey, summary?: ThemeSummary) =>
    request("POST", "/api/interview/summary", {
      themeKey,
      decision: "confirm",
      ...(summary ? { summary } : {}),
    }),
  discard: (themeKey: ThemeKey) =>
    request("POST", "/api/interview/summary", { themeKey, decision: "discard" }),
  share: (themeKey: ThemeKey, shared: boolean) =>
    request("POST", "/api/interview/share", { themeKey, shared }),
};
