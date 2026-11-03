// AI が作った数字・発言を見つける仕組み（lib/grounding.ts。外部評価の指摘への対応 2026-11-03）と、
// 損益（もうけ）とお金の動き（資金繰り）の分け方（lib/financials.ts）、共有を取り消すと消えるもの（revokeImpact）。
// Claude は偽物、DB はメモリ。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import {
  extractNumbers,
  financialAllowedNumbers,
  findUngroundedNumbers,
  findUnsupportedQuotes,
  GROUNDING_NOTICE_PREFIX,
  groundingNotice,
  quoteOverlap,
} from "@/lib/grounding";
import {
  CASH_FLOW_FORMULA,
  financialsForPrompt,
  getFinancialSummary,
  PL_CASH_SEPARATION_RULE,
  PRINCIPAL_REPAYMENT_NOTE,
  TSUGUMI_FINANCIALS,
} from "@/lib/financials";
import { TSUGUMI_SETTINGS } from "@/lib/industry-presets";
import { getDiagnosisFrom, runDiagnosis, toPublicDiagnosisRecord } from "@/lib/diagnosis";
import { getAdvisorStateFrom, sendAdvisorMessage } from "@/lib/advisor";
import { askAboutArticle } from "@/lib/learning-ask";
import { buildReportState, createReport, REPORT_ROW_LABELS, type ReportAiParts } from "@/lib/report";
import { getInterviewState, setShared } from "@/lib/interview/service";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type FakeAi = JsonAi & { requests: JsonAiRequest[]; queue: unknown[] };
function fakeAi(queue: unknown[]): FakeAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === undefined) throw new Error("queue empty");
    return JSON.stringify(next);
  }) as FakeAi;
  fn.requests = [];
  fn.queue = queue;
  return fn;
}

const FIN = new Set(financialAllowedNumbers(TSUGUMI_FINANCIALS, TSUGUMI_SETTINGS));

// 共有済み要約（架空）
const SENIOR = ["店の味は守りたい", "借入の返済は銀行と話してある", "常連さんを大事にしてきた"];
const SUCCESSOR = ["ランチの値段を見直したい", "返済の予定表をまだ見ていない", "常連さんを大事にしたい"];

