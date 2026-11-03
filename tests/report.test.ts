// 決算サマリー・相談用資料（lib/report.ts）。Claude は偽物、DB はメモリ。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { runDiagnosis } from "@/lib/diagnosis";
import { createLearningPlan } from "@/lib/learning";
import { createActionPlan, getActionPlanFrom, phaseRange } from "@/lib/action-plan";
import { setShared } from "@/lib/interview/service";
import { deleteDemoData } from "@/lib/interview/store";
import { purgeExpiredDemos } from "@/lib/retention";
import { getFinancialSummary, getUpsideSummary } from "@/lib/financials";
import {
  createReport,
  getReportFrom,
  MSG_NO_ACTION_PLAN,
  MSG_REPORT_CHANGED,
  MSG_REPORT_NEED_DIAGNOSIS,
  REPORT_ROW_LABELS,
} from "@/lib/report";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { ReportNumberTable } from "@/lib/report-types";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: (string | (() => Promise<string>))[] };
function fakeAi(queue: unknown[] = []): FakeJsonAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === undefined) throw new Error("queue empty");
    return typeof next === "function" ? next() : next;
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = queue.map((q) => (typeof q === "string" || typeof q === "function" ? q : JSON.stringify(q))) as FakeJsonAi["queue"];
  return fn;
}

// 面談の要約・会話、AI参謀の会話、学習の希望・理由の目印（どれも資料の AI 入力に入ってはいけない）
const M_SUMMARY = "MARK-SUMMARY";
const M_MESSAGE = "MARK-INTERVIEW-MSG";
const M_ADVISOR = "MARK-ADVISOR";
const M_WANTS = "MARK-WANTS";
const M_REASON = "MARK-REASON";
const M_PLAN_MSG = "MARK-PLAN-MESSAGE";
const M_LINKED = "MARK-LINKED-GAP";

async function putTheme(demoId: string, role: Role, key: string) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, ?, 0, 'confirmed', ?, 1, 0, ?)`,
    args: [
      demoId,
      role,
      key,
      JSON.stringify([{ role: "user", content: `${M_MESSAGE}-${role}` }]),
      JSON.stringify({ statements: [`${M_SUMMARY}-${role}`], ai_observations: [], unconfirmed: [] }),
      new Date().toISOString(),
    ],
  });
}

const DIAG = {
  common: [{ point: "店を続けたい", evidence: "二人とも話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見方", senior_said: "s", successor_said: "t", numbers: "手元資金 808万円", importance: "高" }],
  to_confirm: [{ item: "返済予定表", how: "銀行", expert: "銀行" }],
  talk_questions: ["問い1", "問い2"],
  directions: { keep: [{ text: "だしの味", from: "二人" }], improve: [], tryNew: [] },
};
const START = "2026-11-02";
const actionsOut = () => ({
  actions: Array.from({ length: 5 }, (_, i) => ({
    title: `行動${i}`,
    owner: i % 2 ? "先代" : "後継者",
    due: phaseRange(START, "1-30").to,
    phase: "1-30",
    linked_gap: M_LINKED,
    linked_course: "",
    status: "未着手",
  })),
  message: M_PLAN_MSG,
});
const reportOut = (tag = "R1", extra: Record<string, unknown> = {}) => ({
  results_comment: `${tag} 売上が減り、営業利益は赤字です`,
  financial_comment: `${tag} 手元資金が減っています`,
  strengths: [{ text: "常連が多い", basis: "診断の共通点" }],
  issues: [{ text: "原価率の上昇", basis: "原価率 40.0% → 42.0%" }],
  outlook_viewpoints: ["続けられるか"],
  consult: { bank: ["返済の条件を見直す相談はできますか"], tax: ["承継の税金について教えてください"], other: [] },
  bank_doc: { purpose: `${tag} 返済の相談`, questions: ["質問1", "質問2"] },
  ...extra,
});

async function seedDiagnosis(demoId = DEMO_A) {
  await putTheme(demoId, "predecessor", "cashflow");
  await putTheme(demoId, "successor", "cashflow");
  await runDiagnosis({ db, ai: fakeAi([DIAG]) }, demoId, "predecessor");
}

async function seedAll(demoId = DEMO_A) {
  await seedDiagnosis(demoId);
  // 学習プラン（希望・理由に目印）と AI参謀の会話（目印）
  await createLearningPlan(
    { db, ai: fakeAi([{ plan: [{ order: 1, course_id: "cashflow", week: 1, reason: M_REASON, linked_gap: M_REASON }], message: M_REASON }]) },
    demoId,
    "successor",
    { wants: M_WANTS },
  );
  await db.execute({
    sql: `INSERT INTO advisor_chats (demo_id, role, messages, rev, updated_at) VALUES (?, 'successor', ?, 0, ?)`,
    args: [demoId, JSON.stringify([{ role: "user", content: M_ADVISOR }]), new Date().toISOString()],
  });
  await createActionPlan({ db, ai: fakeAi([actionsOut()]) }, demoId, "predecessor", { startDate: START });
}

const count = async (t: string, demoId = DEMO_A) =>
  Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE demo_id = ?`, args: [demoId] })).rows[0].n);

