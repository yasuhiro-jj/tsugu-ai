// 2.0 の講座（最初の4つ）のテスト。架空のデータだけを使う。

import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "@/lib/v2/access";
import { createAuditLog } from "@/lib/v2/audit";
import { createLocalAuth } from "@/lib/v2/auth";
import { COURSES, gradeQuiz } from "@/lib/v2/courses";
import * as service from "@/lib/v2/service";
import { V2Error } from "@/lib/v2/types";
import { completeInterview, createDeps, SID_A, SID_B } from "./helpers";

const SECRET = "ZZ-KOUZA-HIMITSU-6620";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("講座の中身", () => {
  it("最初の4講座がそろっていて、どれも読む教材・架空の例・確認問題・実践ワークがある", () => {
    expect(COURSES.map((c) => `${c.no} ${c.title}`)).toEqual([
      "01 店の未来と守りたいこと",
      "02 後継者がいない場合の選択肢",
      "03 相談前の情報整理",
      "14 AIを安全に使う",
    ]);
    for (const c of COURSES) {
      expect(c.body.length).toBeGreaterThanOrEqual(2);
      expect(c.example.length).toBeGreaterThan(20);
      expect(c.quiz.question.endsWith("？")).toBe(true);
      expect(c.fields.length + c.checks.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("教材は、承継や売却を強制せず、結論を断定しない", () => {
    const text = JSON.stringify(COURSES);
    expect(text).not.toMatch(/売却すべき|継ぐべき|必ず売却|問題ありません。|保証します/);
    expect(text).toContain("保留");
    expect(text).toContain("専門家");
    // 外部へのリンクや、実在の金額は入れていない
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/[0-9０-９]+\s*万?円/);
  });

  it("確認問題の答え合わせは、決まった処理で行う", () => {
    for (const c of COURSES) {
      expect(gradeQuiz(c.id, c.quiz.correct)).toBe(true);
      expect(gradeQuiz(c.id, c.quiz.correct === "yes" ? "no" : "yes")).toBe(false);
    }
    // 4講座とも、AI や他人に決めさせない・推測で埋めない、が正解
    expect(COURSES.every((c) => c.quiz.correct === "no")).toBe(true);
  });
});

describe("学びの記録を保存する", () => {
  it("面談を始める前でも保存でき、あとで面談を始めても記録は残る", async () => {
    const deps = createDeps();
    const view = await service.saveLearning(deps, SID_A, "values", {
      quiz: "no",
      notes: { kept: "常連さんとの会話", change: "予約の方法" },
    });
    expect(view.learning.values).toEqual({
      quiz: "no",
      notes: { kept: "常連さんとの会話", change: "予約の方法" },
      checks: {},
    });
    // 面談の入れ物も用意されている（最初の質問が1つ出ている）
    expect(view.phase).toBe("interview");
    expect(view.log).toHaveLength(1);
    const started = await service.start(deps, SID_A);
    expect(started.learning.values.notes.kept).toBe("常連さんとの会話");
    expect(started.log).toHaveLength(1);
  });

  it("面談の途中でも、終わったあとでも保存できる。面談や資料の下書きは変わらない", async () => {
    const deps = createDeps();
    const done = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", [done.items[0].id]);
    const before = await service.generateReport(deps, SID_A);
    const after = await service.saveLearning(deps, SID_A, "ai-safety", {
      quiz: "yes",
      checks: { purpose: "yes", secrets: "unknown" },
    });
    expect(after.learning["ai-safety"]).toEqual({ quiz: "yes", notes: {}, checks: { purpose: "yes", secrets: "unknown" } });
    expect(after.report).toEqual(before.report);
    expect(after.items).toEqual(before.items);
    expect(after.log).toEqual(before.log);
  });

  it("保存し直すと、その講座の記録が入れ替わる。空にした欄は残らない", async () => {
    const deps = createDeps();
    await service.saveLearning(deps, SID_A, "options", { notes: { interest: "従業員", ask: "費用は" } });
    const view = await service.saveLearning(deps, SID_A, "options", { notes: { interest: "  ", keep: "味" } });
    expect(view.learning.options).toEqual({ quiz: null, notes: { keep: "味" }, checks: {} });
  });

  it("正しくない指定は受け付けず、何も変わらない", async () => {
    const deps = createDeps();
    await service.saveLearning(deps, SID_A, "values", { notes: { kept: "元の内容" } });
    const before = (await service.getView(deps, SID_A))!;
    const cases: [unknown, unknown][] = [
      ["unknown-course", { quiz: "no" }],
      ["values", null],
      ["values", []],
      ["values", { quiz: "maybe" }],
      ["values", { notes: { nothing: "x" } }],
      ["values", { notes: { kept: 123 } }],
      ["values", { notes: { kept: "あ".repeat(301) } }],
      ["values", { notes: [] }],
      ["values", { checks: { purpose: "yes" } }], // この講座に確認リストはない
      ["ai-safety", { checks: { purpose: "ok" } }],
      ["ai-safety", { notes: { kept: "x" } }], // この講座に自由に書く欄はない
      ["values", JSON.parse('{"notes":{"__proto__":"x"}}')],
      [null, { quiz: "no" }],
    ];
    for (const [courseId, raw] of cases) {
      await expect(service.saveLearning(deps, SID_A, courseId, raw), JSON.stringify([courseId, raw])).rejects.toBeInstanceOf(
        V2Error,
      );
    }
    expect((await service.getView(deps, SID_A))).toEqual(before);
  });

  it("「すべて消す」で、学びの記録も残らない", async () => {
    const deps = createDeps();
    await service.saveLearning(deps, SID_A, "values", { notes: { kept: SECRET } });
    await service.reset(deps, SID_A);
    expect((await service.getView(deps, SID_A))).toBeNull();
    expect((await deps.store.size())).toBe(0);
  });
});

describe("学びの記録は本人用。相談資料・記録・ほかの人に出ない", () => {
  it("資料生成の入力にも、資料にも、ログにも出ない", async () => {
    const logs: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args);
      });
    }
    const deps = createDeps();
    const done = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    await service.saveLearning(deps, SID_A, "prepare", {
      quiz: "no",
      notes: { topic: `${SECRET}を相談したい`, questions: SECRET, share: SECRET },
    });
    await service.setReportSettings(deps, SID_A, "bank", done.items.map((i) => i.id));
    const view = await service.generateReport(deps, SID_A);
    expect(JSON.stringify(view.report)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    // 整理した項目（載せる候補）にも混ざらない
    expect(JSON.stringify(view.items)).not.toContain(SECRET);
  });

  it("別の人からは見えない。操作の記録にも本文は残らない", async () => {
    const env: Env = { deps: createDeps(), auth: createLocalAuth(), audit: createAuditLog() };
    const a = "A".repeat(43);
    const b = "B".repeat(43);
    await handle(env, a, { action: "saveLearning", courseId: "values", learning: { notes: { kept: SECRET } } });
    const other = await handle(env, b, { action: "saveLearning", courseId: "values", learning: { quiz: "no" } });
    expect(JSON.stringify(other)).not.toContain(SECRET);
    expect(other!.learning.values).toEqual({ quiz: "no", notes: {}, checks: {} });
    expect(JSON.stringify(env.audit.list())).not.toContain(SECRET);
    expect(env.audit.list().filter((e) => e.action === "saveLearning" && e.outcome === "ok")).toHaveLength(2);
    // 講座から始めた人の入れ物にも、持ち主が記録される
    expect((await env.deps.store.size())).toBe(2);
  });

  it("別のセッションの記録は、内容も存在も見えない", async () => {
    const deps = createDeps();
    await service.saveLearning(deps, SID_A, "values", { notes: { kept: SECRET } });
    expect((await service.getView(deps, SID_B))).toBeNull();
    expect(JSON.stringify(await service.start(deps, SID_B))).not.toContain(SECRET);
  });
});
