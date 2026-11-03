import type { ReactNode } from "react";
import type { ReportBankDoc, ReportMadeBy, ReportSummary } from "@/lib/report-types";
import { formatDay } from "@/components/format";
import NumberTable from "./NumberTable";
import { CheckBadge, MadeByBadge } from "./MadeByBadge";
import styles from "./report.module.css";

// 決算サマリー（8章）と銀行への相談用資料の表示。フックなし。
// 文字列はすべて React の通常の表示で出す（HTML として解釈しない）。数字はサーバーで計算済み。

function Chapter({
  no,
  title,
  by,
  extraBadge,
  children,
}: {
  no: number;
  title: string;
  by: ReportMadeBy;
  extraBadge?: ReactNode;
  children: ReactNode;
}) {
  const id = `report-ch${no}`;
  return (
    <section className={styles.chapter} aria-labelledby={id}>
      <h3 id={id} className={styles.chapterTitle}>
        <span>
          第{no}章 {title}
        </span>
        <span className={styles.badges}>
          <MadeByBadge by={by} />
          {extraBadge}
        </span>
      </h3>
      {children}
    </section>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className={styles.list}>
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

/** 相談先ごとに見出しを分けた箇条書き（第8章と銀行資料で共通） */
function ConsultLists({ bank, tax, other }: { bank: string[]; tax: string[]; other: string[] }) {
  return (
    <>
      <h4 className={styles.subTitle}>銀行に相談すること</h4>
      <BulletList items={bank} empty="ありません。" />
      <h4 className={styles.subTitle}>税理士に確認すること</h4>
      <BulletList items={tax} empty="ありません。" />
      <h4 className={styles.subTitle}>その他の専門家</h4>
      <BulletList items={other} empty="ありません。" />
    </>
  );
}

export function SummaryView({ summary }: { summary: ReportSummary }) {
  const { basic, results, financial, strengthsAndIssues: si, external, outlook, actions, consult } = summary;
  const sq = outlook.scenarios.status_quo;
  const im = outlook.scenarios.improved;

  return (
    <>
      <Chapter no={basic.no} title={basic.title} by={basic.by}>
        <dl className={styles.facts}>
          <dt>会社名</dt>
          <dd>{basic.companyName}</dd>
          <dt>業種</dt>
          <dd>{basic.industry}</dd>
          <dt>概要</dt>
          <dd>{basic.overview}</dd>
          <dt>対象の決算期</dt>
          <dd>{basic.period}</dd>
          <dt>作成日</dt>
          <dd>{formatDay(basic.createdDate)}</dd>
          <dt>使用した資料</dt>
          <dd>
            <BulletList items={basic.sources} empty="—" />
          </dd>
        </dl>
      </Chapter>

      <Chapter no={results.no} title={results.title} by={results.by}>
        <NumberTable {...results.table} label="決算の要点の数字" />
        <h4 className={styles.subTitle}>説明（AI の下書き）</h4>
        <p className={styles.text}>{results.comment}</p>
      </Chapter>

      <Chapter no={financial.no} title={financial.title} by={financial.by}>
        <NumberTable {...financial.table} label="財務の状態の数字" />
        <h4 className={styles.subTitle}>説明（AI の下書き）</h4>
        <p className={styles.text}>{financial.comment}</p>
      </Chapter>

      <Chapter no={si.no} title={si.title} by={si.by}>
        <h4 className={styles.subTitle}>強み</h4>
        {si.strengths.length > 0 ? (
          <ul className={styles.list}>
            {si.strengths.map((p, i) => (
              <li key={i}>
                {p.text}
                <span className={styles.basis}>根拠：{p.basis}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">ありません。</p>
        )}
        <h4 className={styles.subTitle}>課題</h4>
        {si.issues.length > 0 ? (
          <ul className={styles.list}>
            {si.issues.map((p, i) => (
              <li key={i}>
                {p.text}
                <span className={styles.basis}>根拠：{p.basis}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">ありません。</p>
        )}
        <p className={styles.small}>{si.basisNote}</p>
      </Chapter>

      <Chapter no={external.no} title={external.title} by={external.by} extraBadge={<CheckBadge />}>
        <p className={styles.caution} role="note">
          外部環境の内容は「要確認」です。公式情報で確かめてから使ってください。
        </p>
        {external.topics.map((t) => (
          <div key={t.theme} className={styles.topic}>
            <h4 className={styles.subTitle}>
              {t.theme}
              <span className={styles.badges}>
                <span className={`${styles.badge} ${styles.badgeCheck}`}>{t.status}</span>
              </span>
            </h4>
            <p className={styles.text}>{t.note}</p>
            <p className={styles.small}>
              公式情報：
              {t.officialSource ? `${t.officialSource.name}（確認日 ${t.officialSource.checkedAt}）` : "まだ登録されていません"}
            </p>
            {t.indicators.length > 0 && (
              <NumberTable
                columns={financial.table.columns}
                rows={t.indicators}
                source={external.source}
                label={`${t.theme}について自社の数字で見る指標`}
              />
            )}
          </div>
        ))}
        {external.topics.every((t) => t.indicators.length === 0) && (
          <p className={styles.source}>出どころ：{external.source}</p>
        )}
      </Chapter>

      <Chapter no={outlook.no} title={outlook.title} by={outlook.by}>
        <p className={styles.forecast} role="note">
          <strong>{outlook.forecastLabel}</strong>
          <br />
          予測であり、実現を保証するものではありません。下の前提条件とあわせて読んでください。
        </p>
        <div className={styles.scenarios}>
          <div className={styles.scenario}>
            <p className={styles.scenarioName}>{sq.name}</p>
            <p className={styles.scenarioValue}>営業利益 {sq.operatingProfitText}</p>
            <p className={styles.small}>根拠：{sq.basis}</p>
          </div>
          {/* 改善策あり案は、試算がある業種（飲食店）のときだけ。無ければ現状維持案だけを出す */}
          {im && (
            <div className={styles.scenario}>
              <p className={styles.scenarioName}>{im.name}</p>
              <p className={styles.scenarioValue}>営業利益 約{im.operatingProfitText}</p>
              <p className={styles.small}>改善策の効果の合計：{im.totalEffectText}</p>
              <p className={styles.small}>根拠：{im.basis}</p>
            </div>
          )}
        </div>
        {im && im.items.length > 0 && (
          <table className={`data-table ${styles.table}`} aria-label="改善策あり案の内訳（仮定の試算）">
            <thead>
              <tr>
                <th scope="col">改善策</th>
                <th scope="col">前提</th>
                <th scope="col">営業利益への効果</th>
              </tr>
            </thead>
            <tbody>
              {im.items.map((i) => (
                <tr key={i.id}>
                  <th scope="row">{i.title}</th>
                  <td data-label="前提" className={styles.wrapCell}>
                    {i.assumption}
                  </td>
                  <td data-label="営業利益への効果">{i.effectText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <h4 className={styles.subTitle}>前提条件</h4>
        <BulletList items={outlook.assumptions} empty="—" />
        <h4 className={styles.subTitle}>比べるときの観点（AI の下書き）</h4>
        <BulletList items={outlook.viewpoints} empty="ありません。" />
      </Chapter>

      <Chapter no={actions.no} title={actions.title} by={actions.by}>
        {actions.items.length > 0 ? (
          <ol className={styles.list}>
            {actions.items.map((a, i) => (
              <li key={i}>
                <span className={styles.actionTitle}>{a.title}</span>
                <span className={styles.basis}>
                  {a.phaseLabel}／担当：{a.owner}／期限：{formatDay(a.due)}／状態：{a.status}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{actions.emptyMessage ?? "まだありません。"}</p>
        )}
        <p className={styles.source}>出どころ：{actions.source}</p>
      </Chapter>

      <Chapter no={consult.no} title={consult.title} by={consult.by}>
        <ConsultLists bank={consult.bank} tax={consult.tax} other={consult.other} />
        <p className={styles.caution} role="note">
          {consult.note}
        </p>
      </Chapter>
    </>
  );
}

export function BankDocView({ doc, consult }: { doc: ReportBankDoc; consult: ReportSummary["consult"] }) {
  return (
    <>
      <dl className={styles.facts}>
        <dt>会社名</dt>
        <dd>{doc.companyName}</dd>
        <dt>作成日</dt>
        <dd>{formatDay(doc.createdDate)}</dd>
      </dl>

      <section className={styles.chapter} aria-labelledby="bank-purpose">
        <h3 id="bank-purpose" className={styles.chapterTitle}>
          <span>相談内容</span>
          <span className={styles.badges}>
            <MadeByBadge by="ai" />
          </span>
        </h3>
        <p className={styles.text}>{doc.purpose}</p>
      </section>

      <section className={styles.chapter} aria-labelledby="bank-numbers">
        <h3 id="bank-numbers" className={styles.chapterTitle}>
          <span>関連する数字</span>
          <span className={styles.badges}>
            <MadeByBadge by="app" />
          </span>
        </h3>
        <NumberTable {...doc.numbers} label="銀行への相談に関連する数字" />
      </section>

      <section className={styles.chapter} aria-labelledby="bank-questions">
        <h3 id="bank-questions" className={styles.chapterTitle}>
          <span>相談・確認すること（質問リスト）</span>
          <span className={styles.badges}>
            <MadeByBadge by="ai" />
          </span>
        </h3>
        <ConsultLists bank={doc.questions} tax={consult.tax} other={consult.other} />
        <p className={styles.small}>「税理士に確認すること」「その他の専門家」は、決算サマリー第8章と同じ内容です。</p>
        <p className={styles.caution} role="note">
          {doc.note}
        </p>
      </section>
    </>
  );
}
