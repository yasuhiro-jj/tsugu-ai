// 通しの「--custom」で使う会社の設定（架空の「山田精工」。実在の会社・人物・決算ではない）。
// 形は lib/settings-types.ts の CompanySettings。PUT /api/settings に { settings, rev } で送る。
// テーマの補足は lib/industry-presets.ts の manufacturing の型のまま（あちらを変えたらここも合わせる）。

/** 決算（万円の整数）。当期は売上が減って赤字になり、手元資金が減る（資金繰りに課題が出る形） */
const PREVIOUS = {
  sales: 32000,
  cogs: 22400,
  labor: 6400,
  otherSga: 2700,
  interest: 180,
  netIncome: 220, // 営業利益 500 − 支払利息 180 − 税など
  cash: 4800,
  debt: 12000,
  principalRepayment: 1200,
  depreciation: 900,
};

const CURRENT = {
  sales: 30000,
  cogs: 21600,
  labor: 6600,
  otherSga: 2800,
  interest: 200,
  netIncome: -1200, // 営業利益 ▲1,000 − 支払利息 200
  cash: 3300, // 4,800 − 1,200（赤字）＋ 900（減価償却）− 1,200（元本返済）
  debt: 10800, // 12,000 − 1,200（元本返済）
  principalRepayment: 1200,
  depreciation: 900,
};

export const CUSTOM_SETTINGS = {
  industry: "manufacturing",
  company: {
    name: "山田精工（架空）",
    industryNote: "自動車部品の金属加工",
    overview: "創業1975年、従業員25名。自動車メーカーの一次下請けに部品を納める",
  },
  people: {
    predecessorName: "山田 一郎",
    successorName: "山田 健太",
    relation: "身内",
    predecessorLevel: "Lv2",
    successorLevel: "Lv1",
  },
  themeHints: {
    policy: "守りたい技術やこだわり、変えてもよいもの",
    suppliers: "主な納品先・仕入れ先と、約束や条件",
    operations: "段取り・品質の見方・設備の判断",
    people: "職人・従業員についての気がかり",
    cashflow: "会社の借金の返済や、毎月のお金の出入り",
  },
  financials: { previous: PREVIOUS, current: CURRENT },
};

/** 最後の「設定を変えると診断が消える」確認で、概要だけ少し変えた設定 */
export const CUSTOM_SETTINGS_CHANGED = {
  ...CUSTOM_SETTINGS,
  company: { ...CUSTOM_SETTINGS.company, overview: CUSTOM_SETTINGS.company.overview + "。工場は1か所" },
};

/** つぐみの想定回答（scripts/demo-scenario.mjs）から差し替える回答（共有の可否はそのまま） */
export const CUSTOM_ANSWERS = {
  predecessor: {
    policy: "品質と納期の信用を守る。取引先との約束は口約束も多い",
  },
};

export const CUSTOM_EXPECT = {
  companyName: "山田精工（架空）",
  industryWord: "製造業",
  firstQuestionWords: ["山田精工", "山田"],
  salesTexts: ["30,000", "3億"],
  courseNote: "飲食店向けの例です",
  noDiagnosisTitle: "先に比較画面で診断してください",
};
