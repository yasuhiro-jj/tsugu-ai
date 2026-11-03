// 診断の「方向性」directions（守る／工夫する／新しく取り組む）の確認（2026-11-03 追加）
// - 検証：各0〜3件、from は 先代|後継者|二人、text は400文字まで、古い診断（directions なし）は空として読む
// - 90日計画の AI 入力に directions と tryNew の指示が入る
// - 共有していないテーマの内容は、診断・90日計画の AI 入力に入らない（directions に混ざる道がない）

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import {
  buildDiagnosisRequest,
  DIAGNOSIS_SCHEMA,
  DIRECTION_ITEMS_MAX,
  getDiagnosisFrom,
  parseDiagnosis,
  parseDirections,
  runDiagnosis,
  toPublicDiagnosisRecord,
} from "@/lib/diagnosis";
import { createActionPlan, phaseRange } from "@/lib/action-plan";
import { getComparisonFrom } from "@/lib/compare";
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

async function putTheme(role: Role, key: string, marker: string, shared: 0 | 1 = 1, status = "confirmed") {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, '[]', 0, ?, ?, ?, 0, 'x')`,
    args: [
      DEMO_A,
      role,
      key,
      status,
      JSON.stringify({ statements: [`発言-${marker}`], ai_observations: [`推測-${marker}`], unconfirmed: [] }),
      shared,
    ],
  });
}

const DIRECTIONS = {
  keep: [{ text: "だしの取り方を守りたい", from: "先代" }],
  improve: [{ text: "仕込みの順番を見直せそう", from: "二人" }],
  tryNew: [{ text: "夜の定食を試したい", from: "後継者" }],
};
const diag = (directions?: unknown) => ({
  common: [{ point: "お店を続けたい", evidence: "先代は…と話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見え方", senior_said: "a", successor_said: "b", numbers: "", importance: "高" }],
  to_confirm: [],
  talk_questions: ["問い1", "問い2"],
  ...(directions === undefined ? {} : { directions }),
});
const START = "2026-11-02";
const actionsOut = () => ({
  actions: Array.from({ length: 5 }, (_, i) => ({
    title: `行動${i}`,
    owner: "二人",
    due: phaseRange(START, "1-30").to,
    phase: "1-30",
    linked_gap: "",
    linked_course: "",
    status: "未着手",
  })),
  message: "m",
});

describe("directions の検証", () => {
  it("正しい形はそのまま読む", () => {
    expect(parseDiagnosis(diag(DIRECTIONS))!.directions).toEqual(DIRECTIONS);
  });

  it("各欄は最大3件に切る", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ text: `t${i}`, from: "二人" }));
    const d = parseDirections({ keep: many, improve: many, tryNew: many });
    expect(DIRECTION_ITEMS_MAX).toBe(3);
    expect(d.keep).toHaveLength(3);
    expect(d.improve).toHaveLength(3);
    expect(d.tryNew).toHaveLength(3);
    expect(d.keep.map((x) => x.text)).toEqual(["t0", "t1", "t2"]);
  });

  it("from が 先代|後継者|二人 以外、text が空・文字列でない項目は捨てる。余分な項目は持ち出さない", () => {
    const d = parseDirections({
      keep: [
        { text: "a", from: "AI" },
        { text: "b", from: "" },
        { text: "  ", from: "先代" },
        { text: 3, from: "先代" },
        { text: "c", from: "後継者", theme_key: "cashflow" },
      ],
      improve: "x",
      tryNew: [null, "y"],
    });
    expect(d).toEqual({ keep: [{ text: "c", from: "後継者" }], improve: [], tryNew: [] });
  });

  it("text は400文字で切る", () => {
    const d = parseDirections({ keep: [{ text: "あ".repeat(500), from: "先代" }] });
    expect(Array.from(d.keep[0].text)).toHaveLength(400);
  });

  it("directions が無い・形が違う返事は空の directions として扱う", () => {
    const empty = { keep: [], improve: [], tryNew: [] };
    expect(parseDiagnosis(diag())!.directions).toEqual(empty);
    expect(parseDiagnosis(diag(null))!.directions).toEqual(empty);
    expect(parseDiagnosis(diag([1, 2]))!.directions).toEqual(empty);
  });

  it("スキーマは directions を必須にし、from を3つに限る", () => {
    expect(DIAGNOSIS_SCHEMA.required).toContain("directions");
    expect(DIAGNOSIS_SCHEMA.properties.directions.properties.tryNew.items.properties.from.enum).toEqual(["先代", "後継者", "二人"]);
  });

  it("古い診断（directions なしで保存）を読み出しても壊れず、空の directions を返す", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    await db.execute({
      sql: `INSERT INTO diagnoses (demo_id, diagnosis, based_on, created_at) VALUES (?, ?, ?, ?)`,
      args: [DEMO_A, JSON.stringify(diag()), JSON.stringify({ predecessor: ["cashflow"], successor: ["cashflow"] }), "2026-11-02T00:00:00.000Z"],
    });
    const rec = await getDiagnosisFrom(db, DEMO_A);
    expect(rec).not.toBeNull();
    expect(rec!.diagnosis.directions).toEqual({ keep: [], improve: [], tryNew: [] });
    expect(toPublicDiagnosisRecord(rec!).diagnosis.directions).toEqual({ keep: [], improve: [], tryNew: [] });
  });

  it("診断の指示に directions の補足（3つ・誰の意見か・書かれていないことは書かない・決めつけない）が入る", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    const req = buildDiagnosisRequest(await getComparisonFrom(db, DEMO_A));
    expect(req.system).toContain("directions");
    expect(req.system).toContain("keep");
    expect(req.system).toContain("improve");
    expect(req.system).toContain("tryNew");
    expect(req.system).toContain("誰の意見か");
    expect(req.system).toContain("要約に書かれていないことは書かない");
    expect(req.system).toContain("良し悪しを決めつけない");
  });

  it("公開用の変換でも directions は text と from だけ（テーマの key を含まない）", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    const rec = await runDiagnosis({ db, ai: fakeAi([diag(DIRECTIONS)]) }, DEMO_A, "predecessor");
    const pub = toPublicDiagnosisRecord(rec);
    expect(pub.diagnosis.directions).toEqual(DIRECTIONS);
    expect(pub.basedOnThemeKeys).toEqual([]);
    expect(JSON.stringify(pub.diagnosis.directions)).not.toContain("cashflow");
  });
});

describe("90日計画の AI 入力に directions を渡す", () => {
  it("診断の directions と tryNew の指示が入る", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    await runDiagnosis({ db, ai: fakeAi([diag(DIRECTIONS)]) }, DEMO_A, "predecessor");
    const ai = fakeAi([actionsOut()]);
    await createActionPlan({ db, ai }, DEMO_A, "predecessor", { startDate: START });
    expect(ai.requests).toHaveLength(1);
    const req = ai.requests[0];
    const user = JSON.stringify(req.messages);
    expect(user).toContain("tryNew");
    expect(user).toContain("夜の定食を試したい");
    expect(user).toContain("だしの取り方を守りたい");
    expect(req.system).toContain("tryNew");
    expect(req.system).toContain("31-60 か 61-90");
  });
});

describe("共有していないテーマの内容は directions の材料に入らない", () => {
  it("非共有・未確定のテーマと推測の欄は、診断と90日計画の AI 入力のどちらにも入らない", async () => {
    await putTheme("predecessor", "cashflow", "P-SHARED");
    await putTheme("successor", "cashflow", "S-SHARED");
    // 非共有（確定済み）と、共有済みだが未確定のテーマ
    await putTheme("predecessor", "suppliers", "PRIVATE-CANARY-P", 0);
    await putTheme("successor", "suppliers", "PRIVATE-CANARY-S", 0);
    await putTheme("successor", "people", "DRAFT-CANARY-S", 1, "awaiting_confirmation");

    const dAi = fakeAi([diag(DIRECTIONS)]);
    const rec = await runDiagnosis({ db, ai: dAi }, DEMO_A, "predecessor");
    const diagInput = JSON.stringify(dAi.requests);
    expect(diagInput).toContain("発言-P-SHARED");
    expect(diagInput).not.toContain("CANARY");
    expect(diagInput).not.toContain("推測-");
    expect(rec.basedOnThemeKeys).toEqual(["cashflow"]);

    const pAi = fakeAi([actionsOut()]);
    await createActionPlan({ db, ai: pAi }, DEMO_A, "predecessor", { startDate: START });
    const planInput = JSON.stringify(pAi.requests);
    expect(planInput).toContain("夜の定食を試したい");
    expect(planInput).not.toContain("CANARY");
    expect(planInput).not.toContain("推測-");
    expect(planInput).not.toContain("suppliers");
  });
});

describe("診断の材料は二人とも共有したテーマだけ（オーナー決定 2026-11-03）", () => {
  it("片方だけが共有したテーマは、診断の AI 入力にも based_on にも入らない", async () => {
    await putTheme("predecessor", "cashflow", "P-BOTH");
    await putTheme("successor", "cashflow", "S-BOTH");
    await putTheme("predecessor", "policy", "ONE-SIDED-P"); // 後継者は未回答
    await putTheme("successor", "people", "ONE-SIDED-S", 1);
    await putTheme("predecessor", "people", "PRIV-P", 0); // 先代は共有しない
    const ai = fakeAi([diag(DIRECTIONS)]);
    const rec = await runDiagnosis({ db, ai }, DEMO_A, "successor");
    const input = JSON.stringify(ai.requests);
    expect(input).toContain("発言-P-BOTH");
    expect(input).toContain("発言-S-BOTH");
    expect(input).not.toContain("ONE-SIDED");
    expect(input).not.toContain("PRIV-P");
    expect(rec.basedOnThemeKeys).toEqual(["cashflow"]);
    // 片方だけ共有のテーマの共有を取り消しても、診断は消えない（材料に使っていないため）
    await db.execute({ sql: `UPDATE theme_records SET shared = 0 WHERE role = 'predecessor' AND theme_key = 'policy'`, args: [] });
    expect(await getDiagnosisFrom(db, DEMO_A)).not.toBeNull();
  });

  it("二人とも共有したテーマが無ければ 409 で、AI を呼ばない", async () => {
    await putTheme("predecessor", "policy", "A");
    await putTheme("successor", "people", "B");
    const ai = fakeAi([diag(DIRECTIONS)]);
    await expect(runDiagnosis({ db, ai }, DEMO_A, "predecessor")).rejects.toMatchObject({ status: 409 });
    expect(ai.requests).toHaveLength(0);
  });
});
