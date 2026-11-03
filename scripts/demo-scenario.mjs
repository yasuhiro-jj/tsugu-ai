// 3分デモの想定回答（架空の「食事処 つぐみ」）。
// 出典：Notion「デモ会社設定：食事処 つぐみ」4章（2026-10-31 確定）。すべて架空の会社・人物。
// テーマの key は lib/themes.ts と同じ。share は面談後に選ぶ共有の可否（締めは初期値どおり共有しない）。

export const SCENARIO = {
  predecessor: {
    policy: { answer: "味と常連さんを守る。法事の折詰と宴会は地域での役目だと思っている", share: true },
    suppliers: { answer: "魚屋とは30年の付き合い。豆腐屋・酒屋とは口約束の条件もある", share: true },
    operations: { answer: "仕込みの量は天気と予約を見て勘で決める。原価はだいたい頭に入っている", share: true },
    people: { answer: "ベテランのパート2人が辞めそうで気がかり", share: true },
    cashflow: { answer: "借入は毎月きちんと返している。宴会が入れば取り戻せる", share: true },
    closing: { answer: "体力的に、厨房に立てるのはあと2〜3年", share: false },
  },
  successor: {
    policy: { answer: "ランチとSNSで若いお客さんを増やしたい", share: true },
    suppliers: { answer: "取引先の担当者は顔を知っている程度", share: true },
    operations: { answer: "仕込みはできるが、発注量と仕入れ値は先代任せ", share: true },
    people: { answer: "パートさんとの関係は良好", share: true },
    cashflow: { answer: "借入がいくらで、毎月いくら返しているか知らない", share: true },
    closing: { answer: "正直、継ぐかどうかまだ迷っている", share: false },
  },
};

// AI が深掘りしてきたときの返し（Notion に例がないため、上の回答の範囲を超える内容は足さない）
export const FOLLOWUP_REPLY = "今お話しした以上のことは、今はよく分かりません。このテーマはここまでにさせてください。";

// 通しのあとに期待すること（Notion 5章「AIが見つける認識差」）
export const EXPECT = {
  gapKeyword: "資金繰り",
  firstCourseTitle: "資金繰りの基本",
};
