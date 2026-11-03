"use client";

import type { ChatMessage, MyTheme } from "@/lib/interview-types";
import type { ThemeKey } from "@/lib/themes";
import SummarySections from "@/components/SummarySections";
import styles from "./InterviewHistory.module.css";

type Props = {
  /** サーバーが返した自分の会話履歴（確定したテーマの、自分の分だけ） */
  history: { key: ThemeKey; label: string; messages: ChatMessage[] }[];
  /** テーマの番号・要約・共有の状態を引くための自分のテーマ一覧 */
  themes: MyTheme[];
  partnerLabel: string;
  /** 開いているテーマ（親が持つ。進み具合のカードから開けるようにするため） */
  openKeys: ReadonlySet<ThemeKey>;
  onToggle: (key: ThemeKey, open: boolean) => void;
  onSetAll: (open: boolean) => void;
};

/** 進み具合のカードから移動するときの目印（id） */
export function historyItemId(key: ThemeKey): string {
  return `interview-history-${key}`;
}

function shareBadge(shared: boolean | null, partnerLabel: string): { className: string; text: string } {
  if (shared === true) return { className: "badge badge--shared", text: `${partnerLabel}に共有` };
  if (shared === false) return { className: "badge badge--private", text: "共有しない" };
  return { className: "badge badge--undecided", text: "共有を未選択" };
}

/** 会話履歴：確定したテーマごとの会話と要約を、開閉して見返せる（本人にだけ表示） */
export default function InterviewHistory({ history, themes, partnerLabel, openKeys, onToggle, onSetAll }: Props) {
  if (history.length === 0) return null;
  const allOpen = history.every((h) => openKeys.has(h.key));
  const allClosed = history.every((h) => !openKeys.has(h.key));

  return (
    <section className="card" aria-labelledby="interview-history-title">
      <div className={styles.head}>
        <h2 id="interview-history-title">
          会話履歴
          <span className={styles.progress}>
            話したテーマ {history.length}／{themes.length}
          </span>
        </h2>
        <div className={styles.tools}>
          <button type="button" className="toggle" onClick={() => onSetAll(true)} disabled={allOpen}>
            すべて開く
          </button>
          <button type="button" className="toggle" onClick={() => onSetAll(false)} disabled={allClosed}>
            すべて閉じる
          </button>
        </div>
      </div>
      <p className={`muted ${styles.note}`}>
        会話履歴はあなたにだけ表示されます。相手に見えるのは、共有を選んだテーマのまとめだけです。
      </p>
      <ul className={styles.list}>
        {history.map((h) => {
          const index = themes.findIndex((t) => t.key === h.key);
          const theme = index >= 0 ? themes[index] : undefined;
          const badge = shareBadge(theme?.shared ?? null, partnerLabel);
          const title = index >= 0 ? `${index + 1}. ${h.label}` : h.label;
          return (
            <li key={h.key} id={historyItemId(h.key)} className={styles.item}>
              <details
                open={openKeys.has(h.key)}
                onToggle={(e) => {
                  const open = e.currentTarget.open;
                  if (open !== openKeys.has(h.key)) onToggle(h.key, open);
                }}
              >
                <summary className={styles.summary}>
                  <span className={styles.label}>{title}</span>
                  <span className={badge.className}>{badge.text}</span>
                  <span className={styles.count}>やりとり {h.messages.length} 件</span>
                </summary>
                <div className={styles.body}>
                  {h.messages.length > 0 ? (
                    <div className={styles.log} aria-label={`「${h.label}」の会話`}>
                      {h.messages.map((m, i) => (
                        <div
                          key={i}
                          className={m.from === "ai" ? "bubble-row bubble-row--ai" : "bubble-row bubble-row--me"}
                        >
                          <div className={m.from === "ai" ? "bubble bubble--ai" : "bubble bubble--me"}>
                            <span className="visually-hidden">{m.from === "ai" ? "AI：" : "あなた："}</span>
                            {m.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">このテーマの会話は残っていません。</p>
                  )}
                  {theme?.summary && (
                    <>
                      <h3 className={styles.summaryTitle}>確定したまとめ</h3>
                      <SummarySections summary={theme.summary} headingLevel={4} />
                    </>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
