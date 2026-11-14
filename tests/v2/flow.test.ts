// 2.0 試作の機能テスト（Notion「04」の FUNC-01〜06）。架空のデータだけを使う。

import { describe, expect, it } from "vitest";
import { PREP_AREAS, THEMES } from "@/lib/v2/content";
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

describe("AI の返事は本人の言葉をそのまま引用し、言い換えない", () => {
  it("聞き返しの前に、本人の言葉を引用して受け止める", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    const view = await service.answer(deps, SID_A, "常連さんとの関係を残したいです。");
    const last = view.log.at(-1)!;
    expect(last.who).toBe("ai");
    // 受け止めの一文（引用）と、質問は分けて持つ
    expect(last.heard).toBe("「常連さんとの関係を残したいです」とお話しくださったのですね。");
    expect(last.text).toBe(THEMES[0].followup);
  });

  it("次の質問へ進むときも、本人の言葉を受け止めてから1つだけ質問する", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, "味を残したい");
    const view = await service.answer(deps, SID_A, "仕込みを一緒にやりたい");
    const last = view.log.at(-1)!;
    expect(last.heard).toBe("「仕込みを一緒にやりたい」とお話しくださったのですね。");
    expect(last.text).toContain(THEMES[1].question);
    expect(last.text.match(/？/g) ?? []).toHaveLength(1);
  });

  it("長い言葉は途中で切って引用し、内容を足さない", async () => {
    const { echo } = await import("@/lib/v2/echo");
    const long = "あ".repeat(100);
    expect(echo(long)).toBe(`「${"あ".repeat(40)}…」とお話しくださったのですね。`);
    expect(echo("  短い\n答え。 ")).toBe("「短い 答え」とお話しくださったのですね。");
  });
});

