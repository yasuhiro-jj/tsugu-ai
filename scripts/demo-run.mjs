// 3分デモの通し確認（画面操作版）。本物の Claude API を使う（AI 呼び出し 1回あたり 約20〜30回）。
// 使い方: node scripts/demo-run.mjs <baseURL> [出力フォルダ]
//   例: node scripts/demo-run.mjs https://tsugu-ai.vercel.app screenshots/demo-run-1
//   出力フォルダの既定は screenshots/demo-run-<日時>（screenshots/ は Git 対象外）
// 終了コード: 0=最後まで通り、認識差に資金繰りが出て、診断後の学習プランの1番目が「資金繰りの基本」で、
//               前のプラン／今のプランの比較表示が出た（診断前から資金繰りが1番目でも不合格にはしない）
//             1=最後まで通ったが期待と違う / 2=途中で止まった
//
// 進め方（ボタンを押して進める。API を直接呼ぶのは最後の確認の読み取りと後片付けだけ）
// 1. 先代として入る → 6テーマの面談（回答は scripts/demo-scenario.mjs）→ 要約を「この内容でOK」→ 共有の選択
// 2. 後継者として入る → 同じ
// 3. 学習プラン画面で「学習プランを作る」（診断前。「学びたいこと」は画面の初期値のまま）
// 4. 比較画面で「AIに認識差を整理してもらう」
// 5. 学習プランを作り直し、前のプラン／今のプランの比較表示を確かめる
// 6. 90日計画画面で「90日計画の下書きを作る」
// 7. 診断・学習・90日計画を幅375pxでも撮り、横のはみ出しを調べる
// 8. 追加の確認（失敗しても止めずに記録。NG があれば終了コード1）：伸びる余地の欄／資料（8章・銀行・下書き）／
//    後継者で AI参謀と講座の質問／その3画面の幅375px／先代に切り替えて AI参謀に後継者の会話が出ないこと
// 手順ごとに画面全体を撮る。画面にエラーが出たら（AI の一時エラーなど）少し待って同じ操作をやり直し、回数を数える。
// 最後に「デモをやり直す」と同じ API でこのデモのデータを消す（KEEP_DATA=1 なら残す）。

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { SCENARIO, FOLLOWUP_REPLY, EXPECT } from "./demo-scenario.mjs";

const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("使い方: node scripts/demo-run.mjs <baseURL> [出力フォルダ]");
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const OUT = path.resolve(process.argv[3] ?? path.join("screenshots", `demo-run-${stamp}`));
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

// lib/themes.ts の見出し（画面の表示）と key の対応。lib/themes.ts を変えたらここも合わせる
const THEME_BY_LABEL = {
  経営方針: "policy",
  取引先: "suppliers",
  業務の勘どころ: "operations",
  人材: "people",
  資金繰り: "cashflow",
  相手にまだ伝えていない気持ち: "closing",
};
const ROLE_LABEL = { predecessor: "先代", successor: "後継者" };

const STALL_MS = 150_000; // 画面が変わらないまま待つ上限（AI の返事は30秒以上かかることがある）
const MAX_RETRIES = 6; // 1回の通しで、エラー表示からのやり直しの上限
const MAX_REPLIES_PER_THEME = 6; // 1テーマで送る回答の上限（AI がまとめに進まないときの打ち切り）

