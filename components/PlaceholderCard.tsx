import type { ReactNode } from "react";

type PlaceholderCardProps = {
  title: string;
  children?: ReactNode;
};

/** 中身が未実装の画面で使う「準備中」カード */
export default function PlaceholderCard({ title, children }: PlaceholderCardProps) {
  return (
    <section className="card" aria-label={`${title}（準備中）`}>
      <span className="status-label">準備中</span>
      <h2>{title}</h2>
      {children ?? <p>この機能は現在準備中です。</p>}
    </section>
  );
}
