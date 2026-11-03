// 設定ダッシュボードの一致テスト（docs/settings-dashboard.md 冒頭）。
// 設定を何も変えていない（つぐみの初期値）とき、面談の指示文・診断の依頼・AI参謀の依頼・学習プランの依頼・
// 資料の数字の欄・比較画面の数字・伸びる余地が、設定ダッシュボードを入れる前と同じ文字列になることを確かめる。
//
// 記録（tests/fixtures/settings-golden.json）は、設定ダッシュボードの作業を始める前のコードで作った。
// 作り直すときだけ GOLDEN_WRITE=1 npx vitest run tests/settings-golden.test.ts（普段は作り直さない）。

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "@libsql/client";
import { aiJson, createFakeAi, createTestDb, DEMO_A } from "./helpers";
import { startInterview, getInterviewState } from "@/lib/interview/service";
import { runDiagnosis } from "@/lib/diagnosis";
import { sendAdvisorMessage } from "@/lib/advisor";
import { createLearningPlan } from "@/lib/learning";
import { createReport } from "@/lib/report";
import {
  financialsForPrompt,
  getFinancialSummary,
  getUpsideSummary,
  upsideForPrompt,
} from "@/lib/financials";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";
import { setDbForTesting } from "@/lib/db";
import { getFinancialSummaryForDemo, getUpsideSummaryForDemo } from "@/lib/company-settings";

const FIXTURE = fileURLToPath(new URL("./fixtures/settings-golden.json", import.meta.url));

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: unknown[] };
function fakeJsonAi(queue: unknown[]): FakeJsonAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === undefined) throw new Error("queue empty");
    return JSON.stringify(next);
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = queue;
  return fn;
}

const DIAG = {
  common: [{ point: "店を続けたい", evidence: "二人とも話している" }],
  gaps: [{ theme: "資金繰り", point: "返済の見方", senior_said: "s", successor_said: "t", numbers: "手元資金 808万円", importance: "高" }],
  to_confirm: [{ item: "返済予定表", how: "銀行", expert: "銀行" }],
  talk_questions: ["問い1", "問い2"],
  directions: { keep: [{ text: "だしの味", from: "二人" }], improve: [], tryNew: [] },
};
const REPORT_OUT = {
  results_comment: "売上が減り、営業利益は赤字です",
  financial_comment: "手元資金が減っています",
  strengths: [{ text: "常連が多い", basis: "診断の共通点" }],
  issues: [{ text: "原価率の上昇", basis: "原価率 40.0% → 42.0%" }],
  outlook_viewpoints: ["続けられるか"],
  consult: { bank: ["返済の条件を見直す相談はできますか"], tax: ["承継の税金について教えてください"], other: [] },
  bank_doc: { purpose: "返済の相談", questions: ["質問1", "質問2"] },
};
const ADVISOR_OUT = { reply: "整理します", points: ["手元資金"], consult: "不要", consult_note: "" };
const LEARNING_OUT = {
  plan: [{ order: 1, course_id: "cashflow", week: 1, reason: "理由", linked_gap: "資金繰り" }],
  message: "この順番でよいですか",
};

async function putTheme(db: Client, role: Role, key: string) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, '[]', 0, 'confirmed', ?, 1, 0, ?)
          ON CONFLICT(demo_id, role, theme_key) DO UPDATE SET status = 'confirmed', summary = excluded.summary, shared = 1`,
    args: [
      DEMO_A,
      role,
      key,
      JSON.stringify({ statements: [`${role}の話`], ai_observations: [], unconfirmed: ["未確認のこと"] }),
      new Date().toISOString(),
    ],
  });
}

/** 時刻・日付と、AI の待ち時間の上限（経過時間で 1ms ずれる）は毎回変わるので置き換える */
function scrub(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v, (k, x) => (k === "timeoutMs" ? undefined : x))
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<ISO>")
      .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "<JST>")
      .replace(/20\d{2}-\d{2}-\d{2}/g, "<DATE>"),
  );
}

/** 設定を保存していないデモ用 ID で、各機能が AI に渡す文字列と画面に出す数字を集める */
async function capture(db: Client): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  // 面談の指示文（先代・後継者。最初のテーマ）
  for (const role of ["predecessor", "successor"] as Role[]) {
    const ai = createFakeAi([aiJson({ reply: "こんにちは。最初の問いです", action: "followup" })]);
    await startInterview({ db, ai }, DEMO_A, role);
    out[`interview.${role}`] = ai.requests[0];
    out[`interview.${role}.displayName`] = (await getInterviewState(db, DEMO_A, role)).displayName;
  }

  // 診断の依頼
  await putTheme(db, "predecessor", "cashflow");
  await putTheme(db, "successor", "cashflow");
  const diagAi = fakeJsonAi([DIAG]);
  await runDiagnosis({ db, ai: diagAi }, DEMO_A, "predecessor");
  out["diagnosis.request"] = diagAi.requests[0];

  // AI参謀の依頼（両方の役割。診断あり）
  for (const role of ["predecessor", "successor"] as Role[]) {
    const ai = fakeJsonAi([ADVISOR_OUT]);
    await sendAdvisorMessage({ db, ai }, DEMO_A, role, "資金繰りが心配です");
    out[`advisor.${role}`] = ai.requests[0];
  }

  // 学習プランの依頼（後継者の名前・知識レベル・希望）
  const learnAi = fakeJsonAi([LEARNING_OUT]);
  await createLearningPlan({ db, ai: learnAi }, DEMO_A, "successor", {});
  out["learning.request"] = learnAi.requests[0];

  // 資料の依頼と、資料（数字の欄を含む全体）
  const reportAi = fakeJsonAi([REPORT_OUT]);
  out["report.state"] = await createReport({ db, ai: reportAi }, DEMO_A, "predecessor");
  out["report.request"] = reportAi.requests[0];

  // 比較画面の数字・伸びる余地・AI に渡す数字の文字列
  out["compare.financial"] = getFinancialSummary();
  out["compare.upside"] = getUpsideSummary();
  out["prompt.financials"] = financialsForPrompt();
  out["prompt.upside"] = upsideForPrompt();

  return scrub(out) as Record<string, unknown>;
}

describe("設定ダッシュボードの一致テスト（つぐみの初期値）", () => {
  it("設定を保存していなければ、作業前と同じ文字列・数字になる", async () => {
    const db = await createTestDb();
    const now = await capture(db);
    if (process.env.GOLDEN_WRITE === "1") {
      const dir = fileURLToPath(new URL("./fixtures/", import.meta.url));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(now, null, 1) + "\n", "utf8");
    }
    const golden = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
    for (const key of Object.keys(golden)) {
      expect(now[key], key).toEqual(golden[key]);
    }
  });

  it("画面用の関数（デモ用 ID から設定を読む）でも、比較画面の数字と伸びる余地は作業前と同じ", async () => {
    const db = await createTestDb();
    setDbForTesting(db);
    try {
      const golden = JSON.parse(readFileSync(FIXTURE, "utf8"));
      expect(scrub(await getFinancialSummaryForDemo(DEMO_A))).toEqual(golden["compare.financial"]);
      expect(scrub(await getUpsideSummaryForDemo(DEMO_A))).toEqual(golden["compare.upside"]);
    } finally {
      setDbForTesting(null);
    }
  });
});
