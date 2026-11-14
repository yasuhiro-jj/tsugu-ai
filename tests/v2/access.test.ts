// 段階3の土台：権限確認のテスト（Notion「03」の SEC-01・02・04 に対応）。
// 架空の会社・利用者だけを使う。認証は検証用の名簿（createDirectoryAuth）で、外部サービスにはつながない。
// これは「権限確認の仕組み」の検証で、本物の認証サービスや DB での検証の代わりではない。

import { describe, expect, it } from "vitest";
import { handle, interviewKey, view, type Env } from "@/lib/v2/access";
import { createAuditLog } from "@/lib/v2/audit";
import { createDirectoryAuth, createLocalAuth } from "@/lib/v2/auth";
import { ACTIONS } from "@/lib/v2/dispatch";
import { createLimiter } from "@/lib/v2/rate-limit";
import { V2Error, type SessionView } from "@/lib/v2/types";
import { createDeps } from "./helpers";

const SECRET = "ZZ-ACCESS-HIMITSU-4410";

function setup() {
  let now = 1_000_000;
  let n = 0;
  const directory = createDirectoryAuth({ newToken: () => `token-${++n}`, nowMs: () => now, ttlMs: 60_000 });
  // 架空の会社A（本人2人と運営担当者1人）と、架空の会社B（本人1人）
  directory.addUser("a1", "tenant-a");
  directory.addUser("a2", "tenant-a");
  directory.addUser("a-ops", "tenant-a", "operator");
  directory.addUser("b1", "tenant-b");
  const env: Env = { deps: createDeps(), auth: directory.provider, audit: createAuditLog() };
  return { env, directory, advance: (ms: number) => (now += ms) };
}

/** a1 が面談を終え、資料の下書きまで作った状態にする（目印つき） */
async function prepareA1(env: Env, token: string): Promise<SessionView> {
  let session = (await handle(env, token, { action: "start" }))!;
  while (session.phase === "interview") {
    session = (await handle(env, token, { action: "answer", text: `${SECRET}の答え` }))!;
  }
  await handle(env, token, { action: "confirmReview" });
  await handle(env, token, {
    action: "setReportSettings",
    consultant: "bank",
    selectedIds: session.items.filter((i) => i.kind === "statement").map((i) => i.id),
  });
  return (await handle(env, token, { action: "generateReport" }))!;
}

/** 断られ方が「存在しない」ときと同じで、本文を含まないこと */
async function expectHidden(promise: Promise<unknown> | (() => unknown)) {
  let error: unknown;
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(V2Error);
  const e = error as V2Error;
  expect(e.status).toBe(409);
  expect(e.message).toBe("面談がまだ始まっていません。最初の画面から始めてください。");
  expect(JSON.stringify({ m: e.message, c: e.code })).not.toContain(SECRET);
}

