"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorBox, Guide, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <ul>
        {items.map((t, i) => (
          <li key={i} className="v2-pre">
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ReportPreviewClient() {
  const router = useRouter();
  const { session, loaded, busy, error, act } = useV2Session();

  if (!loaded) return <Loading />;
  const report = session?.report;
  if (!session || !report) {
    return (
      <>
        <Steps current={4} />
        <Guide href="/v2/report" label="資料に載せる項目を選ぶ">
          まだ下書きがありません。内容を直したあとは、もう一度作り直してください。
        </Guide>
      </>
    );
  }

  async function resetAll() {
    if (!window.confirm("この面談の内容と資料の下書きを、すべて消します。よろしいですか？")) return;
    if (await act("reset")) router.push("/v2");
  }

  return (
    <>
      <div className="v2-no-print">
        <Steps current={4} />
        <h1 className="page-title">資料の下書き</h1>
        <p className="lead">
          印をつけた項目だけで作りました。内容を確かめて、直したいところがあれば戻って直してください。この資料は、どこにも送られていません。
        </p>
        <ErrorBox message={error} />
      </div>

      <article className="card v2-report">
        <p className="v2-report__draft">下書き（ご本人が確認・修正するもの）</p>
        <h2 className="v2-report__title">相談資料</h2>
        <dl className="v2-report__meta">
          <dt>相談先</dt>
          <dd>{report.consultantLabel}</dd>
          <dt>相談の目的</dt>
          <dd>{report.purpose}</dd>
          <dt>作成日</dt>
          <dd>未設定（持っていく前に書き入れてください）</dd>
        </dl>

        <List title="経営者の思い・希望（ご本人の発言）" items={report.statements} />
        <List title="相談したいと思われること（AIの整理案。事実とは限りません）" items={report.aiNotes} />
        {report.optionsNote && <List title="関心のある選択肢" items={[report.optionsNote]} />}
        <List title="確認できていないこと" items={report.unconfirmed} />
        <List title="相談したい質問" items={report.questions} />
        <List title="持っていく資料の候補（一般的な例。選んだ項目とは関係なく載せています）" items={report.documents} />
        <List title="ご注意" items={report.notes} />
      </article>

      <div className="card v2-no-print">
        <div className="button-row">
          <button className="button" type="button" onClick={() => window.print()}>
            印刷する
          </button>
          <Link className="button button--secondary" href="/v2/report">
            載せる項目を選び直す
          </Link>
          <Link className="button button--secondary" href="/v2/review">
            内容を直す
          </Link>
          <button className="button button--danger" type="button" disabled={busy} onClick={() => void resetAll()}>
            すべて消す
          </button>
        </div>
        <p className="muted">共有用のリンクや自動送信はありません。印刷して、ご自分で持っていきます。</p>
      </div>
    </>
  );
}
