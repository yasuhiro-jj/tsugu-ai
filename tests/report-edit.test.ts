// 決算サマリー・相談用資料の文の編集（PUT /api/report・updateReport）。Claude は偽物、DB はメモリ。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { NextRequest } from "next/server";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { runDiagnosis } from "@/lib/diagnosis";
import { getFinancialSummary } from "@/lib/financials";
import { ASSERTIVE_CAUTION } from "@/lib/assertive";
import { handleJsonApi, type ApiEnv } from "@/lib/api";
import { readJsonBody } from "@/lib/http";
import { usageDayKey } from "@/lib/ai/usage";
import { PLAN_EDITS_DAILY_LIMIT } from "@/lib/action-plan";
import {
  createReport,
  getReportFrom,
  MSG_REPORT_CHANGED,
  MSG_REPORT_EDIT_CONFLICT,
  MSG_REPORT_EDIT_LIMIT,
  MSG_REPORT_NOT_FOUND,
  updateReport,
} from "@/lib/report";
import { REPORT_LIMITS, type ReportAiParts, type ReportState } from "@/lib/report-types";
import type { JsonAi } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

function fakeAi(queue: unknown[]): JsonAi {
  const q = queue.map((x) => JSON.stringify(x));
  return (async () => {
    const next = q.shift();
    if (next === undefined) throw new Error("queue empty");
    return next;
  }) as JsonAi;
}

