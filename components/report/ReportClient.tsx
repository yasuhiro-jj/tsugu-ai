"use client";

import { useEffect, useRef, useState } from "react";
import type { ReportState } from "@/lib/report-types";
import { asObject, postJson } from "@/components/post-json";
import { formatDateTime } from "@/components/format";
import { useElapsedSeconds } from "@/components/use-elapsed";
import { BankDocView, SummaryView, type ReportEdit } from "./ReportView";
import {
  fromDraft,
  MSG_CONFLICT,
  saveReport,
  toDraft,
  type FieldErrors,
  type ReportDraft,
} from "./report-edit";
import GroundingNote from "@/components/diagnosis/GroundingNote";
import styles from "./report.module.css";

// 決算サマリー・相談用資料の操作（作る／作り直す／編集する／印刷）。
// POST /api/report（本文 {}）で作成・作り直し。どちらの役割からでも呼べる（二人の共有物）。
// PUT /api/report（本文 { ai, updatedAt }）で AI が書いた部分を保存する。数字・固定文は編集しない。
// 印刷時に消す要素には data-print="hide" を付ける（PrintStyle.tsx）。印刷には保存済みの内容がそのまま出る。

type Report = ReportState;
type Props = { initialReport: Report | null };

const MSG_SAVE_FIRST = "編集中です。先に［保存］してから印刷してください（保存しない場合は［やめる］）。";

