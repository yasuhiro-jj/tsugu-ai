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
