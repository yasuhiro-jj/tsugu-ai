// 会社の設定の保存と整合（docs/settings-dashboard.md「設定を変えたとき」「業種による出し分け」「呼び出し側」）。
// Claude は偽物、DB はメモリ。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { aiJson, createFakeAi, createTestDb, DEMO_A, DEMO_B } from "./helpers";
import {
  getSettingsView,
  getFinancialSummaryForDemo,
  getUpsideSummaryForDemo,
  loadCompanySettings,
  MSG_SETTINGS_CHANGED,
  MSG_SETTINGS_CONFLICT,
  resetSettings,
  saveSettings,
} from "@/lib/company-settings";
import { cloneSettings, INDUSTRY_PRESETS, TSUGUMI_SETTINGS } from "@/lib/industry-presets";
import { runDiagnosis } from "@/lib/diagnosis";
import { createLearningPlan, getLearningLevel, getLearningStateFrom } from "@/lib/learning";
import { createActionPlan, phaseRange } from "@/lib/action-plan";
import { createReport, getReportFrom } from "@/lib/report";
import { buildAdvisorRequest, sendAdvisorMessage } from "@/lib/advisor";
import { getInterviewState, startInterview } from "@/lib/interview/service";
import { deleteDemoData } from "@/lib/interview/store";
import { purgeExpiredDemos } from "@/lib/retention";
import { getUpsideSummary, UPSIDE_EXAMPLE_NOTE, USER_FINANCIAL_SOURCE } from "@/lib/financials";
import { setDbForTesting } from "@/lib/db";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { CompanySettings } from "@/lib/settings-types";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => {
  setDbForTesting(null);
});

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: unknown[] };
/** 返事を順番に返す偽の AI。関数を入れると、呼ばれたときにそれを実行してから返事を返す（AI を待つ間の操作の再現） */
function fakeAi(queue: unknown[]): FakeJsonAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    let next = fn.queue.shift();
    if (typeof next === "function") next = await (next as () => Promise<unknown>)();
    if (next === undefined) throw new Error("queue empty");
    return JSON.stringify(next);
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = queue;
  return fn;
}

const DIAG = {
  common: [{ point: "店を続けたい", evidence: "二人とも話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見方", senior_said: "s", successor_said: "t", numbers: "n", importance: "高" }],
  to_confirm: [{ item: "返済予定表", how: "銀行", expert: "銀行" }],
  talk_questions: ["問い1", "問い2"],
  directions: { keep: [], improve: [], tryNew: [] },
};
const START = "2026-11-02";
const PLAN_OUT = {
  actions: Array.from({ length: 5 }, (_, i) => ({
    title: `行動${i}`,
    owner: "二人",
    due: phaseRange(START, "1-30").to,
    phase: "1-30",
    linked_gap: "",
    linked_course: "",
    status: "未着手",
  })),
  message: "直したいところは？",
};
const REPORT_OUT = {
  results_comment: "説明1",
  financial_comment: "説明2",
  strengths: [{ text: "強み", basis: "根拠" }],
  issues: [{ text: "課題", basis: "根拠" }],
  outlook_viewpoints: ["観点"],
  consult: { bank: ["銀行に聞くこと"], tax: ["税理士に聞くこと"], other: [] },
  bank_doc: { purpose: "相談内容", questions: ["質問1", "質問2"] },
};
const ADVISOR_OUT = { reply: "整理します", points: [], consult: "不要", consult_note: "" };
const LEARNING_OUT = { plan: [{ order: 1, course_id: "cashflow", week: 1, reason: "r", linked_gap: "g" }], message: "m" };

const M_SUMMARY = "MARK-THEME-SUMMARY";
const M_ADVISOR_PRED = "MARK-ADVISOR-PRED";
const M_ADVISOR_SUCC = "MARK-ADVISOR-SUCC";

