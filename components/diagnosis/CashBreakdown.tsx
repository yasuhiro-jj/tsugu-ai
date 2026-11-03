import type { FinancialSummary } from "@/lib/plan-types";
import styles from "./CashBreakdown.module.css";

// お金の動き（資金繰り）の計算式の内訳と、元本の返済についての注記。比較画面と資料の第2・3章で共通。
// 値・式・注記はすべてサーバー（lib/financials.ts）が作った表示用の文字列。ここでは並べるだけで計算しない。
// 項目ごとに区切って並べるので、スマホ幅でも項目の途中で折り返しにくい。

type Cash = FinancialSummary["cashMovement"];

const OP_TEXT: Record<Cash["breakdown"][number]["op"], string> = {
  start: "",
  "+": "＋",
  "−": "−",
  "=": "＝",
};

type Props = {
  cash: Cash;
  /** 「元本の返済は費用ではないので営業利益には入りません。ただし手元のお金は減ります」 */
  principalNote: string;
};

export default function CashBreakdown({ cash, principalNote }: Props) {
  const terms = cash.breakdown ?? [];
  return (
    <div className={styles.box}>
      {terms.length > 0 ? (
        <p className={styles.line}>
          <span className={styles.label}>当期の内訳：</span>
          {terms.map((t, i) => (
            <span key={`${t.label}-${i}`} className={styles.term}>
              {OP_TEXT[t.op] && <span className={styles.op}>{OP_TEXT[t.op]}</span>}
              {t.label} <strong className={t.op === "=" ? styles.result : undefined}>{t.value}</strong>
            </span>
          ))}
        </p>
      ) : (
        cash.breakdownText && (
          <p className={styles.line}>
            <span className={styles.label}>当期の内訳：</span>
            {cash.breakdownText}
          </p>
        )
      )}
      {principalNote && (
        <p className={styles.note} role="note">
          ※{/[。．.]$/.test(principalNote) ? principalNote : `${principalNote}。`}
        </p>
      )}
    </div>
  );
}
