// 面談テーマ（Notion「デモ会社設定」「AI面談の指示文 v1」 2026-11-01 確定：5テーマ＋締め＝6テーマ）
// 画面・サーバーの両方から import してよい（秘密情報を含まない）。

export const THEMES = [
  { key: "policy", label: "経営方針", hint: "守りたいもの、変えてもよいもの", defaultShare: true },
  { key: "suppliers", label: "取引先", hint: "主な仕入れ先と、約束や条件", defaultShare: true },
  { key: "operations", label: "業務の勘どころ", hint: "仕込み・発注・値決めの判断", defaultShare: true },
  { key: "people", label: "人材", hint: "スタッフについての気がかり", defaultShare: true },
  { key: "cashflow", label: "資金繰り", hint: "お店の借金の返済や、毎月のお金の出入り", defaultShare: true },
  // 締めは初期値「共有しない」（本音を話しやすくするため）
  { key: "closing", label: "相手にまだ伝えていない気持ち", hint: "締めの質問", defaultShare: false },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

export function isThemeKey(v: unknown): v is ThemeKey {
  return typeof v === "string" && THEMES.some((t) => t.key === v);
}

export function themeLabel(key: ThemeKey): string {
  return THEMES.find((t) => t.key === key)?.label ?? key;
}
