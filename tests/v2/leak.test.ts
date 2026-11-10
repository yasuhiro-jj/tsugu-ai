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
    const current = service.getView(deps, SID_A)!;

    // 選ばない：money テーマのすべての項目と、選択肢の項目
    const chosen = current.items.filter((i) => i.theme !== "money" && i.kind !== "option").map((i) => i.id);
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
    expect(edited.items.find((i) => i.id === ids[0])!.selected).toBe(false);
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
    const rest = service.getView(deps, SID_A)!.items.map((i) => i.id);
    await service.setReportSettings(deps, SID_A, "bank", rest);
    const done = await service.generateReport(deps, SID_A);
    expect(JSON.stringify(done.report)).not.toContain(SECRET);
    expect(JSON.stringify(deps.generatorInputs)).not.toContain(SECRET);
  });

  it("資料で未確認の固定項目だけを選んでも、ほかのテーマの質問は足されない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.confirmReview(deps, SID_A);
    const fixed = view.items.find((i) => i.text.includes("雇用条件"))!;
    expect(fixed.theme).toBeNull();
    await service.setReportSettings(deps, SID_A, "bank", [fixed.id]);
    const done = await service.generateReport(deps, SID_A);
    expect(done.report!.questions).toEqual(["事業の引き継ぎについて、ほかにどのような選択肢と相談先がありますか？"]);
  });

  it("載せる項目の指定に知らない ID が混じると、選択は何も変わらない", async () => {
    const deps = createDeps();
    const view = await completeInterview(deps, SID_A);
    await service.setReportSettings(deps, SID_A, "bank", [view.items[0].id]);
    const before = service.getView(deps, SID_A)!;
    await expect(
      service.setReportSettings(deps, SID_A, "support_center", [view.items[1].id, "unknown"]),
    ).rejects.toMatchObject({ status: 404 });
    expect(service.getView(deps, SID_A)).toEqual(before);
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
    expect(service.getView(deps, SID_B)).toBeNull();
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
    expect(service.getView(deps, SID_A)!.items[0].text).toBe(SECRET);
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
    const got = deps.store.get(SID_A)!;
    got.log.push({ who: "me", theme: "legacy", text: "勝手な追記" });
    expect(deps.store.get(SID_A)!.log).toHaveLength(1);
  });
});

describe("保存先（メモリ）の上限と期限", () => {
  it("上限を超えると古いものから消え、期限を過ぎると消える", async () => {
    const { createMemoryStore } = await import("@/lib/v2/store");
    let now = 0;
    const store = createMemoryStore({ maxSessions: 2, ttlMs: 1000, nowMs: () => now });
    const deps = createDeps({ store });
    await service.start(deps, "s1");
    await service.start(deps, "s2");
    await service.start(deps, "s3");
    expect(store.get("s1")).toBeNull();
    expect(store.size()).toBe(2);
    now = 5000;
    expect(store.size()).toBe(0);
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

  it("2.0 のファイルは、既存の lib・components・DB・AI の部品を読み込まない", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const specs = [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specs) {
        expect(ALLOWED.some((re) => re.test(spec)), `${file} が ${spec} を読み込んでいます`).toBe(true);
      }
      // 相対パスで v2 の外へ出ていないこと
      expect(source, file).not.toMatch(/from\s+["'](\.\.\/)+(lib|components)\/(?!v2)/);
    }
  });

  it("2.0 のファイルは、鍵・外部通信・DB を使わない", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/ANTHROPIC|TURSO|libsql|@anthropic-ai/i);
      expect(source, file).not.toMatch(/https?:\/\//);
      const envs = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
      expect(envs.every((e) => e === "NODE_ENV" || e === "VERCEL"), file).toBe(true);
    }
  });

  it("外部への通信（fetch）は、画面から自分の API を呼ぶ1か所だけ", () => {
    const withFetch = files.filter((f) => /\bfetch\(/.test(readFileSync(f, "utf8")));
    expect(withFetch.map((f) => f.replace(ROOT, "").replace(/\\/g, "/"))).toEqual(["/components/v2/use-session.ts"]);
    expect(readFileSync(withFetch[0], "utf8")).toContain('const API = "/api/v2/session"');
  });
});