async function putTheme(demoId: string, role: Role) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, 'cashflow', '[]', 0, 'confirmed', ?, 1, 0, ?)`,
    args: [demoId, role, JSON.stringify({ statements: ["s"], ai_observations: [], unconfirmed: [] }), new Date().toISOString()],
  });
}

const DIAG = {
  common: [{ point: "店を続けたい", evidence: "二人とも話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見方", senior_said: "s", successor_said: "t", numbers: "n", importance: "高" }],
  to_confirm: [],
  talk_questions: ["問い1", "問い2"],
};
const reportOut = (tag = "R1"): ReportAiParts => ({
  results_comment: `${tag} 売上が減っています`,
  financial_comment: `${tag} 手元資金が減っています`,
  strengths: [{ text: "常連が多い", basis: "診断の共通点" }],
  issues: [{ text: "原価率の上昇", basis: "原価率" }],
  outlook_viewpoints: ["続けられるか"],
  consult: { bank: ["返済の条件を相談できますか"], tax: ["承継の税金について教えてください"], other: [] },
  bank_doc: { purpose: `${tag} 返済の相談`, questions: ["質問1", "質問2"] },
});

async function seedReport(demoId = DEMO_A): Promise<ReportState> {
  await putTheme(demoId, "predecessor");
  await putTheme(demoId, "successor");
  await runDiagnosis({ db, ai: fakeAi([DIAG]) }, demoId, "predecessor");
  return createReport({ db, ai: fakeAi([reportOut()]) }, demoId, "successor");
}

/** 編集欄の今の値を直した ai を作る */
function edited(state: ReportState, change: (ai: ReportAiParts) => void): ReportAiParts {
  const ai = structuredClone(state.editable);
  change(ai);
  return ai;
}

const tables = (s: ReportState) => ({
  results: s.summary.results.table,
  financial: s.summary.financial.table,
  bank: s.bankDoc.numbers,
  scenarios: s.summary.outlook.scenarios,
  external: s.summary.external.topics,
  basic: s.summary.basic.companyName,
});

describe("PUT /api/report（updateReport）", () => {
  it("作った直後：updatedAt と editable があり、editedAt は無い", async () => {
    const state = await seedReport();
    expect(state.updatedAt).toMatch(/Z$/);
    expect(state.editedAt).toBeUndefined();
    expect(state.editable).toEqual(reportOut());
  });

  it("文を直して保存すると、読み直しても残る。editedAt・updatedAt が付く", async () => {
    const state = await seedReport();
    const ai = edited(state, (a) => {
      a.results_comment = "直した説明\n2行目";
      a.strengths[0].text = "常連が多い（直した）";
      a.strengths.push({ text: "立地", basis: "" });
      a.consult.other = ["保険の見直し"];
      a.bank_doc.questions = ["直した質問1", "直した質問2", "直した質問3"];
    });
    const saved = await updateReport(db, DEMO_A, { ai, updatedAt: state.updatedAt });
    expect(saved.summary.results.comment).toBe("直した説明\n2行目");
    expect(saved.summary.strengthsAndIssues.strengths).toEqual([
      { text: "常連が多い（直した）", basis: "診断の共通点" },
      { text: "立地", basis: "" },
    ]);
    expect(saved.summary.consult.other).toEqual(["保険の見直し"]);
    expect(saved.bankDoc.questions).toHaveLength(3);
    expect(saved.editable).toEqual(ai);
    expect(saved.editedAt).toBeDefined();
    expect(saved.updatedAt).toBe(saved.editedAt);
    expect(saved.updatedAt > state.updatedAt).toBe(true);
    expect(saved.createdAt).toBe(state.createdAt);
    expect(await getReportFrom(db, DEMO_A)).toEqual(saved);
  });

  it("数字の表は変わらない（ai に数字らしき項目を混ぜても表に反映されない）", async () => {
    const state = await seedReport();
    const ai = {
      ...edited(state, (a) => (a.financial_comment = "直した")),
      results: { table: { rows: [{ label: "売上高", previous: "9999万円", current: "9999万円" }] } },
      numbers: { rows: [{ label: "売上高", current: "9999万円" }] },
      scenarios: { improved: { operatingProfitText: "+9999万円" } },
      companyName: "別の会社",
    };
    const saved = await updateReport(db, DEMO_A, { ai, updatedAt: state.updatedAt });
    expect(JSON.stringify(saved)).not.toContain("9999");
    expect(JSON.stringify(saved)).not.toContain("別の会社");
    expect(tables(saved)).toEqual(tables(state));
    const app = getFinancialSummary().rows.find((r) => r.label === "売上高")!;
    expect(saved.summary.results.table.rows.find((r) => r.label === "売上高")!.current).toBe(app.current);
    // 保存した中身にも混ぜた項目は入らない
    const raw = String((await db.execute({ sql: `SELECT content FROM reports WHERE demo_id = ?`, args: [DEMO_A] })).rows[0].content);
    expect(raw).not.toContain("9999");
  });

  it("上限を超えたら 400（どの欄かを field で返す）。保存はされない", async () => {
    const state = await seedReport();
    const cases: [(a: ReportAiParts) => void, string][] = [
      [(a) => (a.results_comment = "あ".repeat(REPORT_LIMITS.commentMax + 1)), "results_comment"],
      [(a) => (a.strengths[0].text = "あ".repeat(REPORT_LIMITS.itemMax + 1)), "strengths.0.text"],
      [(a) => (a.issues[0].basis = "あ".repeat(REPORT_LIMITS.itemMax + 1)), "issues.0.basis"],
      [(a) => (a.bank_doc.purpose = "あ".repeat(REPORT_LIMITS.purposeMax + 1)), "bank_doc.purpose"],
      [(a) => (a.strengths = Array.from({ length: REPORT_LIMITS.pointsMax + 1 }, () => ({ text: "t", basis: "" }))), "strengths"],
      [(a) => (a.consult.bank = Array.from({ length: REPORT_LIMITS.consultMax + 1 }, () => "x")), "consult.bank"],
      [(a) => (a.bank_doc.questions = ["1つだけ"]), "bank_doc.questions"],
      [(a) => (a.consult.tax = []), "consult.tax"],
      [(a) => (a.issues = []), "issues"],
      [(a) => (a.consult.bank = ["一行目\n二行目"]), "consult.bank.0"],
      [(a) => (a.outlook_viewpoints = ["見えない‮文字"]), "outlook_viewpoints.0"],
      [(a) => (a.financial_comment = "  "), "financial_comment"],
      [(a) => (a.bank_doc.questions = ["質問", 3 as unknown as string]), "bank_doc.questions.1"],
    ];
    for (const [change, field] of cases) {
      await expect(updateReport(db, DEMO_A, { ai: edited(state, change), updatedAt: state.updatedAt })).rejects.toMatchObject({
        status: 400,
        extra: { field },
      });
    }
    // 上限ちょうどは保存できる（サロゲートペアは1文字）
    const ok = await updateReport(db, DEMO_A, {
      ai: edited(state, (a) => (a.results_comment = "𠮷".repeat(REPORT_LIMITS.commentMax))),
      updatedAt: state.updatedAt,
    });
    expect(ok.summary.results.comment).toBe("𠮷".repeat(REPORT_LIMITS.commentMax));
    // 形が違う
    await expect(updateReport(db, DEMO_A, { ai: "x", updatedAt: ok.updatedAt })).rejects.toMatchObject({ status: 400 });
    await expect(updateReport(db, DEMO_A, { ai: ok.editable })).rejects.toMatchObject({ status: 400, extra: { field: "updatedAt" } });
  });

  it("updatedAt が古ければ 409（後から保存した人の文で上書きしない）", async () => {
    const state = await seedReport();
    const first = await updateReport(db, DEMO_A, { ai: edited(state, (a) => (a.results_comment = "一人目")), updatedAt: state.updatedAt });
    await expect(
      updateReport(db, DEMO_A, { ai: edited(state, (a) => (a.results_comment = "二人目")), updatedAt: state.updatedAt }),
    ).rejects.toMatchObject({ status: 409, userMessage: MSG_REPORT_EDIT_CONFLICT });
    expect((await getReportFrom(db, DEMO_A))!.summary.results.comment).toBe("一人目");
    // 同じ updatedAt を続けて使っても、保存のたびに updatedAt は進む
    const second = await updateReport(db, DEMO_A, { ai: first.editable, updatedAt: first.updatedAt });
    expect(second.updatedAt > first.updatedAt).toBe(true);
    await expect(updateReport(db, DEMO_A, { ai: first.editable, updatedAt: first.updatedAt })).rejects.toMatchObject({ status: 409 });
  });

  it("診断が作り直されていたら 409", async () => {
    const state = await seedReport();
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "successor");
    await expect(
      updateReport(db, DEMO_A, { ai: edited(state, (a) => (a.results_comment = "直した")), updatedAt: state.updatedAt }),
    ).rejects.toMatchObject({ status: 409, userMessage: MSG_REPORT_CHANGED });
  });

  it("別のデモ ID からは 404 で保存できない（A の資料は変わらない）", async () => {
    const state = await seedReport(DEMO_A);
    await expect(
      updateReport(db, DEMO_B, { ai: edited(state, (a) => (a.results_comment = "B が書いた")), updatedAt: state.updatedAt }),
    ).rejects.toMatchObject({ status: 404, userMessage: MSG_REPORT_NOT_FOUND });
    expect(await getReportFrom(db, DEMO_A)).toEqual(state);
    expect(await getReportFrom(db, DEMO_B)).toBeNull();
  });

  it("断定表現を書くと caution が付き、直すと消える", async () => {
    const state = await seedReport();
    expect(state.caution).toBeUndefined();
    const bad = await updateReport(db, DEMO_A, {
      ai: edited(state, (a) => (a.consult.bank = ["この計画なら融資が通ります"])),
      updatedAt: state.updatedAt,
    });
    expect(bad.caution).toBe(ASSERTIVE_CAUTION);
    expect(bad.draftNotice).toContain(ASSERTIVE_CAUTION);
    const good = await updateReport(db, DEMO_A, {
      ai: edited(bad, (a) => (a.consult.bank = ["融資を受けられるか、銀行に確認しますか"])),
      updatedAt: bad.updatedAt,
    });
    expect(good.caution).toBeUndefined();
  });

  it("作り直すと編集が消えて AI の新しい下書きに戻る。作り直す前の画面からの保存は 409", async () => {
    const state = await seedReport();
    const saved = await updateReport(db, DEMO_A, { ai: edited(state, (a) => (a.results_comment = "直した")), updatedAt: state.updatedAt });
    const again = await createReport({ db, ai: fakeAi([reportOut("R2")]) }, DEMO_A, "predecessor");
    expect(again.editedAt).toBeUndefined();
    expect(again.editable).toEqual(reportOut("R2"));
    expect(again.summary.results.comment).toBe("R2 売上が減っています");
    expect(again.updatedAt > saved.updatedAt).toBe(true);
    await expect(updateReport(db, DEMO_A, { ai: saved.editable, updatedAt: saved.updatedAt })).rejects.toMatchObject({
      status: 409,
      userMessage: MSG_REPORT_EDIT_CONFLICT,
    });
  });

  it("書き換えの回数は plan_edit_usage で数え、上限なら 429", async () => {
    const state = await seedReport();
    await updateReport(db, DEMO_A, { ai: state.editable, updatedAt: state.updatedAt });
    const day = usageDayKey(new Date().toISOString());
    const n = await db.execute({ sql: `SELECT calls FROM plan_edit_usage WHERE demo_id = ? AND day = ?`, args: [DEMO_A, day] });
    expect(Number(n.rows[0].calls)).toBe(1);
    await db.execute({ sql: `UPDATE plan_edit_usage SET calls = ? WHERE demo_id = ?`, args: [PLAN_EDITS_DAILY_LIMIT, DEMO_A] });
    const now = (await getReportFrom(db, DEMO_A))!;
    await expect(updateReport(db, DEMO_A, { ai: now.editable, updatedAt: now.updatedAt })).rejects.toMatchObject({
      status: 429,
      userMessage: MSG_REPORT_EDIT_LIMIT,
    });
  });

  it("API の入口：クッキーのデモ用 ID で保存し、400 は field を返す", async () => {
    const state = await seedReport();
    const env: ApiEnv = { getSession: async () => ({ demoId: DEMO_A, role: "successor" }), getDb: async () => db };
    const call = (body: unknown) => {
      const req = new NextRequest("http://localhost/api/report", {
        method: "PUT",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify(body),
      });
      return handleJsonApi(
        req,
        { where: "report.put", mutation: "json" },
        async ({ session, db: d }) => ({ state: await updateReport(d, session.demoId, await readJsonBody(req)) }),
        env,
      );
    };
    const bad = await call({ ai: edited(state, (a) => (a.strengths[0].text = "")), updatedAt: state.updatedAt });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, field: "strengths.0.text" });
    const res = await call({ ai: edited(state, (a) => (a.results_comment = "API で直した")), updatedAt: state.updatedAt });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; state: ReportState };
    expect(json.ok).toBe(true);
    expect(json.state.summary.results.comment).toBe("API で直した");
  });
});
