"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Course, CourseProgressStatus, LearningState } from "@/lib/plan-types";
import { asObject, postJson } from "@/components/post-json";
import { LEVEL_LABELS, STATUS_CLASS } from "./labels";
import AskPanel from "./AskPanel";
import askStyles from "./AskPanel.module.css";

// 講座ページ：記事3本 → 問題5問 → 採点（サーバー）→ 結果と AI 解説。
// 画面は正解データを持たない。○×はサーバーの採点結果だけで表示する。

type QuizResult = {
  score: number;
  correct: Record<number, boolean>;
  wrongArticleNos: number[];
  status: CourseProgressStatus;
};

type Explain = { pending: boolean; text: string | null; error: string | null };

type Props = {
  course: Course;
  /** 開いた時点の知識レベル（読み込めなかったら null。レベルアップ表示の比較に使う） */
  initialLevel: LearningState["level"] | null;
  initialStatus: CourseProgressStatus;
};

export default function CourseClient({ course, initialLevel, initialStatus }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [status, setStatus] = useState<CourseProgressStatus>(initialStatus);
  const [levelUp, setLevelUp] = useState<LearningState["level"] | null>(null);
  const [explains, setExplains] = useState<Record<number, Explain>>({});
  const resultRef = useRef<HTMLHeadingElement>(null);
  const focusResult = useRef(false);

  useEffect(() => {
    if (focusResult.current && result) {
      focusResult.current = false;
      resultRef.current?.focus();
    }
  }, [result]);

  const total = course.questions.length;
  const answeredCount = course.questions.filter((q) => answers[q.no]).length;
  const allAnswered = answeredCount === total;
  const wrongArticles = new Set(result?.wrongArticleNos ?? []);

  async function grade() {
    if (pending || !allAnswered) return;
    setPending(true);
    setError(null);
    const r = await postJson<{ result: QuizResult; state: LearningState | undefined }>(
      "/api/learning/quiz",
      { courseId: course.id, answers },
      (d) => {
        const res = asObject<QuizResult>(d.result);
        return res ? { result: res, state: asObject<LearningState>(d.state) } : undefined;
      },
    );
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    focusResult.current = true;
    setResult(r.data.result);
    setStatus(r.data.result.status);
    setExplains({});
    const newLevel = r.data.state?.level;
    if (newLevel && initialLevel && newLevel !== initialLevel) setLevelUp(newLevel);
  }

  function retry() {
    setResult(null);
    setAnswers({});
    setExplains({});
    setError(null);
  }

  async function explain(questionNo: number) {
    const chosen = answers[questionNo];
    if (!chosen || explains[questionNo]?.pending) return;
    setExplains((m) => ({ ...m, [questionNo]: { pending: true, text: null, error: null } }));
    const r = await postJson<string>(
      "/api/learning/explain",
      { courseId: course.id, questionNo, chosen },
      (d) => (typeof d.explanation === "string" ? d.explanation : undefined),
    );
    setExplains((m) => ({
      ...m,
      [questionNo]: r.ok
        ? { pending: false, text: r.data, error: null }
        : { pending: false, text: null, error: r.error },
    }));
  }

  return (
    <>
      <section className="card course-head" aria-labelledby="course-goal">
        <p className="course-head__status">
          <span className={STATUS_CLASS[status] ?? "badge"}>{status}</span>
          <span className="muted">対象：{course.level}</span>
        </p>
        <h2 id="course-goal">この講座のゴール</h2>
        <p>{course.goal}</p>
        {course.linkedGap && <p className="plan-item__gap">診断とのつながり：{course.linkedGap}</p>}
      </section>

      <section aria-labelledby="articles-title">
        <h2 id="articles-title" className="section-title">
          記事
        </h2>
        {course.articles.map((a) => (
          <div key={a.no} className={askStyles.row}>
            <article
              id={`article-${a.no}`}
              tabIndex={-1}
              className={wrongArticles.has(a.no) ? "card article article--review" : "card article"}
              aria-labelledby={`article-title-${a.no}`}
            >
              {wrongArticles.has(a.no) && <p className="article__review">復習しましょう</p>}
              <h3 id={`article-title-${a.no}`} className="article__title">
                記事{a.no}　{a.title}
              </h3>
              <ul className="article__body">
                {a.body.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </article>
            <AskPanel courseId={course.id} articleNo={a.no} articleTitle={a.title} />
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="quiz-title">
        <h2 id="quiz-title">確認問題（{total}問）</h2>
        <p className="muted">すべて選んでから「採点する」を押してください。採点はサーバーで行います。</p>

        <ol className="quiz">
          {course.questions.map((q) => {
            const isCorrect = result ? result.correct[q.no] === true : null;
            const ex = explains[q.no];
            return (
              <li
                key={q.no}
                className={
                  isCorrect === null
                    ? "quiz__item"
                    : isCorrect
                      ? "quiz__item quiz__item--ok"
                      : "quiz__item quiz__item--ng"
                }
              >
                <fieldset className="quiz__fieldset">
                  <legend className="quiz__question">
                    {result && (
                      <span
                        className={isCorrect ? "quiz__mark quiz__mark--ok" : "quiz__mark quiz__mark--ng"}
                        aria-label={isCorrect ? "正解" : "不正解"}
                      >
                        {isCorrect ? "○" : "×"}
                      </span>
                    )}
                    問{q.no}　{q.question}
                  </legend>
                  <div className="quiz__choices">
                    {q.choices.map((c) => {
                      const checked = answers[q.no] === c.key;
                      return (
                        <label key={c.key} className={checked ? "choice choice--selected" : "choice"}>
                          <input
                            type="radio"
                            name={`q-${q.no}`}
                            value={c.key}
                            checked={checked}
                            onChange={() => setAnswers((m) => ({ ...m, [q.no]: c.key }))}
                            disabled={pending || result !== null}
                          />
                          <span>
                            {c.key}．{c.text}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                {result && !isCorrect && (
                  <div className="quiz__help">
                    <p>
                      <a href={`#article-${q.articleNo}`}>記事{q.articleNo}を読み直す</a>
                    </p>
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => void explain(q.no)}
                      disabled={ex?.pending}
                      aria-busy={ex?.pending}
                    >
                      {ex?.pending ? "AIが解説を書いています…" : "AIに解説してもらう"}
                    </button>
                    <div role="status" aria-live="polite">
                      {ex?.text && (
                        <div className="explain">
                          <p className="explain__label">AIの解説（下書きです）</p>
                          <p className="explain__text">{ex.text}</p>
                        </div>
                      )}
                    </div>
                    {ex?.error && (
                      <p className="form-error" role="alert">
                        {ex.error}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {!result && (
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => void grade()}
              disabled={pending || !allAnswered}
              aria-busy={pending}
            >
              {pending
                ? "採点しています…"
                : allAnswered
                  ? "採点する"
                  : `あと${total - answeredCount}問選んでください`}
            </button>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {result && (
        <section className="card quiz-result" aria-labelledby="result-title">
          <h2 id="result-title" ref={resultRef} tabIndex={-1}>
            結果：{total}問中 {result.score}問 正解
          </h2>
          <p>
            <span className={STATUS_CLASS[result.status] ?? "badge"}>{result.status}</span>
            {result.status === "完了"
              ? "　おつかれさまでした。この講座は完了です。"
              : "　間違えた問題に関係する記事を読み直してから、もう一度解いてみましょう。"}
          </p>
          {levelUp && (
            <p className="level-up" role="status">
              知識レベルが {levelUp}（{LEVEL_LABELS[levelUp]}）になりました
            </p>
          )}
          {result.wrongArticleNos.length > 0 && (
            <p>
              読み直す記事：
              {result.wrongArticleNos.map((no, i) => (
                <span key={no}>
                  {i > 0 && "、"}
                  <a href={`#article-${no}`}>記事{no}</a>
                </span>
              ))}
            </p>
          )}
          <div className="button-row">
            <button type="button" className="button button--secondary" onClick={retry}>
              もう一度解く
            </button>
            <Link href="/learning" className="button">
              学習プランへ戻る
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
