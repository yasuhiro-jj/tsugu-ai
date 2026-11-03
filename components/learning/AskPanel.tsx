"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { AskAnswer, CourseId } from "@/lib/plan-types";
import { postJson } from "@/components/post-json";
import { useElapsedSeconds } from "@/components/use-elapsed";
import { askExamples } from "./ask-examples";
import MicButton from "@/components/voice/MicButton";
import { appendWithinLimit, voiceLimitNotice } from "@/components/voice/append";
import styles from "./AskPanel.module.css";

// 記事の横（スマホでは下）の「AIに質問する」欄。後継者のみ（使えるかどうかの最終判断はサーバー）。
// 答えは記事ごとに直近の1件だけ画面で覚える（保存しない）。文字列は React の通常の表示だけで出す。

/** サーバー（lib/learning-ask.ts の ASK_QUESTION_MAX_CHARS）と同じ上限 */
const MAX_CHARS = 200;

function charLen(s: string): number {
  return Array.from(s).length;
}

/** 返り値の形が約束（AskAnswer）どおりかを確かめて取り出す */
function pickAnswer(d: Record<string, unknown>): AskAnswer | undefined {
  const a = d.answer;
  if (a === null || typeof a !== "object") return undefined;
  const { text, terms } = a as Record<string, unknown>;
  if (typeof text !== "string" || !Array.isArray(terms)) return undefined;
  const clean = terms.flatMap((t) => {
    if (t === null || typeof t !== "object") return [];
    const { term, meaning } = t as Record<string, unknown>;
    return typeof term === "string" && typeof meaning === "string" ? [{ term, meaning }] : [];
  });
  return { text, terms: clean.slice(0, 3) };
}

type Props = {
  courseId: CourseId;
  articleNo: number;
  articleTitle: string;
};

const MAX_HISTORY = 5;

export default function AskPanel({ courseId, articleNo, articleTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  // これまでの質問と答え（新しい順・最大 MAX_HISTORY 件。画面の中だけで覚え、保存はしない）
  const [answers, setAnswers] = useState<{ question: string; answer: AskAnswer }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seconds = useElapsedSeconds(pending);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const inputId = `${baseId}-input`;
  const countId = `${baseId}-count`;

  const len = charLen(question.trim());
  const over = charLen(question) > MAX_CHARS;
  const canSend = !pending && len > 0 && !over;
  const examples = askExamples(courseId, articleNo);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  // 音声の結果は非同期で届くので、最新の入力内容をここで持つ（続けて届いても上書きしない）
  const questionRef = useRef(question);
  useEffect(() => {
    questionRef.current = question;
    if (question.length === 0) setVoiceNotice(null);
  }, [question]);

  function handleVoiceText(text: string) {
    if (pending) return;
    // 1行入力なので、改行は半角スペースにする
    const { text: next, truncated } = appendWithinLimit(questionRef.current, text, { max: MAX_CHARS, singleLine: true });
    setVoiceNotice(truncated ? voiceLimitNotice(MAX_CHARS) : null);
    if (next !== questionRef.current) {
      questionRef.current = next;
      setQuestion(next);
    }
  }

  /** ［もう一度話す］：入力欄を空にする（続けて届く音声がすぐ空の欄に足されるよう、ref も先に空にする） */
  function clearForVoice() {
    questionRef.current = "";
    setVoiceNotice(null);
    setQuestion("");
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSend || sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    const q = question.trim();
    const r = await postJson<AskAnswer>("/api/learning/ask", { courseId, articleNo, question: q }, pickAnswer);
    sending.current = false;
    setPending(false);
    if (!r.ok) {
      // 失敗したときはサーバーの文言をそのまま出し、入力した質問は消さない
      setError(r.error);
      return;
    }
    setAnswers((prev) => [{ question: q, answer: r.data }, ...prev].slice(0, MAX_HISTORY));
    // 次の質問を前の質問と重ねないよう、答えが出たら入力欄を空にする（オーナー指示 2026-11-03）
    clearForVoice();
    inputRef.current?.focus();
  }

  function clearQuestion() {
    clearForVoice();
    inputRef.current?.focus();
  }

  function fillExample(text: string) {
    setQuestion(text);
    inputRef.current?.focus();
  }

  if (!open) {
    return (
      <div className={styles.panel}>
        <button
          type="button"
          className={`button button--secondary button--small ${styles.toggle}`}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          この記事についてAIに質問する
        </button>
      </div>
    );
  }

  return (
    <div className={styles.panel} id={panelId}>
      <p className={styles.panelTitle}>AIに質問する（記事{articleNo}）</p>

      <div className={styles.examples}>
        <p className={styles.examplesTitle}>質問の例（押すと入力欄に入ります）</p>
        <ul className={styles.exampleList}>
          {examples.map((ex) => (
            <li key={ex}>
              <button type="button" className={styles.exampleButton} onClick={() => fillExample(ex)} disabled={pending}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={inputId} className={styles.label}>
          {answers.length > 0 ? "次の質問を入力してください" : `「${articleTitle}」についての質問`}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className={`input ${styles.input}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-describedby={countId}
          aria-invalid={over || undefined}
          disabled={pending}
          autoComplete="off"
          enterKeyHint="send"
        />
        <p id={countId} className={over ? `${styles.count} ${styles.countOver}` : styles.count}>
          {charLen(question)}／{MAX_CHARS}文字{over && "（上限を超えています）"}
        </p>
        {voiceNotice && (
          <p className={styles.count} role="status">
            {voiceNotice}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" className="button button--small" disabled={!canSend} aria-busy={pending}>
            {pending ? "送信中…" : "質問する"}
          </button>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setOpen(false)}
            disabled={pending}
            aria-expanded={true}
            aria-controls={panelId}
          >
            閉じる
          </button>
          {question.length > 0 && !pending && (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={clearQuestion}
              aria-label="入力欄を消して、新しい質問を書く"
            >
              入力欄を消す
            </button>
          )}
          {/* 欄を開いているときだけ出る（閉じているときはこの部分自体を描かない） */}
          <MicButton
            onText={handleVoiceText}
            disabled={pending}
            size="small"
            hasText={question.length > 0}
            onClear={clearForVoice}
          />
        </div>
      </form>

      <div role="status" aria-live="polite">
        {pending && <p className={styles.waiting}>考えています…（{seconds}秒）</p>}
        {answers.length > 0 && (
          <>
            <p className={styles.termsTitle}>{answers.length > 1 ? `これまでの質問と答え（新しい順・${answers.length}件）` : "質問と答え"}</p>
            {answers.map((a, idx) => (
              <div className="explain" key={answers.length - idx}>
                <p className="explain__label">質問：{a.question}</p>
                <p className={styles.answerText}>{a.answer.text}</p>
                {a.answer.terms.length > 0 && (
                  <>
                    <p className={styles.termsTitle}>ことばの説明</p>
                    <dl className={styles.terms}>
                      {a.answer.terms.map((t, i) => (
                        <div key={i}>
                          <dt>{t.term}</dt>
                          <dd>{t.meaning}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )}
                {a.answer.caution && (
                  <p className={styles.note} role="note">
                    <strong>{a.answer.caution}</strong>
                  </p>
                )}
              </div>
            ))}
            <p className={styles.note}>AIによる説明です。記事にない数字は答えません。税金・融資・法律の判断は専門家に確認してください</p>
          </>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
