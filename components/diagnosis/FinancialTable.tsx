import type { FinancialSummary } from "@/lib/plan-types";

// お店の数字（サーバーがルールベースで計算済み）。AI は計算しない。

type Props = { summary: FinancialSummary };

export default function FinancialTable({ summary }: Props) {
  return (
    <section className="diag-block" aria-labelledby="financial-title">
      <h3 id="financial-title" className="diag-block__title">
        お店の数字（計算済み）
      </h3>
      <div className="table-scroll" role="region" aria-labelledby="financial-title" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">項目</th>
              <th scope="col">前期</th>
              <th scope="col">今期</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r, i) => (
              <tr key={i}>
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
      <p className="source-note">
        出典：{summary.source}（数字は仕組みで計算しています。AI は計算していません）
      </p>
    </section>
  );
}
