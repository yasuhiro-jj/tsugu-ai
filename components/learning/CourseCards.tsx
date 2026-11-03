import Link from "next/link";
import type { Course, CourseProgress, LearningPlan } from "@/lib/plan-types";
import CourseExampleNote from "@/components/settings/CourseExampleNote";
import { displayCourseTitle, STATUS_CLASS } from "./labels";

type CourseSummary = Pick<Course, "id" | "title" | "level" | "goal">;

type Props = {
  courses: CourseSummary[];
  progress: CourseProgress[];
  plan: LearningPlan | null;
};

/** 講座カード一覧。おすすめ順（今のプランの順）に並べる */
export default function CourseCards({ courses, progress, plan }: Props) {
  const orderOf = new Map((plan?.plan ?? []).map((p) => [p.course_id, p.order]));
  const sorted = [...courses].sort(
    (a, b) => (orderOf.get(a.id) ?? 99) - (orderOf.get(b.id) ?? 99),
  );

  if (sorted.length === 0) {
    return <p className="muted">講座を読み込めませんでした。時間をおいて開き直してください。</p>;
  }

  return (
    <>
      {/* 業種が飲食店以外・設定が初期値でないときだけ、講座の例について小さく知らせる */}
      <CourseExampleNote />
      <ul className="course-cards">
        {sorted.map((c) => {
          const status = progress.find((p) => p.courseId === c.id)?.status ?? "未着手";
          const order = orderOf.get(c.id);
          return (
            <li key={c.id}>
              <Link href={`/learning/${c.id}`} className="course-card">
                <span className="course-card__top">
                  {order !== undefined && (
                    <span className="course-card__order">おすすめ {order}番目</span>
                  )}
                  <span className={STATUS_CLASS[status] ?? "badge"}>{status}</span>
                </span>
                <span className="course-card__title">{displayCourseTitle(c.title)}</span>
                <span className="course-card__meta">対象：{c.level}</span>
                <span className="course-card__goal">ゴール：{c.goal}</span>
                <span className="course-card__go" aria-hidden="true">
                  講座を開く →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
