// 学習プランの並べ替え（診断の認識差の重要度 → 講座の順番。ルールベース）
// 根拠：Notion「学習講座コンテンツ v1」の「診断とのつながり」（①資金繰り ②原価 ③試算表）

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import { runDiagnosis } from "@/lib/diagnosis";
import { courseGapScore, createLearningPlan, parseLearningPlan } from "@/lib/learning";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";
import type { CourseProgress, Diagnosis, Importance } from "@/lib/plan-types";

type Gap = { theme: string; point: string; importance: Importance };

function diag(gaps: Gap[]): Diagnosis {
  return {
    common: [],
    gaps: gaps.map((g) => ({ ...g, senior_said: "", successor_said: "", numbers: "" })),
    to_confirm: [],
    talk_questions: [],
    directions: { keep: [], improve: [], tryNew: [] },
  };
}

function learningOut(ids: string[]) {
  return {
    plan: ids.map((id, i) => ({ order: i + 1, course_id: id, week: i + 1, reason: `理由-${id}`, linked_gap: `つながり-${id}` })),
    message: "この順番でよいですか？",
  };
}

const progress = (over: Partial<Record<string, CourseProgress["status"]>> = {}): CourseProgress[] =>
  (["cashflow", "costrate", "trialbalance"] as const).map((id) => ({
    courseId: id,
    status: over[id] ?? "未着手",
    score: null,
    wrongArticleNos: [],
  }));

// 公開 URL で再現した形：資金繰り「高」と、AI が自由に書いた「もうけ・原価」の「高」
const BOTH_HIGH = diag([
  { theme: "もうけ・原価", point: "原価率の見え方が違う", importance: "高" },
  { theme: "資金繰り", point: "返済の見え方", importance: "高" },
]);

describe("学習プランの並べ替え（診断あり）", () => {
  it("講座の点数は、キーワードを含む認識差の重要度の最大値", () => {
    expect(courseGapScore("cashflow", BOTH_HIGH)).toBe(3);
    expect(courseGapScore("costrate", BOTH_HIGH)).toBe(3);
    expect(courseGapScore("trialbalance", BOTH_HIGH)).toBe(3); // 「もうけ」を含む
    const d = diag([
      { theme: "取引先", point: "口約束", importance: "高" },
      { theme: "お金", point: "借入の残りを知らない", importance: "低" },
      { theme: "お金", point: "手元のお金が減っている", importance: "中" },
    ]);
    expect(courseGapScore("cashflow", d)).toBe(2);
    expect(courseGapScore("costrate", d)).toBe(0);
  });

  it("資金繰り「高」＋原価「高」なら、AI が原価を先にしても資金繰りが1番目", () => {
    const out = parseLearningPlan(learningOut(["costrate", "trialbalance", "cashflow"]), progress(), BOTH_HIGH)!;
    expect(out.plan.map((p) => p.course_id)).toEqual(["cashflow", "costrate", "trialbalance"]);
  });

  it("資金繰り「中」＋原価「高」なら、原価が1番目", () => {
    const d = diag([
      { theme: "資金繰り", point: "返済の見え方", importance: "中" },
      { theme: "原価", point: "棚卸しをしていない", importance: "高" },
    ]);
    const out = parseLearningPlan(learningOut(["cashflow", "trialbalance", "costrate"]), progress(), d)!;
    expect(out.plan.map((p) => p.course_id)).toEqual(["costrate", "cashflow", "trialbalance"]);
  });

  it("AI が書いた reason / linked_gap / message は変えず、order と week を振り直す", () => {
    const out = parseLearningPlan(learningOut(["trialbalance", "costrate", "cashflow"]), progress(), BOTH_HIGH)!;
    expect(out.plan).toEqual([
      { order: 1, course_id: "cashflow", week: 1, reason: "理由-cashflow", linked_gap: "つながり-cashflow" },
      { order: 2, course_id: "costrate", week: 2, reason: "理由-costrate", linked_gap: "つながり-costrate" },
      { order: 3, course_id: "trialbalance", week: 3, reason: "理由-trialbalance", linked_gap: "つながり-trialbalance" },
    ]);
    expect(out.message).toBe("この順番でよいですか？");
  });

  it("「復習をおすすめ」は、重要度の並べ替えより優先して先頭のまま", () => {
    const out = parseLearningPlan(
      learningOut(["cashflow", "costrate", "trialbalance"]),
      progress({ trialbalance: "復習をおすすめ" }),
      diag([{ theme: "資金繰り", point: "返済", importance: "高" }]),
    )!;
    expect(out.plan.map((p) => [p.order, p.course_id, p.week])).toEqual([
      [1, "trialbalance", 1],
      [2, "cashflow", 2],
      [3, "costrate", 3],
    ]);
  });

  it("完了済みの講座は除いたうえで並べ替え、週を詰めて振り直す", () => {
    const out = parseLearningPlan(learningOut(["trialbalance", "cashflow", "costrate"]), progress({ cashflow: "完了" }), BOTH_HIGH)!;
    expect(out.plan.map((p) => [p.order, p.course_id, p.week])).toEqual([
      [1, "costrate", 1],
      [2, "trialbalance", 2],
    ]);
  });
});

