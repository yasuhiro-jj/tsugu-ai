// 一時的な失敗のときの再送（lib/ai/retry.ts）。Claude は偽物、DB はメモリ、待ち時間と時計も偽物。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { aiJson, createTestDb, DEMO_A } from "./helpers";
import { callJsonAi, type JsonAi, type JsonAiRequest } from "@/lib/ai/json-ai";
import { isTransientAiError, MIN_RETRY_MS, TRANSIENT_RETRY_DELAY_MS } from "@/lib/ai/retry";
import {
  INTERVIEW_AI_BUDGET_MS,
  sendMessage,
  startInterview,
  type AiRequest,
  type InterviewAi,
} from "@/lib/interview/service";
import { AI_CALLS_PER_ROLE_LIMIT } from "@/lib/ai/usage";
import { ServiceError } from "@/lib/errors";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type Step = string | Error;

function fakeJsonAi(steps: Step[]): JsonAi & { requests: JsonAiRequest[] } {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = steps.shift();
    if (next === undefined) throw new Error("queue empty");
    if (next instanceof Error) throw next;
    return next;
  }) as JsonAi & { requests: JsonAiRequest[] };
  fn.requests = [];
  return fn;
}

function fakeInterviewAi(steps: Step[]): InterviewAi & { requests: AiRequest[] } {
  const fn = (async (req: AiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = steps.shift();
    if (next === undefined) throw new Error("queue empty");
    if (next instanceof Error) throw next;
    return next;
  }) as InterviewAi & { requests: AiRequest[] };
  fn.requests = [];
  return fn;
}

const status = (s: number) => APIError.generate(s, undefined, "x", new Headers());

async function calls(role = "successor"): Promise<number> {
  const rs = await db.execute({
    sql: `SELECT calls FROM ai_usage WHERE demo_id = ? AND role = ?`,
    args: [DEMO_A, role],
  });
  return rs.rows.length ? Number(rs.rows[0].calls) : 0;
}

function recorder() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

const REQ: JsonAiRequest = { purpose: "t", system: "", messages: [], schema: {}, maxTokens: 10, budgetMs: 50_000 };
const OK = JSON.stringify({ ok: 1 });

describe("一時的な失敗の判定", () => {
  it("接続エラー・タイムアウト・429/500/502/503/504/529 は一時的", () => {
    expect(isTransientAiError(new APIConnectionError({ message: "x" }))).toBe(true);
    expect(isTransientAiError(new APIConnectionTimeoutError())).toBe(true);
    for (const s of [429, 500, 502, 503, 504, 529]) expect(isTransientAiError(status(s))).toBe(true);
  });
  it("400 系（429 以外）・ふつうの例外・ServiceError は対象外", () => {
    for (const s of [400, 401, 403, 404, 413, 422]) expect(isTransientAiError(status(s))).toBe(false);
    expect(isTransientAiError(new Error("x"))).toBe(false);
    expect(isTransientAiError(new ServiceError(503, "x"))).toBe(false);
    expect(isTransientAiError("string")).toBe(false);
  });
});

