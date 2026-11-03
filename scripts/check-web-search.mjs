// ローカル専用：Claude API のウェブ検索（サーバー側ツール）の疎通確認。
// 実行: node --env-file=.env.local scripts/check-web-search.mjs
// Claude API を1回だけ呼ぶ（トークン代とウェブ検索の利用料が発生する）。
// 表示するのは「検索が実行されたか」「出典の URL」「エラーの種類」だけ。API キーの値・返事の本文は表示しない。
//
// 検索先は lib/web-search-domains.ts の WEB_SEARCH_PUBLIC_DOMAINS＋WEB_SEARCH_PRIVATE_DOMAINS（.mjs から .ts を import できないため、文字列として読む）。
// 注：2026-11-03 の実行は公的機関6件の時点で行った（民間5件の追加は実行のあと）。

import { readFileSync } from "node:fs";
import Anthropic, { APIError } from "@anthropic-ai/sdk";

function readFromTs(path, re, label) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  const m = src.match(re);
  if (!m) {
    console.error(`${path} から ${label} を読めませんでした`);
    process.exit(1);
  }
  return m[1];
}

const defaultModel = readFromTs("../lib/config.ts", /export const DEFAULT_CLAUDE_MODEL\s*=\s*"([^"]+)"/, "DEFAULT_CLAUDE_MODEL");
const allowedDomains = ["WEB_SEARCH_PUBLIC_DOMAINS", "WEB_SEARCH_PRIVATE_DOMAINS"].flatMap((name) => {
  const src = readFromTs("../lib/web-search-domains.ts", new RegExp(String.raw`export const ${name}[^=]*=\s*\[([\s\S]*?)\]`), name);
  return [...src.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
});

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const model = process.env.CLAUDE_MODEL?.trim() || defaultModel;
if (!apiKey) {
  console.error(".env.local に ANTHROPIC_API_KEY を入力してください");
  process.exit(1);
}

const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 90_000 });

try {
  const message = await client.messages.create({
    model,
    max_tokens: 1024,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: allowedDomains }],
    messages: [
      {
        role: "user",
        content: "中小企業の飲食店の家賃比率（売上に対する家賃の割合）の目安を、公的な情報源で調べて2文で教えてください。",
      },
    ],
  });

  const urls = new Set();
  const errors = [];
  for (const b of message.content) {
    if (b.type === "web_search_tool_result") {
      if (Array.isArray(b.content)) for (const r of b.content) urls.add(r.url);
      else errors.push(b.content?.error_code ?? "unknown");
    }
    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) if (c.type === "web_search_result_location") urls.add(c.url);
    }
  }
  const requests = message.usage?.server_tool_use?.web_search_requests ?? 0;
  console.log("接続成功");
  console.log(`モデル: ${message.model}`);
  console.log(`停止理由: ${message.stop_reason}`);
  console.log(`検索の実行回数: ${requests}`);
  console.log(`検索結果のエラー: ${errors.length ? errors.join(", ") : "なし"}`);
  console.log(`出典の数: ${urls.size}`);
  for (const u of [...urls].slice(0, 8)) console.log(`  ${u}`);
  console.log(`使用トークン: 入力 ${message.usage.input_tokens} / 出力 ${message.usage.output_tokens}`);
} catch (err) {
  // エラー本文はリクエスト情報を含み得るが、組織設定の文言は報告に必要なため、API のエラー種別と message だけを表示する
  const name = err instanceof Error ? err.constructor?.name || err.name : "UnknownError";
  const status = err instanceof APIError && err.status !== undefined ? err.status : "なし";
  console.error("接続失敗");
  console.error(`エラーの種類: ${name}`);
  console.error(`ステータス: ${status}`);
  if (err instanceof APIError) {
    const e = err.error?.error;
    if (e?.type) console.error(`API のエラー種別: ${e.type}`);
    if (typeof e?.message === "string") console.error(`API の文言: ${e.message.replaceAll(apiKey, "***")}`);
  }
  process.exit(1);
}
