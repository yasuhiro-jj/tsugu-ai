"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { ItemKind } from "@/lib/v2/types";

export const KIND_LABELS: Record<ItemKind, string> = {
  statement: "ご本人の発言",
  ai_note: "AIの整理案",
  unconfirmed: "未確認",
  option: "関心のある選択肢",
};

export const KIND_HELP: Record<ItemKind, string> = {
  statement: "面談で入力した文章そのままです。",
  ai_note: "AIがまとめた案です。事実とは限りません。違っていたら直すか、候補から外してください。",
  unconfirmed: "まだ確かめていないことです。「問題なし」という意味ではありません。",
  option: "知りたい選択肢です。決めたわけではありません。",
};

const STEPS = [
  { href: "/v2/interview", label: "面談" },
  { href: "/v2/review", label: "内容の確認" },
  { href: "/v2/options", label: "選択肢" },
  { href: "/v2/report", label: "資料に載せる項目" },
  { href: "/v2/report/preview", label: "資料の下書き" },
];

export function Steps({ current }: { current: number }) {
  return (
    <ol className="v2-steps" aria-label="進み具合">
      {STEPS.map((s, i) => (
        <li key={s.href} className={i === current ? "v2-steps__item v2-steps__item--current" : "v2-steps__item"}>
          <span className="v2-steps__num">{i + 1}</span>
          {i === current ? <span aria-current="step">{s.label}</span> : <span>{s.label}</span>}
        </li>
      ))}
    </ol>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="error-box" role="alert">
      {message}
    </p>
  );
}

export function Loading() {
  return <p className="muted">読み込んでいます…</p>;
}

/** まだその段階に進めないときの案内 */
export function Guide({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return (
    <div className="card">
      <p>{children}</p>
      <p>
        <Link className="button" href={href}>
          {label}
        </Link>
      </p>
    </div>
  );
}
