// 90日計画の編集（行動の文の書き換え・削除・期限の範囲）。Claude は偽物、DB はメモリ。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client, InStatement } from "@libsql/client";
import { NextRequest } from "next/server";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { MSG_CONFLICT } from "@/lib/errors";
import { handleJsonApi, type ApiEnv } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { runDiagnosis } from "@/lib/diagnosis";
import {
  ACTION_TITLE_MAX,
  createActionPlan,
  deleteAction,
  getActionPlanFrom,
  MSG_LAST_ACTION,
  MSG_PLAN_CHANGED,
  phaseRange,
  updateAction,
} from "@/lib/action-plan";
import type { JsonAi } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";
import type { PlanAction } from "@/lib/plan-types";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
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
const PHASES = ["1-30", "1-30", "1-30", "31-60", "31-60", "61-90"] as const;
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

async function buildPlan(demoId = DEMO_A): Promise<PlanAction[]> {
  await putTheme(demoId, "predecessor");
  await putTheme(demoId, "successor");
  await runDiagnosis({ db, ai: fakeAi([DIAG]) }, demoId, "predecessor");
  const st = await createActionPlan({ db, ai: fakeAi([actionsOut()]) }, demoId, "predecessor", { startDate: START });
  expect(st.actions).toHaveLength(6);
  return st.actions;
}

const byPhase = (acts: PlanAction[], p: PlanAction["phase"]) => acts.find((a) => a.phase === p)!;

