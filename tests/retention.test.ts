// 保存期間を過ぎたデモデータの削除（lib/retention.ts）。DB はメモリ。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A, DEMO_B } from "./helpers";
import { ensureInterviewRows } from "@/lib/interview/store";
import type { InStatement } from "@libsql/client";
import {
  claimPurgeRun,
  demoRetentionDays,
  PURGE_INTERVAL_MS,
  purgeExpiredDemos,
  purgeExpiredDemosSafely,
} from "@/lib/retention";

const DEMO_C = "C".repeat(43);
const DEMO_D = "D".repeat(43);
const NOW = new Date("2026-11-20T00:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** demo_id を持つ6表すべてと ai_usage に行を作り、時刻を at にそろえる */
async function seed(demoId: string, at: string) {
  await ensureInterviewRows(db, demoId, "predecessor");
  await ensureInterviewRows(db, demoId, "successor");
  await db.batch(
    [
      { sql: `UPDATE interviews SET created_at = ?, updated_at = ? WHERE demo_id = ?`, args: [at, at, demoId] },
      { sql: `UPDATE theme_records SET updated_at = ? WHERE demo_id = ?`, args: [at, demoId] },
      {
        sql: `INSERT INTO diagnoses (demo_id, diagnosis, based_on, created_at) VALUES (?, '{}', '{}', ?)`,
        args: [demoId, at],
      },
      {
        sql: `INSERT INTO learning (demo_id, level, wants, current_plan, previous_plan, rev, updated_at)
              VALUES (?, 'Lv1', '[]', NULL, NULL, 0, ?)`,
        args: [demoId, at],
      },
      {
        sql: `INSERT INTO course_progress (demo_id, course_id, status, score, wrong_article_nos, updated_at)
              VALUES (?, 'cashflow', '学習中', NULL, '[]', ?)`,
        args: [demoId, at],
      },
      {
        sql: `INSERT INTO action_plans (demo_id, start_date, actions, message, diagnosis_created_at, rev, created_at, updated_at)
              VALUES (?, '2026-11-01', '[]', NULL, NULL, 0, ?, ?)`,
        args: [demoId, at, at],
      },
      {
        sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'predecessor', 3, ?)`,
        args: [demoId, at],
      },
    ],
    "write",
  );
}

const TABLES = ["interviews", "theme_records", "diagnoses", "learning", "course_progress", "action_plans"] as const;

async function counts(demoId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of [...TABLES, "ai_usage"]) {
    // t はこのファイルの固定の表名だけ
    const rs = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE demo_id = ?`, args: [demoId] });
    out[t] = Number(rs.rows[0].n);
  }
  return out;
}

