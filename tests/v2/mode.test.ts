// 2.0 の動かし方（手元／検証用／止める）の決め方と、検証用の入口のテスト。
// Clerk にも本物の Turso にもつながない。ログインは、テストの中の偽物に差し替える。
// 保存先は、テストの中だけで動くデータベース（":memory:"）。鍵は、形だけの架空の文字列。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clerkConfigured, getMode, v2Database } from "@/lib/v2/mode";

// ログインしている人（Clerk の代わり）。null なら、ログインしていない
let signedIn: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: signedIn }),
  clerkMiddleware: () => () => undefined,
}));

const jar = new Map<string, string>();
const setCalls: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
      setCalls.push(name);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const KEYS = { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_dummy", CLERK_SECRET_KEY: "sk_test_dummy" };
const DB = { V2_TURSO_DATABASE_URL: "libsql://v2-verify.example.invalid", V2_APP_ORIGIN: "https://v2-verify.example.invalid" };

describe("動かし方の決め方", () => {
  it("指定がなく、開発用に動かしているときだけ「手元」", () => {
    expect(getMode({ NODE_ENV: "development" })).toBe("local");
    expect(getMode({ NODE_ENV: "test" })).toBe("local");
    expect(getMode({})).toBe("local");
  });

  it("公開用に組み立てたもの・公開先では、指定がなければ「止める」", () => {
    expect(getMode({ NODE_ENV: "production" })).toBe("off");
    expect(getMode({ NODE_ENV: "development", VERCEL: "1" })).toBe("off");
    // 鍵や接続先がそろっていても、検証用にすると指定していなければ止める
    expect(getMode({ NODE_ENV: "production", VERCEL: "1", ...KEYS, ...DB })).toBe("off");
  });

  it("検証用は、指定・ログインの鍵2つ・2.0 専用の保存先が、すべてそろったときだけ", () => {
    expect(getMode({ V2_MODE: "verify", ...KEYS, ...DB })).toBe("verify");
    expect(getMode({ V2_MODE: "verify", ...KEYS, ...DB, NODE_ENV: "production", VERCEL: "1" })).toBe("verify");
  });

  it("検証用と指定されているのに設定が足りないときは、手元に落とさず「止める」", () => {
    const cases: Record<string, string | undefined>[] = [
      { V2_MODE: "verify" },
      { V2_MODE: "verify", ...KEYS },
      { V2_MODE: "verify", ...DB },
      { V2_MODE: "verify", ...DB, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_dummy" },
      { V2_MODE: "verify", ...DB, CLERK_SECRET_KEY: "sk_test_dummy" },
      { V2_MODE: "verify", ...KEYS, V2_TURSO_DATABASE_URL: "   " },
      { V2_MODE: "verify", ...DB, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "", CLERK_SECRET_KEY: "" },
    ];
    for (const env of cases) {
      // 開発用に動かしていても、ログインなしの手元には落とさない
      expect(getMode({ ...env, NODE_ENV: "development" }), JSON.stringify(env)).toBe("off");
    }
  });

  it("知らない指定は「止める」", () => {
    for (const value of ["on", "true", "local", "VERIFY", "production", "verify "]) {
      expect(getMode({ V2_MODE: value, ...KEYS, ...DB, NODE_ENV: "development" }), value).toBe("off");
    }
  });

  it("ハッカソン版のデータベースと同じ接続先が指定されていたら、使わず「止める」", () => {
    const same = "libsql://hackathon.example.invalid";
    expect(v2Database({ V2_TURSO_DATABASE_URL: same, TURSO_DATABASE_URL: same })).toBeNull();
    expect(v2Database({ V2_TURSO_DATABASE_URL: ` ${same} `, TURSO_DATABASE_URL: same })).toBeNull();
    expect(getMode({ V2_MODE: "verify", ...KEYS, V2_TURSO_DATABASE_URL: same, TURSO_DATABASE_URL: same })).toBe("off");
    // 別の接続先なら使う。ハッカソン版の鍵は、2.0 の鍵として使わない
    expect(
      v2Database({ V2_TURSO_DATABASE_URL: "libsql://v2.example.invalid", TURSO_DATABASE_URL: same, TURSO_AUTH_TOKEN: "hackathon-token" }),
    ).toEqual({ url: "libsql://v2.example.invalid", authToken: undefined });
    expect(v2Database({ V2_TURSO_DATABASE_URL: "libsql://v2.example.invalid", V2_TURSO_AUTH_TOKEN: "v2-token" })).toEqual({
      url: "libsql://v2.example.invalid",
      authToken: "v2-token",
    });
  });

  it("鍵がそろっているかの確認は、値を返さない", () => {
    expect(clerkConfigured(KEYS)).toBe(true);
    expect(clerkConfigured({ CLERK_SECRET_KEY: "sk_test_dummy" })).toBe(false);
    expect(typeof clerkConfigured(KEYS)).toBe("boolean");
  });
});

describe("検証用の入口（Clerk でログインした人だけが使える）", () => {
  const ORIGIN = "http://localhost:3999";
  const URL = `${ORIGIN}/api/v2/session`;
  const SECRET = "ZZ-VERIFY-HIMITSU-9912";

  const post = (body: unknown) =>
    new NextRequest(URL, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, host: "localhost:3999" },
      body: JSON.stringify(body),
    });
  const load = () => import("@/app/api/v2/session/route");

  beforeEach(() => {
    signedIn = null;
    jar.clear();
    setCalls.length = 0;
    const g = globalThis as Record<string, unknown>;
    for (const key of Object.keys(g)) if (key.startsWith("__tsuguV2")) delete g[key];
    vi.stubEnv("V2_MODE", "verify");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", KEYS.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
    vi.stubEnv("CLERK_SECRET_KEY", KEYS.CLERK_SECRET_KEY);
    vi.stubEnv("V2_TURSO_DATABASE_URL", ":memory:");
    vi.stubEnv("V2_APP_ORIGIN", "http://localhost:3999");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("ログインしていない人は、読めない・始められない（401）。回数の上限も、保存先も使わせない", async () => {
    const { GET, POST } = await load();
    // 保存先につなぎにいったら分かるようにしておく
    const g = globalThis as { __tsuguV2Verify?: unknown };
    expect((await GET()).status).toBe(401);
    for (let i = 0; i < 40; i++) {
      const res = await POST(post({ action: "start" }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toContain("ログインが必要です");
    }
    // 保存先には、一度もつなぎにいっていない
    expect(g.__tsuguV2Verify).toBeUndefined();
    // ログインした人は、ふつうに始められる（回数の上限は消費されていない）
    signedIn = "user_owner1";
    expect((await POST(post({ action: "start" }))).status).toBe(200);
    expect(g.__tsuguV2Verify).toBeDefined();
  });

  it("新しく始める回数の上限は、利用者ごと。1人が使い切っても、ほかの人は始められる", async () => {
    const { POST } = await load();
    signedIn = "user_owner1";
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await POST(post({ action: "start" }))).status);
      await POST(post({ action: "reset" }));
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    signedIn = "user_owner2";
    expect((await POST(post({ action: "start" }))).status).toBe(200);
  });

  it("本人の確認そのものが失敗したら（認証サービスの不調など）、500 ではなく 401 で断る", async () => {
    const { GET, POST } = await load();
    const server = await import("@clerk/nextjs/server");
    const spy = vi.spyOn(server, "auth").mockRejectedValue(new Error("clerk is down"));
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ action: "start" }))).status).toBe(401);
    spy.mockRestore();
  });

  it("本人の確認は、要求ごとに1回だけ", async () => {
    const { POST } = await load();
    signedIn = "user_owner1";
    const server = await import("@clerk/nextjs/server");
    const spy = vi.spyOn(server, "auth");
    await POST(post({ action: "start" }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await POST(post({ action: "answer", text: "架空の答え" }));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("ログインした人は、面談を始めて続けられる。クッキーの ID は発行しない", async () => {
    signedIn = "user_owner1";
    const { GET, POST } = await load();
    expect((await (await GET()).json()).session).toBeNull();
    expect((await POST(post({ action: "start" }))).status).toBe(200);
    const answered = await (await POST(post({ action: "answer", text: `${SECRET}の答え` }))).json();
    expect(answered.session.themes.legacy.answers).toEqual([`${SECRET}の答え`]);
    expect(setCalls).toEqual([]);
    // 画面へ返す内容に、本人の ID は含めない
    expect(JSON.stringify(answered)).not.toContain("user_owner1");
  });

  it("別の人でログインすると、前の人の面談は内容も存在も見えない", async () => {
    signedIn = "user_owner1";
    const { GET, POST } = await load();
    await POST(post({ action: "start" }));
    await POST(post({ action: "answer", text: SECRET }));

    signedIn = "user_owner2";
    expect((await (await GET()).json()).session).toBeNull();
    // 面談を指定しても、ほかの人のものは「ない」と同じ返事
    const res = await POST(post({ action: "generateReport", interviewId: "user_owner1/user_owner1" }));
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
    const own = await (await POST(post({ action: "start" }))).json();
    expect(JSON.stringify(own)).not.toContain(SECRET);

    // 元の人に戻ると、自分の面談がそのまま残っている
    signedIn = "user_owner1";
    expect(JSON.stringify(await (await GET()).json())).toContain(SECRET);
  });

  it("画面から本人の ID や会社を送ってきても、信用しない", async () => {
    signedIn = "user_owner1";
    const { POST, GET } = await load();
    await POST(post({ action: "start" }));
    await POST(post({ action: "answer", text: SECRET }));
    signedIn = "user_owner2";
    const res = await POST(post({ action: "start", userId: "user_owner1", tenantId: "user_owner1", owner: { userId: "user_owner1" } }));
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
    expect(JSON.stringify(await (await GET()).json())).not.toContain(SECRET);
  });

  it("ログアウトすると、すぐに読めなくなる。「すべて消す」で、保存先からも消える", async () => {
    signedIn = "user_owner1";
    const { GET, POST } = await load();
    await POST(post({ action: "start" }));
    signedIn = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ action: "skip" }))).status).toBe(401);
    signedIn = "user_owner1";
    expect((await POST(post({ action: "reset" }))).status).toBe(200);
    expect((await (await GET()).json()).session).toBeNull();
  });

  it("保存先が受け付けない形の ID の人は、ログインしていないものとして扱う", async () => {
    const { GET } = await load();
    for (const odd of ["user 1", "user/1", "user'1", "ユーザー", "u".repeat(129)]) {
      signedIn = odd;
      expect((await GET()).status, odd).toBe(401);
    }
  });

  it("入れ物がまだない人の、始める以外の操作は断る（409）", async () => {
    signedIn = "user_owner1";
    const { POST } = await load();
    expect((await POST(post({ action: "skip" }))).status).toBe(409);
    expect((await POST(post({ action: "generateReport" }))).status).toBe(409);
  });

  it("操作の記録とログに、本文も、ログインの鍵も出さない", async () => {
    const calls: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
    signedIn = "user_owner1";
    const { POST } = await load();
    await POST(post({ action: "start" }));
    await POST(post({ action: "answer", text: SECRET }));
    await POST(post({ action: "editItem", itemId: "none", text: SECRET }));
    const { getEnv } = await import("@/lib/v2/runtime");
    const text = JSON.stringify([calls, getEnv("verify").audit.list()]);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("sk_test_dummy");
    expect(text).not.toContain("pk_test_dummy");
  });
});

