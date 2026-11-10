// 2.0 試作のモック（偽の差し替え部品）。外部の AI は呼ばない。
// 面談の返事は固定の聞き返し、資料は「渡された入力だけ」を並べ直す決まった処理。

import { REPORT_DOCUMENTS, REPORT_NOTES, themeDef, THEMES } from "./content";
import type { InterviewAi, ReportGenerator } from "./types";

/** 1テーマにつき聞き返しは1回だけ。内容を言い換えたり、足したりしない */
export const mockInterviewAi: InterviewAi = async (req) => {
  if (!req.followupAsked) {
    return { reply: `ありがとうございます。${themeDef(req.theme).followup}`, action: "followup" };
  }
  return { reply: "ありがとうございます。", action: "next_theme" };
};

/**
 * 相談資料の下書きを作る。
 * 使うのは引数の input だけ（保存してある面談の内容には触れない）。
 * そのため、本人が選ばなかった項目はここに届かず、資料にも入らない。
 */
export const mockReportGenerator: ReportGenerator = async (input) => {
  const byKind = (kind: string) => input.items.filter((i) => i.kind === kind).map((i) => i.text);
  const option = input.items.find((i) => i.kind === "option");

  const themesIncluded = new Set(input.items.map((i) => i.theme).filter((t) => t !== null));
  const questions: string[] = [];
  for (const t of THEMES) {
    if (themesIncluded.has(t.key) && t.reportQuestion) questions.push(t.reportQuestion);
  }
  if (option) questions.push("関心のある選択肢それぞれについて、初めに確認することは何ですか？");
  questions.push("事業の引き継ぎについて、ほかにどのような選択肢と相談先がありますか？");

  return {
    consultantLabel: input.consultantLabel,
    purpose: "飲食店の今後と引き継ぎの準備について、選択肢と進め方を相談したい。",
    statements: byKind("statement"),
    aiNotes: byKind("ai_note"),
    optionsNote: option ? option.text : null,
    unconfirmed: byKind("unconfirmed"),
    questions,
    documents: [...REPORT_DOCUMENTS],
    notes: [...REPORT_NOTES],
  };
};