describe("purgeExpiredDemos", () => {
  it("8日前のデモは全表から消え、6日前のデモは残る。ai_usage は残る", async () => {
    await seed(DEMO_A, daysAgo(8));
    await seed(DEMO_B, daysAgo(6));
    const r = await purgeExpiredDemos(db, { now: NOW, retentionDays: 7 });
    expect(r.demos).toBe(1);

    const a = await counts(DEMO_A);
    for (const t of TABLES) expect(a[t], t).toBe(0);
    expect(a.ai_usage).toBe(1);

    const b = await counts(DEMO_B);
    for (const t of TABLES) expect(b[t], t).toBeGreaterThan(0);
    expect(b.ai_usage).toBe(1);
  });

  it("どれか1つの表が最近更新されていれば残す（最後に使った日時＝最大値）", async () => {
    await seed(DEMO_C, daysAgo(10));
    await db.execute({
      sql: `UPDATE course_progress SET updated_at = ? WHERE demo_id = ?`,
      args: [daysAgo(1), DEMO_C],
    });
    await purgeExpiredDemos(db, { now: NOW, retentionDays: 7 });
    expect((await counts(DEMO_C)).interviews).toBe(2);
  });

  it("最近 AI を使っていれば（ai_usage が新しければ）残す", async () => {
    await seed(DEMO_C, daysAgo(10));
    await db.execute({ sql: `UPDATE ai_usage SET updated_at = ? WHERE demo_id = ?`, args: [daysAgo(2), DEMO_C] });
    await purgeExpiredDemos(db, { now: NOW, retentionDays: 7 });
    expect((await counts(DEMO_C)).interviews).toBe(2);
  });

  it("1回あたりの件数の上限を守り、古いものから消す（残りは次回）", async () => {
    await seed(DEMO_A, daysAgo(9));
    await seed(DEMO_C, daysAgo(10));
    await seed(DEMO_D, daysAgo(11));
    expect((await purgeExpiredDemos(db, { now: NOW, retentionDays: 7, maxDemos: 2 })).demos).toBe(2);
    expect((await counts(DEMO_D)).interviews).toBe(0);
    expect((await counts(DEMO_C)).interviews).toBe(0);
    expect((await counts(DEMO_A)).interviews).toBe(2);
    expect((await purgeExpiredDemos(db, { now: NOW, retentionDays: 7, maxDemos: 2 })).demos).toBe(1);
    expect((await purgeExpiredDemos(db, { now: NOW, retentionDays: 7, maxDemos: 2 })).demos).toBe(0);
  });

  it("ai_usage だけが残る demo_id は対象にしない（件数枠を使い切らない）", async () => {
    await db.execute({
      sql: `INSERT INTO ai_usage (demo_id, role, calls, updated_at) VALUES (?, 'successor', 1, ?)`,
      args: [DEMO_D, daysAgo(30)],
    });
    expect((await purgeExpiredDemos(db, { now: NOW, retentionDays: 7 })).demos).toBe(0);
    expect((await counts(DEMO_D)).ai_usage).toBe(1);
  });

  it("ai_usage_daily は30日より前の日付だけ消す", async () => {
    await db.batch(
      [
        { sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 5)`, args: [daysAgo(31).slice(0, 10)] },
        { sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 5)`, args: [daysAgo(10).slice(0, 10)] },
        { sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 5)`, args: [NOW.toISOString().slice(0, 10)] },
      ],
      "write",
    );
    await purgeExpiredDemos(db, { now: NOW });
    const rs = await db.execute(`SELECT day FROM ai_usage_daily ORDER BY day`);
    expect(rs.rows.map((r) => r.day)).toEqual([daysAgo(10).slice(0, 10), NOW.toISOString().slice(0, 10)]);
  });
});

describe("purgeExpiredDemosSafely（POST /api/role から応答のあとに呼ぶ版）", () => {
  it("DB に接続できなくても例外を投げない（ログに本文を出さない）", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeExpiredDemosSafely(async () => Promise.reject(new Error("down")))).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).not.toContain("down");
    err.mockRestore();
  });

  it("削除の途中で失敗しても例外を投げない（データは消えない）", async () => {
    await seed(DEMO_A, daysAgo(8));
    const broken = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "batch") return async () => Promise.reject(new Error("injected"));
        return Reflect.get(target, prop, receiver);
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeExpiredDemosSafely(async () => broken, { now: NOW })).resolves.toBeUndefined();
    err.mockRestore();
    expect((await counts(DEMO_A)).interviews).toBe(2);
  });
});

describe("demoRetentionDays", () => {
  it("既定は7日。DEMO_RETENTION_DAYS で上書きでき、不正な値は既定に戻る", () => {
    vi.stubEnv("DEMO_RETENTION_DAYS", "");
    expect(demoRetentionDays()).toBe(7);
    vi.stubEnv("DEMO_RETENTION_DAYS", "14");
    expect(demoRetentionDays()).toBe(14);
    for (const bad of ["0", "-1", "1.5", "abc", "9999"]) {
      vi.stubEnv("DEMO_RETENTION_DAYS", bad);
      expect(demoRetentionDays()).toBe(7);
    }
  });
});

describe("SEC-201：実行間隔の制限（1時間に1回）", () => {
  /** 実行された SQL を記録する DB */
  function recording(base: Client) {
    const sqls: string[] = [];
    const sqlOf = (st: InStatement) => (typeof st === "string" ? st : st.sql);
    const db = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return (st: InStatement) => {
            sqls.push(sqlOf(st));
            return target.execute(st);
          };
        }
        if (prop === "batch") {
          return (sts: InStatement[], mode?: "write") => {
            sqls.push(...sts.map(sqlOf));
            return target.batch(sts, mode);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    return { db, sqls };
  }
  const scans = (sqls: string[]) => sqls.filter((q) => /WITH data_times/.test(q)).length;

  it("短い間隔で2回呼ぶと、2回目は走査（SELECT）も削除もしない。間隔が過ぎれば再び動く", async () => {
    await seed(DEMO_A, daysAgo(8));
    const r = recording(db);
    await purgeExpiredDemosSafely(async () => r.db, { now: NOW });
    expect(scans(r.sqls)).toBe(1);
    expect((await counts(DEMO_A)).interviews).toBe(0);

    await seed(DEMO_B, daysAgo(8));
    const later = new Date(NOW.getTime() + 10 * 60 * 1000);
    await purgeExpiredDemosSafely(async () => r.db, { now: later });
    expect(scans(r.sqls)).toBe(1);
    expect((await counts(DEMO_B)).interviews).toBe(2);

    const afterInterval = new Date(NOW.getTime() + PURGE_INTERVAL_MS);
    await purgeExpiredDemosSafely(async () => r.db, { now: afterInterval });
    expect(scans(r.sqls)).toBe(2);
    expect((await counts(DEMO_B)).interviews).toBe(0);
  });

  it("同時に来ても実行の権利は1つだけ", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => claimPurgeRun(db, NOW)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await claimPurgeRun(db, new Date(NOW.getTime() + PURGE_INTERVAL_MS - 1))).toBe(false);
    expect(await claimPurgeRun(db, new Date(NOW.getTime() + PURGE_INTERVAL_MS))).toBe(true);
  });
});
