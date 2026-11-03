// 90日計画の書き換え（POST・DELETE /api/plan/action）の1日あたりの回数制限。AI の回数とは別。DB はメモリ。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import {
  createActionPlan,
  deleteAction,
  getActionPlanFrom,
  MSG_PLAN_EDIT_LIMIT,
  phaseRange,
  PLAN_EDITS_DAILY_LIMIT,
  reservePlanEdit,
  updateAction,
} from "@/lib/action-plan";
import { runDiagnosis } from "@/lib/diagnosis";
import { resetDemo } from "@/lib/interview/service";
import { purgeExpiredDemos } from "@/lib/retention";
import { usageDayKey } from "@/lib/ai/usage";
import type { JsonAi } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => {
  vi.useRealTimers();
});

function fakeAi(queue: unknown[]): JsonAi {
  const q = queue.map((x) => JSON.stringify(x));
  return (async () => {
    const next = q.shift();
    if (next === undefined) throw new Error("queue empty");
    return next;
  }) as JsonAi;
}

const START = "2026-11-02";
const DIAG = {
  common: [{ point: "続けたい", evidence: "e" }],
  gaps: [{ theme: "資金繰り", point: "p", senior_said: "s", successor_said: "t", numbers: "n", importance: "高" }],
  to_confirm: [],
  talk_questions: ["問い1", "問い2"],
};
const PHASES = ["1-30", "1-30", "31-60", "31-60", "61-90"] as const;
const actionsOut = () => ({
  actions: PHASES.map((phase, i) => ({
    title: `行動${i}`,
    owner: "二人",
    due: phaseRange(START, phase).to,
    phase,
    linked_gap: "",
    linked_course: "",
    status: "未着手",
  })),
  message: "m",
});

async function putTheme(demoId: string, role: Role) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, 'cashflow', '[]', 0, 'confirmed', ?, 1, 0, 'x')`,
    args: [demoId, role, JSON.stringify({ statements: ["s"], ai_observations: [], unconfirmed: [] })],
  });
}

async function buildPlan(demoId = DEMO_A) {
  await putTheme(demoId, "predecessor");
  await putTheme(demoId, "successor");
  await runDiagnosis({ db, ai: fakeAi([DIAG]) }, demoId, "predecessor");
  const st = await createActionPlan({ db, ai: fakeAi([actionsOut()]) }, demoId, "predecessor", { startDate: START });
  return st.actions;
}

const today = () => usageDayKey(new Date().toISOString());

async function usedToday(demoId: string): Promise<number> {
  const rs = await db.execute({
    sql: `SELECT calls FROM plan_edit_usage WHERE demo_id = ? AND day = ?`,
    args: [demoId, today()],
  });
  return rs.rows[0] ? Number(rs.rows[0].calls) : 0;
}

async function setUsed(demoId: string, day: string, calls: number) {
  await db.execute({
    sql: `INSERT INTO plan_edit_usage (demo_id, day, calls) VALUES (?, ?, ?)
          ON CONFLICT(demo_id, day) DO UPDATE SET calls = excluded.calls`,
    args: [demoId, day, calls],
  });
}

async function aiCallsTotal(): Promise<number> {
  const rs = await db.execute(`SELECT COALESCE(SUM(calls), 0) AS n FROM ai_usage`);
  return Number(rs.rows[0].n);
}

describe("90日計画の書き換えの回数制限", () => {
  it("上限は1日300回。書き換え・削除のたびに1回数える（AI の回数は増えない）", async () => {
    expect(PLAN_EDITS_DAILY_LIMIT).toBe(300);
    const acts = await buildPlan();
    const ai = await aiCallsTotal();
    await updateAction(db, DEMO_A, { id: acts[0].id, status: "進行中" });
    await deleteAction(db, DEMO_A, { id: acts[1].id });
    expect(await usedToday(DEMO_A)).toBe(2);
    expect(await aiCallsTotal()).toBe(ai);
  });

  it("上限に達したら書き換えも削除も 429 で、計画は変わらない", async () => {
    const acts = await buildPlan();
    const before = await getActionPlanFrom(db, DEMO_A);
    await setUsed(DEMO_A, today(), PLAN_EDITS_DAILY_LIMIT);

    await expect(updateAction(db, DEMO_A, { id: acts[0].id, title: "変える" })).rejects.toMatchObject({
      status: 429,
      userMessage: MSG_PLAN_EDIT_LIMIT,
    });
    await expect(deleteAction(db, DEMO_A, { id: acts[0].id })).rejects.toMatchObject({ status: 429 });
    expect(await getActionPlanFrom(db, DEMO_A)).toEqual(before);
    expect(await usedToday(DEMO_A)).toBe(PLAN_EDITS_DAILY_LIMIT);
  });

  it("上限の直前（299回）なら通り、そこで上限に達する", async () => {
    const acts = await buildPlan();
    await setUsed(DEMO_A, today(), PLAN_EDITS_DAILY_LIMIT - 1);
    await updateAction(db, DEMO_A, { id: acts[0].id, title: "最後の1回" });
    await expect(updateAction(db, DEMO_A, { id: acts[0].id, title: "超える" })).rejects.toMatchObject({ status: 429 });
    expect((await getActionPlanFrom(db, DEMO_A)).actions.find((a) => a.id === acts[0].id)!.title).toBe("最後の1回");
  });

  it("デモ用 ID ごと：別のデモ用 ID の回数には影響しない", async () => {
    await buildPlan(DEMO_A);
    const actsB = await buildPlan(DEMO_B);
    await setUsed(DEMO_A, today(), PLAN_EDITS_DAILY_LIMIT);
    await updateAction(db, DEMO_B, { id: actsB[0].id, title: "B は書ける" });
    expect(await usedToday(DEMO_B)).toBe(1);
  });

  it("同時に来ても上限を超えない（条件つき UPSERT）", async () => {
    const limit = 5;
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => reservePlanEdit(db, DEMO_A, limit)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(limit);
    expect(await usedToday(DEMO_A)).toBe(limit);
  });

  it("1日の区切りは日本時間の朝9時（usageDayKey と同じ）。前日の回数は数えない", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T23:59:00.000Z")); // 日本時間 11/4 8:59
    await reservePlanEdit(db, DEMO_A, 1);
    await expect(reservePlanEdit(db, DEMO_A, 1)).rejects.toMatchObject({ status: 429 });
    vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z")); // 日本時間 11/4 9:00
    await reservePlanEdit(db, DEMO_A, 1);
    const rs = await db.execute({
      sql: `SELECT day, calls FROM plan_edit_usage WHERE demo_id = ? ORDER BY day`,
      args: [DEMO_A],
    });
    expect(rs.rows.map((r) => [r.day, Number(r.calls)])).toEqual([
      ["2026-11-03", 1],
      ["2026-11-04", 1],
    ]);
  });

  it("デモのやり直しでは回数は消えない。保存期間の削除で前日以前の行だけ消える", async () => {
    await setUsed(DEMO_A, today(), 10);
    await setUsed(DEMO_A, "2026-01-01", 300);
    await resetDemo(db, DEMO_A, "predecessor");
    expect(await usedToday(DEMO_A)).toBe(10);
    await purgeExpiredDemos(db, { now: new Date(), retentionDays: 7 });
    const rs = await db.execute({ sql: `SELECT day FROM plan_edit_usage WHERE demo_id = ?`, args: [DEMO_A] });
    expect(rs.rows.map((r) => r.day)).toEqual([today()]);
  });
});
