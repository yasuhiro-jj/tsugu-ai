import type { UpsideSummary } from "@/lib/plan-types";
import styles from "./UpsideSection.module.css";

// 踏ん張れば伸びる余地（仮定の試算）。数字はサーバー（lib/financials.ts の getUpsideSummary）が
// ルールベースで計算済み。表示用の文字（effectText など）はそのまま使い、画面では計算しない。
// 良し悪し・おすすめの印は付けない（どれを選ぶかはお二人が決める）。フックなし。
// 試算の無い業種（飲食店以外）では upside が null になる。そのときは欄ごと出さない。

export default function UpsideSection({ upside }: { upside: UpsideSummary | null }) {
  if (!upside || upside.items.length === 0) return null;

  return (
    <section className="card" aria-labelledby="upside-title">
      <h2 id="upside-title">踏ん張れば伸びる余地（仮定の試算）</h2>
      <p className="muted">
        どれを選ぶかはお二人で決めてください。数字の計算はアプリが行い、AI は使っていません。
      </p>

      {/* 見せ場：営業利益の「今」と「仮定どおりに進んだ場合」を大きく並べる */}
      <div className={styles.headline} role="group" aria-labelledby="upside-headline-label">
        <p id="upside-headline-label" className={styles.headlineLabel}>
          営業利益（年間）
        </p>
        <div className={styles.headlineRow}>
          <p className={styles.figure}>
            <span className={styles.figureCaption}>当期</span>
            <span className={styles.figureValue}>{upside.operatingProfitBeforeText}</span>
          </p>
          <span className={styles.arrow} aria-hidden="true">
            →
          </span>
          <p className={styles.figure}>
            <span className={styles.figureCaption}>4つとも仮定どおりなら</span>
            <span className={styles.figureValue}>約{upside.operatingProfitAfterText}</span>
          </p>
        </div>
        <p className={styles.note} role="note">
          {upside.note}
        </p>
        {/* 飲食店で決算の数字を書き換えたときだけ（ランチ・宴会の前提はつぐみの例のまま） */}
        {upside.exampleNote && (
          <p className={styles.note} role="note">
            {upside.exampleNote}
          </p>
        )}
      </div>

      <table className={`data-table ${styles.table}`} aria-describedby="upside-title">
        <thead>
          <tr>
            <th scope="col">改善策</th>
            <th scope="col">前提</th>
            <th scope="col">営業利益への効果</th>
          </tr>
        </thead>
        <tbody>
          {upside.items.map((i) => (
            <tr key={i.id}>
              <th scope="row" data-label="改善策">
                {i.title}
              </th>
              <td data-label="前提" className={styles.assumption}>
                {i.assumption}
              </td>
              <td data-label="営業利益への効果" className={styles.effect}>
                {i.effectText}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2} data-label="">
              合計
            </th>
            <td data-label="合計" className={styles.effect}>
              {upside.totalText}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
