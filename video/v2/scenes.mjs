// TSUGU AI 3分デモ動画 v2「勘違いを、理解に。」の場面の割り当て（video/v2/storyboard.md の「秒単位の台本」、合計 175 秒）。
// cards.mjs・edit.mjs・voice-merge.mjs が読む。`node video/v2/scenes.mjs` で narration.txt（原稿と読み）を書き出す。
//
// 時刻は完成した動画の先頭からの秒数。captions の at / to は場面の先頭からの秒数。
// narration.text は原稿（台本のナレーションそのまま。srt にも使う）、narration.yomi は音声合成の読み（固有名詞・数字の読み方だけ変える）。
// cardText は文字の画面に出す大きな文（字幕ファイルにも【字幕】として入れる）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOTAL = 175;
export const NARRATION_LEAD = 0.3; // 場面が始まってからナレーションを始めるまで

export const SCENES = [
  {
    id: "s01", start: 0, dur: 12, kind: "card", card: "misunderstanding",
    captions: [],
    cardText: "事業承継は、お互いの「勘違い」から崩れていく。",
    narration: {
      text: "事業承継がうまくいかない理由。実は、お互いの「勘違い」から始まっていることが少なくありません。",
      yomi: "事業承継が、うまくいかない理由。実は、お互いの、勘違いから始まっていることが、少なくありません。",
    },
  },
  {
    id: "s02", start: 12, dur: 22, kind: "card", card: "split", fadeOut: false,
    captions: [{ at: 0, to: 22, text: "すれ違う、二人の思い" }],
    narration: {
      text: "先代は、できれば継いでほしい。でも、大変な仕事だから、継がせたくない気持ちもある。昔のように強制もできない。自分のやり方は、うまく言葉にできない。後継者は、本当は興味がある。でも、同じ働き方ではなく、もっと広い世界で挑戦したい。",
      yomi: "先代は、できれば継いでほしい。でも、大変な仕事だから、継がせたくない気持ちもある。昔のように、強制もできない。自分のやり方は、うまく言葉にできない。後継者は、本当は興味がある。でも、同じ働き方ではなく、もっと広い世界で、挑戦したい。",
    },
  },
  {
    // 左右の言葉が中央の文に寄る（cards.mjs が書き出したコマを順に並べる）
    id: "s03", start: 34, dur: 10, kind: "card", card: "converge", fadeIn: false,
    captions: [],
    cardText: "でも、心の芯は同じ。「この事業を続けたい」",
    narration: {
      text: "でも、二人の心の芯は同じです。この事業を続けたい。この事業を軸に、新しいことも広げたい。",
      yomi: "でも、二人の心のしんは同じです。この事業を続けたい。この事業を軸に、新しいことも広げたい。",
    },
  },
  {
    id: "s04", start: 44, dur: 18, kind: "screen",
    captions: [{ at: 0, to: 18, text: "本音は、一人ずつ AI に話す" }],
    narration: {
      text: "TSUGU AI では、先代と後継者が、別々に AI と話します。守りたいものも、やってみたいことも。相手に見せるかどうかは、本人が選びます。",
      yomi: "ツグ エーアイでは、先代と後継者が、別々に、エーアイと話します。守りたいものも、やってみたいことも。相手に見せるかどうかは、本人が選びます。",
    },
  },
  {
    id: "s05", start: 62, dur: 24, kind: "screen",
    captions: [{ at: 0, to: 24, text: "守るものと、変えられるものが見えてくる" }],
    narration: {
      text: "共有した回答だけで、AI が二人の考えを整理します。守りたい伝統と、新しく試したいこと。言葉と理屈にすれば、伝統は受け継げる。勘やルーティンを仕組みに置き換えれば、空いた時間で、新しい挑戦ができる。",
      yomi: "共有した回答だけで、エーアイが、二人の考えを整理します。守りたい伝統と、新しく試したいこと。言葉と理屈にすれば、伝統は受け継げる。勘やルーティンを、仕組みに置き換えれば、空いた時間で、新しい挑戦ができる。",
    },
  },
  {
    id: "s06", start: 86, dur: 16, kind: "screen",
    captions: [{ at: 0, to: 16, text: "やる気になると、策が見えてくる" }],
    narration: {
      text: "後継者がやる気になると、次にやることが見えてきます。学ぶ順番と、二人で取り組む90日の行動。",
      yomi: "後継者がやる気になると、次にやることが見えてきます。学ぶ順番と、二人で取り組む、きゅうじゅうにちの行動。",
    },
  },
  {
    id: "s07", start: 102, dur: 8, kind: "card", card: "circle",
    captions: [{ at: 0, to: 8, text: "先代・後継者・AI・支援する人で進める" }],
    narration: {
      text: "そして承継は、二人だけで抱えるものではありません。",
      yomi: "そして承継は、二人だけで抱えるものではありません。",
    },
  },
  {
    id: "s08", start: 110, dur: 24, kind: "screen",
    captions: [{ at: 0, to: 24, text: "分かりやすい資料で、商工会や金融機関に相談しやすく" }],
    narration: {
      text: "商工会や金融機関も、お店の実情が分からなければ、支援のしようがありません。AI がお店の数字を見える形にして、分かりやすい相談用の資料を一緒に作ります。融資や税金の結論は、専門家と一緒に。",
      yomi: "商工会や金融機関も、お店の実情が分からなければ、支援のしようがありません。エーアイが、お店の数字を見える形にして、分かりやすい相談用の資料を、一緒に作ります。融資や税金の結論は、専門家と一緒に。",
    },
  },
  {
    id: "s09", start: 134, dur: 24, kind: "screen",
    captions: [{ at: 0, to: 24, text: "24時間365日、相談できて、記録が残る" }],
    narration: {
      text: "専門家と話せるのは、月にわずかな時間。AI なら、いつでも相談できて、話したことは記録に残ります。経営、広報、販売も、一緒に考える。言った、言わないの勘違いも防げます。",
      yomi: "専門家と話せるのは、月にわずかな時間。エーアイなら、いつでも相談できて、話したことは、記録に残ります。経営、広報、販売も、一緒に考える。言った、言わないの勘違いも、防げます。",
    },
  },
  {
    id: "s10", start: 158, dur: 12, kind: "card", card: ["closing", "logo"], cardSplit: 6.5,
    captions: [],
    cardText: "勘違いを、理解に。先代と後継者と AI で、家業の次の形を。",
    narration: {
      text: "お互いの勘違いを、理解に変える。先代と、後継者と、AI で、家業の次の形を。TSUGU AI。",
      yomi: "お互いの勘違いを、理解に変える。先代と、後継者と、エーアイで、家業の、次の形を。ツグ エーアイ。",
    },
  },
  {
    id: "s11", start: 170, dur: 5, kind: "card", card: "credit",
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
/** 声を収める長さの上限（場面の終わりに 0.4 秒の余白） */
export const limitOf = (s) => s.dur - NARRATION_LEAD - 0.4;

// 合計の確認
{
  let t = 0;
  for (const s of SCENES) {
    if (Math.abs(s.start - t) > 1e-6) throw new Error(`scenes.mjs：${s.id} の開始 ${s.start} が前の場面の終わり ${t} と合いません`);
    t += s.dur;
  }
  if (Math.abs(t - TOTAL) > 1e-6) throw new Error(`scenes.mjs：合計 ${t} 秒が ${TOTAL} 秒と合いません`);
}

// node video/v2/scenes.mjs → narration.txt を書き出す
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const lines = [
    "TSUGU AI 3分デモ動画 v2「勘違いを、理解に。」ナレーション原稿（台本：video/v2/storyboard.md。175 秒版）",
    "",
    "・[ ] の行：場面の番号／ナレーションの開始時刻（動画の先頭から）／声を収める長さの上限",
    "・原稿：読み上げる文（台本のまま。字幕にも使う）。オーナーご自身の声で録るときは、この原稿を、上限の秒数に収まるように読んでください",
    "・録音は場面ごとに1ファイル：video/v2/voice/s01.m4a 〜 s10.m4a（s11 は無音）。前後の無音は自動で切ります。上限を少し超えても 1.15 倍までは自動で速めます",
    "・読み：Windows の音声合成（Microsoft Haruka）に読ませる文。固有名詞と数字の読み方だけ変えています（tts.ps1 が読む）",
    "・会社・人物・数字はすべて架空です（食事処 つぐみ）",
    "",
  ];
  for (const s of SCENES) {
    const at = s.start + NARRATION_LEAD;
    lines.push(`[${s.id} ${fmt(at)} 上限${limitOf(s).toFixed(1)}秒] （場面 ${fmt(s.start)}–${fmt(s.start + s.dur)}）`);
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
  for (const s of SCENES) console.log(`${s.id} ${fmt(s.start)} ${s.dur}秒 上限${limitOf(s).toFixed(1)}秒 ${s.narration ? s.narration.text.length + "字" : "無音"}`);
}
