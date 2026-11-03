import type { DiagnosisDirections as Directions, DirectionItem } from "@/lib/plan-types";
import styles from "./DiagnosisDirections.module.css";

// 診断の「方向性」（守りたいこと・変えられること・新しく試したいこと）の表示。フックなし。
// - 良し悪し・推奨の印は付けない（どれを選ぶかはお二人が決める）
// - テーマ名や「どのテーマから来たか」は画面で推測して出さない（SEC-103）
// - 空の欄は出さない。3つとも空（古い診断など）ならセクションごと出さない

const GROUPS: { key: keyof Directions; title: string }[] = [
  { key: "keep", title: "守りたいこと" },
  { key: "improve", title: "変えられること" },
  { key: "tryNew", title: "新しく試したいこと" },
];

// 色だけに頼らず、文字（「先代の意見」など）でも区別できるようにする。色は90日計画の担当の札と同じ
const FROM: Record<DirectionItem["from"], { label: string; className: string }> = {
  先代: { label: "先代の意見", className: "badge badge--owner-predecessor" },
  後継者: { label: "後継者の意見", className: "badge badge--owner-successor" },
  二人: { label: "二人とも", className: "badge badge--owner-both" },
};

function items(v: unknown): DirectionItem[] {
  return Array.isArray(v) ? (v as DirectionItem[]).filter((x) => x && typeof x.text === "string" && x.text !== "") : [];
}

export default function DiagnosisDirections({ directions }: { directions: Directions | undefined }) {
  // 古い診断では directions が無いこともある
  const groups = GROUPS.map((g) => ({ ...g, list: items(directions?.[g.key]) })).filter((g) => g.list.length > 0);
  if (groups.length === 0) return null;

  return (
    <section className="diag-block" aria-labelledby="diag-directions">
      <h3 id="diag-directions" className="diag-block__title">
        これからの選択肢（守る・工夫する・新しく試す）
      </h3>
      <p className={`muted ${styles.note}`}>
        共有された回答から整理した下書きです。どれを選ぶかはお二人で決めてください。
      </p>
      {groups.map((g) => (
        <section key={g.key} className={styles.group} aria-labelledby={`diag-directions-${g.key}`}>
          <h4 id={`diag-directions-${g.key}`} className={styles.groupTitle}>
            {g.title}
          </h4>
          <ul className="diag-list">
            {g.list.map((d, i) => {
              const from = FROM[d.from];
              return (
                <li key={i} className="diag-item">
                  {from && (
                    <div className={styles.head}>
                      <span className={from.className}>{from.label}</span>
                    </div>
                  )}
                  <p className={`diag-item__point ${styles.text}`}>{d.text}</p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
