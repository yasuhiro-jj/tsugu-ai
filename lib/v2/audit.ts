// 操作の記録（監査ログ）。
// 残すのは「いつ・誰が・どの種類の操作を・成功したか」だけ。
// 面談の回答、資料の文章、合言葉などの本文は、ここに渡さないし、残さない。
// userId・tenantId には、名前やメールアドレスではなく、意味を持たない ID を使う。

import type { Action } from "./dispatch";

export type AuditOutcome = "ok" | "denied" | "rejected" | "error";

/** 記録する操作の種類。決まった名前だけ（利用者が送ってきた文字列は入れない） */
export type AuditAction = Action | "view" | "unknown";

export type AuditEntry = {
  at: string;
  tenantId: string | null;
  userId: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  /** 断った・失敗したときの、決まった種類名（文章ではない） */
  code?: string;
};

export type AuditLog = {
  record(entry: AuditEntry): void;
  list(): AuditEntry[];
};

/**
 * メモリの中の記録（手元の試作・検証用）。上限を超えたら古いものから消す。
 * 「断った」記録は別枠で持つ：成功した操作を大量に重ねても、断った記録が押し出されないように。
 */
export function createAuditLog(max = 1000): AuditLog {
  let seq = 0;
  const normal: { seq: number; entry: AuditEntry }[] = [];
  const denied: { seq: number; entry: AuditEntry }[] = [];
  return {
    record(entry) {
      const bucket = entry.outcome === "denied" ? denied : normal;
      bucket.push({ seq: seq++, entry: { ...entry } });
      if (bucket.length > max) bucket.splice(0, bucket.length - max);
    },
    list() {
      return [...normal, ...denied].sort((a, b) => a.seq - b.seq).map((x) => ({ ...x.entry }));
    },
  };
}