function expectAppRows(t: ReportNumberTable, labels: readonly string[]) {
  const all = getFinancialSummary().rows;
  expect(t.rows.map((r) => r.label)).toEqual(labels);
  for (const r of t.rows) {
    const app = all.find((x) => x.label === r.label)!;
    expect(r.previous).toBe(app.previous);
    expect(r.current).toBe(app.current);
  }
  expect(t.source).toBe(getFinancialSummary().source);
}

describe("POST /api/report の中身（createReport）", () => {
  it("診断が無ければ 409 と案内文。AI は呼ばない", async () => {
    const ai = fakeAi([reportOut()]);
    await expect(createReport({ db, ai }, DEMO_A, "successor")).rejects.toMatchObject({
      status: 409,
      userMessage: MSG_REPORT_NEED_DIAGNOSIS,
    });
    expect(ai.requests).toHaveLength(0);
  });

  it("AI 入力に面談の要約・会話、AI参謀の会話、学習の希望・理由、90日計画の message・linked_gap が入らない", async () => {
    await seedAll();
    const ai = fakeAi([reportOut()]);
    await createReport({ db, ai }, DEMO_A, "successor");
    expect(ai.requests).toHaveLength(1);
    const sent = JSON.stringify(ai.requests[0]);
    for (const m of [M_SUMMARY, M_MESSAGE, M_ADVISOR, M_WANTS, M_REASON, M_PLAN_MSG, M_LINKED]) {
      expect(sent).not.toContain(m);
    }
    // 入るべきもの：診断・数字・試算・90日計画の文
    expect(sent).toContain("返済の見方");
    expect(sent).toContain("808万円");
    expect(sent).toContain(getUpsideSummary().totalText);
    expect(sent).toContain("行動0");
    expect(sent).not.toContain("basedOnThemeKeys");
  });

  it("章1〜3・6・7と銀行資料の数字はアプリの計算値。AI が数字の項目を返しても上書きされない", async () => {
    await seedAll();
    const evil = reportOut("R1", {
      results: { table: { rows: [{ label: "売上高", previous: "9999万円", current: "9999万円" }] } },
      scenarios: { improved: { operatingProfitText: "+9999万円" } },
    });
    const state = await createReport({ db, ai: fakeAi([evil]) }, DEMO_A, "predecessor");
    const s = state.summary;
    expect(JSON.stringify(state)).not.toContain("9999");
    expect(s.basic.companyName).toBe("食事処 つぐみ（架空）");
    expect(s.basic.sources[0]).toContain(getFinancialSummary().source);
    expectAppRows(s.results.table, REPORT_ROW_LABELS.results);
    expectAppRows(s.financial.table, REPORT_ROW_LABELS.financial);
    expectAppRows(state.bankDoc.numbers, REPORT_ROW_LABELS.bank);
    expect(s.results.table.rows.find((r) => r.label === "売上高")!.change).toBe("▲200万円");
    const up = getUpsideSummary();
    expect(s.outlook.scenarios.status_quo.operatingProfitText).toBe(up.operatingProfitBeforeText);
    expect(s.outlook.scenarios.improved!.operatingProfitText).toBe(up.operatingProfitAfterText);
    expect(s.outlook.scenarios.improved!.items).toEqual(up.items);
    expect(s.outlook.forecastLabel).toContain("予測");
    expect(s.outlook.assumptions).toContain(up.note);
    const plan = await getActionPlanFrom(db, DEMO_A);
    expect(s.actions.items.map((a) => a.title).sort()).toEqual(plan.actions.map((a) => a.title).sort());
    expect(s.actions.emptyMessage).toBeNull();
    expect(s.external.topics.map((t) => t.status)).toEqual(["要確認", "要確認", "要確認"]);
    expect(s.consult.bank).toHaveLength(1);
    expect(s.consult.tax).toHaveLength(1);
    expect(state.isDraft).toBe(true);
    expect(state.bankDoc.isDraft).toBe(true);
    // 読み出しても同じ
    expect(await getReportFrom(db, DEMO_A)).toEqual(state);
  });

  it("90日計画が無ければ章7は案内文", async () => {
    await seedDiagnosis();
    const state = await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    expect(state.summary.actions.items).toHaveLength(0);
    expect(state.summary.actions.emptyMessage).toBe(MSG_NO_ACTION_PLAN);
  });

  it("壊れた返事（銀行・専門家の相談が空）は1回だけ再送する", async () => {
    await seedDiagnosis();
    const bad = reportOut("BAD", { consult: { bank: [], tax: [], other: [] } });
    const ai = fakeAi([bad, reportOut("OK")]);
    const state = await createReport({ db, ai }, DEMO_A, "successor");
    expect(ai.requests).toHaveLength(2);
    expect(state.summary.results.comment).toContain("OK");
  });
});

