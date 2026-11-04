// v2 の文字の画面・字幕の画像を作る（HTML → Playwright で 1920×1080 の PNG）。見た目は v1（video/cards.mjs）と同じ。
// 使い方: node video/v2/cards.mjs   → video/v2/out/cards/ に書き出す
// edit.mjs からは renderFastForward（「早送り（実際は約○秒／分）」の札。実際の時間は録画から計る）を呼ぶ。
// フォントは BIZ UDゴシック（Windows に入っているものをそのまま使う）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES, DISCLAIMER, PUBLIC_URL } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CARDS = path.join(HERE, "out", "cards");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const BASE_CSS = `
  @font-face { font-family: "UDG"; src: local("BIZ UDGothic"), local("BIZ UDゴシック"); font-weight: 400; }
  @font-face { font-family: "UDG"; src: local("BIZ UDGothic Bold"), local("BIZ UDGothic"), local("BIZ UDゴシック"); font-weight: 700; }
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
  body { font-family: "BIZ UDGothic", "BIZ UDゴシック", "UDG", sans-serif; -webkit-font-smoothing: antialiased; }
`;
// v1 と同じ配色：黒に近い紺の地、生成りの文字、控えめな金茶の差し色
const INK = "#f3efe6";
const BG = "#14171c";
const ACCENT = "#c9a46a";
const PRED = "#d9b98a"; // 先代の側（暖かい色）
const SUCC = "#9cc3d9"; // 後継者の側（落ち着いた青）

function page(body, { transparent = false, css = "" } = {}) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${BASE_CSS}
    body { background: ${transparent ? "transparent" : BG}; color: ${INK}; }
    ${css}</style></head><body>${body}</body></html>`;
}

// ---- 0:12 左右の画面（先代／後継者）。台本の文を短くした箇条 ----
const PRED_LINES = ["できれば、継いでほしい", "大変だから、継がせたくない", "昔のように、強制はできない", "自分のやり方を、言葉にしにくい"];
const SUCC_LINES = ["本当は、興味がある", "継ぐべきか、揺れている", "同じ働き方は、続けたくない", "もっと広い世界で、挑戦したい"];

/** 左右の画面。p（0〜1）で、左右の言葉が中央に寄って薄くなり、中央の文が浮かぶ（0 のときは左右の画面そのもの） */
export function splitHtml(p = 0) {
  const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ゆっくり動き出して、ゆっくり止まる
  const shift = Math.round(60 * e); // 控えめに寄る（左右の言葉が重ならない範囲）
  const colOpacity = (1 - Math.min(1, e * 1.25)).toFixed(3);
  const lineOpacity = (1 - Math.min(1, e * 1.4)).toFixed(3);
  const q = Math.max(0, Math.min(1, (p - 0.4) / 0.6));
  const centerOpacity = (q * q * (3 - 2 * q)).toFixed(3);
  const col = (who, color, lines, dir) => `
    <section class="col" style="transform: translateX(${dir * shift}px); opacity: ${colOpacity};">
      <h2 style="color:${color}; border-color:${color}">${who}</h2>
      <ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>
    </section>`;
  return page(
    `<main>
      ${col("先代", PRED, PRED_LINES, 1)}
      <div class="divider" style="opacity:${lineOpacity}"></div>
      ${col("後継者", SUCC, SUCC_LINES, -1)}
    </main>
    <div class="center" style="opacity:${centerOpacity}">
      <p class="a">でも、心の芯は同じ。</p>
      <p class="b">「この事業を続けたい」</p>
    </div>`,
    {
      css: `main { position:absolute; left:0; right:0; top:0; height:780px; display:flex; align-items:flex-start; justify-content:center; padding-top: 110px; box-sizing: border-box; }
        .col { width: 790px; padding: 0 30px; box-sizing: border-box; }
        .col h2 { margin: 0 0 34px; font-size: 76px; font-weight: 700; letter-spacing: 0.12em; padding-bottom: 14px; border-bottom: 4px solid; display: inline-block; }
        .col ul { list-style: none; margin: 0; padding: 0; }
        .col li { white-space: nowrap; font-size: 46px; font-weight: 700; line-height: 1.35; margin: 0 0 30px; padding-left: 40px; position: relative; }
        .col li::before { content: ""; position: absolute; left: 4px; top: 0.5em; width: 14px; height: 14px; border-radius: 50%; background: ${ACCENT}; }
        .divider { width: 3px; height: 520px; background: rgba(243,239,230,0.28); margin: 20px 40px 0; }
        .center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
        .center p { margin: 0; font-weight: 700; letter-spacing: 0.05em; }
        .center .a { font-size: 80px; line-height: 1.7; }
        .center .b { font-size: 92px; line-height: 1.6; color: ${ACCENT}; }`,
    },
  );
}
export const CONVERGE_FRAMES = 75; // 2.5 秒（30fps）で寄る
export const convergeFrame = (i) => path.join(CARDS, "converge", `f${String(i).padStart(3, "0")}.png`);
export const CONVERGE_PATTERN = path.join(CARDS, "converge", "f%03d.png");

