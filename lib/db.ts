import "server-only";

// Turso（libSQL）への接続（サーバー専用）。
// - 接続情報（TURSO_DATABASE_URL / TURSO_AUTH_TOKEN）はサーバーだけで使う。値はログ・応答に出さない
// - 環境変数が無い開発時だけ file:local.db（.gitignore 済み）にフォールバックする。本番では使わない
// - すべての SQL はプレースホルダ引数で値を渡す（文字列連結で条件を組み立てない）

import { createClient, type Client } from "@libsql/client";
import { COLUMN_MIGRATIONS, SCHEMA_STATEMENTS } from "./schema";

let client: Client | null = null;
let schemaReady: Promise<void> | null = null;

export class DbNotConfiguredError extends Error {
  constructor() {
    super("DB の接続情報が設定されていません");
    this.name = "DbNotConfiguredError";
  }
}

function createDefaultClient(): Client {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url) return createClient({ url, authToken: authToken || undefined });
  if (process.env.NODE_ENV === "production") throw new DbNotConfiguredError();
  return createClient({ url: "file:local.db" });
}

async function hasColumn(db: Client, table: string, column: string): Promise<boolean> {
  // table は lib/schema.ts の定数だけ（利用者の入力は来ない）
  const rs = await db.execute(`PRAGMA table_info(${table})`);
  return rs.rows.some((r) => r.name === column);
}

/** スキーマ（CREATE TABLE IF NOT EXISTS ＋ 足りない列の追加）を流す。何度呼んでも安全。 */
export async function applySchema(db: Client): Promise<void> {
  await db.batch(
    SCHEMA_STATEMENTS.map((sql) => ({ sql, args: [] })),
    "write",
  );
  for (const m of COLUMN_MIGRATIONS) {
    if (await hasColumn(db, m.table, m.column)) continue;
    try {
      await db.execute(m.ddl);
    } catch (err) {
      // 別のインスタンスが同時に追加した場合は成功扱い
      if (!(await hasColumn(db, m.table, m.column))) throw err;
    }
  }
}

/** スキーマ適用済みの DB クライアントを返す（スキーマはプロセス内で1回だけ流す）。 */
export async function getDb(): Promise<Client> {
  if (!client) client = createDefaultClient();
  if (!schemaReady) {
    const c = client;
    schemaReady = applySchema(c).catch((err) => {
      schemaReady = null; // 次回やり直せるように
      throw err;
    });
  }
  await schemaReady;
  return client;
}

/** テスト専用：DB を差し替える（本番 Turso に書かないため）。 */
export function setDbForTesting(db: Client | null): void {
  client = db;
  schemaReady = null;
}
