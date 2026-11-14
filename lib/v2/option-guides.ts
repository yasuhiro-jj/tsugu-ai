// 選択肢ごとに、本人の準備リストの状況に応じた確認事項を組み立てる（決まった処理。AI は使わない）。
// どの選択肢が合うかは判断しない。順位も付けない。確かめていない分野があれば「判断は保留」と示すだけ。

import { OPTIONS, PREP_AREAS, PREP_NOT_YET, PREP_STATUSES } from "./content";
import type { OptionKey, PrepKey, Session } from "./types";

/** それぞれの選択肢を考えるときに関係する、準備リストの分野 */
const RELATED: Record<OptionKey, readonly PrepKey[]> = {
  family: ["loans", "contracts", "finance"],
  employee: ["staff", "loans", "craft"],
  third_party: ["finance", "contracts", "partners", "permits"],
  closure: ["loans", "contracts", "staff"],
  undecided: ["advisors"],
};

export type OptionGuide = {
  key: OptionKey;
  label: string;
  /** どの店にも共通の確認事項 */
  checks: string[];
  /** 本人の準備リストで、まだ「確認済み」になっていない関係分野 */
  pending: { key: PrepKey; label: string; state: string }[];
  /** 確かめていない分野があるため、この選択肢が合うかの判断は保留 */
  hold: boolean;
};

export function buildOptionGuides(session: Pick<Session, "prep">): OptionGuide[] {
  return OPTIONS.map((option) => {
    const pending = RELATED[option.key].flatMap((key) => {
      const entry = session.prep?.[key];
      if (entry?.status === "confirmed") return [];
      const state = entry?.status ? PREP_STATUSES.find((s) => s.key === entry.status)!.label : PREP_NOT_YET;
      return [{ key, label: PREP_AREAS.find((a) => a.key === key)!.label, state }];
    });
    return { key: option.key, label: option.label, checks: [...option.checks], pending, hold: pending.length > 0 };
  });
}
