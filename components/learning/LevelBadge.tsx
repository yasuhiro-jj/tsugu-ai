import type { LearningState } from "@/lib/plan-types";
import { LEVEL_LABELS } from "./labels";

/** 知識レベルのバッジ（Lv1 言葉を知る … Lv4 自分で判断する） */
export default function LevelBadge({ level }: { level: LearningState["level"] }) {
  return (
    <span className="level-badge">
      <span className="visually-hidden">現在の知識レベル：</span>
      <span className="level-badge__lv">{level}</span>
      <span className="level-badge__label">{LEVEL_LABELS[level] ?? ""}</span>
    </span>
  );
}
