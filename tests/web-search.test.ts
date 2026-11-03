// ウェブ検索つきの答え（lib/ai/web-search.ts・講座の質問 mode: "web"・AI参謀 web: true）。Claude は偽物、DB はメモリ。
// 検索先の一覧（公的機関6件＋民間サービス5件）、出典の集め方と kind、2段階（SEC-201）、検索の1日の上限（SEC-202）、
// 履歴の区切り（SEC-204）、省略時に今と同じ動きになること、役割、回数の予約、指示文の中身を確かめる。
// 本物の API は scripts/check-web-search.mjs の1回だけ。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { createTestDb, DEMO_A } from "./helpers";
import { ServiceError } from "@/lib/errors";
import {
  askWithWebSearch,
  collectWebAnswer,
  sanitizeSources,
  sourceKindOf,
  webSearchTool,
  WEB_SEARCH_ALLOWED_DOMAINS,
  WEB_SEARCH_BUDGET_MS,
  WEB_SEARCH_PRIVATE_DOMAINS,
  WEB_SEARCH_PUBLIC_DOMAINS,
  WEB_TOTAL_BUDGET_MS,
  type WebSearchAi,
  type WebSearchAiRequest,
  type WebSearchRaw,
} from "@/lib/ai/web-search";
import * as domains from "@/lib/web-search-domains";
import { PUBLIC_INFO_NOTES, WEB_RESEARCH_SYSTEM, WEB_SEARCH_RULES } from "@/lib/prompts/web-search";
import { ADVICE_GUIDE } from "@/lib/prompts/advice";
import { ADVISOR_SYSTEM_TEMPLATE } from "@/lib/prompts/advisor";
import { ASK_SYSTEM_TEMPLATE, ASK_WEB_SYSTEM_TEMPLATE } from "@/lib/prompts/ask";
import { askAboutArticle } from "@/lib/learning-ask";
import {
  ADVISOR_WEB_HISTORY_PREFIX,
  buildAdvisorRequest,
  getAdvisorStateFrom,
  sendAdvisorMessage,
  stripUrls,
  webReplyForHistory,
} from "@/lib/advisor";
import {
  MSG_WEB_SEARCH_DAILY_LIMIT,
  reserveWebSearchCall,
  usageDayKey,
  WEB_SEARCH_DAILY_LIMIT_DEFAULT,
  webSearchDailyLimit,
  webSearchDayKey,
} from "@/lib/ai/usage";
import { runDiagnosis } from "@/lib/diagnosis";
import { resetDemo } from "@/lib/interview/service";
import { purgeExpiredDemos } from "@/lib/retention";
import { getCourses } from "@/lib/courses";
import { COMPANY_CONTEXT } from "@/lib/demo-profiles";
import { nowIso } from "@/lib/util";
import type { JsonAi, JsonAiRequest } from "@/lib/ai/json-ai";
import type { AdvisorMessage } from "@/lib/advisor-types";
import type { Role } from "@/lib/role";

let db: Client;
beforeEach(async () => {
  db = await createTestDb();
});

// ---- 偽の AI ----

type FakeJsonAi = JsonAi & { requests: JsonAiRequest[]; queue: unknown[] };
/** 順番に返す偽の JSON AI（空になったら最後に渡したものを返し続ける） */
function fakeJsonAi(queue: unknown[] = []): FakeJsonAi {
  let last: unknown = queue[queue.length - 1] ?? {};
  const fn = (async (req: JsonAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.length ? fn.queue.shift() : last;
    last = next;
    return JSON.stringify(next);
  }) as FakeJsonAi;
  fn.requests = [];
  fn.queue = [...queue];
  return fn;
}

type WebStep = WebSearchRaw | "THROW" | "THROW_TRANSIENT";
type FakeWebAi = WebSearchAi & { requests: WebSearchAiRequest[]; queue: WebStep[] };
function fakeWebAi(queue: WebStep[] = []): FakeWebAi {
  const fn = (async (req: WebSearchAiRequest) => {
    fn.requests.push(structuredClone(req));
    const next = fn.queue.shift();
    if (next === "THROW") throw new Error("boom SECRET-DETAIL");
    if (next === "THROW_TRANSIENT") throw Object.assign(new Error("overloaded"), { status: 529 });
    return next ?? OK_RAW;
  }) as FakeWebAi;
  fn.requests = [];
  fn.queue = queue;
  return fn;
}

