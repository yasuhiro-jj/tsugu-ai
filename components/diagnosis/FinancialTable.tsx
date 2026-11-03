import type { FinancialSummary } from "@/lib/plan-types";
import CashBreakdown from "./CashBreakdown";
import { DUPLICATE_CASH_LABELS, isCashRow } from "./financial-groups";
import styles from "./FinancialTable.module.css";

// お店の数字（サーバーがルールベースで計算済み）。AI は計算しない。
// 「もうけ（損益）」と「お金の動き（資金繰り）」の2欄に見出しを付けて分ける（lib/financials.ts の profitAndLoss / cashMovement）。
// お金の動きの欄には計算式の内訳と、元本の返済についての注記（principalNote）を添える。
// 2欄に入らない行は、もうけ側（原価・比率など）は「ほかの数字」として畳み、お金の動き側（借入残高）は表に足す。
// スマホ幅では表をカード型の縦並びにして、横にはみ出さないようにする（FinancialTable.module.css）。

type Props = { summary: FinancialSummary };
type Row = FinancialSummary["rows"][number];

function RowsTable({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <table className={`data-table ${styles.table}`} aria-label={label}>
      <thead>
        <tr>
          <th scope="col">項目</th>
          <th scope="col">前期</th>
          <th scope="col">今期</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.label}-${i}`}>
            <th scope="row">
              {r.label}
              {r.note && <span className="data-table__note">{r.note}</span>}
            </th>
            <td data-label="前期">{r.previous}</td>
            <td data-label="今期">{r.current}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FinancialTable({ summary }: Props) {
  const pl = summary.profitAndLoss;
  const cm = summary.cashMovement;
  // 2欄に出した行・同じ数字の別名の行は重ねて出さない（表示名で判定。並び順は元の表の順）
  const shown = new Set([...(pl?.rows ?? []), ...(cm?.rows ?? [])].map((r) => r.label));
  const rest = summary.rows.filter((r) => !shown.has(r.label) && !DUPLICATE_CASH_LABELS.has(r.label));
  const profitMore = rest.filter((r) => !isCashRow(r.label));
  const cashRows = [...(cm?.rows ?? []), ...rest.filter((r) => isCashRow(r.label))];

  return (
    <section className="diag-block" aria-labelledby="financial-title">
      <h3 id="financial-title" className="diag-block__title">
        お店の数字（計算済み）
      </h3>

      {pl && pl.rows.length > 0 && (
        <section className={styles.group} aria-labelledby="financial-profit-title">
          <h4 id="financial-profit-title" className={styles.groupTitle}>
            {pl.title}
          </h4>
          <RowsTable rows={pl.rows} label={pl.title} />
          {profitMore.length > 0 && (
            <details className="financial-more">
              <summary>原価・比率などほかの数字を見る（{profitMore.length}項目）</summary>
              <RowsTable rows={profitMore} label={`${pl.title}のほかの数字`} />
            </details>
          )}
        </section>
      )}

      {cm && (
        <section className={styles.group} aria-labelledby="financial-cash-title">
          <h4 id="financial-cash-title" className={styles.groupTitle}>
            {cm.title}
          </h4>
          {cashRows.length > 0 && <RowsTable rows={cashRows} label={cm.title} />}
          <CashBreakdown cash={cm} principalNote={summary.principalNote} />
        </section>
      )}

      <p className="source-note">
        出典：{summary.source}（数字は仕組みで計算しています。AI は計算していません）
      </p>
    </section>
  );
}
