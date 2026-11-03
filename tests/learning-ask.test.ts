// 記事の横の「AIに質問する」（lib/learning-ask.ts）。Claude は偽物、DB はメモリ。
// AI 入力にその記事だけが入り、ほかの記事・正解・面談・診断が入らないこと、入力検証、役割、失敗時の扱いを確かめる。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { NextRequest } from "next/server";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { ServiceError } from "@/lib/errors";
import { handleJsonApi, type ApiEnv } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { getCourses } from "@/lib/courses";
import { COMPANY_CONTEXT } from "@/lib/demo-profiles";
import {
  ASK_API_OPTIONS,
  ASK_BUDGET_MS,
  askAboutArticle,
  parseAskAnswer,
  validateAskQuestion,
} from "@/lib/learning-ask";
import { ASK_LEVEL_GUIDE_LV1, ASK_LEVEL_GUIDE_LV2 } from "@/lib/prompts/ask";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: string[] };
/** queue が空なら決まった正しい返事を返す。"THROW" なら失敗する */
function fakeAi(queue: unknown[] = []): FakeJsonAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === "THROW") throw new Error("boom SECRET-DETAIL");
    return next ?? JSON.stringify(OK_OUT);
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = queue.map((q) => (typeof q === "string" ? q : JSON.stringify(q)));
  return fn;
}

const OK_OUT = {
  answer: "減価償却費は、設備の購入代を何年かに分けて費用にしたものです。",
  terms: [{ term: "減価償却費", meaning: "設備の代金を何年かに分けて費用にしたもの" }],
};

const allText = (ai: FakeJsonAi) => ai.requests.map((r) => r.system + JSON.stringify(r.messages)).join("\n");
const ask = (ai: FakeJsonAi, body: Record<string, unknown>, role: Role = "successor", demoId = DEMO_A) =>
  askAboutArticle({ db, ai }, demoId, role, body);
const Q = { courseId: "cashflow", articleNo: 1, question: "減価償却費って何ですか？" };

async function expectStatus(p: Promise<unknown>, status: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).status).toBe(status);
  return err as ServiceError;
}

