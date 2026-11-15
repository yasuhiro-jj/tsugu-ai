// 「自分に合う学びを選ぶ」ための入口の質問と、提案の決め方（決まった処理。AI は使わない）。
// 質問は Notion「06｜TSUGU AI 学習プログラム」の「最初の入口」のとおり。
// - 答えで人を評価・格付けしない。提案は「候補」で、本人が自由に変えられる
// - 答えはどこにも保存しない（画面の中だけで使う）
// - 急ぎの期限や相談があるときは、学びを待たずに専門家へ相談するよう伝える

import { COURSES, type CourseId } from "./courses";

export type GuideQuestion = {
  key: "role" | "concern" | "successor" | "start" | "urgent";
  question: string;
  choices: { key: string; label: string }[];
};

export const GUIDE_QUESTIONS: readonly GuideQuestion[] = [
  {
    key: "role",
    question: "今の立場は？",
    choices: [
      { key: "owner", label: "経営者" },
      { key: "candidate", label: "承継を考える人" },
      { key: "successor", label: "引き継いだ人" },
      { key: "other", label: "その他" },
    ],
  },
  {
    key: "concern",
    question: "今、いちばん気になることは？",
    choices: [
      { key: "future", label: "店の将来" },
      { key: "money", label: "お金" },
      { key: "people", label: "人・現場" },
      { key: "handover", label: "引き継ぎ" },
      { key: "unsure", label: "まだ分からない" },
    ],
  },
  {
    key: "successor",
    question: "誰かに引き継ぐことは決まっていますか？",
    choices: [
      { key: "none", label: "決まっていない" },
      { key: "considering", label: "検討中" },
      { key: "decided", label: "決まっている" },
      { key: "no_answer", label: "答えない" },
    ],
  },
  {
    key: "start",
    question: "何から始めたいですか？",
    choices: [
      { key: "read", label: "短い説明" },
      { key: "talk", label: "質問に答える" },
      { key: "report", label: "相談資料を作る" },
      { key: "choose", label: "自分で選ぶ" },
    ],
  },
  {
    key: "urgent",
    question: "今すぐ確認が必要な期限や、相談したいことはありますか？",
    choices: [
      { key: "yes", label: "ある" },
      { key: "no", label: "ない" },
      { key: "unsure", label: "分からない" },
    ],
  },
];

export type GuideAnswers = Partial<Record<GuideQuestion["key"], string>>;

export type GuideSuggestion = {
  /** 最初に伝える注意（急ぎのとき、まだ用意のない講座のとき） */
  notices: string[];
  /** 面談から始めることを勧めるか */
  interviewFirst: boolean;
  /** 候補の講座（順番は「読みやすい順」で、優劣ではない） */
  courses: CourseId[];
};

const ALL: CourseId[] = COURSES.map((c) => c.id);

export function suggestLearning(answers: GuideAnswers): GuideSuggestion {
  const notices: string[] = [];
  const picked: CourseId[] = [];
  const add = (...ids: CourseId[]) => {
    for (const id of ids) if (!picked.includes(id)) picked.push(id);
  };

  // 急ぎのとき：学びを待たずに、専門家へ
  if (answers.urgent === "yes") {
    notices.push(
      "期限が近いことや、急ぎで相談したいことがあるときは、講座を終えるのを待たずに、金融機関・専門家・支援機関へ相談してください。",
    );
  }
  // いまある講座は、経営者の方向け
  if (answers.role === "candidate" || answers.role === "successor") {
    notices.push("承継を考える方・引き継いだ方向けの講座は、まだ用意できていません。いまある講座は、経営者の方向けです。");
  }
  if (answers.concern === "money" || answers.concern === "people") {
    notices.push("お金や現場についての講座は、専門家の確認が済んでから加える予定です。いまは、相談の準備に役立つ講座をご案内します。");
  }

  const interviewFirst = answers.start === "talk" || answers.start === "report";

  if (answers.start === "choose") {
    add(...ALL);
  } else {
    if (answers.start === "report") add("prepare");
    if (answers.successor === "none" || answers.successor === "considering") add("options");
    switch (answers.concern) {
      case "future":
        add("values", "options");
        break;
      case "money":
        add("prepare");
        break;
      case "people":
        add("values");
        break;
      case "handover":
        add("options", "prepare");
        break;
      case "unsure":
        add("values");
        break;
    }
    // 何も決まらなかったときは、最初の講座から
    if (picked.length === 0) add("values");
    // どなたにも：AI の使い方
    add("ai-safety");
  }
  return { notices, interviewFirst, courses: picked };
}
