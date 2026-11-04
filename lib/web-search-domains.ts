// ウェブ検索で見てよいサイトの一覧と、出典の URL の判定（SEC-203）。
// 画面（components/learning/AskPanel.tsx・components/advisor/AdvisorClient.tsx）からも import してよい（server-only は付けない）。
// サーバー側の検索処理は lib/ai/web-search.ts。

/**
 * ウェブ検索で見てよい公的機関のサイト（サブドメインも含む）。オーナー決定 2026-11-03。
 * 数字の目安はこちらを優先する
 */
export const WEB_SEARCH_PUBLIC_DOMAINS: readonly string[] = [
  "chusho.meti.go.jp", // 中小企業庁
  "jfc.go.jp", // 日本政策金融公庫
  "smrj.go.jp", // 中小機構
  "e-stat.go.jp", // 政府統計
  "mhlw.go.jp", // 厚生労働省（最低賃金など）
  "boj.or.jp", // 日本銀行（金利）
  // 地域の支援機関（オーナー決定 2026-11-04：事業承継の相談先として商工会・商工会議所を加える）
  "shokokai.or.jp", // 全国商工会連合会・各地の商工会
  "jcci.or.jp", // 日本商工会議所
];

/**
 * ウェブ検索で見てよい民間サービスのサイト（経営管理サービスを提供する民間企業。サブドメインも含む）。オーナー決定 2026-11-03。
 * 数字の見方や管理のやり方の一般的な説明にだけ使う。特定のサービスを勧めたり比べたりしない（指示文 lib/prompts/web-search.ts）
 */
export const WEB_SEARCH_PRIVATE_DOMAINS: readonly string[] = [
  "airregi.jp", // Airメイト
  "bixid.net", // bixid
  "manageboard.jp", // Manageboard
  "diggle.jp", // DIGGLE
  "loglass.jp", // Loglass
];

/**
 * allowed_domains に渡す一覧（公的機関・支援機関8件＋民間サービス5件＝13件）。
 * 追加・変更はオーナーの確認を取ってから（tests/web-search.test.ts で件数を確かめている）
 */
export const WEB_SEARCH_ALLOWED_DOMAINS: readonly string[] = [...WEB_SEARCH_PUBLIC_DOMAINS, ...WEB_SEARCH_PRIVATE_DOMAINS];

/** 出典の種類：public＝公的機関、private＝民間サービス */
export type WebSourceKind = "public" | "private";

function hostMatches(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * URL の出典の種類を返す。https で、公的機関の一覧なら "public"、民間サービスの一覧なら "private"。
 * どちらにも当てはまらない（または URL として正しくない）なら null（出典に含めない・画面に出さない）
 */
export function sourceKindOf(url: unknown): WebSourceKind | null {
  if (typeof url !== "string" || url.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (hostMatches(host, WEB_SEARCH_PUBLIC_DOMAINS)) return "public";
  if (hostMatches(host, WEB_SEARCH_PRIVATE_DOMAINS)) return "private";
  return null;
}

/** 許可した11のドメイン（またはそのサブドメイン）の https の URL なら true */
export function isAllowedSourceUrl(url: unknown): url is string {
  return sourceKindOf(url) !== null;
}
