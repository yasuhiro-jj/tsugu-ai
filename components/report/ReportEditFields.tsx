"use client";

import { useId } from "react";
import type { ReportPoint } from "@/lib/report-types";
import { REPORT_LIMITS } from "@/lib/report-types";
import { countChars, splitLines } from "./report-edit";
import styles from "./report.module.css";

// 資料の AI が書いた部分の編集欄。文は textarea、箇条書きは「1行＝1項目」の textarea、
// 根拠つきの項目（強み・課題）は1項目ずつの欄。上限は「n／上限」で出す（超えたら文字でも知らせる）。

function Counter({ id, n, max, unit }: { id: string; n: number; max: number; unit: string }) {
  const over = n > max;
  return (
    <span id={id} className={`${styles.counter} ${over ? styles.counterOver : ""}`}>
      {n}／{max}
      {unit}
      {over && "（上限を超えています）"}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className={styles.fieldError} role="alert">
      {message}
    </p>
  );
}

type TextProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  error?: string;
  rows?: number;
  disabled?: boolean;
};

/** 文の編集欄 */
export function EditText({ label, value, onChange, max, error, rows = 5, disabled }: TextProps) {
  const id = useId();
  const n = countChars(value.trim());
  return (
    <div className={styles.editField}>
      <label htmlFor={id} className={styles.editLabel}>
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        aria-invalid={error || n > max ? true : undefined}
        disabled={disabled}
      />
      <div className={styles.editMeta}>
        <Counter id={`${id}-count`} n={n} max={max} unit="字" />
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

type LinesProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  minItems?: number;
  maxItems: number;
  itemMax?: number;
  error?: string;
  disabled?: boolean;
};

/** 箇条書きの編集欄（1行＝1項目。行を足すと項目が増え、消すと減る） */
export function EditLines({
  label,
  value,
  onChange,
  minItems = 0,
  maxItems,
  itemMax = REPORT_LIMITS.itemMax,
  error,
  disabled,
}: LinesProps) {
  const id = useId();
  const items = splitLines(value);
  const longLines = items.map((t, i) => ({ no: i + 1, n: countChars(t) })).filter((x) => x.n > itemMax);
  const rows = Math.min(Math.max(items.length + 1, 3), 10);
  const tooFew = items.length < minItems;
  return (
    <div className={styles.editField}>
      <label htmlFor={id} className={styles.editLabel}>
        {label}
      </label>
      <p id={`${id}-hint`} className={styles.editHint}>
        1行に1項目を書きます（1項目は{itemMax}字まで{minItems > 0 ? `。${minItems}項目以上` : ""}）。行を足すと項目が増え、行を消すと減ります。
      </p>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label}（1行に1項目）`}
        aria-describedby={`${id}-hint ${id}-count${longLines.length ? ` ${id}-long` : ""}${error ? ` ${id}-error` : ""}`}
        aria-invalid={error || items.length > maxItems || longLines.length > 0 ? true : undefined}
        disabled={disabled}
      />
      <div className={styles.editMeta}>
        {tooFew && <span className={styles.counterOver}>{minItems}項目以上にしてください</span>}
        <Counter id={`${id}-count`} n={items.length} max={maxItems} unit="項目" />
      </div>
      {longLines.length > 0 && (
        <p id={`${id}-long`} className={styles.fieldError}>
          {longLines.map((x) => `${x.no}項目め（${x.n}字）`).join("、")}が{itemMax}字を超えています。
        </p>
      )}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

type PointsProps = {
  label: string;
  value: ReportPoint[];
  onChange: (v: ReportPoint[]) => void;
  min: number;
  max: number;
  error?: string;
  disabled?: boolean;
};

/** 根拠つきの項目の編集欄（強み・課題）。1項目ずつ「内容」と「根拠」を書く */
export function EditPoints({ label, value, onChange, min, max, error, disabled }: PointsProps) {
  const id = useId();
  const itemMax = REPORT_LIMITS.itemMax;
  const update = (i: number, patch: Partial<ReportPoint>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => onChange([...value, { text: "", basis: "" }]);

  return (
    <fieldset className={styles.editPoints} aria-describedby={error ? `${id}-error` : undefined}>
      <legend className={styles.editLabel}>
        {label}（{value.length}／{max}項目。{min}項目以上）
      </legend>
      {value.length === 0 && <p className="muted">項目がありません。</p>}
      {value.map((p, i) => {
        const tId = `${id}-${i}-text`;
        const bId = `${id}-${i}-basis`;
        const tn = countChars(p.text.trim());
        const bn = countChars(p.basis.trim());
        return (
          <div key={i} className={styles.editPoint}>
            <label htmlFor={tId} className={styles.editSubLabel}>
              {label} {i + 1}：内容
            </label>
            <textarea
              id={tId}
              className="textarea"
              rows={2}
              value={p.text}
              onChange={(e) => update(i, { text: e.target.value })}
              aria-label={`${label} ${i + 1} の内容`}
              aria-describedby={`${tId}-count`}
              aria-invalid={tn > itemMax ? true : undefined}
              disabled={disabled}
            />
            <div className={styles.editMeta}>
              <Counter id={`${tId}-count`} n={tn} max={itemMax} unit="字" />
            </div>
            <label htmlFor={bId} className={styles.editSubLabel}>
              {label} {i + 1}：根拠
            </label>
            <textarea
              id={bId}
              className="textarea"
              rows={2}
              value={p.basis}
              onChange={(e) => update(i, { basis: e.target.value })}
              aria-label={`${label} ${i + 1} の根拠`}
              aria-describedby={`${bId}-count`}
              aria-invalid={bn > itemMax ? true : undefined}
              disabled={disabled}
            />
            <div className={styles.editMeta}>
              <Counter id={`${bId}-count`} n={bn} max={itemMax} unit="字" />
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => remove(i)}
                aria-label={`${label} ${i + 1} を消す`}
                disabled={disabled || value.length <= min}
              >
                この項目を消す
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={add}
        disabled={disabled || value.length >= max}
        aria-label={`${label}の項目を足す`}
      >
        項目を足す
      </button>
      <FieldError id={`${id}-error`} message={error} />
    </fieldset>
  );
}