async function putTheme(role: Role, marker: string) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, 'cashflow', ?, 0, 'confirmed', ?, 1, 0, 'x')`,
    args: [
      DEMO_A,
      role,
      JSON.stringify([{ from: "me", text: `会話 ${marker}` }]),
      JSON.stringify({ statements: [`要約 ${marker}`], ai_observations: [], unconfirmed: [] }),
    ],
  });
}

async function setLevel(demoId: string, level: string) {
  await db.execute({
    sql: `INSERT INTO learning (demo_id, level, wants, current_plan, previous_plan, rev, updated_at)
          VALUES (?, ?, 'x', NULL, NULL, 0, 'x')`,
    args: [demoId, level],
  });
}

describe("AI への入力", () => {
  it("その記事の本文・講座名・記事名・お店の概要・質問だけが入り、ほかの記事・正解・面談は入らない", async () => {
    await putTheme("predecessor", "MARK-SENIOR-面談");
    await putTheme("successor", "MARK-SUCC-面談");
    const ai = fakeAi();
    const answer = await ask(ai, Q);
    expect(answer).toEqual({ text: OK_OUT.answer, terms: OK_OUT.terms });
    expect(ai.requests).toHaveLength(1);

    const text = allText(ai);
    const course = getCourses().find((c) => c.id === "cashflow")!;
    const target = course.articles.find((a) => a.no === 1)!;
    expect(text).toContain(course.title);
    expect(text).toContain(target.title);
    for (const line of target.body) expect(text).toContain(line);
    expect(text).toContain(COMPANY_CONTEXT);
    expect(text).toContain("減価償却費って何ですか？");

    // ほかの記事（同じ講座・ほかの講座とも）は入らない
    for (const c of getCourses()) {
      for (const a of c.articles) {
        if (c.id === "cashflow" && a.no === 1) continue;
        expect(text).not.toContain(a.title);
      }
      // 問題文も入らない
      for (const q of c.questions) expect(text).not.toContain(q.question);
    }
    // 面談の目印・診断・正解の一覧は入らない
    expect(text).not.toContain("MARK-SENIOR");
    expect(text).not.toContain("MARK-SUCC");
    expect(text).not.toContain("正解");
    expect(text).not.toContain('"answer":"B"');
  });

  it("50 秒の予算で呼ぶ（maxDuration 60 秒より短い）", async () => {
    const ai = fakeAi();
    await ask(ai, Q);
    expect(ASK_BUDGET_MS).toBe(50_000);
    expect(ai.requests[0].budgetMs).toBe(50_000);
    expect(ai.requests[0].timeoutMs).toBeLessThanOrEqual(50_000);
  });

  it("Lv1 はたとえ話、Lv2 は問いかけの指示に変わる（レベルは learning の state から。無ければ Lv1）", async () => {
    const ai1 = fakeAi();
    await ask(ai1, Q);
    expect(ai1.requests[0].system).toContain(ASK_LEVEL_GUIDE_LV1);
    expect(ai1.requests[0].system).not.toContain(ASK_LEVEL_GUIDE_LV2);
    expect(ai1.requests[0].system).toContain("たとえ話");

    await setLevel(DEMO_B, "Lv2");
    const ai2 = fakeAi();
    await ask(ai2, Q, "successor", DEMO_B);
    expect(ai2.requests[0].system).toContain(ASK_LEVEL_GUIDE_LV2);
    expect(ai2.requests[0].system).not.toContain(ASK_LEVEL_GUIDE_LV1);
    expect(ai2.requests[0].system).toContain("この数字から何が分かる？");
    expect(JSON.stringify(ai2.requests[0].messages)).toContain("Lv2");
  });

  it("指示文に4つの決まり（記事に無い数字・専門家・300字・関係ない質問）が入っている", async () => {
    const ai = fakeAi();
    await ask(ai, Q);
    const sys = ai.requests[0].system;
    expect(sys).toContain("記事には書かれていません");
    expect(sys).toContain("専門家に確認");
    expect(sys).toContain("300字程度");
    expect(sys).toContain("講座の内容に戻る");
  });

  it("会話は保存しない（DB の行が増えない）", async () => {
    const count = async () => {
      let n = 0;
      for (const t of ["learning", "course_progress", "theme_records"]) {
        const rs = await db.execute(`SELECT COUNT(*) AS n FROM ${t}`);
        n += Number(rs.rows[0].n);
      }
      return n;
    };
    const before = await count();
    await ask(fakeAi(), Q);
    expect(await count()).toBe(before);
  });
});

describe("入力の検証", () => {
  it("講座と記事は lib/courses.ts の組み合わせだけ", async () => {
    const ai = fakeAi();
    await expectStatus(ask(ai, { ...Q, courseId: "unknown" }), 400);
    await expectStatus(ask(ai, { ...Q, articleNo: 99 }), 400);
    await expectStatus(ask(ai, { ...Q, articleNo: 0 }), 400);
    await expectStatus(ask(ai, { ...Q, articleNo: "1" }), 400);
    await expectStatus(ask(ai, { ...Q, articleNo: 1.5 }), 400);
    await expectStatus(ask(ai, { ...Q, articleNo: undefined }), 400);
    expect(ai.requests).toHaveLength(0);
    // 3講座 × 3記事は通る
    for (const c of getCourses()) for (const a of c.articles) await ask(ai, { ...Q, courseId: c.id, articleNo: a.no });
    expect(ai.requests).toHaveLength(9);
  });

  it("質問は空でない・200文字以内・制御文字や見えない書式文字なし", async () => {
    const ai = fakeAi();
    for (const bad of [undefined, null, 1, "", "   ", "あ".repeat(201)]) {
      await expectStatus(ask(ai, { ...Q, question: bad }), 400);
    }
    const ch = (code: number) => String.fromCharCode(code);
    for (const code of [0x0a, 0x0d, 0x09, 0x00, 0x7f, 0x200b, 0x200e, 0x202e, 0x2066, 0xfeff, 0x2028, 0x2029]) {
      await expectStatus(ask(ai, { ...Q, question: `利益${ch(code)}とは` }), 400);
    }
    // 末尾の改行も不可
    await expectStatus(ask(ai, { ...Q, question: "利益とは\n" }), 400);
    expect(ai.requests).toHaveLength(0);

    expect(validateAskQuestion("あ".repeat(200))).toHaveLength(200);
    expect(validateAskQuestion("  利益とは？ ")).toBe("利益とは？");
  });
});

describe("役割の制限", () => {
  function post(body: unknown) {
    return new NextRequest("http://localhost:3000/api/learning/ask", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const env = (role: Role): ApiEnv => ({ getSession: async () => ({ demoId: DEMO_A, role }), getDb: async () => db });
  const callApi = (ai: FakeJsonAi, role: Role, body: unknown) => {
    const req = post(body);
    return handleJsonApi(
      req,
      ASK_API_OPTIONS,
      async ({ session, db }) => ({
        answer: await askAboutArticle({ db, ai }, session.demoId, session.role, await readJsonBody(req)),
      }),
      env(role),
    );
  };

  it("explain と同じく後継者のみ。先代は 403 で AI を呼ばない", async () => {
    expect(ASK_API_OPTIONS.roles).toEqual(["successor"]);
    const ai = fakeAi();
    const res = await callApi(ai, "predecessor", Q);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "この画面は後継者として入ると使えます" });
    // lib 側でも先代は通さない
    await expectStatus(ask(ai, Q, "predecessor"), 403);
    expect(ai.requests).toHaveLength(0);
  });

  it("後継者は { ok: true, answer: { text, terms } } を受け取る", async () => {
    const res = await callApi(fakeAi(), "successor", Q);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, answer: { text: OK_OUT.answer, terms: OK_OUT.terms } });
  });

  it("AI の失敗は 502 で、内部の例外の本文は返さない", async () => {
    const res = await callApi(fakeAi(["THROW", "THROW"]), "successor", Q);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("SECRET-DETAIL");
  });
});

describe("AI の失敗と回数上限", () => {
  it("AI の例外は 502", async () => {
    await expectStatus(ask(fakeAi(["THROW", "THROW"]), Q), 502);
  });

  it("壊れた返事は1回だけ再送。2回とも壊れていたら 502", async () => {
    const ok = fakeAi(["not json"]);
    expect((await ask(ok, Q)).text).toBe(OK_OUT.answer);
    expect(ok.requests).toHaveLength(2);

    const bad = fakeAi(["not json", { answer: "", terms: [] }]);
    await expectStatus(ask(bad, Q), 502);
    expect(bad.requests).toHaveLength(2);
  });

  it("回数上限は 429 で、AI を呼ばない", async () => {
    await db.execute({
      sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'successor', 150, 'x')`,
      args: [DEMO_A],
    });
    const ai = fakeAi();
    await expectStatus(ask(ai, Q), 429);
    expect(ai.requests).toHaveLength(0);
  });

  it("terms は形の正しいものを3件まで", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ term: `語${i}`, meaning: `意味${i}` }));
    expect(parseAskAnswer({ answer: "答え", terms: [{ term: "", meaning: "x" }, 1, ...many] })?.terms).toEqual(
      many.slice(0, 3),
    );
    expect(parseAskAnswer({ answer: "答え", terms: [] })).toEqual({ text: "答え", terms: [] });
    expect(parseAskAnswer({ answer: "答え" })).toBeNull();
  });
});
