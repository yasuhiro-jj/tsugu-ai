// 2.0 試作の「選ばなかった情報が漏れない」テスト（FUNC-04／SEC-03）と、
// 既存版（ハッカソン版）へつながる経路がないことの確認。架空のデータだけを使う。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as service from "@/lib/v2/service";
import { completeInterview, createDeps, SID_A, SID_B } from "./helpers";

// 選ばない項目に入れる目印。資料生成への入力・資料・ログのどこにも出てはいけない
const SECRET = "ZZ-MEJIRUSHI-HIMITSU-7731";
const PUBLIC = "QQ-MEJIRUSHI-KOUKAI-4402";

afterEach(() => {
  vi.restoreAllMocks();
});

function spyConsole() {
  const calls: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
  }
  return calls;
}

describe("FUNC-04／SEC-03 選ばなかった項目は、資料生成の入力・資料・ログに出ない", () => {
  it("「載せる」の初期値はすべて未選択", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    expect(view.items.length).toBeGreaterThan(0);
    expect(view.items.every((i) => i.selected === false)).toBe(true);
  });

  it("一部だけ選ぶと、選ばなかった項目の目印がどこにも出ない", async () => {
    const logs = spyConsole();
    const deps = createDeps();
    // money テーマの答えにだけ「選ばない目印」を、legacy テーマの答えに「選ぶ目印」を入れる
    const view = await completeInterview(deps, SID_A, (theme, round) =>
      theme === "money" ? `借入は${SECRET}です ${round}` : theme === "legacy" ? `${PUBLIC} ${round}` : `${theme}の答え${round}`,
    );
    await service.confirmReview(deps, SID_A);
    await service.setOptions(deps, SID_A, ["closure"]);
    const current = (await service.getView(deps, SID_A))!;

    // 選ばない：money テーマのすべての項目と、選択肢の項目
    const chosen = current.items
      .filter((i) => i.theme !== "money" && i.kind !== "option" && i.kind !== "prep")
      .map((i) => i.id);
    await service.setReportSettings(deps, SID_A, "support_center", chosen);
    const done = await service.generateReport(deps, SID_A);

    // 1) 資料生成に渡された入力
    expect(deps.generatorInputs).toHaveLength(1);
    const input = JSON.stringify(deps.generatorInputs[0]);
    expect(input).toContain(PUBLIC);
    expect(input).not.toContain(SECRET);
    expect(input).not.toContain("店を閉じる");
    expect(deps.generatorInputs[0].items.some((i) => i.theme === "money")).toBe(false);
    expect(deps.generatorInputs[0].items.some((i) => i.kind === "option")).toBe(false);

    // 2) できあがった資料
    const report = JSON.stringify(done.report);
    expect(report).toContain(PUBLIC);
    expect(report).not.toContain(SECRET);
    expect(report).not.toContain("店を閉じる");
    expect(done.report!.optionsNote).toBeNull();
    // 選ばなかったテーマに関する質問も足されない
    expect(done.report!.questions.some((q) => q.includes("借入"))).toBe(false);

    // 3) ログ
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).not.toContain(PUBLIC);
    expect(view.items.length).toBeGreaterThan(0);
  });

  it("選び直して項目を外すと、古い資料は破棄され、作り直した資料にも入らない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A, (theme, round) =>
      theme === "staff" ? `${SECRET} ${round}` : `${theme}の答え${round}`,
    );
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", view.items.map((i) => i.id));
    const first = await service.generateReport(deps, SID_A);
    expect(JSON.stringify(first.report)).toContain(SECRET);

    const without = view.items.filter((i) => i.theme !== "staff").map((i) => i.id);
    const changed = await service.setReportSettings(deps, SID_A, "bank", without);
    expect(changed.report).toBeNull();
    const second = await service.generateReport(deps, SID_A);
    expect(JSON.stringify(second.report)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs[1])).not.toContain(SECRET);
  });

  it("内容を直す・消す・選択肢を変えると、古い資料は破棄される", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const ids = view.items.map((i) => i.id);
    await service.setReportSettings(deps, SID_A, "bank", ids);

    await service.generateReport(deps, SID_A);
    const edited = await service.editItem(deps, SID_A, ids[0], "直した");
    expect(edited.report).toBeNull();
    // 書き直した項目は「載せる」が外れる（本人が選び直すまで資料に入らない）
    const rewritten = edited.items.find((i) => i.text === "直した")!;
    expect(rewritten.selected).toBe(false);
    // ID も変わる（古い画面の ID では選べない）
    expect(rewritten.id).not.toBe(ids[0]);
    await service.generateReport(deps, SID_A);
    expect(JSON.stringify(deps.generatorInputs.at(-1))).not.toContain("直した");
    expect((await service.removeItem(deps, SID_A, ids[1])).report).toBeNull();
    await service.generateReport(deps, SID_A);
    expect((await service.setOptions(deps, SID_A, ["family"])).report).toBeNull();
  });

  it("消した項目は、資料生成の入力にも資料にも入らない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A, (theme, round) =>
      theme === "work" && round === 1 ? SECRET : `${theme}の答え${round}`,
    );
    await service.confirmReview(deps, SID_A);
    const target = view.items.find((i) => i.text === SECRET)!;
    await service.removeItem(deps, SID_A, target.id);
    const rest = (await service.getView(deps, SID_A))!.items.map((i) => i.id);
    await service.setReportSettings(deps, SID_A, "bank", rest);
    const done = await service.generateReport(deps, SID_A);
    expect(JSON.stringify(done.report)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
  });

  it("準備リストは、載せると選んだ分野だけが資料に入る（書いた言葉も含めて）", async () => {
    const logs = spyConsole();
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const view = await service.setPrep(deps, SID_A, {
      loans: { status: "todo", next: `${SECRET}を確かめる` },
      contracts: { status: "confirmed", basis: SECRET },
      permits: { status: "unknown", next: `${PUBLIC}に聞く` },
    });
    const permits = view.items.find((i) => i.prepKey === "permits")!;
    await service.setReportSettings(deps, SID_A, "bank", [permits.id]);
    const done = await service.generateReport(deps, SID_A);

    // 載せると選んだ分野を書き換えたら、古い文章も新しい文章も、選び直すまで資料に入らない
    const rewritten = await service.setPrep(deps, SID_A, { permits: { status: "todo", next: `${SECRET}を持っていく` } });
    expect(rewritten.report).toBeNull();
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({ code: "nothing_selected" });
    expect(deps.generatorInputs).toHaveLength(1);

    expect(done.report!.prep).toEqual([`許認可・衛生：不明／次に確認すること：${PUBLIC}に聞く`]);
    expect(JSON.stringify(done.report)).not.toContain(SECRET);
    expect(JSON.stringify(done.report)).not.toContain("借入・保証");
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
    expect(deps.generatorInputs[0].items).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).not.toContain(PUBLIC);
  });

  it("「次の一歩」のメモは、資料生成の入力にも資料にも入らず、資料の下書きも変えない", async () => {
    const logs = spyConsole();
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", view.items.map((i) => i.id));
    const before = await service.generateReport(deps, SID_A);

    const after = await service.setNextSteps(deps, SID_A, {
      loans: { decision: "do", who: SECRET, when: "this_week" },
      consult: { decision: "hold" },
    });
    // 資料の下書きはそのまま（本人用のメモは資料と別物）
    expect(after.report).toEqual(before.report);
    expect(after.items).toEqual(before.items);

    const again = await service.generateReport(deps, SID_A);
    expect(JSON.stringify(again.report)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain("this_week");
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });

  it("準備リストの分野だけを選んでも、ほかのテーマの質問は足されない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const fixed = view.items.find((i) => i.prepKey === "staff")!;
    expect(fixed.theme).toBeNull();
    await service.setReportSettings(deps, SID_A, "bank", [fixed.id]);
    const done = await service.generateReport(deps, SID_A);
    expect(done.report!.questions).toEqual(["事業の引き継ぎについて、ほかにどのような選択肢と相談先がありますか？"]);
  });

  it("載せる項目の指定に知らない ID が混じると、選択は何も変わらない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", [view.items[0].id]);
    const before = (await service.getView(deps, SID_A))!;
    await expect(
      service.setReportSettings(deps, SID_A, "support_center", [view.items[1].id, "unknown"]),
    ).rejects.toMatchObject({ status: 404 });
    expect((await service.getView(deps, SID_A))).toEqual(before);
  });

  it("1つも選んでいないと資料は作れず、資料生成は呼ばれない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", []);
    await expect(service.generateReport(deps, SID_A)).rejects.toMatchObject({ code: "nothing_selected" });
    expect(deps.generatorInputs).toHaveLength(0);
  });

  it("選択肢を選び直すと、「載せる」は未選択に戻る", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const withOption = await service.setOptions(deps, SID_A, ["closure"]);
    const option = withOption.items.find((i) => i.kind === "option")!;
    await service.setReportSettings(deps, SID_A, "bank", [option.id]);
    const again = await service.setOptions(deps, SID_A, ["closure", "family"]);
    expect(again.items.find((i) => i.kind === "option")!.selected).toBe(false);
  });
});

