"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MAX_WHO, REPORT_DOCUMENTS, WHENS } from "@/lib/v2/content";
import { buildNextSteps } from "@/lib/v2/next-steps";
import type { StepChoice, StepKey, WhenKey } from "@/lib/v2/types";
import { ErrorBox, Guide, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

type Draft = Partial<Record<StepKey, StepChoice>>;

export default function NextStepsClient() {
  const { session, loaded, busy, error, act } = useV2Session();
  const [draft, setDraft] = useState<Draft>({});
  const [savedNote, setSavedNote] = useState(false);
  const saved = session?.steps;

  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  if (!loaded) return <Loading />;
  if (!session || session.phase !== "review") {
    return (
      <>
        <Steps current={6} />
        <Guide href="/v2/interview" label="面談へ">
          先に面談を終えてください。
        </Guide>
      </>
    );
  }

  const steps = buildNextSteps({ prep: session.prep, consultant: session.consultant, steps: draft });
  const doing = steps.filter((s) => s.decision === "do").length;
  const holding = steps.filter((s) => s.decision === "hold").length;

  function update(key: StepKey, patch: Partial<StepChoice>) {
    setSavedNote(false);
    setDraft((prev) => {
      const current: StepChoice = { decision: null, who: "", when: null, ...(prev[key] ?? {}) };
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }

  async function save() {
    const payload: Draft = {};
    for (const s of steps) payload[s.key] = { decision: s.decision, who: s.who, when: s.when };
    if (await act("setNextSteps", { steps: payload })) setSavedNote(true);
  }

  return (
    <>
      <div className="v2-no-print">
        <Steps current={6} />
      </div>
      <h1 className="page-title">次の一歩</h1>
      <p className="lead">
        これからやることを、ご自分で選びます。全部やる必要はありません。「今は保留」も、立派な選択です。ここはご自分用のメモで、相談資料には入りません。
      </p>
      <ErrorBox message={error} />

      <section className="card">
        <h2 className="section-title">やることの候補</h2>
        {steps.length === 0 ? (
          <>
            <p>
              まだ候補がありません。準備リストで「要確認」「不明」を選ぶか、「次に確認すること」を書くと、ここに並びます。相談先を選ぶと、「相談の日を決める」も加わります。
            </p>
            <p className="v2-no-print">
              <Link className="button button--secondary" href="/v2/prep">
                準備リストへ
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="muted" aria-live="polite">
              やる {doing} 件／今は保留 {holding} 件／まだ決めていない {steps.length - doing - holding} 件
            </p>
            <ul className="v2-items">
              {steps.map((s) => {
                const name = `step-${s.key}`;
                return (
                  <li key={s.key} className="v2-item v2-step">
                    <p className="v2-step__text">
                      <span className="badge">{s.label}</span> <span className="v2-pre">{s.text}</span>
                    </p>
                    <div className="v2-prep__status" role="radiogroup" aria-label={`${s.text}をどうするか`}>
                      {(
                        [
                          [null, "まだ決めていない"],
                          ["do", "やる"],
                          ["hold", "今は保留"],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={label} className="v2-radio">
                          <input
                            type="radio"
                            name={name}
                            checked={s.decision === value}
                            disabled={busy}
                            onChange={() => update(s.key, { decision: value })}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    {s.decision === "do" && (
                      <div className="v2-step__detail">
                        <div>
                          <label className="chat__label" htmlFor={`${name}-who`}>
                            誰が（「自分」「税理士」など、役割で）
                          </label>
                          <input
                            id={`${name}-who`}
                            className="input v2-input"
                            type="text"
                            maxLength={MAX_WHO}
                            value={s.who}
                            disabled={busy}
                            onChange={(e) => update(s.key, { who: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="chat__label" htmlFor={`${name}-when`}>
                            いつ頃
                          </label>
                          <select
                            id={`${name}-when`}
                            className="select"
                            value={s.when ?? ""}
                            disabled={busy}
                            onChange={(e) => update(s.key, { when: (e.target.value || null) as WhenKey | null })}
                          >
                            <option value="">選んでいません</option>
                            {WHENS.map((w) => (
                              <option key={w.key} value={w.key}>
                                {w.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">相談先への質問</h2>
        {session.report ? (
          <ul>
            {session.report.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">資料の下書きを作ると、ここに質問が並びます。</p>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">持っていく資料の候補（一般的な例）</h2>
        <ul>
          {REPORT_DOCUMENTS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <p className="muted">実際に何が必要かは、事前に相談先へ確認してください。見せるのは必要な範囲だけにします。</p>
      </section>

      <p className="ai-note">
        どれをやるか、いつやるかは、ご本人が決めます。AIは順番や期限を決めません。借入・契約・雇用・税金などは、専門家に確認してください。
      </p>

      <div className="card v2-no-print">
        <div className="button-row">
          <button className="button" type="button" disabled={busy || steps.length === 0} onClick={() => void save()}>
            保存する
          </button>
          <button className="button button--secondary" type="button" onClick={() => window.print()}>
            印刷する
          </button>
          <Link className="button button--secondary" href="/v2/report/preview">
            資料の下書きへ戻る
          </Link>
        </div>
        {savedNote && (
          <p className="v2-saved" role="status">
            保存しました。
          </p>
        )}
        <p className="muted">このメモは、どこにも送られません。印刷して、ご自分で使います。</p>
      </div>
    </>
  );
}
