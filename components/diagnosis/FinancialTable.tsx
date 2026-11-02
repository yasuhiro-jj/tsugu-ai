import type { FinancialSummary } from "@/lib/plan-types";

// お店の数字（サーバーがルールベースで計算済み）。AI は計算しない。
// 縦に長くならないよう、主要な指標を先に見せ、残りは「ほかの数字」として畳む。

type Props = { summary: FinancialSummary };
type Row = FinancialSummary["rows"][number];

/** 先に見せる主要指標（表示名で判定。並び順は元の表の順を保つ） */
const KEY_LABELS: ReadonlySet<string> = new Set([
  "売上高",
  "営業利益",
  "原価率",
  "FL比率",
  "手元資金（期末）",
  "手元資金は月商の何か月分",
  "借入残高（期末）",
]);

function RowsTable({ rows, captionId }: { rows: Row[]; captionId: string }) {
  return (
    <div className="table-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="data-table">
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
              <td>{r.previous}</td>
              <td>{r.current}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FinancialTable({ summary }: Props) {
  const keyRows = summary.rows.filter((r) => KEY_LABELS.has(r.label));
  const otherRows = summary.rows.filter((r) => !KEY_LABELS.has(r.label));
  // 主要指標の名前が変わって一致しなくなった場合は、すべてを主要の表に出す（数字が見えなくなるのを防ぐ）
  const main = keyRows.length > 0 ? keyRows : summary.rows;
  const rest = keyRows.length > 0 ? otherRows : [];

  return (
    <section className="diag-block" aria-labelledby="financial-title">
      <h3 id="financial-title" className="diag-block__title">
        お店の数字（計算済み）
      </h3>
      <RowsTable rows={main} captionId="financial-title" />
      {rest.length > 0 && (
        <details className="financial-more">
          <summary id="financial-more-title">ほかの数字を見る（{rest.length}項目）</summary>
          <RowsTable rows={rest} captionId="financial-more-title" />
        </details>
      )}
      <p className="source-note">
        出典：{summary.source}（数字は仕組みで計算しています。AI は計算していません）
      </p>
    </section>
  );
}