describe("相談の目的は本人が書き直せて、作成日が入る", () => {
  it("書き直した目的がそのまま資料に載り、古い資料は破棄される", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const ids = [view.items[0].id];
    await service.setReportSettings(deps, SID_A, "bank", ids);
    const first = await service.generateReport(deps, SID_A);
    expect(first.report!.purpose).toBe("飲食店の今後と引き継ぎの準備について、選択肢と進め方を相談したい。");
    expect(first.report!.generatedAt).toBe("2026-11-10T00:00:00.000Z");

    const changed = await service.setReportSettings(deps, SID_A, "bank", ids, "従業員に引き継ぐ場合の進め方を聞きたい。");
    expect(changed.report).toBeNull();
    const second = await service.generateReport(deps, SID_A);
    expect(second.report!.purpose).toBe("従業員に引き継ぐ場合の進め方を聞きたい。");
    expect(deps.generatorInputs.at(-1)!.purpose).toBe("従業員に引き継ぐ場合の進め方を聞きたい。");
  });

  it("空の目的・長すぎる目的は受け付けず、何も変わらない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const ids = [view.items[0].id];
    await service.setReportSettings(deps, SID_A, "bank", ids);
    const before = (await service.getView(deps, SID_A))!;
    await expect(service.setReportSettings(deps, SID_A, "bank", ids, "  ")).rejects.toBeInstanceOf(V2Error);
    await expect(service.setReportSettings(deps, SID_A, "bank", ids, "あ".repeat(201))).rejects.toBeInstanceOf(V2Error);
    expect((await service.getView(deps, SID_A))).toEqual(before);
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

  it("準備リストは、面談でどう答えても、はじめは全分野が「まだ確認していません」", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const prep = view.items.filter((i) => i.kind === "prep");
    expect(prep).toHaveLength(PREP_AREAS.length);
    expect(prep.every((i) => i.text.endsWith("：まだ確認していません"))).toBe(true);
    expect(prep.every((i) => i.selected === false && i.theme === null)).toBe(true);
    expect(prep.some((i) => i.text.startsWith("借入・保証："))).toBe(true);
    expect(Object.values(view.prep).every((e) => e.status === null)).toBe(true);
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
    const after = edited.items.find((i) => i.text === "それは違います。味のことを相談したいです。")!;
    expect(after.edited).toBe(true);
    expect(after.kind).toBe("ai_note");
    // 直した項目は ID が変わる（古い画面が持っている ID は使えなくなる）
    expect(after.id).not.toBe(note.id);
    expect(edited.items.find((i) => i.id === note.id)).toBeUndefined();

    const removed = await service.removeItem(deps, SID_A, after.id);
    expect(removed.items.find((i) => i.id === after.id)).toBeUndefined();
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

describe("発言を消すと、面談の記録からも消える", () => {
  const WORD = "KESU-MEJIRUSHI-5521";

  it("回答の原文・会話の記録・AI が引用した一文のどこにも残らない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A, (theme, round) =>
      theme === "staff" && round === 1 ? `${WORD}のことです` : `${theme}の答え${round}`,
    );
    expect(JSON.stringify(view)).toContain(WORD);
    const target = view.items.find((i) => i.text.includes(WORD))!;
    const after = await service.removeItem(deps, SID_A, target.id);

    expect(JSON.stringify(after)).not.toContain(WORD);
    expect(JSON.stringify((await deps.store.get(SID_A)))).not.toContain(WORD);
    // 同じテーマのもう1つの答えは残る
    expect(after.themes.staff.answers).toEqual(["staffの答え2"]);
    expect(after.themes.staff.answerIds).toHaveLength(1);
    expect(after.themes.staff.status).toBe("answered");
    // AI の質問そのものは残る（引用だけが消える）
    expect(after.log.some((t) => t.who === "ai" && t.theme === "staff" && t.heard === undefined)).toBe(true);
  });

  it("そのテーマの答えが1つも残らなくなったら、未確認として残し、AI の整理案も消す", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    for (const item of view.items.filter((i) => i.kind === "statement" && i.theme === "work")) {
      await service.removeItem(deps, SID_A, item.id);
    }
    const after = (await service.getView(deps, SID_A))!;
    expect(after.themes.work.answers).toEqual([]);
    expect(after.themes.work.status).toBe("skipped");
    const work = after.items.filter((i) => i.theme === "work");
    expect(work.map((i) => [i.kind, i.text])).toEqual([
      ["unconfirmed", "「店の仕事と強み」については、答えが残っていません。"],
    ]);
    expect(work[0].selected).toBe(false);
  });

  it("本人が書き直した AI の整理案は、本人の言葉なので残す", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const note = view.items.find((i) => i.kind === "ai_note" && i.theme === "work")!;
    await service.editItem(deps, SID_A, note.id, "自分で書いたメモ");
    for (const item of view.items.filter((i) => i.kind === "statement" && i.theme === "work")) {
      await service.removeItem(deps, SID_A, item.id);
    }
    const after = (await service.getView(deps, SID_A))!;
    expect(after.items.some((i) => i.text === "自分で書いたメモ")).toBe(true);
  });

  it("書き直した発言を消しても、もとの原文は残らない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A, (theme, round) =>
      theme === "money" && round === 2 ? WORD : `${theme}の答え${round}`,
    );
    const target = view.items.find((i) => i.text === WORD)!;
    const edited = await service.editItem(deps, SID_A, target.id, "書き直した");
    const rewritten = edited.items.find((i) => i.text === "書き直した")!;
    const after = await service.removeItem(deps, SID_A, rewritten.id);
    expect(JSON.stringify(after)).not.toContain(WORD);
    expect(JSON.stringify(after)).not.toContain("書き直した");
  });

  it("消したあとは、古い資料も破棄される", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A, (theme, round) => (theme === "legacy" ? `${WORD}${round}` : `${theme}${round}`));
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", view.items.map((i) => i.id));
    expect(JSON.stringify((await service.generateReport(deps, SID_A)).report)).toContain(WORD);
    const after = await service.removeItem(deps, SID_A, view.items.find((i) => i.text === `${WORD}1`)!.id);
    expect(after.report).toBeNull();
  });
});

