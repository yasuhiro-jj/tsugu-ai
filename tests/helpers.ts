// テスト用の道具：メモリ上の libSQL と、偽の AI（Claude は呼ばない）。

import { createClient, type Client } from "@libsql/client";
import { applySchema } from "@/lib/db";
import type { AiRequest, InterviewAi } from "@/lib/interview/service";

export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await applySchema(db);
  return db;
}

export type FakeAi = InterviewAi & { requests: AiRequest[]; queue: string[] };

/** 返事を順番に返す偽の AI。queue が空なら followup の返事を返す。送られた依頼は requests に記録。 */
export function createFakeAi(queue: string[] = []): FakeAi {
  const requests: AiRequest[] = [];
  const fn = (async (req: AiRequest) => {
    requests.push(structuredClone(req));
    return (
      fn.queue.shift() ??
      aiJson({ reply: "なるほど、もう少し教えていただけますか？", action: "followup" })
    );
  }) as FakeAi;
  fn.requests = requests;
  fn.queue = queue;
  return fn;
}

export function aiJson(o: {
  reply: string;
  action: "followup" | "summarize" | "next_theme" | "finish";
  summary?: { statements?: string[]; ai_observations?: string[]; unconfirmed?: string[] };
}): string {
  return JSON.stringify({
    reply: o.reply,
    theme: "テスト",
    action: o.action,
    summary: {
      statements: o.summary?.statements ?? [],
      ai_observations: o.summary?.ai_observations ?? [],
      unconfirmed: o.summary?.unconfirmed ?? [],
    },
  });
}

export const DEMO_A = "A".repeat(43);
export const DEMO_B = "B".repeat(43);
