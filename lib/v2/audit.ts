// 操作の記録（監査ログ）。
// 残すのは「いつ・誰が・どの種類の操作を・成功したか」だけ。
// 面談の回答、資料の文章、合言葉などの本文は、ここに渡さないし、残さない。

export type AuditOutcome = "ok" | "denied" | "rejected" | "error";

export type AuditEntry = {
  at: string;
  tenantId: string | null;
  userId: string | null;
  /** 操作の種類（決まった名前のどれか。知らない操作は "unknown"） */
  action: string;
  outcome: AuditOutcome;
  /** 断った・失敗したときの、決まった種類名（文章ではない） */
  code?: string;
};

export type AuditLog = {
  record(entry: AuditEntry): void;
  list(): AuditEntry[];
};

/** メモリの中の記録（手元の試作・検証用）。上限を超えたら古いものから消す */
export function createAuditLog(max = 1000): AuditLog {
  const entries: AuditEntry[] = [];
  return {
    record(entry) {
      entries.push({ ...entry });
      if (entries.length > max) entries.splice(0, entries.length - max);
    },
    list() {
      return entries.map((e) => ({ ...e }));
    },
  };
}