describe("消し残しを作らない（AI の返事・古い形・飛ばす・同じ文章）", () => {
  const WORD = "KESU-MEJIRUSHI-5521";

  it("AI が前の回答を聞き返しに混ぜても、その文は使わず、決まった質問に戻す", async () => {
    const deps = createDeps({
      ai: async (req) => ({ reply: `さきほどの「${req.answers[0]}」について、もう少し教えてください？`, action: "followup" }),
    });
    await service.start(deps, SID_A);
    const view = await service.answer(deps, SID_A, `${WORD}を大事にしたい`);
    const last = view.log.at(-1)!;
    expect(last.text).toBe(THEMES[0].followup);
    const item = (await service.finishEarly(deps, SID_A)).items.find((i) => i.text.includes(WORD))!;
    const after = await service.removeItem(deps, SID_A, item.id);
    expect(JSON.stringify(after)).not.toContain(WORD);
  });

  it("引用は、AI の返事ではなく今回の回答だけから作る。長すぎる聞き返しは使わない", async () => {
    const deps = createDeps({
      ai: async () => ({ reply: "あ".repeat(301), action: "followup", heard: "勝手な文章" }) as never,
    });
    await service.start(deps, SID_A);
    const view = await service.answer(deps, SID_A, "味を残したい");
    const last = view.log.at(-1)!;
    expect(last.heard).toBe("「味を残したい」とお話しくださったのですね。");
    expect(last.text).toBe(THEMES[0].followup);
    expect(JSON.stringify(view)).not.toContain("勝手な文章");
  });

  it("2つ目の答えを消しても、1つ目の答えとその引用は残る（消すのは選んだ発言だけ）", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, "一つ目の答え");
    await service.answer(deps, SID_A, `${WORD}二つ目`);
    const view = await service.finishEarly(deps, SID_A);
    const after = await service.removeItem(deps, SID_A, view.items.find((i) => i.text.includes(WORD))!.id);
    expect(JSON.stringify(after)).not.toContain(WORD);
    expect(after.themes.legacy.answers).toEqual(["一つ目の答え"]);
    expect(after.log.some((t) => t.heard === "「一つ目の答え」とお話しくださったのですね。")).toBe(true);
  });

  it("同じ文章を2回答えても、消すのは選んだ1つだけ", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, "同じ答え");
    await service.answer(deps, SID_A, "同じ答え");
    const view = await service.finishEarly(deps, SID_A);
    const same = view.items.filter((i) => i.text === "同じ答え");
    expect(same).toHaveLength(2);
    const after = await service.removeItem(deps, SID_A, same[0].id);
    expect(after.themes.legacy.answers).toEqual(["同じ答え"]);
    expect(after.log.filter((t) => t.who === "me")).toHaveLength(1);
    expect(after.log.filter((t) => t.heard).length).toBe(1);
  });

  it("飛ばしたテーマや途中で終えた面談でも、消したあとの状態が食い違わない", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, `${WORD}だけ答えた`);
    await service.skip(deps, SID_A); // 聞き返しは飛ばす
    const view = await service.finishEarly(deps, SID_A);
    const after = await service.removeItem(deps, SID_A, view.items.find((i) => i.text.includes(WORD))!.id);
    expect(JSON.stringify(after)).not.toContain(WORD);
    expect(after.themes.legacy.status).toBe("skipped");
    const legacy = after.items.filter((i) => i.theme === "legacy");
    expect(legacy.map((i) => i.kind)).toEqual(["unconfirmed"]);
  });

  it("古い形で保存された発言は、消し残さないよう、個別には消さない（すべて消すを案内）", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await service.answer(deps, SID_A, "古い答え");
    // 古い形：回答に ID がなく、会話の記録にも ID がない
    const raw = (await deps.store.get(SID_A))!;
    delete (raw.themes.legacy as unknown as { answerIds?: unknown }).answerIds;
    for (const turn of raw.log) {
      delete turn.answerId;
      delete turn.heardOf;
    }
    await deps.store.put(raw);

    await service.answer(deps, SID_A, "新しい答え");
    const view = await service.finishEarly(deps, SID_A);
    // 並びがずれない：新しい答えにだけ ID が付く
    expect(view.themes.legacy.answers).toEqual(["古い答え", "新しい答え"]);
    expect(view.themes.legacy.answerIds[0]).toBe("");
    expect(view.themes.legacy.answerIds[1]).not.toBe("");
    const oldItem = view.items.find((i) => i.text === "古い答え")!;
    const newItem = view.items.find((i) => i.text === "新しい答え")!;
    expect(oldItem.answerId).toBeUndefined();

    const before = (await service.getView(deps, SID_A))!;
    await expect(service.removeItem(deps, SID_A, oldItem.id)).rejects.toMatchObject({
      code: "cannot_forget",
      message: expect.stringContaining("すべて消す"),
    });
    expect((await service.getView(deps, SID_A))).toEqual(before);

    // 新しい形の発言は、これまでどおり消せて、古い答えは巻き込まれない
    const after = await service.removeItem(deps, SID_A, newItem.id);
    expect(JSON.stringify(after)).not.toContain("新しい答え");
    expect(after.themes.legacy.answers).toEqual(["古い答え"]);
    expect(after.log.some((t) => t.text === "古い答え")).toBe(true);
  });
});

