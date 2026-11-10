// TSUGU AI 2.0（試作）の型。
// 2.0 は既存版（ハッカソン版）のコード・DB・AI 接続を一切使わない。
// このフォルダ（lib/v2）から既存の lib/*.ts を import しないこと（tests/v2/leak.test.ts で確認している）。

export type ThemeKey = "legacy" | "future" | "staff" | "candidate" | "work" | "money" | "next";

export type ThemeStatus = "not_started" | "in_progress" | "answered" | "skipped";

export type ThemeState = {
  status: ThemeStatus;
  /** 本人が入力した回答（原文のまま） */
  answers: string[];
  followupAsked: boolean;
};

export type Turn = { who: "ai" | "me"; theme: ThemeKey; text: string };

/** statement=本人の発言 / ai_note=AIの整理案 / unconfirmed=未確認 / option=関心のある選択肢 */
export type ItemKind = "statement" | "ai_note" | "unconfirmed" | "option";

export type Item = {
  id: string;
  kind: ItemKind;
  theme: ThemeKey | null;
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
  unconfirmed: string[];
  questions: string[];
  documents: string[];
  notes: string[];
  generatedAt: string;
};

export type Phase = "interview" | "review";

export type Session = {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  /** 今の質問のテーマ（面談が終わったら null） */
  currentTheme: ThemeKey | null;
  themes: Record<ThemeKey, ThemeState>;
  log: Turn[];
  items: Item[];
  reviewConfirmed: boolean;
  options: OptionKey[];
  consultant: ConsultantKey | null;
  report: Report | null;
};

/** 画面へ返す形。セッション ID は返さない（httpOnly クッキーだけで持つ） */
export type SessionView = Omit<Session, "id">;

/** 資料生成に渡す入力。本人が選んだ項目だけが入る */
export type ReportInput = {
  consultantLabel: string;
  items: { kind: ItemKind; theme: ThemeKey | null; text: string }[];
};

export type ReportGenerator = (input: ReportInput) => Promise<Omit<Report, "generatedAt">>;

export type AiRequest = {
  theme: ThemeKey;
  /** このテーマでの本人の回答（今回の分を含む） */
  answers: string[];
  followupAsked: boolean;
};

export type AiReply = { reply: string; action: "followup" | "next_theme" };

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
