import "server-only";

// 学習講座（Notion「学習講座コンテンツ（3講座）下書き v1」を原文のままデータ化。AI は講座を作らない）。
// - 正解はサーバーだけが持つ。getCourse() / getCourses() が返す Course 型には正解を含めない
// - 採点はルールベース（5問中4問以上正解で「完了」、3問以下は「復習をおすすめ」）
// - 架空の会社（食事処 つぐみ）の数字のみ

import type { Course, CourseId, CourseProgressStatus } from "./plan-types";
import { ServiceError } from "./errors";

type QuestionData = Course["questions"][number] & { answer: string };
type CourseData = Omit<Course, "questions"> & { questions: QuestionData[] };

const abc = (...texts: string[]) =>
  texts.map((text, i) => ({ key: String.fromCharCode(65 + i), text }));

const COURSE_DATA: readonly CourseData[] = [
  {
    id: "cashflow",
    title: "1. 資金繰りの基本",
    level: "Lv1〜",
    goal: "「利益」と「手元のお金」の違いが分かり、返済予定表を先代と一緒に読める。",
    linkedGap: "資金繰りの認識差（返済・手元資金）",
    articles: [
      {
        no: 1,
        title: "利益とお金は同じではない",
        body: [
          "決算書の「利益」と、通帳の「お金」は一致しません。",
          "理由①：減価償却費（設備の購入代を何年かに分けて費用にしたもの）は費用として利益を減らしますが、その年にお金は出ていきません。",
          "理由②：借入の元本の返済は費用ではないので利益は減りませんが、お金は出ていきます。",
          "つぐみの当期：純利益 ▲272万円 ＋ 減価償却費 120万円 − 元本の返済 240万円 ＝ お金は約392万円減少（手元資金 1,200万円 → 808万円）。",
          "ポイント：「黒字かどうか」だけでなく「お金が増えたか減ったか」を見る。",
        ],
      },
      {
        no: 2,
        title: "返済予定表の見方",
        body: [
          "返済予定表は、銀行から借りたお金を「いつ・いくら」返すかの一覧です。",
          "見る場所は4つ：①借入の残り（残高）②毎月の返済額 ③利息 ④返済が終わる時期。",
          "つぐみ：残高 2,360万円、元本の返済 月20万円（年240万円）。このペースだと返済は約10年続く計算です。",
          "借入が複数ある場合は、1本ずつ予定表があります。全部そろっているか確認しましょう。",
          "返済条件の見直しが必要かどうかは、AIではなく銀行と相談して決めます。",
        ],
      },
      {
        no: 3,
        title: "手元のお金は何か月分あるか",
        body: [
          "「手元資金が月の売上の何か月分あるか」は、お店の体力を見る目安です。",
          "計算：手元資金 ÷ 月の売上（年間売上 ÷ 12）。",
          "つぐみ：808万円 ÷ 450万円（5,400万円 ÷ 12）＝ 約1.8か月分。前期は約2.6か月分でした。",
          "減り方が続くと、設備の故障や売上の落ち込みに耐えにくくなります。",
          "次の一歩：先代と一緒に、今後6か月の入金と支払いを並べた「資金繰り表」を見てみましょう。",
        ],
      },
    ],
    questions: [
      {
        no: 1,
        question: "つぐみの当期、純利益 ▲272万円、減価償却費 120万円、元本の返済 240万円。お金はいくら減った？",
        choices: abc("272万円", "392万円", "152万円"),
        answer: "B",
        articleNo: 1,
      },
      {
        no: 2,
        question: "借入の元本の返済は、損益計算書の「費用」になる？",
        choices: abc("なる", "ならない"),
        answer: "B",
        articleNo: 1,
      },
      {
        no: 3,
        question: "毎月20万円の元本返済。1年間ではいくら？",
        choices: abc("200万円", "240万円", "20万円"),
        answer: "B",
        articleNo: 2,
      },
      {
        no: 4,
        question: "返済予定表で確認しなくてよいものは？",
        choices: abc("残高", "毎月の返済額", "返済が終わる時期", "メニューの原価"),
        answer: "D",
        articleNo: 2,
      },
      {
        no: 5,
        question: "月の売上 450万円、手元資金 808万円。何か月分？",
        choices: abc("約1.8か月", "約3か月", "約0.5か月"),
        answer: "A",
        articleNo: 3,
      },
    ],
  },
  {
    id: "costrate",
    title: "2. 原価率と棚卸しの基本",
    level: "Lv1〜",
    goal: "原価率を計算でき、棚卸しをしないと本当の原価率が分からない理由を説明できる。",
    linkedGap: "原価の見え方の認識差（「頭に入っている」）",
    articles: [
      {
        no: 1,
        title: "原価率とは",
        body: [
          "原価率は「売上のうち、材料費がどれくらいか」の割合です。",
          "計算：売上原価 ÷ 売上 × 100。",
          "つぐみの当期：2,268万円 ÷ 5,400万円 ＝ 42%（前期 40%）。",
          "原価率が2ポイント上がると、つぐみの規模では年約108万円、利益が減ります。",
        ],
      },
      {
        no: 2,
        title: "棚卸しをしないと原価が分からない理由",
        body: [
          "売上原価は「仕入れた金額」ではなく、「実際に使った材料の金額」です。",
          "計算：月初の在庫 ＋ その月の仕入れ − 月末の在庫 ＝ その月の売上原価。",
          "棚卸し（月末に在庫を数えること）をしないと、まとめ買いした月は原価が高く、在庫を使った月は低く見えます。",
          "つぐみでは、ある月は30%台、別の月は50%近くに見えて、本当の原価率がつかめていません。",
          "在庫の金額は、売る値段ではなく仕入れた値段で数えます。",
        ],
      },
      {
        no: 3,
        title: "まずは主な在庫だけでよい",
        body: [
          "最初から全部を数える必要はありません。米・魚・肉・冷凍品・お酒など、金額の大きいものから始めます。",
          "毎月、同じ日・同じ項目・同じやり方で続けることが一番大事です。",
          "慣れてきたら、メニューごとの原価（1食あたりの材料費）も出してみましょう。例：お魚ランチ 780円、材料費 320円なら原価率 約41%。",
          "先代の「頭の中の原価」と、棚卸しの数字を並べて話し合うと、引き継ぎが進みます。",
        ],
      },
    ],
    questions: [
      {
        no: 1,
        question: "売上 5,400万円、売上原価 2,268万円。原価率は？",
        choices: abc("38%", "42%", "46%"),
        answer: "B",
        articleNo: 1,
      },
      {
        no: 2,
        question: "月初の在庫 50万円、仕入れ 180万円、月末の在庫 40万円。その月の売上原価は？",
        choices: abc("180万円", "190万円", "170万円"),
        answer: "B",
        articleNo: 2,
      },
      {
        no: 3,
        question: "棚卸しをしていない店が、月末にまとめ買いをした。その月の原価率はどう見える？",
        choices: abc("実際より高く見える", "実際より低く見える", "変わらない"),
        answer: "A",
        articleNo: 2,
      },
      {
        no: 4,
        question: "棚卸しで在庫の金額を数えるときの値段は？",
        choices: abc("売る値段", "仕入れた値段"),
        answer: "B",
        articleNo: 2,
      },
      {
        no: 5,
        question: "棚卸しを始めるとき、一番大事なことは？",
        choices: abc("初月から全品を正確に数える", "同じやり方で毎月続ける", "年に1回まとめて数える"),
        answer: "B",
        articleNo: 3,
      },
    ],
  },
  {
    id: "trialbalance",
    title: "3. 試算表の見方",
    level: "Lv1〜",
    goal: "売上から利益までの流れを、つぐみの数字で説明できる。",
    linkedGap: "経営状態を数字で説明する力",
    articles: [
      {
        no: 1,
        title: "試算表はお店の「月ごとの成績表」",
        body: [
          "試算表は、税理士や経理が毎月まとめる数字の一覧です。決算書の「途中経過」と考えてください。",
          "上から順に：売上 → 売上原価 → 粗利（売上 − 原価）→ 人件費・その他の経費 → 営業利益（本業のもうけ）。",
          "つぐみの当期：売上 5,400 − 原価 2,268 ＝ 粗利 3,132 − 人件費 1,998 − その他 1,370 ＝ 営業利益 ▲236（万円）。",
        ],
      },
      {
        no: 2,
        title: "飲食店で特に見る「FL比率」",
        body: [
          "F（Food＝材料費）と L（Labor＝人件費）を足して、売上で割ったものです。",
          "つぐみ：原価率 42% ＋ 人件費率 37% ＝ FL比率 79%（前期 75%）。",
          "一般に飲食店では60%前後が目安と言われることが多く、つぐみは高めです。",
          "FL比率が高いと、家賃や光熱費を払うと利益がほとんど残りません。",
        ],
      },
      {
        no: 3,
        title: "前の年と比べてみる",
        body: [
          "数字は1年分だけでなく、前の年と比べると変化が分かります。",
          "つぐみ：売上は 5,600 → 5,400 で ▲200万円（▲3.6%）。一方、営業利益は 100 → ▲236 で ▲336万円。",
          "売上の減り方より利益の減り方が大きいのは、原価率と人件費率が上がったためです。",
          "営業利益から借入の利息などを引いたものが経常利益です（つぐみ：▲236 − 34 ＝ ▲270）。",
        ],
      },
    ],
    questions: [
      {
        no: 1,
        question: "売上 5,400万円、売上原価 2,268万円。粗利は？",
        choices: abc("3,132万円", "2,268万円", "5,400万円"),
        answer: "A",
        articleNo: 1,
      },
      {
        no: 2,
        question: "粗利 3,132万円、人件費 1,998万円、その他の経費 1,370万円。営業利益は？",
        choices: abc("1,134万円", "▲236万円", "3,132万円"),
        answer: "B",
        articleNo: 1,
      },
      {
        no: 3,
        question: "人件費 1,998万円、売上 5,400万円。人件費率は？",
        choices: abc("32%", "37%", "42%"),
        answer: "B",
        articleNo: 2,
      },
      {
        no: 4,
        question: "原価率 42%、人件費率 37%。FL比率は？",
        choices: abc("79%", "5%", "42%"),
        answer: "A",
        articleNo: 2,
      },
      {
        no: 5,
        question: "営業利益から借入の利息などを引いたものは？",
        choices: abc("粗利", "経常利益", "売上原価"),
        answer: "B",
        articleNo: 3,
      },
    ],
  },
];

