// 2.0 試作の固定の文言（面談の質問・準備リスト・選択肢・相談先）。
// 面談のテーマと最初の質問は Notion「05｜TSUGU AI 2.0」の「面談テーマと質問例」の表のとおり。
// 聞き返しは Notion「02｜一人で始めるAI面談」の表から取っている。AI が作る文章ではない。

import type { ConsultantKey, OptionKey, PrepKey, PrepStatus, ThemeKey } from "./types";

export type ThemeDef = {
  key: ThemeKey;
  label: string;
  question: string;
  followup: string;
  /** AI の整理案（可能性として書く。断定しない） */
  aiNote: string;
  /** このテーマの項目を資料に載せたときに添える質問 */
  reportQuestion: string | null;
};

export const THEMES: readonly ThemeDef[] = [
  {
    key: "legacy",
    label: "店への思い",
    question: "お店を続けてきて、次の人に残したいものは何ですか？",
    followup: "その思いが表れた出来事を教えていただけますか？",
    aiNote: "お店で残したいことを、引き継ぎの相談で伝えたい可能性があります。",
    reportQuestion: "お店で大切にしてきたことを残すには、どのような引き継ぎ方が考えられますか？",
  },
  {
    key: "future",
    label: "承継への意向",
    question: "いつ頃から、お店の今後を考え始めたいですか？",
    // 仕様の「整理する内容：希望時期、迷い、急ぐ事情」から。最初の質問と重ならないようにしている
    followup: "急ぐ事情や、迷っていることはありますか？",
    aiNote: "考え始める時期や進め方の希望について、相談したい可能性があります。",
    reportQuestion: "考え始める時期や進め方について、目安はありますか？",
  },
  {
    key: "staff",
    label: "従業員",
    question: "従業員について、今後どんなことを大切にしたいですか？",
    followup: "ご本人たちに伝える時期で、気になることはありますか？",
    aiNote: "従業員の今後について、相談したい可能性があります。",
    reportQuestion: "従業員の雇用について、引き継ぎの前に何を確認すればよいですか？",
  },
  {
    key: "candidate",
    label: "候補者と選択肢",
    question: "ご家族や従業員、店外の方について、今考えていることはありますか？",
    followup: "まだ決まっていなくても大丈夫です。どんな選択肢を知りたいですか？",
    aiNote: "引き継ぐ相手の探し方や選択肢について、相談したい可能性があります。",
    reportQuestion: "引き継ぐ相手が決まっていない場合、どのような探し方や相談先がありますか？",
  },
  {
    key: "work",
    label: "店の仕事と強み",
    question: "社長ご自身しか分からない仕事や判断は何ですか？",
    followup: "最初に誰かと一緒に確認できそうなことは何ですか？",
    aiNote: "ご本人しか分からない仕事の伝え方について、相談したい可能性があります。",
    reportQuestion: "店の仕事や味を次の人へ無理なく伝えるために、どんな準備が考えられますか？",
  },
  {
    key: "money",
    label: "数字・契約",
    question: "借入やお店の契約で、確認しておきたいことはありますか？",
    followup: "確認できる資料や相談できる方はいますか？",
    aiNote: "お金や店舗の契約について、資料を確かめたうえで相談したい可能性があります。",
    reportQuestion: "借入・保証・賃貸契約・許認可について、誰にどの資料を見せて相談すればよいですか？",
  },
  {
    key: "next",
    label: "相談先",
    question: "これまで誰かに相談したことはありますか？",
    followup: "まず誰に、どんなことを相談してみたいですか？",
    aiNote: "これまでの相談先と、次に相談したい相手を整理したい可能性があります。",
    reportQuestion: null,
  },
];

export const THEME_KEYS: readonly ThemeKey[] = THEMES.map((t) => t.key);

export function themeDef(key: ThemeKey): ThemeDef {
  const def = THEMES.find((t) => t.key === key);
  if (!def) throw new Error("unknown theme");
  return def;
}

export const INTRO =
  "結論を急ぐ必要はありません。答えたくないことは飛ばせます。分からないことは「未確認」として残します。";

export type PrepAreaDef = {
  key: PrepKey;
  label: string;
  /** 準備・確認するもの */
  what: string;
  /** 確認先・注意点 */
  note: string;
};