// ---- 1:42 4つの丸を線でつないだ図 ----
function circleHtml() {
  const nodes = [
    { x: 960, y: 140, label: "AI", color: ACCENT },
    { x: 560, y: 360, label: "先代", color: PRED },
    { x: 1360, y: 360, label: "後継者", color: SUCC },
    { x: 960, y: 560, label: "支援する人", color: "#b8d4b0", sub: "商工会・金融機関・専門家" },
  ];
  const R = 122;
  const pairs = [[0, 1], [0, 2], [1, 3], [2, 3], [1, 2], [0, 3]];
  const lines = pairs
    .map(([a, b], i) => {
      const A = nodes[a];
      const B = nodes[b];
      const dash = i >= 4 ? ' stroke-dasharray="10 12" opacity="0.55"' : "";
      return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${INK}" stroke-width="4"${dash} />`;
    })
    .join("");
  const circles = nodes
    .map(
      (n) => `<circle cx="${n.x}" cy="${n.y}" r="${R}" fill="${BG}" stroke="${n.color}" stroke-width="7" />
        <text x="${n.x}" y="${n.y + (n.label === "AI" ? 25 : n.label.length > 3 ? 14 : 18)}" text-anchor="middle" font-size="${n.label === "AI" ? 72 : n.label.length > 3 ? 42 : 54}"${n.label === "AI" ? " letter-spacing=\"2\" font-family=\"Segoe UI, Arial, sans-serif\"" : ""} font-weight="700" fill="${INK}">${n.label}</text>
        ${n.sub ? `<text x="${n.x}" y="${n.y + R + 54}" text-anchor="middle" font-size="38" fill="${INK}" opacity="0.92">${n.sub}</text>` : ""}`,
    )
    .join("");
  return page(`<svg width="1920" height="1080" viewBox="0 0 1920 1080" style="font-family: 'BIZ UDGothic','BIZ UDゴシック','UDG',sans-serif">${lines}${circles}</svg>`);
}

/** 黒地の画面 */
export const CARD_HTML = {
  misunderstanding: page(`<main><p>事業承継は、</p><p>お互いの<em>「勘違い」</em>から</p><p>崩れていく。</p></main>`, {
    css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
      p { margin: 0; font-size: 84px; font-weight: 700; line-height: 1.7; letter-spacing: 0.05em; }
      em { font-style: normal; color: ${ACCENT}; }`,
  }),
  split: splitHtml(0),
  circle: circleHtml(),
  closing: page(`<main><p class="a">勘違いを、理解に。</p><p class="b">先代と後継者と AI で、家業の次の形を。</p></main>`, {
    css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
      p { margin: 0; font-weight: 700; letter-spacing: 0.05em; }
      .a { font-size: 104px; line-height: 1.6; color: ${ACCENT}; }
      .b { margin-top: 30px; font-size: 62px; line-height: 1.6; }`,
  }),
  logo: page(
    `<main><p class="logo">TSUGU AI</p><p class="sub">先代と後継者が、AI と話して理解し合う事業承継</p><p class="url">${PUBLIC_URL}</p></main>`,
    {
      css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        .logo { margin: 0; font-size: 150px; font-weight: 700; letter-spacing: 0.12em; color: ${INK}; }
        .sub { margin: 26px 0 0; font-size: 40px; opacity: 0.9; }
        .url { margin: 40px 0 0; font-size: 44px; color: ${ACCENT}; letter-spacing: 0.03em; }`,
    },
  ),
  credit: page(`<main><p>Built with Claude（Claude Opus 5.5）</p><p>デモの会社・人物・数字は架空です</p></main>`, {
    css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
      p { margin: 0; font-size: 38px; line-height: 1.9; opacity: 0.9; }`,
  }),
};