/** 最初の「UPDATE action_plans」の直前に before() を1回だけ挟む DB（書き込みの重なりを再現する） */
function interceptUpdate(base: Client, before: () => Promise<void>): Client {
  let done = false;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        return async (stmt: InStatement) => {
          const sql = typeof stmt === "string" ? stmt : stmt.sql;
          if (!done && /UPDATE action_plans/.test(sql)) {
            done = true;
            await before();
          }
          return target.execute(stmt);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("行動の文の書き換え", () => {
  it("前後の空白を取って保存する。ほかの項目は変えない", async () => {
    const acts = await buildPlan();
    const a = acts[0];
    const st = await updateAction(db, DEMO_A, { id: a.id, title: "  先代と一緒に通帳を見る  " });
    expect(st.actions.find((x) => x.id === a.id)).toEqual({ ...a, title: "先代と一緒に通帳を見る" });
    // 後継者の操作でも同じ関数（役割で絞らない。計画は二人のもの）
    expect((await getActionPlanFrom(db, DEMO_A)).actions.find((x) => x.id === a.id)!.title).toBe("先代と一緒に通帳を見る");
  });

  it("空・空白だけ・文字列以外・長すぎ・制御文字は 400 で、保存されない", async () => {
    const acts = await buildPlan();
    const id = acts[0].id;
    const bad: unknown[] = [
      "",
      "   ",
      null,
      123,
      "あ".repeat(ACTION_TITLE_MAX + 1),
      "改行\nあり",
      "タブ\tあり",
      "NUL" + String.fromCharCode(0) + "あり",
      "向き" + String.fromCharCode(0x202e) + "あり",
      "行区切り" + String.fromCharCode(0x2028) + "あり",
      "DEL" + String.fromCharCode(0x7f) + "あり",
      ...[0x2029, 0x2066, 0x2069, 0x061c, 0x200b, 0xfeff].map((c) => "見えない" + String.fromCharCode(c) + "文字"),
      // ZWJ（U+200D）は絵文字の合成のため途中なら可。先頭・末尾・連続は 400（SEC-A03。tests/zwj.test.ts）
      String.fromCharCode(0x200d) + "先頭",
      "連続" + String.fromCharCode(0x200d, 0x200d) + "あり",
    ];
    for (const title of bad) {
      await expect(updateAction(db, DEMO_A, { id, title })).rejects.toMatchObject({ status: 400 });
    }
    // 上限ちょうど（絵文字などのサロゲートペアも1文字と数える）は通る
    const ok = "😀".repeat(ACTION_TITLE_MAX);
    const st = await updateAction(db, DEMO_A, { id, title: ok });
    expect(st.actions.find((x) => x.id === id)!.title).toBe(ok);
  });
});

describe("期限はその行動の期間の中だけ", () => {
  it("期間内は受け付け、期間外（隣の期間・90日の外）は 400。期間は移らない", async () => {
    const acts = await buildPlan();
    const mid = byPhase(acts, "31-60");
    const r = phaseRange(START, "31-60");
    const st = await updateAction(db, DEMO_A, { id: mid.id, due: r.from });
    expect(st.actions.find((x) => x.id === mid.id)).toMatchObject({ due: r.from, phase: "31-60" });

    for (const due of [phaseRange(START, "1-30").to, phaseRange(START, "61-90").from, "2027-06-01", "2026-11-01"]) {
      await expect(updateAction(db, DEMO_A, { id: mid.id, due })).rejects.toMatchObject({ status: 400 });
    }
    await expect(updateAction(db, DEMO_A, { id: mid.id, due: "2026-12-32" })).rejects.toMatchObject({ status: 400 });
    expect((await getActionPlanFrom(db, DEMO_A)).actions.find((x) => x.id === mid.id)).toMatchObject({
      due: r.from,
      phase: "31-60",
    });
  });
});

describe("行動の削除", () => {
  it("1件消える。ほかの行動は残る", async () => {
    const acts = await buildPlan();
    const st = await deleteAction(db, DEMO_A, { id: acts[2].id });
    expect(st.actions).toHaveLength(5);
    expect(st.actions.find((x) => x.id === acts[2].id)).toBeUndefined();
    await expect(deleteAction(db, DEMO_A, { id: acts[2].id })).rejects.toMatchObject({ status: 404 });
    await expect(deleteAction(db, DEMO_A, {})).rejects.toMatchObject({ status: 400 });
  });

  it("最後の1件は消せない（理由をメッセージで返す）", async () => {
    const acts = await buildPlan();
    for (const a of acts.slice(0, 5)) await deleteAction(db, DEMO_A, { id: a.id });
    const last = acts[5];
    await expect(deleteAction(db, DEMO_A, { id: last.id })).rejects.toMatchObject({
      status: 400,
      userMessage: MSG_LAST_ACTION,
    });
    expect((await getActionPlanFrom(db, DEMO_A)).actions.map((x) => x.id)).toEqual([last.id]);
  });
});

describe("別のデモ ID からは書き換え・削除できない", () => {
  it("DEMO_B から DEMO_A の行動の id を指定しても 404。A の計画は変わらない", async () => {
    const acts = await buildPlan(DEMO_A);
    await buildPlan(DEMO_B);
    const before = await getActionPlanFrom(db, DEMO_A);
    const id = acts[0].id;
    await expect(updateAction(db, DEMO_B, { id, title: "乗っ取り" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteAction(db, DEMO_B, { id })).rejects.toMatchObject({ status: 404 });
    // 本文に demoId を入れても使わない
    await expect(updateAction(db, DEMO_B, { id, title: "乗っ取り", demoId: DEMO_A })).rejects.toMatchObject({ status: 404 });
    expect(await getActionPlanFrom(db, DEMO_A)).toEqual(before);
  });

  it("計画が無いデモ ID では 404", async () => {
    await expect(deleteAction(db, DEMO_B, { id: "a_x" })).rejects.toMatchObject({ status: 404 });
    await expect(updateAction(db, DEMO_B, { id: "a_x", title: "t" })).rejects.toMatchObject({ status: 404 });
  });

  it("API の入口：DELETE で別のデモの行動を指定すると 404、本文は利用者向けの文だけ", async () => {
    const acts = await buildPlan(DEMO_A);
    const env: ApiEnv = { getSession: async () => ({ demoId: DEMO_B, role: "successor" }), getDb: async () => db };
    const req = new NextRequest("http://localhost:3000/api/plan/action", {
      method: "DELETE",
      headers: { host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ id: acts[0].id }),
    });
    const res = await handleJsonApi(
      req,
      { where: "plan.action.delete", mutation: "json" },
      async ({ session, db }) => ({ state: await deleteAction(db, session.demoId, await readJsonBody(req)) }),
      env,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "90日計画がまだありません" });
    expect((await getActionPlanFrom(db, DEMO_A)).actions).toHaveLength(6);
  });
});

describe("SEC-102：診断の作り直しと重なったら 409", () => {
  it("読み込んだあと保存する前に診断が作り直されたら、書き換え・削除とも 409（作り直しを案内）", async () => {
    const acts = await buildPlan();
    const rerun = async () => {
      await new Promise((r) => setTimeout(r, 5)); // createdAt を変えるため
      await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    };
    await expect(
      updateAction(interceptUpdate(db, rerun), DEMO_A, { id: acts[0].id, title: "書き換え" }),
    ).rejects.toMatchObject({ status: 409, userMessage: MSG_PLAN_CHANGED });
    // 古い診断の計画は返さない
    expect((await getActionPlanFrom(db, DEMO_A)).actions).toHaveLength(0);

    // 作り直した計画で、削除も同じように確かめる
    const acts2 = (await createActionPlan({ db, ai: fakeAi([actionsOut()]) }, DEMO_A, "predecessor", { startDate: START }))
      .actions;
    await expect(deleteAction(interceptUpdate(db, rerun), DEMO_A, { id: acts2[0].id })).rejects.toMatchObject({
      status: 409,
      userMessage: MSG_PLAN_CHANGED,
    });
    expect((await getActionPlanFrom(db, DEMO_A)).actions).toHaveLength(0);
  });

  it("診断が作り直されたあとの古い計画への操作は 404（計画は返さない）", async () => {
    const acts = await buildPlan();
    await new Promise((r) => setTimeout(r, 5));
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    await expect(updateAction(db, DEMO_A, { id: acts[0].id, title: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteAction(db, DEMO_A, { id: acts[0].id })).rejects.toMatchObject({ status: 404 });
  });

  it("診断は同じでほかの編集と重なっただけなら 409（読み込み直しを案内）", async () => {
    const acts = await buildPlan();
    const bump = async () => {
      await db.execute({ sql: `UPDATE action_plans SET rev = rev + 1 WHERE demo_id = ?`, args: [DEMO_A] });
    };
    await expect(
      updateAction(interceptUpdate(db, bump), DEMO_A, { id: acts[0].id, title: "重なり" }),
    ).rejects.toMatchObject({ status: 409, userMessage: MSG_CONFLICT });
    expect((await getActionPlanFrom(db, DEMO_A)).actions.find((x) => x.id === acts[0].id)!.title).toBe("行動0");
  });
});
