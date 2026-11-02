import type { MyTheme, ThemeStatus } from "@/lib/interview-types";
import { THEMES, type ThemeKey } from "@/lib/themes";

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
};

export default function ThemeProgress({ themes, currentThemeKey }: Props) {
  return (
    <section className="card" aria-labelledby="theme-progress-title">
      <h2 id="theme-progress-title">テーマの進み具合</h2>
      <ol className="theme-progress">
        {themes.map((t, i) => {
          const isCurrent = t.key === currentThemeKey;
          return (
            <li
              key={t.key}
              className={`theme-progress__item theme-progress__item--${t.status}${
                isCurrent ? " theme-progress__item--current" : ""
              }`}
              aria-current={isCurrent ? "step" : undefined}
            >
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
                    {t.shared === true ? "共有する" : t.shared === false ? "共有しない" : "共有は未選択"}
                  </span>
                )}
              </span>
              {isPrivateByDefault(t.key) && (
                <span className="theme-progress__note">初期設定：共有しない</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
