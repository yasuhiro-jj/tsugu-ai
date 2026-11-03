// 診断・学習プラン・講座・90日計画で画面とサーバーがやりとりするデータの形（CTO が定義した約束事）。
// 出力形式は Notion「診断・学習プラン・90日計画の指示文 下書き v1」の JSON に合わせる。
// 画面・サーバーの両方から `import type` してよい。変更は CTO を通すこと。

export type Importance = "高" | "中" | "低";
export type Expert = "不要" | "銀行" | "税理士" | "その他";

// ---- ① 認識差の診断 ----
export type Diagnosis = {
  common: { point: string; evidence: string }[];
  gaps: {
    theme: string;
    point: string;
    senior_said: string;
    successor_said: string;
    numbers: string;
    importance: Importance;
  }[];
  to_confirm: { item: string; how: string; expert: Expert }[];
  talk_questions: string[];
  /** 承継の方向性の整理（守る／工夫する／新しく取り組む）。2026-11-03 追加。古い診断では3つとも空配列 */
  directions: DiagnosisDirections;
};

/** 方向性の1項目。from が「誰の意見か」 */
export type DirectionItem = {
  /** 共有済み要約に書かれていた内容の言い換え（400文字以内） */
  text: string;
  /** 誰の意見か。「二人」は先代・後継者の両方が話していたこと */
  from: "先代" | "後継者" | "二人";
};

/**
 * 診断の「方向性」。材料は両者が共有した確定済み要約だけ（推測の欄は使わない）。
 * 各0〜3件。空のときは「話に出ていない」の意味で、画面は欄ごと出さないか「まだありません」とする。
 * AI は選択肢を広げる役なので、良し悪しや「こうすべき」の結論ではない（画面でも推奨の印を付けない）。
 */
export type DiagnosisDirections = {
  /** 守りたいこと（伝統・こだわりとして残したいこと） */
  keep: DirectionItem[];
  /** 変えられること（今のやり方を工夫・改善できそうなこと） */
  improve: DirectionItem[];
  /** 新しく試したいこと（90日計画で小さな実験にする候補） */
  tryNew: DirectionItem[];
};

export type DiagnosisRecord = {
  diagnosis: Diagnosis;
  createdAt: string; // ISO
  /** 診断に使った共有済みテーマの key（画面には件数・名前として出さない。再診断の要否判定用） */
  basedOnThemeKeys: string[];
};

// ---- お店の数字（ルールベースで計算済み。AI に計算させない） ----
export type FinancialSummary = {
  source: string; // 例：「決算書（架空）2025年3月期・2026年3月期」
  rows: { label: string; previous: string; current: string; note?: string }[];
};

// ---- 踏ん張れば伸びる余地（仮定の試算。単位：万円。lib/financials.ts の getUpsideSummary() で計算） ----
export type UpsideItemId = "costrate" | "lunchprice" | "banquet" | "shift";

export type UpsideItem = {
  id: UpsideItemId;
  title: string; // 改善策（例：「月末棚卸＋仕入れ・メニューの見直し」）
  assumption: string; // 前提（例：「原価率 42.0% → 40.0%」）
  effect: number; // 営業利益への効果（万円。小数1桁に丸め済み）
  effectText: string; // 表示用（例：「+108万円」）
};

export type UpsideSummary = {
  items: UpsideItem[];
  total: number; // 効果の合計（万円）
  totalText: string; // 例：「+358万円」
  operatingProfitBefore: number; // 当期の営業利益（万円）
  operatingProfitBeforeText: string; // 例：「▲236万円」
  operatingProfitAfter: number; // 改善後の営業利益 = 当期の営業利益 ＋ 合計（万円）
  operatingProfitAfterText: string; // 例：「+122万円」
  note: string; // 注記（実現を保証しない、など）
};

// ---- 講座（内容は Notion「学習講座コンテンツ v1」で固定。AI は作らない） ----
export type CourseId = "cashflow" | "costrate" | "trialbalance";

