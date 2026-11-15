// 面談の保存先：Turso（libSQL）用。会社ごとに、データベースそのものを分ける。
//
// いまの状態：検証用の動かし方（lib/v2/runtime.ts）のときだけ使う。手元の試作はメモリ保存のまま。
// 検証は、テストの中だけで動くデータベースで行った。**本物の Turso では、まだ一度も動かしていない。**
// 検証用は、どの会社も1つのデータベースを使う（行は会社と本人の ID で必ず絞る）。
// 会社ごとにデータベースを分けるのは、実データを扱う前に行う。
// ハッカソン版のデータベースと鍵は、絶対に使わない。
//
// 守っていること
// - 会社ごとに別のデータベースを使う（どのデータベースを使うかは、権限確認を通った会社の ID からだけ決まる）
// - 会社と本人の ID は、決まった文字（英数字・「_」・「-」）だけを受け付ける
// - 保存するときに、持ち主の記録が置き場所と合っているかを確かめる（合わなければ保存しない）
// - 読んだあとで、ほかの操作が先に保存していたら、上書きしない（版の番号と、作成ごとの印で気づく）
//   - 消して作り直した面談に、消す前の古い内容を上書きさせない
// - 1つのデータベースを複数の会社で使う構成になっても、行は会社の ID で必ず絞る
// - SQL は、値を文字として埋め込まず、必ず引数で渡す
//
// つなぐときに必ず守ること（dbFor を作る人へ）
// - 会社の ID を、接続先の URL やデータベースの名前に、文字としてそのまま埋め込まない。
//   登録済みの会社の一覧から接続先を引き、一覧にない会社は断る
//
// まだやっていないこと：保存期間、削除の期限、バックアップからの復元時の消去のやり直し、暗号化の鍵の管理。

import type { Client } from "@libsql/client";
import { StoreConflictError, StoreCorruptError, StoreFullError, type V2Store } from "./store";
import type { Session } from "./types";

type Awaitable<T> = T | Promise<T>;

/** 会社の ID から、その会社のデータベースへの接続を返す。登録のない会社は、例外を投げて断ること */
export type TenantDb = (tenantId: string) => Awaitable<Client>;

const SCHEMA = `CREATE TABLE IF NOT EXISTS v2_interviews (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  gen TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
)`;

/** 会社・本人の ID に使える文字。記号や区切りの文字、空白、大文字小文字の違いだけの紛らわしさを持ち込まない */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** 置き場所の名前（lib/v2/access.ts の interviewKey が作る形）を、会社と本人の ID に戻す */
function parseKey(id: string): { tenantId: string; userId: string } {
  const parts = id.split("/");
  if (parts.length !== 2) throw new Error("bad interview key");
  const [tenantId, userId] = parts;
  // 決まった文字だけなら、変換の前後で形が変わらない（%表記などの別の書き方を受け付けない）
  if (!ID_PATTERN.test(tenantId) || !ID_PATTERN.test(userId)) throw new Error("bad interview key");
  return { tenantId, userId };
}

/** 読み戻した中身が、面談として最低限の形をしているか */
function looksLikeSession(value: unknown): value is Omit<Session, "id" | "rev" | "gen"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.phase === "interview" || v.phase === "review") &&
    Array.isArray(v.items) &&
    Array.isArray(v.log) &&
    v.themes !== null &&
    typeof v.themes === "object"
  );
}

export function createLibsqlStore(dbFor: TenantDb, opts?: { maxRows?: number }): V2Store {
  // 開いた接続を覚えておく（同じ接続は1つだけ。利用者の数だけ増えたりしない）
  const opened = new Set<Client>();
  const ready = new WeakSet<Client>();
  const maxRows = opts?.maxRows;

  async function open(tenantId: string): Promise<Client> {
    const db = await dbFor(tenantId);
    if (!ready.has(db)) {
      await db.execute(SCHEMA);
      ready.add(db);
    }
    opened.add(db);
    return db;
  }

  return {
    async get(id) {
      const { tenantId, userId } = parseKey(id);
      const db = await open(tenantId);
      const result = await db.execute({
        sql: "SELECT gen, rev, data FROM v2_interviews WHERE tenant_id = ? AND user_id = ?",
        args: [tenantId, userId],
      });
      const row = result.rows[0];
      if (!row) return null;
      let data: unknown;
      try {
        data = JSON.parse(String(row.data));
      } catch {
        throw new StoreCorruptError();
      }
      const rev = Number(row.rev);
      if (!looksLikeSession(data) || !Number.isInteger(rev) || typeof row.gen !== "string") {
        throw new StoreCorruptError();
      }
      return { ...data, id, rev, gen: row.gen };
    },

    async put(session) {
      const { tenantId, userId } = parseKey(session.id);
      // 持ち主の記録がない・置き場所と合わない面談は、保存しない
      if (session.owner?.tenantId !== tenantId || session.owner?.userId !== userId) {
        throw new Error("owner does not match interview key");
      }
      const db = await open(tenantId);
      const { id: _id, rev, gen, ...data } = session;
      const json = JSON.stringify(data);

      if (rev === undefined) {
        // 件数の上限があるときは、いっぱいなら新しい面談を断る（すでにある面談は消さない）
        if (maxRows !== undefined) {
          const count = await db.execute("SELECT COUNT(*) AS n FROM v2_interviews");
          if (Number(count.rows[0]?.n ?? 0) >= maxRows) throw new StoreFullError();
        }
        // 新しく作る。作成ごとに、使い回されない印を付ける。すでにあれば、ほかの操作が先に作っている
        const result = await db.execute({
          sql: `INSERT INTO v2_interviews (tenant_id, user_id, gen, rev, data, updated_at) VALUES (?, ?, ?, 1, ?, ?)
                ON CONFLICT (tenant_id, user_id) DO NOTHING`,
          args: [tenantId, userId, crypto.randomUUID(), json, session.updatedAt],
        });
        if (result.rowsAffected !== 1) throw new StoreConflictError();
        return;
      }
      // 読んだときの版・作成の印のままなら更新する。
      // 変わっていたら（先に保存された、消された、消して作り直された）、上書きしない
      if (gen === undefined) throw new StoreConflictError();
      const result = await db.execute({
        sql: `UPDATE v2_interviews SET data = ?, rev = rev + 1, updated_at = ?
              WHERE tenant_id = ? AND user_id = ? AND rev = ? AND gen = ?`,
        args: [json, session.updatedAt, tenantId, userId, rev, gen],
      });
      if (result.rowsAffected !== 1) throw new StoreConflictError();
    },

    /** 中身を読まずに消す（中身が壊れていても、本人が消せるように） */
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
      for (const db of opened) {
        const result = await db.execute("SELECT COUNT(*) AS n FROM v2_interviews");
        total += Number(result.rows[0]?.n ?? 0);
      }
      return total;
    },
  };
}
