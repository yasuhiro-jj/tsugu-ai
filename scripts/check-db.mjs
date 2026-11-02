// Turso（libSQL）への接続確認用（ローカル専用）。
// 実行: npm run check:db（.env.local の TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を使用）
// 接続 URL・トークンの値は一切表示しない。

import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!url || !authToken) {
  console.error(
    "接続情報が見つかりません。.env.local に TURSO_DATABASE_URL と TURSO_AUTH_TOKEN を入力してください。",
  );
  process.exit(1);
}

if (!url.startsWith("libsql://")) {
  console.error("TURSO_DATABASE_URL は libsql:// で始まる形式にしてください（値は表示しません）。");
  process.exit(1);
}

try {
  const db = createClient({ url, authToken });
  const rs = await db.execute("select 1 as ok");
  db.close();
  if (rs.rows[0]?.ok === 1) {
    console.log("接続成功（select 1 の結果: 1）");
  } else {
    console.error("接続はできましたが、想定外の結果でした。");
    process.exit(1);
  }
} catch (err) {
  const name = err instanceof Error ? err.constructor.name : "UnknownError";
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "-";
  console.error(`接続失敗: ${name}（code: ${code}）`);
  process.exit(1);
}
