// AI参謀チャット（lib/advisor.ts）。Claude は偽物。DB はメモリ。
// 会話は本人（デモ用 ID ＋役割）だけのもの、AI 入力に面談の要約・会話・相手の会話が入らないことを確かめる。

import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { ServiceError } from "@/lib/errors";
import {
  getAdvisorStateFrom,
  historyWindow,
  MSG_ADVISOR_TURN_LIMIT,
  resetAdvisor,
  sendAdvisorMessage,
  validateAdvisorText,
} from "@/lib/advisor";
import { ADVISOR_MAX_LENGTH, ADVISOR_MAX_TURNS, ADVISOR_SUGGESTIONS, type AdvisorMessage } from "@/lib/advisor-types";
import { runDiagnosis } from "@/lib/diagnosis";
import { resetDemo } from "@/lib/interview/service";
import { purgeExpiredDemos } from "@/lib/retention";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: string[] };
/** queue が空なら決まった正しい返事を返す。"THROW" なら失敗する */
function fakeAi(queue: unknown[] = []): FakeJsonAi {
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === "THROW") throw new Error("boom");
    return next ?? JSON.stringify(OK_OUT);
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = queue.map((q) => (typeof q === "string" ? q : JSON.stringify(q)));
  return fn;
}

const OK_OUT = {
  reply: "当期（2026年3月期）の決算書では、手元資金は月商の約1.8か月分です。",
  points: ["手元資金 808万円（当期）"],
  consult: "銀行",
  consult_note: "返済の予定を確認する",
};

const allText = (ai: FakeJsonAi) => ai.requests.map((r) => r.system + JSON.stringify(r.messages)).join("\n");
const send = (ai: FakeJsonAi, demoId: string, role: Role, text: unknown) =>
  sendAdvisorMessage({ db, ai }, demoId, role, text);

async function expectStatus(p: Promise<unknown>, status: number, msg?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).status).toBe(status);
  if (msg) expect((err as ServiceError).userMessage).toBe(msg);
}

