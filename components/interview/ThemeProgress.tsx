import type { MyTheme, ThemeStatus } from "@/lib/interview-types";
import { THEMES, type ThemeKey } from "@/lib/themes";
import historyStyles from "./InterviewHistory.module.css";

const STATUS_LABELS: Record<ThemeStatus, string> = {
  not_started: "未着手",
  in_progress: "面談中",
  awaiting_confirmation: "確認待ち",
  confirmed: "確定",
  discarded: "保存しない",
};

export function isPrivateByDefault(key: ThemeKey): boolean {
  return THEMES.find((t) => t.key === key)?.defaultShare === false;
}

type Props = {
  themes: MyTheme[];
  currentThemeKey: ThemeKey | null;
  /** 会話履歴があるテーマ。ここに含まれる確定テーマのカードは押せる */
  historyKeys?: ReadonlySet<ThemeKey>;
  /** カードを押したとき：会話履歴の該当テーマへ移動して開く */
  onOpenHistory?: (key: ThemeKey) => void;
};

function shareText(shared: boolean | null): string {
  return shared === true ? "共有する" : shared === false ? "共有しない" : "共有は未選択";
}

export default function ThemeProgress({ themes, currentThemeKey, historyKeys, onOpenHistory }: Props) {
  return (
    <section className="card" aria-labelledby="theme-progress-title">
      <h2 id="theme-progress-title">テーマの進み具合</h2>
      <ol className="theme-progress">
        {themes.map((t, i) => {
          const isCurrent = t.key === currentThemeKey;
          const clickable = t.status === "confirmed" && !!historyKeys?.has(t.key) && !!onOpenHistory;
          const content = (
            <>
              <span className="theme-progress__num">{i + 1}</span>
              <span className="theme-progress__label">{t.label}</span>
              <span className="theme-progress__badges">
                <span className={`badge badge--${t.status}`}>{STATUS_LABELS[t.status]}</span>
                {t.status === "confirmed" && (
                  <span
                    className={
                      t.shared === true
                        ? "badge badge--shared"
                        : t.shared === false
                          ? "badge badge--private"
                          : "badge badge--undecided"
                    }
                  >
                    {shareText(t.shared)}
                  </span>
                )}
              </span>
              {isPrivateByDefault(t.key) && (
                <span className="theme-progress__note">初期設定：共有しない</span>
              )}
            </>
          );
          return (
            <li
              key={t.key}
              className={`theme-progress__item theme-progress__item--${t.status}${
                isCurrent ? " theme-progress__item--current" : ""
              }`}
              aria-current={isCurrent ? "step" : undefined}
            >
              {clickable && onOpenHistory ? (
                <button
                  type="button"
                  className={historyStyles.cardButton}
                  onClick={() => onOpenHistory(t.key)}
                  aria-label={`${t.label}の会話履歴を見る（${STATUS_LABELS[t.status]}、${shareText(t.shared)}）`}
                >
                  {content}
                  <span className={historyStyles.cardHint} aria-hidden="true">
                    会話履歴を見る
                  </span>
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
