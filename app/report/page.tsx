import Link from "next/link";
import { getSession } from "@/lib/demo";
import { getReport } from "@/lib/report";
import type { ReportState } from "@/lib/report-types";
import type { DiagnosisRecord } from "@/lib/plan-types";
import { getDiagnosis } from "@/components/server-data";
import ReportClient from "@/components/report/ReportClient";
import PrintStyle from "@/components/report/PrintStyle";

export const dynamic = "force-dynamic";

// 決算サマリー・相談用資料（下書き）。資料は二人の共有物で、先代・後継者のどちらからでも作れる・見られる。
// demoId はサーバーでクッキーから読んだ値だけを使う。診断・資料の絞り込みは lib 側（サーバー）で行われる。
// 診断の中身はこの画面では使わない（有無だけを見る）ので、ブラウザへは送らない。

export default async function ReportPage() {
  // デモ用 ID と役割は getSession() でそろえて読む（どちらか無ければ「役割を選ぶ」の案内。SEC-A04）
  const session = await getSession();
  const role = session?.role ?? null;

  if (!role) {
    return (
      <>
        <h1 className="page-title">決算サマリー・相談資料（下書き）</h1>
        <section className="card notice" role="status">
          <h2>先に役割を選んでください</h2>
          <p>決算サマリー・相談資料は、先代または後継者として入ってから見られます。</p>
          <p>
            <Link href="/" className="button">
              トップで役割を選ぶ
            </Link>
          </p>
        </section>
      </>
    );
  }

  const demoId = session?.demoId ?? null;
  let diagnosis: DiagnosisRecord | null = null;
  let report: ReportState | null = null;
  let loadError = false;
  if (demoId) {
    try {
      diagnosis = await getDiagnosis(demoId);
      report = await getReport(demoId);
    } catch {
      loadError = true;
    }
  }
  const hasDiagnosis = diagnosis !== null || report !== null;

  return (
    <>
      <PrintStyle />
      <h1 className="page-title">決算サマリー・相談資料（下書き）</h1>
      <p className="lead" data-print="hide">
        お店の数字・認識差の診断・90日計画をもとに、決算サマリー（8章）と銀行への相談用資料の下書きを作ります。
        <strong>この資料は、先代・後継者の両方に見えます。</strong>
        融資・税務などの結論は、銀行や税理士などの専門家に確認してください。
      </p>

      {loadError ? (
        <section className="card notice">
          <h2>資料を読み込めませんでした</h2>
          <p role="alert">時間をおいて、ページを読み込み直してください。</p>
        </section>
      ) : !hasDiagnosis ? (
        <section className="card notice" role="status">
          <h2>先に比較画面で診断してください</h2>
          <p>資料は、認識差の診断の結果をもとに作ります。まだ診断がありません。</p>
          <p>
            <Link href="/compare" className="button">
              認識差の比較へ
            </Link>
          </p>
        </section>
      ) : (
        <ReportClient initialReport={report} />
      )}
    </>
  );
}
