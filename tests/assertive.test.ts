// AI の出力の言い切りの確認（SEC-A02・SEC-302。lib/assertive.ts）。Claude は偽物。DB はメモリ。
// - findAssertiveClaims：強い言い方を種類で返す。質問・否定・「専門家に確認」は対象にしない
// - AI参謀・講座の質問・資料：見つかったら固定の注記を足す。返事そのものは変えない。ログは種類だけ（本文は出さない）

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import { ASSERTIVE_CAUTION, cautionFor, findAssertiveClaims } from "@/lib/assertive";
import { getAdvisorStateFrom, sendAdvisorMessage } from "@/lib/advisor";
import { askAboutArticle } from "@/lib/learning-ask";
import { createReport, getReportFrom, DRAFT_NOTICE } from "@/lib/report";
import { runDiagnosis } from "@/lib/diagnosis";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { Role } from "@/lib/role";

let db: Client;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  db = await createTestDb();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

function fakeAi(queue: unknown[]): JsonAi {
  const q = queue.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  return (async (_req: JsonAiRequest) => {
    const next = q.shift();
    if (next === undefined) throw new Error("queue empty");
    return next;
  }) as JsonAi;
}

/** ログに出た文をすべてつなぐ */
const logged = () => warn.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

describe("findAssertiveClaims", () => {
  it("強い言い方を種類で見つける", () => {
    expect(findAssertiveClaims("この方法なら必ず黒字にできます。")).toEqual(["certain_outcome"]);
    expect(findAssertiveClaims("この内容なら融資が通ります。")).toEqual(["loan_outcome"]);
    expect(findAssertiveClaims("融資を受けられます")).toEqual(["loan_outcome"]);
    expect(findAssertiveClaims("確実に売上が上がる方法です")).toContain("certainly");
    expect(findAssertiveClaims("利益が出ることを保証します")).toEqual(["guarantee"]);
    expect(findAssertiveClaims("あなたはお店を継ぐべきです")).toEqual(["succession_verdict"]);
    expect(findAssertiveClaims("今は継がないほうがいいでしょう")).toEqual(["succession_verdict"]);
    expect(findAssertiveClaims("廃業するべきです")).toEqual(["succession_verdict"]);
  });

  it("質問・否定・「専門家に確認」・不確実は対象にしない", () => {
    for (const t of [
      "返済の条件を見直す相談はできますか",
      "融資を受けられますか？",
      "融資が通るかは銀行が判断します",
      "必ず専門家に確認してください",
      "実現を保証するものではありません",
      "先の見通しは不確実です",
      "継ぐかどうかは、お二人で決めることです",
      "手元資金は月商の約1.8か月分です。",
      "",
    ]) {
      expect(findAssertiveClaims(t), t).toEqual([]);
    }
  });

  it("cautionFor：見つかったら固定の注記を返し、ログには種類だけを出す（本文は出さない）", () => {
    expect(cautionFor("test.where", ["普通の文です"])).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(cautionFor("test.where", ["BODY-MARK 必ず成功します", "BODY-MARK 保証します"])).toBe(ASSERTIVE_CAUTION);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0][0]));
    expect(line).toEqual({ level: "warn", where: "test.where", event: "assertive_output", kinds: ["certain_outcome", "guarantee"] });
    expect(logged()).not.toContain("BODY-MARK");
  });
});

describe("AI参謀：注記を足し、返事は変えない", () => {
  const send = (ai: JsonAi, role: Role, text: string) => sendAdvisorMessage({ db, ai }, DEMO_A, role, text);

  it("言い切りがあれば caution が付き、返事の文はそのまま。読み直しても注記は残る", async () => {
    const reply = "REPLY-MARK この内容なら融資が通ります。";
    const st = await send(fakeAi([{ reply, points: ["必ず黒字になります"], consult: "銀行", consult_note: "返済の予定" }]), "successor", "相談です");
    const ai = st.messages[1];
    expect(ai).toMatchObject({ from: "ai", text: reply, points: ["必ず黒字になります"], caution: ASSERTIVE_CAUTION });
    expect(logged()).toContain('"where":"advisor.message"');
    expect(logged()).not.toContain("REPLY-MARK");
    expect(logged()).not.toContain("相談です");
    expect(logged()).not.toContain(DEMO_A);
    const again = await getAdvisorStateFrom(db, DEMO_A, "successor");
    expect(again.messages[1]).toMatchObject({ text: reply, caution: ASSERTIVE_CAUTION });
  });

  it("言い切りが無ければ caution は付かず、ログも出ない", async () => {
    const st = await send(
      fakeAi([{ reply: "手元資金は月商の約1.8か月分です。", points: [], consult: "不要", consult_note: "" }]),
      "predecessor",
      "相談です",
    );
    expect(st.messages[1]).not.toHaveProperty("caution");
    expect(warn).not.toHaveBeenCalled();
  });

  it("保存された JSON の caution が固定文と違えば、画面へ戻さない", async () => {
    await db.execute({
      sql: `INSERT INTO advisor_chats (demo_id, role, messages, rev, updated_at) VALUES (?, 'successor', ?, 1, 'x')`,
      args: [
        DEMO_A,
        JSON.stringify([
          { from: "me", text: "q", at: "t" },
          { from: "ai", text: "a", points: [], consult: "不要", consultNote: "", at: "t", caution: "OTHER-TEXT" },
        ]),
      ],
    });
    const st = await getAdvisorStateFrom(db, DEMO_A, "successor");
    expect(st.messages[1]).not.toHaveProperty("caution");
  });
});