const JFC = "https://www.jfc.go.jp/n/findings/pdf/keiei.pdf";
const MHLW = "https://www.mhlw.go.jp/minimumichiran/";
const LOGLASS = "https://www.loglass.jp/blog/fl";
const OK_RAW: WebSearchRaw = {
  webSearchRequests: 1,
  content: [
    { type: "text", text: "公的な情報を調べます。" },
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "飲食店 家賃比率 目安" } },
    {
      type: "web_search_tool_result",
      tool_use_id: "s1",
      content: [
        { type: "web_search_result", url: JFC, title: "小企業の経営指標調査", encrypted_content: "x", page_age: null },
        { type: "web_search_result", url: LOGLASS, title: "FL比率とは", encrypted_content: "x", page_age: null },
        { type: "web_search_result", url: "https://evil.example.com/a", title: "ほかのサイト", encrypted_content: "x", page_age: null },
      ],
    },
    {
      type: "text",
      text: "家賃比率の目安は売上の1割前後です（日本政策金融公庫、2024年度）。",
      citations: [
        { type: "web_search_result_location", url: JFC, title: "小企業の経営指標調査", cited_text: "家賃比率…", encrypted_index: "e" },
      ],
    },
    { type: "text", text: "お店に当てはまるかは税理士に確認しましょう。" },
  ],
};

const DIAG = {
  common: [{ point: "お店を続けたい", evidence: "二人とも話している" }],
  gaps: [
    {
      theme: "資金繰り",
      point: "DIAG-GAP-返済の見え方",
      senior_said: "返済は心配ない",
      successor_said: "返済額を知らない",
      numbers: "営業赤字236万円",
      importance: "高",
    },
  ],
  to_confirm: [{ item: "返済予定表", how: "銀行", expert: "銀行" }],
  talk_questions: ["問い1", "問い2"],
};

async function putSharedTheme(role: Role) {
  const summary = JSON.stringify({ statements: ["要約"], ai_observations: [], unconfirmed: [] });
  await db.execute({
    sql: `INSERT INTO theme_records (demo_id, role, theme_key, messages, followup_count, status, summary, shared, rev, updated_at)
          VALUES (?, ?, 'cashflow', ?, 0, 'confirmed', ?, 1, 0, 'x')`,
    args: [DEMO_A, role, JSON.stringify([{ from: "me", text: "会話" }]), summary],
  });
}

/** AI の回数（ai_usage。デモ用 ID ごと） */
async function calls(demoId = DEMO_A): Promise<number> {
  const rs = await db.execute({ sql: `SELECT COALESCE(SUM(calls), 0) AS n FROM ai_usage WHERE demo_id = ?`, args: [demoId] });
  return Number(rs.rows[0].n);
}

/** 今日の検索の回数（ai_usage_daily の "web:" の行） */
async function webCalls(): Promise<number> {
  const rs = await db.execute({ sql: `SELECT calls FROM ai_usage_daily WHERE day = ?`, args: [webSearchDayKey(nowIso())] });
  return rs.rows[0] ? Number(rs.rows[0].calls) : 0;
}

async function expectStatus(p: Promise<unknown>, status: number) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).status).toBe(status);
}

// ---- 検索先の一覧 ----