const timings = []; // { name, sec }
let retries = 0;
const retryLog = [];
let shotNo = 0;
const result = {
  gaps: [], cashflowGap: false, directions: {}, firstBefore: null, firstAfter: null, compared: false,
  usedDiagnosis: null, actions: [], planCount: null, mobile: [],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ja-JP" });
const page = await ctx.newPage();
page.setDefaultTimeout(30_000);

async function shot(name) {
  shotNo += 1;
  const file = path.join(OUT, `${String(shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function step(name, fn) {
  const t0 = Date.now();
  console.log(`--- ${name}`);
  await fn();
  const sec = Math.round((Date.now() - t0) / 1000);
  timings.push({ name, sec });
  console.log(`    ${name}: ${sec}秒`);
}

function noteRetry(where, message) {
  retries += 1;
  retryLog.push(`${where}: ${message}`);
  console.log(`    （やり直し ${retries} 回目）${where}: ${message}`);
  if (retries > MAX_RETRIES) throw new Error(`やり直しが上限（${MAX_RETRIES}回）を超えました。最後のエラー: ${message}`);
}

/** 面談画面の今の様子を1回で読み取る */
function readInterview() {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const text = (el) => (el ? el.textContent.trim() : "");
    const err = q(".interview .error-box [role=alert]");
    const share = q(".share-choice");
    const summary = q(".summary-card:not(.share-choice)");
    const okBtn = summary
      ? [...summary.querySelectorAll("button")].find((b) => b.textContent.trim() === "この内容でOK")
      : null;
    const ta = q(".chat__input");
    const submit = q(".chat__form button[type=submit]");
    const bubbles = [...document.querySelectorAll(".chat__log .bubble")];
    const last = bubbles[bubbles.length - 1];
    const who = text(q(".interview__who"));
    const m = who.match(/いまのテーマ：(.+?)）/);
    return {
      loading: !q(".interview"),
      error: err ? text(err) : null,
      retryStart: !!err && [...document.querySelectorAll(".error-box button")].some((b) => b.textContent.includes("もう一度試す")),
      finished: !!q(".finished"),
      share: share ? text(share.querySelector(".summary-card__theme")) : null,
      shareBusy: share ? text(share.querySelector(".button-row button")).includes("保存しています") : false,
      summary: summary ? text(summary.querySelector(".summary-card__theme")) : null,
      summaryOk: !!okBtn && !okBtn.disabled,
      themeLabel: m ? m[1] : null,
      thinking: !!q(".bubble--thinking"),
      myCount: document.querySelectorAll(".chat__log .bubble--me:not(.bubble--pending)").length,
      lastIsAi: !!last && last.classList.contains("bubble--ai") && !last.classList.contains("bubble--thinking"),
      inputReady: !!ta && !ta.disabled && !ta.readOnly && !!submit && submit.textContent.trim() === "送信",
      draft: ta ? ta.value : "",
    };
  });
}

const labelFrom = (s) => (s ?? "").replace(/^テーマ：/, "").replace(/（確定しました）$/, "").trim();

async function interview(role) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `${ROLE_LABEL[role]}として入る` }).click();
  await page.waitForURL(/\/interview$/, { timeout: 30_000 });

  const answers = SCENARIO[role];
  const replies = {}; // theme key → 送った回答の数
  const shotThemes = new Set();
  let lastChange = Date.now();
  let lastSig = "";

  for (let guard = 0; guard < 2000; guard++) {
    const s = await readInterview();
    const sig = JSON.stringify(s);
    if (sig !== lastSig) {
      lastSig = sig;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > STALL_MS) {
      throw new Error(`${ROLE_LABEL[role]}の面談で画面が ${STALL_MS / 1000} 秒変わりません（テーマ: ${s.themeLabel ?? "不明"}）`);
    }

    if (s.loading || s.thinking || s.shareBusy) {
      await sleep(700);
      continue;
    }

    if (s.error) {
      const where = `${ROLE_LABEL[role]}の面談（${s.themeLabel ?? labelFrom(s.share ?? s.summary) ?? "不明"}）`;
      noteRetry(where, s.error);
      await sleep(4000);
      if (s.retryStart) await page.getByRole("button", { name: "もう一度試す" }).click();
      else if (s.share) await page.locator(".share-choice .button-row button").click();
      else if (s.summaryOk) await page.locator(".summary-card").getByRole("button", { name: "この内容でOK" }).click();
      else if (s.inputReady && s.draft.trim()) await page.locator(".chat__form button[type=submit]").click();
      else await page.reload({ waitUntil: "networkidle" }); // 押し直す先が無いときは読み込み直す
      await sleep(1000);
      continue;
    }

    if (s.finished) break;

    if (s.share) {
      const key = THEME_BY_LABEL[labelFrom(s.share)];
      if (!key) throw new Error(`共有の選択で、知らないテーマ名です: ${s.share}`);
      const shareIt = answers[key].share;
      await page.locator(".share-choice .choice").nth(shareIt ? 0 : 1).click();
      const btn = page.locator(".share-choice .button-row button");
      await btn.click();
      await page.waitForFunction(() => !document.querySelector(".share-choice") || document.querySelector(".error-box"), null, { timeout: 60_000 }).catch(() => {});
      await sleep(500);
      continue;
    }

    if (s.summary) {
      if (!s.summaryOk) {
        await sleep(500);
        continue;
      }
      const key = THEME_BY_LABEL[labelFrom(s.summary)];
      if (!shotThemes.has(key)) {
        shotThemes.add(key);
        await shot(`${role}-${key}-summary`);
      }
      await page.locator(".summary-card").getByRole("button", { name: "この内容でOK" }).click();
      await page.waitForFunction(() => document.querySelector(".share-choice") || document.querySelector(".error-box"), null, { timeout: 60_000 }).catch(() => {});
      continue;
    }

    if (s.inputReady && s.lastIsAi) {
      const key = THEME_BY_LABEL[s.themeLabel];
      if (!key) throw new Error(`面談で、知らないテーマ名です: ${s.themeLabel}`);
      const n = s.myCount;
      if (n >= MAX_REPLIES_PER_THEME) throw new Error(`${ROLE_LABEL[role]}の「${s.themeLabel}」で、回答 ${n} 回でもまとめに進みません`);
      const text = n === 0 ? answers[key].answer : FOLLOWUP_REPLY;
      await page.locator(".chat__input").fill(text);
      await page.locator(".chat__form button[type=submit]").click();
      replies[key] = (replies[key] ?? 0) + 1;
      // 送信が始まった（入力欄が空になった）か、エラーが出るまで待つ
      await page.waitForFunction(() => {
        const ta = document.querySelector(".chat__input");
        return (ta && ta.value === "") || document.querySelector(".error-box");
      }, null, { timeout: 10_000 });
      continue;
    }

    await sleep(700);
  }

  await shot(`${role}-interview-done`);

  // 確認（読み取りのみ）：6テーマが確定し、共有の可否がシナリオどおりか
  const res = await ctx.request.get(BASE + "/api/interview");
  const st = (await res.json()).state;
  if (!st?.finished) throw new Error(`${ROLE_LABEL[role]}の面談が終わっていません`);
  for (const t of st.themes) {
    if (t.status !== "confirmed") throw new Error(`${ROLE_LABEL[role]}の「${t.label}」が確定していません（${t.status}）`);
    if (t.shared !== answers[t.key].share) throw new Error(`${ROLE_LABEL[role]}の「${t.label}」の共有がシナリオと違います（${t.shared}）`);
  }
  console.log(`    回答数: ${Object.entries(replies).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

/** ボタンを押して AI の結果を待つ（ボタンの「処理中」が終わるまで）。エラー表示ならやり直す */
async function pressAndWait({ where, button, done, errorSel }) {
  for (;;) {
    const el = await button().elementHandle();
    await el.click();
    // 押したボタンが処理中になる → 処理中が終わる（またはボタンが消える）まで待つ
    await page.waitForFunction((b) => !b.isConnected || b.getAttribute("aria-busy") === "true", el, { timeout: 5_000 }).catch(() => {});
    await page.waitForFunction((b) => !b.isConnected || b.getAttribute("aria-busy") !== "true", el, { timeout: STALL_MS, polling: 500 });
    await sleep(500);
    if ((await page.locator(errorSel).count()) > 0) {
      const msg = (await page.locator(errorSel).first().textContent())?.trim() ?? "";
      noteRetry(where, msg);
      await sleep(4000);
      continue;
    }
    await page.waitForSelector(done, { timeout: 15_000 });
    return;
  }
}

// 講座の題名に番号が付いていても（旧表示「1. 資金繰りの基本」）比べられるように、先頭の番号を外す
const stripNo = (s) => (s ?? "").replace(/^\d+[.．]\s*/, "").trim();

/** 学習プラン画面で作る／作り直す。今のプランの1番目と、前のプランとの比較表示の有無を返す */
async function makeLearningPlan(tag) {
  await page.goto(BASE + "/learning", { waitUntil: "networkidle" });
  await shot(`learning-${tag}-before`);
  await pressAndWait({
    where: `学習プラン（${tag}）`,
    button: () => page.locator("section[aria-labelledby=wants-title] .button-row button"),
    done: "section[aria-labelledby=plan-title] .plan-list",
    errorSel: "section[aria-labelledby=wants-title] .form-error",
  });
  const sec = page.locator("section[aria-labelledby=plan-title]");
  const compared = (await sec.locator(".plan-compare").count()) > 0;
  const cur = compared ? sec.locator(".compare-col--successor") : sec;
  const first = stripNo(await cur.locator(".plan-item__title").first().textContent());
  const usedDiagnosis = (await sec.locator(".diag-used").count()) > 0;
  await shot(`learning-${tag}`);
  return { first, compared, usedDiagnosis };
}

/** 幅375px で撮り、横のはみ出しを調べる（はみ出している一番内側の要素を最大5つ） */
async function mobileCheck(name, url) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  const file = await shot(`${name}-sp375`);
  const r = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth > cw;
    const over = [...document.body.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > cw + 1);
    const leaves = over.filter((e) => !over.some((o) => o !== e && e.contains(o)));
    const desc = (e) =>
      `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).join(".") : ""}「${(e.textContent ?? "").trim().slice(0, 20)}」(右端${Math.round(e.getBoundingClientRect().right)}px)`;
    return { overflow, sw: document.documentElement.scrollWidth, cw, elements: leaves.slice(0, 5).map(desc) };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  return { name, file, ...r };
}

// ---- 追加の確認（伸びる余地・資料・AI参謀・講座の質問・AI参謀の漏えい）。失敗しても止めずに記録する ----
const extra = []; // { name, ok, detail }
const quotes = {}; // 報告用の引用
const ASSERTIVE = /通ります|必ず|間違いなく|確実に|保証します|借りられます|融資が受けられ|継ぐべき|継がないべき/;

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    const ok = r?.ok !== false;
    extra.push({ name, ok, detail: r?.detail ?? "" });
    console.log(`    ${ok ? "OK " : "NG "} ${name}${r?.detail ? `：${r.detail}` : ""}（${Math.round((Date.now() - t0) / 1000)}秒）`);
  } catch (err) {
    extra.push({ name, ok: false, detail: `途中で失敗：${err instanceof Error ? err.message.split("\n")[0] : String(err)}` });
    console.log(`    NG  ${name}：途中で失敗 ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    await shot(`failed-${name.replace(/[^\w-]/g, "")}`).catch(() => {});
  }
}

async function switchRole(role) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: `${ROLE_LABEL[role]}として入る` }).click();
  await page.waitForURL(/\/interview$/, { timeout: 30_000 });
}

let advisorSent = null;

async function extraSteps() {
  console.log("--- 追加の確認");
  // a. 比較画面の「伸びる余地」
  await check("a 伸びる余地の欄", async () => {
    await page.goto(BASE + "/compare", { waitUntil: "networkidle" });
    const sec = page.locator("section[aria-labelledby=upside-title]");
    if ((await sec.count()) === 0) return { ok: false, detail: "欄が出ていない" };
    const text = (await sec.textContent()) ?? "";
    const has122 = /[+＋]\s*122/.test(text);
    const has358 = /[+＋]\s*358/.test(text);
    await sec.scrollIntoViewIfNeeded();
    await shot("upside-page");
    await sec.screenshot({ path: path.join(OUT, `${String(++shotNo).padStart(2, "0")}-upside-section.png`) });
    return { ok: has122 && has358, detail: `+122: ${has122 ? "あり" : "なし"}／+358: ${has358 ? "あり" : "なし"}` };
  });

  // b. 資料（決算サマリー8章・銀行向け相談用資料）
  await check("b 資料を作る", async () => {
    await page.goto(BASE + "/report", { waitUntil: "networkidle" });
    await shot("report-before");
    await pressAndWait({
      where: "資料",
      button: () => page.getByRole("button", { name: "資料を作る" }),
      done: "#report-ch8",
      errorSel: "section[aria-labelledby=report-create-title] .form-error",
    });
    const r = await page.evaluate(() => {
      const heads = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => document.getElementById(`report-ch${n}`)?.textContent.trim() ?? null);
      const ch8 = document.getElementById("report-ch8")?.closest("section");
      const h4 = ch8 ? [...ch8.querySelectorAll("h4")].find((h) => h.textContent.includes("銀行に相談すること")) : null;
      const ul = h4?.nextElementSibling;
      const bank = ul && ul.tagName === "UL" ? [...ul.querySelectorAll("li")].map((li) => li.textContent.trim()) : [];
      const body = document.body.innerText;
      const bankDoc = document.querySelector("section[aria-labelledby=report-bank-title]")?.textContent ?? "";
      return { heads, bank, ch8: ch8?.innerText ?? "", draft: body.includes("下書き"), all: (ch8?.innerText ?? "") + bankDoc };
    });
    quotes.ch8 = r.ch8;
    quotes.reportAssertive = (r.all.match(new RegExp(ASSERTIVE.source, "g")) ?? []).join("、");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, `${String(++shotNo).padStart(2, "0")}-report-top.png`) });
    await page.locator("#report-ch8").evaluate((el) => el.scrollIntoView());
    await page.locator("section:has(> #report-ch8)").screenshot({ path: path.join(OUT, `${String(++shotNo).padStart(2, "0")}-report-ch8.png`) });
    await shot("report-full");
    const headsOk = r.heads.every(Boolean);
    return {
      ok: headsOk && r.bank.length > 0 && r.draft,
      detail: `8章の見出し: ${headsOk ? "そろっている" : `欠け（${r.heads.map((h, i) => (h ? "" : `第${i + 1}章`)).filter(Boolean).join("・")}）`}／第8章の銀行の箇条書き: ${r.bank.length}件／「下書き」表示: ${r.draft ? "あり" : "なし"}／断定表現の候補: ${quotes.reportAssertive || "なし"}`,
    };
  });

  // c. 後継者で AI参謀（例のボタンを1つ押して送る）
  await check("c AI参謀（後継者）", async () => {
    await page.goto(BASE + "/advisor", { waitUntil: "networkidle" });
    const chat = page.locator("section[aria-labelledby=advisor-chat-title]");
    const ex = chat.locator("ul li button").first();
    advisorSent = ((await ex.textContent()) ?? "").trim();
    await ex.click();
    await pressAndWait({
      where: "AI参謀",
      button: () => chat.locator(".chat__form button[type=submit]"),
      done: "section[aria-labelledby=advisor-chat-title] .chat__log .bubble--ai:not(.bubble--thinking)",
      errorSel: "section[aria-labelledby=advisor-chat-title] .chat__form .form-error",
    });
    const ai = chat.locator(".chat__log .bubble--ai:not(.bubble--thinking)").last();
    const text = ((await ai.innerText()) ?? "").trim();
    const hasPoints = text.includes("整理した論点");
    const consult = (await ai.locator(".badge--expert").count()) > 0 ? ((await ai.locator(".badge--expert").first().textContent()) ?? "").trim() : null;
    quotes.advisor = text;
    // 漏えい確認の目印：返事の本文の先頭30文字（読み上げ用の「AI参謀：」を含まない）
    quotes.advisorFirst = ((await ai.locator("p").first().textContent()) ?? "").trim().slice(0, 30);
    quotes.advisorAssertive = (text.match(new RegExp(ASSERTIVE.source, "g")) ?? []).join("、");
    await shot("advisor-successor");
    return {
      ok: text.length > 0 && hasPoints && !!consult,
      detail: `送った文「${advisorSent}」／返事: あり／論点: ${hasPoints ? "あり" : "なし"}／相談先の札: ${consult ?? "なし"}／断定表現の候補: ${quotes.advisorAssertive || "なし"}`,
    };
  });

  // d. 後継者で講座の記事1に質問する
  await check("d 講座の記事1に質問", async () => {
    await page.goto(BASE + "/learning/cashflow", { waitUntil: "networkidle" });
    const panel = page.locator("#article-1 + div");
    await panel.getByRole("button", { name: "この記事についてAIに質問する" }).click();
    const ex = panel.locator("ul li button").first();
    const q = ((await ex.textContent()) ?? "").trim();
    await ex.click();
    await pressAndWait({
      where: "講座の質問",
      button: () => panel.locator("form button[type=submit]"),
      done: "#article-1 + div .explain",
      errorSel: "#article-1 + div .form-error",
    });
    const ans = ((await panel.locator(".explain").innerText()) ?? "").trim();
    quotes.ask = ans;
    await panel.scrollIntoViewIfNeeded();
    await shot("course-ask");
    return { ok: ans.length > 0, detail: `質問「${q}」／答え: ${ans ? "出た" : "出ない"}` };
  });

  // f. b〜d の画面を幅375pxで
  await check("f 幅375px（資料・AI参謀・講座）", async () => {
    const rs = [];
    for (const [name, url] of [
      ["report", "/report"],
      ["advisor", "/advisor"],
      ["course-cashflow", "/learning/cashflow"],
    ]) {
      rs.push(await mobileCheck(name, url));
    }
    result.mobile.push(...rs);
    const bad = rs.filter((m) => m.overflow);
    return { ok: bad.length === 0, detail: bad.length ? bad.map((m) => `${m.name}: ${m.elements.join("、")}`).join("／") : "3画面ともはみ出しなし" };
  });

  // e. 先代に切り替えて AI参謀を開き、後継者の会話が出ないこと（受け取った応答すべてを調べる）
  await check("e 先代の AI参謀に後継者の会話が出ない", async () => {
    if (!advisorSent) return { ok: false, detail: "c が失敗したため確認できない" };
    await switchRole("predecessor");
    const bodies = [];
    const pend = [];
    const onRes = (res) => pend.push(res.text().then((b) => bodies.push({ url: res.url(), b })).catch(() => {}));
    page.on("response", onRes);
    await page.goto(BASE + "/advisor", { waitUntil: "networkidle" });
    await Promise.all(pend);
    page.off("response", onRes);
    const rsc = await ctx.request.get(BASE + "/advisor", { headers: { RSC: "1" } });
    bodies.push({ url: "/advisor (RSC)", b: await rsc.text() });
    const marker = quotes.advisorFirst ?? "";
    const hits = bodies.filter((x) => x.b.includes(advisorSent) || (marker && x.b.includes(marker))).map((x) => x.url.replace(BASE, ""));
    // 例の文はボタンとして先代側にも出るため、会話の欄（.chat__log）の中だけを画面で見る
    const inLog = await page.locator("section[aria-labelledby=advisor-chat-title] .chat__log").innerText().catch(() => "");
    const logHit = inLog.includes(advisorSent);
    const aiHit = marker ? bodies.some((x) => x.b.includes(marker)) : false;
    await shot("advisor-predecessor");
    return {
      ok: !logHit && !aiHit,
      detail: `会話の欄に後継者の文: ${logHit ? "出た" : "出ない"}／応答に後継者への返事: ${aiHit ? "出た" : "出ない"}${hits.length ? `（送った文と同じ文字列を含む応答: ${hits.join(", ")}。例のボタンの可能性）` : ""}`,
    };
  });
}

const DIR_KEYS = [
  ["keep", "守りたいこと"],
  ["improve", "変えられること"],
  ["tryNew", "新しく試したいこと"],
];

let exitCode = 0;
let stopShot = null;
try {
  await step("先代の面談と共有の選択", () => interview("predecessor"));
  await step("後継者の面談と共有の選択", () => interview("successor"));

  await step("診断前の学習プラン", async () => {
    result.firstBefore = (await makeLearningPlan("1-before-diagnosis")).first;
  });

  await step("比較と診断", async () => {
    await page.goto(BASE + "/compare", { waitUntil: "networkidle" });
    await shot("compare-before");
    await pressAndWait({
      where: "診断",
      button: () => page.locator(".diagnosis-card__action button"),
      done: ".diagnosis-result .diagnosis",
      errorSel: ".diagnosis-card .form-error",
    });
    result.gaps = await page.$$eval(".diag-item--gap", (els) =>
      els.map((el) => ({
        importance: el.querySelector(".badge")?.textContent.trim() ?? "",
        theme: el.querySelector(".diag-item__theme")?.textContent.trim() ?? "",
        point: el.querySelector(".diag-item__point")?.textContent.trim() ?? "",
      })),
    );
    result.cashflowGap = result.gaps.some((g) => g.theme.includes(EXPECT.gapKeyword) || g.point.includes(EXPECT.gapKeyword));
    for (const [key] of DIR_KEYS) {
      result.directions[key] = await page.$$eval(`section[aria-labelledby="diag-directions-${key}"] .diag-item`, (els) =>
        els.map((el) => {
          const who = el.querySelector(".badge")?.textContent.trim() ?? "";
          return `${who ? `(${who})` : ""}${el.querySelector(".diag-item__point")?.textContent.trim() ?? ""}`;
        }),
      );
    }
    await shot("compare-diagnosis");
  });

  await step("診断後に学習プランを作り直す", async () => {
    const r = await makeLearningPlan("2-after-diagnosis");
    result.firstAfter = r.first;
    result.compared = r.compared;
    result.usedDiagnosis = r.usedDiagnosis;
  });

  await step("90日計画", async () => {
    await page.goto(BASE + "/plan", { waitUntil: "networkidle" });
    await shot("plan-before");
    await pressAndWait({
      where: "90日計画",
      button: () => page.locator("section[aria-labelledby=plan-create-title] .button-row button"),
      done: ".plan-progress__count",
      errorSel: "section[aria-labelledby=plan-create-title] .form-error",
    });
    result.actions = await page.$$eval(".timeline li.action", (els) =>
      els.map((el) => ({
        title: el.querySelector(".action__title")?.textContent.trim() ?? "",
        meta: el.querySelector(".action__head")?.textContent.replace(/\s+/g, " ").trim() ?? "",
      })),
    );
    result.planCount = result.actions.length;
    await shot("plan");
  });

  await step("幅375pxの確認", async () => {
    for (const [name, url] of [
      ["compare-diagnosis", "/compare"],
      ["learning-plan", "/learning"],
      ["plan", "/plan"],
    ]) {
      result.mobile.push(await mobileCheck(name, url));
    }
  });

  await step("追加の確認（伸びる余地・資料・AI参謀・講座の質問）", extraSteps);
} catch (err) {
  exitCode = 2;
  console.error("途中で止まりました:", err instanceof Error ? err.message : String(err));
  stopShot = await shot("stopped").catch(() => null);
} finally {
  if (process.env.KEEP_DATA !== "1") {
    await ctx.request.fetch(BASE + "/api/demo", { method: "DELETE", headers: { Origin: BASE } }).catch(() => {});
  }
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
}

const afterOk = result.firstAfter === EXPECT.firstCourseTitle;
const beforeSame = result.firstBefore === EXPECT.firstCourseTitle;
if (exitCode === 0 && !(result.cashflowGap && afterOk && result.compared)) exitCode = 1;
// 追加の確認に NG が1つでもあれば「通ったが期待と違う」
if (exitCode === 0 && extra.some((x) => !x.ok)) exitCode = 1;
const smallTry = result.actions.filter((a) => /試/.test(a.title));
const tryNewLunch = (result.directions.tryNew ?? []).some((t) => /ランチ|SNS/.test(t));
const dir = (k) => result.directions[k] ?? [];

const lines = [
  `診断に「${EXPECT.gapKeyword}」の認識差: ${result.cashflowGap ? "出た" : "出なかった"}`,
  `認識差の見出し: ${result.gaps.length ? result.gaps.map((g) => `[${g.importance}] ${g.theme}｜${g.point}`).join(" ／ ") : "（なし）"}`,
  ...DIR_KEYS.map(([k, label]) => `これからの選択肢・${label}（${k}）: ${dir(k).length}件 ${dir(k).join(" ／ ")}`),
  `後継者の「ランチとSNS」が tryNew に: ${tryNewLunch ? "入った" : "入っていない"}`,
  `診断前のプランの1番目: ${result.firstBefore ?? "（なし）"}${beforeSame ? "（診断前から資金繰りが1番目＝変化が見えない）" : ""}`,
  `診断後のプランの1番目: ${result.firstAfter ?? "（なし）"}（「${EXPECT.firstCourseTitle}」か: ${afterOk ? "はい" : "いいえ"}、診断の反映表示: ${result.usedDiagnosis === null ? "-" : result.usedDiagnosis ? "あり" : "なし"}）`,
  `前のプラン／今のプランの比較表示: ${result.compared ? "出た" : "出なかった"}`,
  `90日計画の件数: ${result.planCount ?? "（なし）"}（「試」を含む行動: ${smallTry.length}件）`,
  ...result.actions.map((a, i) => `  行動${i + 1}: ${a.title}  [${a.meta}]`),
  ...result.mobile.map(
    (m) => `幅375px ${m.name}: ${m.overflow ? `はみ出しあり（scrollWidth ${m.sw} > ${m.cw}）${m.elements.join("、")}` : "はみ出しなし"}  ${m.file}`,
  ),
  ...extra.map((x) => `追加 ${x.ok ? "OK" : "NG"} ${x.name}: ${x.detail}`),
  ...(quotes.ch8 ? [`  第8章の本文: ${quotes.ch8.replace(/\s*\n\s*/g, " ／ ").slice(0, 400)}`] : []),
  ...(quotes.advisor ? [`  AI参謀の返事: ${quotes.advisor.replace(/\s*\n\s*/g, " ／ ").slice(0, 500)}`] : []),
  ...(quotes.ask ? [`  講座の質問の答え: ${quotes.ask.replace(/\s*\n\s*/g, " ／ ").slice(0, 300)}`] : []),
  `所要時間: ${timings.map((t) => `${t.name} ${t.sec}秒`).join(" ／ ")}（合計 ${timings.reduce((a, t) => a + t.sec, 0)}秒）`,
  `AI の一時エラーなどでやり直した回数: ${retries}${retryLog.length ? `（${retryLog.join(" ／ ")}）` : ""}`,
  ...(stopShot ? [`止まった画面: ${stopShot}`] : []),
  `画面写真: ${OUT}`,
  `判定: ${exitCode === 0 ? "0（最後まで通り、期待どおり）" : exitCode === 1 ? "1（通ったが期待と違う）" : "2（途中で停止）"}`,
];
console.log("\n" + lines.join("\n"));
fs.writeFileSync(path.join(OUT, "result.txt"), lines.join("\n") + "\n", "utf8");
process.exit(exitCode);