/** 分野別の準備リスト。Notion「05｜TSUGU AI 2.0」の「整理するもの」の表を短くしたもの */
export const PREP_AREAS: readonly PrepAreaDef[] = [
  {
    key: "values",
    label: "店の思いと強み",
    what: "創業の経緯、味や接客のこだわり、守りたいこと・変えてよいこと",
    note: "ご本人の言葉で確かめます。伝える話はご本人が選びます。",
  },
  {
    key: "daily",
    label: "毎日の仕事",
    what: "仕込み、開店・閉店、発注、清掃、会計の流れ。担当と、不在のときの代わり",
    note: "現場の担当の方と確かめます。衛生に関わる手順は、必要に応じて保健所に確認します。",
  },
  {
    key: "craft",
    label: "技術・判断のコツ",
    what: "看板商品の作り方、仕入れや品質の見きわめ、経験から得た注意点",
    note: "見る、一緒にやる、少し任せる、振り返る、の順で。お互いの合意が前提です。",
  },
  {
    key: "finance",
    label: "お金と経営の状況",
    what: "決算書・確定申告書、売上と原価、入出金の予定、未払い",
    note: "いつの資料かを控えます。税理士などと照らし合わせ、資料がなければ未確認とします。",
  },
  {
    key: "loans",
    label: "借入・保証",
    what: "返済予定表、借入の残り、返済額と期限、担保、経営者の保証",
    note: "金融機関や専門家に確認します。保証や借入の引き継ぎは、AIでは判断できません。",
  },
  {
    key: "contracts",
    label: "店舗・設備・契約",
    what: "賃貸借、リース、保守、仕入れの契約書。設備の状態、更新日と期限",
    note: "契約者・条件・引き継ぐときの手続きを、相手先に確認します。",
  },
  {
    key: "staff",
    label: "従業員",
    what: "担当している仕事、雇用条件の確認先、給与や勤怠の引き継ぎ",
    note: "個人の情報は必要な分だけにします。伝える時期や条件は、社労士などに確認します。",
  },
  {
    key: "partners",
    label: "取引先・お客様",
    what: "おもな仕入先、発注の方法、支払いの条件、地域やお客様との関係",
    note: "伝える必要と範囲を確かめます。お客様の情報はむやみに渡しません。",
  },
  {
    key: "permits",
    label: "許認可・衛生",
    what: "営業許可に関する資料、衛生管理の計画と記録、更新や手続き",
    note: "営業の形や引き継ぎ方によって変わります。保健所や行政に確認します。",
  },
  {
    key: "systems",
    label: "名前・権利・システム",
    what: "店名・ロゴ、ウェブサイト、SNS、レジや予約の仕組み、契約先と管理者",
    note: "パスワードや認証コードは、ここにも資料にも書きません。別の安全な方法で渡します。",
  },
  {
    key: "advisors",
    label: "相談先と残っている課題",
    what: "銀行・税理士・社労士・弁護士などへの質問、まだ解決していないこと、確認の期限",
    note: "都合の悪いことや未確認のことも隠さず整理します。確認済みと推測を分けます。",
  },
];

export const PREP_KEYS: readonly PrepKey[] = PREP_AREAS.map((a) => a.key);

export const PREP_STATUSES: readonly { key: PrepStatus; label: string }[] = [
  { key: "confirmed", label: "確認済み" },
  { key: "todo", label: "要確認" },
  { key: "unknown", label: "不明" },
];

export const PREP_STATUS_KEYS: readonly PrepStatus[] = PREP_STATUSES.map((s) => s.key);

/** 状態を選んでいない分野の表示。「問題なし」や「確認済み」とは扱わない */
export const PREP_NOT_YET = "まだ確認していません";

export type OptionDef = { key: OptionKey; label: string; checks: string[] };

export const OPTIONS: readonly OptionDef[] = [
  {
    key: "family",
    label: "親族に引き継ぐ",
    checks: ["ご本人に継ぐ意思があるか、時期はいつ頃か", "借入の保証や店舗の契約をどうするか（専門家に確認）"],
  },
  {
    key: "employee",
    label: "従業員に引き継ぐ",
    checks: ["候補の方の意思と、経営を担う準備", "引き継ぎに必要なお金や保証の扱い（専門家に確認）"],
  },
  {
    key: "third_party",
    label: "店外の人や企業に引き継ぐ",
    checks: ["どこに相談すれば相手を探せるか", "従業員・店の名前・契約がどうなるか（個別の事情と専門家の確認が必要）"],
  },
  {
    key: "closure",
    label: "店を閉じる",
    checks: ["閉じる時期と、従業員・お客さんへの伝え方", "借入・契約・設備の扱い（専門家に確認）"],
  },
  {
    key: "undecided",
    label: "まだ決めない（保留）",
    checks: ["いつ頃もう一度考えるか", "それまでに確かめておきたい資料"],
  },
];

export const OPTION_KEYS: readonly OptionKey[] = OPTIONS.map((o) => o.key);

export const CONSULTANTS: readonly { key: ConsultantKey; label: string }[] = [
  { key: "support_center", label: "事業承継の支援機関" },
  { key: "bank", label: "取引のある金融機関" },
  { key: "tax_accountant", label: "税理士などの専門家" },
  { key: "chamber", label: "商工会・商工会議所" },
  { key: "undecided", label: "まだ決めていない" },
];

export const CONSULTANT_KEYS: readonly ConsultantKey[] = CONSULTANTS.map((c) => c.key);

export const REPORT_DOCUMENTS: readonly string[] = [
  "決算・確定申告に関する資料",
  "借入の返済予定表",
  "店舗の賃貸契約書",
  "営業許可証",
  "従業員の雇用条件が分かる資料",
];

export const REPORT_NOTES: readonly string[] = [
  "この資料は、ご本人が選んだ内容だけで作った下書きです。持参する前に、ご本人が内容を確かめてください。",
  "借入・契約・保証・許認可・雇用・価格・税務・法務・融資は、AI では判断できません。ご本人と専門家が確認してください。",
  "実際にどの資料が必要かは、事前に相談先へ確認してください。見せるのは必要な範囲だけにします。",
];

export const DEFAULT_PURPOSE = "飲食店の今後と引き継ぎの準備について、選択肢と進め方を相談したい。";

export const MAX_TEXT = 1000;
export const MAX_PURPOSE = 200;
export const MAX_PREP_TEXT = 200;

/** AI の返事の中で、本人の言葉を引用するときの長さの上限 */
export const QUOTE_MAX = 40;
