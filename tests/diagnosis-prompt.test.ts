// lib/diagnosis.ts を Notion「診断・学習プラン・90日計画の指示文 v1」に合わせた小修正の確認（2026-11-03）
// D：診断の AI に「AIが気づいたこと（推測）」を渡さない
// E：「話し合うための問い」は2〜3個。2個未満は壊れた返事と同じ扱い（1回だけ再送、だめなら 502）

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import { buildDiagnosisRequest, parseDiagnosis, runDiagnosis } from "@/lib/diagnosis";
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

async function putShared(role: Role, marker: string) {
  const summary = JSON.stringify({
    statements: [`発言-${marker}`],
    ai_observations: [`OBSERVATION-CANARY-${marker}`],
    unconfirmed: [`未確認-${marker}`],
  });
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, 'cashflow', '[]', 0, 'confirmed', ?, 1, 0, 'x')`,
    args: [DEMO_A, role, summary],
  });
}

const diag = (questions: unknown[]) => ({
  common: [{ point: "お店を続けたい", evidence: "先代は…と話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見え方", senior_said: "a", successor_said: "b", numbers: "", importance: "高" }],
  to_confirm: [],
  talk_questions: questions,
});

describe("D：AIが気づいたこと（推測）を診断の入力に入れない", () => {
  it("本人の発言と未確認事項は渡し、ai_observations は欄ごと渡さない", async () => {
    await putShared("predecessor", "P");
    await putShared("successor", "S");
    const req = buildDiagnosisRequest(await getComparisonFrom(db, DEMO_A));
    const text = req.system + JSON.stringify(req.messages);
    expect(text).toContain("発言-P");
    expect(text).toContain("発言-S");
    expect(text).toContain("未確認-P");
    expect(text).toContain("未確認-S");
    expect(text).not.toContain("OBSERVATION-CANARY");
    expect(text).not.toContain("AIが気づいたこと");
  });

  it("runDiagnosis で実際に AI へ送られる依頼にも入らない", async () => {
    await putShared("predecessor", "P");
    await putShared("successor", "S");
    const ai = fakeAi([diag(["問い1", "問い2"])]);
    await runDiagnosis({ db, ai }, DEMO_A, "predecessor");
    expect(ai.requests).toHaveLength(1);
    expect(JSON.stringify(ai.requests)).not.toContain("OBSERVATION-CANARY");
  });
});

describe("E：話し合うための問いは2〜3個", () => {
  it("0個・1個は無効（null）、空文字は数えない", () => {
    expect(parseDiagnosis(diag([]))).toBeNull();
    expect(parseDiagnosis(diag(["問い1"]))).toBeNull();
    expect(parseDiagnosis(diag(["問い1", "  ", 3]))).toBeNull();
  });

  it("2個・3個はそのまま、4個以上は3個に切る", () => {
    expect(parseDiagnosis(diag(["問い1", "問い2"]))!.talk_questions).toEqual(["問い1", "問い2"]);
    expect(parseDiagnosis(diag(["問い1", "問い2", "問い3"]))!.talk_questions).toHaveLength(3);
    expect(parseDiagnosis(diag(["1", "2", "3", "4"]))!.talk_questions).toEqual(["1", "2", "3"]);
  });

  it("1個の返事は1回だけ再送し、2回目が2個なら保存する", async () => {
    await putShared("predecessor", "P");
    await putShared("successor", "S");
    const ai = fakeAi([diag(["問い1"]), diag(["問い1", "問い2"])]);
    const rec = await runDiagnosis({ db, ai }, DEMO_A, "predecessor");
    expect(ai.requests).toHaveLength(2);
    expect(rec.diagnosis.talk_questions).toEqual(["問い1", "問い2"]);
  });

  it("2回とも1個なら 502 で、診断は保存しない", async () => {
    await putShared("predecessor", "P");
    await putShared("successor", "S");
    const ai = fakeAi([diag(["問い1"]), diag(["問い1"])]);
    await expect(runDiagnosis({ db, ai }, DEMO_A, "predecessor")).rejects.toMatchObject({ status: 502 });
    expect(ai.requests).toHaveLength(2);
    const n = await db.execute({ sql: `SELECT COUNT(*) AS n FROM diagnoses WHERE demo_id = ?`, args: [DEMO_A] });
    expect(Number(n.rows[0].n)).toBe(0);
  });
});
