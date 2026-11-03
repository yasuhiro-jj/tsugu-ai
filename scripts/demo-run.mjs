// 3分デモの通し確認（画面操作版）。本物の Claude API を使う（AI 呼び出し 1回あたり 約20〜30回）。
// 使い方: node scripts/demo-run.mjs <baseURL> [出力フォルダ]
//   例: node scripts/demo-run.mjs https://tsugu-ai.vercel.app screenshots/demo-run-1
//   出力フォルダの既定は screenshots/demo-run-<日時>（screenshots/ は Git 対象外）
// 終了コード: 0=最後まで通り、認識差に資金繰りが出て、学習プランの1番目が「資金繰りの基本」
//             1=最後まで通ったが期待と違う / 2=途中で止まった
//
// 進め方（ボタンを押して進める。API を直接呼ぶのは最後の確認の読み取りと後片付けだけ）
// 1. 先代として入る → 6テーマの面談（回答は scripts/demo-scenario.mjs）→ 要約を「この内容でOK」→ 共有の選択
// 2. 後継者として入る → 同じ
// 3. 比較画面で「AIに認識差を整理してもらう」
// 4. 学習プラン画面で「学習プランを作る」
// 5. 90日計画画面で「90日計画の下書きを作る」
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
const result = { gaps: [], cashflowGap: false, firstCourse: null, usedDiagnosis: null, planCount: null };

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

/** ボタンを押して AI の結果を待つ。エラー表示ならやり直す */
async function pressAndWait({ where, button, done, errorSel }) {
  for (;;) {
    await button().click();
    const outcome = await page
      .waitForFunction(
        ([doneSel, errSel]) => (document.querySelector(errSel) ? "error" : document.querySelector(doneSel) ? "done" : false),
        [done, errorSel],
        { timeout: STALL_MS, polling: 500 },
      )
      .then((h) => h.jsonValue());
    if (outcome === "done") return;
    const msg = (await page.locator(errorSel).first().textContent())?.trim() ?? "";
    noteRetry(where, msg);
    await sleep(4000);
  }
}

let exitCode = 0;
let stopShot = null;
try {
  await step("先代の面談と共有の選択", () => interview("predecessor"));
  await step("後継者の面談と共有の選択", () => interview("successor"));

  await step("比較と診断", async () => {
    await page.goto(BASE + "/compare", { waitUntil: "networkidle" });
    await shot("compare-before");
    await pressAndWait({
      where: "診断",
      button: () => page.locator(".diagnosis-card__action button"),
      done: ".diagnosis-result .diagnosis",
      errorSel: ".diagnosis-card .form-error",
    });
    await sleep(500);
    result.gaps = await page.$$eval(".diag-item--gap", (els) =>
      els.map((el) => ({
        importance: el.querySelector(".badge")?.textContent.trim() ?? "",
        theme: el.querySelector(".diag-item__theme")?.textContent.trim() ?? "",
        point: el.querySelector(".diag-item__point")?.textContent.trim() ?? "",
      })),
    );
    result.cashflowGap = result.gaps.some((g) => g.theme.includes(EXPECT.gapKeyword) || g.point.includes(EXPECT.gapKeyword));
    await shot("compare-diagnosis");
  });

  await step("後継者の学習プラン", async () => {
    await page.goto(BASE + "/learning", { waitUntil: "networkidle" });
    await shot("learning-before");
    await pressAndWait({
      where: "学習プラン",
      button: () => page.locator("section[aria-labelledby=wants-title] .button-row button"),
      done: "section[aria-labelledby=plan-title] .plan-list",
      errorSel: "section[aria-labelledby=wants-title] .form-error",
    });
    await sleep(500);
    const sec = page.locator("section[aria-labelledby=plan-title]");
    const cur = (await sec.locator(".compare-col--successor").count()) > 0 ? sec.locator(".compare-col--successor") : sec;
    result.firstCourse = (await cur.locator(".plan-item__title").first().textContent())?.trim() ?? null;
    result.usedDiagnosis = (await sec.locator(".diag-used").count()) > 0;
    await shot("learning-plan");
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
    await sleep(500);
    result.planCount = await page.locator(".timeline li.action").count();
    await shot("plan");
  });
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

// 講座の題名は「1. 資金繰りの基本」のように番号付き（lib/courses.ts）。先頭の番号を外して比べる
const firstOk = (result.firstCourse ?? "").replace(/^\d+[.．]\s*/, "") === EXPECT.firstCourseTitle;
if (exitCode === 0 && !(result.cashflowGap && firstOk)) exitCode = 1;

const lines = [
  `診断に「${EXPECT.gapKeyword}」の認識差: ${result.cashflowGap ? "出た" : "出なかった"}`,
  `認識差の見出し: ${result.gaps.length ? result.gaps.map((g) => `[${g.importance}] ${g.theme}｜${g.point}`).join(" ／ ") : "（なし）"}`,
  `学習プランの1番目: ${result.firstCourse ?? "（なし）"}（「${EXPECT.firstCourseTitle}」か: ${firstOk ? "はい" : "いいえ"}、診断の反映表示: ${result.usedDiagnosis === null ? "-" : result.usedDiagnosis ? "あり" : "なし"}）`,
  `90日計画の件数: ${result.planCount ?? "（なし）"}`,
  `所要時間: ${timings.map((t) => `${t.name} ${t.sec}秒`).join(" ／ ")}（合計 ${timings.reduce((a, t) => a + t.sec, 0)}秒）`,
  `AI の一時エラーなどでやり直した回数: ${retries}${retryLog.length ? `（${retryLog.join(" ／ ")}）` : ""}`,
  ...(stopShot ? [`止まった画面: ${stopShot}`] : []),
  `画面写真: ${OUT}`,
  `判定: ${exitCode === 0 ? "0（最後まで通り、期待どおり）" : exitCode === 1 ? "1（通ったが期待と違う）" : "2（途中で停止）"}`,
];
console.log("\n" + lines.join("\n"));
fs.writeFileSync(path.join(OUT, "result.txt"), lines.join("\n") + "\n", "utf8");
process.exit(exitCode);
