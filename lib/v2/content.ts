// 2.0 試作の固定の文言（面談の質問・選択肢・相談先）。
// 質問は Notion「02｜一人で始めるAI面談・架空事例と相談資料」の表のとおり。AI が作る文章ではない。

import type { ConsultantKey, OptionKey, ThemeKey } from "./types";

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
    question: "このお店で、次の人にも残してほしいことはありますか？",
    followup: "その思いが表れた出来事を教えていただけますか？",
    aiNote: "お店で残したいことを、引き継ぎの相談で伝えたい可能性があります。",
    reportQuestion: "お店で大切にしてきたことを残すには、どのような引き継ぎ方が考えられますか？",
  },
  {
    key: "future",
    label: "これから",
    question: "お店の今後を考えるうえで、今いちばん気がかりなのは何ですか？",
    followup: "いつ頃までに考えたい、などの希望はありますか？",
    aiNote: "今後の気がかりや時期の希望について、相談したい可能性があります。",
    reportQuestion: "考え始める時期や進め方について、目安はありますか？",
  },
  {
    key: "staff",
    label: "従業員",
    question: "一緒に働く方について、今後大切にしたいことはありますか？",
    followup: "ご本人たちに伝える時期で、気になることはありますか？",
    aiNote: "従業員の今後について、相談したい可能性があります。",
    reportQuestion: "従業員の雇用について、引き継ぎの前に何を確認すればよいですか？",
  },
  {
    key: "candidate",
    label: "候補者",
    question: "引き継ぐ相手について、今考えていることはありますか？",
    followup: "まだ決まっていなくても大丈夫です。どんな選択肢を知りたいですか？",
    aiNote: "引き継ぐ相手の探し方や選択肢について、相談したい可能性があります。",
    reportQuestion: "引き継ぐ相手が決まっていない場合、どのような探し方や相談先がありますか？",
  },
  {
    key: "work",
    label: "店の仕事",
    question: "社長しか分からない仕事や判断はありますか？",
    followup: "最初に誰かと一緒に確認できそうなことは何ですか？",
    aiNote: "ご本人しか分からない仕事の伝え方について、相談したい可能性があります。",
    reportQuestion: "店の仕事や味を次の人へ無理なく伝えるために、どんな準備が考えられますか？",
  },
  {
    key: "money",
    label: "数字・契約",
    question: "お金や店舗の契約で、確認しておきたいことはありますか？",
    followup: "確認できる資料や相談できる方はいますか？",
    aiNote: "お金や店舗の契約について、資料を確かめたうえで相談したい可能性があります。",
    reportQuestion: "借入・保証・賃貸契約・許認可について、誰にどの資料を見せて相談すればよいですか？",
  },
  {
    key: "next",
    label: "次の一歩",
    question: "まず誰に、どんなことを相談してみたいですか？",
    followup: "相談前に何が分かると安心できそうですか？",
    aiNote: "最初の相談先と、相談前に確かめることを整理したい可能性があります。",
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

/** 面談では資料を確かめていないので、答えの有無にかかわらず「未確認」として残す項目 */
export const FIXED_UNCONFIRMED: readonly string[] = [
  "借入の残高・返済条件・保証の内容（資料で未確認）",
  "店舗の賃貸契約の名義・条件（資料で未確認）",
  "営業許可などの許認可（資料で未確認）",
  "従業員の雇用条件（資料で未確認）",
];

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

/** AI の返事の中で、本人の言葉を引用するときの長さの上限 */
export const QUOTE_MAX = 40;
