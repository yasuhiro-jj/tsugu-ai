"use client";

// 2.0 試作の画面が共通で使う、状態の読み込みと操作の送信。

import { useCallback, useEffect, useState } from "react";
import type { SessionView } from "@/lib/v2/types";

const API = "/api/v2/session";
const NETWORK_ERROR = "通信に失敗しました。入力した内容は保存されていません。接続を確かめて、もう一度お試しください。";
const GENERIC_ERROR = "うまく処理できませんでした。少し待って、もう一度お試しください。";

const LOGIN_STUCK =
  "ログインを確かめられませんでした。いちどログアウトしてから、もう一度ログインしてください。それでも入れないときは、運営にお知らせください。";
const MAX_LOGIN_REDIRECTS = 2;
const REDIRECT_KEY = "tsugu-v2-login-redirects";

/** ログインの画面へ移った回数を、このタブの中だけで数える（保存できない環境では、移らずに案内を出す） */
function bumpLoginRedirects(): number {
  try {
    const next = Number(window.sessionStorage.getItem(REDIRECT_KEY) ?? "0") + 1;
    window.sessionStorage.setItem(REDIRECT_KEY, String(next));
    return next;
  } catch {
    return MAX_LOGIN_REDIRECTS + 1;
  }
}

function resetLoginRedirects() {
  try {
    window.sessionStorage.removeItem(REDIRECT_KEY);
  } catch {
    // 数えられない環境では、何もしない
  }
}

type ApiResult = { ok: true; session: SessionView | null } | { ok: false; error: string };

async function call(init?: RequestInit): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(API, { cache: "no-store", ...init });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  // ログインが必要なとき（検証用の環境だけで起こる）は、ログインの画面へ移る。
  // 行ったり来たりを繰り返さないよう、続けて移るのは2回まで。それでも入れないときは、案内を出して止まる
  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/v2/sign-")) {
    if (bumpLoginRedirects() <= MAX_LOGIN_REDIRECTS) {
      window.location.assign("/v2/sign-in");
    } else {
      return { ok: false, error: LOGIN_STUCK };
    }
  } else if (res.ok) {
    resetLoginRedirects();
  }
  const data = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown; session?: unknown } | null;
  if (res.ok && data && data.ok === true) {
    return { ok: true, session: (data.session ?? null) as SessionView | null };
  }
  const error = data && typeof data.error === "string" && data.error !== "" ? data.error : GENERIC_ERROR;
  return { ok: false, error };
}

export function useV2Session() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await call();
    if (result.ok) {
      setSession(result.session);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 操作を送る。成功したら true。失敗したら画面の状態は変えず、エラー文だけ出す */
  const act = useCallback(async (action: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await call({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    setBusy(false);
    if (result.ok) {
      setSession(result.session);
      return true;
    }
    setError(result.error);
    return false;
  }, []);

  return { session, loaded, busy, error, act, reload };
}