describe("診断との結びつき・削除", () => {
  it("診断を作り直したら、古い資料は返らない（DB からも消える）", async () => {
    await seedDiagnosis();
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    await new Promise((r) => setTimeout(r, 5));
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "successor");
    expect(await getReportFrom(db, DEMO_A)).toBeNull();
    expect(await count("reports")).toBe(0);
  });

  it("共有を取り消したら、資料が消える（取り消しと同じ batch）", async () => {
    await seedAll();
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    expect(await count("reports")).toBe(1);
    await setShared(db, DEMO_A, "predecessor", { themeKey: "cashflow", shared: false });
    expect(await count("reports")).toBe(0);
    expect(await getReportFrom(db, DEMO_A)).toBeNull();
  });

  it("取り消しだけが反映され資料が残った状態でも、読み出しは返さずに消す", async () => {
    await seedDiagnosis();
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    await db.execute({ sql: `UPDATE theme_records SET shared = 0 WHERE demo_id = ? AND role = 'successor'`, args: [DEMO_A] });
    expect(await getReportFrom(db, DEMO_A)).toBeNull();
    expect(await count("reports")).toBe(0);
  });

  it("AI を待っている間に共有が取り消されたら、資料は保存せず 409", async () => {
    await seedDiagnosis();
    const ai = fakeAi([
      async () => {
        await setShared(db, DEMO_A, "predecessor", { themeKey: "cashflow", shared: false });
        return JSON.stringify(reportOut());
      },
    ]);
    await expect(createReport({ db, ai }, DEMO_A, "successor")).rejects.toMatchObject({
      status: 409,
      userMessage: MSG_REPORT_CHANGED,
    });
    expect(await count("reports")).toBe(0);
  });

  it("別のデモ ID からは見えない", async () => {
    await seedDiagnosis(DEMO_A);
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    expect(await getReportFrom(db, DEMO_B)).toBeNull();
    await expect(createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_B, "successor")).rejects.toMatchObject({ status: 409 });
    expect(await count("reports", DEMO_A)).toBe(1);
  });

  it("デモのやり直し（DELETE /api/demo）で消える", async () => {
    await seedDiagnosis();
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    await deleteDemoData(db, DEMO_A);
    expect(await count("reports")).toBe(0);
  });

  it("7日使われていなければ保存期間の削除で消え、最近の資料は残る", async () => {
    await seedDiagnosis(DEMO_A);
    await seedDiagnosis(DEMO_B);
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_A, "successor");
    await createReport({ db, ai: fakeAi([reportOut()]) }, DEMO_B, "successor");
    const now = new Date(Date.now() + 8 * 86_400_000);
    // DEMO_B は「最近使った」ことにする（資料の updated_at だけを新しくする）
    await db.execute({ sql: `UPDATE reports SET updated_at = ? WHERE demo_id = ?`, args: [now.toISOString(), DEMO_B] });
    await db.execute({ sql: `UPDATE ai_usage SET updated_at = '2000-01-01T00:00:00.000Z'`, args: [] });
    const { demos } = await purgeExpiredDemos(db, { now, retentionDays: 7 });
    expect(demos).toBe(1);
    expect(await count("reports", DEMO_A)).toBe(0);
    expect(await count("reports", DEMO_B)).toBe(1);
  });
});
