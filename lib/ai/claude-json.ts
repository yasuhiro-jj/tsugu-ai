import "server-only";

// JsonAi の本番実装（Claude API・構造化出力）。テストでは使わない。
// - モデル名は lib/config.ts の getClaudeModel() から取る
// - 再試行は SDK ではなく callJsonAi 側（lib/ai/retry.ts）で「壊れた返事のとき1回」「一時的な失敗のとき1回」。
//   SDK 側は lib/claude.ts で maxRetries: 0（SDK の再試行は回数の予約を通らないため使わない）
// - 入力本文・SDK のエラー本文はログにも応答にも出さない

import { getClaudeClient } from "../claude";
import { getClaudeModel } from "../config";
import type { JsonAi, JsonAiRequest } from "./json-ai";

/** 1回の呼び出しの待ち時間の上限の既定値（通常は callJsonAi が残り時間から timeoutMs を渡す） */
export const JSON_AI_TIMEOUT_MS = 100_000;

export const claudeJsonAi: JsonAi = async (req: JsonAiRequest) => {
  const client = getClaudeClient();
  const message = await client.messages.create(
    {
      model: getClaudeModel(),
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages,
      output_config: { format: { type: "json_schema", schema: req.schema } },
    },
    { timeout: Math.min(req.timeoutMs ?? JSON_AI_TIMEOUT_MS, JSON_AI_TIMEOUT_MS) },
  );
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
};
