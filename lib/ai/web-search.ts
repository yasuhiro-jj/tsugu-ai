import "server-only";

// Claude API のサーバー側ツール「ウェブ検索」を使って、公的な情報源だけを根拠に答える共通処理。
// 講座の質問（lib/learning-ask.ts の mode: "web"）と AI参謀（lib/advisor.ts の web: true）で使う。
//
// 守ること：
// - 検索先は WEB_SEARCH_ALLOWED_DOMAINS の11件だけ（公的機関6件＋民間サービス5件。サブドメインを含む）。別の検索サービスは使わない
// - 回数の予約・再送は lib/ai/retry.ts の callAiWithRetry（reserveAiCall を必ず通す。1回の質問で1回と数える。
//   再送したときは再送の分も数える）。Claude 側の検索の回数は max_uses（3回）まで
// - 構造化出力（output_config.format）は citations と同時に使えないので使わない。返事は普通の文章で受け取る
// - 出典の URL は、許可した11件のドメインの https のものだけを返し、kind（public／private）を付ける（念のための絞り込み）
// - 入力本文・AI の返事・検索結果・SDK のエラー本文はログに出さない（種類・件数だけ）
// - テストでは WebSearchAi を偽物に差し替える（本物の API は scripts/check-web-search.mjs の1回だけ）

import type { Client } from "@libsql/client";
import type { Role } from "../role";
import { getClaudeClient } from "../claude";
import { getClaudeModel } from "../config";
import { callAiWithRetry, realSleep } from "./retry";
import { MSG_AI_FAILED, type AiDeps, type JsonAiMessage } from "./json-ai";
import { charLen } from "../util";
import { WEB_SEARCH_ALLOWED_DOMAINS, sourceKindOf, type WebSourceKind } from "../web-search-domains";
import { reserveWebSearchCall } from "./usage";
import { WEB_RESEARCH_SYSTEM } from "../prompts/web-search";
import { dataBlock } from "./json-ai";
import { ServiceError } from "../errors";
import type { CompanySettings } from "../settings-types";
import { generalizeForSearch, MSG_SEARCH_QUERY_EMPTY, SEARCH_QUERY_NOTE } from "./search-query";

// 検索先の一覧と出典の判定は、画面からも使えるように lib/web-search-domains.ts に置く（SEC-203）
export {
  WEB_SEARCH_ALLOWED_DOMAINS,
  WEB_SEARCH_PRIVATE_DOMAINS,
  WEB_SEARCH_PUBLIC_DOMAINS,
  isAllowedSourceUrl,
  sourceKindOf,
  type WebSourceKind,
} from "../web-search-domains";

/** 1回の質問で Claude が検索してよい回数 */
export const WEB_SEARCH_MAX_USES = 3;
export const WEB_SEARCH_TOOL_TYPE = "web_search_20260209";

/**
 * 検索つきの相談・質問は2段階（SEC-201）：1段目＝検索（質問・立場・知識レベルだけ）、2段目＝検索なしのふだんの呼び出し。
 * 2回の合計を Route の maxDuration 90 秒に収める（DB の読み書きの分として 10 秒残す。SEC-105）。
 * 1段目を優先して 50 秒。2段目は「合計 80 秒 − 1段目にかかった時間」（最短でも 30 秒残る）
 */
export const WEB_TOTAL_BUDGET_MS = 80_000;
/** 1段目（検索つき）に使ってよい時間（再送を含む） */
export const WEB_SEARCH_BUDGET_MS = 50_000;
/** 1段目の1回の呼び出しの待ち時間の上限 */
export const WEB_SEARCH_CALL_TIMEOUT_MS = 50_000;
/** 1段目の要点の文字数の上限・出力トークンの上限 */
export const WEB_RESEARCH_MAX_CHARS = 1200;
export const WEB_RESEARCH_MAX_TOKENS = 1500;

/** 返す出典の上限・タイトルの長さの上限 */
export const WEB_SOURCES_MAX = 8;
const TITLE_MAX = 120;
const CITED_TEXT_MAX = 300;