describe("動かし方の決め方：接続先と公開先の書き方", () => {
  const HACK = "libsql://hackathon-db.example.invalid";

  it("ハッカソン版と同じ場所なら、書き方が違っていても使わない", () => {
    const variants = [
      HACK,
      "libsql://hackathon-db.example.invalid/",
      "LIBSQL://HACKATHON-DB.EXAMPLE.INVALID",
      "https://hackathon-db.example.invalid",
      "wss://hackathon-db.example.invalid",
      "https://Hackathon-DB.example.invalid/",
    ];
    for (const url of variants) {
      expect(v2Database({ V2_TURSO_DATABASE_URL: url, TURSO_DATABASE_URL: HACK }), url).toBeNull();
      expect(getMode({ V2_MODE: "verify", ...KEYS, ...DB, V2_TURSO_DATABASE_URL: url, TURSO_DATABASE_URL: HACK }), url).toBe("off");
    }
    // ハッカソン版の接続先が読めない書き方のときも、同じかもしれないので使わない
    expect(v2Database({ V2_TURSO_DATABASE_URL: "libsql://v2.example.invalid", TURSO_DATABASE_URL: "not a url" })).toBeNull();
  });

  it("鍵や指定を埋め込んだ接続先、決まった書き方以外の接続先は使わない", () => {
    for (const url of [
      "libsql://v2.example.invalid?authToken=abc",
      "libsql://user:pass@v2.example.invalid",
      "libsql://v2.example.invalid#x",
      "http://v2.example.invalid",
      "file:local.db",
      "v2.example.invalid",
      "ws://v2.example.invalid",
      "libsql://",
    ]) {
      expect(v2Database({ V2_TURSO_DATABASE_URL: url }), url).toBeNull();
    }
    expect(v2Database({ V2_TURSO_DATABASE_URL: " libsql://v2.example.invalid ", V2_TURSO_AUTH_TOKEN: " tok " })).toEqual({
      url: "libsql://v2.example.invalid",
      authToken: "tok",
    });
  });

  it("テストの中だけで動くデータベースは、開発用に動かしているときだけ。公開先では使わない", () => {
    expect(v2Database({ V2_TURSO_DATABASE_URL: ":memory:" })).not.toBeNull();
    expect(v2Database({ V2_TURSO_DATABASE_URL: ":memory:", NODE_ENV: "production" })).toBeNull();
    expect(v2Database({ V2_TURSO_DATABASE_URL: ":memory:", VERCEL: "1" })).toBeNull();
    expect(getMode({ V2_MODE: "verify", ...KEYS, ...DB, V2_TURSO_DATABASE_URL: ":memory:", VERCEL: "1" })).toBe("off");
  });

  it("公開先の指定がない・おかしいときは、検証用にならない", async () => {
    const { v2Origin } = await import("@/lib/v2/mode");
    expect(v2Origin({ V2_APP_ORIGIN: "https://v2.example.invalid" })).toBe("https://v2.example.invalid");
    expect(v2Origin({ V2_APP_ORIGIN: "https://v2.example.invalid/" })).toBe("https://v2.example.invalid");
    expect(v2Origin({ V2_APP_ORIGIN: "http://localhost:3000" })).toBe("http://localhost:3000");
    for (const bad of [
      undefined,
      "",
      "v2.example.invalid",
      "http://v2.example.invalid",
      "https://v2.example.invalid/v2",
      "https://v2.example.invalid?x=1",
      "https://user:pass@v2.example.invalid",
      "ftp://v2.example.invalid",
      "*",
    ]) {
      expect(v2Origin({ V2_APP_ORIGIN: bad }), String(bad)).toBeNull();
      expect(getMode({ V2_MODE: "verify", ...KEYS, ...DB, V2_APP_ORIGIN: bad }), String(bad)).toBe("off");
    }
    // 公開先では、自分のパソコン宛ての http は受け付けない
    expect(v2Origin({ V2_APP_ORIGIN: "http://localhost:3000", VERCEL: "1" })).toBeNull();
    expect(v2Origin({ V2_APP_ORIGIN: "http://localhost:3000", NODE_ENV: "production" })).toBeNull();
  });
});

