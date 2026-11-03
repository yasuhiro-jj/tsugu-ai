import Link from "next/link";
import { getRole } from "@/lib/role";
import { getDemoId } from "@/lib/demo";
import { getAdvisorState } from "@/lib/advisor";
import {
  ADVISOR_MAX_LENGTH,
  ADVISOR_MAX_TURNS,
  ADVISOR_SUGGESTIONS,
  type AdvisorState,
} from "@/lib/advisor-types";
import AdvisorClient from "@/components/advisor/AdvisorClient";

export const dynamic = "force-dynamic";

// AI参謀の相談は本人だけのもの。サーバーで「デモ用 ID ＋ 役割」で絞った状態だけを画面へ渡す。

const EMPTY_STATE: AdvisorState = {
  messages: [],
  remainingTurns: ADVISOR_MAX_TURNS,
  maxTurns: ADVISOR_MAX_TURNS,
  maxLength: ADVISOR_MAX_LENGTH,
};

export default async function AdvisorPage() {
  const role = await getRole();

  if (!role) {
    return (
      <>
        <h1 className="page-title">AI参謀に相談する</h1>
        <section className="card notice" role="status">
          <h2>先に役割を選んでください</h2>
          <p>AI参謀には、先代または後継者として入ってから相談できます。</p>
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
  let state: AdvisorState | null = EMPTY_STATE;
  if (demoId) {
    try {
      state = await getAdvisorState(demoId, role);
    } catch {
      state = null;
    }
  }

  return (
    <>
      <h1 className="page-title">AI参謀に相談する</h1>
      <p className="lead">
        お店の数字と、二人で共有した診断をもとに、論点の整理と選択肢を示します。判断するのはあなたです。税金・法律・融資・会社の値段は専門家に確認してください。
      </p>
      {state ? (
        // 役割が変わったら状態を作り直す
        <AdvisorClient key={role} initialState={state} suggestions={[...ADVISOR_SUGGESTIONS]} />
      ) : (
        <section className="card notice">
          <h2>相談の画面を読み込めませんでした</h2>
          <p role="alert">時間をおいて、ページを読み込み直してください。</p>
        </section>
      )}
    </>
  );
}
