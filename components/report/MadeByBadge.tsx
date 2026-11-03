import type { ReportMadeBy } from "@/lib/report-types";
import styles from "./report.module.css";

// 章の作り手の札。色だけに頼らず、文字と枠線の形（実線・破線・二重線）でも区別する。

const LABELS: Record<ReportMadeBy, string> = {
  app: "アプリが計算",
  ai: "AI の下書き",
  "app+ai": "アプリ＋AI",
};

const CLASS: Record<ReportMadeBy, string> = {
  app: styles.badgeApp,
  ai: styles.badgeAi,
  "app+ai": styles.badgeMixed,
};

export function MadeByBadge({ by }: { by: ReportMadeBy }) {
  return (
    <span className={`${styles.badge} ${CLASS[by]}`}>
      <span className="visually-hidden">作り手：</span>
      {LABELS[by]}
    </span>
  );
}

export function CheckBadge() {
  return <span className={`${styles.badge} ${styles.badgeCheck}`}>要確認</span>;
}
