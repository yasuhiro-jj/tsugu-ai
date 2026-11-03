// 会社の設定の検証（lib/company-settings.ts の validateSettings）と、400 の応答の形。DB はメモリ。

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb, DEMO_A } from "./helpers";
import { MSG_SETTINGS_INVALID, saveSettings, SETTINGS_EDITS_DAILY_LIMIT, validateSettings } from "@/lib/company-settings";
import { cloneSettings, INDUSTRY_PRESETS, TSUGUMI_SETTINGS } from "@/lib/industry-presets";
import { handleJsonApi } from "@/lib/api";
import { PLAN_EDITS_DAILY_LIMIT } from "@/lib/action-plan";
import { DEFAULT_WANTS } from "@/lib/learning";
import { THEMES } from "@/lib/themes";
import { ServiceError } from "@/lib/errors";
import type { CompanySettings } from "@/lib/settings-types";

const base = () => cloneSettings(TSUGUMI_SETTINGS);

/** 誤りの欄（fieldErrors のキー）を返す。誤りが無ければ null */
function errorsOf(s: unknown): Record<string, string> | null {
  try {
    validateSettings(s);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(ServiceError);
    const e = err as ServiceError;
    expect(e.status).toBe(400);
    expect(e.userMessage).toBe(MSG_SETTINGS_INVALID);
    return (e.extra?.fieldErrors ?? {}) as Record<string, string>;
  }
}

function withChange(f: (s: CompanySettings) => void): CompanySettings {
  const s = base();
  f(s);
  return s;
}

describe("初期値と業種の型", () => {
  it("つぐみの初期値は検証を通り、元の定数と同じ", () => {
    expect(errorsOf(TSUGUMI_SETTINGS)).toBeNull();
    expect(TSUGUMI_SETTINGS.company.name).toBe("食事処 つぐみ（架空）");
    expect(TSUGUMI_SETTINGS.company.industryNote).toBe("和食の食事処");
    for (const t of THEMES) {
      if (t.key === "closing") continue;
      expect(TSUGUMI_SETTINGS.themeHints[t.key]).toBe(t.hint);
    }
    expect(INDUSTRY_PRESETS.restaurant.defaultWants).toBe(DEFAULT_WANTS);
    expect(INDUSTRY_PRESETS.restaurant.upsideEnabled).toBe(true);
    for (const k of ["manufacturing", "retail", "other"] as const) expect(INDUSTRY_PRESETS[k].upsideEnabled).toBe(false);
  });

  it("業種の型のテーマの補足・学びたいことは、そのまま保存できる", () => {
    for (const k of ["restaurant", "manufacturing", "retail", "other"] as const) {
      const s = withChange((x) => {
        x.industry = k;
        x.themeHints = { ...INDUSTRY_PRESETS[k].themeHints };
      });
      expect(errorsOf(s)).toBeNull();
      expect([...INDUSTRY_PRESETS[k].defaultWants].length).toBeLessThanOrEqual(200);
    }
  });

  it("書き換えの上限は90日計画の書き換えと同じ", () => {
    expect(SETTINGS_EDITS_DAILY_LIMIT).toBe(PLAN_EDITS_DAILY_LIMIT);
  });
});

