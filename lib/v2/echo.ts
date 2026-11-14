// 本人の言葉を、そのまま短く引用して受け止める一文を作る（決まった処理。AI は使わない）。
// 引用を AI に任せると、別の発言を引用されたときに「消したのに残る」ことが起こり得るため、
// 必ずサーバー側で、今回の回答だけから作る。

import { QUOTE_MAX } from "./content";

/** 言い換えや要約はしない。長いときは途中で切り、「…」を付ける */
export function echo(answer: string): string {
  const oneLine = answer.replace(/\s+/g, " ").trim().replace(/[。．.！!？?]+$/u, "");
  const chars = Array.from(oneLine);
  const short = chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join("")}…` : oneLine;
  return `「${short}」とお話しくださったのですね。`;
}

const MAX_QUESTION = 300;
const OVERLAP = 8;

/**
 * AI が返した聞き返しの文を、そのまま使ってよいか確かめる。
 * 長すぎる、または本人の回答と同じ言葉（8文字以上）を含むときは使わず、決まった質問に戻す。
 * 本人の言葉が AI の文に混ざると、その発言を消しても記録に残ってしまうため。
 */
export function safeQuestion(reply: string, answers: readonly string[], fallback: string): string {
  const text = reply.trim();
  if (text === "" || text.length > MAX_QUESTION) return fallback;
  for (const answer of answers) {
    const chars = Array.from(answer);
    for (let i = 0; i + OVERLAP <= chars.length; i++) {
      if (text.includes(chars.slice(i, i + OVERLAP).join(""))) return fallback;
    }
  }
  return text;
}
