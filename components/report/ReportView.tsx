import type { ReactNode } from "react";
import type { ReportBankDoc, ReportPoint, ReportSummary } from "@/lib/report-types";
import { formatDay } from "@/components/format";
import NumberTable from "./NumberTable";
import { EditLines, EditPoints, EditText } from "./ReportEditFields";
import { REPORT_LIMITS as L } from "@/lib/report-types";
import { splitLines, type DraftKey, type FieldErrors, type ReportDraft } from "./report-edit";
import styles from "./report.module.css";

// 決算サマリー（8章）と銀行への相談用資料の表示。フックなし（編集中の値は ReportClient が持つ）。
// 文字列はすべて React の通常の表示で出す（HTML として解釈しない）。数字はサーバーで計算済み。
// edit を渡すと、AI が書いた文の部分が編集欄になる。数字の表・アプリの固定文は編集できない。
// 見出しの横の作り手の札は、印刷で崩れるため出さない（オーナー指示 2026-11-03）。

export type ReportEdit = {
  draft: ReportDraft;
  set: <K extends DraftKey>(key: K, value: ReportDraft[K]) => void;
  errors: FieldErrors;
  disabled: boolean;
};

function Chapter({ no, title, children }: { no: number; title: string; children: ReactNode }) {
  const id = `report-ch${no}`;
  return (
    <section className={styles.chapter} aria-labelledby={id}>
      <h3 id={id} className={styles.chapterTitle}>
        第{no}章 {title}
      </h3>
      {children}
    </section>
  );
}

/** 編集中だけ、数字の表の近くに出す案内 */
function NumbersNote({ edit }: { edit?: ReportEdit }) {
  if (!edit) return null;
  return (
    <p className={styles.small} data-print="hide">
      数字はアプリが決算から計算します。変えるときは『設定』で決算の数字を入れ直してください。
    </p>
  );
}

