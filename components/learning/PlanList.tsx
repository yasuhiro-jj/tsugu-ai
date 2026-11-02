import type { Course, LearningPlan } from "@/lib/plan-types";
import { courseTitle } from "./labels";

type Props = {
  plan: LearningPlan;
  courses: Pick<Course, "id" | "title">[];
  /** 比べる相手（前のプラン）。指定すると順番が変わった講座に印を付ける */
  previous?: LearningPlan | null;
  /** 印を付けない（前のプラン側の表示用） */
  plain?: boolean;
};

/** 学習プランの項目一覧（order 順） */
export default function PlanList({ plan, courses, previous, plain = false }: Props) {
  const items = [...plan.plan].sort((a, b) => a.order - b.order);
  const prevOrder = new Map((previous?.plan ?? []).map((p) => [p.course_id, p.order]));

  return (
    <ol className="plan-list">
      {items.map((item) => {
        const changed = !plain && previous != null && prevOrder.get(item.course_id) !== item.order;
        return (
          <li
            key={`${item.order}-${item.course_id}`}
            className={changed ? "plan-item plan-item--changed" : "plan-item"}
          >
            <div className="plan-item__head">
              <span className="plan-item__order" aria-label={`${item.order}番目`}>
                {item.order}
              </span>
              <span className="badge">第{item.week}週</span>
              <span className="plan-item__title">{courseTitle(courses, item.course_id)}</span>
            </div>
            {changed && (
              <p className="plan-item__changed">診断を反映して順番が変わりました</p>
            )}
            {item.reason && <p className="plan-item__reason">{item.reason}</p>}
            {item.linked_gap && (
              <p className="plan-item__gap">つながる認識差：{item.linked_gap}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