describe("SEC-01 別の会社の面談・資料を指定しても、読めない・変えられない・消せない・出力できない", () => {
  it("B社の人が A社の面談を指定すると、すべての操作が「存在しない」と同じ返事で断られる", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    const done = await prepareA1(env, a1);
    const aKey = interviewKey((await env.auth.resolve(a1))!);
    const item = done.items[0];
    const before = JSON.stringify((await env.deps.store.get(aKey)));
    expect(before).toContain(SECRET);

    // 読み取り
    await expectHidden(() => view(env, b1, aKey));
    // 更新・削除・出力を含む、すべての操作
    for (const action of ACTIONS) {
      await expectHidden(
        handle(env, b1, {
          action,
          interviewId: aKey,
          itemId: item.id,
          text: "書き換え",
          options: ["closure"],
          consultant: "bank",
          selectedIds: [item.id],
          prep: { loans: { status: "confirmed" } },
          steps: { loans: { decision: "do" } },
        }),
      );
    }
    // A社の内容は何も変わっていない
    expect(JSON.stringify((await env.deps.store.get(aKey)))).toBe(before);
    // B社の人には、面談が1つも作られていない
    expect(await view(env, b1)).toBeNull();
  });

  it("面談を指定しなくても、A社の項目 ID を使った操作は B社の人にはできない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    const done = await prepareA1(env, a1);
    const itemId = done.items[0].id;

    let b = (await handle(env, b1, { action: "start" }))!;
    while (b.phase === "interview") b = (await handle(env, b1, { action: "skip" }))!;
    await expect(handle(env, b1, { action: "editItem", itemId, text: "書き換え" })).rejects.toMatchObject({ status: 404 });
    await expect(handle(env, b1, { action: "removeItem", itemId })).rejects.toMatchObject({ status: 404 });
    await expect(
      handle(env, b1, { action: "setReportSettings", consultant: "bank", selectedIds: [itemId] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(await view(env, b1))).not.toContain(SECRET);
    expect(JSON.stringify(await view(env, a1))).toContain(SECRET);
  });

  it("存在する面談を指定したときと、存在しない面談を指定したときで、返事が同じ", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    await prepareA1(env, a1);
    const real = interviewKey((await env.auth.resolve(a1))!);
    const errors: V2Error[] = [];
    for (const id of [real, "tenant-zzz/nobody", "", 123, null, { a: 1 }]) {
      try {
        await handle(env, b1, { action: "generateReport", interviewId: id });
      } catch (e) {
        errors.push(e as V2Error);
      }
    }
    expect(errors).toHaveLength(6);
    expect(new Set(errors.map((e) => `${e.status}|${e.message}`)).size).toBe(1);
  });

  it("画面から会社や役割を送ってきても、信用しない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    await prepareA1(env, a1);
    const session = await handle(env, b1, {
      action: "start",
      tenantId: "tenant-a",
      userId: "a1",
      role: "owner",
      owner: { tenantId: "tenant-a", userId: "a1" },
    });
    expect(JSON.stringify(session)).not.toContain(SECRET);
    expect((await env.deps.store.get("tenant-b/b1"))!.owner).toEqual({ tenantId: "tenant-b", userId: "b1" });
  });
});

describe("SEC-02 同じ会社の別の人の面談は、内容も存在も見えない", () => {
  it("同じ会社の別の本人からは、読めない・変えられない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const a2 = directory.login("a2");
    await prepareA1(env, a1);
    const aKey = interviewKey((await env.auth.resolve(a1))!);
    const before = JSON.stringify((await env.deps.store.get(aKey)));

    expect(await view(env, a2)).toBeNull();
    await expectHidden(() => view(env, a2, aKey));
    await expectHidden(handle(env, a2, { action: "reset", interviewId: aKey }));
    await expectHidden(handle(env, a2, { action: "generateReport", interviewId: aKey }));
    // a2 が自分の面談を始めても、a1 の内容は混ざらない
    const own = await handle(env, a2, { action: "start" });
    expect(JSON.stringify(own)).not.toContain(SECRET);
    expect(JSON.stringify((await env.deps.store.get(aKey)))).toBe(before);
  });

  it("運営担当者は、面談や資料の中身を見られない・操作できない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const ops = directory.login("a-ops");
    await prepareA1(env, a1);
    const aKey = interviewKey((await env.auth.resolve(a1))!);
    for (const attempt of [() => view(env, ops), () => view(env, ops, aKey)]) {
      await expect(attempt()).rejects.toMatchObject({ status: 403, message: "この操作はできません。" });
    }
    for (const action of ACTIONS) {
      await expect(handle(env, ops, { action, interviewId: aKey })).rejects.toMatchObject({ status: 403 });
      await expect(handle(env, ops, { action })).rejects.toMatchObject({ status: 403 });
    }
    expect((await env.deps.store.get("tenant-a/a-ops"))).toBeNull();
  });

  it("保存してある持ち主と合わない面談は、置き場所の名前が合っていても渡さない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await prepareA1(env, a1);
    // 保存先の持ち主の記録だけが、別の人になっている（保存先の取り違えを想定）
    const raw = (await env.deps.store.get("tenant-a/a1"))!;
    raw.owner = { tenantId: "tenant-b", userId: "b1" };
    await env.deps.store.put(raw);
    await expectHidden(() => view(env, a1));
    await expectHidden(handle(env, a1, { action: "generateReport" }));
    // 持ち主の記録がない（古い形の）面談も、渡さない
    delete raw.owner;
    await env.deps.store.put(raw);
    await expectHidden(() => view(env, a1));
  });

  it("画面へ返す内容に、会社・本人・置き場所の ID を含めない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const done = await prepareA1(env, a1);
    const text = JSON.stringify(done);
    expect(text).not.toContain("tenant-a");
    expect(text).not.toContain(a1);
    expect("owner" in done).toBe(false);
    expect("id" in done).toBe(false);
  });
});

