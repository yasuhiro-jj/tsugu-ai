// タイトル・字幕の画像を作る（HTML → Playwright で 1920×1080 の PNG）。
// 使い方: node video/cards.mjs   → video/out/cards/ に書き出す
// edit.mjs からは renderFastForward（「早送り（実際は約○分）」の札。実際の時間は録画から計る）を呼ぶ。
// フォントは BIZ UDゴシック（C:/Windows/Fonts/BIZ-UDGothicR.ttc・B.ttc。Windows に入っているものをそのまま使う）。

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
// 落ち着いた配色：黒に近い紺の地、生成りの文字、控えめな金茶の差し色
const INK = "#f3efe6";
const BG = "#14171c";
const ACCENT = "#c9a46a";

function page(body, { transparent = false, css = "" } = {}) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${BASE_CSS}
    body { background: ${transparent ? "transparent" : BG}; color: ${INK}; }
    ${css}</style></head><body>${body}</body></html>`;
}

const center = (inner, extraCss = "") =>
  page(`<main>${inner}</main>`, {
    css: `main { position: absolute; left: 0; right: 0; top: 0; height: 760px; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center; } ${extraCss}`,
  });

/** 黒地の画面（問い・課題・締め・ロゴ・クレジット） */
export const CARD_HTML = {
  question: page(
    `<main><p>父の会社を継ぎたい。</p><p>でも、父が本当に何を考えているのか、</p><p>分からない。</p></main>`,
    {
      css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        p { margin: 0; font-size: 72px; font-weight: 700; line-height: 1.75; letter-spacing: 0.04em; }`,
    },
  ),
  stat: center(
    `<p class="label">後継者不在率</p><p class="num">50.1<span>%</span></p><p class="src">（2025年、帝国データバンク）</p>`,
    `.label { margin: 0; font-size: 56px; font-weight: 700; letter-spacing: 0.1em; }
     .num { margin: 10px 0 0; font-size: 200px; font-weight: 700; color: ${ACCENT}; line-height: 1.1; }
     .num span { font-size: 110px; margin-left: 8px; }
     .src { margin: 18px 0 0; font-size: 36px; opacity: 0.85; }`,
  ),
  head: center(
    `<p>経営の大事なことは、</p><p>先代の<em>頭の中だけ</em></p>`,
    `p { margin: 0; font-size: 84px; font-weight: 700; line-height: 1.6; letter-spacing: 0.04em; }
     em { font-style: normal; color: ${ACCENT}; }`,
  ),
  closing: page(
    `<main><p>見て覚える承継から、</p><p>理解し合える承継へ。</p></main>`,
    {
      css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        p { margin: 0; font-size: 84px; font-weight: 700; line-height: 1.7; letter-spacing: 0.05em; }`,
    },
  ),
  logo: page(
    `<main><p class="logo">TSUGU AI</p><p class="sub">先代と後継者が、AI と話して理解し合う事業承継</p><p class="url">${PUBLIC_URL}</p></main>`,
    {
      css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        .logo { margin: 0; font-size: 150px; font-weight: 700; letter-spacing: 0.12em; color: ${INK}; }
        .sub { margin: 26px 0 0; font-size: 40px; opacity: 0.9; }
        .url { margin: 40px 0 0; font-size: 44px; color: ${ACCENT}; letter-spacing: 0.03em; }`,
    },
  ),
  credit: page(
    `<main><p>Built with Claude（Claude Opus 5.5）</p><p>デモの会社・人物・数字は架空です</p></main>`,
    {
      css: `main { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
        p { margin: 0; font-size: 38px; line-height: 1.9; opacity: 0.9; }`,
    },
  ),
};

/** 大きな字幕（画面の下3分の1、半透明の帯の上） */
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

/** 右上の「早送り（実際は約○分）」 */
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
  // list: [{ text, file }]
  await renderAll(list.map((x) => ({ html: fastForwardHtml(x.text), file: x.file, transparent: true })));
}

// node video/cards.mjs → 黒地の画面・字幕・左下の表示を書き出す
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const items = [];
  for (const [name, html] of Object.entries(CARD_HTML)) items.push({ html, file: cardFile(name) });
  for (const s of SCENES) s.captions.forEach((c, i) => items.push({ html: captionHtml(c.text), file: captionFile(s.id, i), transparent: true }));
  items.push({ html: DISCLAIMER_HTML, file: DISCLAIMER_FILE, transparent: true });
  // 見本（字幕が読めるかを目で確かめる用）
  items.push({ html: fastForwardHtml("早送り（実際は約2分）"), file: path.join(CARDS, "ff-sample.png"), transparent: true });
  await renderAll(items);
  console.log(`${items.length} 枚を ${CARDS} に書きました`);
}
