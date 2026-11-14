// 面談の保存先：Turso（libSQL）用。会社ごとに、データベースそのものを分ける。
//
// いまの状態：部品として用意し、手元の中だけで動くデータベースで検証しただけ。
// **まだ、どこからも使っていない。** 手元の試作はメモリ保存のまま（lib/v2/runtime.ts）。
// 本物の Turso につなぐには、2.0 専用のデータベースと鍵をオーナーが用意する必要がある。
// ハッカソン版のデータベースと鍵は、絶対に使わない。
//
// 守っていること
// - 会社ごとに別のデータベースを使う（どのデータベースを使うかは、権限確認を通った会社の ID からだけ決まる）
// - 保存するときに、持ち主の記録が置き場所と合っているかを確かめる（合わなければ保存しない）
// - 読んだあとで、ほかの操作が先に保存していたら、上書きしない（版の番号で気づく）
// - SQL は、値を文字として埋め込まず、必ず引数で渡す
//
// まだやっていないこと：保存期間と削除の期限、バックアップからの復元時の消去のやり直し、暗号化の鍵の管理。

import type { Client } from "@libsql/client";
import { StoreConflictError, type V2Store } from "./store";
import type { Session } from "./types";

type Awaitable<T> = T | Promise<T>;

/** 会社の ID から、その会社のデータベースへの接続を返す */
export type TenantDb = (tenantId: string) => Awaitable<Client>;

const SCHEMA = `CREATE TABLE IF NOT EXISTS v2_interviews (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
)`;

/** 置き場所の名前（lib/v2/access.ts の interviewKey が作る形）を、会社と本人の ID に戻す */
function parseKey(id: string): { tenantId: string; userId: string } {
  const parts = id.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") throw new Error("bad interview key");
  let tenantId: string;
  let userId: string;
  try {
    tenantId = decodeURIComponent(parts[0]);
    userId = decodeURIComponent(parts[1]);
  } catch {
    throw new Error("bad interview key");
  }
  // 変換し直して同じ形に戻らない名前は受け付けない（別の人の置き場所と取り違えないように）
  if (`${encodeURIComponent(tenantId)}/${encodeURIComponent(userId)}` !== id) throw new Error("bad interview key");
  return { tenantId, userId };
}

export function createLibsqlStore(dbFor: TenantDb): V2Store {
  const ready = new WeakSet<Client>();
  const seen = new Set<Client>();

  async function open(tenantId: string): Promise<Client> {
    const db = await dbFor(tenantId);
    if (!ready.has(db)) {
      await db.execute(SCHEMA);
      ready.add(db);
      seen.add(db);
    }
    return db;
  }

  return {
    async get(id) {
      const { tenantId, userId } = parseKey(id);
      const db = await open(tenantId);
      const result = await db.execute({
        sql: "SELECT rev, data FROM v2_interviews WHERE tenant_id = ? AND user_id = ?",
        args: [tenantId, userId],
      });
      const row = result.rows[0];
      if (!row) return null;
      const data = JSON.parse(String(row.data)) as Omit<Session, "id" | "rev">;
      return { ...data, id, rev: Number(row.rev) };
    },

    async put(session) {
      const { tenantId, userId } = parseKey(session.id);
      // 持ち主の記録がない・置き場所と合わない面談は、保存しない
      if (session.owner?.tenantId !== tenantId || session.owner?.userId !== userId) {
        throw new Error("owner does not match interview key");
      }
      const db = await open(tenantId);
      const { id: _id, rev, ...data } = session;
      const json = JSON.stringify(data);

      if (rev === undefined) {
        // 新しく作る。すでにあれば、ほかの操作が先に作っている
        const result = await db.execute({
          sql: `INSERT INTO v2_interviews (tenant_id, user_id, rev, data, updated_at) VALUES (?, ?, 1, ?, ?)
                ON CONFLICT (tenant_id, user_id) DO NOTHING`,
          args: [tenantId, userId, json, session.updatedAt],
        });
        if (result.rowsAffected !== 1) throw new StoreConflictError();
        return;
      }
      // 読んだときの版のままなら更新する。変わっていたら、上書きしない
      const result = await db.execute({
        sql: `UPDATE v2_interviews SET data = ?, rev = rev + 1, updated_at = ?
              WHERE tenant_id = ? AND user_id = ? AND rev = ?`,
        args: [json, session.updatedAt, tenantId, userId, rev],
      });
      if (result.rowsAffected !== 1) throw new StoreConflictError();
    },

    async delete(id) {
      const { tenantId, userId } = parseKey(id);
      const db = await open(tenantId);
      await db.execute({
        sql: "DELETE FROM v2_interviews WHERE tenant_id = ? AND user_id = ?",
        args: [tenantId, userId],
      });
    },

    /** この保存先が、動き始めてから開いたデータベースにある面談の数（全社の合計ではない） */
    async size() {
      let total = 0;
      for (const db of seen) {
        const result = await db.execute("SELECT COUNT(*) AS n FROM v2_interviews");
        total += Number(result.rows[0]?.n ?? 0);
      }
      return total;
    },
  };
}
