"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ActionPlanState, ActionStatus, PlanAction } from "@/lib/plan-types";
import { asObject, postJson } from "@/components/post-json";
import { formatDateTime, formatDay } from "@/components/format";
import { useElapsedSeconds } from "@/components/use-elapsed";

// 90日行動計画（先代・後継者どちらも閲覧・更新できる）。
// 作成・作り直し：POST /api/plan、状態の更新：POST /api/plan/action

type Props = {
  initialState: ActionPlanState;
  /** 今日（日本時間、YYYY-MM-DD）。開始日の既定値 */
  today: string;
  /** 講座 ID → 講座名（linked_course の表示用） */
  courseTitles: Record<string, string>;
};

const PHASES: { key: PlanAction["phase"]; days: string; label: string }[] = [
  { key: "1-30", days: "1〜30日", label: "知る・一緒に見る" },
  { key: "31-60", days: "31〜60日", label: "一緒にやってみる" },
  { key: "61-90", days: "61〜90日", label: "任せる・振り返る" },
];

const STATUSES: ActionStatus[] = ["未着手", "進行中", "完了"];

const OWNER_CLASS: Record<PlanAction["owner"], string> = {
  先代: "badge badge--owner-predecessor",
  後継者: "badge badge--owner-successor",
  二人: "badge badge--owner-both",
};

function pickState(d: Record<string, unknown>): ActionPlanState | undefined {
  const s = asObject<ActionPlanState>(d.state);
  return s && Array.isArray(s.actions) ? s : undefined;
}

