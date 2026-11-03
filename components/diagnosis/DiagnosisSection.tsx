"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DiagnosisRecord, FinancialSummary } from "@/lib/plan-types";
// 型のみ import（ビルド時に消えるため、サーバー専用コードはクライアントに入らない）
import type { Role } from "@/lib/role";
import { asObject, postJson } from "@/components/post-json";
import { formatDateTime } from "@/components/format";
import { useElapsedSeconds } from "@/components/use-elapsed";
import DiagnosisView from "./DiagnosisView";
import FinancialTable from "./FinancialTable";
import GroundingNote from "./GroundingNote";
import styles from "./DiagnosisView.module.css";

type Props = {
  initialRecord: DiagnosisRecord | null;
  financial: FinancialSummary | null;
  /** いまの役割（学習プランは後継者向けなので、先代には案内しない。表示の出し分けだけに使う） */
  role: Role;
};

/** 比較画面の「認識差の診断」。POST /api/diagnosis で AI に整理してもらう */
export default function DiagnosisSection({ initialRecord, financial, role }: Props) {
  const [record, setRecord] = useState<DiagnosisRecord | null>(initialRecord);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = useElapsedSeconds(pending);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const focusResult = useRef(false);

  useEffect(() => {
    if (focusResult.current && record) {
      focusResult.current = false;
      resultRef.current?.focus();
    }
  }, [record]);

  async function run() {
    if (pending) return; // 二重押し防止
    setPending(true);
    setError(null);
    const r = await postJson<DiagnosisRecord | null>("/api/diagnosis", {}, (d) =>
      d.record === null ? null : asObject<DiagnosisRecord>(d.record),
    );
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.data === null) {
      setError("診断を作れませんでした。時間をおいて、もう一度お試しください。");
      return;
    }
    focusResult.current = true;
    setRecord(r.data);
  }

  return (
    <section className="card diagnosis-card" aria-labelledby="diagnosis-title">
      <h2 id="diagnosis-title">認識差の診断</h2>
      <p>
        お二人とも共有したテーマの回答とお店の数字だけを使って、AI が「共通点」と「追加確認が必要な点」を整理します。片方だけが共有したテーマは、下の「共有された内容」には出ますが、診断には使いません（画面上の［共有された内容］ボタンからも移動できます）。
      </p>

      <div className="button-row diagnosis-card__action">
        <button
          type="button"
          className="button"
          onClick={() => void run()}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "AIが整理しています…" : record ? "もう一度整理する" : "AIに認識差を整理してもらう"}
        </button>
      </div>

      <div role="status" aria-live="polite" className="progress-note">
        {pending && (
          <>
            <span className="spinner" aria-hidden="true" />
            AIが整理しています。数十秒かかることがあります（{seconds}秒経過）。このままお待ちください。
          </>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {record && (
        <div className="diagnosis-result">
          <h3 id="diagnosis-result" ref={resultRef} tabIndex={-1} className="diagnosis-result__title">
            診断の結果
            {formatDateTime(record.createdAt) && (
              <span className="diagnosis-result__time">
                （{formatDateTime(record.createdAt)} 作成）
              </span>
            )}
          </h3>
          <p className="ai-note" role="note">
            AIによる下書きです。内容を確認してから使ってください。
            <br />
            継ぐ・継がない、税務・融資などの判断は、お二人と専門家で行ってください。
          </p>
          {/* 共有済みの要約・お店の数字で根拠を確かめられなかった数字・発言（サーバーの照合結果） */}
          <GroundingNote grounding={record.grounding} />
          <DiagnosisView
            diagnosis={record.diagnosis}
            afterQuestions={
              // 学習プランは後継者本人のページなので、案内は後継者にだけ出す（MVP 4：診断で学習プランが変わる）
              role === "successor" ? (
                <div className={styles.relearn} role="note">
                  <p>
                    この診断をもとに学習プランを作り直すと、学ぶ順番が診断を反映したものになります。前のプランとの違いも並べて見られます。
                  </p>
                  <Link href="/learning" className="button">
                    学習プランを見直す
                  </Link>
                </div>
              ) : null
            }
          />
          <div className="button-row next-links">
            <Link href="/plan" className={role === "successor" ? "button button--secondary" : "button"}>
              90日計画へ
            </Link>
          </div>
        </div>
      )}

      {/* 診断の操作と結果を先に見せ、根拠の数字はその下に置く */}
      {financial && <FinancialTable summary={financial} />}
    </section>
  );
}
