// 非公開回答が漏れないことの確認（CLAUDE.md「必ず守る動作」）。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { aiJson, createFakeAi, createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { getComparisonFrom } from "@/lib/compare";
import {
  buildInterviewRequest,
  decideSummary,
  getInterviewState,
  sendMessage,
  setShared,
  startInterview,
} from "@/lib/interview/service";
import { loadRecords } from "@/lib/interview/store";
import type { Role } from "@/lib/role";
import { THEMES } from "@/lib/themes";

const SENT_PRED = "SENTINEL-PRIVATE-PRED";
const SENT_PRED_CHAT = "SENTINEL-PRED-CHAT";
const SENT_PRED_SHARED = "SHARED-PRED-OK";
const SENT_OTHER_DEMO = "SENTINEL-OTHER-DEMO";

let db: Client;

/** 今のテーマを1つ、面談→要約→確定まで進める（shared が undefined なら共有は未選択のまま） */
async function completeTheme(
  demoId: string,
  role: Role,
  marker: string,
  shared?: boolean,
): Promise<void> {
  const ai = createFakeAi([
    aiJson({ reply: `最初の問いかけ ${marker}`, action: "followup" }),
    aiJson({
      reply: `要約しました ${marker}`,
      action: "summarize",
      summary: {
        statements: [`本人の発言 ${marker}`],
        ai_observations: [`推測 ${marker}`],
        unconfirmed: [`未確認 ${marker}`],
      },
    }),
  ]);
  const deps = { db, ai };
  const s0 = await startInterview(deps, demoId, role);
  const key = s0.currentThemeKey!;
  await sendMessage(deps, demoId, role, `私の回答 ${marker}`);
  await decideSummary(db, demoId, role, { themeKey: key, decision: "confirm" });
  if (shared !== undefined) await setShared(db, demoId, role, { themeKey: key, shared });
}

beforeEach(async () => {
  db = await createTestDb();
});

describe("比較（getComparison）", () => {
  it("(a) 先代の非公開回答が比較結果に含まれず、非共有テーマは null で手がかりも無い", async () => {
    // 経営方針：共有する／取引先：共有しない／業務の勘どころ：確定・未選択／人材：確認待ちのまま
    await completeTheme(DEMO_A, "predecessor", SENT_PRED_SHARED, true);
    await completeTheme(DEMO_A, "predecessor", SENT_PRED, false);
    await completeTheme(DEMO_A, "predecessor", SENT_PRED, undefined);
    const ai = createFakeAi([
      aiJson({ reply: `問い ${SENT_PRED_CHAT}`, action: "followup" }),
      aiJson({ reply: `要約 ${SENT_PRED}`, action: "summarize", summary: { statements: [SENT_PRED] } }),
    ]);
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    await sendMessage({ db, ai }, DEMO_A, "predecessor", `本音 ${SENT_PRED}`);

    const rows = await getComparisonFrom(db, DEMO_A);
    const json = JSON.stringify(rows);
    expect(json).not.toContain("SENTINEL");
    expect(json).toContain(SENT_PRED_SHARED);

    // 6テーマすべての行があり、形は共有の有無にかかわらず同じ（件数などの手がかりが無い）
    expect(rows.map((r) => r.key)).toEqual(THEMES.map((t) => t.key));
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["key", "label", "predecessor", "successor"]);
      expect(r.successor).toBeNull();
    }
    expect(rows[0].predecessor).not.toBeNull();
    for (const r of rows.slice(1)) expect(r.predecessor).toBeNull();

    // 非共有・未選択・確認待ちの行は、データが何も無い場合と完全に同じ表現
    const emptyRows = await getComparisonFrom(db, DEMO_B);
    expect(JSON.stringify(rows.slice(1))).toBe(JSON.stringify(emptyRows.slice(1)));
  });

  it("(b) 共有を true→false に戻すと比較から消える", async () => {
    await completeTheme(DEMO_A, "predecessor", SENT_PRED, true);
    expect(JSON.stringify(await getComparisonFrom(db, DEMO_A))).toContain(SENT_PRED);
    await setShared(db, DEMO_A, "predecessor", { themeKey: "policy", shared: false });
    const rows = await getComparisonFrom(db, DEMO_A);
    expect(JSON.stringify(rows)).not.toContain(SENT_PRED);
    expect(rows[0].predecessor).toBeNull();
    // もう一度共有すれば戻る（何度でも変更可）
    await setShared(db, DEMO_A, "predecessor", { themeKey: "policy", shared: true });
    expect(JSON.stringify(await getComparisonFrom(db, DEMO_A))).toContain(SENT_PRED);
  });

  it("(c) 別の demo_id のデータが混ざらない", async () => {
    await completeTheme(DEMO_B, "predecessor", SENT_OTHER_DEMO, true);
    await completeTheme(DEMO_B, "successor", SENT_OTHER_DEMO, true);
    await completeTheme(DEMO_A, "successor", "MINE", true);

    const rowsA = await getComparisonFrom(db, DEMO_A);
    expect(JSON.stringify(rowsA)).not.toContain(SENT_OTHER_DEMO);
    expect(rowsA[0].successor?.statements[0]).toContain("MINE");
    expect(rowsA[0].predecessor).toBeNull();

    const stateA = await getInterviewState(db, DEMO_A, "predecessor");
    expect(JSON.stringify(stateA)).not.toContain(SENT_OTHER_DEMO);
    expect(stateA.themes.every((t) => t.status === "not_started")).toBe(true);
  });
});

