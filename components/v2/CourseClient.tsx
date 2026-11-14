"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CHECK_VALUES, courseDef, gradeQuiz, MAX_NOTE, SHAREABLE_NOTES, type CourseId } from "@/lib/v2/courses";
import type { LearningEntry } from "@/lib/v2/types";
import { ErrorBox, Loading } from "./Shared";
import { useV2Session } from "./use-session";

const EMPTY: LearningEntry = { quiz: null, notes: {}, checks: {} };

export default function CourseClient({ courseId }: { courseId: CourseId }) {
  const course = courseDef(courseId);
  const { session, loaded, busy, error, act } = useV2Session();
  const [draft, setDraft] = useState<LearningEntry>(EMPTY);
  const [graded, setGraded] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const saved = session?.learning?.[courseId];

  useEffect(() => {
    if (saved) {
      setDraft(saved);
      setGraded(saved.quiz !== null);
    }
  }, [saved]);

  if (!loaded) return <Loading />;

  function change(patch: Partial<LearningEntry>) {
    setSavedNote(false);
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  async function save() {
    if (await act("saveLearning", { courseId, learning: draft })) setSavedNote(true);
  }

  const correct = draft.quiz !== null && gradeQuiz(courseId, draft.quiz);

  return (
    <>
      <p className="breadcrumb v2-no-print">
        <Link href="/v2/learn">講座の一覧</Link>
      </p>
      <p className="v2-course-card__no">講座 {course.no}・{course.minutes}</p>
      <h1 className="page-title">{course.title}</h1>
      <p className="lead">{course.goal}</p>
      <p className="notice v2-note">
        教材は、専門家の確認を受ける前の下書きです。メモには、実在のお店・人・金額を書かないでください（いまは試作です）。
      </p>
      <ErrorBox message={error} />

      <section className="card">
        <h2 className="section-title">読む教材</h2>
        {course.body.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
        <h3 className="v2-course__sub">架空の例</h3>
        <p>{course.example}</p>
      </section>

      <section className="card">
        <h2 className="section-title">確認問題</h2>
        <fieldset className="v2-quiz">
          <legend>{course.quiz.question}</legend>
          <div className="v2-prep__status">
            {(
              [
                ["yes", "はい"],
                ["no", "いいえ"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="v2-radio">
                <input
                  type="radio"
                  name="quiz"
                  checked={draft.quiz === value}
                  disabled={busy}
                  onChange={() => {
                    change({ quiz: value });
                    setGraded(false);
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          className="button button--secondary v2-no-print"
          type="button"
          disabled={draft.quiz === null}
          onClick={() => setGraded(true)}
        >
          答えを見る
        </button>
        {graded && draft.quiz !== null && (
          <p className="v2-quiz__result" role="status">
            <strong>{correct ? "そのとおりです。" : "答えは「" + (course.quiz.correct === "yes" ? "はい" : "いいえ") + "」です。"}</strong>
            {course.quiz.explanation}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">{course.workTitle}</h2>
        <p className="muted">
          書けるところだけでかまいません。空欄があっても大丈夫です。
          {SHAREABLE_NOTES.some((n) => n.courseId === courseId)
            ? "ここに書いたメモは、面談のあと「資料に載せる項目」の画面に候補として並びます。ご自分で印をつけたものだけが相談資料に入ります（「渡す項目／渡さない項目」は候補になりません）。"
            : "ここに書いたことは、ご自分用のメモです。相談資料には入りません。"}
        </p>
        {course.fields.map((f) => (
          <div key={f.key}>
            <label className="chat__label" htmlFor={`note-${f.key}`}>
              {f.label}
            </label>
            <textarea
              id={`note-${f.key}`}
              className="textarea"
              rows={2}
              maxLength={MAX_NOTE}
              value={draft.notes[f.key] ?? ""}
              disabled={busy}
              onChange={(e) => change({ notes: { ...draft.notes, [f.key]: e.target.value } })}
            />
          </div>
        ))}
        {course.checks.map((f) => (
          <fieldset key={f.key} className="v2-quiz">
            <legend>{f.label}</legend>
            <div className="v2-prep__status">
              {CHECK_VALUES.map((c) => (
                <label key={c.key} className="v2-radio">
                  <input
                    type="radio"
                    name={`check-${f.key}`}
                    checked={draft.checks[f.key] === c.key}
                    disabled={busy}
                    onChange={() => change({ checks: { ...draft.checks, [f.key]: c.key } })}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </section>

      <div className="card v2-no-print">
        <div className="button-row">
          <button className="button" type="button" disabled={busy} onClick={() => void save()}>
            保存する
          </button>
          <button className="button button--secondary" type="button" onClick={() => window.print()}>
            印刷する
          </button>
          <Link className="button button--secondary" href="/v2/learn">
            講座の一覧へ
          </Link>
          <Link className="button button--secondary" href="/v2/interview">
            面談へ
          </Link>
        </div>
        {savedNote && (
          <p className="v2-saved" role="status">
            保存しました。
          </p>
        )}
        <p className="muted">このメモは、どこにも送られません。試作のため、サーバーが止まると消えます。</p>
      </div>
    </>
  );
}
