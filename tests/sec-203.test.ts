// SEC-203：診断の directions と学習プランのつながりの確認。Claude は偽物。DB はメモリ。
// (1) 共有を取り消すと、directions を含む診断と、その診断を使った学習プランが消える
// (2) 学習プランの AI 入力に、共有していないテーマ（非共有・未選択・確認待ち・片方だけ共有）の目印が入らない

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { getDiagnosisFrom, runDiagnosis } from "@/lib/diagnosis";
import { createLearningPlan, getLearningStateFrom } from "@/lib/learning";
import { setShared } from "@/lib/interview/service";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[] };
function fakeAi(queue: unknown[]): FakeJsonAi {
  const q = queue.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = q.shift();
    if (next === undefined) throw new Error("queue empty");
    return next;
  }) as FakeJsonAi;
  fn.requests = [];
  return fn;
}

async function putTheme(
  demoId: string,
  role: Role,
  key: string,
  marker: string,
  shared: 0 | 1 | null = 1,
  status = "confirmed",
) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, 'x')`,
    args: [
      demoId,
      role,
      key,
      JSON.stringify([{ from: "me", text: `会話-${marker}` }]),
      status,
      JSON.stringify({ statements: [`発言-${marker}`], ai_observations: [`推測-${marker}`], unconfirmed: [] }),
      shared,
    ],
  });
}

const DIRECTIONS = {
  keep: [{ text: "DIR-KEEP だしの取り方を守る", from: "先代" }],
  improve: [{ text: "DIR-IMPROVE 仕込みの順番", from: "二人" }],
  tryNew: [{ text: "DIR-TRYNEW 夜の定食", from: "後継者" }],
};
const DIAG = {
  common: [{ point: "お店を続けたい", evidence: "二人とも話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見え方", senior_said: "a", successor_said: "b", numbers: "", importance: "高" }],
  to_confirm: [],
  talk_questions: ["問い1", "問い2"],
  directions: DIRECTIONS,
};
const learningOut = (ids: string[]) => ({
  plan: ids.map((id, i) => ({ order: i + 1, course_id: id, week: i + 1, reason: `理由${i}`, linked_gap: "資金繰り" })),
  message: "この順番でよいですか？",
});

describe("SEC-203 (1) 共有の取り消しで directions つきの診断と、それを使った学習プランが消える", () => {
  it("取り消すと診断（directions を含む）は null、学習プランは診断を使わない版だけが残り、DB にも directions が残らない", async () => {
    await putTheme(DEMO_A, "predecessor", "cashflow", "P-SHARED");
    await putTheme(DEMO_A, "successor", "cashflow", "S-SHARED");
    // 別のデモにも同じ形の診断を作る（取り消しが他のデモに及ばないことも見る）
    await putTheme(DEMO_B, "predecessor", "cashflow", "B-P");
    await putTheme(DEMO_B, "successor", "cashflow", "B-S");

    // 学習プラン（診断なし）→ 診断（directions つき）→ 学習プラン（診断あり）
    await createLearningPlan({ db, ai: fakeAi([learningOut(["trialbalance"])]) }, DEMO_A, "successor", {});
    const rec = await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    expect(rec.diagnosis.directions.keep[0].text).toContain("DIR-KEEP");
    const lAi = fakeAi([learningOut(["cashflow", "costrate"])]);
    const st = await createLearningPlan({ db, ai: lAi }, DEMO_A, "successor", {});
    expect(st.current!.usedDiagnosis).toBe(true);
    expect(JSON.stringify(lAi.requests)).toContain("<diagnosis>");
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_B, "predecessor");

    await setShared(db, DEMO_A, "successor", { themeKey: "cashflow", shared: false });

    expect(await getDiagnosisFrom(db, DEMO_A)).toBeNull();
    const diagRows = await db.execute({ sql: `SELECT * FROM diagnoses WHERE demo_id = ?`, args: [DEMO_A] });
    expect(diagRows.rows).toHaveLength(0);

    const after = await getLearningStateFrom(db, DEMO_A);
    expect(after.current?.usedDiagnosis ?? false).toBe(false);
    expect(after.previous).toBeNull();
    const learnRows = await db.execute({ sql: `SELECT * FROM learning WHERE demo_id = ?`, args: [DEMO_A] });
    const learnText = JSON.stringify(learnRows.rows);
    expect(learnText).not.toContain("DIR-");
    expect(learnText).not.toContain("costrate"); // 診断を使ったプランの中身が残っていない
    expect(JSON.stringify(after)).not.toContain("DIR-");

    // 他のデモの診断（directions つき）は残る
    expect((await getDiagnosisFrom(db, DEMO_B))?.diagnosis.directions.keep[0].text).toContain("DIR-KEEP");
  });
});

describe("SEC-203 (2) 学習プランの AI 入力に、非共有のテーマの目印が入らない", () => {
  it("非共有・未選択・確認待ち・片方だけ共有・他のデモのテーマの目印と、面談の推測・会話は入らない", async () => {
    await putTheme(DEMO_A, "predecessor", "cashflow", "P-SHARED");
    await putTheme(DEMO_A, "successor", "cashflow", "S-SHARED");
    await putTheme(DEMO_A, "predecessor", "suppliers", "CANARY-PRIVATE-P", 0);
    await putTheme(DEMO_A, "successor", "suppliers", "CANARY-PRIVATE-S", 0);
    await putTheme(DEMO_A, "successor", "policy", "CANARY-UNDECIDED", null);
    await putTheme(DEMO_A, "successor", "people", "CANARY-AWAITING", 1, "awaiting_confirmation");
    await putTheme(DEMO_A, "predecessor", "closing", "CANARY-ONE-SIDED", 1);
    await putTheme(DEMO_B, "successor", "operations", "CANARY-OTHER-DEMO", 1);

    // 診断の前：学習プランの入力に面談の内容は入らない
    const before = fakeAi([learningOut(["trialbalance", "costrate", "cashflow"])]);
    await createLearningPlan({ db, ai: before }, DEMO_A, "successor", {});
    const beforeInput = JSON.stringify(before.requests);
    expect(beforeInput).not.toContain("CANARY");
    expect(beforeInput).not.toContain("SHARED"); // 学習プランは面談の要約を直接読まない

    // 診断の後：入るのは保存済みの診断（directions を含む）だけ
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    const ai = fakeAi([learningOut(["cashflow", "costrate", "trialbalance"])]);
    const st = await createLearningPlan({ db, ai }, DEMO_A, "successor", {});
    expect(st.current!.usedDiagnosis).toBe(true);
    const input = JSON.stringify(ai.requests);
    expect(input).toContain("<diagnosis>");
    expect(input).toContain("返済の見え方");
    expect(input).not.toContain("CANARY");
    expect(input).not.toContain("推測-");
    expect(input).not.toContain("会話-");
    expect(input).not.toContain("発言-");
    // どのテーマが共有されたか（テーマの key）も渡さない
    for (const key of ["suppliers", "closing", "operations", "basedOnThemeKeys", "based_on"]) {
      expect(input).not.toContain(key);
    }
  });
});