describe("ほかの人の面談に触れられない（試作の範囲。本人認証は段階3）", () => {
  it("別のセッションからは、内容も存在も見えない", async () => {
    const deps = createDeps();
    await completeInterview(deps, SID_A, () => SECRET);
    expect((await service.getView(deps, SID_B))).toBeNull();
    const b = await service.start(deps, SID_B);
    expect(JSON.stringify(b)).not.toContain(SECRET);
  });

  it("別のセッションの項目 ID を指定しても、直す・消す・載せるはできない", async () => {
    const deps = createDeps();
    const a = await completeInterview(deps, SID_A, () => SECRET);
    await completeInterview(deps, SID_B);
    await service.confirmReview(deps, SID_B);
    const foreign = a.items[0].id;
    await expect(service.editItem(deps, SID_B, foreign, "書き換え")).rejects.toMatchObject({ status: 404 });
    await expect(service.removeItem(deps, SID_B, foreign)).rejects.toMatchObject({ status: 404 });
    await expect(service.setReportSettings(deps, SID_B, "bank", [foreign])).rejects.toMatchObject({ status: 404 });
    expect((await service.getView(deps, SID_A))!.items[0].text).toBe(SECRET);
  });

  it("画面へ返す内容にセッション ID を含めない", async () => {
    const deps = createDeps();
    const view = await service.start(deps, SID_A);
    expect(JSON.stringify(view)).not.toContain(SID_A);
    expect("id" in view).toBe(false);
  });

  it("保存先から受け取った内容を書き換えても、保存内容は変わらない", async () => {
    const deps = createDeps();
    await service.start(deps, SID_A);
    const got = (await deps.store.get(SID_A))!;
    got.log.push({ who: "me", theme: "legacy", text: "勝手な追記" });
    expect((await deps.store.get(SID_A))!.log).toHaveLength(1);
  });
});

