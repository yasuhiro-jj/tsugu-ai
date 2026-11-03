// 会話履歴（オーナー指示 2026-11-03）：確定したテーマの会話を本人にだけ返す。相手の会話は含めない。
import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { ensureInterviewRows, loadRecords, saveRecord } from "@/lib/interview/store";
import { getInterviewState } from "@/lib/interview/service";
import type { Role } from "@/lib/role";
import type { ThemeKey } from "@/lib/themes";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

const summary = { statements: ["s"], ai_observations: [], unconfirmed: [] };

async function finishTheme(demoId: string, role: Role, key: ThemeKey, marker: string, status: "confirmed" | "discarded" = "confirmed") {
  await ensureInterviewRows(db, demoId, role);
  const rec = (await loadRecords(db, demoId, role)).get(key)!;
  await saveRecord(
    db,
    demoId,
    role,
    {
      ...rec,
      status,
      messages: [
        { from: "ai", text: `質問-${marker}` },
        { from: "me", text: `回答-${marker}` },
      ] as typeof rec.messages,
      summary: status === "confirmed" ? summary : null,
      shared: status === "confirmed" ? false : null,
    },
    rec.rev,
  );
}

describe("会話履歴", () => {
  it("確定したテーマの会話が本人の履歴に入り、相手・別のデモの会話は入らない", async () => {
    await finishTheme(DEMO_A, "predecessor", "policy", "P-POLICY");
    await finishTheme(DEMO_A, "successor", "policy", "S-POLICY");
    await finishTheme(DEMO_B, "predecessor", "suppliers", "OTHER-DEMO");

    const p = await getInterviewState(db, DEMO_A, "predecessor");
    const pText = JSON.stringify(p.history);
    expect(p.history.map((h) => h.key)).toEqual(["policy"]);
    expect(pText).toContain("回答-P-POLICY");
    expect(pText).not.toContain("S-POLICY");
    expect(pText).not.toContain("OTHER-DEMO");

    const s = await getInterviewState(db, DEMO_A, "successor");
    expect(JSON.stringify(s)).not.toContain("P-POLICY");
  });

  it("共有しないテーマも本人の履歴には出る（本人だけが見る）。破棄したテーマは出ない", async () => {
    await finishTheme(DEMO_A, "predecessor", "closing", "CLOSING");
    await finishTheme(DEMO_A, "predecessor", "people", "DISCARDED", "discarded");
    const p = await getInterviewState(db, DEMO_A, "predecessor");
    expect(p.history.map((h) => h.key)).toEqual(["closing"]);
    expect(JSON.stringify(p.history)).not.toContain("DISCARDED");
  });
});
