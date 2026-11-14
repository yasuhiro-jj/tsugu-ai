// TSUGU AI 2.0（試作）の型。
// 2.0 は既存版（ハッカソン版）のコード・DB・AI 接続を一切使わない。
// このフォルダ（lib/v2）から既存の lib/*.ts を import しないこと（tests/v2/leak.test.ts で確認している）。

export type ThemeKey = "legacy" | "future" | "staff" | "candidate" | "work" | "money" | "next";

export type ThemeStatus = "not_started" | "in_progress" | "answered" | "skipped";

export type ThemeState = {
  status: ThemeStatus;
  /** 本人が入力した回答（原文のまま） */
  answers: string[];
  /** answers と同じ並びの ID（発言を消すときに、面談の記録の該当箇所を見つけるため） */
  answerIds: string[];
  followupAsked: boolean;
};

export type Turn = {
  who: "ai" | "me";
  theme: ThemeKey;
  text: string;
  /** 本人の発言のとき：その回答の ID */
  answerId?: string;
  /** AI の発言のとき：本人の言葉を引用して受け止めた一文（質問の前に表示する）。サーバーが今回の回答だけから作る */
  heard?: string;
  /** heard が引用している回答の ID（その発言を消したら、引用も消す） */
  heardOf?: string;
};

/** 準備リストの分野 */
export type PrepKey =
  | "values"
  | "daily"
  | "craft"
  | "finance"
  | "loans"
  | "contracts"
  | "staff"
  | "partners"
  | "permits"
  | "systems"
  | "advisors";

export type PrepStatus = "confirmed" | "todo" | "unknown";

export type PrepEntry = {
  /** null は「まだ確認していない」。確認済みや問題なしとは扱わない */
  status: PrepStatus | null;
  /** 次に確認すること */
  next: string;
  /** 確認済みのとき：何で確かめたか（資料名・いつ時点） */
  basis: string;
};

/** statement=本人の発言 / ai_note=AIの整理案 / unconfirmed=未確認 / option=関心のある選択肢 / prep=準備の状況 */
export type ItemKind = "statement" | "ai_note" | "unconfirmed" | "option" | "prep";

export type Item = {
  id: string;
  kind: ItemKind;
  theme: ThemeKey | null;
  /** 本人の発言のとき、もとの回答の ID */
  answerId?: string;
  /** 準備リストの項目のとき、その分野 */
  prepKey?: PrepKey;
  text: string;
  /** 本人が書き直したか */
  edited: boolean;
  /** 相談資料に載せるか。初期値は必ず false（本人が選んだものだけ載せる） */
  selected: boolean;
};

export type OptionKey = "family" | "employee" | "third_party" | "closure" | "undecided";

export type ConsultantKey = "support_center" | "bank" | "tax_accountant" | "chamber" | "undecided";

export type Report = {
  consultantLabel: string;
  purpose: string;
  statements: string[];
  aiNotes: string[];
  optionsNote: string | null;
  /** 準備の状況（本人が載せると選んだ分野だけ） */
  prep: string[];
  unconfirmed: string[];
  questions: string[];
  documents: string[];
  notes: string[];
  generatedAt: string;
};

/** 「次の一歩」の候補のもと。準備リストの分野か、相談先への連絡 */
export type StepKey = PrepKey | "consult";

export type WhenKey = "this_week" | "this_month" | "three_months" | "undecided";

export type StepChoice = {
  /** do=やる / hold=今は保留 / null=まだ決めていない */
  decision: "do" | "hold" | null;
  /** 誰が（役割で書く。名前は書かない） */
  who: string;
  when: WhenKey | null;
};

export type Phase = "interview" | "review";

export type Session = {
  id: string;
  /** 持ち主（会社と本人）。権限確認で照らし合わせる。画面へは返さない */
  owner?: { tenantId: string; userId: string };
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  /** 今の質問のテーマ（面談が終わったら null） */
  currentTheme: ThemeKey | null;
  themes: Record<ThemeKey, ThemeState>;
  log: Turn[];
  items: Item[];
  reviewConfirmed: boolean;
  prep: Record<PrepKey, PrepEntry>;
  options: OptionKey[];
  /** 「次の一歩」で本人が選んだこと。本人用のメモで、相談資料には入れない */
  steps: Partial<Record<StepKey, StepChoice>>;
  consultant: ConsultantKey | null;
  /** 相談の目的（本人が書き直せる。資料に載る） */
  purpose: string;
  report: Report | null;
};

/** 画面へ返す形。置き場所の ID と持ち主の ID は返さない */
export type SessionView = Omit<Session, "id" | "owner">;

/** 資料生成に渡す入力。本人が選んだ項目だけが入る */
export type ReportInput = {
  consultantLabel: string;
  /** 本人が確かめた「相談の目的」 */
  purpose: string;
  items: { kind: ItemKind; theme: ThemeKey | null; text: string }[];
};

export type ReportGenerator = (input: ReportInput) => Promise<Omit<Report, "generatedAt">>;

export type AiRequest = {
  theme: ThemeKey;
  /** このテーマでの本人の回答（今回の分を含む） */
  answers: string[];
  followupAsked: boolean;
};

export type AiReply = {
  /** 聞き返しの質問（next_theme のときは短いあいさつ） */
  reply: string;
  action: "followup" | "next_theme";
};

export type InterviewAi = (req: AiRequest) => Promise<AiReply>;

export class V2Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "V2Error";
  }
}