async function putTheme(demoId: string, role: Role, key: string, marker: string, shared: 0 | 1) {
  const summary = JSON.stringify({ statements: [`要約 ${marker}`], ai_observations: [], unconfirmed: [] });
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, ?, ?, 0, 'confirmed', ?, ?, 0, 'x')`,
    args: [demoId, role, key, JSON.stringify([{ from: "me", text: `会話 ${marker}` }]), summary, shared],
  });
}

const DIAG = {
  common: [{ point: "お店を続けたい", evidence: "二人とも話している" }],
  gaps: [
    {
      theme: "資金繰り",
      point: "DIAG-GAP-返済の見え方",
      senior_said: "返済は心配ない",
      successor_said: "返済額を知らない",
      numbers: "営業赤字236万円",
      importance: "高",
    },
  ],
  to_confirm: [{ item: "返済予定表", how: "銀行", expert: "銀行" }],
  talk_questions: ["問い1", "問い2"],
};

describe("本人だけの会話", () => {
  it("先代の会話は後継者の状態にも AI 入力にも出ない（逆向きも同じ）", async () => {
    const ai = fakeAi();
    const s1 = await send(ai, DEMO_A, "predecessor", "PRED-ADVISOR-SECRET の相談");
    expect(s1.messages).toHaveLength(2);
    expect(s1.messages[1]).toMatchObject({ from: "ai", consult: "銀行", consultNote: "返済の予定を確認する" });
    expect(s1.remainingTurns).toBe(ADVISOR_MAX_TURNS - 1);

    const succ = await getAdvisorStateFrom(db, DEMO_A, "successor");
    expect(succ.messages).toEqual([]);
    expect(succ.remainingTurns).toBe(ADVISOR_MAX_TURNS);

    ai.requests.length = 0;
    const s2 = await send(ai, DEMO_A, "successor", "SUCC-ADVISOR-SECRET の相談");
    expect(JSON.stringify(s2)).not.toContain("PRED-ADVISOR-SECRET");
    expect(allText(ai)).not.toContain("PRED-ADVISOR-SECRET");

    ai.requests.length = 0;
    const s3 = await send(ai, DEMO_A, "predecessor", "二回目");
    expect(JSON.stringify(s3)).not.toContain("SUCC-ADVISOR-SECRET");
    expect(allText(ai)).not.toContain("SUCC-ADVISOR-SECRET");
    expect(allText(ai)).toContain("PRED-ADVISOR-SECRET"); // 本人の履歴は渡る
  });

  it("別のデモ ID からは見えない", async () => {
    const ai = fakeAi();
    await send(ai, DEMO_A, "successor", "DEMO-A-SECRET");
    ai.requests.length = 0;
    expect((await getAdvisorStateFrom(db, DEMO_B, "successor")).messages).toEqual([]);
    await send(ai, DEMO_B, "successor", "B の相談");
    expect(allText(ai)).not.toContain("DEMO-A-SECRET");
  });

  it("面談の要約・会話の目印は AI 入力に入らない（共有済みも含む）。診断とお店の数字は入る", async () => {
    await putTheme(DEMO_A, "predecessor", "cashflow", "PRED-SHARED-MARK", 1);
    await putTheme(DEMO_A, "successor", "cashflow", "SUCC-SHARED-MARK", 1);
    await putTheme(DEMO_A, "predecessor", "policy", "PRED-PRIVATE-MARK", 0);
    await putTheme(DEMO_A, "successor", "people", "SUCC-PRIVATE-MARK", 0);
    await runDiagnosis({ db, ai: fakeAi([DIAG]) }, DEMO_A, "predecessor");
    await db.execute({
      sql: `INSERT INTO learning (demo_id, level, wants, current_plan, previous_plan, rev, updated_at)
            VALUES (?, 'Lv1', '["LEARN-WANTS-MARK"]', '{"reason":"LEARN-REASON-MARK"}', NULL, 0, 'x')`,
      args: [DEMO_A],
    });

    for (const role of ["predecessor", "successor"] as const) {
      const ai = fakeAi();
      await send(ai, DEMO_A, role, "資金繰りについて");
      const text = allText(ai);
      for (const m of ["SHARED-MARK", "PRIVATE-MARK", "要約 ", "会話 ", "LEARN-WANTS-MARK", "LEARN-REASON-MARK"]) {
        expect(text, m).not.toContain(m);
      }
      expect(text).toContain("DIAG-GAP-返済の見え方");
      expect(text).toContain("決算書（架空）2025年3月期・2026年3月期");
      expect(text).toContain(role === "predecessor" ? "Lv2" : "Lv1");
      expect(text).not.toContain("basedOn");
    }
  });

  it("診断が無くても数字だけで相談できる", async () => {
    const ai = fakeAi();
    await send(ai, DEMO_A, "successor", "手元のお金は？");
    expect(ai.requests[0].system).toContain("まだ診断はありません");
    expect(ai.requests[0].system).toContain("808万円");
  });
});

describe("入力の検証と上限", () => {
  it("空・上限超え・制御文字は 400。改行は使える", async () => {
    const ai = fakeAi();
    await expectStatus(send(ai, DEMO_A, "successor", ""), 400);
    await expectStatus(send(ai, DEMO_A, "successor", "   "), 400);
    await expectStatus(send(ai, DEMO_A, "successor", 123), 400);
    await expectStatus(send(ai, DEMO_A, "successor", "あ".repeat(ADVISOR_MAX_LENGTH + 1)), 400);
    await expectStatus(send(ai, DEMO_A, "successor", "a\u0000b"), 400);
    await expectStatus(send(ai, DEMO_A, "successor", "a\u202Eb"), 400);
    expect(ai.requests).toHaveLength(0);
    expect(validateAdvisorText("一行目\r\n二行目")).toBe("一行目\n二行目");
    expect(validateAdvisorText("あ".repeat(ADVISOR_MAX_LENGTH))).toHaveLength(ADVISOR_MAX_LENGTH);
  });

  it(`本人の発言は ${ADVISOR_MAX_TURNS} 回まで。超えたら 400 で決まった文言。相手の役割は別に数える`, async () => {
    const ai = fakeAi();
    let s;
    for (let i = 0; i < ADVISOR_MAX_TURNS; i++) s = await send(ai, DEMO_A, "predecessor", `相談${i}`);
    expect(s!.remainingTurns).toBe(0);
    const before = ai.requests.length;
    await expectStatus(send(ai, DEMO_A, "predecessor", "もう1回"), 400, MSG_ADVISOR_TURN_LIMIT);
    expect(ai.requests.length).toBe(before); // AI は呼ばない
    expect((await send(ai, DEMO_A, "successor", "後継者の1回目")).remainingTurns).toBe(ADVISOR_MAX_TURNS - 1);
  });

  it("AI に渡す履歴は直近の数往復だけ", async () => {
    const ai = fakeAi();
    for (let i = 0; i < 10; i++) await send(ai, DEMO_A, "successor", `OLD-${i}-相談`);
    const last = ai.requests[ai.requests.length - 1];
    expect(last.messages.length).toBeLessThanOrEqual(13);
    expect(last.messages[0].role).toBe("user");
    expect(JSON.stringify(last.messages)).not.toContain("OLD-0-");
    expect(JSON.stringify(last.messages)).toContain("OLD-9-");

    const long: AdvisorMessage[] = Array.from({ length: 6 }, (_, i) => [
      { from: "me" as const, text: "x".repeat(3000), at: `${i}` },
      { from: "ai" as const, text: "y", points: [], consult: "不要" as const, consultNote: "", at: `${i}` },
    ]).flat();
    const win = historyWindow(long);
    expect(win[0].from).toBe("me");
    expect(win.length).toBeLessThan(long.length);
  });
});

describe("AI の失敗", () => {
  it("AI が失敗したら 502 で、本人の発言も保存しない", async () => {
    await expectStatus(send(fakeAi(["THROW"]), DEMO_A, "successor", "SAVE-NG"), 502);
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toEqual([]);
  });

  it("壊れた返事は1回だけ再送。2回とも壊れていたら 502 で保存しない", async () => {
    const ok = fakeAi(["not json", { ...OK_OUT, points: ["1", "2", "3", "4", "5", "6"] }]);
    const s = await send(ok, DEMO_A, "successor", "相談");
    expect(ok.requests).toHaveLength(2);
    const aiMsg = s.messages[1];
    expect(aiMsg.from === "ai" && aiMsg.points.length).toBe(4);

    const bad = fakeAi(["not json", { ...OK_OUT, consult: "弁護士" }]);
    await expectStatus(send(bad, DEMO_A, "predecessor", "相談"), 502);
    expect((await getAdvisorStateFrom(db, DEMO_A, "predecessor")).messages).toEqual([]);
  });

  it("AI の回数上限は 429 で、保存しない", async () => {
    await db.execute({
      sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'successor', 150, 'x')`,
      args: [DEMO_A],
    });
    const ai = fakeAi();
    await expectStatus(send(ai, DEMO_A, "successor", "相談"), 429);
    expect(ai.requests).toHaveLength(0);
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toEqual([]);
  });
});

