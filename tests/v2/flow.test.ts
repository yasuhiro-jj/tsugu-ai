// 2.0 試作の機能テスト（Notion「04」の FUNC-01〜06）。架空のデータだけを使う。

import { describe, expect, it } from "vitest";
import { THEMES } from "@/lib/v2/content";
import * as service from "@/lib/v2/service";
import { V2Error } from "@/lib/v2/types";
import { completeInterview, createDeps, SID_A } from "./helpers";

describe("FUNC-01 後継者を登録せずに始め、質問を1つずつ進められる", () => {
  it("始めると最初の質問が1つだけ出る（役割や後継者の登録は不要）", async () => {
    const deps = createDeps();
    const view = await service.start(deps, SID_A);
    expect(view.phase).toBe("interview");
    expect(view.currentTheme).toBe("legacy");
    expect(view.log).toHaveLength(1);
    expect(view.log[0].who).toBe("ai");
    expect(view.log[0].text).toContain(THEMES[0].question);
    expect(view.log[0].text).toContain("答えたくないことは飛ばせます");
  });

  it("AI の発言は毎回、質問を1つだけ含む", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const aiTurns = view.log.filter((t) => t.who === "ai");
    expect(aiTurns.length).toBe(THEMES.length * 2);
    for (const turn of aiTurns) {
      expect(turn.text.match(/？/g) ?? []).toHaveLength(1);
    }
  });

  it("7テーマを順に進み、終わると本人確認へ移る", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    expect(view.phase).toBe("review");
    expect(view.currentTheme).toBeNull();
    for (const t of THEMES) expect(view.themes[t.key].status).toBe("answered");
  });

  it("もう一度「始める」を押しても、続きから再開する（中断しても消えない）", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, "常連さんとの関係を残したい");
    const again = await service.start(deps, SID_A);
    expect(again.log).toHaveLength(3);
    expect(again.themes.legacy.answers).toEqual(["常連さんとの関係を残したい"]);
  });
});

describe("FUNC-02 回答を飛ばせて、不明は未確認として表示する", () => {
  it("飛ばしたテーマは「未確認」になり、発言や整理案は作られない", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.skip(deps, SID_A); // legacy を飛ばす
    const view = await service.finishEarly(deps, SID_A);
    expect(view.themes.legacy.status).toBe("skipped");
    const legacy = view.items.filter((i) => i.theme === "legacy");
    expect(legacy).toHaveLength(1);
    expect(legacy[0].kind).toBe("unconfirmed");
    expect(legacy[0].text).toContain("答えていません");
  });

  it("未確認を数値のゼロや「問題なし」に変えない", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    const view = await service.finishEarly(deps, SID_A);
    const unconfirmed = view.items.filter((i) => i.kind === "unconfirmed");
    expect(unconfirmed.length).toBeGreaterThanOrEqual(THEMES.length);
    for (const item of view.items) {
      expect(item.text).not.toMatch(/問題なし|問題ありません|0円|ゼロ/);
    }
    expect(view.items.filter((i) => i.kind === "statement")).toHaveLength(0);
    expect(view.items.filter((i) => i.kind === "ai_note")).toHaveLength(0);
  });

  it("資料で確かめていない事柄（借入・賃貸・許認可・雇用）は、答えても未確認のまま残る", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const texts = view.items.filter((i) => i.kind === "unconfirmed").map((i) => i.text);
    expect(texts.some((t) => t.includes("借入"))).toBe(true);
    expect(texts.some((t) => t.includes("賃貸"))).toBe(true);
    expect(texts.some((t) => t.includes("許認可"))).toBe(true);
    expect(texts.some((t) => t.includes("雇用条件"))).toBe(true);
  });
});

describe("FUNC-03 本人が要約を直せて、発言・整理案・未確認が区別される", () => {
  it("本人の発言は入力した文章そのまま（言い換えない・足さない）", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A, (theme, round) => `【${theme}】架空の答え その${round}`);
    const statements = view.items.filter((i) => i.kind === "statement");
    expect(statements).toHaveLength(THEMES.length * 2);
    expect(statements[0].text).toBe("【legacy】架空の答え その1");
    expect(view.items.filter((i) => i.kind === "ai_note")).toHaveLength(THEMES.length);
  });

  it("項目を直すと「ご本人が修正」の印がつき、消すこともできる", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const note = view.items.find((i) => i.kind === "ai_note")!;
    const edited = await service.editItem(deps, SID_A, note.id, "それは違います。味のことを相談したいです。");
    const after = edited.items.find((i) => i.id === note.id)!;
    expect(after.text).toBe("それは違います。味のことを相談したいです。");
    expect(after.edited).toBe(true);
    expect(after.kind).toBe("ai_note");

    const removed = await service.removeItem(deps, SID_A, note.id);
    expect(removed.items.find((i) => i.id === note.id)).toBeUndefined();
  });

  it("空の文章・長すぎる文章・存在しない項目は受け付けない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const id = view.items[0].id;
    await expect(service.editItem(deps, SID_A, id, "   ")).rejects.toBeInstanceOf(V2Error);
    await expect(service.editItem(deps, SID_A, id, "あ".repeat(1001))).rejects.toBeInstanceOf(V2Error);
    await expect(service.editItem(deps, SID_A, "no-such-id", "直す")).rejects.toMatchObject({ status: 404 });
  });
});

