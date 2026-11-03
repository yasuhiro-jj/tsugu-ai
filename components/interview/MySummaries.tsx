"use client";

import type { MyTheme } from "@/lib/interview-types";
import type { ThemeKey } from "@/lib/themes";
import SummarySections from "@/components/SummarySections";

type Props = {
  themes: MyTheme[];
  partnerLabel: string;
  /** 今どのテーマの共有を変更中か */
  savingKey: ThemeKey | null;
  disabled: boolean;
  onChangeShare: (key: ThemeKey, shared: boolean) => void;
  /** 切り替えの直後に、そのテーマの下へ出す短い案内（共有を取り消して診断などが消えたとき） */
  notice?: { key: ThemeKey; text: string } | null;
};

/** 確定済みテーマの要約と、共有する／しないの後からの切り替え */
export default function MySummaries({ themes, partnerLabel, savingKey, disabled, onChangeShare, notice }: Props) {
  const confirmed = themes.filter((t) => t.status === "confirmed" && t.summary);
  if (confirmed.length === 0) return null;

  return (
    <section className="card" aria-labelledby="my-summaries-title">
      <h2 id="my-summaries-title">あなたのまとめ</h2>
      <p className="muted">
        確定したテーマの要約です。{partnerLabel}に共有するかどうかは、ここで後から変更できます。
      </p>
      <ul className="my-summaries">
        {confirmed.map((t) => {
          const saving = savingKey === t.key;
          return (
            <li key={t.key} className="my-summaries__item">
              <details>
                <summary>
                  <span className="my-summaries__label">{t.label}</span>
                  <span
                    className={
                      t.shared === true
                        ? "badge badge--shared"
                        : t.shared === false
                          ? "badge badge--private"
                          : "badge badge--undecided"
                    }
                  >
                    {t.shared === true ? "共有する" : t.shared === false ? "共有しない" : "共有は未選択"}
                  </span>
                </summary>
                {t.summary && <SummarySections summary={t.summary} headingLevel={4} />}
              </details>
              <div
                className="my-summaries__share"
                role="group"
                aria-label={`「${t.label}」を${partnerLabel}に共有するか`}
              >
                <button
                  type="button"
                  className={t.shared === true ? "toggle toggle--on" : "toggle"}
                  aria-pressed={t.shared === true}
                  onClick={() => onChangeShare(t.key, true)}
                  disabled={disabled || saving || t.shared === true}
                >
                  共有する
                </button>
                <button
                  type="button"
                  className={t.shared === false ? "toggle toggle--on" : "toggle"}
                  aria-pressed={t.shared === false}
                  onClick={() => onChangeShare(t.key, false)}
                  disabled={disabled || saving || t.shared === false}
                >
                  共有しない
                </button>
                {saving && (
                  <span className="muted" role="status">
                    保存しています…
                  </span>
                )}
              </div>
              {notice?.key === t.key && (
                <p className="muted" role="status">
                  {notice.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
