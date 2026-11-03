"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EDITABLE_THEME_KEYS,
  INDUSTRIES,
  LEVELS,
  PERIOD_FIELD_LABELS,
  PERIOD_FIELDS,
  RELATIONS,
  SETTINGS_INVALIDATE_CONFIRM,
  SETTINGS_LIMITS,
  SETTINGS_NOTICE,
  financialRange,
  type CompanySettings,
  type EditableThemeKey,
  type Industry,
  type Level,
  type Relation,
  type SettingsView,
} from "@/lib/settings-types";
import { INDUSTRY_PRESETS } from "@/lib/industry-presets";
import { THEMES } from "@/lib/themes";
import {
  PERIOD_LABELS,
  charCount,
  parseFinancials,
  toFinDraft,
  type FinDraft,
  type FinKey,
  type PeriodKey,
} from "./fields";
import { CONFLICT_MESSAGE, invalidateLabels, sendSettings, type SaveResult } from "./settings-api";
import styles from "./settings.module.css";

// 会社の設定（業種・概要・面談する人・テーマの補足・決算）を入力して保存する画面。
// 保存・検証・消す処理はサーバー（PUT /api/settings）が行う。画面は入力の手助けと結果の表示だけ。
// 文字列はすべて React の通常の表示で出す（HTML として解釈しない）。

const LEVEL_TEXT: Record<Level, string> = {
  Lv1: "Lv1（言葉を知る）",
  Lv2: "Lv2（自社の数字を読む）",
  Lv3: "Lv3（一緒に判断する）",
  Lv4: "Lv4（自分で判断する）",
};

const INVALIDATE_WARNING = `${SETTINGS_INVALIDATE_CONFIRM}。`;

/** テーマ名（締めは補足を変えられないので含めない） */
const THEME_LABEL = Object.fromEntries(THEMES.map((t) => [t.key, t.label])) as Record<string, string>;
const CLOSING = THEMES.find((t) => t.key === "closing");

type Confirm =
  | { kind: "save"; settings: CompanySettings }
  | { kind: "reset" }
  | { kind: "industry"; next: Industry }
  | null;

type Props = {
  /** 保存済みの設定（役割が未選択・読み込めなかったときは null） */
  initialView: SettingsView | null;
  /** 初期値（つぐみの例）。initialView が null のときに見せる */
  defaults: CompanySettings;
  /** 役割を選んでいれば true（保存できる） */
  canSave: boolean;
};

/** 比べるための並びをそろえた JSON（変更があるかの判定用） */
function stable(s: CompanySettings): string {
  return JSON.stringify({
    industry: s.industry,
    company: [s.company.name, s.company.industryNote, s.company.overview],
    people: [
      s.people.predecessorName,
      s.people.successorName,
      s.people.relation,
      s.people.predecessorLevel,
      s.people.successorLevel,
    ],
    themeHints: EDITABLE_THEME_KEYS.map((k) => s.themeHints[k] ?? ""),
    financials: (["previous", "current"] as const).map((p) => PERIOD_FIELDS.map((k) => s.financials[p][k])),
  });
}

function sameHints(a: Record<EditableThemeKey, string>, b: Record<EditableThemeKey, string>): boolean {
  return EDITABLE_THEME_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));
}

function anyInvalidate(view: SettingsView | null): boolean {
  if (!view) return false;
  return Object.values(view.willInvalidate).some((v) => v === true);
}

function TextField({
  id,
  label,
  value,
  max,
  onChange,
  error,
  multiline = false,
  help,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  error?: string;
  multiline?: boolean;
  help?: ReactNode;
}) {
  const metaId = `${id}-meta`;
  const errId = `${id}-error`;
  const describedBy = error ? `${metaId} ${errId}` : metaId;
  return (
    <div className="field">
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className={`textarea ${styles.control}`}
          rows={5}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      ) : (
        <input
          id={id}
          type="text"
          className={`input ${styles.control}`}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value.replace(/[\r\n]/g, ""))}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
        />
      )}
      <p id={metaId} className={styles.meta}>
        <span>{help}</span>
        <span className={styles.counter}>
          {charCount(value)}／{max}字
        </span>
      </p>
      {error && (
        <p id={errId} className={styles.fieldError}>
          {error}
        </p>
      )}
    </div>
  );
}

