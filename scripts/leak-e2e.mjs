// 通しの漏えいテスト（目印方式）。本物の Claude API を使う（AI 呼び出し 約45回）。
// 使い方: node scripts/leak-e2e.mjs <baseURL>
//   例: node scripts/leak-e2e.mjs http://localhost:3000
// 終了コード: 0=合格 / 1=不合格（漏えいの疑いあり） / 2=途中で動かなくなった（判定できず）
//
// やること
// 1. 先代・後継者の面談を API で最後まで通す。締め（closing、共有しない）の回答と要約に目印
//    LEAKCANARY-P-xxxx / LEAKCANARY-S-xxxx を入れる。共有するテーマ（経営方針）の要約には
//    SHAREDMARK-xxxx を入れる（「ちゃんと見えるべきものが見えている」ことの確認用）
// 2. 各画面を役割ごとに開き、その画面が受け取ったすべての応答（HTML・RSC・/api の JSON・JS）と、
//    同じ画面の RSC 応答（RSC: 1）を集め、目印が出ないことを確かめる
// 2b. 先代・後継者それぞれが AI参謀に目印 ADVCANARY-P-xxxx / ADVCANARY-S-xxxx 入りの相談を送る。
//    本人の /advisor には目印が出ること（検出が働いている前提）、相手の /advisor と、
//    二人の共有物の画面（/report・/compare・/learning・/plan）には出ないことを確かめる。
//    決算サマリー資料（POST /api/report）を作り、その応答と /report に、非共有回答・AI参謀の目印が出ないことも確かめる
// 3. 共有→取り消しで、比較・診断から消えることを確かめる
// 4. 別のブラウザの文脈（別のデモ用 ID）から何も見えないことを確かめる（AI参謀・資料の画面を含む）
// 最後に「デモをやり直す」でこのテストのデータを消す。
// 回答の文面は scripts/screenshots.mjs のものを使う（架空データ）。

import { chromium } from "playwright-core";
import crypto from "node:crypto";