describe("選択肢：本人の状況に応じた確認事項を出す。合う・合わないは判断しない", () => {
  it("はじめは、どの選択肢も「判断は保留」", async () => {
    const { buildOptionGuides } = await import("@/lib/v2/option-guides");
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const guides = buildOptionGuides(view);
    expect(guides.map((g) => g.key)).toEqual(["family", "employee", "third_party", "closure", "undecided"]);
    expect(guides.every((g) => g.hold && g.pending.length > 0)).toBe(true);
    expect(guides[0].pending.every((p) => p.state === "まだ確認していません")).toBe(true);
  });

  it("準備リストの状況がそのまま出る。確認済みの分野は、まだ確かめていないことから外れる", async () => {
    const { buildOptionGuides } = await import("@/lib/v2/option-guides");
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const view = await service.setPrep(deps, SID_A, {
      loans: { status: "todo" },
      contracts: { status: "confirmed" },
      finance: { status: "unknown" },
      advisors: { status: "confirmed" },
    });
    const guides = buildOptionGuides(view);
    const family = guides.find((g) => g.key === "family")!;
    expect(family.pending.map((p) => `${p.label}：${p.state}`)).toEqual(["借入・保証：要確認", "お金と経営の状況：不明"]);
    expect(family.hold).toBe(true);
    const undecided = guides.find((g) => g.key === "undecided")!;
    expect(undecided.pending).toEqual([]);
    expect(undecided.hold).toBe(false);
  });

  it("選択肢に順位や「おすすめ」を付けない", async () => {
    const { buildOptionGuides } = await import("@/lib/v2/option-guides");
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const guides = buildOptionGuides(view);
    expect(JSON.stringify(guides)).not.toMatch(/おすすめ|最適|向いています|べき|score|rank/);
    expect(Object.keys(guides[0]).sort()).toEqual(["checks", "hold", "key", "label", "pending"]);
  });
});

