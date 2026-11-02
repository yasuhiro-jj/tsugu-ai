import Link from "next/link";
import { getRole } from "@/lib/role";
import { getDemoId } from "@/lib/demo";
import { getComparison } from "@/lib/compare";
import type { ComparisonRow } from "@/lib/interview-types";
import type { DiagnosisRecord, FinancialSummary } from "@/lib/plan-types";
import SummarySections, { SHARED_SUMMARY_LABELS } from "@/components/SummarySections";
import DiagnosisSection from "@/components/diagnosis/DiagnosisSection";
import { getDiagnosis, getFinancialSummary } from "@/components/server-data";

export const dynamic = "force-dynamic";

// 表示するのは、サーバー（lib/compare.ts）が「共有を許可した回答だけ」に絞り込んだ結果のみ。
// null の側は何も描画しない（「非公開」「未回答」などの文言も出さない＝存在を伝えない）。

export default async function ComparePage() {
  const role = await getRole();
  const demoId = await getDemoId();

  if (!role) {
    return (
      <>
        <h1 className="page-title">認識差の比較</h1>
        <section className="card notice" role="status">
          <h2>先に役割を選んでください</h2>
          <p>認識差の比較は、先代または後継者として入ってから見られます。</p>
          <p>
            <Link href="/" className="button">
              トップで役割を選ぶ
            </Link>
          </p>
        </section>
      </>
    );
  }

  // デモ用 ID がまだ無い（まだ何も保存していない）ときは、共有された回答も無い
  let rows: ComparisonRow[] | null = [];
  if (demoId) {
    try {
      rows = await getComparison(demoId);
    } catch {
      rows = null;
    }
  }

  const visible = (rows ?? []).filter((r) => r.predecessor !== null || r.successor !== null);

  // 認識差の診断（サーバーが共有済みの回答だけで作ったもの）とお店の数字（計算済み）
  let diagnosis: DiagnosisRecord | null = null;
  let financial: FinancialSummary | null = null;
  if (rows !== null && visible.length > 0) {
    try {
      financial = await getFinancialSummary();
    } catch {
      financial = null;
    }
    if (demoId) {
      try {
        const rec = await getDiagnosis(demoId);
        // 画面に不要な内部情報（診断に使ったテーマの key）はブラウザへ送らない
        diagnosis = rec ? { ...rec, basedOnThemeKeys: [] } : null;
      } catch {
        diagnosis = null;
      }
    }
  }

  return (
    <>
      <h1 className="page-title">認識差の比較</h1>
      <p className="lead">
        この画面には、お二人がそれぞれ共有を選んだ内容だけを表示しています。
        共有されていない内容は、その有無も含めて表示されません。
      </p>

      {rows === null ? (
        <section className="card notice">
          <h2>比較を読み込めませんでした</h2>
          <p role="alert">時間をおいて、ページを読み込み直してください。</p>
        </section>
      ) : visible.length === 0 ? (
        <section className="card" role="status">
          <p>
            まだ共有された回答はありません。面談で要約を確定し、共有を選ぶとここに表示されます。
          </p>
          <p>
            <Link href="/interview">AI面談へ</Link>
          </p>
        </section>
      ) : (
        <>
          <nav className="page-jump" aria-label="このページの中">
            <ul>
              <li>
                <a href="#diagnosis-title">{diagnosis ? "診断結果を見る" : "認識差を診断する"}</a>
              </li>
              <li>
                <a href="#shared-title">共有された内容（{visible.length}テーマ）</a>
              </li>
            </ul>
          </nav>

          {/* デモの見せ場。共有済み要約より上に置く */}
          <DiagnosisSection initialRecord={diagnosis} financial={financial} role={role} />

          <section className="card compare-shared" aria-labelledby="shared-title">
            <h2 id="shared-title">共有された内容（テーマ別）</h2>
            <p className="muted compare-shared__help">テーマ名を押すと、共有された要約が開きます。</p>
            <ul className="compare-list">
              {visible.map((row) => (
                <li key={row.key} className="compare-list__item">
                  <details className="compare-row">
                    <summary className="compare-row__summary">
                      <span className="compare-row__theme">{row.label}</span>
                      {/* 共有がある側だけ表示する（無い側については何も書かない） */}
                      <span className="compare-row__badges">
                        {row.predecessor && (
                          <span className="share-badge share-badge--predecessor">先代から共有</span>
                        )}
                        {row.successor && (
                          <span className="share-badge share-badge--successor">後継者から共有</span>
                        )}
                      </span>
                    </summary>
                    <div className="compare-row__cols">
                      {row.predecessor && (
                        <div className="compare-col compare-col--predecessor">
                          <h3 className="compare-col__title">先代から共有されたこと</h3>
                          <SummarySections
                            summary={row.predecessor}
                            labels={SHARED_SUMMARY_LABELS}
                            headingLevel={4}
                          />
                        </div>
                      )}
                      {row.successor && (
                        <div className="compare-col compare-col--successor">
                          <h3 className="compare-col__title">後継者から共有されたこと</h3>
                          <SummarySections
                            summary={row.successor}
                            labels={SHARED_SUMMARY_LABELS}
                            headingLevel={4}
                          />
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