export const COURSE_IDS: readonly CourseId[] = COURSE_DATA.map((c) => c.id);

/**
 * 講座ごとの「つながる認識差のキーワード」（学習プランの並べ替えに使う。lib/learning.ts）。
 * 根拠：Notion「学習講座コンテンツ v1」講座一覧の「診断とのつながり」列
 * - 1. 資金繰りの基本 ↔ 資金繰りの認識差（返済・手元資金）
 * - 2. 原価率と棚卸しの基本 ↔ 原価の見え方の認識差
 * - 3. 試算表の見方 ↔ 経営状態を数字で説明する力
 * 認識差の theme は AI が書く自由な文字列なので、theme か point にキーワードを含むかで判定する。
 */
export const COURSE_GAP_KEYWORDS: Readonly<Record<CourseId, readonly string[]>> = {
  cashflow: ["資金繰り", "返済", "借入", "手元"],
  costrate: ["原価", "棚卸", "仕入"],
  trialbalance: ["試算表", "もうけ", "利益", "数字"],
};

export function isCourseId(v: unknown): v is CourseId {
  return typeof v === "string" && (COURSE_IDS as readonly string[]).includes(v);
}

/** 画面へ渡してよい形（正解を含めない）。 */
function toPublic(c: CourseData): Course {
  return {
    id: c.id,
    title: c.title,
    level: c.level,
    goal: c.goal,
    linkedGap: c.linkedGap,
    articles: c.articles.map((a) => ({ no: a.no, title: a.title, body: [...a.body] })),
    questions: c.questions.map((q) => ({
      no: q.no,
      question: q.question,
      choices: q.choices.map((ch) => ({ key: ch.key, text: ch.text })),
      articleNo: q.articleNo,
    })),
  };
}

