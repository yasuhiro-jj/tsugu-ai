"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buildOptionGuides } from "@/lib/v2/option-guides";
import type { OptionKey } from "@/lib/v2/types";
import { ErrorBox, Guide, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

export default function OptionsClient() {
  const router = useRouter();
  const { session, loaded, busy, error, act } = useV2Session();
  const [chosen, setChosen] = useState<OptionKey[]>([]);
  const saved = session?.options;

  useEffect(() => {
    if (saved) setChosen(saved);
  }, [saved]);

  if (!loaded) return <Loading />;
  if (!session || session.phase !== "review") {
    return (
      <>
        <Steps current={3} />
        <Guide href="/v2/interview" label="面談へ">
          先に面談を終えてください。
        </Guide>
      </>
    );
  }

  function toggle(key: OptionKey) {
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function next() {
    if (await act("setOptions", { options: chosen })) router.push("/v2/report");
  }

  return (
    <>
      <Steps current={3} />
      <h1 className="page-title">これからの選択肢</h1>
      <p className="lead">
        ここで決める必要はありません。知りたいものにいくつでも印をつけてください。どれも選ばずに進むこともできます。あとで変えられます。
      </p>
      <ErrorBox message={error} />

      <div className="v2-options">
        {buildOptionGuides(session).map((o) => {
          const on = chosen.includes(o.key);
          return (
            <label key={o.key} className={on ? "card v2-option v2-option--on" : "card v2-option"}>
              <span className="v2-option__head">
                <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(o.key)} />
                <strong>{o.label}</strong>
              </span>
              <span className="muted">考えるときに確かめたいこと</span>
              <ul>
                {o.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {o.pending.length > 0 && (
                <>
                  <span className="muted">あなたの準備リストから（まだ確かめていないこと）</span>
                  <ul>
                    {o.pending.map((p) => (
                      <li key={p.key}>
                        {p.label}：{p.state}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <span className="v2-option__hold">
                {o.hold
                  ? "確かめていないことがあるため、この道が合うかどうかの判断は保留です。"
                  : "関係する分野は、ご本人の申告では確認済みです（TSUGU AI は資料を確かめていません）。合うかどうかは、相談先と一緒に考えます。"}
              </span>
            </label>
          );
        })}
      </div>

      <p className="ai-note">
        どの道が合うかは、お店ごとの事情で変わります。AIは結論を出しません。雇用・契約・お金のことは、専門家に確認してください。
      </p>

      <div className="card">
        <button className="button" type="button" disabled={busy} onClick={() => void next()}>
          保存して次へ進む
        </button>
      </div>
    </>
  );
}