export type WebSource = { url: string; title: string; kind: WebSourceKind; citedText?: string };
/** 画面へ返す出典の形 */
export type PublicWebSource = { url: string; title: string; kind: WebSourceKind };

/** ウェブ検索ツールの定義（allowed_domains は上の11件だけ） */
export function webSearchTool() {
  return {
    type: WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    max_uses: WEB_SEARCH_MAX_USES,
    allowed_domains: [...WEB_SEARCH_ALLOWED_DOMAINS],
  } as const;
}

// ---- AI の呼び出し（差し替え可能） ----

export type WebSearchAiRequest = {
  /** ログ用の名前（例 learning_ask_web） */
  purpose: string;
  system: string;
  messages: JsonAiMessage[];
  maxTokens: number;
  /** この1回の呼び出しの待ち時間の上限（askWithWebSearch が残り時間から設定する） */
  timeoutMs?: number;
};

/** 返事の生の形：応答の content ブロック（SDK の形のまま）と、検索の実行回数 */
export type WebSearchRaw = { content: unknown[]; webSearchRequests: number; stopReason?: string | null };

export type WebSearchAi = (req: WebSearchAiRequest) => Promise<WebSearchRaw>;

/** 本番の実装（Claude API・ウェブ検索ツールつき）。テストでは使わない */
export const claudeWebSearchAi: WebSearchAi = async (req) => {
  const client = getClaudeClient();
  const message = await client.messages.create(
    {
      model: getClaudeModel(),
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      tools: [webSearchTool() as unknown as { type: "web_search_20260209"; name: "web_search" }],
    },
    { timeout: Math.min(req.timeoutMs ?? WEB_SEARCH_CALL_TIMEOUT_MS, WEB_SEARCH_CALL_TIMEOUT_MS) },
  );
  return {
    content: message.content as unknown[],
    webSearchRequests: message.usage?.server_tool_use?.web_search_requests ?? 0,
    stopReason: message.stop_reason,
  };
};

export type WebAiDeps = AiDeps & { webAi?: WebSearchAi };

// ---- 出典の集め方 ----

function cut(s: string, max: number): string {
  return Array.from(s.trim()).slice(0, max).join("");
}

