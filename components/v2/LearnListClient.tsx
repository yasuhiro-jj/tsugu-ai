"use client";

import Link from "next/link";
import { COURSES } from "@/lib/v2/courses";
import { ErrorBox, Loading } from "./Shared";
import { useV2Session } from "./use-session";

export default function LearnListClient() {
  const { session, loaded, error } = useV2Session();
  if (!loaded) return <Loading />;

  return (
    <>
      <h1 className="page-title">講座</h1>
      <p className="lead">
        1つ5〜10分です。読んで、確認問題に答えて、自分のメモを書きます。順番は自由で、途中でやめてもかまいません。どれも受けなくても、面談や資料づくりはできます。
      </p>
      <p className="notice v2-note">
        教材は、専門家の確認を受ける前の下書きです。金額・契約・税金・衛生などは、資料や公的な情報で確かめ、必要に応じて専門家に相談してください。
      </p>
      <ErrorBox message={error} />

      <ul className="v2-courses">
        {COURSES.map((c) => {
          const entry = session?.learning?.[c.id];
          const written = entry ? Object.keys(entry.notes).length + Object.keys(entry.checks).length : 0;
          const status = !entry
            ? "まだ開いていません"
            : [entry.quiz ? "確認問題に答えました" : null, written > 0 ? `メモ ${written} 件` : null]
                .filter(Boolean)
                .join("／") || "保存した記録はありません";
          return (
            <li key={c.id} className="card v2-course-card">
              <p className="v2-course-card__no">講座 {c.no}・{c.minutes}</p>
              <h2 className="section-title">{c.title}</h2>
              <p>{c.goal}</p>
              <p className="muted">{status}</p>
              <Link className="button button--secondary" href={`/v2/learn/${c.id}`}>
                この講座を開く
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="ai-note">
        講座のメモはご自分用です。相談資料には入りません。学んだ量や正解の数で、人を評価することはありません。
      </p>
    </>
  );
}
