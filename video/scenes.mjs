// 3分デモ動画の場面の割り当て（2026-11-04：オーナーの声の長さに合わせて s02・s03 を延ばし、s08・s09 を短くした）
//（video/storyboard.md の「秒単位の台本」を 175 秒に整えたもの）。
// cards.mjs・edit.mjs が読む。`node video/scenes.mjs` で narration.txt（原稿と読み）を書き出す。
//
// 時刻は完成した動画の先頭からの秒数。captions の at / to は場面の先頭からの秒数。
// narration.text は原稿（画面の字幕・srt に使う）、narration.yomi は音声合成の読み（固有名詞・数字の読み方だけ変える）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOTAL = 175;
export const NARRATION_LEAD = 0.3; // 場面が始まってからナレーションを始めるまで

export const SCENES = [
  {
    id: "s01", start: 0, dur: 10, kind: "card", card: "question",
    captions: [],
    narration: {
      text: "父の会社を継ぎたい。でも、父が本当に何を考えているのか、分からない。",
      yomi: "父の会社を、継ぎたい。でも、父が本当に何を考えているのか、分からない。",
    },
  },
  {
    id: "s02", start: 10, dur: 16.5, kind: "card", card: ["stat", "head"], cardSplit: 8,
    captions: [{ at: 0, to: 16.5, text: "約半数の会社で、後継者が「いない」「未定」" }],
    narration: {
      text: "日本では約半数の会社で、後継者が決まっていません。借入の返済も、仕入れの口約束も、先代の頭の中だけ。後継者は、何を知らないのかも分かりません。",
      yomi: "日本では約半数の会社で、後継者が決まっていません。かりいれの返済も、仕入れのくちやくそくも、先代の頭の中だけ。後継者は、何を知らないのかも分かりません。",
    },
  },
  {
    id: "s03", start: 26.5, dur: 9.5, kind: "screen",
    captions: [{ at: 0, to: 9.5, text: "TSUGU AI ― 先代と後継者が、別々に AI と話す" }],
    narration: {
      text: "TSUGU AI では、先代と後継者が、それぞれ別々に Claude と面談します。",
      yomi: "ツグ エーアイでは、先代と後継者が、それぞれ別々に、クロードと面談します。",
    },
  },
  {
    id: "s04", start: 36, dur: 24, kind: "screen",
    captions: [{ at: 0, to: 24, text: "Claude が一問ずつ、責めずに聞く" }],
    narration: {
      text: "Claude は相手の言葉を受け止め、一問ずつ聞いていきます。答えはテーマごとに要約され、本人が確認します。",
      yomi: "クロードは、相手の言葉を受け止め、一問ずつ聞いていきます。答えはテーマごとに要約され、本人が確認します。",
    },
  },
  {
    id: "s05", start: 60, dur: 12, kind: "screen",
    captions: [{ at: 0, to: 12, text: "共有しない回答は、内容も存在も相手に見えない" }],
    narration: {
      text: "相手に見せるかは、テーマごとに本人が選びます。共有しない気持ちは、内容も、あることさえ、相手には伝わりません。",
      yomi: "相手に見せるかは、テーマごとに本人が選びます。共有しない気持ちは、内容も、あることさえ、相手には伝わりません。",
    },
  },
  {
    id: "s06", start: 72, dur: 19, kind: "screen",
    captions: [{ at: 0, to: 19, text: "知らないことも、迷いも、話していい" }],
    narration: {
      text: "後継者も同じように答えます。知らないことも、迷いも、話して大丈夫です。",
      yomi: "後継者も、同じように答えます。知らないことも、迷いも、話して大丈夫です。",
    },
  },
  {
    id: "s07", start: 91, dur: 29, kind: "screen",
    // 後半（お店の数字を見せるところ）で字幕を替える。替える秒数は edit.mjs が録画に合わせて上書きする
    captions: [
      { at: 0, to: 15, text: "二人が共有した回答だけで、Claude が認識の違いを示す" },
      { at: 15, to: 29, text: "計算はアプリ、説明は Claude" },
    ],
    narration: {
      text: "二人が共有した回答だけを使って、Claude が認識の違いを整理します。先代は「宴会で取り戻せる」。後継者は返済額を知らない。決算では、本業のもうけが赤字なうえ、借入の返済で、手元のお金は一年で約392万円減っています。数字の計算はアプリが行い、Claude は説明を担当します。継ぐ・継がないの結論は出しません。",
      yomi: "二人が共有した回答だけを使って、クロードが認識の違いを整理します。先代は、宴会で取り戻せる。後継者は、返済額を知らない。決算では、本業のもうけが赤字なうえ、かりいれの返済で、手元のお金は、いちねんで、約さんびゃくきゅうじゅうにまんえん減っています。数字の計算はアプリが行い、クロードは説明を担当します。継ぐ、継がないの結論は出しません。",
    },
  },
  {
    id: "s08", start: 120, dur: 21, kind: "screen",
    captions: [{ at: 0, to: 21, text: "診断を受けて、学ぶ順番が変わる" }],
    narration: {
      text: "診断を受けて、後継者の学ぶ順番が変わりました。まず、資金繰りの基本から。",
      yomi: "診断を受けて、後継者の学ぶ順番が変わりました。まず、しきんぐりの基本から。",
    },
  },
  {
    id: "s09", start: 141, dur: 21, kind: "screen",
    captions: [{ at: 0, to: 21, text: "二人でできる、具体的な90日の行動" }],
    narration: {
      text: "そして、二人で取り組む90日の行動計画。誰が、何を、いつまでに。決めるのは、お二人です。",
      yomi: "そして、二人で取り組む、きゅうじゅうにちの行動計画。誰が、何を、いつまでに。決めるのは、お二人です。",
    },
  },
  {
    id: "s10", start: 162, dur: 10, kind: "card", card: ["closing", "logo"], cardSplit: 5.5,
    captions: [],
    narration: {
      text: "見て覚える承継から、理解し合える承継へ。TSUGU AI。",
      yomi: "見て覚える承継から、理解し合える承継へ。ツグ エーアイ。",
    },
  },
  {
    id: "s11", start: 172, dur: 3, kind: "card", card: "credit",
    captions: [],
    narration: null, // 無音
  },
];

