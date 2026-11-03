// 根拠を確認できない数字・発言の注記（診断・資料・AI参謀の返事・講座の質問の答えで共通）。
// 照合はサーバー（lib/grounding.ts）が行い、文は groundingNotice() の決まった文をそのまま出す。画面では判定しない。
// 色だけに頼らず、文（先頭の一文は太字）で伝える。印刷でも消さない（data-print="hide" を付けない）。

import { groundingNotice, GROUNDING_ITEMS_MAX } from "@/lib/grounding";
import type { Grounding } from "@/lib/plan-types";
import styles from "./GroundingNote.module.css";

/** API の返り値から grounding を取り出す（形が違えば undefined。文字列以外は捨て、件数は上限まで） */
export function pickGrounding(v: unknown): Grounding | undefined {
  if (v === null || typeof v !== "object") return undefined;
  const { ungroundedNumbers, unsupportedQuotes } = v as Record<string, unknown>;
  const strings = (x: unknown) =>
    Array.isArray(x)
      ? x.filter((s): s is string => typeof s === "string" && s.trim() !== "").slice(0, GROUNDING_ITEMS_MAX)
      : [];
  return { ungroundedNumbers: strings(ungroundedNumbers), unsupportedQuotes: strings(unsupportedQuotes) };
}

type Props = {
  grounding?: Grounding | null;
  className?: string;
};

export default function GroundingNote({ grounding, className }: Props) {
  const text = groundingNotice(pickGrounding(grounding));
  if (!text) return null;
  // 「根拠を確認できない数字・発言があります。」までを太字にする（文そのものは変えない）
  const cut = text.indexOf("。") + 1;
  const lead = cut > 0 ? text.slice(0, cut) : text;
  const rest = cut > 0 ? text.slice(cut) : "";

  return (
    <p className={className ? `${styles.note} ${className}` : styles.note} role="note">
      ※<strong className={styles.lead}>{lead}</strong>
      {rest}
    </p>
  );
}
