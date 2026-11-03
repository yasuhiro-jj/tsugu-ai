// 「AIに質問する」欄の質問の例（押すと入力欄に入るだけ。送信はしない）。
// 記事の内容（lib/courses.ts）に合わせた短い例。見つからないときは共通の例を使う。

const EXAMPLES: Record<string, readonly [string, string]> = {
  "cashflow-1": ["減価償却費って何ですか？", "黒字なのにお金が減るのはなぜですか？"],
  "cashflow-2": ["元本と利息の違いは何ですか？", "返済予定表はどこでもらえますか？"],
  "cashflow-3": ["何か月分あれば安心ですか？", "資金繰り表って何ですか？"],
  "costrate-1": ["売上原価って何ですか？", "原価率が上がる原因は何ですか？"],
  "costrate-2": ["棚卸しって何をするのですか？", "なぜ仕入れた値段で数えるのですか？"],
  "costrate-3": ["どの在庫から数えればいいですか？", "1食あたりの原価はどう出しますか？"],
  "trialbalance-1": ["粗利って何ですか？", "試算表と決算書の違いは何ですか？"],
  "trialbalance-2": ["FL比率って何ですか？", "FL比率を下げるには何から見ればいいですか？"],
  "trialbalance-3": ["経常利益って何ですか？", "前の年と比べるときはどこを見ますか？"],
};

const FALLBACK: readonly [string, string] = [
  "この記事で一番大事な点は何ですか？",
  "この記事に出てくる言葉をやさしく教えてください",
];

export function askExamples(courseId: string, articleNo: number): readonly [string, string] {
  return EXAMPLES[`${courseId}-${articleNo}`] ?? FALLBACK;
}