describe("面談の状態と Claude への依頼", () => {
  it("(d) 後継者の依頼（system/messages）に先代の会話・要約が含まれない", async () => {
    // 先代：経営方針を共有あり、取引先を非共有で確定、業務の勘どころは面談途中
    await completeTheme(DEMO_A, "predecessor", SENT_PRED, true);
    await completeTheme(DEMO_A, "predecessor", SENT_PRED, false);
    const pAi = createFakeAi([aiJson({ reply: `問い ${SENT_PRED_CHAT}`, action: "followup" })]);
    await startInterview({ db, ai: pAi }, DEMO_A, "predecessor");

    // 後継者：経営方針を確定済み、取引先を面談中
    await completeTheme(DEMO_A, "successor", "SUCC-OWN", true);
    const sAi = createFakeAi();
    await startInterview({ db, ai: sAi }, DEMO_A, "successor");
    await sendMessage({ db, ai: sAi }, DEMO_A, "successor", "後継者の回答");

    // 実際に AI に送られた依頼
    expect(sAi.requests.length).toBeGreaterThan(0);
    for (const req of sAi.requests) {
      const s = JSON.stringify(req);
      expect(s).not.toContain("SENTINEL");
      expect(s).toContain("森川 拓也");
      expect(s).not.toContain("森川 修");
    }
    // 自分の確定要約は補足として入る
    expect(sAi.requests.at(-1)!.system).toContain("SUCC-OWN");

    // 組み立て関数を直接呼んでも同じ
    const records = await loadRecords(db, DEMO_A, "successor");
    const req = buildInterviewRequest({
      role: "successor",
      records,
      themeKey: "suppliers",
      pendingUserText: "x",
    });
    expect(JSON.stringify(req)).not.toContain("SENTINEL");

    // 後継者の画面用の状態にも先代のデータは無い
    const state = await getInterviewState(db, DEMO_A, "successor");
    expect(JSON.stringify(state)).not.toContain("SENTINEL");
  });

  it("破棄したテーマの会話・要約は Claude にも状態にも残らない", async () => {
    const ai = createFakeAi([
      aiJson({ reply: "問い", action: "followup" }),
      aiJson({ reply: "要約", action: "summarize", summary: { statements: ["SENTINEL-DISCARDED"] } }),
    ]);
    await startInterview({ db, ai }, DEMO_A, "successor");
    await sendMessage({ db, ai }, DEMO_A, "successor", "SENTINEL-DISCARDED-CHAT");
    await decideSummary(db, DEMO_A, "successor", { themeKey: "policy", decision: "discard" });
    const ai2 = createFakeAi();
    await startInterview({ db, ai: ai2 }, DEMO_A, "successor");
    expect(JSON.stringify(ai2.requests)).not.toContain("SENTINEL-DISCARDED");
    const state = await getInterviewState(db, DEMO_A, "successor");
    expect(JSON.stringify(state)).not.toContain("SENTINEL-DISCARDED");
  });
});