export type Course = {
  id: CourseId;
  title: string; // 1. 資金繰りの基本 など
  level: string; // 対象 例：Lv1〜
  goal: string;
  linkedGap: string; // 診断とのつながり
  articles: { no: number; title: string; body: string[] }[]; // body は段落（箇条）の配列
  questions: {
    no: number;
    question: string;
    choices: { key: string; text: string }[];
    articleNo: number; // 対応する記事
  }[]; // 正解は画面へ送らない（採点はサーバー）
};

/**
 * 記事の横の「AIに質問する」の答え（POST /api/learning/ask  body: { courseId, articleNo, question } → { ok, answer: AskAnswer }  後継者のみ）。
 * 会話は保存しない（1問1答）。terms は答えの中で使った言葉の短い説明（0〜3件）
 */
export type AskAnswer = {
  text: string;
  terms: { term: string; meaning: string }[];
};

export type CourseProgressStatus ="未着手" | "学習中" | "完了" | "復習をおすすめ";

export type CourseProgress = {
  courseId: CourseId;
  status: CourseProgressStatus;
  score: number | null; // 正解数（5問中）
  wrongArticleNos: number[]; // 間違えた問題に対応する記事
};

// ---- ② 学習プラン ----
export type LearningPlan = {
  plan: { order: number; course_id: CourseId; week: number; reason: string; linked_gap: string }[];
  message: string;
};

export type LearningState = {
  level: "Lv1" | "Lv2" | "Lv3" | "Lv4";
  wants: string; // 本人が学びたいこと
  /** 最新のプラン（無ければ null） */
  current: { plan: LearningPlan; createdAt: string; usedDiagnosis: boolean } | null;
  /** 1つ前のプラン（「診断で変わった」を見せるため。無ければ null） */
  previous: { plan: LearningPlan; createdAt: string; usedDiagnosis: boolean } | null;
  progress: CourseProgress[];
};

// ---- ③ 90日計画 ----
export type ActionStatus = "未着手" | "進行中" | "完了";

export type PlanAction = {
  id: string; // サーバーが付与
  title: string;
  owner: "先代" | "後継者" | "二人";
  due: string; // YYYY-MM-DD
  phase: "1-30" | "31-60" | "61-90";
  linked_gap: string;
  linked_course: string;
  status: ActionStatus;
};

export type ActionPlanState = {
  startDate: string | null;
  actions: PlanAction[];
  message: string | null;
  createdAt: string | null;
};

// ---- API（応答はすべて { ok: true, ... } または { ok: false, error: string }。POST は Content-Type: application/json 必須）----
// POST /api/diagnosis                       body: {}                       → { ok, record: DiagnosisRecord | null }  共有済み要約が両者そろっていなければ ok:false と案内文
// POST /api/learning/plan                   body: { wants?: string }       → { ok, state: LearningState }  後継者のみ
// POST /api/learning/quiz                   body: { courseId, answers: Record<number, string> } → { ok, result: { score, correct: Record<number, boolean>, wrongArticleNos, status }, state: LearningState }  後継者のみ
// POST /api/learning/explain                body: { courseId, questionNo, chosen } → { ok, explanation: string }  間違えた問題の解説（AI）
// POST /api/plan                            body: { startDate?: string }   → { ok, state: ActionPlanState }  90日計画の下書き作成（作り直し）
// POST /api/plan/action                     body: { id, title?, status?: ActionStatus, owner?, due? } → { ok, state: ActionPlanState }  due はその行動の期間内だけ
// DELETE /api/plan/action                   body: { id }                   → { ok, state: ActionPlanState }  最後の1件は消せない
// サーバーコンポーネント用（画面は lib から直接呼ぶ）：
//   getDiagnosis(demoId) / getFinancialSummary() / getUpsideSummary() / getCourses() / getCourse(id) / getLearningState(demoId) / getActionPlan(demoId)
