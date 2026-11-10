"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CONSULTANTS, MAX_PURPOSE } from "@/lib/v2/content";
import type { ConsultantKey, ItemKind } from "@/lib/v2/types";
import { ErrorBox, Guide, KIND_LABELS, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

const KINDS: ItemKind[] = ["statement", "ai_note", "option", "unconfirmed"];

export default function ReportSettingsClient() {
  const router = useRouter();
  const { session, loaded, busy, error, act } = useV2Session();
  const [consultant, setConsultant] = useState<ConsultantKey | "">("");
  const [selected, setSelected] = useState<string[]>([]);
  const [purpose, setPurpose] = useState("");
  const [ready, setReady] = useState(false);

  // 保存済みの選択を読み込む（初めてのときは、すべて未選択）
  useEffect(() => {
    if (!session || ready) return;
    setConsultant(session.consultant ?? "");
    setPurpose(session.purpose);
    setSelected(session.items.filter((i) => i.selected).map((i) => i.id));
    setReady(true);
  }, [session, ready]);

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
  if (!session.reviewConfirmed) {
    return (
      <>
        <Steps current={3} />
        <Guide href="/v2/review" label="内容の確認へ">
          先に、整理した内容をご本人が確認してください。
        </Guide>
      </>
    );
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function make() {
    const ids = selected.filter((id) => session!.items.some((i) => i.id === id));
    if (!(await act("setReportSettings", { consultant, selectedIds: ids, purpose }))) return;
    if (await act("generateReport")) router.push("/v2/report/preview");
  }

  return (
    <>
      <Steps current={3} />
      <h1 className="page-title">資料に載せる項目を選ぶ</h1>
      <p className="lead">
        相談先に持っていく資料の下書きを作ります。<strong>印をつけたものだけ</strong>が資料に入ります。印のないものは、資料づくりにも使いません。内容を直した項目は、印が外れます。
      </p>
      <ErrorBox message={error} />

      <section className="card">
        <h2 className="section-title">相談先</h2>
        <label className="chat__label" htmlFor="v2-consultant">
          どこへ相談する資料ですか
        </label>
        <select
          id="v2-consultant"
          className="select"
          value={consultant}
          disabled={busy}
          onChange={(e) => setConsultant(e.target.value as ConsultantKey | "")}
        >
          <option value="">選んでください</option>
          {CONSULTANTS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <p className="muted">資料は自動では送られません。ご本人が確かめて、ご自分で持っていきます。</p>

        <label className="chat__label" htmlFor="v2-purpose">
          相談の目的（書き直せます）
        </label>
        <textarea
          id="v2-purpose"
          className="textarea"
          rows={2}
          maxLength={MAX_PURPOSE}
          value={purpose}
          disabled={busy}
          onChange={(e) => setPurpose(e.target.value)}
        />
        <p className="muted">ここに書いた文章は、資料の「相談の目的」にそのまま載ります。</p>
      </section>

      {KINDS.map((kind) => {
        const items = session.items.filter((i) => i.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} className={`card v2-kind v2-kind--${kind}`}>
            <h2 className="section-title">{KIND_LABELS[kind]}</h2>
            <ul className="v2-items">
              {items.map((item) => (
                <li key={item.id} className="v2-item">
                  <label className="v2-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      disabled={busy}
                      onChange={() => toggle(item.id)}
                    />
                    <span className="v2-pre">{item.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <div className="card">
        <p>
          いま {selected.length} 件に印がついています。
        </p>
        <button
          className="button"
          type="button"
          disabled={busy || consultant === "" || selected.length === 0 || purpose.trim() === ""}
          onClick={() => void make()}
        >
          印をつけた項目で下書きを作る
        </button>
        {(consultant === "" || selected.length === 0) && (
          <p className="muted">相談先を選び、載せる項目に1つ以上印をつけると作れます。</p>
        )}
      </div>
    </>
  );
}
