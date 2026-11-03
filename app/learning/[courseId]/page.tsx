import Link from "next/link";
import { notFound } from "next/navigation";
import { getRole } from "@/lib/role";
import { getDemoId } from "@/lib/demo";
import type { Course, LearningState } from "@/lib/plan-types";
import CourseClient from "@/components/learning/CourseClient";
import { displayCourseTitle } from "@/components/learning/labels";
import { getCourse, getLearningState, isCourseId } from "@/components/server-data";

export const dynamic = "force-dynamic";

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  if (!isCourseId(courseId)) notFound();

  const role = await getRole();
  if (role !== "successor") {
    return (
      <>
        <h1 className="page-title">講座</h1>
        <section className="card" role="status">
          {role === "predecessor" ? (
            <p>講座は後継者ご本人のページです。</p>
          ) : (
            <>
              <p>講座は、後継者として入ってから見られます。</p>
              <p>
                <Link href="/" className="button">
                  トップで役割を選ぶ
                </Link>
              </p>
            </>
          )}
        </section>
      </>
    );
  }

  // 講座内容は固定（Notion「学習講座コンテンツ v1」）。正解データは含まれない
  const found: Course | null | undefined = await getCourse(courseId);
  if (!found) notFound();
  // 画面へは約束の項目だけを詰め直して渡す（万一サーバー側の値に正解などが混ざっても送らない）
  const course: Course = {
    id: found.id,
    title: found.title,
    level: found.level,
    goal: found.goal,
    linkedGap: found.linkedGap,
    articles: found.articles.map((a) => ({ no: a.no, title: a.title, body: [...a.body] })),
    questions: found.questions.map((q) => ({
      no: q.no,
      question: q.question,
      choices: q.choices.map((c) => ({ key: c.key, text: c.text })),
      articleNo: q.articleNo,
    })),
  };

  const demoId = await getDemoId();
  let state: LearningState | null = null;
  if (demoId) {
    try {
      state = await getLearningState(demoId);
    } catch {
      state = null;
    }
  }

  const status = state?.progress.find((p) => p.courseId === course.id)?.status ?? "未着手";

  return (
    <>
      <p className="breadcrumb">
        <Link href="/learning">学習プラン</Link> ＞ 講座
      </p>
      <h1 className="page-title">{displayCourseTitle(course.title)}</h1>
      {state === null && (
        <section className="card notice">
          <p role="alert">学習の記録を読み込めませんでした。採点はできますが、時間をおいて読み込み直してください。</p>
        </section>
      )}
      <CourseClient course={course} initialLevel={state?.level ?? null} initialStatus={status} />
    </>
  );
}
