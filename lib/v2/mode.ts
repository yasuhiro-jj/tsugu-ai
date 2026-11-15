// 2.0 を、どの動かし方で動かすかを決める。2.0 のコードの中で環境変数を読むのは、このファイルだけ
// （Clerk の部品そのものは、自分用の環境変数を自分で読む）。
//
// 動かし方は3つ。
// - local ：手元の開発用。ログインなし・メモリ保存・モック。外部にはつながない
// - verify：検証用。Clerk でログインし、2.0 専用の Turso に保存する。明示的に有効にしたときだけ
// - off   ：止める。API は 503 を返す（ハッカソン版の本番サイトは、これになる）
//
// 迷ったら止める：検証用にすると指定されているのに設定が足りない・おかしいときは、local に落とさず off にする
// （ログインなしのまま、外から使える状態にしないため）。

export type V2Mode = "local" | "verify" | "off";

type EnvLike = Record<string, string | undefined>;

const has = (value: string | undefined): value is string => typeof value === "string" && value.trim() !== "";

/** 公開用に組み立てたもの・公開先で動いているか */
export function isProductionBuild(env: EnvLike = process.env): boolean {
  return env.NODE_ENV === "production" || has(env.VERCEL);
}

/** Clerk の鍵が2つともそろっているか（値そのものは返さない） */
export function clerkConfigured(env: EnvLike = process.env): boolean {
  return has(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && has(env.CLERK_SECRET_KEY);
}

/** 接続先の文字列から、比べるための「ホスト名（小文字）」を取り出す。URL として読めなければ null */
function hostOf(value: string): string | null {
  try {
    // libsql: は URL の決まりにない名前なので、形だけ https: に読み替えて解釈する
    const url = new URL(value.trim().replace(/^(libsql|wss|ws):/i, "https:"));
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * 2.0 専用の Turso の接続先。使えないときは null（検証用として動かさない）。
 * - 書き方は libsql・https・wss で始まるものだけ。鍵や指定を URL に埋め込んだ形は受け付けない
 * - ハッカソン版のデータベースと同じ場所（ホスト名で比べる。書き方や大文字小文字の違いは無視する）なら使わない
 * - テストの中だけで動くデータベース（:memory:）は、開発用に動かしているときだけ受け付ける
 */
export function v2Database(env: EnvLike = process.env): { url: string; authToken: string | undefined } | null {
  if (!has(env.V2_TURSO_DATABASE_URL)) return null;
  const url = env.V2_TURSO_DATABASE_URL.trim();
  const authToken = has(env.V2_TURSO_AUTH_TOKEN) ? env.V2_TURSO_AUTH_TOKEN.trim() : undefined;

  if (url === ":memory:") return isProductionBuild(env) ? null : { url, authToken };

  if (!/^(libsql|https|wss):\/\//i.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.replace(/^(libsql|wss):/i, "https:"));
  } catch {
    return null;
  }
  if (parsed.search !== "" || parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") return null;
  const host = parsed.hostname.toLowerCase();
  if (host === "") return null;

  // ハッカソン版のデータベースを、2.0 から読み書きしない
  if (has(env.TURSO_DATABASE_URL)) {
    const other = hostOf(env.TURSO_DATABASE_URL);
    // ハッカソン版の接続先を読めないときも、同じかもしれないので使わない
    if (other === null || other === host) return null;
  }
  return { url, authToken };
}

/**
 * 検証用の公開先。Clerk が「このサイト宛てのログインだけ」を受け付けるために使う。
 * 公開先では https だけ。開発用に動かしているときは、自分のパソコン（localhost）の http も受け付ける。使えないときは null
 */
export function v2Origin(env: EnvLike = process.env): string | null {
  if (!has(env.V2_APP_ORIGIN)) return null;
  let parsed: URL;
  try {
    parsed = new URL(env.V2_APP_ORIGIN.trim());
  } catch {
    return null;
  }
  const localhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const okScheme = parsed.protocol === "https:" || (parsed.protocol === "http:" && localhost && !isProductionBuild(env));
  if (!okScheme) return null;
  // パスや指定が付いていたら受け付けない（origin だけを書く）
  if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search !== "" || parsed.hash !== "") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  return parsed.origin;
}

export function getMode(env: EnvLike = process.env): V2Mode {
  if (has(env.V2_MODE)) {
    // 検証用は、ログインの鍵・保存先・公開先の指定が、すべてそろったときだけ動かす。
    // それ以外の指定や、設定が足りない・おかしいときは止める
    if (env.V2_MODE === "verify" && clerkConfigured(env) && v2Database(env) !== null && v2Origin(env) !== null) {
      return "verify";
    }
    return "off";
  }
  // 指定がないとき：開発用に動かしているときだけ、手元の試作として動かす
  if (!isProductionBuild(env)) return "local";
  return "off";
}