async function putTheme(demoId: string, role: Role, key: string) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, '[]', 0, 'confirmed', ?, 1, 0, ?)
          ON CONFLICT(demo_id, role, theme_key) DO UPDATE SET status = 'confirmed', summary = excluded.summary, shared = 1`,
    args: [demoId, role, key, JSON.stringify({ statements: [`${M_SUMMARY}-${role}`], ai_observations: [], unconfirmed: [] }), new Date().toISOString()],
  });
}

async function putAdvisor(demoId: string, role: Role, text: string, diagnosisAt: string | null) {
  const msg = [{ from: "me", text, at: new Date().toISOString() }];
  await db.execute({
    sql: `INSERT INTO advisor_chats (demo_id, role, messages, rev, updated_at, diagnosis_created_at) VALUES (?, ?, ?, 1, ?, ?)
          ON CONFLICT(demo_id, role) DO UPDATE SET messages = excluded.messages, diagnosis_created_at = excluded.diagnosis_created_at`,
    args: [demoId, role, JSON.stringify(msg), new Date().toISOString(), diagnosisAt],
  });
}

async function seedDiagnosis(demoId = DEMO_A) {
  await putTheme(demoId, "predecessor", "cashflow");
  await putTheme(demoId, "successor", "cashflow");
  return runDiagnosis({ db, ai: fakeAi([DIAG]) }, demoId, "predecessor");
}

/** 診断・学習プラン（診断を使う）・90日計画・資料・AI参謀の会話（先代は診断なし、後継者は診断あり）をそろえる */
async function seedAll(demoId = DEMO_A) {
  const diag = await seedDiagnosis(demoId);
  await createLearningPlan({ db, ai: fakeAi([LEARNING_OUT]) }, demoId, "successor", {});
  await createActionPlan({ db, ai: fakeAi([PLAN_OUT]) }, demoId, "predecessor", { startDate: START });
  await createReport({ db, ai: fakeAi([REPORT_OUT]) }, demoId, "predecessor");
  await putAdvisor(demoId, "predecessor", M_ADVISOR_PRED, null);
  await putAdvisor(demoId, "successor", M_ADVISOR_SUCC, diag.createdAt);
}

const count = async (table: string, demoId = DEMO_A) =>
  Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} WHERE demo_id = ?`, args: [demoId] })).rows[0].n);

const edited = (f: (s: CompanySettings) => void): CompanySettings => {
  const s = cloneSettings(TSUGUMI_SETTINGS);
  f(s);
  return s;
};

