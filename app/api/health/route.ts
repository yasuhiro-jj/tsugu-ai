// 稼働確認 API。
// Claude API は呼ばない（公開 URL から誰でも叩けるため、課金を発生させない）。
// キーの値・長さ・先頭文字などは一切返さない。設定有無の真偽値のみ。

import { NextResponse } from "next/server";
import { isClaudeKeyConfigured } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    claudeKeyConfigured: isClaudeKeyConfigured(),
  });
}