describe("文字の欄", () => {
  it("境界値：会社名 1〜40字、業種の補足 60字、概要 300字、名前 1〜20字、テーマの補足 80字", () => {
    const cases: [string, (s: CompanySettings, n: number) => void, number, number][] = [
      ["company.name", (s, n) => (s.company.name = "あ".repeat(n)), 1, 40],
      ["company.industryNote", (s, n) => (s.company.industryNote = "あ".repeat(n)), 0, 60],
      ["company.overview", (s, n) => (s.company.overview = "あ".repeat(n)), 0, 300],
      ["people.predecessorName", (s, n) => (s.people.predecessorName = "あ".repeat(n)), 1, 20],
      ["people.successorName", (s, n) => (s.people.successorName = "あ".repeat(n)), 1, 20],
      ["themeHints.policy", (s, n) => (s.themeHints.policy = "あ".repeat(n)), 0, 80],
      ["themeHints.cashflow", (s, n) => (s.themeHints.cashflow = "あ".repeat(n)), 0, 80],
    ];
    for (const [key, set, min, max] of cases) {
      expect(errorsOf(withChange((s) => set(s, max))), `${key} ${max}`).toBeNull();
      expect(errorsOf(withChange((s) => set(s, max + 1)))?.[key], `${key} ${max + 1}`).toBeTruthy();
      expect(errorsOf(withChange((s) => set(s, min))), `${key} ${min}`).toBeNull();
      if (min > 0) expect(errorsOf(withChange((s) => set(s, 0)))?.[key], `${key} 0`).toBeTruthy();
    }
    // 絵文字（サロゲートペア）は1文字として数える
    expect(errorsOf(withChange((s) => (s.company.name = "🍣".repeat(40))))).toBeNull();
    // 空白だけは空として扱う
    expect(errorsOf(withChange((s) => (s.company.name = "   ")))?.["company.name"]).toBeTruthy();
  });

  it("前後の空白は取り除いて保存する", () => {
    const v = validateSettings(withChange((s) => (s.company.name = "  山田製作所  ")));
    expect(v.company.name).toBe("山田製作所");
  });

  it("{{・<・>・バッククォート3つは、どの文字の欄でも拒否する", () => {
    for (const bad of ["{{name}}", "<b>", "a>b", "```", "前{{後"]) {
      const e = errorsOf(
        withChange((s) => {
          s.company.name = bad;
          s.company.overview = bad;
          s.people.successorName = bad;
          s.themeHints.suppliers = bad;
          s.company.industryNote = bad;
        }),
      );
      expect(Object.keys(e ?? {}).sort(), bad).toEqual(
        ["company.industryNote", "company.name", "company.overview", "people.successorName", "themeHints.suppliers"].sort(),
      );
    }
    // 1つの { や } は使える
    expect(errorsOf(withChange((s) => (s.company.name = "A{B}")))).toBeNull();
  });

  it("改行：1行の欄は拒否、概要だけ改行可（CRLF は LF にそろえる）。制御文字・見えない書式文字は拒否", () => {
    expect(errorsOf(withChange((s) => (s.company.name = "山田\n製作所")))?.["company.name"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.people.predecessorName = "山田\r太郎")))?.["people.predecessorName"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.themeHints.people = "職人\nのこと")))?.["themeHints.people"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.company.name = "山田\t製作所")))?.["company.name"]).toBeTruthy();
    const ok = validateSettings(withChange((s) => (s.company.overview = "創業1970年\r\n従業員12名")));
    expect(ok.company.overview).toBe("創業1970年\n従業員12名");
    expect(errorsOf(withChange((s) => (s.company.overview = "創業\u0007")))?.["company.overview"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.company.overview = "向き\u202eの制御")))?.["company.overview"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.company.name = "行\u2028区切り")))?.["company.name"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.company.name = "幅\u200bなし")))?.["company.name"]).toBeTruthy();
  });

  it("文字列でない値は拒否する", () => {
    expect(errorsOf(withChange((s) => ((s.company as Record<string, unknown>).name = 123)))?.["company.name"]).toBeTruthy();
    expect(errorsOf(null)).toEqual({ settings: "設定の形式が正しくありません" });
    expect(errorsOf([])).toEqual({ settings: "設定の形式が正しくありません" });
  });
});

describe("選択肢の欄", () => {
  it("業種・関係・Lv は選択肢だけ", () => {
    expect(errorsOf(withChange((s) => ((s as Record<string, unknown>).industry = "bank")))?.industry).toBeTruthy();
    expect(errorsOf(withChange((s) => ((s.people as Record<string, unknown>).relation = "親戚")))?.["people.relation"]).toBeTruthy();
    expect(errorsOf(withChange((s) => ((s.people as Record<string, unknown>).successorLevel = "Lv5")))?.["people.successorLevel"]).toBeTruthy();
    expect(errorsOf(withChange((s) => (s.people.relation = "従業員")))).toBeNull();
    expect(errorsOf(withChange((s) => (s.people.predecessorLevel = "Lv4")))).toBeNull();
  });
});