export default function ReportClient({ initialReport }: Props) {
  const [report, setReport] = useState<Report | null>(initialReport);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [printBlocked, setPrintBlocked] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const focusEdit = useRef(false);
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

  useEffect(() => {
    if (focusEdit.current && draft === null) {
      focusEdit.current = false;
      editRef.current?.focus();
    }
  }, [draft]);

  const editing = draft !== null;

  function startEdit() {
    if (!report?.editable || pending) return;
    setDraft(toDraft(report.editable));
    setFieldErrors({});
    setEditError(null);
    setConflict(false);
    setPrintBlocked(false);
    setConfirming(false);
  }

  function cancelEdit() {
    if (savingRef.current) return;
    setDraft(null);
    setFieldErrors({});
    setEditError(null);
    setConflict(false);
    setPrintBlocked(false);
    focusEdit.current = true;
  }

  async function save() {
    if (!draft || !report?.updatedAt || savingRef.current) return; // 二重送信の防止
    savingRef.current = true;
    setSaving(true);
    setEditError(null);
    setFieldErrors({});
    setConflict(false);
    const r = await saveReport(fromDraft(draft), report.updatedAt);
    savingRef.current = false;
    setSaving(false);
    if (r.kind === "ok") {
      focusTitle.current = true;
      setReport(r.state);
      setDraft(null);
      setPrintBlocked(false);
      return;
    }
    if (r.kind === "conflict") {
      setConflict(true);
      return;
    }
    if (r.kind === "invalid") setFieldErrors(r.fieldErrors);
    setEditError(r.error);
  }

  function print() {
    if (editing) {
      setPrintBlocked(true);
      return;
    }
    window.print();
  }

  const setField: ReportEdit["set"] = (key, value) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setFieldErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
    setPrintBlocked(false);
  };

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
  const edited = formatDateTime(report.editedAt);
  const canEdit = !!report.editable && !!report.updatedAt;
  const edit: ReportEdit | undefined = draft ? { draft, set: setField, errors: fieldErrors, disabled: saving } : undefined;

  // ［保存］［やめる］は資料の上と終わりの2か所に置く（長い資料をスクロールで戻らなくてよいように）
  const editButtons = (where: "top" | "bottom") => (
    <div className="button-row" data-print="hide">
      <button
        type="button"
        className="button"
        onClick={() => void save()}
        disabled={saving}
        aria-busy={saving}
        aria-label={where === "top" ? "編集した内容を保存する" : "編集した内容を保存する（資料の終わりのボタン）"}
      >
        {saving ? "保存しています…" : "保存"}
      </button>
      <button
        type="button"
        className="button button--secondary"
        onClick={cancelEdit}
        disabled={saving}
        aria-label={where === "top" ? "編集をやめる（保存しない）" : "編集をやめる（保存しない。資料の終わりのボタン）"}
      >
        やめる
      </button>
    </div>
  );

  const editStatus = (announce: boolean) => (
    <div data-print="hide">
      <div role={announce ? "status" : undefined} aria-live={announce ? "polite" : undefined} className="progress-note">
        {saving && (
          <>
            <span className="spinner" aria-hidden="true" />
            保存しています…
          </>
        )}
      </div>
      {editError && (
        <p className="form-error" role={announce ? "alert" : undefined}>
          {editError}
        </p>
      )}
      {conflict && (
        <div role={announce ? "alert" : undefined}>
          <p className="form-error">{MSG_CONFLICT}</p>
          <div className="button-row">
            <button type="button" className="button button--secondary" onClick={() => window.location.reload()}>
              読み込み直す
            </button>
          </div>
          <p className="muted">読み込み直すと、保存していない編集は消えます。</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <p className={styles.draftNotice} role="note" data-print="hide">
        <strong className={styles.draftLabel}>下書き</strong>
        {report.draftNotice}
        <br />
        数字はアプリが計算し、文は AI が下書きしました。内容を確認・修正してから使ってください。
      </p>
      {report.caution && (
        // 言い切りに見える表現の注記は、印刷にも残す（下書きの案内は印刷しないが、こちらは消さない。security 指摘）
        <p className={styles.printCaution} role="note">
          ※{report.caution}
        </p>
      )}
      {/* 根拠を確認できない数字・発言の注記も、言い切りの注記と同じく印刷に残す */}
      <GroundingNote grounding={report.grounding} />

      <section className="card" aria-labelledby="report-meta-title">
        <h2 id="report-meta-title" ref={titleRef} tabIndex={-1} className={styles.metaTitle}>
          作成日：{created || "—"}
        </h2>
        {edited && <p className={styles.editedAt}>編集済み（{edited}）</p>}
        {basedOn && <p className="muted">もとにした診断：{basedOn} 作成</p>}

        <div className="button-row" data-print="hide">
          {!editing && (
            <button
              ref={editRef}
              type="button"
              className="button button--secondary"
              onClick={startEdit}
              disabled={pending || !canEdit}
              aria-label="AI が書いた文を編集する"
            >
              編集する
            </button>
          )}
          <button
            ref={recreateRef}
            type="button"
            className="button button--secondary"
            onClick={() => setConfirming(true)}
            disabled={pending || confirming || editing}
            aria-busy={pending}
          >
            {pending ? "作っています…" : "作り直す"}
          </button>
          <button
            type="button"
            className="button"
            onClick={print}
            disabled={pending}
            aria-describedby={printBlocked ? "report-print-blocked" : undefined}
          >
            印刷する
          </button>
        </div>
        {printBlocked && (
          <p id="report-print-blocked" className="form-error" role="alert" data-print="hide">
            {MSG_SAVE_FIRST}
          </p>
        )}
        {editing && (
          <>
            <p className={styles.editIntro} data-print="hide">
              AI が書いた文の部分が編集欄になっています。数字の表と、アプリが用意した文は変えられません。
            </p>
            {editButtons("top")}
            {editStatus(true)}
          </>
        )}

        {confirming && (
          <div className="inline-confirm" role="group" aria-labelledby="report-confirm-text" data-print="hide">
            <p id="report-confirm-text">
              今の資料を作り直します。今の内容は新しい下書きに置き換わります。編集した内容は消えて、新しい下書きに戻ります。よろしいですか？
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

      {/* 編集中に印刷されたとき（Ctrl+P など）は、編集欄の代わりにこの案内だけが出る */}
      {editing && (
        <p className={styles.printOnly} role="note">
          {MSG_SAVE_FIRST}
        </p>
      )}

      <section
        className={`card ${styles.doc}`}
        aria-labelledby="report-summary-title"
        data-print={editing ? "hide" : undefined}
      >
        <h2 id="report-summary-title" className={styles.docTitle}>
          決算サマリー（8章）
          <span className={styles.docDraft}>（下書き）</span>
        </h2>
        <SummaryView summary={report.summary} edit={edit} />
      </section>

      <section
        className={`card ${styles.doc} ${styles.pageBreak}`}
        aria-labelledby="report-bank-title"
        data-print={editing ? "hide" : undefined}
      >
        <h2 id="report-bank-title" className={styles.docTitle}>
          銀行向け相談用資料
          <span className={styles.docDraft}>（下書き）</span>
        </h2>
        <BankDocView doc={report.bankDoc} consult={report.summary.consult} edit={edit} />
      </section>

      {editing && (
        <section className="card" aria-label="編集の保存" data-print="hide">
          {editButtons("bottom")}
          {editStatus(false)}
        </section>
      )}
    </>
  );
}
