// 決算サマリー・相談用資料（余力枠4つ目。オーナー決定 2026-11-03）で、画面とサーバーがやりとりするデータの形。
// 画面・サーバーの両方から `import type` してよい（server-only を付けない）。
//
// - 資料は二人の共有物（90日計画と同じ扱い）。先代・後継者のどちらからでも作れる・見られる
// - 作ったときの診断と結びつく（basedOnDiagnosisAt）。共有を取り消す・診断を作り直すと資料は消え、getReport は null を返す
// - 数字（rows・scenarios など）はすべてアプリの計算値（lib/financials.ts）。AI は by が "ai" / "app+ai" の欄の文だけを書く
// - すべて「下書き」。本人が確認・修正してから使う。AI が書いた文だけは PUT /api/report で直して保存できる（数字の表は直せない）
// - 資料を作り直す（POST /api/report）と、直した文は消えて AI の新しい下書きに戻る

import type { ActionStatus, PlanAction, UpsideItem } from "./plan-types";

/** その欄を誰が作ったか。"app"＝アプリの計算・固定文、"ai"＝AI の文、"app+ai"＝数字はアプリ・説明は AI */
export type ReportMadeBy = "app" | "ai" | "app+ai";

/** 数字の表の1行（値は表示用の文字列。計算済み） */
export type ReportNumberRow = {
  label: string;
  previous: string; // 前期の値（無ければ「—」）
  current: string; // 当期の値
  /** 前期との差（例：「▲200万円」「+2.0ポイント」）。比べられない行は無し */
  change?: string;
  note?: string; // 計算式など
};

/** 数字の表（出どころつき） */
export type ReportNumberTable = {
  /** 例：「決算書（架空）2025年3月期・2026年3月期」 */
  source: string;
  /** 列の見出し 例：{ previous: "前期（2025年3月期）", current: "当期（2026年3月期）" } */
  columns: { previous: string; current: string };
  rows: ReportNumberRow[];
};

/** 根拠つきの1項目（AI） */
export type ReportPoint = { text: string; basis: string };

export type ReportSummary = {
  title: string; // 「決算サマリー（下書き）」
  /** 1 基本情報（アプリ） */
  basic: {
    no: 1;
    title: "基本情報";
    by: "app";
    companyName: string;
    industry: string;
    overview: string;
    /** 対象の決算期 例：「2026年3月期（比較：2025年3月期）」 */
    period: string;
    /** 作成日（日本時間 YYYY-MM-DD） */
    createdDate: string;
    /** 使用した資料 */
    sources: string[];
  };
  /** 2 決算の要点（数字はアプリ、comment は AI） */
  results: { no: 2; title: "決算の要点"; by: "app+ai"; table: ReportNumberTable; comment: string };
  /** 3 財務の状態（数字はアプリ、comment は AI） */
  financial: { no: 3; title: "財務の状態"; by: "app+ai"; table: ReportNumberTable; comment: string };
  /** 4 強みと課題（AI。材料は二人とも共有したテーマから作った診断と数字） */
  strengthsAndIssues: {
    no: 4;
    title: "強みと課題";
    by: "ai";
    strengths: ReportPoint[];
    issues: ReportPoint[];
    /** 材料の説明（アプリの固定文） */
    basisNote: string;
  };
  /** 5 外部環境の影響（アプリ。MVP では最新情報を取りに行かない。3テーマとも「要確認」） */
  external: {
    no: 5;
    title: "外部環境の影響";
    by: "app";
    topics: {
      theme: "物価高" | "人件費（最低賃金）" | "金利";
      status: "要確認";
      /** 例：「デモ前に公式情報で確認し、出典と日付を登録する」 */
      note: string;
      /** 公式情報の出典と確認日（未登録なら null） */
      officialSource: { name: string; checkedAt: string } | null;
      /** 自社の数字で見るべき指標（アプリの計算値） */
      indicators: ReportNumberRow[];
    }[];
    source: string;
  };
  /** 6 今後の展望（数字はアプリ。viewpoints は AI の「比べるときの観点」） */
  outlook: {
    no: 6;
    title: "今後の展望";
    by: "app+ai";
    /** 必ず「予測」と表示する見出し 例：「予測（試算）：実現を保証するものではありません」 */
    forecastLabel: string;
    scenarios: {
      status_quo: { name: "現状維持案"; operatingProfit: number; operatingProfitText: string; basis: string };
      /**
       * 改善策あり案。飲食店以外（設定の業種）では無い（伸びる余地の試算がつぐみの飲食店の前提のため）。
       * 無いときは現状維持案だけを出す
       */
      improved?: {
        name: "改善策あり案";
        operatingProfit: number;
        operatingProfitText: string;
        totalEffectText: string;
        items: UpsideItem[];
        basis: string;
      };
    };
    /** 前提条件（アプリの固定文） */
    assumptions: string[];
    viewpoints: string[];
  };
  /** 7 対策と優先順位（アプリ。90日計画から並べる。AI は使わない。表示のたびに今の90日計画から作る） */
  actions: {
    no: 7;
    title: "対策と優先順位";
    by: "app";
    items: { title: string; owner: PlanAction["owner"]; due: string; phaseLabel: string; status: ActionStatus }[];
    /** 90日計画が無いときの案内（ある場合は null） */
    emptyMessage: string | null;
    source: string;
  };
  /** 8 相談事項（AI。質問リストの形） */
  consult: {
    no: 8;
    title: "相談事項";
    by: "ai";
    bank: string[]; // 銀行に相談すること
    tax: string[]; // 税理士など専門家に確認すること
    other: string[]; // その他
    /** 「結論は専門家に確認」の固定文 */
    note: string;
  };
};

