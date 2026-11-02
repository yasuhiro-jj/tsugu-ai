// (e) 不正な入力を 400 で弾く（関数レベル）

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { ServiceError } from "@/lib/errors";
import { createFakeAi, createTestDb, DEMO_A } from "./helpers";
import { decideSummary, sendMessage, setShared, startInterview } from "@/lib/interview/service";
import { validateMessageText, validateSummary } from "@/lib/validation";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

async function expectStatus(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toSatisfy(
    (e: unknown) => e instanceof ServiceError && e.status === status,
  );
}

describe("(e) 入力検証", () => {
  it("不正な themeKey は 400", async () => {
    await expectStatus(
      decideSummary(db, DEMO_A, "predecessor", { themeKey: "nope", decision: "confirm" }),
      400,
    );
    await expectStatus(
      setShared(db, DEMO_A, "predecessor", { themeKey: "__proto__", shared: true }),
      400,
    );
    await expectStatus(setShared(db, DEMO_A, "predecessor", { themeKey: 1, shared: true }), 400);
  });

  it("不正な decision・shared は 400", async () => {
    await expectStatus(
      decideSummary(db, DEMO_A, "predecessor", { themeKey: "policy", decision: "approve" }),
      400,
    );
    await expectStatus(
      setShared(db, DEMO_A, "predecessor", { themeKey: "policy", shared: "true" }),
      400,
    );
  });

  it("1000文字超・空・文字列以外のメッセージは 400（AI は呼ばない）", async () => {
    const ai = createFakeAi();
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    const before = ai.requests.length;
    await expectStatus(sendMessage({ db, ai }, DEMO_A, "predecessor", "あ".repeat(1001)), 400);
    await expectStatus(sendMessage({ db, ai }, DEMO_A, "predecessor", "   "), 400);
    await expectStatus(sendMessage({ db, ai }, DEMO_A, "predecessor", 123), 400);
    expect(ai.requests.length).toBe(before);
    expect(validateMessageText("あ".repeat(1000))).toHaveLength(1000);
  });

  it("要約の編集：各要素 300 文字以内・最大 10 件・文字列のみ", () => {
    const ok = { statements: ["a"], ai_observations: [], unconfirmed: [] };
    expect(validateSummary(ok)).toEqual(ok);
    expect(() => validateSummary({ ...ok, statements: ["x".repeat(301)] })).toThrow(ServiceError);
    expect(() => validateSummary({ ...ok, statements: Array(11).fill("a") })).toThrow(ServiceError);
    expect(() => validateSummary({ ...ok, statements: [1] })).toThrow(ServiceError);
    expect(() => validateSummary({ statements: [] })).toThrow(ServiceError);
    expect(() => validateSummary("x")).toThrow(ServiceError);
  });
});
