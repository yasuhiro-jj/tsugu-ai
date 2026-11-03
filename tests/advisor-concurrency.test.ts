// SEC-A01：AI参謀に同時に送っても、AI は1回しか呼ばれない（lib/advisor.ts の「送信中」の印）。Claude は偽物、DB はメモリ。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import { ServiceError } from "@/lib/errors";
import {
  ADVISOR_PENDING_TTL_MS,
  getAdvisorStateFrom,
  MSG_ADVISOR_BUSY,
  resetAdvisor,
  sendAdvisorMessage,
} from "@/lib/advisor";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

const OK_OUT = { reply: "返事です", points: ["点"], consult: "不要", consult_note: "" };

type CountingAi = JsonAi & { calls: number };
/** 呼ばれた回数を数える偽の AI。gate を渡すと、それが解けるまで返事を待つ。fail なら失敗する */
function countingAi(opts: { gate?: Promise<void>; fail?: boolean } = {}): CountingAi {
  const fn = (async (_req: JsonAiRequest) => {
    fn.calls++;
    if (opts.gate) await opts.gate;
    if (opts.fail) throw new Error("boom");
    return JSON.stringify(OK_OUT);
  }) as CountingAi;
  fn.calls = 0;
  return fn;
}

async function aiUsage(): Promise<number> {
  const rs = await db.execute({
    sql: `SELECT calls FROM ai_usage WHERE demo_id = ? AND role = 'successor'`,
    args: [DEMO_A],
  });
  return rs.rows[0] ? Number(rs.rows[0].calls) : 0;
}

async function pendingAt(): Promise<string | null> {
  const rs = await db.execute({
    sql: `SELECT pending_at FROM advisor_chats WHERE demo_id = ? AND role = 'successor'`,
    args: [DEMO_A],
  });
  return rs.rows[0] ? ((rs.rows[0].pending_at as string | null) ?? null) : null;
}

async function setPending(msAgo: number) {
  await db.execute({
    sql: `UPDATE advisor_chats SET pending_at = ? WHERE demo_id = ? AND role = 'successor'`,
    args: [new Date(Date.now() - msAgo).toISOString(), DEMO_A],
  });
}

const send = (ai: JsonAi, text: string) =>
  sendAdvisorMessage({ db, ai, sleep: async () => {} }, DEMO_A, "successor", text);

describe("同時送信（SEC-A01）", () => {
  it("初めての会話に同時に2つ送っても AI は1回だけ。もう1つは AI を呼ばずに 409", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const ai = countingAi({ gate });
    const p1 = send(ai, "一つ目");
    const p2 = send(ai, "二つ目");
    // 2つ目の結果が出てから AI の返事を返す（AI を待っている間に2つ目が来た状態）
    const r2 = await p2.then(
      () => null,
      (e: unknown) => e,
    );
    open();
    const s1 = await p1;

    expect(r2).toBeInstanceOf(ServiceError);
    expect((r2 as ServiceError).status).toBe(409);
    expect(ai.calls).toBe(1);
    expect(await aiUsage()).toBe(1);
    expect(s1.messages.map((m) => m.text)).toEqual(["一つ目", "返事です"]);
    expect(await pendingAt()).toBeNull();
  });

  it("会話が既にあるときも、3つ同時に送って AI は1回だけ。保存は1往復だけ増える", async () => {
    await send(countingAi(), "最初");
    const ai = countingAi();
    const results = await Promise.allSettled([send(ai, "A"), send(ai, "B"), send(ai, "C")]);
    expect(ai.calls).toBe(1);
    expect(await aiUsage()).toBe(2);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    }
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toHaveLength(4);
    expect(await pendingAt()).toBeNull();
  });

  it("送信中の印があるあいだは、AI を呼ばずに 409（案内の文）", async () => {
    await send(countingAi(), "最初");
    await setPending(10_000);
    const ai = countingAi();
    await expect(send(ai, "次")).rejects.toMatchObject({ status: 409, userMessage: MSG_ADVISOR_BUSY });
    expect(ai.calls).toBe(0);
    expect(await aiUsage()).toBe(1);
  });

  it("古い印（90秒より前）は無視して送れる", async () => {
    await send(countingAi(), "最初");
    await setPending(ADVISOR_PENDING_TTL_MS + 1000);
    const ai = countingAi();
    const st = await send(ai, "次");
    expect(ai.calls).toBe(1);
    expect(st.messages).toHaveLength(4);
    expect(await pendingAt()).toBeNull();
  });

  it("AI が失敗したら（502）印を外し、本人の発言も保存しない。すぐ次を送れる", async () => {
    const bad = countingAi({ fail: true });
    await expect(send(bad, "失敗する相談")).rejects.toMatchObject({ status: 502 });
    expect(await pendingAt()).toBeNull();
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toEqual([]);

    const ai = countingAi();
    const st = await send(ai, "やり直し");
    expect(ai.calls).toBe(1);
    expect(st.messages.map((m) => m.text)).toEqual(["やり直し", "返事です"]);
  });

  it("AI の回数の上限（429）でも印を外す", async () => {
    await db.execute({
      sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'successor', 150, 'x')`,
      args: [DEMO_A],
    });
    const ai = countingAi();
    await expect(send(ai, "相談")).rejects.toMatchObject({ status: 429 });
    expect(ai.calls).toBe(0);
    expect(await pendingAt()).toBeNull();
  });

  it("AI を待っているあいだに「会話を消す」と、返事は保存しない（消した会話を戻さない）", async () => {
    await send(countingAi(), "最初");
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const p = send(countingAi({ gate }), "待つ相談");
    await vi.waitFor(async () => expect(await pendingAt()).not.toBeNull());
    await resetAdvisor(db, DEMO_A, "successor");
    open();
    await expect(p).rejects.toMatchObject({ status: 409 });
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toEqual([]);
  });
});