describe("検索してよいサイト", () => {
  it("公的機関6件＋民間サービス5件＝11件だけを allowed_domains に渡す", () => {
    expect([...WEB_SEARCH_PUBLIC_DOMAINS]).toEqual([
      "chusho.meti.go.jp",
      "jfc.go.jp",
      "smrj.go.jp",
      "e-stat.go.jp",
      "mhlw.go.jp",
      "boj.or.jp",
    ]);
    expect([...WEB_SEARCH_PRIVATE_DOMAINS]).toEqual(["airregi.jp", "bixid.net", "manageboard.jp", "diggle.jp", "loglass.jp"]);
    expect(WEB_SEARCH_ALLOWED_DOMAINS).toHaveLength(11);
    const tool = webSearchTool();
    expect(tool).toEqual({
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 3,
      allowed_domains: [...WEB_SEARCH_PUBLIC_DOMAINS, ...WEB_SEARCH_PRIVATE_DOMAINS],
    });
    expect(tool.allowed_domains).toHaveLength(11);
    // 一覧は server-only でない lib/web-search-domains.ts に置き、lib/ai/web-search.ts は同じものを出す（SEC-203）
    expect(domains.WEB_SEARCH_ALLOWED_DOMAINS).toBe(WEB_SEARCH_ALLOWED_DOMAINS);
    expect(domains.sourceKindOf).toBe(sourceKindOf);
  });

  it("kind はドメインから判定する（サブドメインも含む）。一覧にないもの・https でないものは null", () => {
    expect(sourceKindOf("https://www.chusho.meti.go.jp/zaimu/")).toBe("public");
    expect(sourceKindOf("https://jfc.go.jp/")).toBe("public");
    expect(sourceKindOf("https://www.e-stat.go.jp/x")).toBe("public");
    expect(sourceKindOf("https://www.boj.or.jp/statistics/")).toBe("public");
    expect(sourceKindOf("https://airregi.jp/mate/")).toBe("private");
    expect(sourceKindOf("https://www.loglass.jp/")).toBe("private");
    expect(sourceKindOf("https://bixid.net/")).toBe("private");
    // 一覧にない・紛らわしいもの
    expect(sourceKindOf("https://meti.go.jp/")).toBeNull();
    expect(sourceKindOf("https://fakejfc.go.jp/")).toBeNull();
    expect(sourceKindOf("https://jfc.go.jp.evil.com/")).toBeNull();
    expect(sourceKindOf("https://example.com/?u=jfc.go.jp")).toBeNull();
    expect(sourceKindOf("http://www.jfc.go.jp/")).toBeNull();
    expect(sourceKindOf("javascript:alert(1)")).toBeNull();
    expect(sourceKindOf("https://user:pw@www.jfc.go.jp/")).toBeNull();
    expect(sourceKindOf(123)).toBeNull();
  });
});

// ---- 出典の集め方 ----

describe("出典の集め方", () => {
  it("引用（citations）を先に、検索結果を後に、URL で重複なしに集める。一覧にないドメインは捨てる。前置きの文は除く", () => {
    const c = collectWebAnswer(OK_RAW);
    expect(c.searched).toBe(true);
    expect(c.errorCodes).toEqual([]);
    expect(c.sources.map((s) => s.url)).toEqual([JFC, LOGLASS]);
    expect(c.sources[0]).toMatchObject({ kind: "public", title: "小企業の経営指標調査", citedText: "家賃比率…" });
    expect(c.sources[1]).toMatchObject({ kind: "private", title: "FL比率とは" });
    expect(c.sources.some((s) => s.url.includes("evil"))).toBe(false);
    expect(c.text).toBe("家賃比率の目安は売上の1割前後です（日本政策金融公庫、2024年度）。お店に当てはまるかは税理士に確認しましょう。");
  });

  it("検索結果がエラーの形（content が配列でなくオブジェクト）でも落ちず、searched は false・種類を記録する", () => {
    const c = collectWebAnswer({
      webSearchRequests: 1,
      content: [
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
        { type: "text", text: "公的な情報では見つかりませんでした。" },
      ],
    });
    expect(c.searched).toBe(false);
    expect(c.errorCodes).toEqual(["max_uses_exceeded"]);
    expect(c.sources).toEqual([]);
    expect(c.text).toBe("公的な情報では見つかりませんでした。");
  });

  it("検索しなかったときは searched false・出典なし。壊れたブロックは無視する", () => {
    const c = collectWebAnswer({ webSearchRequests: 0, content: [null, 1, { type: "text", text: "記事の説明です。" }] as unknown[] });
    expect(c).toEqual({ text: "記事の説明です。", sources: [], searched: false, errorCodes: [] });
  });

  it("保存した出典を読み直すときも、一覧にないドメインは捨て、kind は URL から判定し直す", () => {
    expect(
      sanitizeSources([
        { url: JFC, title: "公庫", kind: "private" },
        { url: JFC, title: "重複" },
        { url: "https://evil.example.com/", title: "x", kind: "public" },
        { url: LOGLASS, title: "" },
        "x",
      ]),
    ).toEqual([
      { url: JFC, title: "公庫", kind: "public" },
      { url: LOGLASS, title: LOGLASS, kind: "private" },
    ]);
    expect(sanitizeSources("x")).toEqual([]);
  });
});

