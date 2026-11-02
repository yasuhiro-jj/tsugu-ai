"use client";

import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessage } from "@/lib/interview-types";
// サーバーの検証と同じ上限値を使う（lib/validation.ts は server-only ではなく、秘密情報も含まない）
import { MESSAGE_MAX_CHARS } from "@/lib/validation";

/** 文字数の数え方はサーバー（lib/validation.ts）に合わせる：前後の空白を除き、絵文字なども1文字 */
function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

type Props = {
  messages: ChatMessage[];
  /** 送信中の自分の発言（応答待ちの間だけ表示） */
  pendingText: string | null;
  /** AI の応答待ち（最初の問いかけを含む） */
  thinking: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  /** 入力欄を使えない理由（null なら入力可） */
  disabledReason: string | null;
};

export default function ChatPanel({
  messages,
  pendingText,
  thinking,
  draft,
  onDraftChange,
  onSend,
  disabledReason,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const helpId = useId();
  const remaining = MESSAGE_MAX_CHARS - countChars(draft);
  const inputDisabled = disabledReason !== null;
  const canSend = !inputDisabled && !thinking && draft.trim().length > 0 && remaining >= 0;

  // 新しい発言が増えたら下までスクロール
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, pendingText, thinking]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSend) onSend();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) onSend();
    }
  }

  return (
    <section className="card chat" aria-labelledby="chat-title">
      <h2 id="chat-title">会話</h2>
      <div className="chat__log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m, i) => (
          <div key={i} className={m.from === "ai" ? "bubble-row bubble-row--ai" : "bubble-row bubble-row--me"}>
            <div className={m.from === "ai" ? "bubble bubble--ai" : "bubble bubble--me"}>
              <span className="visually-hidden">{m.from === "ai" ? "AI：" : "あなた："}</span>
              {m.text}
            </div>
          </div>
        ))}
        {pendingText !== null && (
          <div className="bubble-row bubble-row--me">
            <div className="bubble bubble--me bubble--pending">
              <span className="visually-hidden">あなた（送信中）：</span>
              {pendingText}
            </div>
          </div>
        )}
        {thinking && (
          <div className="bubble-row bubble-row--ai">
            <div className="bubble bubble--ai bubble--thinking" role="status">
              考えています…
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <label htmlFor={inputId} className="chat__label">
          あなたの回答
        </label>
        <textarea
          id={inputId}
          className="textarea chat__input"
          rows={4}
          maxLength={MESSAGE_MAX_CHARS}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={inputDisabled}
          readOnly={thinking}
          aria-describedby={helpId}
          placeholder={inputDisabled ? "" : "ここに入力してください"}
        />
        <div id={helpId} className="chat__help">
          {disabledReason ? (
            <span>{disabledReason}</span>
          ) : (
            <>
              <span className={remaining < 50 ? "chat__count chat__count--low" : "chat__count"}>
                残り {remaining} 文字
              </span>
              <span className="chat__hint">Ctrl＋Enter でも送信できます</span>
            </>
          )}
        </div>
        <div className="button-row">
          <button type="submit" className="button" disabled={!canSend} aria-busy={thinking}>
            {thinking ? "考えています…" : "送信"}
          </button>
        </div>
      </form>
    </section>
  );
}
