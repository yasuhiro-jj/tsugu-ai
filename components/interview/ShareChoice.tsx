"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ThemeSummary } from "@/lib/interview-types";
import SummarySections from "@/components/SummarySections";

type Props = {
  themeLabel: string;
  partnerLabel: string;
  summary: ThemeSummary | null;
  /** 初期設定で「共有しない」のテーマ（締め）なら true */
  privateByDefault: boolean;
  busy: boolean;
  onDecide: (shared: boolean) => void;
};

/** 要約を確定した直後の「相手に共有するか」の選択 */
export default function ShareChoice({
  themeLabel,
  partnerLabel,
  summary,
  privateByDefault,
  busy,
  onDecide,
}: Props) {
  // 締めのテーマは最初から「共有しない」を選んだ状態。それ以外は本人に選んでもらう
  const [choice, setChoice] = useState<boolean | null>(privateByDefault ? false : null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const name = useId();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="card share-choice" aria-labelledby="share-choice-title">
      <p className="summary-card__theme">テーマ：{themeLabel}（確定しました）</p>
      <h2 id="share-choice-title" ref={headingRef} tabIndex={-1}>
        この要約を{partnerLabel}に共有しますか？
      </h2>

      {summary && (
        <details className="share-choice__preview">
          <summary>確定した要約を見る</summary>
          <SummarySections summary={summary} />
        </details>
      )}

      <fieldset className="share-choice__options">
        <legend className="visually-hidden">共有の選択</legend>
        <label className={choice === true ? "choice choice--selected" : "choice"}>
          <input
            type="radio"
            name={name}
            checked={choice === true}
            onChange={() => setChoice(true)}
            disabled={busy}
          />
          <span>共有する</span>
        </label>
        <label className={choice === false ? "choice choice--selected" : "choice"}>
          <input
            type="radio"
            name={name}
            checked={choice === false}
            onChange={() => setChoice(false)}
            disabled={busy}
          />
          <span>
            共有しない
            {privateByDefault && <span className="choice__note">（初期設定）</span>}
          </span>
        </label>
      </fieldset>

      <p className="share-choice__help">
        共有しない内容は、相手には見えず、存在も伝わりません。後から変更できます。
      </p>

      <div className="button-row">
        <button
          type="button"
          className="button"
          onClick={() => choice !== null && onDecide(choice)}
          disabled={busy || choice === null}
        >
          {busy
            ? "保存しています…"
            : choice === null
              ? "共有する／しないを選んでください"
              : choice
                ? "「共有する」で確定"
                : "「共有しない」で確定"}
        </button>
      </div>
    </section>
  );
}
