"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MAX_PREP_TEXT, PREP_AREAS, PREP_NOT_YET, PREP_STATUSES } from "@/lib/v2/content";
import type { PrepEntry, PrepKey, PrepStatus } from "@/lib/v2/types";
import { ErrorBox, Guide, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

type Draft = Record<PrepKey, PrepEntry>;

export default function PrepClient() {
  const router = useRouter();
  const { session, loaded, busy, error, act } = useV2Session();
  const [draft, setDraft] = useState<Draft | null>(null);
  const saved = session?.prep;

  useEffect(() => {
    if (saved) setDraft(saved);
  }, [saved]);

  if (!loaded) return <Loading />;
  if (!session || session.phase !== "review" || !draft) {
    return (
      <>
        <Steps current={2} />
        <Guide href="/v2/interview" label="面談へ">
          先に面談を終えてください。
        </Guide>
      </>
    );
  }

  function update(key: PrepKey, patch: Partial<PrepEntry>) {
    setDraft((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }

  async function next() {
    if (await act("setPrep", { prep: draft })) router.push("/v2/options");
  }

  const counts = {
    confirmed: PREP_AREAS.filter((a) => draft[a.key].status === "confirmed").length,
    todo: PREP_AREAS.filter((a) => draft[a.key].status === "todo").length,
    unknown: PREP_AREAS.filter((a) => draft[a.key].status === "unknown").length,
    none: PREP_AREAS.filter((a) => draft[a.key].status === null).length,
  };

  return (
    <>
      <Steps current={2} />
      <h1 className="page-title">準備リスト</h1>
      <p className="lead">
        引き継ぎの相談で聞かれやすいことを、分野ごとに並べました。いまの状況に近いものを選んでください。全部を埋める必要はありません。選ばない分野は「{PREP_NOT_YET}」のままです。
      </p>
      <p className="notice v2-note">
        金額・契約の中身・人の名前は書かないでください（いまは試作です）。「次に確認すること」には、「返済予定表を探す」のような行動だけを書きます。
      </p>
      <ErrorBox message={error} />

      <p className="muted" aria-live="polite">
        確認済み {counts.confirmed}／要確認 {counts.todo}／不明 {counts.unknown}／{PREP_NOT_YET} {counts.none}
      </p>

      {PREP_AREAS.map((area) => {
        const entry = draft[area.key];
        const name = `prep-${area.key}`;
        return (
          <fieldset key={area.key} className="card v2-prep">
            <legend className="v2-prep__legend">{area.label}</legend>
            <p className="v2-prep__what">{area.what}</p>
            <p className="muted v2-prep__note">{area.note}</p>

            <div className="v2-prep__status" role="radiogroup" aria-label={`${area.label}の状況`}>
              <label className="v2-radio">
                <input
                  type="radio"
                  name={name}
                  checked={entry.status === null}
                  disabled={busy}
                  onChange={() => update(area.key, { status: null })}
                />
                <span>{PREP_NOT_YET}</span>
              </label>
              {PREP_STATUSES.map((s) => (
                <label key={s.key} className="v2-radio">
                  <input
                    type="radio"
                    name={name}
                    checked={entry.status === s.key}
                    disabled={busy}
                    onChange={() => update(area.key, { status: s.key as PrepStatus })}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>

            {entry.status === "confirmed" && (
              <>
                <label className="chat__label" htmlFor={`${name}-basis`}>
                  何で確かめましたか（資料の名前と、いつ時点か）
                </label>
                <input
                  id={`${name}-basis`}
                  className="input v2-input"
                  type="text"
                  maxLength={MAX_PREP_TEXT}
                  value={entry.basis}
                  disabled={busy}
                  onChange={(e) => update(area.key, { basis: e.target.value })}
                />
                <p className="muted">書かない場合は、資料に「資料名・時点は未記入」と出ます。</p>
              </>
            )}

            <label className="chat__label" htmlFor={`${name}-next`}>
              次に確認すること（書かなくてもかまいません）
            </label>
            <input
              id={`${name}-next`}
              className="input v2-input"
              type="text"
              maxLength={MAX_PREP_TEXT}
              value={entry.next}
              disabled={busy}
              onChange={(e) => update(area.key, { next: e.target.value })}
            />
          </fieldset>
        );
      })}

      <p className="ai-note">
        ここでの「確認済み」は、ご本人の申告です。AIは資料を見ていません。借入・契約・保証・許認可・雇用は、相談先や専門家と資料を見ながら確かめてください。
      </p>

      <div className="card">
        <p>この内容が資料に入るのは、あとの画面でご自分が「載せる」に印をつけた分野だけです。</p>
        <button className="button" type="button" disabled={busy} onClick={() => void next()}>
          保存して次へ進む
        </button>
      </div>
    </>
  );
}