describe("決算の数字", () => {
  it("売上 1〜1,000,000、当期純利益 −1,000,000〜1,000,000、それ以外 0〜1,000,000（万円の整数）", () => {
    const at = (f: (s: CompanySettings) => void) => errorsOf(withChange(f));
    expect(at((s) => (s.financials.current.sales = 1))).toBeNull();
    expect(at((s) => (s.financials.current.sales = 1_000_000))).toBeNull();
    expect(at((s) => (s.financials.current.sales = 0))?.["financials.current.sales"]).toBeTruthy();
    expect(at((s) => (s.financials.previous.sales = 1_000_001))?.["financials.previous.sales"]).toBeTruthy();
    expect(at((s) => (s.financials.current.netIncome = -1_000_000))).toBeNull();
    expect(at((s) => (s.financials.current.netIncome = -1_000_001))?.["financials.current.netIncome"]).toBeTruthy();
    expect(at((s) => (s.financials.current.netIncome = 1_000_001))?.["financials.current.netIncome"]).toBeTruthy();
    expect(at((s) => (s.financials.current.cash = 0))).toBeNull();
    expect(at((s) => (s.financials.current.cash = -1))?.["financials.current.cash"]).toBeTruthy();
    expect(at((s) => (s.financials.previous.debt = -5))?.["financials.previous.debt"]).toBeTruthy();
    expect(at((s) => (s.financials.current.labor = 1_000_001))?.["financials.current.labor"]).toBeTruthy();
    expect(at((s) => (s.financials.current.cogs = 1.5))?.["financials.current.cogs"]).toBeTruthy();
    expect(at((s) => ((s.financials.current as Record<string, unknown>).cogs = Number.NaN))?.["financials.current.cogs"]).toBeTruthy();
    expect(at((s) => ((s.financials.current as Record<string, unknown>).cogs = "abc"))?.["financials.current.cogs"]).toBeTruthy();
    expect(at((s) => ((s.financials.current as Record<string, unknown>).cogs = null))?.["financials.current.cogs"]).toBeTruthy();
    // 数字だけの文字列は整数として受け付ける
    expect(validateSettings(withChange((s) => ((s.financials.current as Record<string, unknown>).cogs = "2300"))).financials.current.cogs).toBe(2300);
  });

  it("誤りが複数あれば、欄ごとにすべて返す", () => {
    const e = errorsOf(
      withChange((s) => {
        s.company.name = "";
        s.financials.current.sales = 0;
        s.financials.previous.cash = -1;
      }),
    );
    expect(Object.keys(e!).sort()).toEqual(["company.name", "financials.current.sales", "financials.previous.cash"]);
  });

  it("決まった項目だけを組み直す（知らない項目は捨てる）", () => {
    const raw = { ...base(), evil: "x", company: { ...base().company, extra: 1 } };
    const v = validateSettings(raw);
    expect(JSON.stringify(v)).not.toContain("evil");
    expect(JSON.stringify(v)).not.toContain("extra");
  });
});

describe("400 の応答に fieldErrors が入る", () => {
  it("PUT /api/settings と同じ入口で、欄ごとの誤りを返す（ok:false）", async () => {
    const db = await createTestDb();
    const request = new NextRequest("http://localhost:3000/api/settings", {
      method: "PUT",
      headers: { host: "localhost:3000", "content-type": "application/json" },
      body: "{}",
    });
    const bad = withChange((s) => (s.financials.current.sales = 0));
    const res = await handleJsonApi(
      request,
      { where: "settings.put", mutation: "json" },
      async ({ session, db: d }) => ({ ...(await saveSettings(d, session.demoId, session.role, { settings: bad, rev: 0 })) }),
      { getSession: async () => ({ demoId: DEMO_A, role: "successor" }), getDb: async () => db },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe(MSG_SETTINGS_INVALID);
    expect(Object.keys(body.fieldErrors)).toEqual(["financials.current.sales"]);
  });
});
