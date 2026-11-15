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

describe("講座03の相談メモは、本人が選んだものだけ相談資料に載る", () => {
  async function ready() {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const view = await service.saveLearning(deps, SID_A, "prepare", {
      notes: { topic: "引き継ぎの進め方", questions: `${SECRET}について聞く`, share: "店の概要だけ渡す" },
    });
    return { deps, view };
  }

  it("面談のあとに書いたメモは、載せる候補に並ぶ。初期は未選択", async () => {
    const { view } = await ready();
    const notes = view.items.filter((i) => i.kind === "note");
    expect(notes.map((i) => i.text).sort()).toEqual([`当日聞きたい質問：${SECRET}について聞く`, "相談したいこと：引き継ぎの進め方"].sort());
    expect(notes.every((i) => i.selected === false && i.theme === null)).toBe(true);
  });

  it("面談の前に書いたメモも、面談が終わると候補に並ぶ", async () => {
    const deps = createDeps();
    const before = await service.saveLearning(deps, SID_A, "prepare", { notes: { topic: "先に書いたメモ" } });
    expect(before.items).toEqual([]);
    const done = await completeInterview(deps, SID_A);
    expect(done.items.filter((i) => i.kind === "note").map((i) => i.text)).toEqual(["相談したいこと：先に書いたメモ"]);
  });

  it("選んだメモだけが資料に入り、選ばなかったメモは資料生成の入力にも資料にも出ない", async () => {
    const { deps, view } = await ready();
    const topic = view.items.find((i) => i.noteKey === "prepare.topic")!;
    await service.setReportSettings(deps, SID_A, "bank", [topic.id]);
    const done = await service.generateReport(deps, SID_A);
    expect(done.report!.memo).toEqual(["相談したいこと：引き継ぎの進め方"]);
    expect(JSON.stringify(done.report)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain("店の概要だけ渡す");
    // メモを選んでも、面談のテーマの質問は足されない
    expect(done.report!.questions).toEqual(["事業の引き継ぎについて、ほかにどのような選択肢と相談先がありますか？"]);
  });

  it("メモを書き直すと「載せる」が外れ、ID も変わり、古い資料は破棄される", async () => {
    const { deps, view } = await ready();
    const topic = view.items.find((i) => i.noteKey === "prepare.topic")!;
    await service.setReportSettings(deps, SID_A, "bank", [topic.id]);
    await service.generateReport(deps, SID_A);
    const changed = await service.saveLearning(deps, SID_A, "prepare", { notes: { topic: `${SECRET}に書き直した` } });
    const after = changed.items.find((i) => i.noteKey === "prepare.topic")!;
    expect(after.selected).toBe(false);
    expect(after.id).not.toBe(topic.id);
    expect(changed.report).toBeNull();
    // 古い画面が持つ ID では選べない
    await expect(service.setReportSettings(deps, SID_A, "bank", [topic.id])).rejects.toMatchObject({ status: 404 });
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({ code: "nothing_selected" });
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
  });

  it("メモを消すと、候補からも消える。変えていないメモの選択はそのまま", async () => {
    const { deps, view } = await ready();
    const topic = view.items.find((i) => i.noteKey === "prepare.topic")!;
    const questions = view.items.find((i) => i.noteKey === "prepare.questions")!;
    await service.setReportSettings(deps, SID_A, "bank", [topic.id, questions.id]);
    const changed = await service.saveLearning(deps, SID_A, "prepare", { notes: { topic: "引き継ぎの進め方" } });
    expect(changed.items.some((i) => i.noteKey === "prepare.questions")).toBe(false);
    expect(JSON.stringify(changed.items)).not.toContain(SECRET);
    expect(changed.items.find((i) => i.noteKey === "prepare.topic")!.selected).toBe(true);
  });

  it("選んだメモで資料を作ったあとにメモを消すと、資料も破棄される", async () => {
    const { deps, view } = await ready();
    const topic = view.items.find((i) => i.noteKey === "prepare.topic")!;
    await service.setReportSettings(deps, SID_A, "bank", [topic.id]);
    expect((await service.generateReport(deps, SID_A)).report!.memo).toHaveLength(1);
    const cleared = await service.saveLearning(deps, SID_A, "prepare", { notes: {} });
    expect(cleared.report).toBeNull();
    expect(cleared.items.some((i) => i.kind === "note")).toBe(false);
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({ code: "nothing_selected" });
  });

  it("面談の前に書いたメモは、「ここで終えて確認へ進む」で終えても候補に並ぶ（未選択）", async () => {
    const deps = createDeps();
    await service.saveLearning(deps, SID_A, "prepare", { notes: { questions: SECRET } });
    await service.start(deps, SID_A);
    const done = await service.finishEarly(deps, SID_A);
    const notes = done.items.filter((i) => i.kind === "note");
    expect(notes.map((i) => i.noteKey)).toEqual(["prepare.questions"]);
    expect(notes[0].selected).toBe(false);
  });

  it("ほかの講座のメモは、候補にならない。メモの項目は、内容の確認の画面からは直せない・外せない", async () => {
    const { deps, view } = await ready();
    const other = await service.saveLearning(deps, SID_A, "values", { notes: { kept: SECRET } });
    expect(other.items.filter((i) => i.kind === "note")).toHaveLength(2);
    expect(other.items.some((i) => i.text.includes("長年大切にしてきたこと"))).toBe(false);
    const note = view.items.find((i) => i.kind === "note")!;
    await expect(service.editItem(deps, SID_A, note.id, "書き換え")).rejects.toBeInstanceOf(V2Error);
    await expect(service.removeItem(deps, SID_A, note.id)).rejects.toBeInstanceOf(V2Error);
  });
});

describe("自分に合う学びを選ぶ（入口の質問）", () => {
  it("質問は5つで、どれも答えなくてよい。何も答えなければ最初の講座から", async () => {
    const { GUIDE_QUESTIONS, suggestLearning } = await import("@/lib/v2/learning-guide");
    expect(GUIDE_QUESTIONS.map((q) => q.key)).toEqual(["role", "concern", "successor", "start", "urgent"]);
    expect(suggestLearning({})).toEqual({ notices: [], interviewFirst: false, courses: ["values", "ai-safety"] });
  });

  it("急ぎの期限や相談があるときは、学びを待たずに専門家へ相談するよう伝える", async () => {
    const { suggestLearning } = await import("@/lib/v2/learning-guide");
    const s = suggestLearning({ urgent: "yes" });
    expect(s.notices[0]).toContain("待たずに");
    expect(s.notices[0]).toContain("専門家");
    expect(suggestLearning({ urgent: "no" }).notices).toEqual([]);
    expect(suggestLearning({ urgent: "unsure" }).notices).toEqual([]);
  });

  it("答えに合わせて候補が変わる。面談から始めたい人には面談を勧める", async () => {
    const { suggestLearning } = await import("@/lib/v2/learning-guide");
    expect(suggestLearning({ successor: "none", concern: "future" }).courses).toEqual(["options", "values", "ai-safety"]);
    expect(suggestLearning({ start: "report" })).toMatchObject({ interviewFirst: true, courses: ["prepare", "ai-safety"] });
    expect(suggestLearning({ start: "talk" }).interviewFirst).toBe(true);
    expect(suggestLearning({ start: "read" }).interviewFirst).toBe(false);
    expect(suggestLearning({ start: "choose" }).courses).toEqual(["values", "options", "prepare", "ai-safety"]);
    expect(suggestLearning({ concern: "handover" }).courses).toEqual(["options", "prepare", "ai-safety"]);
  });

  it("まだ用意のない講座は、あるように見せない", async () => {
    const { suggestLearning } = await import("@/lib/v2/learning-guide");
    expect(suggestLearning({ concern: "money" }).notices.join("")).toContain("専門家の確認が済んでから");
    expect(suggestLearning({ role: "successor" }).notices.join("")).toContain("まだ用意できていません");
    expect(suggestLearning({ role: "owner" }).notices).toEqual([]);
  });

  it("人を評価・格付けしない。どの答えでも、点数や判定は返さない", async () => {
    const { GUIDE_QUESTIONS, suggestLearning } = await import("@/lib/v2/learning-guide");
    const text = JSON.stringify(GUIDE_QUESTIONS);
    expect(text).not.toMatch(/レベル|点数|診断結果|不合格|初心者/);
    for (const role of ["owner", "candidate", "successor", "other"]) {
      for (const start of ["read", "talk", "report", "choose"]) {
        const s = suggestLearning({ role, start, concern: "unsure", successor: "no_answer", urgent: "unsure" });
        expect(Object.keys(s).sort()).toEqual(["courses", "interviewFirst", "notices"]);
        expect(s.courses.length).toBeGreaterThan(0);
        expect(JSON.stringify(s)).not.toMatch(/すべき|べきです|向いていません/);
      }
    }
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
    // 候補には並ぶが、「載せる」はすべて未選択（本人が選ぶまで資料に入らない）
    const notes = view.items.filter((i) => i.kind === "note");
    expect(notes.map((i) => i.noteKey).sort()).toEqual(["prepare.questions", "prepare.topic"]);
    expect(notes.every((i) => i.selected === false)).toBe(true);
    // 「渡す項目／渡さない項目」は、候補にもならない
    expect(view.items.some((i) => i.noteKey === "prepare.share")).toBe(false);
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
    for (const token of [a, b]) {
      const actor = (await env.auth.resolve(token))!;
      const stored = (await env.deps.store.get(`${actor.tenantId}/${actor.userId}`))!;
      expect(stored.owner).toEqual({ tenantId: actor.tenantId, userId: actor.userId });
    }
  });

  it("別のセッションの記録は、内容も存在も見えない", async () => {
    const deps = createDeps();
    await service.saveLearning(deps, SID_A, "values", { notes: { kept: SECRET } });
    expect((await service.getView(deps, SID_B))).toBeNull();
    expect(JSON.stringify(await service.start(deps, SID_B))).not.toContain(SECRET);
  });
});