describe("SEC-04 ログアウト・期限切れ・所属を外した後・役割を変えた直後は、古い合言葉で操作できない", () => {
  it("ログアウト後は読めない・操作できない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await prepareA1(env, a1);
    directory.logout(a1);
    await expect(view(env, a1)).rejects.toMatchObject({ status: 401 });
    await expect(handle(env, a1, { action: "generateReport" })).rejects.toMatchObject({ status: 401 });
    // もう一度ログインすれば、本人の面談に戻れる
    expect(JSON.stringify(await view(env, directory.login("a1")))).toContain(SECRET);
  });

  it("期限が切れた合言葉は使えない", async () => {
    const { env, directory, advance } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    advance(60_001);
    await expect(handle(env, a1, { action: "skip" })).rejects.toMatchObject({ status: 401 });
  });

  it("所属を外した直後から、すでに持っている合言葉でも操作できない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await prepareA1(env, a1);
    directory.removeMember("a1");
    await expect(view(env, a1)).rejects.toMatchObject({ status: 401 });
    await expect(handle(env, a1, { action: "reset" })).rejects.toMatchObject({ status: 401 });
    expect((await env.deps.store.get("tenant-a/a1"))).not.toBeNull();
  });

  it("役割を変えた直後から、新しい役割で判断する（古い権限を使い回さない）", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    directory.setRole("a1", "operator");
    await expect(handle(env, a1, { action: "skip" })).rejects.toMatchObject({ status: 403 });
    directory.setRole("a1", "owner");
    expect((await handle(env, a1, { action: "skip" }))!.phase).toBe("interview");
  });

  it("合言葉なし・でたらめな合言葉は、何もできない", async () => {
    const { env } = setup();
    for (const token of [null, "", "nonsense", "token-999"]) {
      await expect(view(env, token)).rejects.toMatchObject({ status: 401 });
      await expect(handle(env, token, { action: "start" })).rejects.toMatchObject({ status: 401 });
    }
    expect((await env.deps.store.size())).toBe(0);
  });
});

