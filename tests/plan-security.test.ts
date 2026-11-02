// security 指摘（SEC-101〜105・107）の確認。Claude は偽物、DB はメモリ。

import { beforeEach, describe, expect, it } from "vitest";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import { applySchema } from "@/lib/db";
import { getDiagnosisFrom, runDiagnosis, toPublicDiagnosisRecord } from "@/lib/diagnosis";
import { createLearningPlan, explainQuestion, getLearningStateFrom } from "@/lib/learning";
import { createActionPlan, getActionPlanFrom, phaseRange, updateAction } from "@/lib/action-plan";
import { callJsonAi, MIN_RETRY_MS, type JsonAi, type JsonAiRequest } from "@/lib/ai/json-ai";
import { setShared } from "@/lib/interview/service";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: (string | (() => Promise<string>))[] };
function fakeAi(queue: unknown[] = []): FakeJsonAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === undefined) throw new Error("queue empty");
    return typeof next === "function" ? next() : next;
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = queue.map((q) => (typeof q === "string" || typeof q === "function" ? q : JSON.stringify(q))) as FakeJsonAi["queue"];
  return fn;
}

/** 指定の SQL を含む書き込み（batch / execute）で必ず失敗する DB */
function failingDb(base: Client, pattern: RegExp): Client {
  const sqlOf = (s: InStatement) => (typeof s === "string" ? s : s.sql);
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "batch") {
        return async (stmts: InStatement[], mode?: unknown) => {
          if (stmts.some((s) => pattern.test(sqlOf(s)))) throw new Error("injected failure");
          return (target.batch as (...a: unknown[]) => unknown)(stmts, mode);
        };
      }
      if (prop === "execute") {
        return async (stmt: InStatement) => {
          if (pattern.test(sqlOf(stmt))) throw new Error("injected failure");
          return target.execute(stmt);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function putTheme(role: Role, key: string, marker: string, shared: 0 | 1 = 1) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, '[]', 0, 'confirmed', ?, ?, 0, 'x')`,
    args: [DEMO_A, role, key, JSON.stringify({ statements: [marker], ai_observations: [], unconfirmed: [] }), shared],
  });
}

const DIAG = {
  common: [{ point: "続けたい", evidence: "e" }],
  gaps: [{ theme: "資金繰り", point: "p", senior_said: "s", successor_said: "t", numbers: "n", importance: "高" }],
  to_confirm: [],
  talk_questions: ["問い"],
};
const learningOut = (reason = "理由", message = "この順番でよいですか？") => ({
  plan: [
    { order: 1, course_id: "cashflow", week: 1, reason, linked_gap: `${reason}-GAP` },
    { order: 2, course_id: "costrate", week: 2, reason, linked_gap: "g" },
  ],
  message,
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

/** 診断なしプラン → 診断 → 診断ありプラン → 90日計画 まで作る */
async function buildAll() {
  await putTheme("predecessor", "cashflow", "PRED");
  await putTheme("successor", "cashflow", "SUCC");
  await createLearningPlan({ db, ai: fakeAi([learningOut("NO-DIAG")]) }, DEMO_A, "successor", {});
  await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
  await createLearningPlan({ db, ai: fakeAi([learningOut("WITH-DIAG")]) }, DEMO_A, "successor", {});
  await createActionPlan({ db, ai: fakeAi([actionsOut()]) }, DEMO_A, "predecessor", { startDate: START });
  expect((await getActionPlanFrom(db, DEMO_A)).actions).toHaveLength(5);
  expect((await getLearningStateFrom(db, DEMO_A)).current!.usedDiagnosis).toBe(true);
}

const count = async (t: string) =>
  Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE demo_id = ?`, args: [DEMO_A] })).rows[0].n);

