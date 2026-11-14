// 「次の一歩」の候補を組み立てる（決まった処理。AI は使わない）。
// もとにするのは、本人が準備リストで選んだ状態・書いた言葉と、選んだ相談先だけ。
// ここで作る一覧は本人用のメモで、相談資料には入れない。

import { CONSULTANTS, PREP_AREAS } from "./content";
import type { Session, StepChoice, StepKey } from "./types";

export type NextStep = StepChoice & {
  key: StepKey;
  /** 分野の名前（相談先への連絡は「相談先」） */
  label: string;
  /** やることの文章 */
  text: string;
};

const EMPTY: StepChoice = { decision: null, who: "", when: null };

export function buildNextSteps(session: Pick<Session, "prep" | "consultant" | "steps">): NextStep[] {
  const steps: NextStep[] = [];
  const choice = (key: StepKey): StepChoice => ({ ...EMPTY, ...(session.steps?.[key] ?? {}) });

  // 相談先を選んでいて、まだ決めていない以外のとき：連絡して日を決める
  const consultant = CONSULTANTS.find((c) => c.key === session.consultant);
  if (consultant && consultant.key !== "undecided") {
    steps.push({
      key: "consult",
      label: "相談先",
      text: `${consultant.label}に連絡して、相談の日を決める`,
      ...choice("consult"),
    });
  }

  // 準備リストで「要確認」「不明」にした分野と、「次に確認すること」を書いた分野
  for (const area of PREP_AREAS) {
    const entry = session.prep?.[area.key];
    if (!entry) continue;
    const open = entry.status === "todo" || entry.status === "unknown";
    if (!open && !entry.next) continue;
    steps.push({
      key: area.key,
      label: area.label,
      // 本人が書いた言葉があればそのまま。なければ「確かめる」という行動だけを示す（中身は足さない）
      text: entry.next || `${area.label}の状況を確かめる`,
      ...choice(area.key),
    });
  }
  return steps;
}