const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("使い方: node scripts/leak-e2e.mjs <baseURL>");
  process.exit(2);
}
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const rand = () => crypto.randomBytes(6).toString("hex");
const CANARY = { predecessor: `LEAKCANARY-P-${rand()}`, successor: `LEAKCANARY-S-${rand()}` };
const SHARED_MARK = `SHAREDMARK-${rand()}`;
const ANY_CANARY = /LEAKCANARY-[PS]-[0-9a-f]{12}/;
// AI参謀の相談に入れる目印（本人だけのもの。相手の役割・共有物には出てはいけない）
const ADV_CANARY = { predecessor: `ADVCANARY-P-${rand()}`, successor: `ADVCANARY-S-${rand()}` };
const ANY_ADV = /ADVCANARY-[PS]-[0-9a-f]{12}/;
const ADV_TEXT = (c) => `${c} 資金繰りで気になっていることがあります。返済の予定はどう確かめればよいですか。まだ誰にも言っていません`;
const otherOf = (role) => (role === "predecessor" ? "successor" : "predecessor");
// 非共有テーマ（締め）の存在の手がかり
const CLOSING_LABEL = "相手にまだ伝えていない気持ち";
const CLOSING_KEY = /["'\\]closing["'\\]/;

const ANSWERS = {
  predecessor: ["味と常連さんを守りたい。法事の折詰と宴会は地域での役目だ", "出汁の取り方と常連さんの好み。メニューは息子が変えてもいい"],
  successor: ["ランチとSNSで若いお客さんを増やしたい", "まずはランチの定食を見直したい"],
};
const CASH = {
  predecessor: ["借入は毎月きちんと返している。宴会が入れば取り戻せる", "毎月20万くらいだったと思う"],
  successor: ["借入がいくらで、毎月いくら返しているか知らないです", "父か母に聞けば分かると思います"],
};
const CLOSING = {
  predecessor: (c) => [`${c} 厨房に立てるのはあと2〜3年だと思っている。まだ誰にも言っていない`, `${c} 体のことは家族にもまだ話していない`],
  successor: (c) => [`${c} 継ぐかまだ迷っている。父にはまだ言えていない`, `${c} 迷っていることは誰にも話していない`],
};

const results = []; // { ok, name, where }
const check = (ok, name, where = "") => {
  results.push({ ok, name, where });
  console.log(`${ok ? "合格  " : "不合格"} ${name}${where ? `  [${where}]` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

function makeSession(ctx) {
  const api = async (method, p, body) => {
    const send = () =>
      ctx.request.fetch(BASE + p, {
        method,
        headers: { "Content-Type": "application/json", Origin: BASE },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 130_000,
      });
    // 接続が切れた（ECONNRESET など、HTTP の応答が無い）ときだけ1回やり直す。HTTP のエラーはやり直さない
    let res;
    try {
      res = await send();
    } catch (err) {
      console.log(`  （接続エラーのため1回やり直し: ${method} ${p}）`);
      await new Promise((r) => setTimeout(r, 3000));
      res = await send();
    }
    const text = await res.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status(), text, json };
  };
  return { ctx, api };
}

async function interview(s, role) {
  await s.api("POST", "/api/role", { role });
  let st = (await s.api("GET", "/api/interview")).json.state;
  for (let guard = 0; (!st.finished || st.pendingShareThemeKey) && guard < 80; guard++) {
    if (st.pendingShareThemeKey) {
      const k = st.pendingShareThemeKey;
      st = (await s.api("POST", "/api/interview/share", { themeKey: k, shared: k !== "closing" })).json.state;
      continue;
    }
    const key = st.currentThemeKey;
    const t = st.themes.find((x) => x.key === key);
    if (t.status === "awaiting_confirmation") {
      const sum = structuredClone(t.summary ?? { statements: [], ai_observations: [], unconfirmed: [] });
      // 目印を要約にも確実に入れる（AI が言い換えて落としても、保存される要約に残るように）
      if (key === "closing") sum.statements = [`${CANARY[role]} 相手にはまだ伝えていない`, ...sum.statements].slice(0, 10);
      if (key === "policy") sum.statements = [`${SHARED_MARK} ${role}`, ...sum.statements].slice(0, 10);
      const r = await s.api("POST", "/api/interview/summary", { themeKey: key, decision: "confirm", summary: sum });
      if (!r.json.ok) throw new Error(`${role}/${key} 要約の確定に失敗: ${r.status} ${r.json.error ?? ""}`);
      st = r.json.state;
      continue;
    }
    if (st.messages.length === 0) {
      st = (await s.api("POST", "/api/interview/start", {})).json.state;
      continue;
    }
    const n = st.messages.filter((m) => m.from === "me").length;
    const bank = key === "closing" ? CLOSING[role](CANARY[role]) : key === "cashflow" ? CASH[role] : ANSWERS[role];
    const r = await s.api("POST", "/api/interview/message", { text: bank[n] ?? "それ以上は特にありません" });
    if (!r.json.ok) throw new Error(`${role}/${key}: ${r.status} ${r.json.error ?? ""}`);
    st = r.json.state;
  }
  if (!st.finished) throw new Error(`${role} の面談が終わりませんでした`);
  const closing = st.themes.find((x) => x.key === "closing");
  return { closingStatus: closing?.status, closingShared: closing?.shared };
}

/** role として path を開き、受け取ったすべての応答と RSC 応答を集める */
async function capture(s, role, path) {
  await s.api("POST", "/api/role", { role });
  const page = await s.ctx.newPage();
  const pending = [];
  const records = [];
  page.on("response", (res) => {
    pending.push(
      res
        .text()
        .then((body) => records.push({ url: res.url(), body }))
        .catch(() => {}),
    );
  });
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60_000 });
  await Promise.all(pending);
  await page.close();
  const rsc = await s.ctx.request.get(BASE + path, { headers: { RSC: "1" } });
  records.push({ url: `${BASE}${path} (RSC)`, body: await rsc.text() });
  return records;
}

const short = (u) => u.replace(BASE, "");
function findAll(records, re) {
  return records.filter((r) => (typeof re === "string" ? r.body.includes(re) : re.test(r.body))).map((r) => short(r.url));
}
const dynamicOnly = (records) => records.filter((r) => !r.url.includes("/_next/static/"));

const PAGES = ["/compare", "/learning", "/plan"];

let exitCode = 0;
try {
  // ---- 1. データを作る ----
  const A = makeSession(await browser.newContext({ locale: "ja-JP" }));
  const t0 = Date.now();
  const p = await interview(A, "predecessor");
  const su = await interview(A, "successor");
  console.log(`面談完了（${Math.round((Date.now() - t0) / 1000)}秒）`);
  check(p.closingStatus === "confirmed" && p.closingShared === false, "先代の締めが確定・非共有で保存された（前提）");
  check(su.closingStatus === "confirmed" && su.closingShared === false, "後継者の締めが確定・非共有で保存された（前提）");

  // 自分の画面には自分の目印が見える（目印が実際に保存されたことの確認。見えなければ以下の判定は無意味）
  for (const role of ["predecessor", "successor"]) {
    const recs = await capture(A, role, "/interview");
    const api = await A.api("GET", "/api/interview");
    recs.push({ url: `${BASE}/api/interview`, body: api.text });
    check(findAll(recs, CANARY[role]).length > 0, `前提: ${role} 本人の画面には本人の目印がある`);
    const other = role === "predecessor" ? "successor" : "predecessor";
    const hit = findAll(recs, CANARY[other]);
    check(hit.length === 0, `${role} 側の面談画面・/api/interview に相手（${other}）の非共有回答が出ない`, hit.join(", "));
  }

  // ---- 2. 診断・学習・90日計画を作り、全画面を確かめる ----
  const diagnoseAs = async (role) => {
    await A.api("POST", "/api/role", { role });
    return A.api("POST", "/api/diagnosis", {});
  };
  const d = await diagnoseAs("predecessor");
  if (!d.json.ok) throw new Error(`診断に失敗: ${d.status} ${d.json.error ?? ""}`);
  check(!ANY_CANARY.test(d.text), "診断 API の応答に非共有回答の目印が出ない", "/api/diagnosis");
  check(!d.text.includes(CLOSING_LABEL) && !CLOSING_KEY.test(d.text), "診断 API の応答に締めのテーマ名・key が出ない", "/api/diagnosis");
  await A.api("POST", "/api/role", { role: "successor" });
  const lp = await A.api("POST", "/api/learning/plan", {});
  if (!lp.json.ok) throw new Error(`学習プランに失敗: ${lp.status} ${lp.json.error ?? ""}`);
  check(!ANY_CANARY.test(lp.text), "学習プラン API の応答に目印が出ない", "/api/learning/plan");
  const pl = await A.api("POST", "/api/plan", {});
  if (!pl.json.ok) throw new Error(`90日計画に失敗: ${pl.status} ${pl.json.error ?? ""}`);
  check(!ANY_CANARY.test(pl.text), "90日計画 API の応答に目印が出ない", "/api/plan");

  for (const role of ["predecessor", "successor"]) {
    for (const path of PAGES) {
      const recs = await capture(A, role, path);
      const hit = findAll(recs, ANY_CANARY);
      check(hit.length === 0, `${role} 側の ${path} に非共有回答の目印が出ない（応答 ${recs.length} 件）`, hit.join(", "));
      const dyn = dynamicOnly(recs);
      const label = findAll(dyn, CLOSING_LABEL);
      const key = findAll(dyn, CLOSING_KEY);
      check(label.length + key.length === 0, `${role} 側の ${path} に締めのテーマ名・key が出ない（静的 JS は除く）`, [...label, ...key].join(", "));
      if (path === "/compare") {
        const html = recs.find((r) => short(r.url) === "/compare")?.body ?? "";
        check(findAll(recs, SHARED_MARK).length > 0, `前提: ${role} 側の比較画面に共有済みの内容が見える`);
        check(/共有された内容（(?:<!-- -->)?5(?:<!-- -->)?テーマ）/.test(html), `${role} 側の比較画面のテーマ件数が5（締めを数えない）`);
        check(html.includes("診断結果を見る"), `前提: ${role} 側の比較画面に診断が出ている`);
      }
    }
  }

  // ---- 2b. AI参謀（本人だけの会話）と決算サマリー資料 ----
  for (const role of ["predecessor", "successor"]) {
    await A.api("POST", "/api/role", { role });
    const r = await A.api("POST", "/api/advisor/message", { text: ADV_TEXT(ADV_CANARY[role]) });
    if (!r.json.ok) throw new Error(`${role} の AI参謀に失敗: ${r.status} ${r.json.error ?? ""}`);
    check(r.text.includes(ADV_CANARY[role]), `前提: ${role} の AI参謀の応答に本人の相談（目印）が入っている`, "/api/advisor/message");
    const hit = [...(r.text.includes(ADV_CANARY[otherOf(role)]) ? ["相手の AI参謀の目印"] : []), ...(ANY_CANARY.test(r.text) ? ["非共有回答の目印"] : [])];
    check(hit.length === 0, `${role} の AI参謀の応答に、相手の AI参謀の相談・非共有回答の目印が出ない`, hit.join(", "));
  }

  // 資料は二人の共有物。AI参謀の相談のあとに作り、相談・非共有回答が入らないことを確かめる
  await A.api("POST", "/api/role", { role: "successor" });
  const rp = await A.api("POST", "/api/report", {});
  if (!rp.json.ok) throw new Error(`資料の作成に失敗: ${rp.status} ${rp.json.error ?? ""}`);
  check(!ANY_CANARY.test(rp.text), "資料 API の応答に非共有回答の目印が出ない", "/api/report");
  check(!ANY_ADV.test(rp.text), "資料 API の応答に AI参謀の相談の目印が出ない", "/api/report");
  check(!rp.text.includes(CLOSING_LABEL) && !CLOSING_KEY.test(rp.text), "資料 API の応答に締めのテーマ名・key が出ない", "/api/report");

  for (const role of ["predecessor", "successor"]) {
    // 本人の /advisor には本人の目印が出る（検出が働いている前提）。相手の目印は出ない
    const own = await capture(A, role, "/advisor");
    check(findAll(own, ADV_CANARY[role]).length > 0, `前提: ${role} 本人の /advisor には本人の AI参謀の目印がある（応答 ${own.length} 件）`);
    const ownHit = [...findAll(own, ADV_CANARY[otherOf(role)]), ...findAll(own, ANY_CANARY)];
    check(ownHit.length === 0, `${role} 側の /advisor に相手（${otherOf(role)}）の AI参謀の相談・非共有回答の目印が出ない`, ownHit.join(", "));
    // 二人の共有物の画面には、どちらの AI参謀の目印も出ない
    for (const path of ["/report", ...PAGES]) {
      const recs = await capture(A, role, path);
      const adv = findAll(recs, ANY_ADV);
      check(adv.length === 0, `${role} 側の ${path} に AI参謀の相談の目印が出ない（応答 ${recs.length} 件）`, adv.join(", "));
      const hit = findAll(recs, ANY_CANARY);
      check(hit.length === 0, `${role} 側の ${path} に非共有回答の目印が出ない（応答 ${recs.length} 件）`, hit.join(", "));
      if (path === "/report") {
        const html = recs.find((r) => short(r.url) === "/report")?.body ?? "";
        check(html.includes("report-ch8"), `前提: ${role} 側の /report に作った資料が出ている`);
        const label = [...findAll(dynamicOnly(recs), CLOSING_LABEL), ...findAll(dynamicOnly(recs), CLOSING_KEY)];
        check(label.length === 0, `${role} 側の /report に締めのテーマ名・key が出ない（静的 JS は除く）`, label.join(", "));
      }
    }
  }

  // ---- 3. 共有してから取り消すと、比較・診断から消える ----
  await A.api("POST", "/api/role", { role: "predecessor" });
  const on = await A.api("POST", "/api/interview/share", { themeKey: "closing", shared: true });
  if (!on.json.ok) throw new Error(`共有の切り替えに失敗: ${on.status}`);
  let recs = await capture(A, "successor", "/compare");
  check(findAll(recs, CANARY.predecessor).length > 0, "前提: 共有したあとは後継者側の比較画面に先代の締めが見える（目印の検出が働いている）");
  const d2 = await diagnoseAs("successor");
  if (!d2.json.ok) throw new Error(`再診断に失敗: ${d2.status} ${d2.json.error ?? ""}`);
  await A.api("POST", "/api/role", { role: "predecessor" });
  const off = await A.api("POST", "/api/interview/share", { themeKey: "closing", shared: false });
  if (!off.json.ok) throw new Error(`共有の取り消しに失敗: ${off.status}`);
  for (const role of ["predecessor", "successor"]) {
    recs = await capture(A, role, "/compare");
    const html = recs.find((r) => short(r.url) === "/compare")?.body ?? "";
    check(findAll(recs, CANARY.predecessor).length === 0, `取り消し後、${role} 側の比較画面から先代の締めが消える`, findAll(recs, CANARY.predecessor).join(", "));
    check(!html.includes("診断結果を見る") && html.includes("認識差を診断する"), `取り消し後、${role} 側の比較画面から（締めを使った）診断が消える`);
    check(findAll(dynamicOnly(recs), CLOSING_LABEL).length === 0, `取り消し後、${role} 側の比較画面に締めのテーマ名が出ない`);
  }
  recs = await capture(A, "predecessor", "/plan");
  check(findAll(recs, ANY_CANARY).length === 0, "取り消し後、90日計画に目印が出ない", findAll(recs, ANY_CANARY).join(", "));

  // ---- 4. 別のブラウザ（別のデモ用 ID）からは何も見えない ----
  const B = makeSession(await browser.newContext({ locale: "ja-JP" }));
  for (const role of ["predecessor", "successor"]) {
    const all = [];
    for (const path of ["/interview", "/advisor", "/report", ...PAGES]) all.push(...(await capture(B, role, path)));
    const api = await B.api("GET", "/api/interview");
    all.push({ url: `${BASE}/api/interview`, body: api.text });
    const hit = [...findAll(all, ANY_CANARY), ...findAll(all, SHARED_MARK), ...findAll(all, ANY_ADV)];
    check(hit.length === 0, `別のデモ ID（${role}）から、元のデモの回答（共有済みを含む）・AI参謀の相談が見えない`, hit.join(", "));
    const html = all.find((r) => short(r.url) === "/compare")?.body ?? "";
    check(html.includes("まだ共有された回答はありません"), `別のデモ ID（${role}）の比較画面は「まだ共有された回答はありません」`);
  }
  await B.api("DELETE", "/api/demo");
  await A.api("DELETE", "/api/demo");
} catch (err) {
  console.error("途中で止まりました:", err instanceof Error ? err.message : String(err));
  exitCode = 2;
} finally {
  // Windows ではブラウザの終了待ちが返らないことがあるので、10秒で打ち切る
  await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n判定: ${exitCode === 2 ? "判定できず（途中で停止）" : failed.length === 0 ? "合格" : "不合格"}（確認 ${results.length} 件、不合格 ${failed.length} 件）`);
for (const f of failed) console.log(`  不合格: ${f.name}${f.where ? `  場所: ${f.where}` : ""}`);
process.exit(exitCode === 2 ? 2 : failed.length ? 1 : 0);