describe("SEC-101：共有の取り消しと派生物の削除", () => {
  it("(1) 削除が失敗したら shared の変更も保存されない（1つの batch）", async () => {
    await buildAll();
    const bad = failingDb(db, /DELETE FROM action_plans/);
    await expect(setShared(bad, DEMO_A, "predecessor", { themeKey: "cashflow", shared: false })).rejects.toThrow();
    const r = await db.execute({
      sql: `SELECT shared FROM theme_records WHERE demo_id = ? AND role = 'predecessor' AND theme_key = 'cashflow'`,
      args: [DEMO_A],
    });
    expect(Number(r.rows[0].shared)).toBe(1); // 取り消しは保存されていない＝派生物と矛盾しない
    expect(await count("action_plans")).toBe(1);
  });

  it("(1) 成功時は shared=0 と派生物の削除が同時に起きる", async () => {
    await buildAll();
    await setShared(db, DEMO_A, "predecessor", { themeKey: "cashflow", shared: false });
    expect(await count("diagnoses")).toBe(0);
    expect(await count("action_plans")).toBe(0);
    const raw = await db.execute({ sql: `SELECT current_plan, previous_plan FROM learning WHERE demo_id = ?`, args: [DEMO_A] });
    expect(JSON.stringify(raw.rows)).not.toContain("WITH-DIAG");
    expect(JSON.stringify(raw.rows)).toContain("NO-DIAG");
  });

  it("(2) 取り消しは保存されたが派生物の削除が失敗した状態でも、読み出しは派生物を返さない（削除も失敗し続ける偽 DB）", async () => {
    await buildAll();
    // 取り消しだけが反映され、診断・計画・学習プランが残った状態を作る
    await db.execute({
      sql: `UPDATE theme_records SET shared = 0 WHERE demo_id = ? AND role = 'predecessor'`,
      args: [DEMO_A],
    });
    const bad = failingDb(db, /DELETE FROM (diagnoses|action_plans)|UPDATE learning SET/);
    expect(await getDiagnosisFrom(bad, DEMO_A)).toBeNull();
    expect((await getActionPlanFrom(bad, DEMO_A)).actions).toHaveLength(0);
    const st = await getLearningStateFrom(bad, DEMO_A);
    expect(st.current?.usedDiagnosis).toBe(false);
    expect(st.previous).toBeNull();
    expect(JSON.stringify(st)).not.toContain("WITH-DIAG");
    await expect(updateAction(bad, DEMO_A, { id: "x", status: "完了" })).rejects.toMatchObject({ status: 404 });
  });

  it("(2) 診断の行だけ消えて派生物が残っていても、読み出し時に消す", async () => {
    await buildAll();
    await db.execute({ sql: `DELETE FROM diagnoses WHERE demo_id = ?`, args: [DEMO_A] });
    expect((await getActionPlanFrom(db, DEMO_A)).actions).toHaveLength(0);
    expect(await count("action_plans")).toBe(0);
    expect((await getLearningStateFrom(db, DEMO_A)).current!.usedDiagnosis).toBe(false);
    const raw = await db.execute({ sql: `SELECT current_plan, previous_plan FROM learning WHERE demo_id = ?`, args: [DEMO_A] });
    expect(JSON.stringify(raw.rows)).not.toContain("WITH-DIAG");
  });
});