export default function PlanClient({ initialState, today, courseTitles }: Props) {
  const [state, setState] = useState<ActionPlanState>(initialState);
  const [startDate, setStartDate] = useState(initialState.startDate ?? today);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmRemake, setConfirmRemake] = useState(false);
  const [rowPending, setRowPending] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const seconds = useElapsedSeconds(creating);
  const dateId = useId();
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const planHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusPlan = useRef(false);

  useEffect(() => {
    if (confirmRemake) confirmRef.current?.focus();
  }, [confirmRemake]);

  useEffect(() => {
    if (focusPlan.current) {
      focusPlan.current = false;
      planHeadingRef.current?.focus();
    }
  }, [state]);

  const hasPlan = state.actions.length > 0;
  const doneCount = state.actions.filter((a) => a.status === "完了").length;

  async function create() {
    if (creating) return; // 二重押し防止
    setCreating(true);
    setCreateError(null);
    const r = await postJson<ActionPlanState>(
      "/api/plan",
      startDate ? { startDate } : {},
      pickState,
    );
    setCreating(false);
    if (!r.ok) {
      setCreateError(r.error);
      return;
    }
    setConfirmRemake(false);
    setRowError({});
    focusPlan.current = true;
    setState(r.data);
  }

  async function updateStatus(id: string, status: ActionStatus) {
    if (rowPending[id]) return;
    const before = state;
    // 先に画面へ反映し、失敗したら戻す
    setState((s) => ({ ...s, actions: s.actions.map((a) => (a.id === id ? { ...a, status } : a)) }));
    setRowPending((m) => ({ ...m, [id]: true }));
    setRowError((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    const r = await postJson<ActionPlanState>("/api/plan/action", { id, status }, pickState);
    setRowPending((m) => ({ ...m, [id]: false }));
    if (!r.ok) {
      setState(before);
      setRowError((m) => ({ ...m, [id]: r.error }));
      return;
    }
    setState(r.data);
  }

  const dateField = (
    <div className="field">
      <label htmlFor={dateId} className="chat__label">
        開始日
      </label>
      <input
        id={dateId}
        type="date"
        className="input"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        disabled={creating}
      />
    </div>
  );

  const progressNote = (
    <div role="status" aria-live="polite" className="progress-note">
      {creating && (
        <>
          <span className="spinner" aria-hidden="true" />
          AIが90日計画の下書きを作っています。数十秒かかることがあります（{seconds}秒経過）。
        </>
      )}
    </div>
  );

  if (!hasPlan) {
    return (
      <section className="card" aria-labelledby="plan-create-title">
        <h2 id="plan-create-title">90日計画の下書きを作る</h2>
        <p>
          認識差の診断と学習プランをもとに、AI がこれからの90日で取り組むことの下書きを作ります。
        </p>
        {dateField}
        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={() => void create()}
            disabled={creating}
            aria-busy={creating}
          >
            {creating ? "AIが作っています…" : "90日計画の下書きを作る"}
          </button>
        </div>
        {progressNote}
        {createError && (
          <p className="form-error" role="alert">
            {createError}
          </p>
        )}
      </section>
    );
  }

  return (
    <>
      <section className="card" aria-labelledby="plan-summary-title">
        <h2 id="plan-summary-title" ref={planHeadingRef} tabIndex={-1}>
          進み具合
        </h2>
        <p className="plan-progress__count">
          完了 <strong>{doneCount}</strong> ／ 全体 {state.actions.length}
        </p>
        <progress
          className="plan-progress__bar"
          max={state.actions.length}
          value={doneCount}
          aria-label="完了した行動の割合"
        />
        {state.startDate && (
          <p className="muted">
            開始日：{formatDay(state.startDate)}
            {state.createdAt && `（${formatDateTime(state.createdAt)} 作成）`}
          </p>
        )}
        {state.message && <p className="ai-message">{state.message}</p>}
        <p className="ai-note" role="note">
          AIによる下書きです。お二人で直したり消したりして決めてください。
        </p>
      </section>

      <ol className="timeline">
        {PHASES.map((phase) => {
          const actions = state.actions.filter((a) => a.phase === phase.key);
          return (
            <li key={phase.key} className="timeline__phase">
              <section className="card" aria-labelledby={`phase-${phase.key}`}>
                <h2 id={`phase-${phase.key}`} className="timeline__title">
                  <span className="timeline__days">{phase.days}</span>
                  {phase.label}
                </h2>
                {actions.length === 0 ? (
                  <p className="summary-block__empty">（この時期の行動はありません）</p>
                ) : (
                  <ul className="actions">
                    {actions.map((a) => (
                      <ActionRow
                        key={a.id}
                        action={a}
                        courseTitles={courseTitles}
                        pending={rowPending[a.id] === true}
                        error={rowError[a.id] ?? null}
                        onChange={(s) => void updateStatus(a.id, s)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </li>
          );
        })}
      </ol>

      <section className="card" aria-labelledby="remake-title">
        <h2 id="remake-title">計画を作り直す</h2>
        {!confirmRemake ? (
          <div className="button-row">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setCreateError(null);
                setConfirmRemake(true);
              }}
            >
              作り直す
            </button>
          </div>
        ) : (
          <div className="inline-confirm" role="group" aria-labelledby="remake-confirm-text">
            <p id="remake-confirm-text" ref={confirmRef} tabIndex={-1}>
              今の計画と、行動ごとの状態（進行中・完了など）は新しい下書きに置き換わります。よろしいですか？
            </p>
            {dateField}
            <div className="button-row">
              <button
                type="button"
                className="button button--danger-solid"
                onClick={() => void create()}
                disabled={creating}
                aria-busy={creating}
              >
                {creating ? "AIが作っています…" : "作り直す"}
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setConfirmRemake(false)}
                disabled={creating}
              >
                やめる
              </button>
            </div>
            {progressNote}
            {createError && (
              <p className="form-error" role="alert">
                {createError}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  );
}

type RowProps = {
  action: PlanAction;
  courseTitles: Record<string, string>;
  pending: boolean;
  error: string | null;
  onChange: (status: ActionStatus) => void;
};

function ActionRow({ action, courseTitles, pending, error, onChange }: RowProps) {
  const selectId = useId();
  const course = action.linked_course ? (courseTitles[action.linked_course] ?? action.linked_course) : "";
  return (
    <li className={action.status === "完了" ? "action action--done" : "action"}>
      <div className="action__head">
        <span className={OWNER_CLASS[action.owner] ?? "badge"}>{action.owner}</span>
        <span className="action__due">期限：{formatDay(action.due)}</span>
      </div>
      <p className="action__title">{action.title}</p>
      {(action.linked_gap || course) && (
        <ul className="action__links">
          {action.linked_gap && <li>つながる認識差：{action.linked_gap}</li>}
          {course && <li>関連する講座：{course}</li>}
        </ul>
      )}
      <div className="action__status">
        <label htmlFor={selectId}>状態</label>
        <select
          id={selectId}
          className="select"
          value={action.status}
          onChange={(e) => onChange(e.target.value as ActionStatus)}
          disabled={pending}
          aria-busy={pending}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {pending && <span className="muted">保存しています…</span>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
