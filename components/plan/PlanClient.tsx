"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ActionPlanState, ActionStatus, PlanAction } from "@/lib/plan-types";
import { asObject, postJson, type PostResult } from "@/components/post-json";
import { deleteJson } from "./delete-json";
import { formatDateTime, formatDay } from "@/components/format";
import { useElapsedSeconds } from "@/components/use-elapsed";
import { displayCourseTitle } from "@/components/learning/labels";
import styles from "./PlanClient.module.css";

// 90日行動計画（先代・後継者どちらも閲覧・更新できる）。
// 作成・作り直し：POST /api/plan、文・状態・担当・期限の更新：POST /api/plan/action、削除：DELETE /api/plan/action
// 担当・期限の値の確認は画面でも行うが、最終的な確認はサーバー（lib/action-plan.ts の updateAction）が行う。

type ActionPatch = Partial<Pick<PlanAction, "title" | "status" | "owner" | "due">>;

/** 行動の文の上限（lib/action-plan.ts の ACTION_TITLE_MAX と同じ。サーバーでも確かめる） */
const TITLE_MAX = 200;

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

const OWNERS: PlanAction["owner"][] = ["先代", "後継者", "二人"];

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

  /**
   * 行動1件への操作の共通の仕組み：同じ行の二重送信防止・保存中の表示・失敗時はこの行だけ元に戻してサーバーの文言を出す。
   * optimistic があれば先に画面へ反映する。成功すればサーバーが返した計画全体（期限順）に置き換える。
   */
  async function runRow(
    id: string,
    send: () => Promise<PostResult<ActionPlanState>>,
    optimistic?: ActionPatch,
  ): Promise<boolean> {
    if (rowPending[id]) return false;
    const before = state.actions.find((a) => a.id === id);
    if (!before) return false;
    if (optimistic) {
      setState((s) => ({ ...s, actions: s.actions.map((a) => (a.id === id ? { ...a, ...optimistic } : a)) }));
    }
    setRowPending((m) => ({ ...m, [id]: true }));
    setRowError((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    const r = await send();
    setRowPending((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    if (!r.ok) {
      setState((s) => ({ ...s, actions: s.actions.map((a) => (a.id === id ? before : a)) }));
      setRowError((m) => ({ ...m, [id]: r.error }));
      return false;
    }
    setState(r.data);
    return true;
  }

  // 文・状態・担当・期限のどれかを更新する。POST /api/plan/action
  function updateAction(id: string, patch: ActionPatch): Promise<boolean> {
    return runRow(id, () => postJson<ActionPlanState>("/api/plan/action", { id, ...patch }, pickState), patch);
  }

  // 行動を消す。DELETE /api/plan/action（消えるまでは行を残し、失敗したらその行に理由を出す）
  async function removeAction(id: string): Promise<boolean> {
    const ok = await runRow(id, () => deleteJson<ActionPlanState>("/api/plan/action", { id }, pickState));
    if (ok) planHeadingRef.current?.focus(); // 消えた行にあったフォーカスを、計画の見出しへ移す
    return ok;
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
                        startDate={state.startDate}
                        canDelete={state.actions.length > 1}
                        onChange={(patch) => updateAction(a.id, patch)}
                        onDelete={() => removeAction(a.id)}
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
              今の計画と、行動ごとに変えた状態・担当・期限は新しい下書きに置き換わります。よろしいですか？
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

// ---- 期限の範囲（lib/action-plan.ts の phaseRange と同じ計算。lib は server-only のため画面用に持つ） ----

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 開始日を1日目として、その期間（1-30 → 開始日〜開始日+29）の日付の範囲 */
function phaseRange(start: string, phase: PlanAction["phase"]): { from: string; to: string } {
  const offset = phase === "1-30" ? 0 : phase === "31-60" ? 30 : 60;
  return { from: addDays(start, offset), to: addDays(start, offset + 29) };
}

function isYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

type RowProps = {
  action: PlanAction;
  courseTitles: Record<string, string>;
  pending: boolean;
  error: string | null;
  /** 計画の開始日。無ければ期限は変えられない */
  startDate: string | null;
  /** 残りが1件なら false（最後の1件は消せない） */
  canDelete: boolean;
  /** 成功したら true */
  onChange: (patch: ActionPatch) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
};

// 改行・タブ・行区切り（U+2028/2029）。エスケープを使わず文字コードで作る
const LINE_BREAKS = new RegExp("[" + [13, 10, 9, 0x2028, 0x2029].map((c) => String.fromCharCode(c)).join("") + "]+", "g");

/** 改行・タブなどは入れさせない（貼り付けたものは空白1つにする） */
function oneLine(v: string): string {
  return v.replace(LINE_BREAKS, " ");
}

function ActionRow({ action, courseTitles, pending, error, startDate, canDelete, onChange, onDelete }: RowProps) {
  const titleInputId = useId();
  const titleCountId = useId();
  const deleteTextId = useId();
  // 文の編集中の値（null = 編集していない）
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const confirmTextRef = useRef<HTMLParagraphElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const editing = titleDraft !== null;

  useEffect(() => {
    if (editing) titleInputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (confirmDelete) confirmTextRef.current?.focus();
  }, [confirmDelete]);

  const titleTrimmed = titleDraft?.trim() ?? "";
  const titleLength = Array.from(titleTrimmed).length; // サーバーと同じく文字（コードポイント）で数える
  let titleProblem: string | null = null;
  if (editing) {
    if (titleLength === 0) titleProblem = "行動の文を入力してください。";
    else if (titleLength > TITLE_MAX) titleProblem = `${TITLE_MAX}文字以内にしてください（今 ${titleLength}文字）。`;
  }

  function closeTitle() {
    setTitleDraft(null);
    // 閉じたら［直す］へフォーカスを戻す（描き直しの後）
    requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  async function saveTitle() {
    if (!editing || titleProblem || pending) return;
    if (titleTrimmed === action.title) {
      closeTitle();
      return;
    }
    // 失敗したら編集欄を開いたままにして、直してもう一度保存できるようにする
    if (await onChange({ title: titleTrimmed })) closeTitle();
  }

  function cancelDelete() {
    setConfirmDelete(false);
    requestAnimationFrame(() => deleteButtonRef.current?.focus());
  }

  async function doDelete() {
    if (pending) return;
    const ok = await onDelete();
    if (!ok) cancelDelete(); // 消せなかったら確認を閉じ、行の下に理由を出す
  }

  const statusId = useId();
  const ownerId = useId();
  const dueId = useId();
  const dueHintId = useId();
  // 期限の入力中の値（null = 未編集で、保存済みの期限を表示）。日付は1文字ずつ変わるため、ボタンで保存する
  const [dueDraft, setDueDraft] = useState<string | null>(null);
  const course = action.linked_course ? displayCourseTitle(courseTitles[action.linked_course] ?? action.linked_course) : "";
  const range = startDate ? phaseRange(startDate, action.phase) : null;
  const dueValue = dueDraft ?? action.due;
  const dueChanged = dueDraft !== null && dueDraft !== action.due;
  let dueProblem: string | null = null;
  if (dueDraft !== null && dueChanged) {
    if (!isYmd(dueDraft)) dueProblem = "日付を選んでください。";
    else if (range && (dueDraft < range.from || dueDraft > range.to)) {
      dueProblem = `期限は ${formatDay(range.from)}〜${formatDay(range.to)} の間で選んでください。`;
    }
  }

  function saveDue() {
    if (dueDraft === null || !dueChanged || dueProblem || pending || !range) return;
    const due = dueDraft;
    setDueDraft(null);
    void onChange({ due });
  }

  return (
    <li className={action.status === "完了" ? "action action--done" : "action"}>
      <div className="action__head">
        <span className={OWNER_CLASS[action.owner] ?? "badge"}>{action.owner}</span>
        <span className="action__due">期限：{formatDay(action.due)}</span>
      </div>
      {editing ? (
        <form
          className={styles.titleForm}
          onSubmit={(e) => {
            e.preventDefault();
            void saveTitle();
          }}
        >
          <label htmlFor={titleInputId} className={styles.titleLabel}>
            行動の文
          </label>
          <input
            ref={titleInputRef}
            id={titleInputId}
            type="text"
            className={`input ${styles.titleInput}`}
            value={titleDraft}
            onChange={(e) => setTitleDraft(oneLine(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeTitle();
              }
            }}
            disabled={pending}
            aria-busy={pending}
            aria-invalid={titleProblem ? true : undefined}
            aria-describedby={titleCountId}
            autoComplete="off"
          />
          <p id={titleCountId} className={`muted ${styles.hint}`}>
            {titleLength} ／ {TITLE_MAX}文字（改行は入れられません）
          </p>
          {titleProblem && (
            <p className={`form-error ${styles.hint}`} role="alert">
              {titleProblem}
            </p>
          )}
          <div className="button-row">
            <button type="submit" className="button" disabled={pending || titleProblem !== null} aria-busy={pending}>
              {pending ? "保存しています…" : "保存"}
            </button>
            <button type="button" className="button button--secondary" onClick={closeTitle} disabled={pending}>
              やめる
            </button>
          </div>
        </form>
      ) : (
        <p className="action__title">{action.title}</p>
      )}
      {(action.linked_gap || course) && (
        <ul className="action__links">
          {action.linked_gap && <li>つながる認識差：{action.linked_gap}</li>}
          {course && <li>関連する講座：{course}</li>}
        </ul>
      )}
      <div className={styles.edit}>
        <div className="action__status">
          <label htmlFor={ownerId} className={styles.label}>
            担当
          </label>
          <select
            id={ownerId}
            className={`select ${styles.grow}`}
            value={action.owner}
            onChange={(e) => void onChange({ owner: e.target.value as PlanAction["owner"] })}
            disabled={pending}
            aria-busy={pending}
          >
            {OWNERS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <form
          className="action__status"
          onSubmit={(e) => {
            e.preventDefault();
            saveDue();
          }}
        >
          <label htmlFor={dueId} className={styles.label}>
            期限
          </label>
          <input
            id={dueId}
            type="date"
            className={`input ${styles.grow}`}
            value={dueValue}
            min={range?.from}
            max={range?.to}
            onChange={(e) => setDueDraft(e.target.value)}
            disabled={pending || !range}
            aria-busy={pending}
            aria-invalid={dueProblem ? true : undefined}
            aria-describedby={dueHintId}
          />
          {dueChanged && (
            <>
              <button
                type="submit"
                className="button"
                disabled={pending || dueProblem !== null}
              >
                期限を保存
              </button>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setDueDraft(null)}
                disabled={pending}
              >
                戻す
              </button>
            </>
          )}
          <p id={dueHintId} className={`muted ${styles.hint}`}>
            {range
              ? `この時期（${formatDay(range.from)}〜${formatDay(range.to)}）の中で選べます。`
              : "開始日が無いため、期限は変えられません。"}
          </p>
          {dueProblem && (
            <p className={`form-error ${styles.hint}`} role="alert">
              {dueProblem}
            </p>
          )}
        </form>
        <div className="action__status">
          <label htmlFor={statusId} className={styles.label}>
            状態
          </label>
          <select
            id={statusId}
            className={`select ${styles.grow}`}
            value={action.status}
            onChange={(e) => void onChange({ status: e.target.value as ActionStatus })}
            disabled={pending}
            aria-busy={pending}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span role="status" aria-live="polite" className="muted">
            {pending ? "保存しています…" : ""}
          </span>
        </div>
      </div>
      {confirmDelete ? (
        <div className={`inline-confirm ${styles.rowTools}`} role="group" aria-labelledby={deleteTextId}>
          <p id={deleteTextId} ref={confirmTextRef} tabIndex={-1}>
            この行動を消します。元には戻せません。よろしいですか？
          </p>
          <div className="button-row">
            <button
              type="button"
              className="button button--danger-solid"
              onClick={() => void doDelete()}
              disabled={pending}
              aria-busy={pending}
            >
              {pending ? "消しています…" : "削除する"}
            </button>
            <button type="button" className="button button--secondary" onClick={cancelDelete} disabled={pending}>
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className={`button-row ${styles.rowTools}`}>
          {!editing && (
            <button
              ref={editButtonRef}
              type="button"
              className="button button--secondary"
              onClick={() => setTitleDraft(action.title)}
              disabled={pending}
            >
              直す
            </button>
          )}
          <button
            ref={deleteButtonRef}
            type="button"
            className="button button--secondary"
            onClick={() => setConfirmDelete(true)}
            disabled={pending || !canDelete || editing}
            aria-describedby={!canDelete ? deleteTextId : undefined}
          >
            削除
          </button>
          {!canDelete && (
            <p id={deleteTextId} className={`muted ${styles.hint}`}>
              最後の1件は消せません。
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
