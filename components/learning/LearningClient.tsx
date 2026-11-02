"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Course, LearningState } from "@/lib/plan-types";
import { asObject, postJson } from "@/components/post-json";
import { formatDateTime } from "@/components/format";
import { useElapsedSeconds } from "@/components/use-elapsed";
import LevelBadge from "./LevelBadge";
import PlanList from "./PlanList";
import CourseCards from "./CourseCards";

type Props = {
  initialState: LearningState;
  courses: Pick<Course, "id" | "title" | "level" | "goal">[];
  /** 「学びたいこと」の最大文字数（サーバーの上限に合わせる） */
  wantsMax: number;
};

/** 後継者の学習プラン（POST /api/learning/plan で作る・作り直す） */
export default function LearningClient({ initialState, courses, wantsMax: WANTS_MAX }: Props) {
  const [state, setState] = useState<LearningState>(initialState);
  const [wants, setWants] = useState(initialState.wants ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seconds = useElapsedSeconds(pending);
  const planHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPlan = useRef(false);
  const wantsId = useId();
  const wantsHelpId = useId();

  useEffect(() => {
    if (focusPlan.current) {
      focusPlan.current = false;
      planHeadingRef.current?.focus();
    }
  }, [state]);

  async function makePlan() {
    if (pending) return; // 二重押し防止
    setPending(true);
    setError(null);
    const r = await postJson<LearningState>(
      "/api/learning/plan",
      // 空なら送らない（サーバーが保存済みの値を使うかどうかを決める）
      wants.trim() ? { wants: wants.trim() } : {},
      (d) => asObject<LearningState>(d.state),
    );
    setPending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    focusPlan.current = true;
    setState(r.data);
  }

  const { current, previous } = state;

  return (
    <>
      <section className="card" aria-labelledby="level-title">
        <h2 id="level-title">いまの知識レベル</h2>
        <LevelBadge level={state.level} />
        <p className="muted level-steps">
          Lv1 言葉を知る → Lv2 自店の数字を読む → Lv3 一緒に判断する → Lv4 自分で判断する
        </p>
      </section>

      <section className="card" aria-labelledby="wants-title">
        <h2 id="wants-title">学習プランを作る</h2>
        <label htmlFor={wantsId} className="chat__label">
          学びたいこと
        </label>
        <textarea
          id={wantsId}
          className="textarea"
          rows={3}
          maxLength={WANTS_MAX}
          value={wants}
          onChange={(e) => setWants(e.target.value)}
          disabled={pending}
          aria-describedby={wantsHelpId}
          placeholder="例：お店のお金の流れが分かるようになりたい"
        />
        <p id={wantsHelpId} className="chat__help">
          <span>認識差の診断がある場合は、その結果も反映して順番を決めます。</span>
          <span>
            {Array.from(wants).length}/{WANTS_MAX}
          </span>
        </p>
        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={() => void makePlan()}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "AIが作っています…" : current ? "学習プランを作り直す" : "学習プランを作る"}
          </button>
        </div>
        <div role="status" aria-live="polite" className="progress-note">
          {pending && (
            <>
              <span className="spinner" aria-hidden="true" />
              AIが学習プランを作っています。数十秒かかることがあります（{seconds}秒経過）。
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {current ? (
        <section className="card" aria-labelledby="plan-title">
          <h2 id="plan-title" ref={planHeadingRef} tabIndex={-1}>
            学習プラン
          </h2>
          {current.usedDiagnosis && (
            <p className="diag-used">
              <span className="badge badge--expert">認識差の診断を反映しています</span>
            </p>
          )}
          {current.plan.message && <p className="ai-message">{current.plan.message}</p>}

          {previous ? (
            <div className="compare-row__cols plan-compare">
              <div className="compare-col compare-col--previous">
                <h3 className="compare-col__title">前のプラン</h3>
                <p className="plan-time">
                  {formatDateTime(previous.createdAt)}
                  {previous.usedDiagnosis ? "（診断を反映）" : "（診断の反映なし）"}
                </p>
                <PlanList plan={previous.plan} courses={courses} plain />
              </div>
              <div className="compare-col compare-col--successor">
                <h3 className="compare-col__title">今のプラン</h3>
                <p className="plan-time">
                  {formatDateTime(current.createdAt)}
                  {current.usedDiagnosis ? "（診断を反映）" : ""}
                </p>
                <PlanList plan={current.plan} courses={courses} previous={previous.plan} />
              </div>
            </div>
          ) : (
            <>
              <p className="plan-time">{formatDateTime(current.createdAt)} 作成</p>
              <PlanList plan={current.plan} courses={courses} />
            </>
          )}
          <p className="interview__footnote">
            AIによる下書きです。順番や内容は、ご自身に合わせて調整してください。
          </p>
        </section>
      ) : (
        <section className="card" role="status">
          <p>まだ学習プランはありません。「学習プランを作る」を押すと、AI がおすすめの順番を提案します。</p>
        </section>
      )}

      <section className="card" aria-labelledby="courses-title">
        <h2 id="courses-title">講座</h2>
        <p className="muted">講座はそれぞれ、記事3本と確認問題5問です。</p>
        <CourseCards courses={courses} progress={state.progress} plan={current?.plan ?? null} />
      </section>
    </>
  );
}