// ---- 共通の関数 ----

describe("askWithWebSearch", () => {
  const Q = { purpose: "t", system: "s", messages: [{ role: "user" as const, content: "q" }], maxTokens: 100, maxChars: 1000 };

  it("1回の質問で回数の予約は1回（検索の回数も1回）。1段目の時間の予算は 50 秒", async () => {
    const webAi = fakeWebAi();
    const r = await askWithWebSearch({ db, webAi }, DEMO_A, "successor", Q);
    expect(r.searched).toBe(true);
    expect(webAi.requests).toHaveLength(1);
    expect(webAi.requests[0].timeoutMs).toBeLessThanOrEqual(WEB_SEARCH_BUDGET_MS);
    expect(await calls()).toBe(1);
    expect(await webCalls()).toBe(1);
    expect(WEB_SEARCH_BUDGET_MS).toBe(50_000);
  });

  it("本文が空なら1回だけ再送（再送も回数に数える）。2回とも空なら 502", async () => {
    const empty: WebSearchRaw = { webSearchRequests: 0, content: [] };
    const webAi = fakeWebAi([empty, empty]);
    await expectStatus(askWithWebSearch({ db, webAi }, DEMO_A, "successor", Q), 502);
    expect(webAi.requests).toHaveLength(2);
    expect(await calls()).toBe(2);
  });

  it("AI の失敗は 502。エラー本文は利用者へ出さない", async () => {
    const webAi = fakeWebAi(["THROW"]);
    const err = await askWithWebSearch({ db, webAi }, DEMO_A, "successor", Q).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).status).toBe(502);
    expect((err as ServiceError).userMessage).not.toContain("SECRET");
  });
});

// ---- 指示文 ----

describe("指示文", () => {
  it("検索の言葉に会社の名前や数字を入れない指示、公的情報の優先、民間サイトの扱いが入っている", () => {
    expect(WEB_SEARCH_RULES).toContain("検索の言葉には、会社やお店の名前");
    expect(WEB_SEARCH_RULES).toContain("具体的な数字を入れない");
    expect(WEB_SEARCH_RULES).toContain("公的な情報では見つかりませんでした");
    expect(WEB_SEARCH_RULES).toContain("出典名と時点");
    expect(WEB_SEARCH_RULES).toContain("数字の目安は公的機関のサイトを優先する");
    expect(WEB_SEARCH_RULES).toContain("一般的な説明にだけ使う");
    expect(WEB_SEARCH_RULES).toContain("特定のサービスや商品を勧めたり、比べて優劣をつけたりしない");
    expect(WEB_SEARCH_RULES).toContain("民間サイトの数字を、公的な目安のように書かない");
    expect(WEB_SEARCH_RULES).toContain("専門家に確認");
  });

  it("助言の内容（目安・資料と入手先・次の一歩・相談窓口・専門家に聞く理由と準備）と、断定しないことが入っている", () => {
    for (const s of ["目安", "資料と入手先", "返済予定表は借入先の銀行", "次の一歩", "相談窓口", "よろず支援拠点", "事業承継・引継ぎ支援センター", "日本政策金融公庫の相談窓口", "なぜ専門家か", "聞くことのリスト", "600字程度", "断定しない"]) {
      expect(ADVICE_GUIDE).toContain(s);
    }
    // 講座の検索つき・AI参謀（検索なしのふだんの返事にも）に入る。講座の記事だけのモードは今のまま
    expect(ASK_WEB_SYSTEM_TEMPLATE).toContain(ADVICE_GUIDE);
    expect(ADVISOR_SYSTEM_TEMPLATE).toContain(ADVICE_GUIDE);
    expect(ASK_SYSTEM_TEMPLATE).not.toContain(ADVICE_GUIDE);
    // 1段目の指示文に検索のルールが入る
    expect(WEB_RESEARCH_SYSTEM).toContain(WEB_SEARCH_RULES);
  });
});

// ---- 講座の質問 ----