describe("JSON 系（callJsonAi）", () => {
  it("一時エラー1回 → 待ってから再送して成功。回数は2増える", async () => {
    const ai = fakeJsonAi([new APIConnectionError({ message: "x" }), OK]);
    const r = recorder();
    const out = await callJsonAi({ db, ai, sleep: r.sleep }, DEMO_A, "successor", REQ, (v) => v);
    expect(out).toEqual({ ok: 1 });
    expect(ai.requests).toHaveLength(2);
    expect(r.waits).toEqual([TRANSIENT_RETRY_DELAY_MS]);
    expect(await calls()).toBe(2);
  });

  it("529 も再送する", async () => {
    const ai = fakeJsonAi([status(529), OK]);
    const r = recorder();
    await callJsonAi({ db, ai, sleep: r.sleep }, DEMO_A, "successor", REQ, (v) => v);
    expect(ai.requests).toHaveLength(2);
  });

  it("400 は再送しない（502・回数は1）", async () => {
    const ai = fakeJsonAi([status(400), OK]);
    const r = recorder();
    await expect(callJsonAi({ db, ai, sleep: r.sleep }, DEMO_A, "successor", REQ, (v) => v)).rejects.toMatchObject({
      status: 502,
    });
    expect(ai.requests).toHaveLength(1);
    expect(r.waits).toEqual([]);
    expect(await calls()).toBe(1);
  });

  it("上限に達していたら再送せず 429（AI は1回だけ）", async () => {
    await db.execute({
      sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'successor', ?, ?)`,
      args: [DEMO_A, AI_CALLS_PER_ROLE_LIMIT - 1, new Date().toISOString()],
    });
    const ai = fakeJsonAi([status(503), OK]);
    const r = recorder();
    await expect(callJsonAi({ db, ai, sleep: r.sleep }, DEMO_A, "successor", REQ, (v) => v)).rejects.toMatchObject({
      status: 429,
    });
    expect(ai.requests).toHaveLength(1);
    expect(await calls()).toBe(AI_CALLS_PER_ROLE_LIMIT);
  });

  it("時間の予算の残りが（待ち時間＋MIN_RETRY_MS）に足りなければ再送しない", async () => {
    let t = 0;
    const ai = fakeJsonAi([status(503), OK]);
    const slow: JsonAi = async (req) => {
      t += REQ.budgetMs! - MIN_RETRY_MS - TRANSIENT_RETRY_DELAY_MS + 1;
      return ai(req);
    };
    const r = recorder();
    await expect(
      callJsonAi({ db, ai: slow, now: () => t, sleep: r.sleep }, DEMO_A, "successor", REQ, (v) => v),
    ).rejects.toMatchObject({ status: 502 });
    expect(ai.requests).toHaveLength(1);
    expect(r.waits).toEqual([]);
    expect(await calls()).toBe(1);
  });

  it("待ち時間も予算に数え、再送の timeoutMs は残り時間以下", async () => {
    let t = 0;
    const ai = fakeJsonAi([status(502), OK]);
    const timed: JsonAi = async (req) => {
      t += 5_000;
      return ai(req);
    };
    const sleep = async (ms: number) => void (t += ms);
    await callJsonAi({ db, ai: timed, now: () => t, sleep }, DEMO_A, "successor", REQ, (v) => v);
    expect(ai.requests.map((r) => r.timeoutMs)).toEqual([50_000, 50_000 - 5_000 - TRANSIENT_RETRY_DELAY_MS]);
  });

  it("一時エラーの再送は1回まで（2回続けば 502・AI は2回）", async () => {
    const ai = fakeJsonAi([status(503), status(503), OK]);
    const r = recorder();
    await expect(callJsonAi({ db, ai, sleep: r.sleep }, DEMO_A, "successor", REQ, (v) => v)).rejects.toMatchObject({
      status: 502,
    });
    expect(ai.requests).toHaveLength(2);
    expect(await calls()).toBe(2);
  });

  it("一時エラー1回＋壊れた返事1回までは再送し、最大3回で止まる", async () => {
    const ok = fakeJsonAi([status(503), "壊れた", OK]);
    const r1 = recorder();
    await callJsonAi({ db, ai: ok, sleep: r1.sleep }, DEMO_A, "successor", REQ, (v) => v);
    expect(ok.requests).toHaveLength(3);

    const ng = fakeJsonAi(["壊れた", status(503), "壊れた", OK]);
    const r2 = recorder();
    await expect(
      callJsonAi({ db, ai: ng, sleep: r2.sleep }, DEMO_A, "successor", REQ, (v) => v),
    ).rejects.toMatchObject({ status: 502 });
    expect(ng.requests).toHaveLength(3);
    expect(await calls()).toBe(6);
  });
});

describe("面談（startInterview）", () => {
  const TEXT = "はじめまして。まずお店のことを教えてください。";
  const FIRST = aiJson({ reply: TEXT, action: "followup" });

  it("接続エラー1回 → 再送して成功。回数は2増える", async () => {
    const ai = fakeInterviewAi([new APIConnectionError({ message: "x" }), FIRST]);
    const r = recorder();
    const state = await startInterview({ db, ai, sleep: r.sleep }, DEMO_A, "predecessor");
    expect(state.messages).toEqual([{ from: "ai", text: TEXT }]);
    expect(ai.requests).toHaveLength(2);
    expect(r.waits).toEqual([TRANSIENT_RETRY_DELAY_MS]);
    expect(await calls("predecessor")).toBe(2);
  });

  it("400 は再送しない", async () => {
    const ai = fakeInterviewAi([status(400), FIRST]);
    const r = recorder();
    await expect(startInterview({ db, ai, sleep: r.sleep }, DEMO_A, "predecessor")).rejects.toMatchObject({
      status: 502,
    });
    expect(ai.requests).toHaveLength(1);
    expect(await calls("predecessor")).toBe(1);
  });

  it("上限に達していたら再送せず 429", async () => {
    await db.execute({
      sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'predecessor', ?, ?)`,
      args: [DEMO_A, AI_CALLS_PER_ROLE_LIMIT - 1, new Date().toISOString()],
    });
    const ai = fakeInterviewAi([status(503), FIRST]);
    const r = recorder();
    await expect(startInterview({ db, ai, sleep: r.sleep }, DEMO_A, "predecessor")).rejects.toMatchObject({
      status: 429,
    });
    expect(ai.requests).toHaveLength(1);
  });

  it("時間の予算が足りなければ再送しない", async () => {
    let t = 0;
    const inner = fakeInterviewAi([new APIConnectionTimeoutError(), FIRST]);
    const ai: InterviewAi = async (req, opts) => {
      t += 45_000; // 面談の予算 50 秒のうち 45 秒を使った
      return inner(req, opts);
    };
    const r = recorder();
    await expect(
      startInterview({ db, ai, now: () => t, sleep: r.sleep }, DEMO_A, "predecessor"),
    ).rejects.toMatchObject({ status: 502 });
    expect(inner.requests).toHaveLength(1);
    expect(r.waits).toEqual([]);
  });

  it("AI には残り時間を timeoutMs として渡す（予算は maxDuration 60 秒より短い）", async () => {
    const seen: (number | undefined)[] = [];
    const ai: InterviewAi = async (_req, opts) => {
      seen.push(opts?.timeoutMs);
      return FIRST;
    };
    await startInterview({ db, ai, now: () => 0 }, DEMO_A, "predecessor");
    expect(seen).toEqual([INTERVIEW_AI_BUDGET_MS]);
    expect(INTERVIEW_AI_BUDGET_MS).toBeLessThan(60_000);
  });
});

