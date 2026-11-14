"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MAX_TEXT, THEMES } from "@/lib/v2/content";
import { ErrorBox, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

export default function InterviewClient() {
  const { session, loaded, busy, error, act } = useV2Session();
  const [text, setText] = useState("");
  const logEnd = useRef<HTMLDivElement | null>(null);
  const count = session?.log.length ?? 0;

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  if (!loaded) return <Loading />;

  if (!session) {
    return (
      <>
        <Steps current={0} />
        <h1 className="page-title">一人で始める面談</h1>
        <div className="card">
          <p>質問は7つです。1つずつお聞きします。答えたくない質問は飛ばせます。途中でやめても、続きから再開できます。</p>
          <p className="notice">
            いまは試作です。<strong>実在のお店・人・金額は入力しないでください。</strong>架空の内容でお試しください。
          </p>
          <ErrorBox message={error} />
          <button className="button" type="button" disabled={busy} onClick={() => void act("start")}>
            面談を始める
          </button>
        </div>
      </>
    );
  }

  const inInterview = session.phase === "interview" && session.currentTheme !== null;
  const currentIndex = THEMES.findIndex((t) => t.key === session.currentTheme);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() === "" || busy) return;
    // 失敗したときは入力欄をそのまま残す（打ち直さなくてよいように）
    if (await act("answer", { text })) setText("");
  }

  return (
    <>
      <Steps current={0} />
      <h1 className="page-title">一人で始める面談</h1>
      {inInterview && (
        <p className="muted">
          質問 {currentIndex + 1} / {THEMES.length}：{THEMES[currentIndex]?.label}
        </p>
      )}

      <div className="chat__log v2-log" aria-live="polite">
        {session.log.map((turn, i) => (
          <div key={i} className={turn.who === "ai" ? "bubble-row bubble-row--ai" : "bubble-row bubble-row--me"}>
            <div className={turn.who === "ai" ? "bubble bubble--ai" : "bubble bubble--me"}>
              <span className="visually-hidden">{turn.who === "ai" ? "AI：" : "あなた："}</span>
              <span className="v2-pre">{turn.text}</span>
            </div>
          </div>
        ))}
        <div ref={logEnd} />
      </div>

      <ErrorBox message={error} />

      {inInterview ? (
        <form className="card" onSubmit={onSubmit}>
          <label className="chat__label" htmlFor="v2-answer">
            あなたの答え（架空の内容で）
          </label>
          <textarea
            id="v2-answer"
            className="textarea"
            rows={4}
            maxLength={MAX_TEXT}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <div className="button-row">
            <button className="button" type="submit" disabled={busy || text.trim() === ""}>
              送る
            </button>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => void act("skip")}>
              この質問は飛ばす
            </button>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => void act("finish")}>
              ここで終えて確認へ進む
            </button>
          </div>
          <p className="chat__help">
            中断したいときは、このまま画面を閉じてかまいません。同じブラウザで開くと続きから再開できます（試作のため、サーバーが止まると消えます）。
          </p>
        </form>
      ) : (
        <div className="card">
          <p>面談はここまでです。お話しいただいた内容を整理しました。間違いがないか、確認してください。</p>
          <Link className="button" href="/v2/review">
            内容の確認へ進む
          </Link>
        </div>
      )}
    </>
  );
}
