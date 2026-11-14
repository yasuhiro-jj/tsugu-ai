// 2.0 試作の API の入口（app/api/v2/session/route.ts）のテスト。
// 公開先では止まること、ほかのサイトからの操作を断ること、大きすぎる送信を断ること、
// セッション ID の扱い、ログに本文を出さないことを確かめる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// クッキーの入れ物（テスト用）。next/headers の cookies() の代わり
const jar = new Map<string, string>();
const setCalls: { name: string; value: string; options: Record<string, unknown> }[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, value);
      setCalls.push({ name, value, options });
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const ORIGIN = "http://localhost:3999";
const URL = `${ORIGIN}/api/v2/session`;
const COOKIE = "tsugu_v2_sid";

async function load() {
  return import("@/app/api/v2/session/route");
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(URL, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, host: "localhost:3999", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jar.clear();
  setCalls.length = 0;
  delete (globalThis as { __tsuguV2Store?: unknown }).__tsuguV2Store;
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("公開先（Vercel）では止まる", () => {
  it("GET も POST も 503 を返し、面談を作らず、クッキーも出さない", async () => {
    vi.stubEnv("VERCEL", "1");
    const { GET, POST } = await load();
    const get = await GET();
    expect(get.status).toBe(503);
    const res = await POST(post({ action: "start" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("手元の開発環境でだけ動きます");
    expect(setCalls).toHaveLength(0);
    expect((globalThis as { __tsuguV2Store?: unknown }).__tsuguV2Store).toBeUndefined();
  });
});

describe("送信元と形式の確認", () => {
  it("ほかのサイトからの操作は 403", async () => {
    const { POST } = await load();
    expect((await POST(post({ action: "start" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect(setCalls).toHaveLength(0);
  });

  it("送信元が分からない操作は、同じサイトからと確かめられたときだけ受け付ける", async () => {
    const { POST } = await load();
    const noOrigin = (extra: Record<string, string>) =>
      new NextRequest(URL, {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:3999", ...extra },
        body: JSON.stringify({ action: "start" }),
      });
    expect((await POST(noOrigin({}))).status).toBe(403);
    expect((await POST(noOrigin({ "sec-fetch-site": "same-site" }))).status).toBe(403);
    expect((await POST(noOrigin({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await POST(noOrigin({ "sec-fetch-site": "same-origin" }))).status).toBe(200);
  });

  it("JSON 以外の形式は 415、壊れた JSON や配列は 400", async () => {
    const { POST } = await load();
    expect((await POST(post({ action: "start" }, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post("{not json"))).status).toBe(400);
    expect((await POST(post("[]"))).status).toBe(400);
    expect((await POST(post("null"))).status).toBe(400);
  });

  it("大きすぎる送信は 413（読み込む前の申告でも、実際の長さでも）", async () => {
    const { POST } = await load();
    expect((await POST(post({ action: "start" }, { "content-length": "20001" }))).status).toBe(413);
    expect((await POST(post({ action: "answer", text: "あ".repeat(20001) }))).status).toBe(413);
  });
});

describe("セッション ID の扱い", () => {
  it("始めると、推測できない ID を httpOnly クッキーで出し、応答には ID を含めない", async () => {
    const { POST, GET } = await load();
    const res = await POST(post({ action: "start" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.session.phase).toBe("interview");
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].name).toBe(COOKIE);
    expect(setCalls[0].value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(setCalls[0].options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(JSON.stringify(body)).not.toContain(setCalls[0].value);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const again = await (await GET()).json();
    expect(again.session.log).toHaveLength(1);
  });

  it("外から入れられた ID では面談を作らず、新しい ID を発行する", async () => {
    const forged = "F".repeat(43);
    jar.set(COOKIE, forged);
    const { POST } = await load();
    expect((await POST(post({ action: "start" }))).status).toBe(200);
    expect(jar.get(COOKIE)).not.toBe(forged);
  });

  it("面談を始めていない操作は 409（クッキーなし・保存先にない ID・形の違う ID）", async () => {
    const { POST } = await load();
    expect((await POST(post({ action: "answer", text: "x" }))).status).toBe(409);
    jar.set(COOKIE, "F".repeat(43));
    expect((await POST(post({ action: "answer", text: "x" }))).status).toBe(409);
    jar.set(COOKIE, "short");
    expect((await POST(post({ action: "skip" }))).status).toBe(409);
    expect(setCalls).toHaveLength(0);
  });

  it("「すべて消す」でクッキーも消え、内容は残らない", async () => {
    const { POST, GET } = await load();
    await POST(post({ action: "start" }));
    await POST(post({ action: "answer", text: "消える答え" }));
    const res = await POST(post({ action: "reset" }));
    expect(res.status).toBe(200);
    expect(jar.has(COOKIE)).toBe(false);
    expect((await (await GET()).json()).session).toBeNull();
  });

  it("別の人（別のクッキー）からは、内容も存在も見えない", async () => {
    const { POST, GET } = await load();
    await POST(post({ action: "start" }));
    await POST(post({ action: "answer", text: "HIMITSU-ROUTE-9901" }));
    jar.clear();
    const other = await (await GET()).json();
    expect(other.session).toBeNull();
    await POST(post({ action: "start" }));
    expect(JSON.stringify(await (await GET()).json())).not.toContain("HIMITSU-ROUTE-9901");
  });
});

describe("エラーとログ", () => {
  it("知らない操作や正しくない入力は 400 で、決まった文だけを返す", async () => {
    const { POST } = await load();
    await POST(post({ action: "start" }));
    const res = await POST(post({ action: "sendToBank" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("操作の指定が正しくありません。");
    expect((await POST(post({ action: "answer", text: "   " }))).status).toBe(400);
  });

  it("操作が成功しても失敗しても、ログに本文を出さない", async () => {
    const calls: unknown[][] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      });
    }
    const { POST } = await load();
    await POST(post({ action: "start" }));
    await POST(post({ action: "answer", text: "LOG-MEJIRUSHI-3310" }));
    await POST(post({ action: "editItem", itemId: "none", text: "LOG-MEJIRUSHI-3310" }));
    expect(JSON.stringify(calls)).not.toContain("LOG-MEJIRUSHI-3310");
  });
});
