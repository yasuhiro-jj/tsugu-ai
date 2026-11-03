"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ADVISOR_MAX_LENGTH, type AdvisorMessage, type AdvisorState } from "@/lib/advisor-types";
import { postJson } from "@/components/post-json";
import { useElapsedSeconds } from "@/components/use-elapsed";
import MicButton from "@/components/voice/MicButton";
import { appendWithinLimit, voiceLimitNotice } from "@/components/voice/append";
import styles from "./advisor.module.css";

/** 文字数の数え方：前後の空白を除き、絵文字なども1文字（面談の入力欄と同じ） */
function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

/** サーバーの返り値から state を取り出す（形が約束と違えば undefined） */
function pickState(data: Record<string, unknown>): AdvisorState | undefined {
  const s = data.state;
  if (s === null || typeof s !== "object") return undefined;
  const st = s as Partial<AdvisorState>;
  if (
    !Array.isArray(st.messages) ||
    typeof st.remainingTurns !== "number" ||
    typeof st.maxTurns !== "number" ||
    typeof st.maxLength !== "number"
  ) {
    return undefined;
  }
  return st as AdvisorState;
}

type Props = {
  initialState: AdvisorState;
  suggestions: string[];
};

export default function AdvisorClient({ initialState, suggestions }: Props) {
  const [state, setState] = useState<AdvisorState>(initialState);
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState<"idle" | "confirm" | "pending">("idle");
  const [resetError, setResetError] = useState<string | null>(null);
  // 二重送信を防ぐ（state の更新を待たずに止める）
  const busyRef = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const inputId = useId();
  const helpId = useId();

  const sending = pendingText !== null;
  const seconds = useElapsedSeconds(sending);
  const length = countChars(draft);
  const over = length > state.maxLength;
  const noTurns = state.remainingTurns <= 0;
  const busy = sending || resetMode === "pending";
  const canSend = !busy && !noTurns && length > 0 && !over;
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // 音声の結果は非同期で届くので、最新の入力内容をここで持つ（続けて届いても上書きしない）
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
    if (draft.length === 0) setVoiceNotice(null); // 送信して空になったら案内も消す
  }, [draft]);

  function handleVoiceText(text: string) {
    if (busy || noTurns) return;
    const { text: next, truncated } = appendWithinLimit(draftRef.current, text, { max: ADVISOR_MAX_LENGTH });
    setVoiceNotice(truncated ? voiceLimitNotice(ADVISOR_MAX_LENGTH) : null);
    if (next !== draftRef.current) {
      draftRef.current = next;
      setDraft(next);
    }
  }

  /** ［もう一度話す］：入力欄を空にする（続けて届く音声がすぐ空の欄に足されるよう、ref も先に空にする） */
  function clearForVoice() {
    draftRef.current = "";
    setVoiceNotice(null);
    setDraft("");
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages.length, pendingText]);

  useEffect(() => {
    if (resetMode === "confirm") confirmRef.current?.focus();
  }, [resetMode]);

  async function send() {
    if (!canSend || busyRef.current) return;
    busyRef.current = true;
    const text = draft.trim();
    setError(null);
    setPendingText(text);
    try {
      const res = await postJson("/api/advisor/message", { text }, pickState);
      if (res.ok) {
        setState(res.data);
        setDraft("");
      } else {
        // 入力した文は消さない
        setError(res.error);
      }
    } finally {
      setPendingText(null);
      busyRef.current = false;
    }
  }

  async function reset() {
    if (busyRef.current) return;
    busyRef.current = true;
    setResetMode("pending");
    setResetError(null);
    try {
      const res = await postJson("/api/advisor/reset", {}, (data) => pickState(data) ?? null);
      if (!res.ok) {
        setResetError(res.error);
        setResetMode("confirm");
        return;
      }
      if (res.data === null) {
        // state が返らない場合は読み込み直してサーバーの状態を表示する
        window.location.reload();
        return;
      }
      setState(res.data);
      setError(null);
      setResetMode("idle");
    } finally {
      busyRef.current = false;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  function applySuggestion(text: string) {
    setDraft(text);
    inputRef.current?.focus();
  }

  const empty = state.messages.length === 0 && !sending;

  return (
    <section className="card chat" aria-labelledby="advisor-chat-title">
      <h2 id="advisor-chat-title">相談</h2>
      <p className={styles.private} role="note">
        <span className={styles.privateLabel} aria-hidden="true">
          [自分だけ]
        </span>
        この相談は、あなただけに表示されます（相手には見えません。診断や計画にも使いません）
      </p>

      {empty && suggestions.length > 0 && (
        <div className={styles.suggest}>
          <p className={styles.suggestTitle}>相談の例（押すと入力欄に入ります。送信はされません）</p>
          <ul className={styles.suggestList}>
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className={styles.suggestButton}
                  onClick={() => applySuggestion(s)}
                  disabled={busy || noTurns}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="chat__log" role="log" aria-live="polite" aria-relevant="additions">
        {state.messages.map((m, i) => (
          <MessageBubble key={`${m.at}-${i}`} message={m} />
        ))}
        {pendingText !== null && (
          <>
            <div className="bubble-row bubble-row--me">
              <div className="bubble bubble--me bubble--pending">
                <span className="visually-hidden">あなた（送信中）：</span>
                <span className={styles.meText}>{pendingText}</span>
              </div>
            </div>
            <div className="bubble-row bubble-row--ai">
              <div className="bubble bubble--ai bubble--thinking" role="status">
                考えています…（{seconds}秒）
              </div>
            </div>
          </>
        )}
        <div ref={endRef} />
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <label htmlFor={inputId} className="chat__label">
          相談したいこと
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          className="textarea chat__input"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={noTurns}
          readOnly={busy}
          aria-describedby={helpId}
          aria-invalid={over || undefined}
          placeholder={noTurns ? "" : "ここに入力してください"}
        />
        <div id={helpId} className="chat__help">
          <span className={over ? "chat__count chat__count--low" : "chat__count"}>
            {length}／{state.maxLength} 文字
            {over && "（上限を超えています）"}
          </span>
          <span className={styles.turns}>
            {noTurns
              ? "相談できる回数を使い切りました。［会話をやり直す］で、もう一度始められます。"
              : `残り ${state.remainingTurns}／${state.maxTurns} 回`}
          </span>
          {!noTurns && <span className="chat__hint">Ctrl＋Enter でも送信できます</span>}
        </div>
        {voiceNotice && (
          <p className="chat__help" role="status">
            {voiceNotice}
          </p>
        )}
        <div className="button-row" style={{ alignItems: "flex-start" }}>
          <button type="submit" className="button" disabled={!canSend} aria-busy={sending}>
            {sending ? `考えています…（${seconds}秒）` : "送信"}
          </button>
          <MicButton
            onText={handleVoiceText}
            disabled={busy || noTurns}
            hasText={draft.length > 0}
            onClear={clearForVoice}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>

      <div className={styles.resetArea}>
        {resetMode === "idle" ? (
          <div className="button-row">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setResetMode("confirm")}
              disabled={busy || state.messages.length === 0}
            >
              会話をやり直す
            </button>
          </div>
        ) : (
          <div className="inline-confirm" role="group" aria-labelledby="advisor-reset-text">
            <p id="advisor-reset-text" ref={confirmRef} tabIndex={-1}>
              これまでの相談の会話がすべて消えます。元に戻せません。よろしいですか？
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button button--danger-solid"
                onClick={() => void reset()}
                disabled={resetMode === "pending"}
                aria-busy={resetMode === "pending"}
              >
                {resetMode === "pending" ? "消しています…" : "消してやり直す"}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  setResetMode("idle");
                  setResetError(null);
                }}
                disabled={resetMode === "pending"}
              >
                やめる
              </button>
            </div>
            {resetError && (
              <p className="form-error" role="alert">
                {resetError}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function MessageBubble({ message: m }: { message: AdvisorMessage }) {
  if (m.from === "me") {
    return (
      <div className="bubble-row bubble-row--me">
        <div className="bubble bubble--me">
          <span className="visually-hidden">あなた：</span>
          <span className={styles.meText}>{m.text}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bubble-row bubble-row--ai">
      <div className="bubble bubble--ai">
        <span className="visually-hidden">AI参謀：</span>
        <p className={styles.aiText}>{m.text}</p>
        <div className={styles.extra}>
          {m.points.length > 0 && (
            <>
              <p className={styles.pointsTitle}>整理した論点</p>
              <ul className={styles.points}>
                {m.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </>
          )}
          {m.consult !== "不要" && (
            <p className={styles.consult}>
              <span className="badge badge--expert">相談先：{m.consult}</span>
              {m.consultNote && <span className={styles.consultNote}>{m.consultNote}</span>}
            </p>
          )}
          {/* 言い切りに見える表現があったときの注記（文はサーバーの固定文。返事そのものは変えていない） */}
          {m.caution && (
            <p className={styles.caution} role="note">
              {m.caution}
            </p>
          )}
          <p className={styles.draftNote}>AI による下書きです。判断するのはあなたです。</p>
        </div>
      </div>
    </div>
  );
}
