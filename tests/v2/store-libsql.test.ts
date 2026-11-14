// Turso（libSQL）用の保存先のテスト。
// 使うのは、このテストの中だけで動くデータベース（":memory:"）。外部にはつながない。鍵も使わない。
// 架空の会社・利用者だけを使う。本物の Turso での検証の代わりではない。

import { createClient, type Client } from "@libsql/client";
import { describe, expect, it } from "vitest";
import { handle, view, type Env } from "@/lib/v2/access";
import { createAuditLog } from "@/lib/v2/audit";
import { createDirectoryAuth } from "@/lib/v2/auth";
import { StoreConflictError } from "@/lib/v2/store";
import { createLibsqlStore } from "@/lib/v2/store-libsql";
import type { SessionView } from "@/lib/v2/types";
import { createDeps } from "./helpers";

const SECRET = "ZZ-TURSO-HIMITSU-8830";

function setup() {
  // 会社ごとに、別のデータベースを用意する
  const dbs = new Map<string, Client>();
  const opened: string[] = [];
  const dbFor = (tenantId: string) => {
    opened.push(tenantId);
    let db = dbs.get(tenantId);
    if (!db) {
      db = createClient({ url: ":memory:" });
      dbs.set(tenantId, db);
    }
    return db;
  };
  let n = 0;
  const directory = createDirectoryAuth({ newToken: () => `token-${++n}` });
  directory.addUser("a1", "tenant-a");
  directory.addUser("a2", "tenant-a");
  directory.addUser("b1", "tenant-b");
  const env: Env = {
    deps: createDeps({ store: createLibsqlStore(dbFor) }),
    auth: directory.provider,
    audit: createAuditLog(),
  };
  const rows = async (tenantId: string) =>
    (await dbs.get(tenantId)!.execute("SELECT tenant_id, user_id, rev, data FROM v2_interviews ORDER BY user_id")).rows;
  return { env, directory, dbs, dbFor, opened, rows };
}

async function finishInterview(env: Env, token: string, text: string): Promise<SessionView> {
  let session = (await handle(env, token, { action: "start" }))!;
  while (session.phase === "interview") session = (await handle(env, token, { action: "answer", text }))!;
  return session;
}

describe("Turso 用の保存先：面談から資料の下書きまで、同じ動きをする", () => {
  it("面談・内容の確認・準備リスト・資料の下書き・次の一歩・講座が、データベースに保存されて読み戻せる", async () => {
    const { env, directory, dbFor } = setup();
    const a1 = directory.login("a1");
    const done = await finishInterview(env, a1, "架空の答え");
    await handle(env, a1, { action: "confirmReview" });
    await handle(env, a1, { action: "setPrep", prep: { loans: { status: "todo", next: "返済予定表を探す" } } });
    const ids = done.items.filter((i) => i.kind === "statement").map((i) => i.id);
    await handle(env, a1, { action: "setReportSettings", consultant: "bank", selectedIds: ids });
    await handle(env, a1, { action: "generateReport" });
    await handle(env, a1, { action: "setNextSteps", steps: { loans: { decision: "do", who: "自分" } } });
    await handle(env, a1, { action: "saveLearning", courseId: "values", learning: { quiz: "no", notes: { kept: "味" } } });

    // 保存先を作り直しても（サーバーを立ち上げ直した想定）、内容が残っている
    const restarted: Env = { ...env, deps: createDeps({ store: createLibsqlStore(dbFor) }) };
    const again = (await view(restarted, a1))!;
    expect(again.phase).toBe("review");
    expect(again.report!.statements).toHaveLength(ids.length);
    expect(again.prep.loans).toEqual({ status: "todo", next: "返済予定表を探す", basis: "" });
    expect(again.steps.loans).toMatchObject({ decision: "do", who: "自分" });
    expect(again.learning.values.notes.kept).toBe("味");
    // 画面へ返す内容に、版の番号・持ち主・置き場所の ID は含めない
    expect("rev" in again || "owner" in again || "id" in again).toBe(false);
  });

  it("「すべて消す」で、データベースからも行が消える", async () => {
    const { env, directory, rows } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    await handle(env, a1, { action: "answer", text: SECRET });
    expect(JSON.stringify(await rows("tenant-a"))).toContain(SECRET);
    await handle(env, a1, { action: "reset" });
    expect(await rows("tenant-a")).toHaveLength(0);
    expect(await view(env, a1)).toBeNull();
  });

  it("発言を消すと、データベースの中身からも消える", async () => {
    const { env, directory, rows } = setup();
    const a1 = directory.login("a1");
    const done = await finishInterview(env, a1, `${SECRET}の答え`);
    for (const item of done.items.filter((i) => i.kind === "statement")) {
      await handle(env, a1, { action: "removeItem", itemId: item.id });
    }
    expect(JSON.stringify(await rows("tenant-a"))).not.toContain(SECRET);
  });
});

