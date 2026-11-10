"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_TEXT } from "@/lib/v2/content";
import type { Item, ItemKind } from "@/lib/v2/types";
import { ErrorBox, Guide, KIND_HELP, KIND_LABELS, Loading, Steps } from "./Shared";
import { useV2Session } from "./use-session";

const KINDS: ItemKind[] = ["statement", "ai_note", "unconfirmed"];

export default function ReviewClient() {
  const router = useRouter();
  const { session, loaded, busy, error, act } = useV2Session();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (!loaded) return <Loading />;
  if (!session || session.phase !== "review") {
    return (
      <>
        <Steps current={1} />
        <Guide href="/v2/interview" label="面談へ">
          先に面談を終えると、ここで内容を確認できます。
        </Guide>
      </>
    );
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    setDraft(item.text);
  }

  async function saveEdit(item: Item) {
    if (await act("editItem", { itemId: item.id, text: draft })) setEditingId(null);
  }

  async function confirm() {
    if (await act("confirmReview")) router.push("/v2/options");
  }

  return (
    <>
      <Steps current={1} />
      <h1 className="page-title">内容の確認</h1>
      <p className="lead">
        面談の内容を3つに分けて並べました。違っているところは直し、資料の候補にしたくないものは外してください。ここではまだ、誰にも見せていません。
      </p>
      <ErrorBox message={error} />

      {KINDS.map((kind) => {
        const items = session.items.filter((i) => i.kind === kind);
        return (
          <section key={kind} className={`card v2-kind v2-kind--${kind}`}>
            <h2 className="section-title">{KIND_LABELS[kind]}</h2>
            <p className="muted">{KIND_HELP[kind]}</p>
            {items.length === 0 ? (
              <p className="summary-block__empty">ありません。</p>
            ) : (
              <ul className="v2-items">
                {items.map((item) => (
                  <li key={item.id} className="v2-item">
                    {editingId === item.id ? (
                      <>
                        <label className="visually-hidden" htmlFor={`edit-${item.id}`}>
                          内容を直す
                        </label>
                        <textarea
                          id={`edit-${item.id}`}
                          className="textarea"
                          rows={3}
                          maxLength={MAX_TEXT}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          disabled={busy}
                        />
                        <div className="button-row">
                          <button
                            className="button button--small"
                            type="button"
                            disabled={busy || draft.trim() === ""}
                            onClick={() => void saveEdit(item)}
                          >
                            保存する
                          </button>
                          <button
                            className="button button--secondary button--small"
                            type="button"
                            disabled={busy}
                            onClick={() => setEditingId(null)}
                          >
                            やめる
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="v2-item__row">
                        <p className="v2-item__text v2-pre">
                          {item.text}
                          {item.edited && <span className="badge v2-item__edited">ご本人が修正</span>}
                        </p>
                        <div className="v2-item__actions">
                          <button
                            className="button button--secondary button--small"
                            type="button"
                            disabled={busy}
                            aria-label={`直す：${item.text}`}
                            onClick={() => startEdit(item)}
                          >
                            直す
                          </button>
                          <button
                            className="button button--secondary button--danger button--small"
                            type="button"
                            disabled={busy}
                            aria-label={`候補から外す：${item.text}`}
                            onClick={() => void act("removeItem", { itemId: item.id })}
                          >
                            候補から外す
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <div className="card">
        <p>
          内容を確かめたら、次へ進みます。あとからこの画面に戻って直すこともできます。
          {session.reviewConfirmed && "（確認済みです）"}
        </p>
        <button className="button" type="button" disabled={busy || editingId !== null} onClick={() => void confirm()}>
          確認しました。次へ進む
        </button>
      </div>
    </>
  );
}
