// ローカル専用の Claude API 疎通確認スクリプト。
// 実行: npm run check:claude（.env.local を node --env-file で読み込む）
// Claude API を1回だけ呼ぶ（少額の利用料が発生する）。
// API キーの値は絶対に表示しない。

import Anthropic, { APIError } from "@anthropic-ai/sdk";

// lib/config.ts の DEFAULT_CLAUDE_MODEL と同じ値（.mjs から .ts を直接 import できないため）。
const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
const model = process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;

if (!apiKey) {
  console.error(".env.local に ANTHROPIC_API_KEY を入力してください");
  process.exit(1);
}

const client = new Anthropic({ apiKey, maxRetries: 0 });

try {
  const message = await client.messages.create({
    model,
    max_tokens: 50,
    messages: [
      { role: "user", content: "接続確認です。『OK』とだけ返してください" },
    ],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  console.log("接続成功");
  console.log(`モデル: ${message.model}`);
  console.log(`返答: ${text}`);
  console.log(
    `使用トークン: 入力 ${message.usage.input_tokens} / 出力 ${message.usage.output_tokens}`,
  );
} catch (err) {
  // エラー本文はリクエスト情報を含み得るため、種類とステータスだけを表示する。
  const name = err instanceof Error ? err.name : "UnknownError";
  const status =
    err instanceof APIError && err.status !== undefined
      ? err.status
      : "なし";
  console.error("接続失敗");
  console.error(`エラーの種類: ${name}`);
  console.error(`ステータス: ${status}`);
  process.exit(1);
}