export const DISCLAIMER = "デモ用の架空の会社・人物・数字です";
export const PUBLIC_URL = "https://tsugu-ai.vercel.app";

export const fmt = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

// node video/scenes.mjs → narration.txt を書き出す
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lines = [
    "TSUGU AI 3分デモ動画 ナレーション原稿（台本：video/storyboard.md。175 秒版）",
    "",
    "・[ ] の行：場面の番号／ナレーションの開始時刻（動画の先頭から）／収める長さの上限",
    "・原稿：読み上げる文（字幕にも使う）。オーナーご自身の声に差し替えるときは、この原稿を、開始時刻から読んでください",
    "・読み：Windows の音声合成（Microsoft Haruka）に読ませる文。固有名詞と数字の読み方だけ変えています（tts.ps1 が読む）",
    "・会社・人物・数字はすべて架空です（食事処 つぐみ）",
    "",
  ];
  for (const s of SCENES) {
    const at = s.start + NARRATION_LEAD;
    const max = s.dur - NARRATION_LEAD - 0.4;
    lines.push(`[${s.id} ${fmt(at)} 上限${max.toFixed(1)}秒] （場面 ${fmt(s.start)}–${fmt(s.start + s.dur)}）`);
    if (s.narration) {
      lines.push(`原稿: ${s.narration.text}`);
      lines.push(`読み: ${s.narration.yomi}`);
    } else {
      lines.push("原稿: （無音）");
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(here, "narration.txt"), lines.join("\r\n"), "utf8");
  console.log("narration.txt を書きました");
}