const ARTICLE_Q = { courseId: "cashflow", articleNo: 1, question: "減価償却費って何ですか？" };
const ASK_OK = { answer: "設備の代金を分けて費用にしたものです。", terms: [{ term: "減価償却費", meaning: "設備の代金を分けた費用" }] };

describe("講座の質問 mode", () => {
  it("mode を省略すると今までどおり（記事だけ・JSON・検索しない・sources なし）", async () => {
    const ai = fakeJsonAi([ASK_OK, ASK_OK]);
    const webAi = fakeWebAi();
    const a = await askAboutArticle({ db, ai, webAi }, DEMO_A, "successor", ARTICLE_Q);
    expect(a).toEqual({ text: ASK_OK.answer, terms: ASK_OK.terms });
    expect(ai.requests).toHaveLength(1);
    expect(webAi.requests).toHaveLength(0);
    const b = await askAboutArticle({ db, ai, webAi }, DEMO_A, "successor", { ...ARTICLE_Q, mode: "article" });
    expect(b).toEqual({ text: ASK_OK.answer, terms: ASK_OK.terms });
    expect(webAi.requests).toHaveLength(0);
    expect(await webCalls()).toBe(0);
  });

  it("mode: web は2段階：1段目は質問だけで検索（記事・お店の概要は渡さない）、2段目で記事と要点を合わせる。予約は2回", async () => {
    const ai = fakeJsonAi([ASK_OK]);
    const webAi = fakeWebAi();
    const a = await askAboutArticle({ db, ai, webAi }, DEMO_A, "successor", { ...ARTICLE_Q, mode: "web" });
    expect(webAi.requests).toHaveLength(1);
    expect(ai.requests).toHaveLength(1);
    expect(await calls()).toBe(2);
    expect(await webCalls()).toBe(1);
    // 1段目
    const s1 = webAi.requests[0].system + JSON.stringify(webAi.requests[0].messages);
    expect(webAi.requests[0].system).toBe(WEB_RESEARCH_SYSTEM);
    expect(s1).toContain("減価償却費って何ですか？");
    expect(s1).toContain("後継者");
    const course = getCourses().find((c) => c.id === "cashflow")!;
    const art = course.articles.find((x) => x.no === 1)!;
    for (const line of art.body) expect(s1).not.toContain(line);
    expect(s1).not.toContain(art.title);
    expect(s1).not.toContain(COMPANY_CONTEXT);
    // 2段目：記事・概要・要点（データ）。検索のツールは使わない
    const s2 = ai.requests[0].system + JSON.stringify(ai.requests[0].messages);
    for (const line of art.body) expect(s2).toContain(line);
    expect(s2).toContain("<public_info>");
    expect(s2).toContain("家賃比率の目安");
    expect(ai.requests[0].system).toContain(ADVICE_GUIDE);
    for (const n of PUBLIC_INFO_NOTES) expect(ai.requests[0].system).toContain(n);
    expect(s2).not.toContain("https://");
    // 返事：2段目の答えと terms、出典は1段目のもの
    expect(a.text).toBe(ASK_OK.answer);
    expect(a.terms).toEqual(ASK_OK.terms);
    expect(a.searched).toBe(true);
    expect(a.sources).toEqual([
      { url: JFC, title: "小企業の経営指標調査", kind: "public" },
      { url: LOGLASS, title: "FL比率とは", kind: "private" },
    ]);
    // 2回の合計の予算は 80 秒（maxDuration 90 秒の中）
    expect(webAi.requests[0].timeoutMs).toBeLessThanOrEqual(WEB_SEARCH_BUDGET_MS);
    expect(ai.requests[0].budgetMs).toBeLessThanOrEqual(WEB_TOTAL_BUDGET_MS);
    expect(WEB_TOTAL_BUDGET_MS).toBeLessThan(90_000);
  });

  it("言い切りに見える表現があれば注記を足す", async () => {
    const webAi = fakeWebAi([{ webSearchRequests: 0, content: [{ type: "text", text: "公的な情報では見つかりませんでした。" }] }]);
    const a = await askAboutArticle({ db, ai: fakeJsonAi([{ answer: "融資が通ります。", terms: [] }]), webAi }, DEMO_A, "successor", {
      ...ARTICLE_Q,
      mode: "web",
    });
    expect(a.caution).toBeTruthy();
    expect(a.searched).toBe(false);
  });

  it("後継者以外は 403（mode: web でも）。mode の値が正しくなければ 400。AI は呼ばない", async () => {
    const ai = fakeJsonAi();
    const webAi = fakeWebAi();
    await expectStatus(askAboutArticle({ db, ai, webAi }, DEMO_A, "predecessor", { ...ARTICLE_Q, mode: "web" }), 403);
    await expectStatus(askAboutArticle({ db, ai, webAi }, DEMO_A, "predecessor", ARTICLE_Q), 403);
    for (const mode of ["WEB", 1, null, true]) {
      await expectStatus(askAboutArticle({ db, ai, webAi }, DEMO_A, "successor", { ...ARTICLE_Q, mode }), 400);
    }
    expect(ai.requests).toHaveLength(0);
    expect(webAi.requests).toHaveLength(0);
    expect(await calls()).toBe(0);
  });
});

