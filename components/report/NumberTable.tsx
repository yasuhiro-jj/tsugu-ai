import type { ReportNumberRow, ReportNumberTable } from "@/lib/report-types";
import styles from "./report.module.css";

// 資料の数字の表。値はサーバー（lib/financials.ts）が計算済みの表示用文字列で、画面では計算しない。
// 出どころ（source）は必ず表の下に出す。スマホ幅ではカード型の縦並びに切り替える（report.module.css）。
// groups があれば（第2・3章の「もうけ（損益）」「お金の動き（資金繰り）」など）、見出しを付けて欄ごとに分ける。
// note（元本の返済の注記など）は表の下に出す。印刷にも出る。

type Columns = ReportNumberTable["columns"];

type Props = ReportNumberTable & {
  /** 表の名前（読み上げ用） */
  label: string;
};

function Table({ columns, rows, label }: { columns: Columns; rows: ReportNumberRow[]; label: string }) {
  const hasChange = rows.some((r) => r.change);
  return (
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
  );
}

export default function NumberTable({ columns, rows, source, groups, note, label }: Props) {
  const shownGroups = (groups ?? []).filter((g) => g.rows.length > 0);
  const tableNote = note?.trim();

  return (
    <div className={styles.tableBlock}>
      {shownGroups.length > 0 ? (
        shownGroups.map((g) => (
          <div key={g.title} className={styles.group}>
            <h4 className={styles.groupTitle}>{g.title}</h4>
            <Table columns={columns} rows={g.rows} label={`${label}：${g.title}`} />
          </div>
        ))
      ) : rows.length > 0 ? (
        <Table columns={columns} rows={rows} label={label} />
      ) : (
        <p className="muted">表示できる数字がありません。</p>
      )}
      {tableNote && (
        <p className={styles.tableNote} role="note">
          ※{/[。．.]$/.test(tableNote) ? tableNote : `${tableNote}。`}
        </p>
      )}
      <p className={styles.source}>出どころ：{source}</p>
    </div>
  );
}