describe("保存先（メモリ）の上限と期限", () => {
  it("上限に達したら新しい面談を断り（既存は消さない）、期限を過ぎると消える", async () => {
    const { createMemoryStore } = await import("@/lib/v2/store");
    let now = 0;
    const store = createMemoryStore({ maxSessions: 2, ttlMs: 1000, nowMs: () => now });
    const deps = createDeps({ store });
    await service.start(deps, "s1");
    await service.start(deps, "s2");
    await expect(service.start(deps, "s3")).rejects.toMatchObject({ code: "busy", status: 503 });
    expect((await store.get("s1"))).not.toBeNull();
    expect((await store.get("s3"))).toBeNull();
    expect((await store.size())).toBe(2);
    // すでにある面談の更新は、いっぱいでも受け付ける
    await service.skip(deps, "s1");
    now = 5000;
    expect((await store.size())).toBe(0);
    // 期限で空いたら、また始められる
    await service.start(deps, "s3");
    expect((await store.size())).toBe(1);
  });
});

describe("既存版（ハッカソン版）へつながる経路がない", () => {
  const ROOT = join(__dirname, "..", "..");
  const V2_DIRS = ["lib/v2", "app/v2", "app/api/v2", "components/v2"];
  const ALLOWED = [
    /^\.\.?\//, // 同じ v2 フォルダ内の相対パス
    /^@\/lib\/v2\//,
    /^@\/components\/v2\//,
    /^react$/,
    /^next\/(server|headers|link|navigation)$/,
    /^next$/,
    /^node:crypto$/,
    /^server-only$/,
  ];

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  const files = V2_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => /\.(ts|tsx)$/.test(f));
  const rel = (file: string) => file.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/"), "");
  const isLibsqlStore = (file: string) => rel(file) === "/lib/v2/store-libsql.ts";

  // 外の部品（ログインの Clerk、データベースの libSQL）を読み込んでよいファイル。ここにないファイルが読み込んだら失敗する
  const EXTRA_IMPORTS: Record<string, string[]> = {
    "@libsql/client": ["/lib/v2/store-libsql.ts", "/lib/v2/runtime.ts"],
    "@clerk/nextjs/server": ["/lib/v2/auth-clerk.ts"],
    "@clerk/nextjs": [
      "/app/v2/layout.tsx",
      "/app/v2/sign-in/[[...sign-in]]/page.tsx",
      "/app/v2/sign-up/[[...sign-up]]/page.tsx",
      "/components/v2/AccountMenu.tsx",
    ],
  };
  // 環境変数を読んでよいのは、動かし方を決めるファイルだけ
  const MODE_FILE = "/lib/v2/mode.ts";
  const MODE_ENVS = [
    "V2_MODE",
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "CLERK_SECRET_KEY",
    "V2_TURSO_DATABASE_URL",
    "V2_TURSO_AUTH_TOKEN",
    "TURSO_DATABASE_URL", // ハッカソン版と同じ接続先でないことを確かめるためだけに読む
    "NODE_ENV",
    "VERCEL",
  ];

  it("2.0 のファイルは、既存の lib・components・DB・AI の部品を読み込まない", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const specs = [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specs) {
        // 外の部品を読み込んでよいのは、決めたファイルだけ
        const ok = ALLOWED.some((re) => re.test(spec)) || (EXTRA_IMPORTS[spec] ?? []).includes(rel(file));
        expect(ok, `${file} が ${spec} を読み込んでいます`).toBe(true);
      }
      // 相対パスで v2 の外へ出ていないこと
      expect(source, file).not.toMatch(/from\s+["'](\.\.\/)+(lib|components)\/(?!v2)/);
    }
  });

  it("2.0 のファイルは、AI の鍵・ハッカソン版の鍵・外部の URL を使わない。環境変数を読むのは1つのファイルだけ", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // AI の鍵と部品は、どのファイルにも出てこない（2.0 は、まだ外部の AI につながない）
      expect(source, file).not.toMatch(/ANTHROPIC|@anthropic-ai/i);
      // ハッカソン版のデータベースの鍵（TURSO_AUTH_TOKEN）は、どのファイルにも出てこない。
      // 2.0 専用の名前（V2_TURSO_...）だけを使う
      expect(source.replace(/V2_TURSO_AUTH_TOKEN/g, ""), file).not.toMatch(/TURSO_AUTH_TOKEN/);
      expect(source, file).not.toMatch(/https?:\/\//);

      const envs = [...source.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]);
      if (rel(file) === MODE_FILE) {
        expect(envs.filter((e) => !MODE_ENVS.includes(e)), file).toEqual([]);
      } else {
        // ほかのファイルは、環境変数をいっさい読まない
        expect(envs, file).toEqual([]);
        expect(source, file).not.toMatch(/process\s*\.\s*env|process\s*\[/);
        expect(source, file).not.toMatch(/TURSO_|CLERK_[A-Z]/);
      }
      // 名前を変数で指定する読み方や、まとめて取り出す読み方もしていない
      expect(source, file).not.toMatch(/process\.env\s*\[|\}\s*=\s*process\.env/);
    }
  });

  it("ハッカソン版のデータベースの接続先は、「同じでないこと」を確かめるためだけに読む", () => {
    const mode = readFileSync(join(ROOT, "lib/v2/mode.ts"), "utf8");
    const uses = mode.split("\n").filter((line) => /(?<!V2_)TURSO_DATABASE_URL/.test(line) && !line.trim().startsWith("//"));
    // 1行だけ：2.0 の接続先と同じなら使わない、という比較
    expect(uses).toHaveLength(1);
    expect(uses[0]).toContain("=== url.trim()) return null");
  });

  it("Clerk と Turso を使うのは、検証用の動かし方のときだけ。ハッカソン版の入口（lib/db.ts など）は使わない", () => {
    // 2.0 のフォルダだけでなく、リポジトリ全体（テストと依存パッケージを除く）を調べる
    const skip = new Set(["node_modules", ".next", ".git", "tests", "video", "screenshots"]);
    const walkAll = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        if (skip.has(name)) return [];
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walkAll(path) : [path];
      });
    const all = walkAll(ROOT).filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f));
    expect(all.length).toBeGreaterThan(files.length);

    // Turso 用の保存先を読み込むのは、runtime.ts だけ（拡張子つきの書き方も拾う）
    const users = all.filter((f) => !isLibsqlStore(f) && /store-libsql(\.[a-z]+)?["'`]/.test(readFileSync(f, "utf8")));
    expect(users.map(rel)).toEqual(["/lib/v2/runtime.ts"]);
    // Clerk の部品を読み込むのは、2.0 のファイルと、リクエストの入口（proxy.ts）だけ
    const clerkUsers = all.filter((f) => /["'`]@clerk\//.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(clerkUsers).toEqual(
      ["/proxy.ts", ...Object.values(EXTRA_IMPORTS["@clerk/nextjs"]), ...EXTRA_IMPORTS["@clerk/nextjs/server"]].sort(),
    );

    const runtime = readFileSync(join(ROOT, "lib/v2/runtime.ts"), "utf8");
    // 手元はメモリ保存のまま。Turso と Clerk は、検証用のときだけ選ばれる
    expect(runtime).toContain('getMode() === "verify" ? verifyStore() : (globalForV2.__tsuguV2Store ??= createMemoryStore())');
    expect(runtime).toContain('getMode() === "verify" ? createClerkAuth() : createLocalAuth()');
    // 接続先は、動かし方を決めるファイルからだけ受け取る（ここでは環境変数を読まない）
    expect(runtime).toContain("createClient(target)");
    expect(runtime).not.toMatch(/process\s*\.\s*env|@\/lib\/db|\.\.\/db/);
    // Turso 用の保存先そのものには、接続を作る処理も、環境変数も、ハッカソン版の入口も入っていない
    const store = readFileSync(join(ROOT, "lib/v2/store-libsql.ts"), "utf8");
    expect(store).not.toMatch(/process\s*\.\s*env|process\[|createClient|@\/lib\/db|\.\.\/db/);

    // リクエストの入口は、2.0 の画面と API だけを対象にし、検証用のときだけ Clerk を動かす
    const proxy = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    expect(proxy).toContain('matcher: ["/v2", "/v2/:path*", "/api/v2/:path*"]');
    expect(proxy).toContain('getMode() === "verify" ? clerkMiddleware() : passThrough');
    expect(proxy).not.toMatch(/process\s*\.\s*env/);
  });

  it("外部への通信（fetch）は、画面から自分の API を呼ぶ1か所だけ", () => {
    const withFetch = files.filter((f) => /\bfetch\(/.test(readFileSync(f, "utf8")));
    expect(withFetch.map((f) => f.replace(ROOT, "").replace(/\\/g, "/"))).toEqual(["/components/v2/use-session.ts"]);
    expect(readFileSync(withFetch[0], "utf8")).toContain('const API = "/api/v2/session"');
  });
});