describe("消す", () => {
  async function rows(demoId: string): Promise<number> {
    const rs = await db.execute({ sql: `SELECT COUNT(*) AS n FROM advisor_chats WHERE demo_id = ?`, args: [demoId] });
    return Number(rs.rows[0].n);
  }

  it("reset は本人の分だけ消す（相手の役割・別のデモ ID は残る）。消すとまた話せる", async () => {
    const ai = fakeAi();
    await send(ai, DEMO_A, "predecessor", "先代");
    await send(ai, DEMO_A, "successor", "後継者");
    await send(ai, DEMO_B, "predecessor", "別のデモ");
    const s = await resetAdvisor(db, DEMO_A, "predecessor");
    expect(s).toEqual({ messages: [], remainingTurns: ADVISOR_MAX_TURNS, maxTurns: ADVISOR_MAX_TURNS, maxLength: ADVISOR_MAX_LENGTH });
    expect((await getAdvisorStateFrom(db, DEMO_A, "predecessor")).messages).toEqual([]);
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toHaveLength(2);
    expect((await getAdvisorStateFrom(db, DEMO_B, "predecessor")).messages).toHaveLength(2);
  });

  it("デモのやり直し（DELETE /api/demo の resetDemo）で、両方の役割の会話が消える", async () => {
    const ai = fakeAi();
    await send(ai, DEMO_A, "predecessor", "先代");
    await send(ai, DEMO_A, "successor", "後継者");
    await send(ai, DEMO_B, "successor", "別のデモ");
    await resetDemo(db, DEMO_A, "successor");
    expect(await rows(DEMO_A)).toBe(0);
    expect(await rows(DEMO_B)).toBe(1);
  });

  it("7日たったデモの会話は消え、最近の会話があるデモは残る", async () => {
    const now = new Date("2026-11-20T00:00:00.000Z");
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    await db.batch(
      [
        { sql: `INSERT INTO advisor_chats (demo_id, role, messages, rev, updated_at) VALUES (?, 'successor', '[]', 1, ?)`, args: [DEMO_A, ago(8)] },
        { sql: `INSERT INTO advisor_chats (demo_id, role, messages, rev, updated_at) VALUES (?, 'successor', '[]', 1, ?)`, args: [DEMO_B, ago(1)] },
        // B は面談が古くても、AI参謀を最近使っているので残す
        {
          sql: `INSERT INTO interviews (demo_id, role, current_theme, created_at, updated_at) VALUES (?, 'successor', NULL, ?, ?)`,
          args: [DEMO_B, ago(30), ago(30)],
        },
      ],
      "write",
    );
    expect((await purgeExpiredDemos(db, { now, retentionDays: 7 })).demos).toBe(1);
    expect(await rows(DEMO_A)).toBe(0);
    expect(await rows(DEMO_B)).toBe(1);
  });
});

describe("質問の例", () => {
  it("3〜4個ある", () => {
    expect(ADVISOR_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(ADVISOR_SUGGESTIONS.length).toBeLessThanOrEqual(4);
  });
});