describe("学習プランの並べ替え（診断なし）", () => {
  it("診断が無いときは AI の並びのまま", () => {
    const ids = ["costrate", "trialbalance", "cashflow"];
    expect(parseLearningPlan(learningOut(ids), progress())!.plan.map((p) => p.course_id)).toEqual(ids);
    expect(parseLearningPlan(learningOut(ids), progress(), null)!.plan.map((p) => p.course_id)).toEqual(ids);
  });
});

// ---- createLearningPlan からの通し（診断が並べ替えに渡っていること） ----

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

function fakeAi(queue: unknown[]): JsonAi & { requests: JsonAiRequest[] } {
  const q = queue.map((x) => JSON.stringify(x));
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(req);
    const next = q.shift();
    if (next === undefined) throw new Error("queue empty");
    return next;
  }) as JsonAi & { requests: JsonAiRequest[] };
  fn.requests = [];
  return fn;
}

async function putSharedTheme(demoId: string, role: Role, key: string) {
  const summary = JSON.stringify({ statements: [`発言 ${role}`], ai_observations: [], unconfirmed: [] });
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, ?, 0, 'confirmed', ?, 1, 0, 'x')`,
    args: [demoId, role, key, JSON.stringify([{ from: "me", text: "会話" }]), summary],
  });
}

describe("学習プランの並べ替え（診断の前後）", () => {
  it("診断前は AI の並び、診断後は資金繰りが最優先（希望欄は初期値のまま）", async () => {
    const aiOrder = ["costrate", "trialbalance", "cashflow"];
    const before = await createLearningPlan({ db, ai: fakeAi([learningOut(aiOrder)]) }, DEMO_A, "successor", {});
    expect(before.wants).toBe("ランチの売上を伸ばしたい");
    expect(before.current!.plan.plan.map((p) => p.course_id)).toEqual(aiOrder);

    await putSharedTheme(DEMO_A, "predecessor", "cashflow");
    await putSharedTheme(DEMO_A, "successor", "cashflow");
    const diagOut = {
      common: [],
      gaps: [
        { theme: "もうけ・原価", point: "原価率", senior_said: "a", successor_said: "b", numbers: "", importance: "高" },
        { theme: "資金繰り", point: "返済の見え方", senior_said: "a", successor_said: "b", numbers: "", importance: "高" },
      ],
      to_confirm: [],
      talk_questions: ["問い1", "問い2"],
    };
    await runDiagnosis({ db, ai: fakeAi([diagOut]) }, DEMO_A, "predecessor");

    const after = await createLearningPlan({ db, ai: fakeAi([learningOut(aiOrder)]) }, DEMO_A, "successor", {});
    expect(after.current!.usedDiagnosis).toBe(true);
    expect(after.current!.plan.plan.map((p) => [p.order, p.course_id, p.week])).toEqual([
      [1, "cashflow", 1],
      [2, "costrate", 2],
      [3, "trialbalance", 3],
    ]);
    expect(after.previous!.plan.plan[0].course_id).toBe("costrate");
  });
});
