"use client";

import Link from "next/link";
import { useState } from "react";
import { courseDef } from "@/lib/v2/courses";
import { GUIDE_QUESTIONS, suggestLearning, type GuideAnswers } from "@/lib/v2/learning-guide";

// 「自分に合う学びを選ぶ」。答えは画面の中だけで使い、どこにも保存しない（サーバーへも送らない）。
export default function LearnGuideClient() {
  const [answers, setAnswers] = useState<GuideAnswers>({});
  const [shown, setShown] = useState(false);
  const suggestion = suggestLearning(answers);

  function choose(key: keyof GuideAnswers, value: string | undefined) {
    setShown(false);
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  return (
    <>
      <p className="breadcrumb">
        <Link href="/v2/learn">講座の一覧</Link>
      </p>
      <h1 className="page-title">自分に合う学びを選ぶ</h1>
      <p className="lead">
        5つの質問に、答えられるものだけ答えてください。答えない質問があってもかまいません。答えに合わせて、講座の候補をお見せします。候補は目安で、どれを選ぶかはご自分で決められます。
      </p>
      <p className="notice v2-note">ここでの答えは、どこにも保存されません。この画面を閉じると消えます。</p>

      {GUIDE_QUESTIONS.map((q, i) => (
        <fieldset key={q.key} className="card v2-prep">
          <legend className="v2-prep__legend">
            {i + 1}. {q.question}
          </legend>
          <div className="v2-prep__status">
            {q.choices.map((c) => (
              <label key={c.key} className="v2-radio">
                <input
                  type="radio"
                  name={`guide-${q.key}`}
                  checked={answers[q.key] === c.key}
                  onChange={() => choose(q.key, c.key)}
                />
                <span>{c.label}</span>
              </label>
            ))}
            <label className="v2-radio">
              <input
                type="radio"
                name={`guide-${q.key}`}
                checked={answers[q.key] === undefined}
                onChange={() => choose(q.key, undefined)}
              />
              <span>いまは答えない</span>
            </label>
          </div>
        </fieldset>
      ))}

      <div className="card">
        <button className="button" type="button" onClick={() => setShown(true)}>
          候補を見る
        </button>
      </div>

      {shown && (
        <section className="card" aria-live="polite">
          <h2 className="section-title">講座の候補</h2>
          {suggestion.notices.map((n) => (
            <p key={n} className="notice v2-note">
              {n}
            </p>
          ))}
          {suggestion.interviewFirst && (
            <p>
              まず面談から始めるのがよさそうです。面談のあとで、相談資料の下書きを作れます。
              <br />
              <Link className="button button--secondary" href="/v2/interview">
                面談へ
              </Link>
            </p>
          )}
          <ul className="v2-items">
            {suggestion.courses.map((id) => {
              const c = courseDef(id);
              return (
                <li key={id} className="v2-item">
                  <p className="v2-course-card__no">
                    講座 {c.no}・{c.minutes}
                  </p>
                  <p className="v2-step__text">
                    <strong>{c.title}</strong>
                    <br />
                    {c.goal}
                  </p>
                  <Link className="button button--secondary button--small" href={`/v2/learn/${c.id}`}>
                    この講座を開く
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="muted">
            並び順は読みやすい順で、優劣ではありません。ほかの講座も、
            <Link href="/v2/learn">講座の一覧</Link>からいつでも開けます。
          </p>
        </section>
      )}
    </>
  );
}
