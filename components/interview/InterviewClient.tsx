"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewState, ThemeSummary } from "@/lib/interview-types";
import { themeLabel, type ThemeKey } from "@/lib/themes";
import { interviewApi, type ApiResult } from "./api";
import ThemeProgress, { isPrivateByDefault } from "./ThemeProgress";
import ChatPanel from "./ChatPanel";
import SummaryCard from "./SummaryCard";
import ShareChoice from "./ShareChoice";
import MySummaries from "./MySummaries";

type Action = "start" | "message" | "summary" | "share";

/**
 * AI面談の画面本体。
 * 表示するのはサーバーが返した「自分のデータ」だけ。相手のデータはここでは一切扱わない。
 */
export default function InterviewClient() {
  const [state, setState] = useState<InterviewState | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startFailed, setStartFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [shareSavingKey, setShareSavingKey] = useState<ThemeKey | null>(null);
  const [resumeLabel, setResumeLabel] = useState<string | null>(null);

  const loadedRef = useRef(false);
  const startedRef = useRef<Set<ThemeKey>>(new Set());

  const load = useCallback(async () => {
    setLoadStatus("loading");
    setLoadError(null);
    const r = await interviewApi.get();
    if (!r.ok) {
      setLoadError(r.error);
      setLoadStatus("error");
      return;
    }
    const s = r.state;
    if (s.currentThemeKey && s.messages.length > 0) {
      const label = s.themes.find((t) => t.key === s.currentThemeKey)?.label ?? themeLabel(s.currentThemeKey);
      setResumeLabel(label);
    }
    setState(s);
    setLoadStatus("ready");
  }, []);

  // 初回読み込み（開発時の二重実行を防ぐ）
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void load();
  }, [load]);

  /** API を呼び、成功なら最新状態に置き換える。失敗ならエラーを表示して false を返す */
  const run = useCallback(async (kind: Action, call: () => Promise<ApiResult>): Promise<boolean> => {
    setAction(kind);
    setError(null);
    try {
      const r = await call();
      if (r.ok) {
        setState(r.state);
        return true;
      }
      setError(r.error);
      return false;
    } finally {
      setAction(null);
    }
  }, []);

  const runStart = useCallback(async () => {
    setStartFailed(false);
    const ok = await run("start", interviewApi.start);
    if (!ok) setStartFailed(true);
  }, [run]);

  // 今のテーマの会話がまだ空なら、AI の最初の問いかけを作ってもらう
  useEffect(() => {
    if (!state || action !== null || state.finished) return;
    const key = state.currentThemeKey;
    if (!key || state.messages.length > 0 || state.pendingShareThemeKey) return;
    const current = state.themes.find((t) => t.key === key);
    if (current?.status === "awaiting_confirmation") return;
    if (startedRef.current.has(key)) return;
    startedRef.current.add(key);
    void runStart();
  }, [state, action, runStart]);

  async function send() {
    const original = draft;
    const text = draft.trim();
    if (!text || action !== null) return;
    setPendingText(text);
    setDraft("");
    const ok = await run("message", () => interviewApi.message(text));
    setPendingText(null);
    // 失敗したときは入力した文章を元に戻す（消さない）
    if (!ok) setDraft((cur) => (cur === "" ? original : cur));
  }

  async function confirmSummary(key: ThemeKey, edited?: ThemeSummary) {
    await run("summary", () => interviewApi.confirm(key, edited));
  }

  async function discardSummary(key: ThemeKey) {
    await run("summary", () => interviewApi.discard(key));
  }

  async function decideShare(key: ThemeKey, shared: boolean) {
    setShareSavingKey(key);
    await run("share", () => interviewApi.share(key, shared));
    setShareSavingKey(null);
  }

  if (loadStatus === "loading" && !state) {
    return (
      <section className="card" role="status">
        <p>面談の準備をしています…</p>
      </section>
    );
  }

  if (loadStatus === "error" || !state) {
    return (
      <section className="card notice">
        <h2>面談を読み込めませんでした</h2>
        <p role="alert">{loadError ?? "時間をおいて、もう一度お試しください。"}</p>
        <div className="button-row">
          <button type="button" className="button" onClick={() => void load()}>
            もう一度読み込む
          </button>
        </div>
      </section>
    );
  }

  const busy = action !== null;
  const awaitingTheme =
    state.themes.find((t) => t.key === state.currentThemeKey && t.status === "awaiting_confirmation" && t.summary) ??
    state.themes.find((t) => t.status === "awaiting_confirmation" && t.summary) ??
    null;
  const pendingShareTheme = state.pendingShareThemeKey
    ? (state.themes.find((t) => t.key === state.pendingShareThemeKey) ?? null)
    : null;
  const currentLabel = state.currentThemeKey
    ? (state.themes.find((t) => t.key === state.currentThemeKey)?.label ?? themeLabel(state.currentThemeKey))
    : null;

  let disabledReason: string | null = null;
  if (awaitingTheme) {
    disabledReason = "下のまとめを確認するまで、入力はできません。";
  } else if (startFailed && state.messages.length === 0) {
    disabledReason = "最初の質問を読み込めませんでした。「もう一度試す」を押してください。";
  }

  return (
    <div className="interview">
      <p className="interview__who">
        {state.displayName} さんとして面談しています
        {currentLabel && !state.finished && <>（いまのテーマ：{currentLabel}）</>}
      </p>

      {resumeLabel && (
        <p className="resume-note" role="status">
          前回は『{resumeLabel}』まで話しました。続きから始めます。
        </p>
      )}

      <ThemeProgress themes={state.themes} currentThemeKey={state.currentThemeKey} />

      {error && (
        <div className="card notice error-box">
          <p role="alert" className="form-error">
            {error}
          </p>
          {startFailed && (
            <div className="button-row">
              <button type="button" className="button" onClick={() => void runStart()} disabled={busy}>
                もう一度試す
              </button>
            </div>
          )}
        </div>
      )}

      {pendingShareTheme ? (
        <ShareChoice
          key={pendingShareTheme.key}
          themeLabel={pendingShareTheme.label}
          partnerLabel={state.partnerLabel}
          summary={pendingShareTheme.summary}
          privateByDefault={isPrivateByDefault(pendingShareTheme.key)}
          busy={action === "share"}
          onDecide={(shared) => void decideShare(pendingShareTheme.key, shared)}
        />
      ) : state.finished ? (
        <section className="card finished" aria-labelledby="finished-title">
          <h2 id="finished-title">面談はすべて終わりました</h2>
          <p>おつかれさまでした。共有を選んだまとめは、認識差の比較で確かめられます。</p>
          <div className="button-row">
            <Link href="/compare" className="button">
              認識差の比較へ
            </Link>
          </div>
          <p className="muted finished__next">
            もう一方の役割で面談する場合は、<Link href="/">トップ</Link>で役割を切り替えてください。
          </p>
        </section>
      ) : (
        state.currentThemeKey && (
          <>
            <ChatPanel
              messages={state.messages}
              pendingText={pendingText}
              thinking={action === "start" || action === "message"}
              draft={draft}
              onDraftChange={setDraft}
              onSend={() => void send()}
              disabledReason={disabledReason}
            />
            {awaitingTheme && awaitingTheme.summary && (
              <SummaryCard
                key={awaitingTheme.key}
                themeLabel={awaitingTheme.label}
                summary={awaitingTheme.summary}
                busy={action === "summary"}
                onConfirm={(edited) => void confirmSummary(awaitingTheme.key, edited)}
                onDiscard={() => void discardSummary(awaitingTheme.key)}
              />
            )}
          </>
        )
      )}

      <MySummaries
        themes={state.themes}
        partnerLabel={state.partnerLabel}
        savingKey={shareSavingKey}
        disabled={busy}
        onChangeShare={(key, shared) => void decideShare(key, shared)}
      />

      <p className="interview__footnote">
        AIによる聞き取りです。内容はあなたが確認してから保存されます。デモのため、実在の個人情報や会社の数字は入力しないでください。
      </p>
    </div>
  );
}