/** 大きな字幕（画面の下3分の1、半透明の帯の上。v1 と同じ） */
export function captionHtml(text) {
  return page(`<div class="band"><p>${escapeHtml(text)}</p></div>`, {
    transparent: true,
    css: `.band { position: absolute; left: 0; right: 0; top: 806px; height: 176px; background: rgba(16, 19, 24, 0.74);
        display: flex; align-items: center; justify-content: center; }
      .band p { margin: 0; max-width: 1760px; text-align: center; font-size: 60px; font-weight: 700; line-height: 1.35;
        color: #fffdf8; letter-spacing: 0.03em; text-shadow: 0 2px 6px rgba(0,0,0,0.5); }`,
  });
}

/** 左下にずっと出す「デモ用の架空の会社・人物・数字です」 */
export const DISCLAIMER_HTML = page(`<p class="d">${DISCLAIMER}</p>`, {
  transparent: true,
  css: `.d { position: absolute; left: 26px; bottom: 22px; margin: 0; padding: 8px 16px; border-radius: 8px;
      background: rgba(16, 19, 24, 0.66); color: #fffdf8; font-size: 28px; font-weight: 400; letter-spacing: 0.02em; }`,
});

/** 右上の「早送り（実際は約○秒／分）」 */
export function fastForwardHtml(text) {
  return page(`<p class="ff"><span class="mark">▶▶</span>${escapeHtml(text)}</p>`, {
    transparent: true,
    css: `.ff { position: absolute; right: 30px; top: 26px; margin: 0; padding: 12px 22px; border-radius: 10px;
        background: rgba(16, 19, 24, 0.78); color: #fffdf8; font-size: 40px; font-weight: 700; letter-spacing: 0.02em; }
      .ff .mark { color: ${ACCENT}; margin-right: 12px; font-size: 32px; vertical-align: 3px; }`,
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** HTML の一覧を PNG にする。items: [{ html, file, transparent }] */
export async function renderAll(items) {
  const { chromium } = await import("playwright-core");
  fs.mkdirSync(CARDS, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const pg = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    for (const it of items) {
      fs.mkdirSync(path.dirname(it.file), { recursive: true });
      await pg.setContent(it.html, { waitUntil: "load" });
      await pg.evaluate(() => document.fonts.ready);
      await pg.screenshot({ path: it.file, omitBackground: !!it.transparent });
    }
  } finally {
    await browser.close();
  }
}

export const captionFile = (sceneId, i) => path.join(CARDS, `caption-${sceneId}-${i}.png`);
export const cardFile = (name) => path.join(CARDS, `card-${name}.png`);
export const DISCLAIMER_FILE = path.join(CARDS, "disclaimer.png");

export async function renderFastForward(list) {
  await renderAll(list.map((x) => ({ html: fastForwardHtml(x.text), file: x.file, transparent: true })));
}

// node video/v2/cards.mjs → 文字の画面・字幕・左下の表示・寄るコマを書き出す
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = [];
  for (const [name, html] of Object.entries(CARD_HTML)) items.push({ html, file: cardFile(name) });
  for (const s of SCENES) s.captions.forEach((c, i) => items.push({ html: captionHtml(c.text), file: captionFile(s.id, i), transparent: true }));
  items.push({ html: DISCLAIMER_HTML, file: DISCLAIMER_FILE, transparent: true });
  for (let i = 0; i < CONVERGE_FRAMES; i++) items.push({ html: splitHtml(i / (CONVERGE_FRAMES - 1)), file: convergeFrame(i) });
  items.push({ html: fastForwardHtml("早送り（実際は約2分）"), file: path.join(CARDS, "ff-sample.png"), transparent: true });
  await renderAll(items);
  console.log(`${items.length} 枚を ${CARDS} に書きました`);
}
