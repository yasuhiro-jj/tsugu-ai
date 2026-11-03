// TSUGU AI 3分デモ動画の録画（本物の Claude API・Turso を公開 URL で通しながら、1920×1080 で画面を録画する）。
// 台本：video/storyboard.md。進め方と想定回答は scripts/demo-run.mjs・scripts/demo-scenario.mjs を流用（読むだけ。変更しない）。
//
// 使い方: node video/record.mjs [回数=1] [baseURL=https://tsugu-ai.vercel.app]
// 出力（video/out/ は Git 対象外）:
//   video/out/raw-<回数>.webm      録画（ブラウザの画面だけ。API キーなどは映らない）
//   video/out/timeline-<回数>.json 場面ごとの開始・終了（録画の先頭からの秒数）と、AI が実際に出した文
//   video/out/timeline.json        条件を満たした録画のときだけ、上と同じ内容をここにも書く（edit.mjs が読む）
//   video/out/record.log           1行ずつのログ（追記）
// 終了コード: 0=条件を満たした（資金繰りの認識差が重要度「高」、診断後の学習プランの1番目が「資金繰りの基本」）
//             1=最後まで（または診断まで）通ったが条件を満たさない → 撮り直し / 2=途中で止まった
// 上限: AI の返事を待つのは1回あたり 120 秒まで、全体で 30 分まで。超えたら止めて後片付け（DELETE /api/demo）する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIO, FOLLOWUP_REPLY, EXPECT } from "../scripts/demo-scenario.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 録画の書き出しには Playwright 用の ffmpeg が要る。video/node_modules の中に入れたものを使う
//   入れ方: PLAYWRIGHT_BROWSERS_PATH=video/node_modules/.ms-playwright node node_modules/playwright-core/cli.js install ffmpeg
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(HERE, "node_modules", ".ms-playwright");
const { chromium } = await import("playwright-core");
const OUT = path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });
const ATTEMPT = Number(process.argv[2] ?? "1") || 1;
const BASE = (process.argv[3] ?? "https://tsugu-ai.vercel.app").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const LOG = path.join(OUT, "record.log");

const AI_WAIT_MS = 120_000; // AI 1回あたりの待ちの上限
const TOTAL_MS = 30 * 60_000; // 全体の上限
const MAX_RETRIES = 6;
const MAX_REPLIES_PER_THEME = 6;
const W = 1920;
const H = 1080;

const THEME_BY_LABEL = {
  経営方針: "policy",
  取引先: "suppliers",
  業務の勘どころ: "operations",
  人材: "people",
  資金繰り: "cashflow",
  相手にまだ伝えていない気持ち: "closing",
};
const ROLE_LABEL = { predecessor: "先代", successor: "後継者" };
const FOCUS = new Set(["cashflow", "closing"]); // 動画で見せるテーマ（ゆっくり操作する）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T_START = Date.now();
let T0 = null; // 録画の先頭（ページを作った時刻）
const vt = () => (T0 === null ? 0 : Math.round((Date.now() - T0) / 10) / 100); // 録画の先頭からの秒数

function log(msg) {
  const line = `${new Date().toISOString().slice(11, 19)} [録画${ATTEMPT} +${vt().toFixed(2)}s] ${msg}`;
  fs.appendFileSync(LOG, line + "\n", "utf8");
  console.log(line);
}

function checkDeadline() {
  if (Date.now() - T_START > TOTAL_MS) throw new Error(`全体の上限（${TOTAL_MS / 60000}分）を超えました`);
}

const timeline = {
  attempt: ATTEMPT,
  base: BASE,
  startedAt: new Date().toISOString(),
  viewport: { width: W, height: H },
  note: "秒数は録画（raw-<回数>.webm）の先頭からの秒数。rect は画面上の位置（px、1920×1080）。AI の文は録画で実際に出たもの",
  scenes: {},
  ai: {},
  result: {},
  retries: [],
};
function scene(key) {
  timeline.scenes[key] ??= {};
  return timeline.scenes[key];
}
function mark(key, field, extra) {
  const s = scene(key);
  s[field] = vt();
  if (extra) Object.assign(s, extra);
  log(`場面 ${key}.${field} = ${s[field]}s`);
  saveTimeline();
}
function saveTimeline() {
  fs.writeFileSync(path.join(OUT, `timeline-${ATTEMPT}.json`), JSON.stringify(timeline, null, 2), "utf8");
}