describe("会社ごとに、データベースが分かれている", () => {
  it("A社の内容は A社のデータベースにだけ入り、B社のデータベースには1文字も入らない", async () => {
    const { env, directory, rows, dbs } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    await finishInterview(env, a1, `${SECRET}の答え`);
    await handle(env, b1, { action: "start" });

    expect(JSON.stringify(await rows("tenant-a"))).toContain(SECRET);
    expect(JSON.stringify(await rows("tenant-b"))).not.toContain(SECRET);
    expect((await rows("tenant-a")).map((r) => r.user_id)).toEqual(["a1"]);
    expect((await rows("tenant-b")).map((r) => r.user_id)).toEqual(["b1"]);
    expect([...dbs.keys()].sort()).toEqual(["tenant-a", "tenant-b"]);
  });

  it("どのデータベースを開くかは、権限確認を通った会社からだけ決まる（画面からの指定では開かない）", async () => {
    const { env, directory, opened } = setup();
    const a1 = directory.login("a1");
    const b1 = directory.login("b1");
    await finishInterview(env, a1, SECRET);
    opened.length = 0;
    // B社の人が、A社の面談を指定する
    await expect(handle(env, b1, { action: "generateReport", interviewId: "tenant-a/a1" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(view(env, b1, "tenant-a/a1")).rejects.toMatchObject({ status: 409 });
    await handle(env, b1, { action: "start", tenantId: "tenant-a" });
    // A社のデータベースは、一度も開かれていない
    expect(opened.every((t) => t === "tenant-b")).toBe(true);
  });

  it("同じ会社の別の人の面談は、同じデータベースの中でも読めない・変えられない", async () => {
    const { env, directory, rows } = setup();
    const a1 = directory.login("a1");
    const a2 = directory.login("a2");
    await finishInterview(env, a1, SECRET);
    const before = JSON.stringify(await rows("tenant-a"));
    expect(await view(env, a2)).toBeNull();
    await expect(view(env, a2, "tenant-a/a1")).rejects.toMatchObject({ status: 409 });
    await expect(handle(env, a2, { action: "reset", interviewId: "tenant-a/a1" })).rejects.toMatchObject({ status: 409 });
    expect(JSON.stringify(await handle(env, a2, { action: "start" }))).not.toContain(SECRET);
    // a1 の行は変わっていない。a2 の行が1つ増えただけ
    const after = await rows("tenant-a");
    expect(after.map((r) => r.user_id)).toEqual(["a1", "a2"]);
    expect(JSON.stringify([after[0]])).toBe(before);
  });

  it("会社や本人の ID に、記号・区切りの文字・SQL の一部に見える文字があると、保存先が受け付けない", async () => {
    const { env, directory, dbs, opened } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    await handle(env, a1, { action: "answer", text: SECRET });
    opened.length = 0;
    const cases: [string, string][] = [
      [`x'; DELETE FROM v2_interviews; --`, "tenant-a"],
      ["u", `tenant-a' OR '1'='1`],
      ["u", "tenant-a/../tenant-b"],
      ["u", "tenant-a.example.com"],
      ["u u", "tenant-a"],
      ["u", "テナント"],
      ["u", "t".repeat(129)],
    ];
    for (const [userId, tenantId] of cases) {
      directory.addUser(userId, tenantId);
      await expect(handle(env, directory.login(userId), { action: "start" }), `${userId}|${tenantId}`).rejects.toThrow();
    }
    // どのデータベースも開かれておらず、A社の内容はそのまま
    expect(opened).toEqual([]);
    expect([...dbs.keys()]).toEqual(["tenant-a"]);
    expect(JSON.stringify(await view(env, a1))).toContain(SECRET);
  });

  it("1つのデータベースを複数の会社で使う構成になっても、会社どうしの内容は混ざらない", async () => {
    // どの会社にも同じデータベースを返す、という（望ましくない）つなぎ方を想定する
    const shared = createClient({ url: ":memory:" });
    let n = 0;
    const directory = createDirectoryAuth({ newToken: () => `token-${++n}` });
    directory.addUser("same", "tenant-a");
    directory.addUser("other", "tenant-b");
    const env: Env = {
      deps: createDeps({ store: createLibsqlStore(() => shared) }),
      auth: directory.provider,
      audit: createAuditLog(),
    };
    const a = directory.login("same");
    const b = directory.login("other");
    await handle(env, a, { action: "start" });
    await handle(env, a, { action: "answer", text: SECRET });
    await handle(env, b, { action: "start" });
    expect(JSON.stringify(await view(env, b))).not.toContain(SECRET);
    await expect(view(env, b, "tenant-a/same")).rejects.toMatchObject({ status: 409 });
    await handle(env, b, { action: "reset" });
    // B社の人が消しても、A社の行は残る。同じ接続を二重に数えない
    expect(JSON.stringify(await view(env, a))).toContain(SECRET);
    expect(await env.deps.store.size()).toBe(1);
    // 別の会社に、同じ ID の人がいても、行は別
    directory.addUser("same2", "tenant-b");
    const rows = (await shared.execute("SELECT tenant_id, user_id FROM v2_interviews")).rows;
    expect(rows.map((r) => `${r.tenant_id}/${r.user_id}`)).toEqual(["tenant-a/same"]);
  });
});

describe("同時に変えられたとき・おかしな保存を断る", () => {
  it("読んだあとで、ほかの操作が先に保存していたら、上書きしない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    const key = "tenant-a/a1";
    const stale = (await env.deps.store.get(key))!; // 古い版を手元に持つ
    await handle(env, a1, { action: "answer", text: "先に保存された答え" });
    stale.log.push({ who: "me", theme: "legacy", text: "古い画面からの上書き" });
    await expect(Promise.resolve().then(() => env.deps.store.put(stale))).rejects.toBeInstanceOf(StoreConflictError);
    expect(JSON.stringify(await env.deps.store.get(key))).not.toContain("古い画面からの上書き");
    expect(JSON.stringify(await env.deps.store.get(key))).toContain("先に保存された答え");
  });

  it("操作の途中で先に保存されていたら、「読み込み直してください」と伝え、相手の変更を消さない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    const real = env.deps.store;
    // 2つの操作が、同じ版を読んでから順に保存する、という状況を作る
    let first = true;
    env.deps.store = {
      ...real,
      get: async (id: string) => {
        const session = await real.get(id);
        if (session && first) {
          first = false;
          const other = structuredClone(session);
          other.purpose = "別の画面で先に変えた目的";
          await real.put(other);
        }
        return session;
      },
    };
    await expect(handle(env, a1, { action: "skip" })).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: expect.stringContaining("読み込み直して"),
    });
    env.deps.store = real;
    expect((await view(env, a1))!.purpose).toBe("別の画面で先に変えた目的");
    // 読み込み直せば、続けられる
    expect((await handle(env, a1, { action: "skip" }))!.currentTheme).toBe("future");
  });

  it("同じ人の面談を、同時に2つ作ろうとしても、1つしかできない", async () => {
    const { env } = setup();
    const store = env.deps.store;
    const make = () => ({
      ...structuredClone(EMPTY),
      id: "tenant-a/a1",
      owner: { tenantId: "tenant-a", userId: "a1" },
    });
    await store.put(make());
    await expect(Promise.resolve().then(() => store.put(make()))).rejects.toBeInstanceOf(StoreConflictError);
    expect(await store.size()).toBe(1);
  });

  it("持ち主の記録がない・置き場所と合わない面談は、保存しない", async () => {
    const { env } = setup();
    const store = env.deps.store;
    const attempt = (owner?: { tenantId: string; userId: string }) =>
      Promise.resolve().then(() => store.put({ ...structuredClone(EMPTY), id: "tenant-a/a1", ...(owner ? { owner } : {}) }));
    await expect(attempt()).rejects.toThrow();
    await expect(attempt({ tenantId: "tenant-b", userId: "a1" })).rejects.toThrow();
    await expect(attempt({ tenantId: "tenant-a", userId: "a2" })).rejects.toThrow();
    expect(await store.size()).toBe(0);
  });

  it("形の合わない置き場所の名前は、読むのも書くのも消すのも断る", async () => {
    const { env, opened } = setup();
    const bads = ["", "tenant-a", "a/b/c", "/a1", "tenant-a/", "tenant a/a1", "%E0%A4%A/a1", "tenant%2da/a1", "tenant%2Da/a1", "tenant-a/a1%20"];
    for (const bad of bads) {
      await expect(Promise.resolve().then(() => env.deps.store.get(bad)), bad).rejects.toThrow();
      await expect(Promise.resolve().then(() => env.deps.store.delete(bad)), bad).rejects.toThrow();
      await expect(
        Promise.resolve().then(() =>
          env.deps.store.put({ ...structuredClone(EMPTY), id: bad, owner: { tenantId: "tenant-a", userId: "a1" } }),
        ),
        bad,
      ).rejects.toThrow();
    }
    expect(opened).toEqual([]);
  });

  it("消して作り直した面談に、消す前の古い内容を上書きさせない", async () => {
    const { env, directory } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    const key = "tenant-a/a1";
    // 回答の保存を待っている途中、という想定で、消す前の版を手元に持つ
    const stale = (await env.deps.store.get(key))!;
    stale.log.push({ who: "me", theme: "legacy", text: SECRET });
    // その間に、別の画面で「すべて消す」→ 始め直す（版の番号は、また1から始まる）
    await handle(env, a1, { action: "reset" });
    await handle(env, a1, { action: "start" });
    expect((await env.deps.store.get(key))!.rev).toBe(stale.rev);
    await expect(Promise.resolve().then(() => env.deps.store.put(stale))).rejects.toBeInstanceOf(StoreConflictError);
    expect(JSON.stringify(await env.deps.store.get(key))).not.toContain(SECRET);
  });

  it("消したあとに、古い内容で保存しようとしても、戻らない", async () => {
    const { env, directory, rows } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    const stale = (await env.deps.store.get("tenant-a/a1"))!;
    stale.log.push({ who: "me", theme: "legacy", text: SECRET });
    await handle(env, a1, { action: "reset" });
    await expect(Promise.resolve().then(() => env.deps.store.put(stale))).rejects.toBeInstanceOf(StoreConflictError);
    expect(await rows("tenant-a")).toHaveLength(0);
  });

  it("保存した中身が壊れていたら、決まった返事にして、本人が「すべて消す」で消せる", async () => {
    const { env, directory, dbs, rows } = setup();
    const a1 = directory.login("a1");
    await handle(env, a1, { action: "start" });
    for (const broken of ["{not json", "null", "[]", '{"phase":"review"}', '"text"']) {
      await dbs.get("tenant-a")!.execute({ sql: "UPDATE v2_interviews SET data = ?", args: [broken] });
      await expect(view(env, a1), broken).rejects.toMatchObject({ code: "corrupt", status: 500 });
      await expect(handle(env, a1, { action: "skip" }), broken).rejects.toMatchObject({ code: "corrupt" });
      // 返事に、壊れた中身そのものは出さない
      await view(env, a1).catch((e: Error) => expect(e.message).not.toContain(broken));
    }
    // 壊れていても「ある」と分かり、消せる。消したあとは始め直せる
    const { hasInterview } = await import("@/lib/v2/access");
    expect(await hasInterview(env, a1)).toBe(true);
    expect(await handle(env, a1, { action: "reset" })).toBeNull();
    expect(await rows("tenant-a")).toHaveLength(0);
    expect((await handle(env, a1, { action: "start" }))!.log).toHaveLength(1);
  });
});

// 保存の形だけを確かめるための、空に近い面談
const EMPTY = {
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-14T00:00:00.000Z",
  phase: "interview" as const,
  currentTheme: null,
  themes: {} as never,
  log: [],
  items: [],
  reviewConfirmed: false,
  prep: {} as never,
  options: [],
  steps: {},
  learning: {},
  consultant: null,
  purpose: "",
  report: null,
};
