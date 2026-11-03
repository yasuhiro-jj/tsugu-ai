import Link from "next/link";
import { getRole } from "@/lib/role";
import InterviewClient from "@/components/interview/InterviewClient";

export const dynamic = "force-dynamic";

export default async function InterviewPage() {
  const role = await getRole();

  return (
    <>
      <h1 className="page-title">AI面談</h1>
      <p className="lead">
        AI の質問に答えながら、事業や承継についての考えを整理します。
        テーマごとにまとめを確認し、相手と共有するかどうかを選べます。
      </p>
      <section className="card" aria-labelledby="interview-purpose-title">
        <h2 id="interview-purpose-title">この面談の目的</h2>
        <p>
          ただ会話をするためではなく、<strong>先代の思いや判断の理由を、記録として残す</strong>ための面談です。
          一度言葉にして残しておけば、先代が同じ話を何度も繰り返さなくても、伝えたい人に思いを伝えられます。
          細かなこだわりや、そう考える理由、実際の場面まで、遠慮なくお話しください。
        </p>
        <p className="chat__help">
          いまのデモで共有できる相手は、先代と後継者のあいだだけです。共有するかどうかは、テーマごとにご本人が選びます。
        </p>
      </section>
      {role === null ? (
        <section className="card notice" role="status">
          <h2>先に役割を選んでください</h2>
          <p>AI面談は、先代または後継者として入ってから始められます。</p>
          <p>
            <Link href="/" className="button">
              トップで役割を選ぶ
            </Link>
          </p>
        </section>
      ) : (
        // 役割が変わったら状態を作り直す
        <InterviewClient key={role} />
      )}
    </>
  );
}