function PointList({ items }: { items: ReportPoint[] }) {
  if (items.length === 0) return <p className="muted">ありません。</p>;
  return (
    <ul className={styles.list}>
      {items.map((p, i) => (
        <li key={i}>
          {p.text}
          {p.basis && <span className={styles.basis}>根拠：{p.basis}</span>}
        </li>
      ))}
    </ul>
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

export function SummaryView({ summary, edit }: { summary: ReportSummary; edit?: ReportEdit }) {
  const { basic, results, financial, strengthsAndIssues: si, external, outlook, actions, consult } = summary;
  const sq = outlook.scenarios.status_quo;
  const im = outlook.scenarios.improved;
  const d = edit?.draft;
  const err = edit?.errors ?? {};
  const off = edit?.disabled ?? false;

  return (
    <>
      <Chapter no={basic.no} title={basic.title}>
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

      <Chapter no={results.no} title={results.title}>
        <NumberTable {...results.table} label="決算の要点の数字" />
        <NumbersNote edit={edit} />
        {edit && d ? (
          <EditText
            label="決算の要点の説明"
            value={d.results_comment}
            onChange={(v) => edit.set("results_comment", v)}
            max={L.commentMax}
            error={err.results_comment}
            disabled={off}
          />
        ) : (
          <>
            <h4 className={styles.subTitle}>説明</h4>
            <p className={styles.text}>{results.comment}</p>
          </>
        )}
      </Chapter>

      <Chapter no={financial.no} title={financial.title}>
        <NumberTable {...financial.table} label="財務の状態の数字" />
        <NumbersNote edit={edit} />
        {edit && d ? (
          <EditText
            label="財務の状態の説明"
            value={d.financial_comment}
            onChange={(v) => edit.set("financial_comment", v)}
            max={L.commentMax}
            error={err.financial_comment}
            disabled={off}
          />
        ) : (
          <>
            <h4 className={styles.subTitle}>説明</h4>
            <p className={styles.text}>{financial.comment}</p>
          </>
        )}
      </Chapter>

      <Chapter no={si.no} title={si.title}>
        {edit && d ? (
          <>
            <EditPoints
              label="強み"
              value={d.strengths}
              onChange={(v) => edit.set("strengths", v)}
              min={L.pointsMin}
              max={L.pointsMax}
              error={err.strengths}
              disabled={off}
            />
            <EditPoints
              label="課題"
              value={d.issues}
              onChange={(v) => edit.set("issues", v)}
              min={L.pointsMin}
              max={L.pointsMax}
              error={err.issues}
              disabled={off}
            />
          </>
        ) : (
          <>
            <h4 className={styles.subTitle}>強み</h4>
            <PointList items={si.strengths} />
            <h4 className={styles.subTitle}>課題</h4>
            <PointList items={si.issues} />
          </>
        )}
        <p className={styles.small}>{si.basisNote}</p>
      </Chapter>

      <Chapter no={external.no} title={external.title}>
        <p className={styles.plainNote} role="note">
          <strong>この章の内容はすべて「要確認」です。</strong>
          公式情報で確かめてから使ってください。
        </p>
        {external.topics.map((t) => (
          <div key={t.theme} className={styles.topic}>
            <h4 className={styles.subTitle}>
              {t.theme}（{t.status}）
            </h4>
            <p className={styles.text}>{t.note}</p>
            <p className={styles.small}>
              公式情報：
              {t.officialSource ? `${t.officialSource.name}（確認日 ${t.officialSource.checkedAt}）` : "まだ登録されていません"}
            </p>
            {t.indicators.length > 0 && (
              <>
                <NumberTable
                  columns={financial.table.columns}
                  rows={t.indicators}
                  source={external.source}
                  label={`${t.theme}について自社の数字で見る指標`}
                />
                <NumbersNote edit={edit} />
              </>
            )}
          </div>
        ))}
        {external.topics.every((t) => t.indicators.length === 0) && (
          <p className={styles.source}>出どころ：{external.source}</p>
        )}
      </Chapter>

      <Chapter no={outlook.no} title={outlook.title}>
        <p className={styles.plainNote} role="note">
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
        <NumbersNote edit={edit} />
        <h4 className={styles.subTitle}>前提条件</h4>
        <BulletList items={outlook.assumptions} empty="—" />
        {edit && d ? (
          <EditLines
            label="比べるときの観点"
            value={d.outlook_viewpoints}
            onChange={(v) => edit.set("outlook_viewpoints", v)}
            maxItems={L.viewpointsMax}
            error={err.outlook_viewpoints}
            disabled={off}
          />
        ) : (
          <>
            <h4 className={styles.subTitle}>比べるときの観点</h4>
            <BulletList items={outlook.viewpoints} empty="ありません。" />
          </>
        )}
      </Chapter>

      <Chapter no={actions.no} title={actions.title}>
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

      <Chapter no={consult.no} title={consult.title}>
        {edit && d ? (
          <>
            <EditLines
              label="銀行に相談すること"
              value={d.consult_bank}
              onChange={(v) => edit.set("consult_bank", v)}
              minItems={1}
              maxItems={L.consultMax}
              error={err.consult_bank}
              disabled={off}
            />
            <EditLines
              label="税理士に確認すること"
              value={d.consult_tax}
              onChange={(v) => edit.set("consult_tax", v)}
              minItems={1}
              maxItems={L.consultMax}
              error={err.consult_tax}
              disabled={off}
            />
            <EditLines
              label="その他の専門家"
              value={d.consult_other}
              onChange={(v) => edit.set("consult_other", v)}
              maxItems={L.consultMax}
              error={err.consult_other}
              disabled={off}
            />
          </>
        ) : (
          <ConsultLists bank={consult.bank} tax={consult.tax} other={consult.other} />
        )}
        <p className={styles.plainNote} role="note">
          {consult.note}
        </p>
      </Chapter>
    </>
  );
}

export function BankDocView({
  doc,
  consult,
  edit,
}: {
  doc: ReportBankDoc;
  consult: ReportSummary["consult"];
  edit?: ReportEdit;
}) {
  const d = edit?.draft;
  const err = edit?.errors ?? {};
  const off = edit?.disabled ?? false;
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
          相談内容
        </h3>
        {edit && d ? (
          <EditText
            label="相談内容"
            value={d.bank_purpose}
            onChange={(v) => edit.set("bank_purpose", v)}
            max={L.purposeMax}
            error={err.bank_purpose}
            rows={6}
            disabled={off}
          />
        ) : (
          <p className={styles.text}>{doc.purpose}</p>
        )}
      </section>

      <section className={styles.chapter} aria-labelledby="bank-numbers">
        <h3 id="bank-numbers" className={styles.chapterTitle}>
          関連する数字
        </h3>
        <NumberTable {...doc.numbers} label="銀行への相談に関連する数字" />
        <NumbersNote edit={edit} />
      </section>

      <section className={styles.chapter} aria-labelledby="bank-questions">
        <h3 id="bank-questions" className={styles.chapterTitle}>
          相談・確認すること（質問リスト）
        </h3>
        {edit && d ? (
          <>
            <EditLines
              label="銀行に相談すること（質問リスト）"
              value={d.bank_questions}
              onChange={(v) => edit.set("bank_questions", v)}
              minItems={L.questionsMin}
              maxItems={L.questionsMax}
              error={err.bank_questions}
              disabled={off}
            />
            <h4 className={styles.subTitle}>税理士に確認すること</h4>
            <BulletList items={splitLines(d.consult_tax)} empty="ありません。" />
            <h4 className={styles.subTitle}>その他の専門家</h4>
            <BulletList items={splitLines(d.consult_other)} empty="ありません。" />
            <p className={styles.small}>
              「税理士に確認すること」「その他の専門家」は、決算サマリー第8章の欄で直してください。
            </p>
          </>
        ) : (
          <>
            <ConsultLists bank={doc.questions} tax={consult.tax} other={consult.other} />
            <p className={styles.small}>「税理士に確認すること」「その他の専門家」は、決算サマリー第8章と同じ内容です。</p>
          </>
        )}
        <p className={styles.plainNote} role="note">
          {doc.note}
        </p>
      </section>
    </>
  );
}
