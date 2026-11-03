import type { ReportNumberRow } from "@/lib/report-types";
import styles from "./report.module.css";

// 資料の数字の表。値はサーバー（lib/financials.ts）が計算済みの表示用文字列で、画面では計算しない。
// 出どころ（source）は必ず表の下に出す。スマホ幅ではカード型の縦並びに切り替える（report.module.css）。

type Props = {
  columns: { previous: string; current: string };
  rows: ReportNumberRow[];
  source: string;
  /** 表の名前（読み上げ用） */
  label: string;
};

export default function NumberTable({ columns, rows, source, label }: Props) {
  const hasChange = rows.some((r) => r.change);

  return (
    <div className={styles.tableBlock}>
      {rows.length > 0 ? (
        <table className={`data-table ${styles.table}`} aria-label={label}>
          <thead>
            <tr>
              <th scope="col">項目</th>
              <th scope="col">{columns.previous}</th>
              <th scope="col">{columns.current}</th>
              {hasChange && <th scope="col">前期との差</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">
                  {r.label}
                  {r.note && <span className="data-table__note">{r.note}</span>}
                </th>
                <td data-label={columns.previous}>{r.previous}</td>
                <td data-label={columns.current}>{r.current}</td>
                {hasChange && <td data-label="前期との差">{r.change ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">表示できる数字がありません。</p>
      )}
      <p className={styles.source}>出どころ：{source}</p>
    </div>
  );
}
