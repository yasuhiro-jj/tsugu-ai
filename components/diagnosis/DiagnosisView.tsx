import type { Diagnosis, Expert, Importance } from "@/lib/plan-types";
import type { ReactNode } from "react";
import DiagnosisDirections from "./DiagnosisDirections";
import styles from "./DiagnosisView.module.css";

// 認識差の診断（AI の下書き）の表示。フックなし（サーバー・クライアントどちらからも使える）。

const IMPORTANCE_CLASS: Record<Importance, string> = {
  高: "badge badge--imp-high",
  中: "badge badge--imp-mid",
  低: "badge badge--imp-low",
};

const IMPORTANCE_RANK: Record<Importance, number> = { 高: 0, 中: 1, 低: 2 };

function ExpertBadge({ expert }: { expert: Expert }) {
  if (expert === "銀行" || expert === "税理士") {
    return <span className="badge badge--expert">専門家に確認（{expert}）</span>;
  }
  if (expert === "その他") {
    return <span className="badge">専門家への相談も検討</span>;
  }
  return null;
}

type Props = {
  diagnosis: Diagnosis;
  /** 「話し合うための問い」の直後に差し込む内容（例：後継者への学習プランの見直しの案内） */
  afterQuestions?: ReactNode;
};

export default function DiagnosisView({ diagnosis, afterQuestions }: Props) {
  // 重要度の高いものから並べる（並べ替えのみ。内容は変えない）
  const gaps = [...diagnosis.gaps].sort(
    (a, b) => (IMPORTANCE_RANK[a.importance] ?? 3) - (IMPORTANCE_RANK[b.importance] ?? 3),
  );

  return (
    <div className="diagnosis">
      {/* 並び：見せ場の「認識の違い」→ これからの選択肢 → 話し合う問い → 確認が必要なこと → 共通点（畳む） */}
      <section className="diag-block" aria-labelledby="diag-gaps">
        <h3 id="diag-gaps" className="diag-block__title">
          認識の違い（追加確認が必要な点）
        </h3>
        {gaps.length > 0 ? (
          <ul className="diag-list">
            {gaps.map((g, i) => (
              <li
                key={i}
                className={
                  g.importance === "高"
                    ? "diag-item diag-item--gap diag-item--high"
                    : "diag-item diag-item--gap"
                }
              >
                <div className="diag-item__head">
                  <span className={IMPORTANCE_CLASS[g.importance] ?? "badge"}>
                    重要度 {g.importance}
                  </span>
                  <span className="diag-item__theme">{g.theme}</span>
                </div>
                <p className="diag-item__point">{g.point}</p>
                {/* 要点を先に出し、それぞれの発言と数字は開いて読む形にする（内容は削らない）。重要度「高」は最初から開く */}
                <details className={styles.more} open={g.importance === "高"}>
                  <summary className={styles.moreSummary}>先代・後継者の話と数字の根拠</summary>
                  <div className="diag-said">
                    <p className="diag-said__col diag-said__col--predecessor">
                      <span className="diag-said__who">先代は…</span>
                      {g.senior_said}
                    </p>
                    <p className="diag-said__col diag-said__col--successor">
                      <span className="diag-said__who">後継者は…</span>
                      {g.successor_said}
                    </p>
                  </div>
                  {g.numbers && <p className="diag-item__sub">数字の根拠：{g.numbers}</p>}
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="summary-block__empty">（なし）</p>
        )}
      </section>

      {/* 方向性（空なら何も出さない） */}
      <DiagnosisDirections directions={diagnosis.directions} />

      <section className="diag-block" aria-labelledby="diag-questions">
        <h3 id="diag-questions" className="diag-block__title">
          お二人で話し合うための問い
        </h3>
        {diagnosis.talk_questions.length > 0 ? (
          <ol className="talk-questions">
            {diagnosis.talk_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        ) : (
          <p className="summary-block__empty">（なし）</p>
        )}
      </section>

      {afterQuestions}

      <section className="diag-block" aria-labelledby="diag-confirm">
        <h3 id="diag-confirm" className="diag-block__title">
          確認が必要なこと
        </h3>
        {diagnosis.to_confirm.length > 0 ? (
          <ul className="diag-list">
            {diagnosis.to_confirm.map((t, i) => (
              <li key={i} className="diag-item">
                <div className="diag-item__head">
                  <p className="diag-item__point">{t.item}</p>
                  <ExpertBadge expert={t.expert} />
                </div>
                {t.how && <p className="diag-item__sub">確かめ方：{t.how}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="summary-block__empty">（なし）</p>
        )}
      </section>

      {/* 共通点は最初は畳む（見出しは summary の中に置き、件数だけ先に見せる） */}
      <section className="diag-block" aria-labelledby="diag-common">
        <details className={styles.common}>
          <summary className={styles.commonSummary}>
            <h3 id="diag-common" className={`diag-block__title ${styles.inlineTitle}`}>
              共通点（{diagnosis.common.length}件）
            </h3>
          </summary>
          {diagnosis.common.length > 0 ? (
            <ul className="diag-list">
              {diagnosis.common.map((c, i) => (
                <li key={i} className="diag-item diag-item--common">
                  <p className="diag-item__point">{c.point}</p>
                  {c.evidence && <p className="diag-item__sub">根拠：{c.evidence}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="summary-block__empty">（なし）</p>
          )}
        </details>
      </section>
    </div>
  );
}
