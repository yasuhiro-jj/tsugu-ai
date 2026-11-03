"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { AskAnswer, CourseId } from "@/lib/plan-types";
import { isAllowedSourceUrl } from "@/lib/web-search-domains";
import { postJson } from "@/components/post-json";
import { useElapsedSeconds } from "@/components/use-elapsed";
import { askExamples } from "./ask-examples";
import MicButton from "@/components/voice/MicButton";
import { appendWithinLimit, voiceLimitNotice } from "@/components/voice/append";
import styles from "./AskPanel.module.css";

// 記事の下（幅いっぱい）の「この記事についてAIに質問する」欄。後継者のみ（使えるかどうかの最終判断はサーバー）。
// 質問と答えは画面の中だけで覚える（保存しない）。文字列は React の通常の表示だけで出す。
// ［質問する］は記事だけで答える（mode: "article"）。［公的な情報で調べる］は mode: "web"。

/** サーバー（lib/learning-ask.ts の ASK_QUESTION_MAX_CHARS）と同じ上限 */
const MAX_CHARS = 200;
const MAX_HISTORY = 5;
const MAX_SOURCES = 8;

type AskMode = "article" | "web";
type Source = NonNullable<AskAnswer["sources"]>[number];
type Exchange = { id: number; question: string; mode: AskMode; answer: AskAnswer };

function charLen(s: string): number {
  return Array.from(s).length;
}

/** 出典のリンクは、https で、許可した11件のドメインのページだけにする（javascript: や一覧外のサイトを href に入れない。SEC-203） */
function safeUrl(v: unknown): string | null {
  if (!isAllowedSourceUrl(v)) return null;
  try {
    return new URL(v).href;
  } catch {
    return null;
  }
}

function pickSources(v: unknown): Source[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .flatMap((s): Source[] => {
      if (s === null || typeof s !== "object") return [];
      const { url, title, kind } = s as Record<string, unknown>;
      const href = safeUrl(url);
      if (!href || (kind !== "public" && kind !== "private")) return [];
      const name = typeof title === "string" && title.trim() !== "" ? title.trim() : new URL(href).hostname;
      return [{ url: href, title: name, kind }];
    })
    .slice(0, MAX_SOURCES);
}

/** 返り値の形が約束（AskAnswer）どおりかを確かめて取り出す */
function pickAnswer(d: Record<string, unknown>): AskAnswer | undefined {
  const a = d.answer;
  if (a === null || typeof a !== "object") return undefined;
  const { text, terms, caution, sources, searched } = a as Record<string, unknown>;
  if (typeof text !== "string" || !Array.isArray(terms)) return undefined;
  const clean = terms.flatMap((t) => {
    if (t === null || typeof t !== "object") return [];
    const { term, meaning } = t as Record<string, unknown>;
    return typeof term === "string" && typeof meaning === "string" ? [{ term, meaning }] : [];
  });
  const out: AskAnswer = { text, terms: clean.slice(0, 3) };
  if (typeof caution === "string" && caution.trim() !== "") out.caution = caution;
  const src = pickSources(sources);
  if (src) out.sources = src;
  if (typeof searched === "boolean") out.searched = searched;
  return out;
}

type Props = {
  courseId: CourseId;
  articleNo: number;
  articleTitle: string;
};