describe("SEC-202：予算が足りなければ初回も予約しない", () => {
  it("callJsonAi：残りが MIN_RETRY_MS 未満なら AI も reserveAiCall も呼ばずに 502", async () => {
    const ai = fakeJsonAi([OK]);
    await expect(
      callJsonAi({ db, ai, now: () => 0 }, DEMO_A, "successor", { ...REQ, budgetMs: MIN_RETRY_MS - 1 }, (v) => v),
    ).rejects.toMatchObject({ status: 502 });
    expect(ai.requests).toHaveLength(0);
    expect(await calls()).toBe(0);
  });

  it("面談：1回目で予算を使い切ったら、要約の依頼し直しは予約せずに 502", async () => {
    await startInterview({ db, ai: fakeInterviewAi([aiJson({ reply: "はじめまして", action: "followup" })]) }, DEMO_A, "predecessor");
    const before = await calls("predecessor");
    let t = 0;
    // 要約なしで終わろうとする返事 → 要約の依頼し直しが必要になる
    const inner = fakeInterviewAi([aiJson({ reply: "ありがとうございました", action: "finish" }), FIRST_SUMMARY]);
    const ai: InterviewAi = async (req, opts) => {
      t += INTERVIEW_AI_BUDGET_MS - MIN_RETRY_MS + 1;
      return inner(req, opts);
    };
    await expect(sendMessage({ db, ai, now: () => t }, DEMO_A, "predecessor", "こんにちは")).rejects.toMatchObject({
      status: 502,
    });
    expect(inner.requests).toHaveLength(1);
    expect((await calls("predecessor")) - before).toBe(1);
  });
});

describe("SEC-204：面談1送信あたりの AI 呼び出しは最大6回", () => {
  it("どの callAi でも「一時エラー→壊れた返事」が続くと、reserveAiCall は6回で止まる", async () => {
    await startInterview({ db, ai: fakeInterviewAi([aiJson({ reply: "はじめまして", action: "followup" })]) }, DEMO_A, "predecessor");
    const before = await calls("predecessor");
    const steps: Step[] = [
      // 1つ目の callAi：一時エラー → 壊れた返事 → 要約なしの finish（要約の依頼し直しへ）
      status(503),
      "壊れた",
      aiJson({ reply: "ありがとうございました", action: "finish" }),
      // 2つ目の callAi（要約の依頼し直し）：一時エラー → 壊れた返事 → 壊れた返事 → 502
      status(503),
      "壊れた",
      "壊れた",
      // ここから先は使われてはいけない
      FIRST_SUMMARY,
      FIRST_SUMMARY,
    ];
    const ai = fakeInterviewAi(steps);
    const r = recorder();
    await expect(
      sendMessage({ db, ai, now: () => 0, sleep: r.sleep }, DEMO_A, "predecessor", "こんにちは"),
    ).rejects.toMatchObject({ status: 502 });
    expect(ai.requests).toHaveLength(6);
    expect((await calls("predecessor")) - before).toBe(6);
    expect(r.waits).toEqual([TRANSIENT_RETRY_DELAY_MS, TRANSIENT_RETRY_DELAY_MS]);
  });
});

const FIRST_SUMMARY = aiJson({
  reply: "要約しました。ご確認ください",
  action: "summarize",
  summary: { statements: ["発言"] },
});