let retries = 0;
function noteRetry(where, message) {
  retries += 1;
  timeline.retries.push({ t: vt(), where, message });
  log(`（やり直し ${retries} 回目）${where}: ${message}`);
  if (retries > MAX_RETRIES) throw new Error(`やり直しが上限（${MAX_RETRIES}回）を超えました。最後のエラー: ${message}`);
}

// ---- ブラウザ ----
log(`開始 ${BASE}`);
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
  deviceScaleFactor: 1,
  locale: "ja-JP",
});
// 録画にはマウスの矢印が映らないため、画面の上に小さな矢印を重ねる（アプリのコードは変えない。録画の中だけ）
await ctx.addInitScript(() => {
  const add = () => {
    if (document.getElementById("__rec_cursor")) return;
    const c = document.createElement("div");
    c.id = "__rec_cursor";
    c.innerHTML =
      '<svg width="28" height="34" viewBox="0 0 28 34"><path d="M2 2 L2 28 L9 21 L14 32 L19 30 L14 19 L24 19 Z" fill="#fff" stroke="#222" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: "fixed", left: "0px", top: "0px", zIndex: "2147483647", pointerEvents: "none",
      transform: `translate(${window.__recX ?? -50}px, ${window.__recY ?? -50}px)`,
    });
    const ring = document.createElement("div");
    ring.id = "__rec_ring";
    Object.assign(ring.style, {
      position: "fixed", width: "44px", height: "44px", marginLeft: "-22px", marginTop: "-22px", borderRadius: "50%",
      border: "3px solid rgba(40,110,200,0.7)", zIndex: "2147483646", pointerEvents: "none", opacity: "0",
      transition: "opacity 0.35s ease-out",
    });
    document.documentElement.appendChild(c);
    document.documentElement.appendChild(ring);
    window.addEventListener("mousemove", (e) => {
      window.__recX = e.clientX;
      window.__recY = e.clientY;
      c.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 2}px)`;
    }, true);
    window.addEventListener("mousedown", (e) => {
      ring.style.left = e.clientX + "px";
      ring.style.top = e.clientY + "px";
      ring.style.transition = "none";
      ring.style.opacity = "1";
      requestAnimationFrame(() => {
        ring.style.transition = "opacity 0.45s ease-out";
        ring.style.opacity = "0";
      });
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
  else add();
});
const page = await ctx.newPage();
T0 = Date.now();
page.setDefaultTimeout(30_000);
log("録画を始めました（ここが録画の 0 秒）");
// 時刻合わせ：録画の先頭は、ページを作った時刻から少し（約0.5秒）遅れて始まる。赤一色の画面を出した時刻を残し、
// edit.mjs が録画の中で赤い画面が最初に映った時刻と比べて、ずれ（calib.offset）を直す
await sleep(800);
await page.setContent('<body style="margin:0;background:#ff0000"></body>');
timeline.calib = { redAt: vt() };
await sleep(800);
await page.setContent('<body style="margin:0;background:#f7f3eb"></body>');

// 全体の上限を超えたら、後片付けをして終わる（どこで止まっていても）
let finishing = false;
const hardStop = setTimeout(async () => {
  if (finishing) return;
  log(`全体の上限（${TOTAL_MS / 60000}分）を超えたため止めます`);
  await cleanup().catch(() => {});
  process.exit(2);
}, TOTAL_MS + 60_000);

// ---- 見せ方の道具（ゆっくりしたマウスとスクロール） ----
let mouse = { x: W / 2, y: H / 2 };
async function moveTo(locator, ms = 900) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps = Math.max(12, Math.round(ms / 20));
  const from = { ...mouse };
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ゆっくり動き出して、ゆっくり止まる
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(ms / steps);
  }
  mouse = to;
}
async function slowClick(locator, ms = 900) {
  await moveTo(locator, ms);
  await sleep(250);
  await locator.click();
}
/** 要素を画面の上から top px の位置へ、ms ミリ秒かけてスクロールする（はみ出す分は端で止まる） */
async function scrollToEl(locator, { top = 140, ms = 1200 } = {}) {
  const h = await locator.elementHandle();
  if (!h) return;
  await page.evaluate(
    ([el, top, ms]) =>
      new Promise((resolve) => {
        const r = el.getBoundingClientRect();
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const target = Math.max(0, Math.min(max, window.scrollY + r.top - top));
        const start = window.scrollY;
        const t0 = performance.now();
        const stepFn = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          window.scrollTo(0, start + (target - start) * e);
          if (p < 1) requestAnimationFrame(stepFn);
          else resolve();
        };
        requestAnimationFrame(stepFn);
      }),
    [h, top, ms],
  );
  await sleep(200);
}
async function scrollByPx(dy, ms) {
  await page.evaluate(
    ([dy, ms]) =>
      new Promise((resolve) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const start = window.scrollY;
        const target = Math.max(0, Math.min(max, start + dy));
        const t0 = performance.now();
        const stepFn = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, start + (target - start) * p); // 一定の速さ（読みやすい）
          if (p < 1) requestAnimationFrame(stepFn);
          else resolve();
        };
        requestAnimationFrame(stepFn);
      }),
    [dy, ms],
  );
}
async function rectOf(locator) {
  const b = await locator.boundingBox().catch(() => null);
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
}
const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

// ---- 面談（scripts/demo-run.mjs の readInterview と同じ読み取り） ----
function readInterview() {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const text = (el) => (el ? el.textContent.trim() : "");
    const err = q(".interview .error-box [role=alert]");
    const share = q(".share-choice");
    const summary = q(".summary-card:not(.share-choice)");
    const okBtn = summary ? [...summary.querySelectorAll("button")].find((b) => b.textContent.trim() === "この内容でOK") : null;
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
      aiCount: document.querySelectorAll(".chat__log .bubble--ai:not(.bubble--thinking)").length,
      lastIsAi: !!last && last.classList.contains("bubble--ai") && !last.classList.contains("bubble--thinking"),
      inputReady: !!ta && !ta.disabled && !ta.readOnly && !!submit && submit.textContent.trim() === "送信",
      draft: ta ? ta.value : "",
    };
  });
}
const labelFrom = (s) => (s ?? "").replace(/^テーマ：/, "").replace(/（確定しました）$/, "").trim();

async function enterAs(role, sceneKey) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 0));
  mark(sceneKey, "start");
  await sleep(2200);
  const btn = page.getByRole("button", { name: `${ROLE_LABEL[role]}として入る` });
  await moveTo(btn, 1100);
  mark(sceneKey, "beforeClick", { buttonRect: await rectOf(btn) });
  await sleep(500);
  await btn.click();
  await page.waitForURL(/\/interview$/, { timeout: 30_000 });
  await sleep(1500);
  mark(sceneKey, "end");
}

async function interview(role) {
  const pre = role === "predecessor" ? "pred" : "succ";
  await enterAs(role, `${pre}_enter`);
  const answers = SCENARIO[role];
  const seen = new Set(); // 「テーマの最初の質問」を見たテーマ
  const replies = {};
  let lastChange = Date.now();
  let lastSig = "";

  for (let guard = 0; guard < 3000; guard++) {
    checkDeadline();
    const s = await readInterview();
    const sig = JSON.stringify(s);
    if (sig !== lastSig) {
      lastSig = sig;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > AI_WAIT_MS) {
      throw new Error(`${ROLE_LABEL[role]}の面談で、AI の返事を ${AI_WAIT_MS / 1000} 秒待っても画面が変わりません（テーマ: ${s.themeLabel ?? "不明"}）`);
    }
    if (s.loading || s.thinking || s.shareBusy) {
      await sleep(500);
      continue;
    }
    if (s.error) {
      noteRetry(`${ROLE_LABEL[role]}の面談（${s.themeLabel ?? labelFrom(s.share ?? s.summary) ?? "不明"}）`, s.error);
      await sleep(4000);
      if (s.retryStart) await page.getByRole("button", { name: "もう一度試す" }).click();
      else if (s.share) await page.locator(".share-choice .button-row button").click();
      else if (s.summaryOk) await page.locator(".summary-card").getByRole("button", { name: "この内容でOK" }).click();
      else if (s.inputReady && s.draft.trim()) await page.locator(".chat__form button[type=submit]").click();
      else await page.reload({ waitUntil: "networkidle" });
      await sleep(1000);
      continue;
    }
    if (s.finished) break;

    if (s.share) {
      const key = THEME_BY_LABEL[labelFrom(s.share)];
      if (!key) throw new Error(`共有の選択で、知らないテーマ名です: ${s.share}`);
      const shareIt = answers[key].share;
      const card = page.locator(".share-choice");
      const choice = page.locator(".share-choice .choice").nth(shareIt ? 0 : 1);
      const btn = page.locator(".share-choice .button-row button");
      if (FOCUS.has(key)) {
        const k = `${pre}_${key}`;
        await scrollToEl(card, { top: 120, ms: 900 });
        mark(k, "shareStart", { shareRect: await rectOf(card), shareChoice: shareIt ? "共有する" : "共有しない" });
        await sleep(900);
        await slowClick(choice, 900);
        await sleep(800);
        await slowClick(btn, 800);
      } else {
        await choice.click();
        await btn.click();
      }
      await page.waitForFunction(() => !document.querySelector(".share-choice") || document.querySelector(".error-box"), null, { timeout: 60_000 }).catch(() => {});
      if (FOCUS.has(key)) {
        await sleep(1200);
        mark(`${pre}_${key}`, "shareEnd");
      }
      await sleep(300);
      continue;
    }

    if (s.summary) {
      if (!s.summaryOk) {
        await sleep(400);
        continue;
      }
      const key = THEME_BY_LABEL[labelFrom(s.summary)];
      const card = page.locator(".summary-card:not(.share-choice)");
      const ok = card.getByRole("button", { name: "この内容でOK" });
      if (FOCUS.has(key)) {
        const k = `${pre}_${key}`;
        await scrollToEl(card, { top: 110, ms: 1000 });
        mark(k, "summary", { summaryRect: await rectOf(card), summaryText: clean(await card.innerText()) });
        await sleep(3500);
        await slowClick(ok, 900);
        mark(k, "summaryOk");
      } else {
        await ok.click();
      }
      await page.waitForFunction(() => document.querySelector(".share-choice") || document.querySelector(".error-box"), null, { timeout: 60_000 }).catch(() => {});
      continue;
    }

    if (s.inputReady && s.lastIsAi) {
      const key = THEME_BY_LABEL[s.themeLabel];
      if (!key) throw new Error(`面談で、知らないテーマ名です: ${s.themeLabel}`);
      const n = s.myCount;
      if (n >= MAX_REPLIES_PER_THEME) throw new Error(`${ROLE_LABEL[role]}の「${s.themeLabel}」で、回答 ${n} 回でもまとめに進みません`);
      const k = `${pre}_${key}`;
      const ta = page.locator(".chat__input");
      const submit = page.locator(".chat__form button[type=submit]");
      const lastAi = page.locator(".chat__log .bubble--ai:not(.bubble--thinking)").last();
      if (FOCUS.has(key)) {
        if (n === 0) {
          if (seen.has(key)) log(`（${k} の最初の質問をもう一度見ました。読み込み直しの後）`);
          seen.add(key);
          await scrollToEl(lastAi, { top: 160, ms: 1000 });
          mark(k, "start", { firstQuestion: clean(await lastAi.innerText()), firstQuestionRect: await rectOf(lastAi) });
          await sleep(2500);
        } else {
          // 回答への AI の返事（受け止め・深掘りの質問）。読めるように画面に入れて止まる
          await scrollToEl(lastAi, { top: 200, ms: 900 });
          const sc = scene(k);
          sc.aiReplies ??= [];
          sc.aiReplies.push({ t: vt(), text: clean(await lastAi.innerText()), rect: await rectOf(lastAi), afterMyReply: n });
          log(`AI の返事（${k}）: ${clean(await lastAi.innerText()).slice(0, 200)}`);
          saveTimeline();
          await sleep(4500);
        }
        const text = n === 0 ? answers[key].answer : FOLLOWUP_REPLY;
        await moveTo(ta, 700);
        await ta.click();
        if (n === 0) mark(k, "typeStart");
        await ta.pressSequentially(text, { delay: n === 0 ? 85 : 25 });
        await sleep(600);
        await slowClick(submit, 600);
        if (n === 0) mark(k, "sent");
      } else {
        await ta.fill(n === 0 ? answers[key].answer : FOLLOWUP_REPLY);
        await submit.click();
      }
      replies[key] = (replies[key] ?? 0) + 1;
      await page.waitForFunction(() => {
        const t = document.querySelector(".chat__input");
        return (t && t.value === "") || document.querySelector(".error-box");
      }, null, { timeout: 10_000 });
      continue;
    }
    await sleep(500);
  }
  mark(`${pre}_interview`, "end");
  // 確認（読み取りのみ）：6テーマが確定し、共有の可否がシナリオどおりか
  const st = (await (await ctx.request.get(BASE + "/api/interview")).json()).state;
  if (!st?.finished) throw new Error(`${ROLE_LABEL[role]}の面談が終わっていません`);
  for (const t of st.themes) {
    if (t.status !== "confirmed") throw new Error(`${ROLE_LABEL[role]}の「${t.label}」が確定していません（${t.status}）`);
    if (t.shared !== answers[t.key].share) throw new Error(`${ROLE_LABEL[role]}の「${t.label}」の共有がシナリオと違います（${t.shared}）`);
  }
  log(`${ROLE_LABEL[role]}の面談が終わりました。回答数: ${Object.entries(replies).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

/** ボタンを押して AI の結果を待つ（demo-run.mjs の pressAndWait と同じ。待ちは 120 秒まで） */
async function pressAndWait({ where, button, done, errorSel, slow = true, onClick }) {
  for (;;) {
    checkDeadline();
    const loc = button();
    if (slow) {
      await moveTo(loc, 1000);
      await sleep(400);
    }
    const el = await loc.elementHandle();
    await el.click();
    onClick?.();
    await page.waitForFunction((b) => !b.isConnected || b.getAttribute("aria-busy") === "true", el, { timeout: 5_000 }).catch(() => {});
    await page
      .waitForFunction((b) => !b.isConnected || b.getAttribute("aria-busy") !== "true", el, { timeout: AI_WAIT_MS, polling: 500 })
      .catch(() => {
        throw new Error(`${where}：AI の返事を ${AI_WAIT_MS / 1000} 秒待っても終わりません`);
      });
    await sleep(500);
    if ((await page.locator(errorSel).count()) > 0) {
      noteRetry(where, clean(await page.locator(errorSel).first().textContent()));
      await sleep(4000);
      continue;
    }
    await page.waitForSelector(done, { timeout: 15_000 });
    return;
  }
}
const stripNo = (s) => (s ?? "").replace(/^\d+[.．]\s*/, "").trim();

async function learning(tag) {
  const k = `learn_${tag}`;
  await page.goto(BASE + "/learning", { waitUntil: "networkidle" });
  mark(k, "start");
  const btn = page.locator("section[aria-labelledby=wants-title] .button-row button");
  if (tag === "after") {
    await sleep(1200);
    await scrollToEl(btn, { top: 420, ms: 1000 });
  }
  await pressAndWait({
    where: `学習プラン（${tag}）`,
    button: () => btn,
    done: "section[aria-labelledby=plan-title] .plan-list",
    errorSel: "section[aria-labelledby=wants-title] .form-error",
    slow: tag === "after",
    onClick: () => mark(k, "click"),
  });
  mark(k, "result");
  const sec = page.locator("section[aria-labelledby=plan-title]");
  const compared = (await sec.locator(".plan-compare").count()) > 0;
  const cur = compared ? sec.locator(".compare-col--successor") : sec;
  const first = stripNo(await cur.locator(".plan-item__title").first().textContent());
  const titles = (await cur.locator(".plan-item__title").allTextContents()).map(stripNo);
  const usedDiagnosis = (await sec.locator(".diag-used").count()) > 0;
  const out = { first, titles, compared, usedDiagnosis };
  if (compared) {
    const prev = sec.locator(".compare-col--previous");
    out.previousFirst = stripNo(await prev.locator(".plan-item__title").first().textContent());
    out.previousTitles = (await prev.locator(".plan-item__title").allTextContents()).map(stripNo);
    out.changedNote = (await cur.locator(".plan-item__changed").count()) ? clean(await cur.locator(".plan-item__changed").first().textContent()) : null;
    out.firstReason = (await cur.locator(".plan-item").first().locator(".plan-item__reason").count()) ? clean(await cur.locator(".plan-item").first().locator(".plan-item__reason").textContent()) : null;
    const cmp = sec.locator(".plan-compare");
    await scrollToEl(cmp, { top: 90, ms: 1400 });
    mark(k, "compare", {
      compareRect: await rectOf(cmp),
      prevFirstRect: await rectOf(prev.locator(".plan-item").first()),
      curFirstRect: await rectOf(cur.locator(".plan-item").first()),
    });
    await sleep(9000);
  }
  mark(k, "end", out);
  return out;
}

async function compareAndDiagnose() {
  const k = "compare";
  await page.goto(BASE + "/compare", { waitUntil: "networkidle" });
  mark(k, "start");
  await sleep(1500);
  const card = page.locator(".diagnosis-card");
  await scrollToEl(card, { top: 120, ms: 1000 });
  await pressAndWait({
    where: "診断",
    button: () => page.locator(".diagnosis-card__action button"),
    done: ".diagnosis-result .diagnosis",
    errorSel: ".diagnosis-card .form-error",
    onClick: () => mark(k, "click"),
  });
  mark(k, "result");
  await sleep(800);
  const gaps = await page.$$eval(".diag-item--gap", (els) =>
    els.map((el) => ({
      importance: el.querySelector(".badge")?.textContent.trim() ?? "",
      theme: el.querySelector(".diag-item__theme")?.textContent.trim() ?? "",
      point: el.querySelector(".diag-item__point")?.textContent.trim() ?? "",
    })),
  );
  timeline.ai.gaps = gaps;
  log(`認識差: ${gaps.map((g) => `[${g.importance}] ${g.theme}｜${g.point}`).join(" ／ ")}`);
  const cash = gaps.find((g) => g.theme.includes(EXPECT.gapKeyword) || g.point.includes(EXPECT.gapKeyword));
  timeline.result.cashflowGap = cash ?? null;
  timeline.result.cashflowHigh = !!cash && cash.importance.includes("高");
  saveTimeline();
  if (!timeline.result.cashflowHigh) return false;

  const idx = gaps.indexOf(cash);
  const item = page.locator(".diag-item--gap").nth(idx);
  await scrollToEl(item, { top: 160, ms: 1400 });
  mark(k, "gap", { gapRect: await rectOf(item), gapHeadRect: await rectOf(item.locator(".diag-item__head")) });
  await sleep(7000);
  const profit = page.locator("section[aria-labelledby=financial-profit-title]");
  if ((await profit.count()) > 0) {
    await scrollToEl(profit, { top: 140, ms: 1400 });
    const row = profit.locator("tr", { hasText: "営業利益" }).first();
    mark(k, "profit", {
      profitRect: await rectOf(profit),
      profitRowRect: (await row.count()) ? await rectOf(row) : null,
      profitRowText: (await row.count()) ? clean(await row.innerText()) : null,
    });
    await sleep(5500);
  }
  const cashSec = page.locator("section[aria-labelledby=financial-cash-title]");
  if ((await cashSec.count()) > 0) {
    await scrollToEl(cashSec, { top: 140, ms: 1400 });
    mark(k, "cash", { cashRect: await rectOf(cashSec), cashText: clean(await cashSec.innerText()).slice(0, 600) });
    await sleep(7000);
  }
  mark(k, "end");
  return true;
}

async function plan() {
  const k = "plan";
  await page.goto(BASE + "/plan", { waitUntil: "networkidle" });
  mark(k, "start");
  await sleep(1200);
  const btn = page.locator("section[aria-labelledby=plan-create-title] .button-row button");
  await scrollToEl(btn, { top: 420, ms: 900 });
  await pressAndWait({
    where: "90日計画",
    button: () => btn,
    done: ".plan-progress__count",
    errorSel: "section[aria-labelledby=plan-create-title] .form-error",
    onClick: () => mark(k, "click"),
  });
  mark(k, "result");
  const actions = await page.$$eval(".timeline li.action", (els) =>
    els.map((el) => ({
      title: el.querySelector(".action__title")?.textContent.trim() ?? "",
      meta: el.querySelector(".action__head")?.textContent.replace(/\s+/g, " ").trim() ?? "",
    })),
  );
  timeline.ai.actions = actions;
  log(`90日計画: ${actions.length}件 ${actions.map((a) => a.title).join(" ／ ")}`);
  const tl = page.locator("ol.timeline");
  await scrollToEl(tl, { top: 100, ms: 1400 });
  mark(k, "scrollStart", { timelineRect: await rectOf(tl) });
  await sleep(2000);
  const box = await tl.boundingBox();
  const dist = box ? Math.max(0, box.height - (H - 200)) : 0;
  await scrollByPx(dist, Math.min(22_000, Math.max(8_000, dist * 9)));
  mark(k, "scrollEnd", { scrolledPx: Math.round(dist) });
  await sleep(2000);
  mark(k, "end");
}

let videoPath = null;
async function cleanup() {
  finishing = true;
  clearTimeout(hardStop);
  if (process.env.KEEP_DATA !== "1") {
    const r = await ctx.request.fetch(BASE + "/api/demo", { method: "DELETE", headers: { Origin: BASE } }).catch((e) => e);
    log(`後片付け DELETE /api/demo: ${r && typeof r.status === "function" ? r.status() : "失敗 " + String(r)}`);
  }
  const video = page.video();
  await Promise.race([ctx.close().catch(() => {}), sleep(30_000)]);
  if (video) {
    videoPath = path.join(OUT, `raw-${ATTEMPT}.webm`);
    await video.saveAs(videoPath).catch((e) => log(`録画の保存に失敗: ${e.message}`));
    await video.delete().catch(() => {});
  }
  await Promise.race([browser.close().catch(() => {}), sleep(10_000)]);
}

let exitCode = 0;
try {
  await interview("predecessor");
  await interview("successor");
  const before = await learning("before");
  timeline.ai.learningBefore = before;
  log(`診断前の学習プランの1番目: ${before.first}`);
  const diagOk = await compareAndDiagnose();
  if (!diagOk) {
    exitCode = 1;
    log("条件を満たしません：資金繰りの認識差が重要度「高」になりませんでした。ここで止めます（撮り直し）");
  } else {
    const after = await learning("after");
    timeline.ai.learningAfter = after;
    timeline.result.firstAfter = after.first;
    timeline.result.firstAfterOk = after.first === EXPECT.firstCourseTitle;
    log(`診断後の学習プランの1番目: ${after.first}（前のプランの1番目: ${after.previousFirst ?? "-"}）`);
    if (!timeline.result.firstAfterOk) {
      exitCode = 1;
      log(`条件を満たしません：診断後の学習プランの1番目が「${EXPECT.firstCourseTitle}」ではありません。ここで止めます（撮り直し）`);
    } else {
      await plan();
    }
  }
} catch (err) {
  exitCode = 2;
  log(`途中で止まりました: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  await page.screenshot({ path: path.join(OUT, `stopped-${ATTEMPT}.png`) }).catch(() => {});
} finally {
  timeline.result.ok = exitCode === 0;
  timeline.result.exitCode = exitCode;
  timeline.result.retries = retries;
  timeline.result.elapsedSec = Math.round((Date.now() - T_START) / 1000);
  saveTimeline();
  await cleanup();
  timeline.video = videoPath ? path.basename(videoPath) : null;
  saveTimeline();
  if (exitCode === 0) fs.copyFileSync(path.join(OUT, `timeline-${ATTEMPT}.json`), path.join(OUT, "timeline.json"));
  log(`終了 判定=${exitCode}（0=条件を満たした／1=撮り直し／2=途中で停止） 録画=${videoPath ?? "なし"} 所要=${timeline.result.elapsedSec}秒`);
}
process.exit(exitCode);