/** 保存した出典などを読み直す：形の正しい・許可したドメインのものだけを {url, title, kind} にして返す */
export function sanitizeSources(v: unknown): PublicWebSource[] {
  if (!Array.isArray(v)) return [];
  const out: PublicWebSource[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (x === null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const kind = sourceKindOf(o.url);
    if (kind === null || typeof o.url !== "string" || seen.has(o.url)) continue;
    seen.add(o.url);
    // kind は保存された値を信じず、URL から判定し直す
    out.push({ url: o.url, title: typeof o.title === "string" && o.title.trim() ? cut(o.title, TITLE_MAX) : o.url, kind });
    if (out.length >= WEB_SOURCES_MAX) break;
  }
  return out;
}

export type CollectedWebAnswer = {
  text: string;
  sources: WebSource[];
  /** 検索が実行され、結果を受け取れたか */
  searched: boolean;
  /** 検索結果のエラーの種類（error_code。ログ用） */
  errorCodes: string[];
};

/**
 * 応答の content から、本文・出典・検索したかを取り出す。
 * - 出典は text ブロックの citations（web_search_result_location）を先に、次に web_search_tool_result の結果を、URL で重複なしに集める
 * - web_search_tool_result の content はエラーのとき配列ではなく {type: "web_search_tool_result_error", error_code} になる
 * - 本文は、最後の検索結果より後ろの text ブロックをつなげたもの（「調べてみます」などの前置きを除く）。後ろに無ければすべての text
 */
export function collectWebAnswer(raw: WebSearchRaw): CollectedWebAnswer {
  const blocks = Array.isArray(raw.content) ? raw.content : [];
  type Candidate = Omit<WebSource, "kind">;
  const cited: Candidate[] = [];
  const found: Candidate[] = [];
  const errorCodes: string[] = [];
  let searched = false;
  let lastResultIndex = -1;

  blocks.forEach((b, i) => {
    if (b === null || typeof b !== "object") return;
    const block = b as Record<string, unknown>;
    if (block.type === "web_search_tool_result") {
      lastResultIndex = i;
      if (Array.isArray(block.content)) {
        searched = true;
        for (const r of block.content) {
          if (r === null || typeof r !== "object") continue;
          const o = r as Record<string, unknown>;
          if (o.type !== "web_search_result") continue;
          found.push({ url: String(o.url ?? ""), title: typeof o.title === "string" ? o.title : "" });
        }
      } else {
        const e = block.content as Record<string, unknown> | null;
        errorCodes.push(e && typeof e.error_code === "string" ? e.error_code : "unknown");
      }
    } else if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c === null || typeof c !== "object") continue;
        const o = c as Record<string, unknown>;
        if (o.type !== "web_search_result_location") continue;
        cited.push({
          url: String(o.url ?? ""),
          title: typeof o.title === "string" ? o.title : "",
          ...(typeof o.cited_text === "string" && o.cited_text ? { citedText: cut(o.cited_text, CITED_TEXT_MAX) } : {}),
        });
      }
    }
  });

  const sources: WebSource[] = [];
  const seen = new Set<string>();
  for (const s of [...cited, ...found]) {
    const kind = sourceKindOf(s.url);
    // どちらの一覧にも当てはまらない出典は捨てる
    if (kind === null || seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push({ ...s, title: s.title.trim() ? cut(s.title, TITLE_MAX) : s.url, kind });
    if (sources.length >= WEB_SOURCES_MAX) break;
  }

  const texts = (from: number) =>
    blocks
      .slice(from)
      .filter((b): b is { type: "text"; text: string } => {
        const o = b as Record<string, unknown> | null;
        return !!o && o.type === "text" && typeof o.text === "string";
      })
      .map((b) => b.text)
      .join("")
      .trim();
  const text = texts(lastResultIndex + 1) || texts(0);

  if (raw.webSearchRequests > 0 && !searched && errorCodes.length === 0) searched = true;
  return { text, sources, searched, errorCodes };
}

// ---- 本体 ----

export type WebSearchQuestion = {
  /** ログ用の名前 */
  purpose: string;
  system: string;
  messages: JsonAiMessage[];
  maxTokens: number;
  /** 本文の文字数の上限（超えたら切る） */
  maxChars: number;
  /** 時間の予算（省略時は WEB_SEARCH_BUDGET_MS） */
  budgetMs?: number;
};

export type WebSearchAnswer = { text: string; sources: WebSource[]; searched: boolean };

/**
 * ウェブ検索つきで1回質問する。回数の予約・再送は callAiWithRetry（1回の質問で1回。再送の分も数える）。
 * 検索だけの1日の上限（reserveWebSearchCall。SEC-202）も試すたびに予約する。最初の分は AI の回数を予約する前に確かめる
 * （上限のときに AI の回数を使わないため）。本文が空なら壊れた返事として1回だけ再送。だめなら 502。
 */
export async function askWithWebSearch(
  deps: { db: Client; webAi: WebSearchAi; now?: () => number; sleep?: (ms: number) => Promise<void> },
  demoId: string,
  role: Role,
  q: WebSearchQuestion,
): Promise<WebSearchAnswer> {
  // 検索の1日の上限（上限なら 429 で、AI の回数は予約しない）
  await reserveWebSearchCall(deps.db);
  let attempts = 0;
  const collected = await callAiWithRetry<CollectedWebAnswer>({
    db: deps.db,
    demoId,
    role,
    where: `${q.purpose}.ai`,
    budgetMs: q.budgetMs ?? WEB_SEARCH_BUDGET_MS,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? realSleep,
    // callAiWithRetry は文字列を受け取るので、生の content を JSON にして渡す（parse で読み戻す）
    call: async (timeoutMs) => {
      // 再送も検索の回数に数える（429 の ServiceError は callAiWithRetry がそのまま投げる）
      if (attempts++ > 0) await reserveWebSearchCall(deps.db);
      return JSON.stringify(
        await deps.webAi({ purpose: q.purpose, system: q.system, messages: q.messages, maxTokens: q.maxTokens, timeoutMs }),
      );
    },
    parse: (s) => {
      let raw: WebSearchRaw;
      try {
        raw = JSON.parse(s) as WebSearchRaw;
      } catch {
        return null;
      }
      const c = collectWebAnswer(raw);
      return c.text ? c : null;
    },
    failMessage: MSG_AI_FAILED,
  });
  // ログは件数と種類だけ（本文・URL は出さない）
  console.info(
    JSON.stringify({
      level: "info",
      where: `${q.purpose}.ai`,
      event: "web_search",
      searched: collected.searched,
      sources: collected.sources.length,
      errors: collected.errorCodes,
    }),
  );
  const text = charLen(collected.text) > q.maxChars ? Array.from(collected.text).slice(0, q.maxChars).join("") : collected.text;
  return { text, sources: collected.sources, searched: collected.searched };
}