describe("FUNC-05 承継しない・保留も選べ、断定しない。資料は自動送信されない", () => {
  it("「店を閉じる」「まだ決めない」を選べる。何も選ばなくてもよい", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const view = await service.setOptions(deps, SID_A, ["closure", "undecided"]);
    expect(view.options).toEqual(["closure", "undecided"]);
    const option = view.items.find((i) => i.kind === "option")!;
    expect(option.text).toContain("店を閉じる");
    expect(option.text).toContain("まだ決めない");
    expect(option.text).toContain("まだ決めたわけではありません");
    expect(option.selected).toBe(false);

    const none = await service.setOptions(deps, SID_A, []);
    expect(none.options).toEqual([]);
    expect(none.items.find((i) => i.kind === "option")).toBeUndefined();
  });

  it("知らない選択肢は受け付けない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await expect(service.setOptions(deps, SID_A, ["sell_now"])).rejects.toBeInstanceOf(V2Error);
  });

  it("資料は雇用や契約の結論を断定せず、専門家への確認を案内する", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", view.items.map((i) => i.id));
    const done = await service.generateReport(deps, SID_A);
    const report = done.report!;
    const all = JSON.stringify(report);
    expect(all).not.toMatch(/継続できます|引き継げます|移転できます|すべきです|べきです|問題ありません/);
    expect(report.notes.join("")).toContain("専門家");
    expect(report.aiNotes.every((t) => t.includes("可能性"))).toBe(true);
  });

  it("送信・共有の機能を持たない（操作の一覧に存在しない）", async () => {
    const { ACTIONS } = await import("@/lib/v2/dispatch");
    expect(ACTIONS.some((a) => /send|share|mail|publish|export/i.test(a))).toBe(false);
  });
});

describe("FUNC-06 中断・処理失敗で情報を作り足さず、再試行の方法を示す", () => {
  it("AI が失敗したら回答は保存されず、やり直し方を伝える。もう一度送ると進む", async () => {
    let fail = true;
    const deps = createDeps({
      ai: async (req) => {
        if (fail) throw new Error("boom");
        const { mockInterviewAi } = await import("@/lib/v2/mock");
        return mockInterviewAi(req);
      },
    });
    await service.start(deps, SID_A);
    const before = service.getView(deps, SID_A)!;
    await expect(service.answer(deps, SID_A, "架空の答え")).rejects.toMatchObject({
      code: "ai_failed",
      status: 503,
      message: expect.stringContaining("もう一度お試しください"),
    });
    expect(service.getView(deps, SID_A)).toEqual(before);

    fail = false;
    const after = await service.answer(deps, SID_A, "架空の答え");
    expect(after.themes.legacy.answers).toEqual(["架空の答え"]);
  });

  it("AI が空の返事を返したときも、作り足さずに失敗として扱う", async () => {
    const deps = createDeps({ ai: async () => ({ reply: "  ", action: "followup" }) });
    await service.start(deps, SID_A);
    await expect(service.answer(deps, SID_A, "架空の答え")).rejects.toMatchObject({ code: "ai_failed" });
    expect(service.getView(deps, SID_A)!.log).toHaveLength(1);
  });

  it("AI が聞き返しを続けようとしても、1テーマ1回で次へ進む", async () => {
    const deps = createDeps({ ai: async () => ({ reply: "もう少し教えてください？", action: "followup" }) });
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, "答え1");
    const view = await service.answer(deps, SID_A, "答え2");
    expect(view.currentTheme).toBe("future");
  });

  it("資料の作成に失敗したら、資料は作られず、やり直し方を伝える", async () => {
    const deps = createDeps({
      generator: async () => {
        throw new Error("boom");
      },
    });
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", [view.items[0].id]);
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({
      code: "report_failed",
      message: expect.stringContaining("もう一度お試しください"),
    });
    expect(service.getView(deps, SID_A)!.report).toBeNull();
  });

  it("面談を始めていない人の操作は受け付けない", async () => {
    const deps = createDeps();
    await expect(service.answer(deps, SID_A, "答え")).rejects.toMatchObject({ code: "no_session" });
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({ code: "no_session" });
  });

  it("本人が確認する前は、資料を作れない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", [view.items[0].id]);
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({ code: "not_confirmed" });
  });

  it("「すべて消す」で面談の内容が残らない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.reset(deps, SID_A);
    expect(service.getView(deps, SID_A)).toBeNull();
    expect(deps.store.size()).toBe(0);
  });
});
