import type { ThemeSummary } from "@/lib/interview-types";

// 要約（あなたが話したこと／AIが気づいたこと／これから確認したいこと）の表示。
// サーバーコンポーネント・クライアントコンポーネントのどちらからも使える（フックなし）。

type Labels = {
  statements: string;
  ai_observations: string;
  unconfirmed: string;
};

export const MY_SUMMARY_LABELS: Labels = {
  statements: "あなたが話したこと",
  ai_observations: "AIが気づいたこと（推測です）",
  unconfirmed: "これから確認したいこと",
};

export const SHARED_SUMMARY_LABELS: Labels = {
  statements: "話されたこと",
  ai_observations: "AIが気づいたこと（推測です）",
  unconfirmed: "これから確認したいこと",
};

const KEYS = ["statements", "ai_observations", "unconfirmed"] as const;

type Props = {
  summary: ThemeSummary;
  labels?: Labels;
  /** 見出しのレベル（文書構造に合わせる） */
  headingLevel?: 3 | 4;
};

export default function SummarySections({
  summary,
  labels = MY_SUMMARY_LABELS,
  headingLevel = 3,
}: Props) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="summary-sections">
      {KEYS.map((k) => {
        const items = summary[k] ?? [];
        return (
          <section
            key={k}
            className={k === "ai_observations" ? "summary-block summary-block--ai" : "summary-block"}
          >
            <Heading className="summary-block__title">{labels[k]}</Heading>
            {items.length > 0 ? (
              <ul className="summary-block__list">
                {items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="summary-block__empty">（なし）</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