/** 画面へ返す出典の形（引用の文は返さない） */
export function publicSources(sources: readonly WebSource[]): PublicWebSource[] {
  return sources.map((s) => ({ url: s.url, title: s.title, kind: s.kind }));
}

// ---- 1段目：公的情報の調査（SEC-201） ----

export type PublicInfoResearch = {
  /** 公的情報の要点（AI がまとめた本文。2段目へはデータとして渡す） */
  summary: string;
  sources: WebSource[];
  searched: boolean;
  /** 検索の言葉を一般化した（会社名・名前・金額などを伏せた）ときだけ：SEARCH_QUERY_NOTE */
  searchQueryNote?: string;
};

/**
 * 1段目：検索つきの呼び出し。AI に渡すのは「本人の質問」「本人の立場（先代／後継者）」「知識レベル」だけ。
 * 会社名・お店の数字・診断・会社の概要・会話の履歴・講座の記事は渡さない（外部ページの指示でそれらが検索の言葉に入らないように）。
 * 本人の質問も generalizeForSearch で一般化してから渡す（質問に書かれた会社名・名前・金額・連絡先を検索の言葉に混ぜない）。
 * 一般化して何も残らなければ、AI も検索の回数も使わずに 400
 */
export async function researchPublicInfo(
  deps: { db: Client; webAi: WebSearchAi; now?: () => number; sleep?: (ms: number) => Promise<void> },
  demoId: string,
  role: Role,
  p: { purpose: string; question: string; roleLabel: string; level: string; settings: CompanySettings },
): Promise<PublicInfoResearch> {
  const g = generalizeForSearch(p.question, p.settings);
  if (!g) throw new ServiceError(400, MSG_SEARCH_QUERY_EMPTY);
  const user = [
    `相談する人の立場：${p.roleLabel}`,
    `数字や経営の知識レベル：${p.level}`,
    "次の質問に関係する公的な情報を検索し、要点をまとめてください。",
    dataBlock("question", g.query),
  ].join("\n\n");
  const r = await askWithWebSearch(deps, demoId, role, {
    purpose: p.purpose,
    system: WEB_RESEARCH_SYSTEM,
    messages: [{ role: "user", content: user }],
    maxTokens: WEB_RESEARCH_MAX_TOKENS,
    maxChars: WEB_RESEARCH_MAX_CHARS,
    budgetMs: WEB_SEARCH_BUDGET_MS,
  });
  return { summary: r.text, sources: r.sources, searched: r.searched, ...(g.changed ? { searchQueryNote: SEARCH_QUERY_NOTE } : {}) };
}

/** 2段目に使ってよい時間：合計の予算から1段目にかかった時間を引いた残り */
export function secondStageBudget(startedAt: number, now: () => number): number {
  return Math.max(0, WEB_TOTAL_BUDGET_MS - (now() - startedAt));
}

/** 2段目に渡す、1段目の結果（要点と出典名。URL は渡さない） */
export function publicInfoForPrompt(r: PublicInfoResearch) {
  return {
    検索できたか: r.searched ? "はい" : "いいえ",
    要点: r.summary,
    出典: r.sources.map((s) => `${s.title}（${s.kind === "public" ? "公的機関" : "民間サービス"}）`),
  };
}