describe("置き場所の取り違え・古い合言葉・保存先がいっぱいのとき", () => {
  it("ID に区切りの文字が含まれていても、別の会社・別の人と置き場所が重ならない", async () => {
    const { env, directory } = setup();
    // 「a/b」という会社の「c」さんと、「a」という会社の「b/c」さん
    directory.addUser("c", "a/b");
    directory.addUser("b/c", "a");
    const first = directory.login("c");
    const second = directory.login("b/c");
    expect(interviewKey((await env.auth.resolve(first))!)).not.toBe(interviewKey((await env.auth.resolve(second))!));
    await handle(env, first, { action: "start" });
    await handle(env, first, { action: "answer", text: SECRET });
    // 後から来た人も、自分の面談を始められる。先の人の内容は見えない
    const own = await handle(env, second, { action: "start" });
    expect(own!.log).toHaveLength(1);
    expect(JSON.stringify(await view(env, second))).not.toContain(SECRET);
    expect(JSON.stringify(await view(env, first))).toContain(SECRET);
  });

  it("別の会社に、同じ ID の人がいても、互いの面談は見えない", async () => {
    const { env, directory } = setup();
    directory.addUser("same", "tenant-x");
    const x = directory.login("same");
    await handle(env, x, { action: "start" });
    await handle(env, x, { action: "answer", text: SECRET });
    // 同じ ID を、別の会社に登録し直す（前の合言葉は使えなくなる）
    directory.addUser("same", "tenant-y");
    await expect(view(env, x)).rejects.toMatchObject({ status: 401 });
    const y = directory.login("same");
    expect(await view(env, y)).toBeNull();
    await expectHidden(() => view(env, y, "tenant-x/same"));
    expect(JSON.stringify(await handle(env, y, { action: "start" }))).not.toContain(SECRET);
  });

  it("所属を外したあとで戻しても、古い合言葉は使えない", async () => {
    const { env, directory } = setup();
    const old = directory.login("a1");
    await handle(env, old, { action: "start" });
    directory.removeMember("a1");
    directory.addUser("a1", "tenant-a");
    await expect(view(env, old)).rejects.toMatchObject({ status: 401 });
    await expect(handle(env, old, { action: "skip" })).rejects.toMatchObject({ status: 401 });
    // ログインし直せば、本人の面談に戻れる
    expect((await view(env, directory.login("a1")))!.log).toHaveLength(1);
  });

  it("操作の途中で保存先の持ち主が変わっていたら、処理の中でも断る（確認と実行のすき間をふさぐ）", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await prepareA1(env, a1);
    const key = "tenant-a/a1";
    // 本人の確認が終わったあと、処理が保存先を読むまでの間に、持ち主の記録が別の人に変わった、という状況を作る
    const realGet = env.deps.store.get.bind(env.deps.store);
    env.deps.store.get = async (id: string) => {
      const session = await realGet(id);
      if (session && id === key) session.owner = { tenantId: "tenant-b", userId: "b1" };
      return session;
    };
    await expectHidden(handle(env, a1, { action: "generateReport" }));
    await expectHidden(handle(env, a1, { action: "start" }));
    await expectHidden(() => view(env, a1));
  });

  it("本人の確認そのものが失敗したら、本人ではないものとして断る。確認は要求ごとに1回だけ", async () => {
    const { env } = setup();
    let calls = 0;
    env.auth = {
      resolve: async () => {
        calls++;
        throw new Error("auth service down");
      },
    };
    await expect(handle(env, "anything", { action: "start" })).rejects.toMatchObject({ status: 401 });
    expect(calls).toBe(1);
    expect(env.audit.list().at(-1)).toMatchObject({ outcome: "denied", code: "unauthenticated", userId: null });
  });

  it("保存先がいっぱいのときは、すでにある面談を消さずに、新しい面談を断る", async () => {
    const { createMemoryStore } = await import("@/lib/v2/store");
    const { env, directory } = setup();
    env.deps.store = createMemoryStore({ maxSessions: 2 });
    const a1 = directory.login("a1");
    const a2 = directory.login("a2");
    const b1 = directory.login("b1");
    await handle(env, a1, { action: "start" });
    await handle(env, a1, { action: "answer", text: SECRET });
    await handle(env, a2, { action: "start" });
    await expect(handle(env, b1, { action: "start" })).rejects.toMatchObject({ status: 503, code: "busy" });
    // 先に始めた人の面談は残っていて、続けられる
    expect(JSON.stringify(await view(env, a1))).toContain(SECRET);
    expect((await handle(env, a1, { action: "skip" }))!.currentTheme).toBe("future");
    expect((await env.deps.store.size())).toBe(2);
  });
});