describe("手元用の認証は、検証用の入口が渡す決まった名前を、合言葉として受け付けない", () => {
  it("発行した ID の形（43文字）以外は、だれでもないものとして扱う", async () => {
    const { createLocalAuth } = await import("@/lib/v2/auth");
    const auth = createLocalAuth();
    for (const token of ["signed-in", "clerk-session", "", "a", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "!"]) {
      expect(await auth.resolve(token), token).toBeNull();
    }
    expect(await auth.resolve(null)).toBeNull();
    expect(await auth.resolve("A".repeat(43))).not.toBeNull();
  });

  it("万一、検証用の入口に手元用の認証が渡っても、全員が同じ1人として扱われることはない", async () => {
    const { handle } = await import("@/lib/v2/access");
    const { createAuditLog } = await import("@/lib/v2/audit");
    const { createLocalAuth } = await import("@/lib/v2/auth");
    const { createDeps } = await import("./helpers");
    const env = { deps: createDeps(), auth: createLocalAuth(), audit: createAuditLog() };
    await expect(handle(env, "signed-in", { action: "start" })).rejects.toMatchObject({ status: 401 });
    expect(await env.deps.store.size()).toBe(0);
  });
});

describe("回数の上限（利用者ごと）と、検証用の保存先の件数の上限", () => {
  it("利用者ごとに数え、覚えておく人数にも上限がある", async () => {
    const { createKeyedLimiter } = await import("@/lib/v2/rate-limit");
    let now = 0;
    const limiter = createKeyedLimiter({ max: 2, windowMs: 1000, maxKeys: 2, nowMs: () => now });
    expect([limiter.allow("a"), limiter.allow("a"), limiter.allow("a")]).toEqual([true, true, false]);
    expect(limiter.allow("b")).toBe(true);
    now = 1001;
    expect(limiter.allow("a")).toBe(true);
    // 覚えておく人数を超えたら、古い記録から捨てる（記録が増え続けない）
    limiter.allow("c");
    limiter.allow("d");
    expect(limiter.allow("b")).toBe(true);
  });

  it("保存先がいっぱいのときは、新しい面談を断り、すでにある面談は消さない", async () => {
    const { createClient } = await import("@libsql/client");
    const { createLibsqlStore } = await import("@/lib/v2/store-libsql");
    const { StoreFullError } = await import("@/lib/v2/store");
    const db = createClient({ url: ":memory:" });
    const store = createLibsqlStore(() => db, { maxRows: 2 });
    const make = (user: string) => ({
      id: `${user}/${user}`,
      owner: { tenantId: user, userId: user },
      createdAt: "t",
      updatedAt: "t",
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
    });
    await store.put(make("u1"));
    await store.put(make("u2"));
    await expect(Promise.resolve().then(() => store.put(make("u3")))).rejects.toBeInstanceOf(StoreFullError);
    expect(await store.size()).toBe(2);
    // すでにある面談の更新は、いっぱいでも受け付ける
    const existing = (await store.get("u1/u1"))!;
    existing.purpose = "更新";
    await store.put(existing);
    expect((await store.get("u1/u1"))!.purpose).toBe("更新");
    // 消せば、また始められる
    await store.delete("u2/u2");
    await store.put(make("u3"));
    expect(await store.size()).toBe(2);
  });
});

describe("検証用と指定されているのに設定が足りないときは、入口ごと止まる", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ログインの鍵がないと 503。ログインなしの手元の動きには落ちない", async () => {
    vi.stubEnv("V2_MODE", "verify");
    vi.stubEnv("V2_TURSO_DATABASE_URL", ":memory:");
    signedIn = "user_owner1";
    const { GET, POST } = await import("@/app/api/v2/session/route");
    expect((await GET()).status).toBe(503);
    const res = await POST(
      new NextRequest("http://localhost:3999/api/v2/session", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3999", host: "localhost:3999" },
        body: JSON.stringify({ action: "start" }),
      }),
    );
    expect(res.status).toBe(503);
  });
});