export default function AskPanel({ courseId, articleNo, articleTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  /** 返事待ちの質問（null なら待っていない） */
  const [pending, setPending] = useState<{ question: string; mode: AskMode } | null>(null);
  // これまでの質問と答え（新しい順・最大 MAX_HISTORY 件。画面の中だけで覚え、保存はしない）
  const [history, setHistory] = useState<Exchange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const sending = useRef(false);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  const busy = pending !== null;
  const seconds = useElapsedSeconds(busy);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;
  const inputId = `${baseId}-input`;
  const countId = `${baseId}-count`;

  const len = charLen(question.trim());
  const over = charLen(question) > MAX_CHARS;
  const canSend = !busy && len > 0 && !over;
  const examples = askExamples(courseId, articleNo);

  // 音声の結果は非同期で届くので、最新の入力内容をここで持つ（続けて届いても上書きしない）
  const questionRef = useRef(question);
  useEffect(() => {
    questionRef.current = question;
    if (question.length === 0) setVoiceNotice(null);
  }, [question]);

  // 閉じたらトグルのボタンへフォーカスを戻す（キーボード操作で迷わないように）
  useEffect(() => {
    if (!open && focusToggle.current) {
      focusToggle.current = false;
      toggleRef.current?.focus();
    }
  }, [open]);

  function handleVoiceText(text: string) {
    if (sending.current) return;
    // 1行入力なので、改行は半角スペースにする
    const { text: next, truncated } = appendWithinLimit(questionRef.current, text, { max: MAX_CHARS, singleLine: true });
    setVoiceNotice(truncated ? voiceLimitNotice(MAX_CHARS) : null);
    if (next !== questionRef.current) {
      questionRef.current = next;
      setQuestion(next);
    }
  }

  /** 入力欄を空にする（続けて届く音声がすぐ空の欄に足されるよう、ref も先に空にする） */
  function clearForVoice() {
    questionRef.current = "";
    setVoiceNotice(null);
    setQuestion("");
  }

  async function send(mode: AskMode) {
    if (!canSend || sending.current) return;
    sending.current = true;
    const q = question.trim();
    setPending({ question: q, mode });
    setError(null);
    setAnnounce(mode === "web" ? "公的な情報を調べています。30秒ほどかかることがあります" : "考えています");
    const r = await postJson<AskAnswer>("/api/learning/ask", { courseId, articleNo, question: q, mode }, pickAnswer);
    sending.current = false;
    setPending(null);
    if (!r.ok) {
      // 失敗したときはサーバーの文言をそのまま出し、入力した質問は消さない
      setError(r.error);
      setAnnounce("");
      return;
    }
    const id = nextId.current++;
    setHistory((prev) => [{ id, question: q, mode, answer: r.data }, ...prev].slice(0, MAX_HISTORY));
    setAnnounce(`AIの答え：${r.data.text}`);
    // 次の質問を前の質問と重ねないよう、答えが出たら入力欄を空にする（オーナー指示 2026-11-03）
    clearForVoice();
    inputRef.current?.focus();
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send("article");
  }

  function clearQuestion() {
    clearForVoice();
    inputRef.current?.focus();
  }

  function fillExample(text: string) {
    setQuestion(text);
    inputRef.current?.focus();
  }

  function close() {
    focusToggle.current = true;
    setOpen(false);
  }

  if (!open) {
    return (
      <div className={styles.closed}>
        <button
          ref={toggleRef}
          type="button"
          className="button button--secondary button--small"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          この記事についてAIに質問する
        </button>
      </div>
    );
  }

  const [latest, ...older] = history;
  const hasWeb = history.some((h) => h.mode === "web");

  return (
    <section className={styles.panel} id={panelId} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h4 id={titleId} className={styles.panelTitle}>
          この記事についてAIに質問する（記事{articleNo}）
        </h4>
        <button
          type="button"
          className={styles.close}
          onClick={close}
          disabled={busy}
          aria-expanded={true}
          aria-controls={panelId}
          aria-label="質問の欄を閉じる"
        >
          閉じる
        </button>
      </div>

      <div className={styles.examples}>
        <p className={styles.examplesTitle} id={`${baseId}-ex`}>
          質問の例（押すと入力欄に入ります）
        </p>
        <ul className={styles.chips} aria-labelledby={`${baseId}-ex`}>
          {examples.map((ex) => (
            <li key={ex}>
              <button type="button" className={styles.chip} onClick={() => fillExample(ex)} disabled={busy}>
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={submit} noValidate>
        <label htmlFor={inputId} className={styles.label}>
          {history.length > 0 ? "次の質問を入力してください" : `「${articleTitle}」についての質問`}
        </label>
        <div className={styles.inputRow}>
          <div className={styles.inputCol}>
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              className={`input ${styles.input}`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              aria-describedby={countId}
              aria-invalid={over || undefined}
              disabled={busy}
              autoComplete="off"
              enterKeyHint="send"
            />
            <div className={styles.inputMeta}>
              {question.length > 0 && !busy ? (
                <button
                  type="button"
                  className={styles.clear}
                  onClick={clearQuestion}
                  aria-label="入力欄を消して、新しい質問を書く"
                >
                  入力欄を消す
                </button>
              ) : (
                <span />
              )}
              <span id={countId} className={over ? `${styles.count} ${styles.countOver}` : styles.count}>
                {charLen(question)}／{MAX_CHARS}文字{over && "（上限を超えています）"}
              </span>
            </div>
            {voiceNotice && (
              <p className={styles.voiceNotice} role="status">
                {voiceNotice}
              </p>
            )}
          </div>
          <div className={styles.buttons}>
            <button
              type="submit"
              className="button button--small"
              disabled={!canSend}
              aria-busy={pending?.mode === "article"}
              title="記事の内容だけで答えます"
            >
              {pending?.mode === "article" ? "送信中…" : "質問する"}
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => void send("web")}
              disabled={!canSend}
              aria-busy={pending?.mode === "web"}
              aria-describedby={`${baseId}-webhelp`}
            >
              {pending?.mode === "web" ? "調べています…" : "公的な情報で調べる"}
            </button>
            <div className={styles.mic}>
              <MicButton
                onText={handleVoiceText}
                disabled={busy}
                size="small"
                hasText={question.length > 0}
                onClear={clearForVoice}
              />
            </div>
          </div>
        </div>
        <p id={`${baseId}-webhelp`} className={styles.help}>
          ［質問する］は記事の内容だけで答えます。［公的な情報で調べる］は国や公的機関などのページも調べて答えます（30秒ほどかかることがあります）。
        </p>
      </form>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announce}
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {(busy || history.length > 0) && (
        <div className={styles.thread}>
          {pending && (
            <div className={styles.exchange} aria-busy={true}>
              <QuestionBubble text={pending.question} />
              <div className={`${styles.answer} ${styles.waiting}`}>
                {pending.mode === "web" ? `公的な情報を調べています…（${seconds}秒）` : `考えています…（${seconds}秒）`}
              </div>
            </div>
          )}

          {latest && (
            <div className={styles.exchange}>
              <QuestionBubble text={latest.question} />
              <AnswerCard item={latest} />
            </div>
          )}

          {older.length > 0 && (
            <div className={styles.older}>
              <p className={styles.olderTitle}>前の質問と答え（新しい順・{older.length}件）</p>
              {older.map((h) => (
                <details key={h.id} className={styles.olderItem}>
                  <summary className={styles.olderSummary}>質問：{h.question}</summary>
                  <div className={styles.exchange}>
                    <AnswerCard item={h} />
                  </div>
                </details>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <p className={styles.note}>
              AIによる説明です。記事の内容だけの答えでは、記事にない数字は答えません。
              {hasWeb && "公的な情報で調べた答えは、出典のページで内容を確かめてください。"}
              税金・融資・法律の判断は専門家に確認してください
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className={styles.questionRow}>
      <div className={styles.question}>
        <p className={styles.who}>あなた</p>
        <p className={styles.questionText}>{text}</p>
      </div>
    </div>
  );
}

function AnswerCard({ item }: { item: Exchange }) {
  const { answer, mode } = item;
  const sources = answer.sources ?? [];
  const noPublic = mode === "web" && (answer.searched !== true || sources.length === 0);
  return (
    <div className={styles.answer}>
      <p className={styles.who}>{mode === "web" ? "AI の答え（公的な情報も調べました）" : "AI の答え（記事から）"}</p>
      <p className={styles.answerText}>{answer.text}</p>

      {answer.terms.length > 0 && (
        <div className={styles.termsBox}>
          <p className={styles.termsTitle}>ことばの説明</p>
          <dl className={styles.terms}>
            {answer.terms.map((t, i) => (
              <div key={i}>
                <dt>{t.term}</dt>
                <dd>{t.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {answer.caution && (
        <p className={styles.caution} role="note">
          {answer.caution}
        </p>
      )}

      {mode === "web" &&
        (noPublic ? (
          <p className={styles.noSources}>公的な情報は見つかりませんでした（記事と AI の知識だけで答えています）</p>
        ) : (
          <div className={styles.sources}>
            <p className={styles.termsTitle}>出典（{sources.length}件・新しいタブで開きます）</p>
            <ul className={styles.sourceList}>
              {sources.map((s) => (
                <li key={s.url} className={styles.source}>
                  <span className={s.kind === "public" ? `${styles.tag} ${styles.tagPublic}` : `${styles.tag} ${styles.tagPrivate}`}>
                    {s.kind === "public" ? "公的機関" : "民間サービス"}
                  </span>
                  <span className={styles.sourceBody}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                      <span className="visually-hidden">（新しいタブで開きます）</span>
                    </a>
                    {s.kind === "private" && (
                      <span className={styles.privateNote}>民間サービスの解説（商品を勧めるものではありません）</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
