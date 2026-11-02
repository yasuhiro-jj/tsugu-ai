// 面談の進行（テーマの移動・深掘り上限・JSON 再送・AI 回数上限）

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { ServiceError } from "@/lib/errors";
import { aiJson, createFakeAi, createTestDb, DEMO_A } from "./helpers";
import {
  decideSummary,
  getInterviewState,
  parseAiOutput,
  resetDemo,
  sendMessage,
  setShared,
  startInterview,
} from "@/lib/interview/service";
import { reserveAiCall } from "@/lib/interview/store";
import { THEMES } from "@/lib/themes";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

const summarize = aiJson({
  reply: "まとめます",
  action: "summarize",
  summary: { statements: ["s"] },
});

describe("面談の進行", () => {
  it("6テーマを確定・破棄して最後に finished になり、共有待ちが出る", async () => {
    for (let i = 0; i < THEMES.length; i++) {
      const ai = createFakeAi([aiJson({ reply: "問い", action: "followup" }), summarize]);
      const s0 = await startInterview({ db, ai }, DEMO_A, "predecessor");
      expect(s0.currentThemeKey).toBe(THEMES[i].key);
      expect(s0.messages).toEqual([{ from: "ai", text: "問い" }]);
      // 2回目の start は何もしない（AI を呼ばない）
      await startInterview({ db, ai }, DEMO_A, "predecessor");
      expect(ai.requests.length).toBe(1);
      const s1 = await sendMessage({ db, ai }, DEMO_A, "predecessor", "回答");
      expect(s1.themes[i].status).toBe("awaiting_confirmation");
      expect(s1.themes[i].summary?.statements).toEqual(["s"]);
      // 確認待ちの間はメッセージを送れない
      await expect(sendMessage({ db, ai }, DEMO_A, "predecessor", "追加")).rejects.toBeInstanceOf(
        ServiceError,
      );
      const decision = i === 1 ? "discard" : "confirm";
      const s2 = await decideSummary(db, DEMO_A, "predecessor", {
        themeKey: THEMES[i].key,
        decision,
      });
      if (decision === "confirm") {
        expect(s2.pendingShareThemeKey).toBe(THEMES[i].key);
        const s3 = await setShared(db, DEMO_A, "predecessor", {
          themeKey: THEMES[i].key,
          shared: true,
        });
        expect(s3.pendingShareThemeKey).toBeNull();
      } else {
        expect(s2.themes[i].status).toBe("discarded");
        expect(s2.themes[i].summary).toBeNull();
      }
    }
    const end = await getInterviewState(db, DEMO_A, "predecessor");
    expect(end.finished).toBe(true);
    expect(end.currentThemeKey).toBeNull();
    // 破棄したテーマは共有できない
    await expect(
      setShared(db, DEMO_A, "predecessor", { themeKey: THEMES[1].key, shared: true }),
    ).rejects.toBeInstanceOf(ServiceError);
    // 終了後のメッセージは 409
    await expect(
      sendMessage({ db, ai: createFakeAi() }, DEMO_A, "predecessor", "まだ話したい"),
    ).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.status === 409);
  });

  it("本人が編集した要約で確定できる", async () => {
    const ai = createFakeAi([aiJson({ reply: "問い", action: "followup" }), summarize]);
    await startInterview({ db, ai }, DEMO_A, "successor");
    await sendMessage({ db, ai }, DEMO_A, "successor", "回答");
    const edited = { statements: ["編集後"], ai_observations: [], unconfirmed: ["確認"] };
    const s = await decideSummary(db, DEMO_A, "successor", {
      themeKey: "policy",
      decision: "confirm",
      summary: edited,
    });
    expect(s.themes[0].summary).toEqual(edited);
    expect(s.themes[0].shared).toBeNull();
    expect(s.currentThemeKey).toBe("suppliers");
  });

  it("深掘りが2回に達したら上限を伝え、さらに followup なら要約を依頼し直す", async () => {
    const ai = createFakeAi([aiJson({ reply: "問い", action: "followup" })]);
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    await sendMessage({ db, ai }, DEMO_A, "predecessor", "1");
    await sendMessage({ db, ai }, DEMO_A, "predecessor", "2");
    // followup_count = 2 → system に上限の補足が入る
    ai.queue.push(aiJson({ reply: "深掘り3", action: "followup" }), summarize);
    const s = await sendMessage({ db, ai }, DEMO_A, "predecessor", "3");
    const last = ai.requests.at(-1)!;
    expect(last.system).toContain("深掘りは上限です");
    expect(last.messages.at(-1)!.content).toContain("action を summarize");
    expect(s.themes[0].status).toBe("awaiting_confirmation");
    expect(s.messages.at(-1)).toEqual({ from: "ai", text: "まとめます" });
  });

  it("next_theme で要約が空なら一度だけ要約を依頼する", async () => {
    const ai = createFakeAi([aiJson({ reply: "問い", action: "followup" })]);
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    ai.queue.push(aiJson({ reply: "次へ", action: "next_theme" }), summarize);
    const s = await sendMessage({ db, ai }, DEMO_A, "predecessor", "話したくない");
    expect(ai.requests.length).toBe(3);
    expect(s.themes[0].status).toBe("awaiting_confirmation");
  });

  it("JSON が壊れていたら一度だけ再送し、だめなら 502 で入力を保存しない", async () => {
    const ai = createFakeAi([aiJson({ reply: "問い", action: "followup" })]);
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    ai.queue.push("これはJSONではない", aiJson({ reply: "ok", action: "followup" }));
    const s = await sendMessage({ db, ai }, DEMO_A, "predecessor", "回答1");
    expect(s.messages.at(-1)!.text).toBe("ok");

    ai.queue.push("{壊れた", '{"reply":"x","action":"unknown"}');
    await expect(
      sendMessage({ db, ai }, DEMO_A, "predecessor", "保存されない入力"),
    ).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.status === 502);
    const after = await getInterviewState(db, DEMO_A, "predecessor");
    expect(JSON.stringify(after)).not.toContain("保存されない入力");
  });

  it("AI の例外は 502 で、SDK のエラー本文を返さない", async () => {
    const failing = async (): Promise<string> => {
      throw new Error("SECRET-SDK-BODY");
    };
    await expect(startInterview({ db, ai: failing }, DEMO_A, "predecessor")).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ServiceError && e.status === 502 && !e.userMessage.includes("SECRET"),
    );
  });

  it("AI 呼び出しの上限を超えたら 429（役割ごとに数える）", async () => {
    await reserveAiCall(db, DEMO_A, "predecessor", 2);
    await reserveAiCall(db, DEMO_A, "predecessor", 2);
    await expect(reserveAiCall(db, DEMO_A, "predecessor", 2)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.status === 429,
    );
    await reserveAiCall(db, DEMO_A, "successor", 2);
  });

  it("デモのやり直しで面談データは消えるが、AI の回数は戻らない", async () => {
    const ai = createFakeAi();
    await startInterview({ db, ai }, DEMO_A, "predecessor");
    const s = await resetDemo(db, DEMO_A, "predecessor");
    expect(s.messages).toEqual([]);
    expect(s.themes.every((t) => t.status === "not_started")).toBe(true);
    const rs = await db.execute({
      sql: "SELECT calls FROM ai_usage WHERE demo_id = ?",
      args: [DEMO_A],
    });
    expect(Number(rs.rows[0].calls)).toBe(1);
  });

  it("parseAiOutput はコードブロック付き JSON を読み、不正な action を弾く", () => {
    const fenced = "```json\n" + aiJson({ reply: "r", action: "summarize" }) + "\n```";
    expect(parseAiOutput(fenced)?.action).toBe("summarize");
    expect(parseAiOutput('{"reply":"","action":"followup"}')).toBeNull();
    expect(parseAiOutput('{"reply":"a","action":"delete_all"}')).toBeNull();
  });
});