// ---- 検索の1日の上限（SEC-202） ----

describe("検索の1日の上限", () => {
  it("既定は 200。上限に達したら 429 で決まった文言。AI は呼ばず、AI の回数も使わない。記事だけの質問は使える", async () => {
    expect(WEB_SEARCH_DAILY_LIMIT_DEFAULT).toBe(200);
    await db.execute({ sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, ?)`, args: [webSearchDayKey(nowIso()), 200] });
    const ai = fakeJsonAi([ASK_OK]);
    const webAi = fakeWebAi();
    const err = await askAboutArticle({ db, ai, webAi }, DEMO_A, "successor", { ...ARTICLE_Q, mode: "web" }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).status).toBe(429);
    expect((err as ServiceError).userMessage).toBe(MSG_WEB_SEARCH_DAILY_LIMIT);
    expect((err as ServiceError).userMessage).toContain("日本時間の朝9時に戻ります");
    expect(webAi.requests).toHaveLength(0);
    expect(await calls()).toBe(0);
    // AI参謀の web も同じ上限
    await expectStatus(sendAdvisorMessage({ db, ai, webAi }, DEMO_A, "successor", "家賃の目安は？", { web: true }), 429);
    expect(webAi.requests).toHaveLength(0);
    // 記事だけは使える
    const a = await askAboutArticle({ db, ai, webAi }, DEMO_A, "successor", ARTICLE_Q);
    expect(a.text).toBe(ASK_OK.answer);
  });

  it("AI_WEB_SEARCH_DAILY_LIMIT で変えられる。日のキーは usageDayKey（日本時間の朝9時）と同じ区切りで、全体の上限とは別に数える", async () => {
    vi.stubEnv("AI_WEB_SEARCH_DAILY_LIMIT", "1");
    try {
      expect(webSearchDailyLimit()).toBe(1);
      await reserveWebSearchCall(db);
      await expectStatus(reserveWebSearchCall(db), 429);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(webSearchDailyLimit()).toBe(200);
    expect(webSearchDayKey("2026-11-03T23:59:00.000Z")).toBe("web:2026-11-03");
    expect(webSearchDayKey("2026-11-04T00:00:00.000Z")).toBe(`web:${usageDayKey("2026-11-04T00:00:00.000Z")}`);
    const rs = await db.execute(`SELECT day FROM ai_usage_daily`);
    expect(rs.rows.map((r) => String(r.day)).every((d) => d.startsWith("web:"))).toBe(true);
  });

  it("再送も検索の回数に数える", async () => {
    const webAi = fakeWebAi(["THROW_TRANSIENT"]);
    await askWithWebSearch({ db, webAi, sleep: async () => {} }, DEMO_A, "successor", {
      purpose: "t",
      system: "s",
      messages: [{ role: "user", content: "q" }],
      maxTokens: 10,
      maxChars: 100,
    });
    expect(webAi.requests).toHaveLength(2);
    expect(await webCalls()).toBe(2);
  });

  it("デモのやり直しでは消えない。古い日付の行だけ保存期間の掃除で消える", async () => {
    await db.execute({ sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 5)`, args: ["web:2020-01-01"] });
    await db.execute({ sql: `INSERT INTO ai_usage_daily (day, calls) VALUES (?, 5)`, args: [webSearchDayKey(nowIso())] });
    await resetDemo(db, DEMO_A, "successor");
    expect(Number((await db.execute(`SELECT COUNT(*) AS n FROM ai_usage_daily`)).rows[0].n)).toBe(2);
    await purgeExpiredDemos(db);
    const rs = await db.execute(`SELECT day FROM ai_usage_daily`);
    expect(rs.rows.map((r) => String(r.day))).toEqual([webSearchDayKey(nowIso())]);
  });
});

