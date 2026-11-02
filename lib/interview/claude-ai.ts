import "server-only";

// 面談 AI の本番実装（Claude API）。テストでは使わない（service.ts の InterviewAi を偽物に差し替える）。
// - モデル名は lib/config.ts の getClaudeModel() から取る
// - 構造化出力（output_config.format の JSON スキーマ）で JSON を強制する。最終的な形の確認は service.ts の parseAiOutput
// - SDK のエラー本文・入力本文はログにも応答にも出さない（service.ts 側で種類とステータスだけ記録）

import { getClaudeClient } from "../claude";
import { getClaudeModel } from "../config";
import type { AiRequest, InterviewAi } from "./service";

export const INTERVIEW_MAX_TOKENS = 1500;

const stringArray = { type: "array", items: { type: "string" } } as const;

export const INTERVIEW_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    theme: { type: "string" },
    action: { type: "string", enum: ["followup", "summarize", "next_theme", "finish"] },
    summary: {
      type: "object",
      properties: {
        statements: stringArray,
        ai_observations: stringArray,
        unconfirmed: stringArray,
      },
      required: ["statements", "ai_observations", "unconfirmed"],
      additionalProperties: false,
    },
  },
  required: ["reply", "theme", "action", "summary"],
  additionalProperties: false,
} as const;

export const claudeInterviewAi: InterviewAi = async (req: AiRequest) => {
  const client = getClaudeClient();
  const message = await client.messages.create({
    model: getClaudeModel(),
    max_tokens: INTERVIEW_MAX_TOKENS,
    system: req.system,
    messages: req.messages,
    output_config: {
      format: { type: "json_schema", schema: INTERVIEW_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
  });
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
};
