// 画面の見た目確認用：公開中（または指定 URL）のアプリを、パソコン幅とスマホ幅で撮影する。
// 使い方: node scripts/screenshots.mjs [baseURL] [出力フォルダ]
// デモデータ（架空）を API で作ってから各画面を撮り、最後に「デモをやり直す」で消す。
// ローカルの Chrome を使う（playwright-core。ブラウザのダウンロードはしない）。

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "https://tsugu-ai.vercel.app";
const OUT = process.argv[3] ?? "screenshots";
fs.mkdirSync(OUT, { recursive: true });

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ja-JP" });
const page = await ctx.newPage();
const api = async (method, p, body) => {
  const res = await ctx.request.fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", Origin: BASE },
    data: body ? JSON.stringify(body) : undefined,
    timeout: 130_000, // 診断・90日計画は AI の返事に30秒以上かかることがある
  });
  return res.json().catch(() => ({}));
};

const ANSWERS = {
  predecessor: ["味と常連さんを守りたい。法事の折詰と宴会は地域での役目だ", "出汁の取り方と常連さんの好み。メニューは息子が変えてもいい"],
  successor: ["ランチとSNSで若いお客さんを増やしたい", "まずはランチの定食を見直したい"],
};
const CASH = {
  predecessor: ["借入は毎月きちんと返している。宴会が入れば取り戻せる", "毎月20万くらいだったと思う"],
  successor: ["借入がいくらで、毎月いくら返しているか知らないです", "父か母に聞けば分かると思います"],
};
async function interview(role) {
  await api("POST", "/api/role", { role });
  let st = (await api("GET", "/api/interview")).state;
  for (let guard = 0; !st.finished && guard < 60; guard++) {
    if (st.pendingShareThemeKey) { st = (await api("POST", "/api/interview/share", { themeKey: st.pendingShareThemeKey, shared: st.pendingShareThemeKey !== "closing" })).state; continue; }
    const key = st.currentThemeKey;
    const t = st.themes.find((x) => x.key === key);
    if (t.status === "awaiting_confirmation") { st = (await api("POST", "/api/interview/summary", { themeKey: key, decision: "confirm" })).state; continue; }
    if (st.messages.length === 0) { st = (await api("POST", "/api/interview/start", {})).state; continue; }
    const n = st.messages.filter((m) => m.from === "me").length;
    const bank = key === "cashflow" ? CASH[role] : ANSWERS[role];
    const r = await api("POST", "/api/interview/message", { text: bank[n] ?? "それ以上は特にありません" });
    if (!r.ok) throw new Error(`${role}/${key}: ${r.error}`);
    st = r.state;
  }
}

async function shoot(name, url) {
  for (const [w, h, tag] of [[1280, 900, "pc"], [375, 812, "sp"]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(BASE + url, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`), fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${name}-${tag}${overflow ? "  ※横にはみ出しあり" : ""}`);
  }
}

await page.goto(BASE + "/");
await shoot("01-top", "/");
// 面談の途中画面（先代、最初のテーマ）
await api("POST", "/api/role", { role: "predecessor" });
await api("POST", "/api/interview/start", {});
await api("POST", "/api/interview/message", { text: ANSWERS.predecessor[0] });
await shoot("02-interview-pred", "/interview");
await api("DELETE", "/api/demo");
// 通しでデータを作る
await interview("predecessor");
await interview("successor");
await shoot("03-interview-done", "/interview");
await api("POST", "/api/learning/plan", {});
await api("POST", "/api/diagnosis", {});
await shoot("04-compare-diagnosis", "/compare");
await api("POST", "/api/learning/plan", {});
await api("POST", "/api/learning/quiz", { courseId: "cashflow", answers: { 1: "B", 2: "B", 3: "B", 4: "D", 5: "A" } });
await shoot("05-learning", "/learning");
await shoot("06-course", "/learning/costrate");
await api("POST", "/api/plan", {});
await shoot("07-plan", "/plan");
await api("DELETE", "/api/demo");
await browser.close();
console.log("done ->", OUT);