describe("保存", () => {
  it("中身が同じなら何もしない（行も作らない・派生物も消さない）", async () => {
    await seedAll();
    const r = await saveSettings(db, DEMO_A, "predecessor", { settings: cloneSettings(TSUGUMI_SETTINGS), rev: 0 });
    expect(r.invalidated).toBe(false);
    expect(r.rev).toBe(0);
    expect(r.isDefault).toBe(true);
    expect(await count("company_settings")).toBe(0);
    for (const t of ["diagnoses", "action_plans", "reports"]) expect(await count(t), t).toBe(1);
    expect(await count("advisor_chats")).toBe(2);
    // 古い rev を送っても、中身が同じなら 409 にしない
    const again = await saveSettings(db, DEMO_A, "predecessor", { settings: cloneSettings(TSUGUMI_SETTINGS), rev: 99 });
    expect(again.invalidated).toBe(false);
    // 前後の空白だけの違いも同じ中身として扱う
    const spaced = edited((s) => (s.company.name = ` ${s.company.name} `));
    expect((await saveSettings(db, DEMO_A, "predecessor", { settings: spaced, rev: 0 })).invalidated).toBe(false);
  });

  it("変えたら、診断・90日計画・資料・診断を使った学習プラン・両方の役割の AI参謀の会話が消え、面談の記録は残る", async () => {
    await seedAll();
    const themesBefore = (await db.execute({ sql: `SELECT role, theme_key, summary, shared, status FROM theme_records WHERE demo_id = ? ORDER BY role, theme_key`, args: [DEMO_A] })).rows;
    expect((await getLearningStateFrom(db, DEMO_A)).current?.usedDiagnosis).toBe(true);

    const r = await saveSettings(db, DEMO_A, "successor", { settings: edited((s) => (s.company.name = "山田製作所")), rev: 0 });
    expect(r.invalidated).toBe(true);
    expect(r.rev).toBe(1);
    expect(r.isDefault).toBe(false);
    expect(r.settings.company.name).toBe("山田製作所");
    expect(r.willInvalidate).toEqual({ diagnosis: false, actionPlan: false, report: false, myAdvisorChat: false });

    for (const t of ["diagnoses", "action_plans", "reports", "advisor_chats"]) expect(await count(t), t).toBe(0);
    expect((await getLearningStateFrom(db, DEMO_A)).current).toBeNull();
    const themesAfter = (await db.execute({ sql: `SELECT role, theme_key, summary, shared, status FROM theme_records WHERE demo_id = ? ORDER BY role, theme_key`, args: [DEMO_A] })).rows;
    expect(themesAfter).toEqual(themesBefore);

    const row = (await db.execute({ sql: `SELECT rev, version, updated_by_role FROM company_settings WHERE demo_id = ?`, args: [DEMO_A] })).rows[0];
    expect(Number(row.rev)).toBe(1);
    expect(Number(row.version)).toBe(1);
    expect(row.updated_by_role).toBe("successor");
  });

  it("rev が古ければ 409 で、設定も派生物も変わらない", async () => {
    await seedAll();
    await saveSettings(db, DEMO_A, "predecessor", { settings: edited((s) => (s.company.name = "一回目")), rev: 0 });
    await seedAll(); // 作り直す
    await expect(
      saveSettings(db, DEMO_A, "successor", { settings: edited((s) => (s.company.name = "二回目")), rev: 0 }),
    ).rejects.toMatchObject({ status: 409, userMessage: MSG_SETTINGS_CONFLICT });
    expect((await loadCompanySettings(db, DEMO_A)).settings.company.name).toBe("一回目");
    for (const t of ["diagnoses", "action_plans", "reports"]) expect(await count(t), t).toBe(1);
    expect(await count("advisor_chats")).toBe(2);
    // 行が消えていた（デモのやり直し）のに古い rev で送られたら、作り直さずに 409
    await deleteDemoData(db, DEMO_A);
    await expect(
      saveSettings(db, DEMO_A, "successor", { settings: edited((s) => (s.company.name = "三回目")), rev: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await count("company_settings")).toBe(0);
  });

  it("rev は 0 以上の整数だけ", async () => {
    for (const rev of [undefined, -1, 1.5, "0", null]) {
      await expect(saveSettings(db, DEMO_A, "predecessor", { settings: cloneSettings(TSUGUMI_SETTINGS), rev })).rejects.toMatchObject({ status: 400 });
    }
  });

  it("後継者の Lv を変えたら learning.level も変わる。行が無ければ設定の Lv で始まる", async () => {
    await createLearningPlan({ db, ai: fakeAi([LEARNING_OUT]) }, DEMO_A, "successor", {});
    expect(await getLearningLevel(db, DEMO_A)).toBe("Lv1");
    await saveSettings(db, DEMO_A, "predecessor", { settings: edited((s) => (s.people.successorLevel = "Lv3")), rev: 0 });
    expect(await getLearningLevel(db, DEMO_A)).toBe("Lv3");

    await saveSettings(db, DEMO_B, "predecessor", {
      settings: edited((s) => {
        s.people.successorLevel = "Lv2";
        s.industry = "manufacturing";
      }),
      rev: 0,
    });
    expect(await getLearningLevel(db, DEMO_B)).toBe("Lv2");
    const st = await getLearningStateFrom(db, DEMO_B);
    expect(st.level).toBe("Lv2");
    expect(st.wants).toBe(INDUSTRY_PRESETS.manufacturing.defaultWants);
  });

  it("つぐみの例に戻す（reset）。すでに初期値なら何もしない", async () => {
    const r1 = await saveSettings(db, DEMO_A, "predecessor", { settings: edited((s) => (s.company.name = "山田製作所")), rev: 0 });
    await seedAll();
    const r2 = await resetSettings(db, DEMO_A, "successor", { rev: r1.rev });
    expect(r2.invalidated).toBe(true);
    expect(r2.isDefault).toBe(true);
    expect(r2.rev).toBe(2);
    expect(await count("diagnoses")).toBe(0);
    const r3 = await resetSettings(db, DEMO_A, "successor", { rev: r2.rev });
    expect(r3.invalidated).toBe(false);
    await expect(resetSettings(db, DEMO_A, "successor", {})).rejects.toMatchObject({ status: 400 });
  });

  it("壊れた JSON の行はつぐみの初期値として読み、その rev で上書きできる", async () => {
    await db.execute({
      sql: `INSERT INTO company_settings (demo_id, settings, version, rev, updated_at) VALUES (?, '{壊れた', 1, 4, ?)`,
      args: [DEMO_A, new Date().toISOString()],
    });
    const v = await loadCompanySettings(db, DEMO_A);
    expect(v.isDefault).toBe(true);
    expect(v.rev).toBe(4);
    const r = await saveSettings(db, DEMO_A, "predecessor", { settings: edited((s) => (s.company.name = "直した")), rev: 4 });
    expect(r.rev).toBe(5);
  });
});

describe("デモ用 ID ごとに分かれる", () => {
  it("別のデモ用 ID の設定は読めない・書けない", async () => {
    await seedAll(DEMO_A);
    await saveSettings(db, DEMO_A, "predecessor", { settings: edited((s) => (s.company.name = "A社")), rev: 0 });
    await seedAll(DEMO_A);
    const b = await getSettingsView(db, DEMO_B, "predecessor");
    expect(b.isDefault).toBe(true);
    expect(b.rev).toBe(0);
    expect(JSON.stringify(b)).not.toContain("A社");
    expect(b.willInvalidate).toEqual({ diagnosis: false, actionPlan: false, report: false, myAdvisorChat: false });

    // B で保存しても A は変わらず、A の派生物も消えない
    await saveSettings(db, DEMO_B, "successor", { settings: edited((s) => (s.company.name = "B社")), rev: 0 });
    expect((await loadCompanySettings(db, DEMO_A)).settings.company.name).toBe("A社");
    for (const t of ["diagnoses", "action_plans", "reports"]) expect(await count(t, DEMO_A), t).toBe(1);
    expect(await count("advisor_chats", DEMO_A)).toBe(2);
  });

  it("GET の返り値に、相手の AI参謀の会話の有無や面談の中身は出ない", async () => {
    await seedDiagnosis();
    await putAdvisor(DEMO_A, "successor", M_ADVISOR_SUCC, null);
    const pred = await getSettingsView(db, DEMO_A, "predecessor");
    const succ = await getSettingsView(db, DEMO_A, "successor");
    expect(Object.keys(pred).sort()).toEqual(["isDefault", "rev", "settings", "updatedAt", "willInvalidate"]);
    expect(Object.keys(pred.willInvalidate).sort()).toEqual(["actionPlan", "diagnosis", "myAdvisorChat", "report"]);
    expect(pred.willInvalidate.myAdvisorChat).toBe(false); // 後継者の会話はあるが、先代には知らせない
    expect(succ.willInvalidate.myAdvisorChat).toBe(true);
    expect(pred.willInvalidate.diagnosis).toBe(true);
    for (const v of [pred, succ]) {
      const json = JSON.stringify(v);
      expect(json).not.toContain(M_SUMMARY);
      expect(json).not.toContain(M_ADVISOR_SUCC);
    }
  });

  it("デモのやり直しと7日経過の削除で設定も消える", async () => {
    await saveSettings(db, DEMO_A, "predecessor", { settings: edited((s) => (s.company.name = "A社")), rev: 0 });
    await deleteDemoData(db, DEMO_A);
    expect(await count("company_settings")).toBe(0);
    expect((await loadCompanySettings(db, DEMO_A)).isDefault).toBe(true);

    await saveSettings(db, DEMO_B, "predecessor", { settings: edited((s) => (s.company.name = "B社")), rev: 0 });
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({ sql: `UPDATE company_settings SET updated_at = ? WHERE demo_id = ?`, args: [old, DEMO_B] });
    const r = await purgeExpiredDemos(db, { now: new Date(), retentionDays: 7 });
    expect(r.demos).toBe(1);
    expect(await count("company_settings", DEMO_B)).toBe(0);
  });
});

describe("AI の応答を待つ間に設定が変わったら保存しない（409）", () => {
  const change = (name: string) => async () => {
    const cur = await loadCompanySettings(db, DEMO_A);
    await saveSettings(db, DEMO_A, "successor", { settings: edited((s) => (s.company.name = name)), rev: cur.rev });
  };

  it("診断", async () => {
    await putTheme(DEMO_A, "predecessor", "cashflow");
    await putTheme(DEMO_A, "successor", "cashflow");
    const ai = fakeAi([async () => (await change("途中で変更")(), DIAG)]);
    await expect(runDiagnosis({ db, ai }, DEMO_A, "predecessor")).rejects.toMatchObject({ status: 409, userMessage: MSG_SETTINGS_CHANGED });
    expect(await count("diagnoses")).toBe(0);
  });

  it("AI参謀", async () => {
    const ai = fakeAi([async () => (await change("途中で変更")(), ADVISOR_OUT)]);
    await expect(sendAdvisorMessage({ db, ai }, DEMO_A, "predecessor", "相談です")).rejects.toMatchObject({
      status: 409,
      userMessage: MSG_SETTINGS_CHANGED,
    });
    expect(await count("advisor_chats")).toBe(0);
  });

  it("資料", async () => {
    await seedDiagnosis();
    const ai = fakeAi([async () => (await change("途中で変更")(), REPORT_OUT)]);
    await expect(createReport({ db, ai }, DEMO_A, "predecessor")).rejects.toMatchObject({ status: 409, userMessage: MSG_SETTINGS_CHANGED });
    expect(await count("reports")).toBe(0);
  });

  it("90日計画", async () => {
    await seedDiagnosis();
    const ai = fakeAi([async () => (await change("途中で変更")(), PLAN_OUT)]);
    await expect(createActionPlan({ db, ai }, DEMO_A, "predecessor", { startDate: START })).rejects.toMatchObject({
      status: 409,
      userMessage: MSG_SETTINGS_CHANGED,
    });
    expect(await count("action_plans")).toBe(0);
  });
});

describe("業種による出し分け", () => {
  it("製造業に変えたら伸びる余地が null になり、資料に改善策あり案が出ない", async () => {
    const mfg = edited((s) => {
      s.industry = "manufacturing";
      s.themeHints = { ...INDUSTRY_PRESETS.manufacturing.themeHints };
    });
    await saveSettings(db, DEMO_A, "predecessor", { settings: mfg, rev: 0 });
    const saved = (await loadCompanySettings(db, DEMO_A)).settings;
    expect(getUpsideSummary(saved)).toBeNull();
    setDbForTesting(db);
    expect(await getUpsideSummaryForDemo(DEMO_A)).toBeNull();

    await seedDiagnosis();
    const ai = fakeAi([REPORT_OUT]);
    const state = await createReport({ db, ai }, DEMO_A, "predecessor");
    expect(state.summary.outlook.scenarios.improved).toBeUndefined();
    expect(state.summary.outlook.scenarios.status_quo.operatingProfitText).toBe("▲236万円");
    expect(state.summary.basic.industry).toBe("製造業（和食の食事処）");
    expect(state.summary.basic.sources.join("\n")).not.toContain("改善策の試算");
    expect(JSON.stringify(state)).not.toContain("ランチ");
    const user = ai.requests[0].messages[0].content;
    expect(user).not.toContain("踏ん張れば伸びる余地");
    expect(user).toContain("この業種では改善策の試算を用意していません");
    expect(ai.requests[0].system).toContain("この業種では改善策の試算は無い");
    expect((await getReportFrom(db, DEMO_A))?.summary.outlook.scenarios.improved).toBeUndefined();

    const adv = buildAdvisorRequest({ role: "successor", history: [], text: "相談", diagnosis: null, settings: saved });
    expect(adv.system).not.toContain("<shop_upside>");
    expect(adv.system).toContain("改善策の試算は用意していません");
  });

  it("飲食店で数字を変えたら「ランチ・宴会の前提はつぐみの例です」と添える", async () => {
    const s = edited((x) => (x.financials.current.sales = 6000));
    const u = getUpsideSummary(s)!;
    expect(u.exampleNote).toBe(UPSIDE_EXAMPLE_NOTE);
    expect(getUpsideSummary()!.exampleNote).toBeUndefined();
  });

  it("原価率がもう目標以下なら、その改善策の効果は 0（マイナスの改善を出さない）", () => {
    const s = edited((x) => (x.financials.current.cogs = 1000)); // 原価率 約18.5%
    const item = getUpsideSummary(s)!.items.find((i) => i.id === "costrate")!;
    expect(item.effect).toBe(0);
    expect(item.assumption).toContain("試算しない");
  });
});

describe("数字を変えると、診断の AI 入力と比較画面の数字が変わる", () => {
  it("売上高を変えた値が、診断の依頼と比較画面の表に入る（資料名は利用者入力）", async () => {
    const s = edited((x) => {
      x.financials.current.sales = 6000;
      x.financials.current.principalRepayment = 300;
    });
    await saveSettings(db, DEMO_A, "predecessor", { settings: s, rev: 0 });
    await putTheme(DEMO_A, "predecessor", "cashflow");
    await putTheme(DEMO_A, "successor", "cashflow");
    const ai = fakeAi([DIAG]);
    await runDiagnosis({ db, ai }, DEMO_A, "predecessor");
    const user = ai.requests[0].messages[0].content;
    expect(user).toContain("売上高：前期 5,600万円／当期 6,000万円");
    expect(user).toContain(USER_FINANCIAL_SOURCE);
    expect(user).not.toContain("2026年3月期");

    setDbForTesting(db);
    const fin = await getFinancialSummaryForDemo(DEMO_A);
    expect(fin.source).toBe(USER_FINANCIAL_SOURCE);
    expect(fin.rows.find((r) => r.label === "売上高")!.current).toBe("6,000万円");
    expect(fin.rows.find((r) => r.label === "年間返済額（元本）")!.note).toBe("当期は月25万円");
    // 別のデモ用 ID はつぐみの数字のまま
    const other = await getFinancialSummaryForDemo(DEMO_B);
    expect(other.rows.find((r) => r.label === "売上高")!.current).toBe("5,400万円");

    // 資料の列の見出しは「前期」「当期」
    await createReport({ db, ai: fakeAi([REPORT_OUT]) }, DEMO_A, "predecessor");
    const rep = (await getReportFrom(db, DEMO_A))!;
    expect(rep.summary.results.table.columns).toEqual({ previous: "前期", current: "当期" });
    expect(rep.summary.results.table.source).toBe(USER_FINANCIAL_SOURCE);
    expect(rep.summary.basic.period).toBe("当期（比較：前期）");
  });
});

describe("面談の指示文に設定が入る（利用者の文は「」で囲む）", () => {
  it("名前・関係・Lv・概要・テーマの補足が入り、表示名は「」なし", async () => {
    const s = edited((x) => {
      x.industry = "manufacturing";
      x.company = { name: "山田製作所（架空）", industryNote: "金属部品の加工", overview: "創業1975年\n従業員12名" };
      x.people = { predecessorName: "山田 一郎", successorName: "佐藤 次郎", relation: "従業員", predecessorLevel: "Lv3", successorLevel: "Lv2" };
      x.themeHints = { ...INDUSTRY_PRESETS.manufacturing.themeHints };
    });
    await saveSettings(db, DEMO_A, "predecessor", { settings: s, rev: 0 });

    const ai = createFakeAi([aiJson({ reply: "こんにちは", action: "followup" }), aiJson({ reply: "こんにちは", action: "followup" })]);
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    await startInterview({ db, ai }, DEMO_A, "successor");
    const pred = ai.requests[0].system;
    const succ = ai.requests[1].system;
    expect(pred).toContain("- 名前：「山田 一郎」");
    expect(pred).toContain("- 承継の相手との関係：従業員（身内／第三者）");
    expect(pred).toContain("- 数字や経営の知識レベル：Lv3（Lv1〜Lv4）");
    expect(pred).toContain("- お店の情報：会社名「山田製作所（架空）」、業種：製造業（「金属部品の加工」）、概要：「創業1975年／従業員12名」");
    expect(pred).toContain("- 今のテーマ：経営方針（「守りたい技術やこだわり、変えてもよいもの」）");
    expect(pred).toContain("2. 取引先：「主な納品先・仕入れ先と、約束や条件」");
    expect(pred).toContain("3. 業務の勘どころ：「段取り・品質の見方・設備の判断」");
    expect(pred).toContain("6. 締め：相手にまだ伝えていない気持ち");
    expect(pred).not.toContain("仕込み・発注・値決め");
    expect(pred).not.toContain("森川");
    expect(succ).toContain("- 名前：「佐藤 次郎」");
    expect(succ).toContain("- 数字や経営の知識レベル：Lv2（Lv1〜Lv4）");
    // 面談中の AI には決算の数字を渡さない（今までどおり）
    expect(pred).not.toContain("万円");

    expect((await getInterviewState(db, DEMO_A, "predecessor")).displayName).toBe("山田 一郎");
    expect((await getInterviewState(db, DEMO_A, "successor")).displayName).toBe("佐藤 次郎");

    // 学習プランの依頼にも後継者の名前（「」つき）
    const learn = fakeAi([LEARNING_OUT]);
    await createLearningPlan({ db, ai: learn }, DEMO_A, "successor", {});
    expect(learn.requests[0].system).toContain("「佐藤 次郎」");
    // AI参謀の先代の Lv は設定から
    const adv = fakeAi([ADVISOR_OUT]);
    await sendAdvisorMessage({ db, ai: adv }, DEMO_A, "predecessor", "相談です");
    expect(adv.requests[0].system).toContain("- 数字や経営の知識レベル：Lv3");
    expect(adv.requests[0].system).toContain("会社名「山田製作所（架空）」");
  });

  it("テーマの補足を空にしたら、テーマ名だけ", async () => {
    await saveSettings(db, DEMO_A, "predecessor", { settings: edited((x) => (x.themeHints.policy = "")), rev: 0 });
    const ai = createFakeAi([aiJson({ reply: "こんにちは", action: "followup" })]);
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    expect(ai.requests[0].system).toContain("- 今のテーマ：経営方針\n");
    expect(ai.requests[0].system).toContain("1. 経営方針\n2. 取引先：「主な仕入れ先と、約束や条件」");
  });
});