describe("SEC-102：90日計画は作成時の診断と結びつける", () => {
  it("診断を作り直すと、古い診断から作った計画は返さない・更新できない", async () => {
    await buildAll();
    const id = (await getActionPlanFrom(db, DEMO_A)).actions[0].id;
    await new Promise((r) => setTimeout(r, 5)); // createdAt を変えるため
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    expect((await getActionPlanFrom(db, DEMO_A)).actions).toHaveLength(0);
    expect(await count("action_plans")).toBe(0);
    await expect(updateAction(db, DEMO_A, { id, status: "完了" })).rejects.toMatchObject({ status: 404 });
  });

  it("AI を待っている間に診断が作り直されたら、作った計画は残さず 409", async () => {
    await buildAll();
    const ai = fakeAi([
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
        return JSON.stringify(actionsOut());
      },
    ]);
    await expect(createActionPlan({ db, ai }, DEMO_A, "predecessor", { startDate: START })).rejects.toMatchObject({ status: 409 });
    expect(await count("action_plans")).toBe(0);
  });

  it("既存の action_plans（列なし）にも applySchema が列を足す。何度流しても安全", async () => {
    const old = createClient({ url: ":memory:" });
    await old.execute(`CREATE TABLE action_plans (demo_id TEXT NOT NULL PRIMARY KEY, start_date TEXT NOT NULL,
      actions TEXT NOT NULL, message TEXT, rev INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await applySchema(old);
    await applySchema(old);
    const cols = (await old.execute(`PRAGMA table_info(action_plans)`)).rows.map((r) => r.name);
    expect(cols).toContain("diagnosis_created_at");
  });
});

describe("SEC-103：診断の応答に共有テーマの key を出さない", () => {
  it("toPublicDiagnosisRecord は basedOnThemeKeys を空にする", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    const rec = await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    expect(rec.basedOnThemeKeys).toEqual(["cashflow"]); // サーバー内部では持つ
    expect(toPublicDiagnosisRecord(rec).basedOnThemeKeys).toEqual([]);
    expect(toPublicDiagnosisRecord(rec).diagnosis).toEqual(rec.diagnosis);
  });
});

describe("SEC-104：90日計画の AI 入力に学習プランの理由・希望を入れない", () => {
  it("reason / linked_gap / message / wants のセンチネルが含まれない", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    await createLearningPlan(
      { db, ai: fakeAi([learningOut("SENTINEL-REASON", "SENTINEL-MESSAGE")]) },
      DEMO_A,
      "successor",
      { wants: "SENTINEL-WANTS ランチ" },
    );
    const ai = fakeAi([actionsOut()]);
    await createActionPlan({ db, ai }, DEMO_A, "predecessor", { startDate: START });
    const sent = ai.requests[0].system + JSON.stringify(ai.requests[0].messages);
    expect(sent).not.toContain("SENTINEL");
    expect(sent).toContain("cashflow");
    expect(sent).toContain("1. 資金繰りの基本");
  });
});

describe("SEC-105：時間の予算", () => {
  it("1回目で予算の残りが MIN_RETRY_MS を切ったら再送しない", async () => {
    let t = 0;
    const ai = fakeAi([
      async () => {
        t += 40_000;
        return "壊れた";
      },
      JSON.stringify({ ok: 1 }),
    ]);
    await expect(
      callJsonAi(
        { db, ai, now: () => t },
        DEMO_A,
        "successor",
        { purpose: "t", system: "", messages: [], schema: {}, maxTokens: 10, budgetMs: 40_000 + MIN_RETRY_MS - 1 },
        (v) => v,
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(ai.requests).toHaveLength(1);
  });

  it("残り時間が十分なら1回だけ再送し、各回の timeoutMs は残り時間以下", async () => {
    let t = 0;
    const ai = fakeAi([
      async () => {
        t += 5_000;
        return "壊れた";
      },
      JSON.stringify({ ok: 1 }),
    ]);
    await callJsonAi(
      { db, ai, now: () => t },
      DEMO_A,
      "successor",
      { purpose: "t", system: "", messages: [], schema: {}, maxTokens: 10, budgetMs: 50_000 },
      (v) => v,
    );
    expect(ai.requests.map((r) => r.timeoutMs)).toEqual([50_000, 45_000]);
  });

  it("解説は 50 秒の予算で呼ぶ（maxDuration 60 秒より短い）", async () => {
    const ai = fakeAi([{ explanation: "解説" }]);
    await explainQuestion({ db, ai }, DEMO_A, "successor", { courseId: "cashflow", questionNo: 1, chosen: "A" });
    expect(ai.requests[0].budgetMs).toBe(50_000);
    expect(ai.requests[0].timeoutMs).toBeLessThanOrEqual(50_000);
  });
});

describe("SEC-107：取り消しと学習プラン作成が重なったとき", () => {
  it("AI を待っている間に共有が取り消されたら、診断を使ったプランは保存されず 409", async () => {
    await putTheme("predecessor", "cashflow", "P");
    await putTheme("successor", "cashflow", "S");
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    const ai = fakeAi([
      async () => {
        await setShared(db, DEMO_A, "predecessor", { themeKey: "cashflow", shared: false });
        return JSON.stringify(learningOut("RACE-DIAG"));
      },
    ]);
    await expect(createLearningPlan({ db, ai }, DEMO_A, "successor", {})).rejects.toMatchObject({ status: 409 });
    const raw = await db.execute({ sql: `SELECT current_plan, previous_plan FROM learning WHERE demo_id = ?`, args: [DEMO_A] });
    expect(JSON.stringify(raw.rows)).not.toContain("RACE-DIAG");
  });
});
