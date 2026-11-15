// 2.0 を、どの動かし方で動かすかを決める。環境変数を読むのは、2.0 の中ではこのファイルだけ。
//
// 動かし方は3つ。
// - local ：手元の開発用。ログインなし・メモリ保存・モック。外部にはつながない
// - verify：検証用。Clerk でログインし、2.0 専用の Turso に保存する。明示的に有効にしたときだけ
// - off   ：止める。API は 503 を返す（ハッカソン版の本番サイトは、これになる）
//
// 迷ったら止める：検証用にすると指定されているのに設定が足りないときは、local に落とさず off にする
// （ログインなしのまま、外から使える状態にしないため）。

export type V2Mode = "local" | "verify" | "off";

type EnvLike = Record<string, string | undefined>;

const has = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "";

/** Clerk の鍵が2つともそろっているか（値そのものは返さない） */
export function clerkConfigured(env: EnvLike = process.env): boolean {
  return has(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && has(env.CLERK_SECRET_KEY);
}

/**
 * 2.0 専用の Turso の接続先。そろっていなければ null。
 * ハッカソン版のデータベースと同じ接続先が指定されていたら、使わない（null）。
 */
export function v2Database(env: EnvLike = process.env): { url: string; authToken: string | undefined } | null {
  const url = env.V2_TURSO_DATABASE_URL;
  if (!has(url)) return null;
  // ハッカソン版のデータベースを、2.0 から読み書きしない
  if (has(env.TURSO_DATABASE_URL) && env.TURSO_DATABASE_URL.trim() === url.trim()) return null;
  return { url: url.trim(), authToken: has(env.V2_TURSO_AUTH_TOKEN) ? env.V2_TURSO_AUTH_TOKEN : undefined };
}

export function getMode(env: EnvLike = process.env): V2Mode {
  if (has(env.V2_MODE)) {
    // 検証用は、ログインと保存先の両方がそろったときだけ動かす。それ以外の指定や、設定が足りないときは止める
    if (env.V2_MODE === "verify" && clerkConfigured(env) && v2Database(env) !== null) return "verify";
    return "off";
  }
  // 指定がないとき：開発用に動かしているときだけ、手元の試作として動かす
  if (env.NODE_ENV !== "production" && !has(env.VERCEL)) return "local";
  return "off";
}

/** クッキーに secure を付けるか（公開用に組み立てたものでは付ける） */
export function isProductionBuild(env: EnvLike = process.env): boolean {
  return env.NODE_ENV === "production";
}
