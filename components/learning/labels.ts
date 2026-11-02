import type { Course, CourseId, CourseProgressStatus, LearningState } from "@/lib/plan-types";

// 学習まわりの表示用ラベル（フックなし）。

export const LEVEL_LABELS: Record<LearningState["level"], string> = {
  Lv1: "言葉を知る",
  Lv2: "自店の数字を読む",
  Lv3: "一緒に判断する",
  Lv4: "自分で判断する",
};

export const STATUS_CLASS: Record<CourseProgressStatus, string> = {
  未着手: "badge",
  学習中: "badge badge--in_progress",
  完了: "badge badge--confirmed",
  復習をおすすめ: "badge badge--awaiting_confirmation",
};

/** 講座 ID → 講座名（見つからなければ ID をそのまま） */
export function courseTitle(courses: Pick<Course, "id" | "title">[], id: CourseId | string): string {
  return courses.find((c) => c.id === id)?.title ?? id;
}
