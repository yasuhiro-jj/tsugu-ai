import Link from "next/link";
import { getRole } from "@/lib/role";
import { getDemoId } from "@/lib/demo";
import type { ActionPlanState } from "@/lib/plan-types";
import PlanClient from "@/components/plan/PlanClient";
import { todayInJapan } from "@/components/format";
import { getActionPlan, getCourses } from "@/components/server-data";

export const dynamic = "force-dynamic";

const EMPTY_PLAN: ActionPlanState = { startDate: null, actions: [], message: null, createdAt: null };

export default async function PlanPage() {
  const role = await getRole();

  if (!role) {
    return (
      <>
        <h1 className="page-title">90日行動計画</h1>
        <section className="card notice" role="status">
          <h2>先に役割を選んでください</h2>
          <p>90日行動計画は、先代または後継者として入ってから見られます。</p>
          <p>
            <Link href="/" className="button">
              トップで役割を選ぶ
            </Link>
          </p>
        </section>
      </>
    );
  }

  const demoId = await getDemoId();
  let state: ActionPlanState | null = EMPTY_PLAN;
  let courseTitles: Record<string, string> = {};
  if (demoId) {
    try {
      state = (await getActionPlan(demoId)) ?? EMPTY_PLAN;
    } catch {
      state = null;
    }
    try {
      const courses = await getCourses();
      courseTitles = Object.fromEntries(courses.map((c) => [c.id, c.title]));
    } catch {
      courseTitles = {};
    }
  }

  return (
    <>
      <h1 className="page-title">90日行動計画</h1>
      <p className="lead">
        認識差の診断と学習プランをもとに、これからの90日で先代と後継者が取り組むことをまとめます。
        どちらの立場からも状態を更新できます。
      </p>
      {state ? (
        <PlanClient initialState={state} today={todayInJapan()} courseTitles={courseTitles} />
      ) : (
        <section className="card notice">
          <h2>90日計画を読み込めませんでした</h2>
          <p role="alert">時間をおいて、ページを読み込み直してください。</p>
        </section>
      )}
    </>
  );
}
