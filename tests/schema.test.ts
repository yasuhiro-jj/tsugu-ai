// db/schema.sql と lib/schema.ts が食い違っていないこと

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_STATEMENTS } from "@/lib/schema";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("スキーマ", () => {
  it("lib/schema.ts の各文が db/schema.sql に含まれる", () => {
    const sql = norm(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
    for (const stmt of SCHEMA_STATEMENTS) expect(sql).toContain(norm(stmt) + ";");
  });
});