export function getCourses(): Course[] {
  return COURSE_DATA.map(toPublic);
}

export function getCourse(id: CourseId): Course | null {
  const c = COURSE_DATA.find((x) => x.id === id);
  return c ? toPublic(c) : null;
}

function courseData(id: CourseId): CourseData {
  const c = COURSE_DATA.find((x) => x.id === id);
  if (!c) throw new ServiceError(400, "講座の指定が正しくありません");
  return c;
}

export const PASS_LINE = 4; // 5問中4問以上で完了

export type GradeResult = {
  score: number;
  correct: Record<number, boolean>;
  wrongArticleNos: number[];
  status: Extract<CourseProgressStatus, "完了" | "復習をおすすめ">;
};

/** answers を検証する。全問に、選択肢の中の key で答えていること。 */
export function validateAnswers(courseId: CourseId, value: unknown): Record<number, string> {
  const c = courseData(courseId);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ServiceError(400, "回答の形式が正しくありません");
  }
  const obj = value as Record<string, unknown>;
  const out: Record<number, string> = {};
  for (const q of c.questions) {
    const a = obj[String(q.no)];
    if (typeof a !== "string" || !q.choices.some((ch) => ch.key === a)) {
      throw new ServiceError(400, "すべての問題に答えてください");
    }
    out[q.no] = a;
  }
  return out;
}

/** 採点（ルールベース）。 */
export function gradeQuiz(courseId: CourseId, answers: Record<number, string>): GradeResult {
  const c = courseData(courseId);
  const correct: Record<number, boolean> = {};
  const wrong = new Set<number>();
  let score = 0;
  for (const q of c.questions) {
    const ok = answers[q.no] === q.answer;
    correct[q.no] = ok;
    if (ok) score++;
    else wrong.add(q.articleNo);
  }
  return {
    score,
    correct,
    wrongArticleNos: [...wrong].sort((a, b) => a - b),
    status: score >= PASS_LINE ? "完了" : "復習をおすすめ",
  };
}

/** 解説用（サーバー内だけで使う）：問題・正解・対応する記事。 */
export function getQuestionForExplain(courseId: CourseId, questionNo: unknown) {
  const c = courseData(courseId);
  const q = c.questions.find((x) => x.no === questionNo);
  if (!q) throw new ServiceError(400, "問題の指定が正しくありません");
  const article = c.articles.find((a) => a.no === q.articleNo)!;
  return { course: c, question: q, article };
}