describe("操作の記録（監査ログ）は、本文を残さない", () => {
  it("誰が・どの操作を・成功したかだけを残し、回答や資料の文章は残さない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    await prepareA1(env, a1);
    await handle(env, a1, { action: "setPrep", prep: { loans: { status: "todo", next: `${SECRET}を探す` } } });
    await handle(env, a1, { action: "setNextSteps", steps: { loans: { decision: "do", who: SECRET } } });
    await handle(env, b1, { action: "generateReport", interviewId: "tenant-a/a1" }).catch(() => undefined);
    await handle(env, a1, { action: "editItem", itemId: "none", text: SECRET }).catch(() => undefined);
    await handle(env, a1, { action: SECRET }).catch(() => undefined);
    await handle(env, null, { action: "start" }).catch(() => undefined);

    const entries = env.audit.list();
    const text = JSON.stringify(entries);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(a1);
    for (const entry of entries) {
      expect(Object.keys(entry).sort().join(",")).toMatch(/^action,at,(code,)?outcome,tenantId,userId$/);
    }
    // 断った操作は「断った」と分かる形で残る
    expect(entries).toContainEqual(
      expect.objectContaining({ userId: "b1", tenantId: "tenant-b", action: "generateReport", outcome: "denied", code: "not_yours" }),
    );
    expect(entries).toContainEqual(expect.objectContaining({ userId: "a1", action: "editItem", outcome: "rejected", code: "no_item" }));
    expect(entries).toContainEqual(expect.objectContaining({ userId: "a1", action: "unknown", outcome: "rejected" }));
    expect(entries).toContainEqual(expect.objectContaining({ userId: null, tenantId: null, action: "start", outcome: "denied" }));
    expect(entries.filter((e) => e.outcome === "ok").length).toBeGreaterThan(5);
  });

  it("成功した操作をいくら重ねても、「断った」記録は押し出されない", () => {
    const audit = createAuditLog(3);
    audit.record({ at: "d0", tenantId: null, userId: null, action: "view", outcome: "denied", code: "not_yours" });
    for (let i = 0; i < 50; i++) audit.record({ at: `t${i}`, tenantId: null, userId: null, action: "view", outcome: "ok" });
    const list = audit.list();
    expect(list[0]).toMatchObject({ at: "d0", outcome: "denied" });
    expect(list).toHaveLength(4);
  });

  it("記録は上限を超えたら古いものから消える。受け取った一覧を書き換えても、記録は変わらない", () => {
    const audit = createAuditLog(3);
    for (let i = 0; i < 5; i++) audit.record({ at: `t${i}`, tenantId: null, userId: null, action: "view", outcome: "ok" });
    expect(audit.list().map((e) => e.at)).toEqual(["t2", "t3", "t4"]);
    audit.list()[0].action = "reset";
    expect(audit.list()[0].action).toBe("view");
  });
});

describe("手元の試作用の認証（ログインなし）", () => {
  it("クッキーの値そのものは、保存先の名前にも持ち主の記録にも残さない", async () => {
    const token = "C".repeat(43);
    const env: Env = { deps: createDeps(), auth: createLocalAuth(), audit: createAuditLog() };
    await handle(env, token, { action: "start" });
    const actor = (await env.auth.resolve(token))!;
    const stored = JSON.stringify((await env.deps.store.get(interviewKey(actor))));
    expect(stored).not.toContain(token);
    expect(JSON.stringify(env.audit.list())).not.toContain(token);
    expect(actor.role).toBe("owner");
    // 別のクッキーは、別の会社・別の本人として扱われる
    const other = (await env.auth.resolve("D".repeat(43)))!;
    expect(other.tenantId).not.toBe(actor.tenantId);
    expect(await view(env, "D".repeat(43))).toBeNull();
    expect(await env.auth.resolve(null)).toBeNull();
    expect(await env.auth.resolve("")).toBeNull();
  });
});

describe("回数の上限", () => {
  it("決めた時間のなかで上限を超えたら断り、時間がたてばまた受け付ける", () => {
    let now = 0;
    const limiter = createLimiter({ max: 3, windowMs: 1000, nowMs: () => now });
    expect([limiter.allow(), limiter.allow(), limiter.allow(), limiter.allow()]).toEqual([true, true, true, false]);
    now = 999;
    expect(limiter.allow()).toBe(false);
    now = 1001;
    expect(limiter.allow()).toBe(true);
  });
});