describe("講座の質問：注記を足し、答えは変えない", () => {
  const Q = { courseId: "cashflow", articleNo: 1, question: "減価償却費って何ですか？" };

  it("言い切りがあれば caution が付く。無ければ付かない", async () => {
    const text = "ANSWER-MARK この順番で学べば確実に資金繰りが改善します。";
    const a = await askAboutArticle({ db, ai: fakeAi([{ answer: text, terms: [] }]) }, DEMO_A, "successor", Q);
    expect(a).toEqual({ text, terms: [], caution: ASSERTIVE_CAUTION });
    expect(logged()).toContain('"where":"learning.ask"');
    expect(logged()).not.toContain("ANSWER-MARK");

    const b = await askAboutArticle(
      { db, ai: fakeAi([{ answer: "減価償却費は、設備の代金を分けて費用にしたものです。", terms: [] }]) },
      DEMO_A,
      "successor",
      Q,
    );
    expect(b).not.toHaveProperty("caution");
  });
});

describe("資料：注記を足し、AI の文は変えない", () => {
  async function seedDiagnosis() {
    for (const role of ["predecessor", "successor"] as const) {
      await db.execute({
        sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
              VALUES (?, ?, 'cashflow', '[]', 0, 'confirmed', ?, 1, 0, 'x')`,
        args: [DEMO_A, role, JSON.stringify({ statements: ["発言"], ai_observations: [], unconfirmed: [] })],
      });
    }
    await runDiagnosis(
      {
        db,
        ai: fakeAi([
          {
            common: [{ point: "店を続けたい", evidence: "二人とも話している" }],
            gaps: [{ theme: "資金繰り", point: "返済", senior_said: "s", successor_said: "t", numbers: "", importance: "高" }],
            to_confirm: [],
            talk_questions: ["問い1", "問い2"],
          },
        ]),
      },
      DEMO_A,
      "predecessor",
    );
  }
  const reportOut = (purpose: string) => ({
    results_comment: "売上が減り、営業利益は赤字です",
    financial_comment: "手元資金が減っています",
    strengths: [{ text: "常連が多い", basis: "診断の共通点" }],
    issues: [{ text: "原価率の上昇", basis: "原価率" }],
    outlook_viewpoints: ["続けられるか"],
    consult: { bank: ["返済の条件を見直す相談はできますか"], tax: ["承継の税金について教えてください"], other: [] },
    bank_doc: { purpose, questions: ["質問1", "質問2"] },
  });

  it("言い切りがあれば caution が付き、draftNotice にも出る。AI の文はそのまま", async () => {
    await seedDiagnosis();
    const purpose = "PURPOSE-MARK この計画なら融資が通ります";
    const st = await createReport({ db, ai: fakeAi([reportOut(purpose)]) }, DEMO_A, "successor");
    expect(st.caution).toBe(ASSERTIVE_CAUTION);
    expect(st.draftNotice).toContain(ASSERTIVE_CAUTION);
    expect(st.bankDoc.purpose).toBe(purpose);
    expect(logged()).toContain('"where":"report.create"');
    expect(logged()).not.toContain("PURPOSE-MARK");
    // 読み出し（表示のたび）でも同じ注記が付く
    expect((await getReportFrom(db, DEMO_A))?.caution).toBe(ASSERTIVE_CAUTION);
  });

  it("言い切りが無ければ caution は付かず、draftNotice は固定文のまま", async () => {
    await seedDiagnosis();
    const st = await createReport({ db, ai: fakeAi([reportOut("返済の相談")]) }, DEMO_A, "successor");
    expect(st).not.toHaveProperty("caution");
    expect(st.draftNotice).toBe(DRAFT_NOTICE);
  });
});
