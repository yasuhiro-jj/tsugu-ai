// 2.0 の講座（最初の4つ）。
// 内容は Notion「06｜TSUGU AI 学習プログラム」の講座 01・02・03・14 の教材案のとおり。AI が作る文章ではない。
// 教材は、専門家のレビュー前の下書き（Notion にもそう書かれている）。画面にもその旨を出す。
// 確認問題の答え合わせは、決まった処理で行う（AI は使わない）。

export type CourseId = "values" | "options" | "prepare" | "ai-safety";

export type CourseField = { key: string; label: string };

export type CourseDef = {
  id: CourseId;
  /** 学習プログラムの中での番号 */
  no: string;
  title: string;
  goal: string;
  minutes: string;
  /** 読む教材（段落ごと） */
  body: string[];
  /** 架空の例 */
  example: string;
  quiz: {
    question: string;
    /** 正しい答え。4講座とも「はい／いいえ」で答える形 */
    correct: "yes" | "no";
    explanation: string;
  };
  workTitle: string;
  /** 自分のメモ（自由に書く欄） */
  fields: CourseField[];
  /** 確認リスト（はい／いいえ／未確認で答える欄） */
  checks: CourseField[];
};

export const COURSES: readonly CourseDef[] = [
  {
    id: "values",
    no: "01",
    title: "店の未来と守りたいこと",
    goal: "店に残したい価値と、変えてもよいことを、自分の言葉で整理します。",
    minutes: "5〜10分",
    body: [
      "店を引き継ぐと聞くと、建物や設備、売上のことを思い浮かべるかもしれません。でも、常連客への声かけ、長年働く人との信頼、味を決めるときの考え方も、店を形づくる大切な要素です。",
      "一方、すべてを今のまま残す必要はありません。たとえば「お客様を大切にする」という思いは守りながら、注文方法や営業時間は次の人と考えることもできます。「守りたい」「変えてもよい」「まだ決められない」に分けると、考えを伝えやすくなります。",
    ],
    example:
      "和食店の社長は、常連客と会話する時間を大切にしています。一方、紙の予約台帳は使いやすい方法に変えてもよいと考えています。「守りたい＝お客様との関係」「変えてもよい＝予約方法」と書いてみました。まだ決められないことは空欄でも構いません。",
    quiz: {
      question: "店の価値を引き継ぐために、すべての業務手順を変えてはいけない？",
      correct: "no",
      explanation: "大切な目的や思いを確認した上で、方法を変える選択もあります。何を残すかは本人たちが決めます。",
    },
    workTitle: "実践ワーク",
    fields: [
      { key: "kept", label: "長年大切にしてきたこと" },
      { key: "episode", label: "その思いが表れた出来事" },
      { key: "change", label: "変えてもよいこと" },
      { key: "undecided", label: "まだ決められないこと" },
    ],
    checks: [],
  },
  {
    id: "options",
    no: "02",
    title: "後継者がいない場合の選択肢",
    goal: "後継者がいない場合の選択肢を知り、自分が気になることを整理します。",
    minutes: "5〜10分",
    body: [
      "後継者が決まっていなくても、今日すべてを決める必要はありません。考えられる相手には、親族、従業員、店外の第三者がいます。事業を続ける以外に、廃業や、結論を保留して情報を集めるという選択もあります。",
      "「誰に引き継ぐか」と「どのような方法で引き継ぐか」は別の問いです。第三者への承継ではM&Aが選択肢となる場合もありますが、契約や費用、情報の取扱いは案件ごとに異なります。誰が相手でも、従業員、借入、保証、店舗の賃貸借などは資料を確認し、必要に応じて専門家へ相談します。",
    ],
    example:
      "社長は家族に継ぐ予定がなく、従業員の雇用が心配です。まず「従業員に意思があるかは未確認」「第三者に相談する場合の守秘と費用を知りたい」とメモしました。この段階で売却先を決める必要はありません。",
    quiz: {
      question: "後継者がいない場合、AIが最適な売却先を決めるべきでしょうか？",
      correct: "no",
      explanation: "本人が選択肢と不明点を整理し、必要な専門家と確認して判断します。保留も選べます。",
    },
    workTitle: "実践ワーク",
    fields: [
      { key: "interest", label: "気になる選択肢" },
      { key: "keep", label: "守りたいこと" },
      { key: "unknown", label: "分からないこと" },
      { key: "ask", label: "相談先への質問" },
    ],
    checks: [],
  },
  {
    id: "prepare",
    no: "03",
    title: "相談前の情報整理",
    goal: "相談の目的と質問をまとめ、相手に渡す内容を自分で選べるようにします。",
    minutes: "5〜10分",
    body: [
      "相談の前に必要なのは、完璧な資料ではありません。「何を相談したいか」「何が分かっていて、何が分からないか」を整理するだけでも、会話の出発点になります。",
      "情報には、本人の希望、資料で確認した事実、まだ調べていないことがあります。この3つを混ぜないようにしましょう。たとえば「従業員の雇用を大切にしたい」は希望、「賃貸借契約の更新日」は契約書で確認する事実、「引き継ぎ時に家主の承諾が必要か」は未確認の質問です。",
      "相談先に見せる情報は、相手と目的に応じて本人が選びます。パスワードや不要な個人情報を資料に書かず、不明な内容は推測で埋めません。資料を渡した後、相手が保存・印刷したコピーは回収できない場合があります。",
    ],
    example:
      "社長は「従業員の雇用を大切にしたい」と書き、契約条件は未確認としました。相談用には店の概要と質問だけを選び、個別面談の私的な話は含めませんでした。",
    quiz: {
      question: "分からない借入残高は、空欄を埋めるために推測して書く？",
      correct: "no",
      explanation: "「未確認」とし、返済予定表などの資料と確認先を記します。",
    },
    workTitle: "実践ワーク：相談メモ",
    fields: [
      { key: "topic", label: "相談したいこと" },
      { key: "wish", label: "本人の希望" },
      { key: "confirmed", label: "資料で確認したこと・確認日" },
      { key: "unconfirmed", label: "未確認のこと" },
      { key: "share", label: "相談先に渡す項目／渡さない項目" },
      { key: "questions", label: "当日聞きたい質問" },
    ],
    checks: [],
  },
  {
    id: "ai-safety",
    no: "14",
    title: "AIを安全に使う",
    goal: "AIに質問する前と、回答や資料を使う前に確認することを身につけます。",
    minutes: "5〜10分",
    body: [
      "AIは難しい言葉の説明や、考えを整理する手助けができます。しかし、もっともらしく間違うことがあります。金額、契約、法令、衛生、税務などは、資料や公的情報を確認し、必要に応じて専門家に相談します。",
      "入力する前に、利用目的、保存期間、外部AIへの送信先や利用条件を確認しましょう。パスワード、認証コード、必要のない個人情報は入力しません。会社情報を扱う場合は、安全条件が満たされた環境かも確認します。架空データで練習することもできます。",
      "AIが相談資料を作っても、自動的に誰かに送ってよいわけではありません。本人が共有先と項目を選び、未確認や非公開の情報が混ざっていないか確認します。選ばれなかった情報を、外部向け資料に含めないことが大切です。",
    ],
    example:
      "社長は「借入について何を確認すればよいか」と質問しました。AIの回答をそのまま契約判断に使わず、返済予定表と金融機関に確認する質問の下書きとして使いました。",
    quiz: {
      question: "AIが「借入は問題ありません」と答えたら、そのまま事実とする？",
      correct: "no",
      explanation: "そのまま事実とはしません。根拠資料や時点を確認し、必要に応じ金融機関・専門家に相談します。",
    },
    workTitle: "実践ワーク：確認リスト",
    fields: [],
    checks: [
      { key: "purpose", label: "入力してよい内容か、送信先と目的を確認した" },
      { key: "secrets", label: "パスワードや不要な個人情報を除いた" },
      { key: "basis", label: "回答の根拠と最新性を確認した" },
      { key: "share", label: "共有先と資料の内容を自分で確認した" },
    ],
  },
];

export const COURSE_IDS: readonly CourseId[] = COURSES.map((c) => c.id);

export function isCourseId(value: unknown): value is CourseId {
  return typeof value === "string" && (COURSE_IDS as readonly string[]).includes(value);
}

export function courseDef(id: CourseId): CourseDef {
  return COURSES.find((c) => c.id === id)!;
}

export const CHECK_VALUES = [
  { key: "yes", label: "はい" },
  { key: "no", label: "いいえ" },
  { key: "unknown", label: "未確認" },
] as const;

export const MAX_NOTE = 300;

/** 確認問題の答え合わせ（決まった処理） */
export function gradeQuiz(id: CourseId, answer: "yes" | "no"): boolean {
  return courseDef(id).quiz.correct === answer;
}
