import Link from "next/link";
import { getRole } from "@/lib/role";
import { getDemoId } from "@/lib/demo";
import type { Course, LearningState } from "@/lib/plan-types";
import LearningClient from "@/components/learning/LearningClient";
import { getCourses, getDiagnosis, getLearningState, WANTS_MAX_CHARS } from "@/components/server-data";

export const dynamic = "force-dynamic";

// 学習プランは後継者本人のページ。先代には後継者の内容（レベル・プラン・進み具合）を一切渡さない。

export default async function LearningPage() {
  const role = await getRole();

  if (!role) {
    return (
      <>
        <h1 className="page-title">後継者の学習プラン</h1>
        <section className="card notice" role="status">
          <h2>先に役割を選んでください</h2>
          <p>学習プランは、後継者として入ってから見られます。</p>
          <p>
            <Link href="/" className="button">
              トップで役割を選ぶ
            </Link>
          </p>
        </section>
      </>
    );
  }

  if (role === "predecessor") {
    return (
      <>
        <h1 className="page-title">後継者の学習プラン</h1>
        <section className="card" role="status">
          <p>学習プランは後継者ご本人のページです。</p>
          <p>
            <Link href="/plan">90日計画を見る</Link>
          </p>
        </section>
      </>
    );
  }

  const demoId = await getDemoId();
  let state: LearningState | null = null;
  let courses: Pick<Course, "id" | "title" | "level" | "goal">[] = [];
  // 診断があるかどうかだけを画面へ渡す（診断の中身は渡さない）。読めなければ案内を出さない
  let hasDiagnosis: boolean | null = null;
  if (demoId) {
    try {
      const [s, cs] = await Promise.all([getLearningState(demoId), getCourses()]);
      state = s;
      // 一覧に必要な項目だけを画面へ渡す
      courses = cs.map((c) => ({ id: c.id, title: c.title, level: c.level, goal: c.goal }));
    } catch {
      state = null;
    }
    try {
      hasDiagnosis = (await getDiagnosis(demoId)) !== null;
    } catch {
      hasDiagnosis = null;
    }
  }

  return (
    <>
      <h1 className="page-title">後継者の学習プラン</h1>
      <p className="lead">
        認識差の診断をもとに、後継者が優先して学ぶ順番を整理します。講座は短い記事と確認問題でできています。
      </p>
      {state ? (
        <LearningClient initialState={state} courses={courses} wantsMax={WANTS_MAX_CHARS} hasDiagnosis={hasDiagnosis} />
      ) : (
        <section className="card notice">
          <h2>学習プランを読み込めませんでした</h2>
          <p role="alert">時間をおいて、ページを読み込み直してください。</p>
        </section>
      )}
    </>
  );
}