export default function SettingsForm({ initialView, defaults, canSave }: Props) {
  const start = initialView?.settings ?? defaults;
  const [view, setView] = useState<SettingsView | null>(initialView);
  const [draft, setDraft] = useState<CompanySettings>(start);
  const [fin, setFin] = useState<FinDraft>(() => toFinDraft(start.financials));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, setPending] = useState(false);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  const disabled = !canSave || pending;
  const err = (path: string): string | undefined => fieldErrors[path];

  function clearMessages() {
    setSuccess(null);
    setFormError(null);
  }

  function update(fn: (s: CompanySettings) => CompanySettings) {
    clearMessages();
    setDraft((s) => fn(s));
  }

  function onIndustryChange(next: Industry) {
    if (next === draft.industry) return;
    const currentPreset = INDUSTRY_PRESETS[draft.industry]?.themeHints;
    // テーマの補足が今の業種の型のままなら、黙って新しい業種の型に入れ替える
    if (currentPreset && sameHints(draft.themeHints, currentPreset)) {
      update((s) => ({ ...s, industry: next, themeHints: { ...INDUSTRY_PRESETS[next].themeHints } }));
      return;
    }
    clearMessages();
    setConfirm({ kind: "industry", next });
  }

  function applyIndustry(next: Industry, replaceHints: boolean) {
    update((s) => ({
      ...s,
      industry: next,
      themeHints: replaceHints ? { ...INDUSTRY_PRESETS[next].themeHints } : s.themeHints,
    }));
    setConfirm(null);
  }

  function showErrors(errors: Record<string, string>, message: string) {
    setFieldErrors(errors);
    setFormError(message);
    // 誤りの一覧へ移動して、読み上げでも気づけるようにする
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  function onSaveClick() {
    if (!canSave || pending) return;
    clearMessages();
    setConflict(false);
    const parsed = parseFinancials(fin);
    const errors: Record<string, string> = { ...parsed.errors };
    if (draft.company.name.trim() === "") errors["company.name"] = "会社名を入れてください";
    if (draft.people.predecessorName.trim() === "") errors["people.predecessorName"] = "先代の名前を入れてください";
    if (draft.people.successorName.trim() === "") errors["people.successorName"] = "後継者の名前を入れてください";
    if (!parsed.value || Object.keys(errors).length > 0) {
      showErrors(errors, "入力を確かめてください。誤りのある欄の下に理由を出しています。");
      return;
    }
    setFieldErrors({});
    const settings: CompanySettings = { ...draft, financials: parsed.value };
    if (view && stable(settings) === stable(view.settings)) {
      setSuccess("変更はありません。");
      return;
    }
    if (anyInvalidate(view)) {
      setConfirm({ kind: "save", settings });
      return;
    }
    void save(settings);
  }

  function applyResult(r: SaveResult, doneText: string, before: SettingsView | null) {
    if (r.kind === "ok") {
      // invalidated が true なら、保存前に「ある」と分かっていたもの（willInvalidate）が消えた
      const gone = r.invalidated ? invalidateLabels(before?.willInvalidate) : [];
      setView(r.view);
      setDraft(r.view.settings);
      setFin(toFinDraft(r.view.settings.financials));
      setFieldErrors({});
      setSuccess(
        !r.invalidated
          ? `${doneText.replace(/。$/, "")}（中身が同じだったため、変わったものはありません）。`
          : gone.length > 0
            ? `${doneText}消えたもの：${gone.join("・")}（面談の記録は残っています）`
            : `${doneText}消えたものはありません。`,
      );
      requestAnimationFrame(() => successRef.current?.focus());
      return;
    }
    if (r.kind === "conflict") {
      setConflict(true);
      setFormError(CONFLICT_MESSAGE);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    if (r.kind === "fieldErrors") {
      showErrors(r.fieldErrors, r.error);
      return;
    }
    setFormError(r.error);
    requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function save(settings: CompanySettings) {
    setConfirm(null);
    setPending(true);
    const before = view;
    const r = await sendSettings("PUT", "/api/settings", { settings, rev: view?.rev ?? 0 });
    setPending(false);
    applyResult(r, "保存しました。", before);
  }

  async function reset() {
    setConfirm(null);
    setPending(true);
    clearMessages();
    setConflict(false);
    const before = view;
    const r = await sendSettings("POST", "/api/settings/reset", { rev: view?.rev ?? 0 });
    setPending(false);
    applyResult(r, "つぐみの例に戻しました。", before);
  }

  function setFinValue(period: PeriodKey, key: FinKey, value: string) {
    clearMessages();
    setFin((f) => ({ ...f, [period]: { ...f[period], [key]: value } }));
  }

  const preset = INDUSTRY_PRESETS[draft.industry];
  const hintsArePreset = preset ? sameHints(draft.themeHints, preset.themeHints) : false;
  const errorList = Object.values(fieldErrors);

  return (
    <>
      <section className={`card ${styles.caution}`} aria-label="入力の前に">
        <p role="note">
          {SETTINGS_NOTICE}
        </p>
      </section>

      {!canSave && (
        <section className="card notice" role="status">
          <h2>保存するには役割を選んでください</h2>
          <p>いまは初期値（架空の「食事処 つぐみ」）を見せています。先代または後継者として入ると、書き換えて保存できます。</p>
          <p>
            <Link href="/" className="button">
              トップで役割を選ぶ
            </Link>
          </p>
        </section>
      )}

      {canSave && view?.isDefault && (
        <p className="muted">いまは初期値（架空の「食事処 つぐみ」）のままです。</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSaveClick();
        }}
        noValidate
      >
        <fieldset className={styles.form} disabled={!canSave}>
          <legend className="visually-hidden">会社の設定</legend>

          <section className="card" aria-labelledby="set-industry">
            <h2 id="set-industry">業種</h2>
            <div className="field">
              <label htmlFor="industry" className={styles.label}>
                業種を選ぶ
              </label>
              <select
                id="industry"
                className={`select ${styles.control}`}
                value={draft.industry}
                onChange={(e) => onIndustryChange(e.target.value as Industry)}
                disabled={disabled || confirm?.kind === "industry"}
                aria-describedby="industry-help"
              >
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {INDUSTRY_PRESETS[i]?.label ?? i}
                  </option>
                ))}
              </select>
              <p id="industry-help" className={styles.meta}>
                業種を変えると、テーマの補足が業種の型に入れ替わります（手を入れていれば確認します）。
              </p>
              {err("industry") && <p className={styles.fieldError}>{err("industry")}</p>}
            </div>
            {confirm?.kind === "industry" && (
              <div className="inline-confirm" role="group" aria-labelledby="industry-confirm-text">
                <p id="industry-confirm-text" ref={confirmRef} tabIndex={-1}>
                  テーマの補足に手を入れています。「{INDUSTRY_PRESETS[confirm.next]?.label ?? confirm.next}」の型に置き換えますか？
                </p>
                <div className="button-row">
                  <button type="button" className="button" onClick={() => applyIndustry(confirm.next, true)}>
                    型に置き換える
                  </button>
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => applyIndustry(confirm.next, false)}
                  >
                    補足はそのまま、業種だけ変える
                  </button>
                  <button type="button" className="button button--secondary" onClick={() => setConfirm(null)}>
                    やめる
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="set-company">
            <h2 id="set-company">会社の概要</h2>
            <TextField
              id="company-name"
              label="会社名"
              value={draft.company.name}
              max={SETTINGS_LIMITS.companyName}
              onChange={(v) => update((s) => ({ ...s, company: { ...s.company, name: v } }))}
              error={err("company.name")}
              help="1行・必須"
            />
            <TextField
              id="company-industry-note"
              label="業種の補足"
              value={draft.company.industryNote}
              max={SETTINGS_LIMITS.industryNote}
              onChange={(v) => update((s) => ({ ...s, company: { ...s.company, industryNote: v } }))}
              error={err("company.industryNote")}
              help="例：和食の食事処"
            />
            <TextField
              id="company-overview"
              label="概要"
              value={draft.company.overview}
              max={SETTINGS_LIMITS.overview}
              onChange={(v) => update((s) => ({ ...s, company: { ...s.company, overview: v } }))}
              error={err("company.overview")}
              multiline
              help="改行できます"
            />
          </section>

          <section className="card" aria-labelledby="set-people">
            <h2 id="set-people">面談する人</h2>
            <div className={styles.grid2}>
              <TextField
                id="people-predecessor"
                label="先代の名前"
                value={draft.people.predecessorName}
                max={SETTINGS_LIMITS.personName}
                onChange={(v) => update((s) => ({ ...s, people: { ...s.people, predecessorName: v } }))}
                error={err("people.predecessorName")}
                help="架空の名前"
              />
              <TextField
                id="people-successor"
                label="後継者の名前"
                value={draft.people.successorName}
                max={SETTINGS_LIMITS.personName}
                onChange={(v) => update((s) => ({ ...s, people: { ...s.people, successorName: v } }))}
                error={err("people.successorName")}
                help="架空の名前"
              />
            </div>
            <div className="field">
              <label htmlFor="people-relation" className={styles.label}>
                二人の関係
              </label>
              <select
                id="people-relation"
                className={`select ${styles.control}`}
                value={draft.people.relation}
                disabled={disabled}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    people: { ...s.people, relation: e.target.value as Relation },
                  }))
                }
              >
                {RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {err("people.relation") && <p className={styles.fieldError}>{err("people.relation")}</p>}
            </div>
            <div className={styles.grid2}>
              {(
                [
                  ["predecessorLevel", "先代の数字の知識レベル"],
                  ["successorLevel", "後継者の数字の知識レベル"],
                ] as const
              ).map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={`people-${key}`} className={styles.label}>
                    {label}
                  </label>
                  <select
                    id={`people-${key}`}
                    className={`select ${styles.control}`}
                    value={draft.people[key]}
                    disabled={disabled}
                    onChange={(e) =>
                      update((s) => ({
                        ...s,
                        people: { ...s.people, [key]: e.target.value as Level },
                      }))
                    }
                  >
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {LEVEL_TEXT[l]}
                      </option>
                    ))}
                  </select>
                  {err(`people.${key}`) && <p className={styles.fieldError}>{err(`people.${key}`)}</p>}
                </div>
              ))}
            </div>
            <p className="muted">後継者の知識レベルを変えると、学習プランのレベルも変わります。</p>
          </section>

          <section className="card" aria-labelledby="set-themes">
            <h2 id="set-themes">テーマの補足（6テーマ）</h2>
            <p className="muted">AI面談で、テーマごとに何を聞くかの手がかりになります。</p>
            <p className={`muted ${styles.presetNote}`}>
              {hintsArePreset
                ? `いまは「${preset?.label ?? ""}」の型のままです。`
                : "業種の型から書き換えています。"}
            </p>
            {EDITABLE_THEME_KEYS.map((k) => (
              <TextField
                key={k}
                id={`theme-${k}`}
                label={THEME_LABEL[k] ?? k}
                value={draft.themeHints[k] ?? ""}
                max={SETTINGS_LIMITS.themeHint}
                onChange={(v) => update((s) => ({ ...s, themeHints: { ...s.themeHints, [k]: v } }))}
                error={err(`themeHints.${k}`)}
                help="空にすると補足なし"
              />
            ))}
            {CLOSING && (
              <div className="field">
                <p className={styles.label}>{CLOSING.label}</p>
                <p className="muted">締めの質問です（どの業種でも同じで、変えられません）。</p>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="set-fin">
            <h2 id="set-fin">決算（単位：万円）</h2>
            <p className="muted">
              整数で入れてください（例：5400 は 5,400万円）。マイナスにできるのは当期純利益だけです。架空の数字にしてください。
            </p>
            <div className={styles.periods}>
              {(["previous", "current"] as const).map((period) => (
                <fieldset key={period} className={styles.period}>
                  <legend>{PERIOD_LABELS[period]}</legend>
                  {PERIOD_FIELDS.map((key: FinKey) => {
                    const label = PERIOD_FIELD_LABELS[key];
                    const id = `fin-${period}-${key}`;
                    const e = err(`financials.${period}.${key}`);
                    const { min } = financialRange(key);
                    return (
                      <div key={key} className={styles.numRow}>
                        <label htmlFor={id} className={styles.label}>
                          {label}
                        </label>
                        <span className={styles.numInput}>
                          <input
                            id={id}
                            type="text"
                            // 負の値を入れられる欄は、マイナス記号を打てるよう数字専用キーボードにしない
                            inputMode={min < 0 ? "text" : "numeric"}
                            autoComplete="off"
                            className="input"
                            value={fin[period][key]}
                            onChange={(ev) => setFinValue(period, key, ev.target.value)}
                            aria-invalid={e ? true : undefined}
                            aria-describedby={e ? `${id}-error` : undefined}
                          />
                          <span className={styles.unit}>万円</span>
                        </span>
                        {e && (
                          <p id={`${id}-error`} className={`${styles.fieldError} ${styles.numError}`}>
                            {e}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          </section>
        </fieldset>

        {canSave && (
          <div className={styles.savebar}>
            {confirm?.kind === "save" && (
              <div className="inline-confirm" role="group" aria-labelledby="save-confirm-text">
                <p id="save-confirm-text" ref={confirmRef} tabIndex={-1}>
                  {INVALIDATE_WARNING}よろしいですか？
                </p>
                <div className="button-row">
                  <button type="button" className="button button--danger-solid" onClick={() => void save(confirm.settings)}>
                    消えてもよいので保存する
                  </button>
                  <button type="button" className="button button--secondary" onClick={() => setConfirm(null)}>
                    やめる
                  </button>
                </div>
              </div>
            )}
            {confirm?.kind === "reset" && (
              <div className="inline-confirm" role="group" aria-labelledby="reset-confirm-text">
                <p id="reset-confirm-text" ref={confirmRef} tabIndex={-1}>
                  {anyInvalidate(view) ? INVALIDATE_WARNING : ""}
                  設定をつぐみの例（初期値）に戻します。よろしいですか？
                </p>
                <div className="button-row">
                  <button type="button" className="button button--danger-solid" onClick={() => void reset()}>
                    つぐみの例に戻す
                  </button>
                  <button type="button" className="button button--secondary" onClick={() => setConfirm(null)}>
                    やめる
                  </button>
                </div>
              </div>
            )}
            {confirm?.kind !== "save" && confirm?.kind !== "reset" && (
              <div className="button-row">
                <button type="submit" className="button" disabled={disabled} aria-busy={pending}>
                  {pending ? "保存しています…" : "保存する"}
                </button>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={disabled}
                  onClick={() => {
                    clearMessages();
                    setConfirm({ kind: "reset" });
                  }}
                >
                  つぐみの例に戻す
                </button>
              </div>
            )}
            {formError && (
              <div ref={errorRef} tabIndex={-1} role="alert">
                <p className="form-error">{formError}</p>
                {errorList.length > 0 && (
                  <ul className={styles.fieldError}>
                    {errorList.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
                {conflict && (
                  <div className="button-row">
                    <button type="button" className="button button--secondary" onClick={() => window.location.reload()}>
                      読み込み直す
                    </button>
                  </div>
                )}
              </div>
            )}
            <div role="status" aria-live="polite">
              {success && (
                <p ref={successRef} tabIndex={-1} className={styles.success}>
                  {success}
                </p>
              )}
            </div>
          </div>
        )}
      </form>
    </>
  );
}