async function putTheme(role: Role, key: string, statements: string[]) {
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, '[]', 0, 'confirmed', ?, 1, 0, 'x')`,
    args: [DEMO_A, role, key, JSON.stringify({ statements, ai_observations: [], unconfirmed: [] })],
  });
}
async function shareBoth() {
  await putTheme("predecessor", "cashflow", SENIOR);
  await putTheme("successor", "cashflow", SUCCESSOR);
}

function diag(over: { senior_said?: string; successor_said?: string; numbers?: string; evidence?: string } = {}) {
  return {
    common: [{ point: "常連を大事にする", evidence: over.evidence ?? "常連さんを大事にしてきた・したい" }],
    gaps: [
      {
        theme: "資金繰り",
        point: "返済の見方",
        senior_said: over.senior_said ?? "借入の返済は銀行と話してある",
        successor_said: over.successor_said ?? "返済の予定表をまだ見ていない",
        numbers: over.numbers ?? "営業利益 ▲236万円、手元資金は月商の約1.8か月分、FL比率 79.0%",
        importance: "高",
      },
    ],
    to_confirm: [{ item: "返済予定表", how: "銀行に聞く", expert: "銀行" }],
    talk_questions: ["問い1", "問い2"],
    directions: { keep: [], improve: [], tryNew: [] },
  };
}

describe("数字の照合（findUngroundedNumbers）", () => {
  it("作り話の数字（返済は月35万円）を見つける", () => {
    expect(findUngroundedNumbers("返済は月35万円です", FIN)).toEqual(["35万円"]);
  });

  it("アプリの計算値（▲236万円、1.8か月、79.0%、月20万円、+358万円）は見つけない", () => {
    const t = "営業利益は▲236万円、手元資金は月商の約1.8か月分、FL比率は79.0%。返済は月20万円。改善の余地は+358万円";
    expect(findUngroundedNumbers(t, FIN)).toEqual([]);
  });

  it("四捨五入による差（1.8 と 1.79、236 と 235.6）は許し、桁の違う数字は見つける", () => {
    const allowed = new Set(["1.8か月", "▲235.6万円"]);
    expect(findUngroundedNumbers("約1.79か月分", allowed)).toEqual([]);
    expect(findUngroundedNumbers("236万円の赤字", allowed)).toEqual([]);
    expect(findUngroundedNumbers("1.7か月", allowed)).toEqual(["1.7か月"]);
    // 実際の値 808÷450＝1.7955… と、書き方 1.80 の差も許す
    expect(findUngroundedNumbers("1.80か月", FIN)).toEqual([]);
  });

  it("全角の数字・記号、カンマ、▲・−、円への換算に対応する", () => {
    expect(findUngroundedNumbers("営業利益は−２３６万円、FL比率７９．０％", FIN)).toEqual([]);
    expect(findUngroundedNumbers("売上は５，４００万円、借入は2,360万円、つまり23,600,000円", FIN)).toEqual([]);
    expect(findUngroundedNumbers("返済は３５万円", FIN)).toEqual(["35万円"]);
    expect(findUngroundedNumbers("売上は1,234万円", FIN)).toEqual(["1,234万円"]);
  });

  it("「約」は末尾の0の桁まで丸めとみなす（約800万円は808万円の丸め、約900万円は違う）", () => {
    expect(findUngroundedNumbers("手元資金は約800万円", FIN)).toEqual([]);
    expect(findUngroundedNumbers("手元資金は約900万円", FIN)).toEqual(["約900万円"]);
  });

  it("日付や決まった数字（2026年3月期・令和7年・90日・1〜30日・3か月）は対象外", () => {
    expect(findUngroundedNumbers("2026年3月期の決算。令和7年に始め、90日計画の1〜30日目、3か月後に見直す", new Set())).toEqual([]);
    expect(extractNumbers("2026年3月期、90日")).toEqual([]);
  });

  it("範囲（2〜3件）や、Lv1 のような英字つきの数字を正しく扱う", () => {
    expect(findUngroundedNumbers("Lv1の人向けに2〜3件", new Set(["2件", "3件"]))).toEqual([]);
    expect(findUngroundedNumbers("2〜5件", new Set(["2件"]))).toEqual(["2〜5件"]);
  });

  it("共有済み要約の本文の数字は根拠になる", () => {
    const allowed = new Set([...FIN, "店は30年続けてきた"]);
    expect(findUngroundedNumbers("先代は30年店を続けてきた", allowed)).toEqual([]);
    expect(findUngroundedNumbers("先代は40年店を続けてきた", allowed)).toEqual(["40年"]);
  });
});

describe("発言の照合（findUnsupportedQuotes）", () => {
  it("言っていない発言（先代「店を売るつもりだ」）を見つけ、要約から引いた発言は見つけない", () => {
    const r = findUnsupportedQuotes([
      { quote: "店を売るつもりだ", sources: SENIOR },
      { quote: "先代は「借入の返済は銀行と話してある」と話している", sources: SENIOR },
      { quote: "店の味は守りたい", sources: SENIOR },
    ]);
    expect(r).toEqual(["店を売るつもりだ"]);
  });

  it("相手の要約にだけある内容は、その人の発言としては認めない", () => {
    expect(quoteOverlap("ランチの値段を見直したい", SENIOR)!).toBeLessThan(0.5);
    expect(quoteOverlap("ランチの値段を見直したい", SUCCESSOR)!).toBeGreaterThanOrEqual(0.5);
  });

  it("空・1文字・「話に出ていない」は照合しない", () => {
    expect(findUnsupportedQuotes([
      { quote: "", sources: SENIOR },
      { quote: "s", sources: SENIOR },
      { quote: "この点には触れていない", sources: SENIOR },
    ])).toEqual([]);
  });
});

describe("出力への付け方", () => {
  it("診断：作り話の数字と言っていない発言が grounding に入り、公開用の変換後も残る", async () => {
    await shareBoth();
    const ai = fakeAi([diag({ senior_said: "店を売るつもりだ", numbers: "返済は月35万円、営業利益 ▲236万円" })]);
    const rec = await runDiagnosis({ db, ai }, DEMO_A, "predecessor");
    expect(rec.grounding).toEqual({ ungroundedNumbers: ["35万円"], unsupportedQuotes: ["店を売るつもりだ"] });
    expect(toPublicDiagnosisRecord(rec).grounding).toEqual(rec.grounding);
    expect(groundingNotice(rec.grounding)).toBe(`${GROUNDING_NOTICE_PREFIX}35万円、「店を売るつもりだ」`);
  });

  it("診断：正しい数字と要約から引いた発言だけなら grounding は付かない", async () => {
    await shareBoth();
    const rec = await runDiagnosis({ db, ai: fakeAi([diag()]) }, DEMO_A, "predecessor");
    expect(rec.grounding).toBeUndefined();
    expect(groundingNotice(rec.grounding)).toBeNull();
    expect((await getDiagnosisFrom(db, DEMO_A))?.grounding).toBeUndefined();
  });

  it("AI参謀：作り話の数字は返事に grounding が付き、保存後も読み直せる。本人が書いた数字は根拠になる", async () => {
    const ai = fakeAi([
      { reply: "返済は月35万円なので厳しいです", points: [], consult: "不要", consult_note: "" },
      { reply: "おっしゃる月50万円の仕入れと、営業利益 ▲236万円は分けて考えます", points: [], consult: "不要", consult_note: "" },
    ]);
    const s1 = await sendAdvisorMessage({ db, ai, sleep: async () => {} }, DEMO_A, "successor", "資金繰りが心配です");
    const m1 = s1.messages[1];
    expect(m1.from === "ai" && m1.grounding).toEqual({ ungroundedNumbers: ["35万円"], unsupportedQuotes: [] });
    const s2 = await sendAdvisorMessage({ db, ai, sleep: async () => {} }, DEMO_A, "successor", "仕入れが月50万円あります");
    const m2 = s2.messages[3];
    expect(m2.from === "ai" && m2.grounding).toBeUndefined();
    const saved = await getAdvisorStateFrom(db, DEMO_A, "successor");
    expect(saved.messages[1]).toMatchObject({ grounding: { ungroundedNumbers: ["35万円"] } });
    // AI に渡す履歴には grounding を入れない
    expect(JSON.stringify(ai.requests[1].messages)).not.toContain("ungroundedNumbers");
  });

  it("講座の質問：記事に無い数字は grounding に入る", async () => {
    const ai = fakeAi([{ answer: "手元資金は月商の9か月分が目安です", terms: [] }]);
    const a = await askAboutArticle({ db, ai }, DEMO_A, "successor", { courseId: "cashflow", articleNo: 1, question: "目安は？" });
    expect(a.grounding).toEqual({ ungroundedNumbers: ["9か月"], unsupportedQuotes: [] });
  });

  it("資料：AI の文の作り話の数字は grounding に入り、正しい数字だけなら付かない", () => {
    const ai: ReportAiParts = {
      results_comment: "売上が200万円減り、営業利益は▲236万円です",
      financial_comment: "手元資金は808万円で、月商の約1.8か月分です",
      strengths: [{ text: "常連が多い", basis: "診断の共通点" }],
      issues: [{ text: "原価率の上昇", basis: "原価率 40.0% → 42.0%" }],
      outlook_viewpoints: [],
      consult: { bank: ["返済の相談"], tax: ["税金の確認"], other: [] },
      bank_doc: { purpose: "返済の相談", questions: ["質問1", "質問2"] },
    };
    const meta = { createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z", diagnosisCreatedAt: "2026-11-03T00:00:00.000Z", actions: [] };
    expect(buildReportState(ai, meta).grounding).toBeUndefined();
    const bad = { ...ai, bank_doc: { purpose: "毎月35万円の返済が重い", questions: ["質問1", "質問2"] } };
    expect(buildReportState(bad, meta).grounding).toEqual({ ungroundedNumbers: ["35万円"], unsupportedQuotes: [] });
  });
});

describe("損益（もうけ）とお金の動き（資金繰り）を分ける", () => {
  it("要約に2つのまとまりと内訳・注記があり、今までの rows はそのまま", () => {
    const s = getFinancialSummary();
    expect(s.profitAndLoss.rows.map((r) => r.label)).toEqual(["売上高", "粗利", "営業利益", "経常利益", "当期純利益"]);
    expect(s.profitAndLoss.rows.some((r) => r.label.includes("返済"))).toBe(false);
    expect(s.cashMovement.formula).toBe(CASH_FLOW_FORMULA);
    expect(s.cashMovement.breakdownText).toBe("▲272万円 ＋ 120万円 − 240万円 ＝ ▲392万円");
    expect(s.cashMovement.cashChangeText).toBe("手元資金 1,200万円 → 808万円（▲392万円）");
    expect(s.cashMovement.rows.find((r) => r.label === "手元資金は月商の何か月分")?.current).toBe("約1.8か月分");
    expect(s.principalNote).toBe(PRINCIPAL_REPAYMENT_NOTE);
    expect(s.rows).toHaveLength(19);
  });

  it("AI に渡す数字は2つの見出しに分かれ、注記がつく", () => {
    const p = financialsForPrompt();
    const pl = p.indexOf("## もうけ（損益）");
    const cash = p.indexOf("## お金の動き（資金繰り）");
    expect(pl).toBeGreaterThan(0);
    expect(cash).toBeGreaterThan(pl);
    expect(p.indexOf("年間返済額（元本）")).toBeGreaterThan(cash);
    expect(p.indexOf("- 営業利益：")).toBeLessThan(cash);
    expect(p).toContain(PRINCIPAL_REPAYMENT_NOTE);
  });

  it("診断・資料・AI参謀の指示文に、損益と資金繰りを混ぜない一文が入る", async () => {
    await shareBoth();
    const dAi = fakeAi([diag()]);
    await runDiagnosis({ db, ai: dAi }, DEMO_A, "predecessor");
    expect(dAi.requests[0].system).toContain(PL_CASH_SEPARATION_RULE);
    const aAi = fakeAi([{ reply: "整理します", points: [], consult: "不要", consult_note: "" }]);
    await sendAdvisorMessage({ db, ai: aAi, sleep: async () => {} }, DEMO_A, "predecessor", "心配です");
    expect(aAi.requests[0].system).toContain(PL_CASH_SEPARATION_RULE);
    const rAi = fakeAi([
      {
        results_comment: "営業利益は▲236万円",
        financial_comment: "手元資金は808万円",
        strengths: [{ text: "常連", basis: "" }],
        issues: [{ text: "原価率", basis: "" }],
        outlook_viewpoints: [],
        consult: { bank: ["返済"], tax: ["税金"], other: [] },
        bank_doc: { purpose: "相談", questions: ["q1", "q2"] },
      },
    ]);
    const report = await createReport({ db, ai: rAi }, DEMO_A, "predecessor");
    expect(rAi.requests[0].system).toContain(PL_CASH_SEPARATION_RULE);
    // 資料の表：第2章は損益だけ、第3章はお金の動きが先で、見出しが分かれる
    expect(report.summary.results.table.groups?.map((g) => g.title)).toEqual(["もうけ（損益）"]);
    const fin = report.summary.financial.table;
    expect(fin.groups?.[0].title).toBe("お金の動き（資金繰り）");
    expect(fin.groups?.[0].rows.map((r) => r.label)).toContain("年間返済額（元本）");
    expect(fin.rows.map((r) => r.label)).toEqual([...REPORT_ROW_LABELS.financial]);
    expect(fin.note).toBe(PRINCIPAL_REPAYMENT_NOTE);
  });
});

describe("共有を取り消すと消えるもの（revokeImpact）", () => {
  it("今あるものだけ true。相手の AI参謀の会話は自分の myAdvisorChat に入らない", async () => {
    await shareBoth();
    const before = await getInterviewState(db, DEMO_A, "predecessor");
    expect(before.revokeImpact).toEqual({
      diagnosis: false,
      learningPlanWithDiagnosis: false,
      actionPlan: false,
      report: false,
      myAdvisorChat: false,
    });
    await runDiagnosis({ db, ai: fakeAi([diag()]) }, DEMO_A, "predecessor");
    // 後継者だけが診断つきで AI参謀と話す
    await sendAdvisorMessage(
      { db, ai: fakeAi([{ reply: "整理します", points: [], consult: "不要", consult_note: "" }]), sleep: async () => {} },
      DEMO_A,
      "successor",
      "心配です",
    );
    const pred = await getInterviewState(db, DEMO_A, "predecessor");
    expect(pred.revokeImpact).toMatchObject({ diagnosis: true, myAdvisorChat: false, report: false, actionPlan: false });
    const succ = await getInterviewState(db, DEMO_A, "successor");
    expect(succ.revokeImpact.myAdvisorChat).toBe(true);
    // 取り消したあとは、返ってくる状態で何も残っていない
    const after = await setShared(db, DEMO_A, "predecessor", { themeKey: "cashflow", shared: false });
    expect(Object.values(after.revokeImpact).every((v) => v === false)).toBe(true);
  });
});