// ---- AI参謀 ----

describe("AI参謀 web", () => {
  const OK_ADV = { reply: "ふだんの返事です。", points: ["論点"], consult: "銀行", consult_note: "返済予定表" };
  const send = (ai: JsonAi, webAi: WebSearchAi, role: Role, text: string, web?: unknown) =>
    sendAdvisorMessage({ db, ai, webAi }, DEMO_A, role, text, web === undefined ? {} : { web });

  it("web を省略すると今までどおり（JSON・検索しない・sources なし）", async () => {
    const ai = fakeJsonAi([OK_ADV, OK_ADV]);
    const webAi = fakeWebAi();
    const st = await send(ai, webAi, "successor", "手元資金は？");
    expect(webAi.requests).toHaveLength(0);
    const m = st.messages[1] as Extract<AdvisorMessage, { from: "ai" }>;
    expect(m).toMatchObject({ from: "ai", text: OK_ADV.reply, points: ["論点"], consult: "銀行" });
    expect("sources" in m).toBe(false);
    expect("searched" in m).toBe(false);
    await send(ai, webAi, "successor", "もう一つ", false);
    expect(webAi.requests).toHaveLength(0);
    expect(await calls()).toBe(2);
  });

  it("1段目の入力に、会社名・お店の数字・診断・概要・会話の履歴が入らない。2段目には入る", async () => {
    await putSharedTheme("predecessor");
    await putSharedTheme("successor");
    await runDiagnosis({ db, ai: fakeJsonAi([DIAG]) }, DEMO_A, "predecessor");
    const ai = fakeJsonAi([{ ...OK_ADV, reply: "HISTORY-MARK の返事" }, OK_ADV]);
    const webAi = fakeWebAi();
    await send(ai, webAi, "successor", "HISTORY-MARK の相談");
    await send(ai, webAi, "successor", "飲食店の家賃の目安は？", true);
    expect(webAi.requests).toHaveLength(1);
    const s1 = webAi.requests[0].system + JSON.stringify(webAi.requests[0].messages);
    expect(s1).toContain("飲食店の家賃の目安は？");
    expect(s1).toContain("後継者");
    expect(s1).toContain("Lv1");
    for (const mark of [
      "つぐみ",
      "食事処",
      COMPANY_CONTEXT,
      "5,400",
      "808",
      "2,360",
      "決算書",
      "shop_financials",
      "shop_upside",
      "DIAG-GAP-返済の見え方",
      "<diagnosis>",
      "HISTORY-MARK",
    ]) {
      expect(s1, mark).not.toContain(mark);
    }
    expect(webAi.requests[0].messages).toHaveLength(1);
    // 2段目：お店の数字・診断・履歴・要点（データ）が入り、助言の型と公的情報の注意書きがある
    const req2 = ai.requests[ai.requests.length - 1];
    const s2 = req2.system + JSON.stringify(req2.messages);
    expect(s2).toContain("shop_financials");
    expect(s2).toContain("DIAG-GAP-返済の見え方");
    expect(s2).toContain("HISTORY-MARK");
    expect(s2).toContain("<public_info>");
    expect(req2.system).toContain(ADVICE_GUIDE);
    for (const n of PUBLIC_INFO_NOTES) expect(req2.system).toContain(n);
    expect(s2).not.toContain("https://");
  });

  it("web: true は回数を2回予約し、2段目の論点・相談先と1段目の出典を保存する。履歴にも残る", async () => {
    const ai = fakeJsonAi([OK_ADV]);
    const webAi = fakeWebAi();
    const st = await send(ai, webAi, "successor", "家賃の目安は？", true);
    expect(webAi.requests).toHaveLength(1);
    expect(ai.requests).toHaveLength(1);
    expect(await calls()).toBe(2);
    expect(await webCalls()).toBe(1);
    const m = st.messages[1] as Extract<AdvisorMessage, { from: "ai" }>;
    expect(m).toMatchObject({ text: OK_ADV.reply, points: ["論点"], consult: "銀行", consultNote: "返済予定表", searched: true });
    expect(m.sources).toEqual([
      { url: JFC, title: "小企業の経営指標調査", kind: "public" },
      { url: LOGLASS, title: "FL比率とは", kind: "private" },
    ]);
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages[1]).toEqual(m);
    expect((await getAdvisorStateFrom(db, DEMO_A, "predecessor")).messages).toEqual([]);
  });

  it("1段目が失敗したら 502 で、2段目は呼ばず、本人の発言も保存しない", async () => {
    const ai = fakeJsonAi([OK_ADV]);
    const webAi = fakeWebAi(["THROW"]);
    await expectStatus(send(ai, webAi, "successor", "家賃の目安は？", true), 502);
    expect(ai.requests).toHaveLength(0);
    expect((await getAdvisorStateFrom(db, DEMO_A, "successor")).messages).toEqual([]);
  });

  it("履歴の区切り：検索つきの返事は前に区切りを付け、URL を除き 600 字で切る。出典は入れない", async () => {
    const long = "あ".repeat(700);
    const ai = fakeJsonAi([{ ...OK_ADV, reply: `詳しくは ${MHLW} を。${long}` }, OK_ADV, OK_ADV]);
    const webAi = fakeWebAi();
    await send(ai, webAi, "successor", "家賃の目安は？", true);
    await send(ai, webAi, "successor", "では次に何を？"); // ふだんの相談
    await send(ai, webAi, "successor", "もう一度調べて", true); // 検索つき
    for (const req of [ai.requests[1], ai.requests[2]]) {
      const assistant = req.messages.find((x) => x.role === "assistant")!;
      const reply = (JSON.parse(assistant.content) as { reply: string }).reply;
      expect(reply.startsWith(ADVISOR_WEB_HISTORY_PREFIX)).toBe(true);
      expect(Array.from(reply.slice(ADVISOR_WEB_HISTORY_PREFIX.length)).length).toBeLessThanOrEqual(600);
      const t = JSON.stringify(req.messages);
      for (const d of ["jfc.go.jp", "loglass.jp", "mhlw.go.jp", "https://"]) expect(t).not.toContain(d);
    }
    // 1段目には履歴を渡さない
    expect(webAi.requests[1].messages).toHaveLength(1);
    // 検索なしの返事には区切りを付けない
    const plainAssistant = ai.requests[2].messages.filter((x) => x.role === "assistant")[1];
    expect(plainAssistant.content).not.toContain(ADVISOR_WEB_HISTORY_PREFIX);
    expect(webReplyForHistory(`a ${JFC} b`)).toBe(`${ADVISOR_WEB_HISTORY_PREFIX}a b`);
    expect(stripUrls(`a ${JFC} b`)).toBe("a b");
  });

  it("web の値が真偽値でなければ 400（AI は呼ばない）。先代も使える", async () => {
    const ai = fakeJsonAi([OK_ADV]);
    const webAi = fakeWebAi();
    await expectStatus(send(ai, webAi, "successor", "x", "true"), 400);
    await expectStatus(send(ai, webAi, "successor", "x", 1), 400);
    expect(webAi.requests).toHaveLength(0);
    await send(ai, webAi, "predecessor", "家賃の目安は？", true);
    expect(webAi.requests).toHaveLength(1);
    expect(JSON.stringify(webAi.requests[0].messages)).toContain("先代");
  });

  it("buildAdvisorRequest：publicInfo があるときだけ <public_info> と注意書きが入る。出力はいつも JSON", () => {
    const research = { summary: "要点", sources: [], searched: false };
    const req = buildAdvisorRequest({ role: "successor", history: [], text: "x", diagnosis: null, publicInfo: research });
    expect(req.system).toContain("<public_info>");
    expect(req.system).toContain("必ずこのJSONだけを返す");
    const plain = buildAdvisorRequest({ role: "successor", history: [], text: "x", diagnosis: null });
    expect(plain.system).not.toContain("<public_info>");
    expect(plain.system).toContain(ADVICE_GUIDE);
  });
});
