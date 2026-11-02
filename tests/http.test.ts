// 状態を変える API の入口チェック（Origin / Content-Type）とクッキーの secure 判定

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkMutation, isSecureRequest } from "@/lib/http";
import { isDemoId, newDemoId } from "@/lib/demo";

function req(url: string, headers: Record<string, string>) {
  return new NextRequest(url, { method: "POST", headers });
}

const URL_LOCAL = "http://localhost:3000/api/x";

describe("checkMutation", () => {
  it("同じホストの Origin と JSON は通す", () => {
    const r = req(URL_LOCAL, {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
    });
    expect(checkMutation(r, { requireJsonBody: true })).toBeNull();
  });

  it("Origin が無い場合は Content-Type だけ確認", () => {
    const ok = req(URL_LOCAL, {
      host: "localhost:3000",
      "content-type": "application/json; charset=utf-8",
    });
    expect(checkMutation(ok, { requireJsonBody: true })).toBeNull();
    const ng = req(URL_LOCAL, { host: "localhost:3000", "content-type": "text/plain" });
    expect(checkMutation(ng, { requireJsonBody: true })?.status).toBe(415);
  });

  it("別ホストの Origin・null Origin は 403", () => {
    const evil = req(URL_LOCAL, {
      host: "localhost:3000",
      origin: "https://evil.example",
      "content-type": "application/json",
    });
    expect(checkMutation(evil, { requireJsonBody: true })?.status).toBe(403);
    const nul = req(URL_LOCAL, { host: "localhost:3000", origin: "null" });
    expect(checkMutation(nul, { requireJsonBody: false })?.status).toBe(403);
  });

  it("本文なし（DELETE）は Content-Type を問わない", () => {
    const r = req(URL_LOCAL, { host: "localhost:3000" });
    expect(checkMutation(r, { requireJsonBody: false })).toBeNull();
  });
});

describe("secure 判定とデモ用 ID", () => {
  it("プロトコルで判定する", () => {
    expect(isSecureRequest(req("https://x.vercel.app/api/role", {}))).toBe(true);
    expect(isSecureRequest(req("http://localhost:3000/api/role", {}))).toBe(false);
    expect(
      isSecureRequest(req("http://internal/api/role", { "x-forwarded-proto": "https" })),
    ).toBe(true);
  });

  it("デモ用 ID は 43 文字の base64url で、毎回違う", () => {
    const a = newDemoId();
    expect(isDemoId(a)).toBe(true);
    expect(a).not.toBe(newDemoId());
    expect(isDemoId("short")).toBe(false);
    expect(isDemoId("A".repeat(42) + "=")).toBe(false);
  });
});
