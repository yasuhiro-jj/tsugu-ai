import "server-only";

// サーバー専用。クライアントコンポーネントから import しない（API キーを扱うため）。
// キーの値はログ・エラー文・レスポンスに一切含めないこと。

import Anthropic from "@anthropic-ai/sdk";

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super(
      "Claude API キーが設定されていません。.env.local（ローカル）または Vercel の環境変数に ANTHROPIC_API_KEY を設定してください。",
    );
    this.name = "ClaudeNotConfiguredError";
  }
}

let client: Anthropic | null = null;

/** キーが設定済みかどうかだけを返す（値は返さない）。 */
export function isClaudeKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/** Anthropic クライアントを遅延生成して返す。キー未設定なら ClaudeNotConfiguredError。 */
export function getClaudeClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ClaudeNotConfiguredError();
  // SDK の自動再試行は使わない（maxRetries: 0）。再送は lib/ai/retry.ts が回数を予約したうえで行う
  // （一時的な失敗のときだけ1回）。1回あたり最大 60 秒
  client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 });
  return client;
}
