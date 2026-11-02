// 表示用の書式（サーバー・ブラウザで同じ結果になるよう、タイムゾーンを日本時間に固定）。

const DATE_TIME = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_ONLY = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
});

/** ISO 日時 → 「2026年11月2日 14:05」。不正なら空文字 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : DATE_TIME.format(d);
}

/** YYYY-MM-DD → 「11月2日」。不正ならそのまま返す */
export function formatDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 3));
  return Number.isNaN(d.getTime()) ? ymd : DATE_ONLY.format(d);
}

/** 今日の日付（日本時間）を YYYY-MM-DD で返す。サーバーで計算して画面へ渡す用 */
export function todayInJapan(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA は YYYY-MM-DD
}
