"use client";

import { useEffect, useRef, useState } from "react";
import type { ThemeSummary } from "@/lib/interview-types";
import SummarySections, { MY_SUMMARY_LABELS } from "@/components/SummarySections";

const KEYS = ["statements", "ai_observations", "unconfirmed"] as const;
type SummaryKey = (typeof KEYS)[number];

const MAX_ITEM_LENGTH = 300; // サーバー側 lib/validation.ts と同じ上限

type Props = {
  themeLabel: string;
  summary: ThemeSummary;
  busy: boolean;
  onConfirm: (edited?: ThemeSummary) => void;
  onDiscard: () => void;
};

function cleanSummary(s: ThemeSummary): ThemeSummary {
  return {
    statements: s.statements.map((x) => x.trim()).filter(Boolean),
    ai_observations: s.ai_observations.map((x) => x.trim()).filter(Boolean),
    unconfirmed: s.unconfirmed.map((x) => x.trim()).filter(Boolean),
  };
}

/** AI が作った要約の確認カード（本人が確認するまで保存されない） */
export default function SummaryCard({ themeLabel, summary, busy, onConfirm, onDiscard }: Props) {
  const [mode, setMode] = useState<"view" | "edit" | "confirmDiscard">("view");
  const [draft, setDraft] = useState<ThemeSummary>(summary);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 表示されたら見出しへフォーカスを移す（読み上げ・キーボード操作で気づけるように）
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function startEdit() {
    setDraft({
      statements: [...summary.statements],
      ai_observations: [...summary.ai_observations],
      unconfirmed: [...summary.unconfirmed],
    });
    setMode("edit");
  }

  function updateItem(key: SummaryKey, index: number, value: string) {
    setDraft((d) => ({ ...d, [key]: d[key].map((v, i) => (i === index ? value : v)) }));
  }

  function addItem(key: SummaryKey) {
    setDraft((d) => ({ ...d, [key]: [...d[key], ""] }));
  }

  function removeItem(key: SummaryKey, index: number) {
    setDraft((d) => ({ ...d, [key]: d[key].filter((_, i) => i !== index) }));
  }

  return (
    <section className="card summary-card" aria-labelledby="summary-card-title">
      <p className="summary-card__theme">テーマ：{themeLabel}</p>
      <h2 id="summary-card-title" ref={headingRef} tabIndex={-1}>
        このテーマのまとめ（あなたが確認するまで保存されません）
      </h2>

      {mode !== "edit" ? (
        <SummarySections summary={summary} />
      ) : (
        <div className="summary-edit">
          {KEYS.map((k) => (
            <fieldset key={k} className="summary-edit__group">
              <legend>{MY_SUMMARY_LABELS[k]}</legend>
              {draft[k].length === 0 && <p className="summary-block__empty">（なし）</p>}
              {draft[k].map((item, i) => (
                <div key={i} className="summary-edit__row">
                  <textarea
                    className="textarea"
                    rows={2}
                    maxLength={MAX_ITEM_LENGTH}
                    value={item}
                    aria-label={`${MY_SUMMARY_LABELS[k]}　${i + 1}件目`}
                    onChange={(e) => updateItem(k, i, e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="button button--small button--secondary"
                    onClick={() => removeItem(k, i)}
                    disabled={busy}
                    aria-label={`${MY_SUMMARY_LABELS[k]}の${i + 1}件目を削除`}
                  >
                    削除
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button button--small button--secondary"
                onClick={() => addItem(k)}
                disabled={busy}
                aria-label={`${MY_SUMMARY_LABELS[k]}に行を追加`}
              >
                ＋ 行を追加
              </button>
            </fieldset>
          ))}
        </div>
      )}

      <div className="summary-card__actions">
        {mode === "view" && (
          <div className="button-row">
            <button type="button" className="button" onClick={() => onConfirm()} disabled={busy}>
              {busy ? "保存しています…" : "この内容でOK"}
            </button>
            <button type="button" className="button button--secondary" onClick={startEdit} disabled={busy}>
              直したい
            </button>
            <button
              type="button"
              className="button button--secondary button--danger"
              onClick={() => setMode("confirmDiscard")}
              disabled={busy}
            >
              このテーマは保存しない
            </button>
          </div>
        )}

        {mode === "edit" && (
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => onConfirm(cleanSummary(draft))}
              disabled={busy}
            >
              {busy ? "保存しています…" : "この内容で保存"}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setMode("view")}
              disabled={busy}
            >
              編集をやめる
            </button>
          </div>
        )}

        {mode === "confirmDiscard" && (
          <div className="inline-confirm" role="group" aria-labelledby="discard-confirm-text">
            <p id="discard-confirm-text">
              このテーマのまとめは保存されず、相手にも共有されません。次のテーマへ進みます。よろしいですか？
            </p>
            <div className="button-row">
              <button
                type="button"
                className="button button--danger-solid"
                onClick={onDiscard}
                disabled={busy}
              >
                {busy ? "処理しています…" : "保存せずに次へ"}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setMode("view")}
                disabled={busy}
              >
                戻る
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
