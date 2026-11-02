import Link from "next/link";
import { getRole } from "@/lib/role";
import { getDemoId } from "@/lib/demo";
import { getComparison } from "@/lib/compare";
import type { ComparisonRow } from "@/lib/interview-types";
import SummarySections, { SHARED_SUMMARY_LABELS } from "@/components/SummarySections";

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
        visible.map((row) => (
          <section key={row.key} className="card compare-row" aria-labelledby={`compare-${row.key}`}>
            <h2 id={`compare-${row.key}`}>{row.label}</h2>
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
          </section>
        ))
      )}

      <p className="interview__footnote">認識差の診断（AI）は次の段階で追加されます。</p>
    </>
  );
}