/** 銀行への相談用資料（下書き） */
export type ReportBankDoc = {
  title: string; // 「銀行への相談用資料（下書き）」
  isDraft: true;
  createdDate: string; // 日本時間 YYYY-MM-DD
  companyName: string;
  /** 相談内容（AI） */
  purpose: string;
  /** 関連する数字（アプリ） */
  numbers: ReportNumberTable;
  /** 質問リスト（AI） */
  questions: string[];
  /** 「融資の可否・条件は銀行が判断する」などの固定文 */
  note: string;
};

/**
 * AI が書いた文の部分（reports.content に保存するのはこれだけ）。PUT /api/report の本文 `ai` と、ReportState.editable は同じ形。
 * 数字の表・固定文はここに無い（表示のたびにアプリが計算する）。ここに無い項目を送っても無視する
 */
export type ReportAiParts = {
  /** 2 決算の要点の説明文（1〜400文字。改行可） */
  results_comment: string;
  /** 3 財務の状態の説明文（1〜400文字。改行可） */
  financial_comment: string;
  /** 4 強み（1〜4件。text は1〜200文字、basis（根拠）は0〜200文字。改行不可） */
  strengths: ReportPoint[];
  /** 4 課題（1〜4件。text は1〜200文字、basis（根拠）は0〜200文字。改行不可） */
  issues: ReportPoint[];
  /** 6 今後の展望の「比べるときの観点」（0〜4件。各1〜200文字。改行不可） */
  outlook_viewpoints: string[];
  /** 8 相談事項。bank（銀行に相談すること）1〜6件、tax（税理士など専門家に確認すること）1〜6件、other（その他）0〜6件。各1〜200文字。改行不可 */
  consult: { bank: string[]; tax: string[]; other: string[] };
  /** 銀行への相談用資料。purpose（相談内容）1〜600文字・改行可、questions（質問リスト）2〜6件・各1〜200文字・改行不可 */
  bank_doc: { purpose: string; questions: string[] };
};

/** 画面の編集欄が使う上限（サーバーの検証・AI の出力の整形と同じ値。文字数はサロゲートペアを1文字と数える） */
export const REPORT_LIMITS = {
  /** results_comment・financial_comment の文字数 */
  commentMax: 400,
  /** 強み・課題の text / basis、観点・相談事項・質問の1件の文字数 */
  itemMax: 200,
  /** 強み・課題の件数 */
  pointsMin: 1,
  pointsMax: 4,
  /** 観点の件数（0件でもよい） */
  viewpointsMax: 4,
  /** 相談事項の各欄の件数（bank・tax は1件以上、other は0件でもよい） */
  consultMax: 6,
  /** 相談内容の文字数 */
  purposeMax: 600,
  /** 質問リストの件数 */
  questionsMin: 2,
  questionsMax: 6,
} as const;

export type ReportState = {
  isDraft: true;
  /** 「下書きです。本人が確認・修正してから使ってください」などの固定文 */
  draftNotice: string;
  /**
   * AI の文に言い切りに見える表現があったときの固定の注記（lib/assertive.ts）。AI の文そのものは変えない。
   * 今の画面でも見えるように、同じ文を draftNotice の後ろにもつないでいる
   */
  caution?: string;
  createdAt: string; // ISO（UTC）
  /** 作成時に使った診断の createdAt（ISO） */
  basedOnDiagnosisAt: string;
  /**
   * 最後に保存した日時（ISO・UTC。作成・作り直し・文の編集で変わる）。PUT /api/report の本文にそのまま入れて送る
   * （読み込んだあとにほかの人が保存していたら 409 になり、上書きしない）
   */
  updatedAt: string;
  /** 文を編集して保存した日時（ISO・UTC）。一度も編集していなければ無し。作り直すと消える */
  editedAt?: string;
  /** 編集欄の初期値：AI が書いた文の部分（今の保存内容。編集後は編集後の文）。PUT /api/report の `ai` と同じ形 */
  editable: ReportAiParts;
  summary: ReportSummary;
  bankDoc: ReportBankDoc;
};

// ---- API ----
// POST /api/report  body: {}  → { ok: true, state: ReportState }（作成・作り直し。先代・後継者どちらでも可）
//   診断が無ければ 409 { ok: false, error: "先に認識差の診断を行ってください…" }
//   AI を待つ間に診断が変わったら 409
//   作り直すと、PUT で編集した文は消えて AI の新しい下書きに戻る（editedAt も消える）
// PUT /api/report  body: { ai: ReportAiParts, updatedAt: string（読み込んだ state.updatedAt） } → { ok: true, state: ReportState }
//   AI が書いた文だけを直して保存する（先代・後継者どちらでも可）。数字の表は変わらない。言い切りに見える表現があれば caution が付く
//   400 { ok: false, error, field? }：形・文字数・件数・使えない文字（改行は results_comment・financial_comment・bank_doc.purpose だけ可）。
//       field は直す欄の場所（例 "strengths.0.text"、"consult.bank.2"、"bank_doc.purpose"）
//   404：資料がまだ無い
//   409：MSG_REPORT_EDIT_CONFLICT（updatedAt が古い＝ほかの保存と重なった）／MSG_REPORT_CHANGED（診断が変わった）／設定が変わった
//   429：MSG_REPORT_EDIT_LIMIT（書き換えの1日の上限。90日計画・設定の書き換えと同じ枠で合わせて1日300回）
// サーバーコンポーネント用：getReport(demoId) → ReportState | null（lib/report.ts）