describe("準備リスト：確認済み／要確認／不明と、次に確認することを整理できる", () => {
  it("状態と次に確認することを保存でき、資料用の1行になる", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const view = await service.setPrep(deps, SID_A, {
      loans: { status: "todo", next: "返済予定表を探す" },
      permits: { status: "unknown" },
      values: { status: "confirmed", basis: "店の案内（架空・昨年版）" },
      daily: { status: "confirmed" },
    });
    const text = (key: string) => view.items.find((i) => i.prepKey === key)!.text;
    expect(text("loans")).toBe("借入・保証：要確認／次に確認すること：返済予定表を探す");
    expect(text("permits")).toBe("許認可・衛生：不明");
    expect(text("values")).toBe("店の思いと強み：確認済み（ご本人の申告。確かめた資料・時点：店の案内（架空・昨年版））");
    // 何で確かめたかを書いていない「確認済み」は、その旨を示す（確かめた事実のように見せない）
    expect(text("daily")).toBe("毎日の仕事：確認済み（ご本人の申告。資料名・時点は未記入）");
    // 触っていない分野は、そのまま
    expect(text("finance")).toBe("お金と経営の状況：まだ確認していません");
    expect(view.prep.loans).toEqual({ status: "todo", next: "返済予定表を探す", basis: "" });
  });

  it("「不明」や未選択を、ゼロや問題なしに変えない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const view = await service.setPrep(deps, SID_A, { finance: { status: "unknown" } });
    for (const item of view.items.filter((i) => i.kind === "prep")) {
      expect(item.text).not.toMatch(/問題なし|問題ありません|0円|ゼロ|なし$/);
    }
  });

  it("内容が変わった分野は「載せる」が外れ、変わっていない分野はそのまま", async () => {
    const deps = createDeps();
    const done = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const ids = done.items.filter((i) => i.prepKey === "loans" || i.prepKey === "permits").map((i) => i.id);
    await service.setReportSettings(deps, SID_A, "bank", ids);
    expect((await service.generateReport(deps, SID_A)).report).not.toBeNull();
    const view = await service.setPrep(deps, SID_A, { loans: { status: "todo" }, permits: { status: null } });
    expect(view.items.find((i) => i.prepKey === "loans")!.selected).toBe(false);
    expect(view.items.find((i) => i.prepKey === "permits")!.selected).toBe(true);
    // 古い資料は破棄される
    expect(view.report).toBeNull();

    // 文章が変わらない保存でも、古い資料は破棄される（選択はそのまま）
    await service.generateReport(deps, SID_A);
    const same = await service.setPrep(deps, SID_A, { permits: { status: null } });
    expect(same.report).toBeNull();
    expect(same.items.find((i) => i.prepKey === "permits")!.selected).toBe(true);
  });

  it("「確認済み」から変えると、確かめた資料の記載は消え、「載せる」も外れる", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const first = await service.setPrep(deps, SID_A, { contracts: { status: "confirmed", basis: "契約書の写し（架空）" } });
    const item = first.items.find((i) => i.prepKey === "contracts")!;
    await service.setReportSettings(deps, SID_A, "bank", [item.id]);
    // basis を付けたまま状態だけ変えて送っても、basis は残らない
    const view = await service.setPrep(deps, SID_A, { contracts: { status: "todo", basis: "契約書の写し（架空）" } });
    const after = view.items.find((i) => i.prepKey === "contracts")!;
    expect(view.prep.contracts).toEqual({ status: "todo", next: "", basis: "" });
    expect(after.text).toBe("店舗・設備・契約：要確認");
    expect(after.selected).toBe(false);
    expect(JSON.stringify(view)).not.toContain("契約書の写し");
  });

  it("古い画面が持っている ID では「載せる」にできない（見ていない文章が資料に入らない）", async () => {
    const deps = createDeps();
    const done = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const oldId = done.items.find((i) => i.prepKey === "loans")!.id;
    // 別の画面で書き足して保存した、という状況
    const changed = await service.setPrep(deps, SID_A, { loans: { status: "todo", next: "あとから書き足した内容" } });
    expect(changed.items.find((i) => i.prepKey === "loans")!.id).not.toBe(oldId);
    // 古い画面が、古い ID のまま「載せる」を送る
    await expect(service.setReportSettings(deps, SID_A, "bank", [oldId])).rejects.toMatchObject({ status: 404 });
    expect((await service.getView(deps, SID_A))!.items.every((i) => i.selected === false)).toBe(true);
    expect(deps.generatorInputs).toHaveLength(0);
  });

  it("想定外の形の指定（配列、文字でない値、特別な名前のキー）は受け付けない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const before = (await service.getView(deps, SID_A))!;
    for (const bad of [
      '{"loans":[]}',
      '{"loans":{"status":"todo","next":123}}',
      '{"loans":{"status":"confirmed","basis":["x"]}}',
      '{"__proto__":{"status":"todo"}}',
      '{"constructor":{"status":"todo"}}',
      '{"loans":"todo"}',
      "null",
      '"loans"',
    ]) {
      await expect(service.setPrep(deps, SID_A, JSON.parse(bad)), bad).rejects.toBeInstanceOf(V2Error);
    }
    expect((await service.getView(deps, SID_A))).toEqual(before);
    expect(({} as Record<string, unknown>).status).toBeUndefined();
  });

  it("準備リストを持たない古い形の面談を読んでも、止まらずに「まだ確認していません」として扱う", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const raw = (await deps.store.get(SID_A))!;
    delete (raw as unknown as { prep?: unknown }).prep;
    await deps.store.put(raw);
    expect(Object.values((await service.getView(deps, SID_A))!.prep).every((e) => e.status === null)).toBe(true);
    const view = await service.setPrep(deps, SID_A, { loans: { status: "unknown" } });
    expect(view.prep.loans.status).toBe("unknown");
  });

  it("正しくない指定が1つでもあれば、何も変わらない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const before = (await service.getView(deps, SID_A))!;
    await expect(
      service.setPrep(deps, SID_A, { loans: { status: "todo" }, nothing: { status: "todo" } }),
    ).rejects.toBeInstanceOf(V2Error);
    await expect(service.setPrep(deps, SID_A, { loans: { status: "ok" } })).rejects.toBeInstanceOf(V2Error);
    await expect(
      service.setPrep(deps, SID_A, { loans: { status: "todo", next: "あ".repeat(201) } }),
    ).rejects.toBeInstanceOf(V2Error);
    await expect(service.setPrep(deps, SID_A, [])).rejects.toBeInstanceOf(V2Error);
    expect((await service.getView(deps, SID_A))).toEqual(before);
  });

  it("準備リストの項目は、内容の確認の画面からは直せない・外せない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    const prep = view.items.find((i) => i.kind === "prep")!;
    await expect(service.editItem(deps, SID_A, prep.id, "確認済み")).rejects.toBeInstanceOf(V2Error);
    await expect(service.removeItem(deps, SID_A, prep.id)).rejects.toBeInstanceOf(V2Error);
  });

  it("面談を終える前は保存できない", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await expect(service.setPrep(deps, SID_A, { loans: { status: "todo" } })).rejects.toMatchObject({
      code: "not_in_review",
    });
  });
});

