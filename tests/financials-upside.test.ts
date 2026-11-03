// 踏ん張れば伸びる余地（仮定の試算。Notion「デモ会社設定」3章）。
// 効果が当期の数字から計算され、AI参謀の入力に「仮定の試算」として入ることを確かめる。

import { describe, expect, it } from "vitest";
import { CURRENT_PERIOD, getUpsideSummary, UPSIDE_NOTE, upsideForPrompt } from "@/lib/financials";
import { buildAdvisorRequest } from "@/lib/advisor";

describe("getUpsideSummary", () => {
  it("各改善策の効果が 108／100／96／54 万円になる", () => {
    const u = getUpsideSummary();
    const byId = Object.fromEntries(u.items.map((i) => [i.id, i.effect]));
    expect(byId).toEqual({ costrate: 108, lunchprice: 100, banquet: 96, shift: 54 });
    expect(u.items.map((i) => i.effectText)).toEqual(["+108万円", "+100万円", "+96万円", "+54万円"]);
  });

  it("前提の文が Notion の表と同じ", () => {
    const u = getUpsideSummary();
    expect(u.items.map((i) => i.assumption)).toEqual([
      "原価率 42.0% → 40.0%",
      "1食+40円、年約25,000食",
      "年+8組×15万円、原価率20%",
      "人件費率 37.0% → 36.0%",
    ]);
  });

  it("合計は 358、営業利益は ▲236 → 122（約+120）", () => {
    const u = getUpsideSummary();
    expect(u.total).toBe(358);
    expect(u.operatingProfitBefore).toBe(-236);
    expect(u.operatingProfitAfter).toBe(122);
    expect(u.totalText).toBe("+358万円");
    expect(u.operatingProfitBeforeText).toBe("▲236万円");
    expect(u.operatingProfitAfterText).toBe("+122万円");
    expect(u.note).toBe(UPSIDE_NOTE);
    expect(u.note).toContain("実現を保証しない");
  });

  it("効果は直書きではなく当期の数字から計算される", () => {
    const saved = { ...CURRENT_PERIOD };
    try {
      CURRENT_PERIOD.sales = 6000;
      CURRENT_PERIOD.cogs = 2520; // 原価率 42% のまま
      CURRENT_PERIOD.labor = 2220; // 人件費率 37% のまま
      const byId = Object.fromEntries(getUpsideSummary().items.map((i) => [i.id, i.effect]));
      expect(byId.costrate).toBe(120); // 6000 × 2%
      expect(byId.shift).toBe(60); // 6000 × 1%
    } finally {
      Object.assign(CURRENT_PERIOD, saved);
    }
    expect(getUpsideSummary().total).toBe(358);
  });
});

describe("AI参謀の入力", () => {
  it("試算が <shop_upside> に入り、断定しない旨が添えられている", () => {
    const req = buildAdvisorRequest({ role: "successor", history: [], text: "利益を戻すには？", diagnosis: null });
    expect(req.system).toContain("<shop_upside>");
    expect(req.system).toContain("</shop_upside>");
    expect(req.system).toContain("仮定の試算");
    expect(req.system).toContain("断定せず、前提条件と選択肢として扱");
    for (const t of ["+108万円", "+100万円", "+96万円", "+54万円", "+358万円", "▲236万円", "+122万円"]) {
      expect(req.system).toContain(t);
    }
    // タグの中身は dataBlock と同じく JSON 文字列（< > はエスケープ済み）
    const inner = req.system.split("<shop_upside>\n")[1].split("\n</shop_upside>")[0];
    expect(JSON.parse(inner)).toBe(upsideForPrompt());
  });
});
