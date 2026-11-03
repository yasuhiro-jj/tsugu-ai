"use client";

import { useEffect, useRef, useState } from "react";
import type { ReportState } from "@/lib/report-types";
import { asObject, postJson } from "@/components/post-json";
import { formatDateTime } from "@/components/format";
import { useElapsedSeconds } from "@/components/use-elapsed";
import { BankDocView, SummaryView } from "./ReportView";
import styles from "./report.module.css";

// 決算サマリー・相談用資料の操作（作る／作り直す／印刷）。
// POST /api/report（本文 {}）で作成・作り直し。どちらの役割からでも呼べる（二人の共有物）。
// 印刷時に消す要素には data-print="hide" を付ける（PrintStyle.tsx）。

type Props = { initialReport: ReportState | null };

export default function ReportClient({ initialReport }: Props) {
  const [report, setReport] = useState<ReportState | null>(initialReport);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = useElapsedSeconds(pending);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  const recreateRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusTitle.current && report) {
      focusTitle.current = false;
      titleRef.current?.focus();
    }
  }, [report]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  async function create() {
    if (pending) return; // 二重押し防止
    setConfirming(false);
    setPending(true);
    setError(null);
    const r = await postJson<ReportState>("/api/report", {}, (d) => asObject<ReportState>(d.state));
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    focusTitle.current = true;
    setReport(r.data);
  }

  function cancelConfirm() {
    setConfirming(false);
    recreateRef.current?.focus();
  }

  const progress = (
    <div role="status" aria-live="polite" className="progress-note" data-print="hide">
      {pending && (
        <>
          <span className="spinner" aria-hidden="true" />
          作っています…（{seconds}秒）。40秒ほどかかることがあります。このままお待ちください。
        </>
      )}
    </div>
  );

  const errorBox = error && (
    <p className="form-error" role="alert" data-print="hide">
      {error}
    </p>
  );

  if (!report) {
    return (
      <section className="card" aria-labelledby="report-create-title">
        <h2 id="report-create-title">資料を作る</h2>
        <p>
          認識差の診断・お店の数字・90日計画をもとに、決算サマリー（8章）と銀行への相談用資料の下書きを作ります。
          数字はアプリが計算し、AI は説明の文だけを書きます。
        </p>
        <div className="button-row">
          <button type="button" className="button" onClick={() => void create()} disabled={pending} aria-busy={pending}>
            {pending ? "作っています…" : "資料を作る"}
          </button>
        </div>
        {progress}
        {errorBox}
      </section>
    );
  }

  const created = formatDateTime(report.createdAt);
  const basedOn = formatDateTime(report.basedOnDiagnosisAt);

  return (
    <>
      <p className={styles.draftNotice} role="note">
        <strong className={styles.draftLabel}>下書き</strong>
        {report.draftNotice}
        <br />
        数字はアプリが計算し、文は AI が下書きしました。内容を確認・修正してから使ってください。
      </p>

      <section className="card" aria-labelledby="report-meta-title">
        <h2 id="report-meta-title" ref={titleRef} tabIndex={-1} className={styles.metaTitle}>
          作成日：{created || "—"}
        </h2>
        {basedOn && <p className="muted">もとにした診断：{basedOn} 作成</p>}

        <div className="button-row" data-print="hide">
          <button
            ref={recreateRef}
            type="button"
            className="button button--secondary"
            onClick={() => setConfirming(true)}
            disabled={pending || confirming}
            aria-busy={pending}
          >
            {pending ? "作っています…" : "作り直す"}
          </button>
          <button type="button" className="button" onClick={() => window.print()} disabled={pending}>
            印刷する
          </button>
        </div>

        {confirming && (
          <div className="inline-confirm" role="group" aria-labelledby="report-confirm-text" data-print="hide">
            <p id="report-confirm-text">
              今の資料を作り直します。今の内容は新しい下書きに置き換わります。よろしいですか？
            </p>
            <div className="button-row">
              <button ref={confirmRef} type="button" className="button" onClick={() => void create()}>
                作り直す
              </button>
              <button type="button" className="button button--secondary" onClick={cancelConfirm}>
                やめる
              </button>
            </div>
          </div>
        )}
        {progress}
        {errorBox}
      </section>

      <nav className="page-jump" aria-label="この資料の中" data-print="hide">
        <ul>
          <li>
            <a href="#report-summary-title">決算サマリー（8章）</a>
          </li>
          <li>
            <a href="#report-bank-title">銀行向け相談用資料</a>
          </li>
        </ul>
      </nav>

      <section className={`card ${styles.doc}`} aria-labelledby="report-summary-title">
        <h2 id="report-summary-title" className={styles.docTitle}>
          決算サマリー（8章）
          <span className={styles.docDraft}>（下書き）</span>
        </h2>
        <SummaryView summary={report.summary} />
      </section>

      <section className={`card ${styles.doc} ${styles.pageBreak}`} aria-labelledby="report-bank-title">
        <h2 id="report-bank-title" className={styles.docTitle}>
          銀行向け相談用資料
          <span className={styles.docDraft}>（下書き）</span>
        </h2>
        <BankDocView doc={report.bankDoc} consult={report.summary.consult} />
      </section>
    </>
  );
}