describe("次の一歩：やること・誰が・いつ頃を本人が選ぶ。保留もできる", () => {
  it("候補は、準備リストで選んだ状態・書いた言葉と、選んだ相談先だけから作る", async () => {
    const { buildNextSteps } = await import("@/lib/v2/next-steps");
    const deps = createDeps();
    const done = await completeInterview(deps, SID_A);
    // 何も整理していないうちは、候補はない（AI が勝手にやることを作らない）
    expect(buildNextSteps(done)).toEqual([]);

    await service.setPrep(deps, SID_A, {
      loans: { status: "todo", next: "返済予定表を探す" },
      permits: { status: "unknown" },
      values: { status: "confirmed" },
      daily: { status: "confirmed", next: "手順をメモにする" },
    });
    await service.setReportSettings(deps, SID_A, "bank", []);
    const steps = buildNextSteps((await service.getView(deps, SID_A))!);
    expect(steps.map((s) => [s.key, s.text])).toEqual([
      ["consult", "取引のある金融機関に連絡して、相談の日を決める"],
      ["daily", "手順をメモにする"],
      ["loans", "返済予定表を探す"],
      ["permits", "許認可・衛生の状況を確かめる"],
    ]);
    expect(steps.every((s) => s.decision === null && s.who === "" && s.when === null)).toBe(true);
  });

  it("相談先が「まだ決めていない」なら、連絡の候補は出さない", async () => {
    const { buildNextSteps } = await import("@/lib/v2/next-steps");
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "undecided", []);
    expect(buildNextSteps((await service.getView(deps, SID_A))!)).toEqual([]);
  });

  it("やる・今は保留を選べる。誰が・いつ頃は、やると決めたときだけ残る", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const view = await service.setNextSteps(deps, SID_A, {
      loans: { decision: "do", who: "自分", when: "this_month" },
      permits: { decision: "hold", who: "税理士", when: "this_week" },
      consult: { decision: null },
    });
    expect(view.steps.loans).toEqual({ decision: "do", who: "自分", when: "this_month" });
    expect(view.steps.permits).toEqual({ decision: "hold", who: "", when: null });
    expect(view.steps.consult).toEqual({ decision: null, who: "", when: null });
  });

  it("正しくない指定が1つでもあれば、何も変わらない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    const before = (await service.getView(deps, SID_A))!;
    for (const bad of [
      '{"loans":{"decision":"must"}}',
      '{"loans":{"decision":"do","when":"tomorrow"}}',
      '{"loans":{"decision":"do","who":123}}',
      '{"nothing":{"decision":"do"}}',
      '{"__proto__":{"decision":"do"}}',
      '{"loans":[]}',
      "[]",
      "null",
    ]) {
      await expect(service.setNextSteps(deps, SID_A, JSON.parse(bad)), bad).rejects.toBeInstanceOf(V2Error);
    }
    await expect(
      service.setNextSteps(deps, SID_A, { permits: { decision: "do" }, loans: { decision: "do", who: "あ".repeat(41) } }),
    ).rejects.toBeInstanceOf(V2Error);
    expect((await service.getView(deps, SID_A))).toEqual(before);
  });

  it("準備リストの文章や相談先を変えたら、前のメモは持ち越さない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.setPrep(deps, SID_A, { loans: { status: "todo", next: "返済予定表を探す" }, permits: { status: "unknown" } });
    await service.setReportSettings(deps, SID_A, "bank", []);
    await service.setNextSteps(deps, SID_A, {
      loans: { decision: "do", who: "自分", when: "this_week" },
      permits: { decision: "hold" },
      consult: { decision: "do", who: "自分" },
    });
    // 借入の文章を変える。許認可は変えない
    const changed = await service.setPrep(deps, SID_A, { loans: { status: "confirmed" }, permits: { status: "unknown" } });
    expect(changed.steps.loans).toBeUndefined();
    expect(changed.steps.permits).toEqual({ decision: "hold", who: "", when: null });
    // 相談先を変える
    const moved = await service.setReportSettings(deps, SID_A, "support_center", []);
    expect(moved.steps.consult).toBeUndefined();
    // 同じ相談先のままなら残る
    await service.setNextSteps(deps, SID_A, { consult: { decision: "hold" } });
    expect((await service.setReportSettings(deps, SID_A, "support_center", [])).steps.consult).toBeDefined();
  });

  it("面談を終える前は保存できない", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    await expect(service.setNextSteps(deps, SID_A, { loans: { decision: "do" } })).rejects.toMatchObject({
      code: "not_in_review",
    });
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
    const before = (await service.getView(deps, SID_A))!;
    await expect(service.answer(deps, SID_A, "架空の答え")).rejects.toMatchObject({
      code: "ai_failed",
      status: 503,
      message: expect.stringContaining("もう一度お試しください"),
    });
    expect((await service.getView(deps, SID_A))).toEqual(before);

    fail = false;
    const after = await service.answer(deps, SID_A, "架空の答え");
    expect(after.themes.legacy.answers).toEqual(["架空の答え"]);
  });

  it("AI が空の返事を返したときも、作り足さずに失敗として扱う", async () => {
    const deps = createDeps({ ai: async () => ({ reply: "  ", action: "followup" }) });
    await service.start(deps, SID_A);
    await expect(service.answer(deps, SID_A, "架空の答え")).rejects.toMatchObject({ code: "ai_failed" });
    expect((await service.getView(deps, SID_A))!.log).toHaveLength(1);
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
    expect((await service.getView(deps, SID_A))!.report).toBeNull();
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
    expect((await service.getView(deps, SID_A))).toBeNull();
    expect((await deps.store.size())).toBe(0);
  });
});
