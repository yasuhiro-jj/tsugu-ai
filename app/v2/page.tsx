import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "TSUGU AI 2.0（試作）" };

// 入口。後継者の登録なしで、経営者一人から始められる。
export default function V2Home() {
  return (
    <>
      <h1 className="page-title">後継者が決まっていなくても、一人で始められます</h1>
      <p className="lead">
        お店のこれからを、AIと一問ずつ話しながら整理します。最後に、相談先へ持っていく資料の下書きができます。
      </p>

      <section className="card">
        <h2 className="section-title">進め方</h2>
        <ol>
          <li>AIの質問に、答えられる範囲で答える（7問。飛ばせます）</li>
          <li>整理された内容を、ご自分で確かめて直す</li>
          <li>これからの選択肢を見る（決めなくてかまいません）</li>
          <li>資料に載せる項目を、ご自分で選ぶ</li>
          <li>資料の下書きを確かめて、ご自分で持っていく</li>
        </ol>
      </section>

      <section className="card">
        <h2 className="section-title">お約束</h2>
        <ul>
          <li>結論を急ぎません。継ぐ・売る・閉じるを、AIが決めることはありません。</li>
          <li>資料に入るのは、ご自分で印をつけた項目だけです。</li>
          <li>資料は自動では送られません。共有用のリンクもありません。</li>
          <li>借入・契約・雇用・税金などは、専門家に確認してください。</li>
        </ul>
        <p className="notice">
          いまは試作のため、外部のAIやデータベースにはつないでいません。入力した内容はサーバーが止まると消えます。
          <strong>実在の情報は入力しないでください。</strong>
        </p>
        <Link className="button" href="/v2/interview">
          面談を始める
        </Link>
      </section>

      <section className="card">
        <h2 className="section-title">先に、短い講座で学ぶ</h2>
        <p>
          「何から考えればよいか分からない」というときは、5〜10分の講座から始められます。読んで、確認問題に答えて、自分のメモを書きます。面談の前でも後でも、いつでも開けます。
        </p>
        <Link className="button button--secondary" href="/v2/learn">
          講座を見る
        </Link>
      </section>
    </>
  );
}
