// TSUGU AI 3分デモ動画 v2 の編集（ffmpeg-static。video/node_modules の中に入れたものを v1 と共用）。
// v1 の video/edit.mjs をコピーして直したもの（v1 は変更しない）。
// 使い方（video/v2/ の順番）:
//   1. node video/v2/record.mjs 1          録画（本物の API）。条件を満たすと video/v2/out/timeline.json ができる
//   2. node video/v2/scenes.mjs            narration.txt（原稿と読み）を書く
//   3. node video/v2/cards.mjs             文字の画面・字幕・左下の表示・寄るコマの PNG
//   4. powershell -File video/v2/tts.ps1   仮ナレーションの WAV（Microsoft Haruka）
//   5. node video/v2/edit.mjs              tsugu-ai-demo-v2.mp4 と tsugu-ai-demo-v2-nonarration.mp4、subtitles.srt、確認用の静止画
//   6. node video/v2/voice-merge.mjs       オーナーの声（video/v2/voice/s01〜s10.*）を重ねた tsugu-ai-demo-v2-voice.mp4
//
// 事実との整合の決まり（video/v2/storyboard.md）：
// - 画面は録画をそのまま切り出す（AI の文を作ったり差し替えたりしない）。拡大（crop と scale）と早送り（setpts）だけ
// - 早送りした部分には、右上に「早送り（実際は約○秒／分）」を出す。実際の時間は録画の秒数から計る
// - 左下にずっと「デモ用の架空の会社・人物・数字です」。BGM は使わない

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SCENES, TOTAL, NARRATION_LEAD } from "./scenes.mjs";
import { cardFile, captionFile, DISCLAIMER_FILE, renderFastForward, CARDS, CONVERGE_PATTERN } from "./cards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");
const WORK = path.join(OUT, "work");
const CHECK = path.join(OUT, "check");
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(CHECK, { recursive: true });
const FFMPEG = createRequire(import.meta.url)("ffmpeg-static");
const FPS = 30;
const W = 1920;
const H = 1080;

function ff(args, { quiet = true } = {}) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-y", ...(quiet ? ["-loglevel", "error"] : []), ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) throw new Error(`ffmpeg に失敗しました:\n${args.join(" ")}\n${r.stderr}`);
  return r;
}
const r2 = (x) => Math.round(x * 100) / 100;

// ---- 録画と時刻合わせ ----
const TL = JSON.parse(fs.readFileSync(path.join(OUT, "timeline.json"), "utf8"));
if (!TL.result?.ok) throw new Error("timeline.json が条件を満たしていません（撮り直しが必要）");
const RAW = path.join(OUT, TL.video);

/** 録画の中で赤い画面が最初に映った時刻を探し、record.mjs が残した時刻とのずれを返す */
function calibrate() {
  const r = spawnSync(FFMPEG, ["-loglevel", "error", "-t", "8", "-i", RAW, "-vf", "crop=8:8:956:536,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    maxBuffer: 1 << 26,
  });
  const buf = r.stdout;
  const fps = 25; // Playwright の録画は 25fps
  for (let i = 0; i + 2 < buf.length; i += 3) {
    if (buf[i] > 200 && buf[i + 1] < 60 && buf[i + 2] < 60) return (i / 3) / fps - TL.calib.redAt;
  }
  throw new Error("時刻合わせの赤い画面が見つかりません");
}
const OFFSET = calibrate();
const S = TL.scenes;
const src = (t) => t + OFFSET; // timeline の秒数 → 録画ファイルの秒数
console.log(`時刻合わせ: 録画ファイルの秒数 = timeline の秒数 ${OFFSET >= 0 ? "+" : ""}${OFFSET.toFixed(2)}`);

// ---- 拡大の範囲 ----
/** rect（画面上の位置）が見えるように、16:9 の切り出し範囲を決める。下3分の1は字幕の帯になるので、rect は上の方に置く */
function zoomOn(rect, { w = 1280, topFrac = 0.1, cx } = {}) {
  const h = Math.round((w * 9) / 16);
  const centerX = cx ?? (rect ? rect.x + rect.w / 2 : W / 2);
  let x = Math.round(centerX - w / 2);
  let y = rect ? Math.round(rect.y - h * topFrac) : Math.round((H - h) / 2);
  x = Math.max(0, Math.min(W - w, x));
  y = Math.max(0, Math.min(H - h, y));
  return { x: x - (x % 2), y: y - (y % 2), w, h };
}
const COLUMN = (rect, opts = {}) => zoomOn(rect, { cx: W / 2, ...opts }); // アプリの本文の列（中央）

// ---- 場面の組み立て ----
const ffLabels = []; // { file, text }
function ffText(sec) {
  if (sec < 15) return `早送り（実際は約${Math.round(sec)}秒）`;
  if (sec < 90) return `早送り（実際は約${Math.round(sec / 5) * 5}秒）`;
  const m = Math.round((sec / 60) * 2) / 2;
  return `早送り（実際は約${String(m).replace(/\.0$/, "")}分）`;
}
function ffLabelFile(text) {
  let x = ffLabels.find((l) => l.text === text);
  if (!x) {
    x = { text, file: path.join(CARDS, `ff-${ffLabels.length}.png`) };
    ffLabels.push(x);
  }
  return x.file;
}

/**
 * 録画の一部分を、out 秒の長さにする。
 * - 録画の方が長いときは早送り（FF_MIN 倍を超えたら「早送り」の札を出す。続いた早送りの部分は1枚の札にまとめる）
 * - 録画の方が短いときは等速のまま、最後のコマで止めて長さを合わせる
 */
function clip(from, to, out, crop, note = "", flex = false) {
  if (!(to > from)) throw new Error(`切り出しの範囲が不正です ${note}: ${from}〜${to}`);
  return { from: src(from), to: src(to), out, crop, note, real: to - from, flex };
}
const FF_MIN = 1.02;

/** 場面ごとの切り出し（timeline の秒数から決める）。合計が scene.dur になるように flex の部分で調整する */
function screenPlan(id) {
  const sc = SCENES.find((s) => s.id === id);
  const p = [];
  if (id === "s04") {
    // 先代：経営方針（守りたいもの）→ 後継者：経営方針（やってみたいこと）→ 共有するかを選ぶ
    const a = S.pred_policy;
    const b = S.succ_policy;
    p.push(clip(a.start, a.summary, 3.5, COLUMN(a.firstQuestionRect, { topFrac: 0.2 }), "先代：経営方針の質問→回答→要約"));
    p.push(clip(a.summary, a.summary + 4.6, 4.6, COLUMN(a.summaryRect, { w: 1440, topFrac: 0.04 }), "先代：要約カード（守りたいもの）"));
    p.push(clip(b.start, b.summary, 3, COLUMN(b.firstQuestionRect, { topFrac: 0.2 }), "後継者：経営方針の質問→回答→要約"));
    p.push(clip(b.summary, b.summary + 4.4, 4.4, COLUMN(b.summaryRect, { w: 1440, topFrac: 0.04 }), "後継者：要約カード（ランチとSNS）"));
    p.push(clip(b.shareStart, b.shareEnd, 2.5, COLUMN(b.shareRect, { w: 1440, topFrac: 0.06 }), "後継者：共有するかを選ぶ", true));
  }
  if (id === "s05") {
    const c = S.compare;
    p.push(clip(c.start, c.click + 0.5, 2, null, "比較画面→診断のボタン"));
    p.push(clip(c.click + 0.5, c.result + 0.5, 2, null, "診断を待つ"));
    p.push(clip(c.result + 0.5, c.gap, 1, null, "結果へスクロール"));
    p.push(clip(c.gap, c.gap + 5.5, 5.5, COLUMN(c.gapRect, { w: 1280, topFrac: 0.08 }), "資金繰り（重要度 高）"));
    p.push(clip(c.directions, c.directions + 5.8, 5.8, COLUMN(c.directionsRect, { w: 1440, topFrac: 0.03 }), "これからの選択肢：守りたいこと"));
    p.push(clip(c.tryNew, c.tryNew + 6.8, 7.7, COLUMN(c.tryNewRect, { w: 1440, topFrac: 0.06 }), "新しく試したいこと", true));
  }
  if (id === "s06") {
    const l = S.learn_after;
    const c = S.plan;
    p.push(clip(l.start, l.result + 0.3, 2.5, null, "学習プラン→作り直す→AI を待つ"));
    p.push(clip(l.result + 0.3, l.compare, 1, null, "比較へスクロール"));
    const both = { x: l.prevFirstRect.x, y: Math.min(l.prevFirstRect.y, l.curFirstRect.y), w: l.curFirstRect.x + l.curFirstRect.w - l.prevFirstRect.x, h: 1 };
    p.push(clip(l.compare, l.compare + 4.5, 4.5, zoomOn(both, { w: 1280, topFrac: 0.12 }), "学習プラン：前と今の1番目"));
    p.push(clip(c.start, c.result + 0.3, 2, null, "90日計画→作る→AI を待つ"));
    if (c.smallRect) {
      p.push(clip(c.result + 0.3, c.smallTry, 1.5, null, "「小さく試す」行動へスクロール"));
      p.push(clip(c.smallTry, c.smallTry + 4.5, 4.5, COLUMN(c.smallRect, { w: 1280, topFrac: 0.4 }), "「小さく試す」行動", true));
    } else {
      p.push(clip(c.result + 0.3, c.scrollStart, 1.5, null, "計画へスクロール"));
      p.push(clip(c.scrollStart, c.end, 4.5, COLUMN(c.timelineRect, { w: 1280, topFrac: 0.02 }), "行動の一覧", true));
    }
  }
  if (id === "s08") {
    // AI参謀（公的な情報でも調べる）→ 銀行向け相談用資料
    const a = S.advisor_web;
    const r = S.report;
    const form = COLUMN(a.formRect, { w: 1440, topFrac: 0.25 });
    p.push(clip(a.typeStart, a.checked, 1.5, form, "AI参謀：質問を入力"));
    const okEnd = Math.min(a.sent + 1, a.checked + 2.5);
    p.push(clip(a.checked, okEnd, r2(okEnd - a.checked), form, "［公的な情報でも調べる］→送信"));
    p.push(clip(okEnd, a.result + 0.5, 1.5, null, "公的な情報を調べるのを待つ"));
    p.push(clip(a.answer, a.answer + 4.5, 4.5, COLUMN(a.bubbleRect, { w: 1440, topFrac: 0.03 }), "AI参謀の答え"));
    if (a.sourcesRect) {
      const focus = a.jcciRect ?? a.sourcesRect;
      p.push(clip(a.sources, a.sources + 4.5, 4.5, COLUMN(focus, { w: 1440, topFrac: a.jcciRect ? 0.3 : 0.15 }), "出典（公的機関）"));
    } else {
      p.push(clip(a.answer + 4.5, a.answer + 6, 4.5, COLUMN(a.bubbleRect, { w: 1440, topFrac: 0.03 }), "AI参謀の答え（続き）"));
    }
    p.push(clip(r.start, r.result + 0.5, 1.5, null, "資料→作る→AI を待つ"));
    p.push(clip(r.purpose, r.purpose + 4, 4, COLUMN(r.purposeRect, { w: 1440, topFrac: 0.05 }), "銀行向け相談用資料：相談内容"));
    // 質問リストは等速で見せる（止まった画面に「早送り」の札が出ないように）。長さの調整は相談内容の部分で行う
    p.push(clip(r.questions, r.questions + 4, 4, COLUMN(r.questionsRect, { w: 1440, topFrac: 0.04 }), "質問リスト"));
    p.find((x) => x.note.startsWith("銀行向け相談用資料")).flex = true;
  }
  if (id === "s09") {
    // AI参謀（検索なし。広報と販売）→ 先代の会話履歴
    const a = S.advisor_plain;
    const h = S.history;
    p.push(clip(a.typeStart, a.sent + 1, 2.5, COLUMN(a.formRect, { w: 1440, topFrac: 0.25 }), "AI参謀：広報と販売の相談"));
    p.push(clip(a.sent + 1, a.result + 0.5, 1.5, null, "AI を待つ"));
    p.push(clip(a.answer, a.answer + 4.5, 4.5, COLUMN(a.bubbleRect, { w: 1440, topFrac: 0.03 }), "AI参謀の答え"));
    if (a.pointsRect) p.push(clip(a.points, a.points + 4.5, 4.5, COLUMN(a.pointsRect, { w: 1440, topFrac: 0.08 }), "整理した論点と相談先"));
    else p.push(clip(a.answer + 4.5, a.end, 4.5, COLUMN(a.bubbleRect, { w: 1440, topFrac: 0.03 }), "AI参謀の答え（続き）"));
    const sec = COLUMN(h.sectionRect, { w: 1440, topFrac: 0.04 });
    const hs = Math.max(h.start, h.open - 2.6);
    p.push(clip(hs, h.open + 0.8, r2(h.open + 0.8 - hs), sec, "先代：会話履歴を開く"));
    p.push(clip(h.opened, h.opened + 5, 5, COLUMN(h.itemRect, { w: 1440, topFrac: 0.03 }), "会話履歴：資金繰りの会話"));
    p.push(clip(h.opened + 5, h.end, 2, COLUMN(h.itemRect, { w: 1440, topFrac: 0.03 }), "会話履歴：続き", true));
  }
  // 合計を場面の長さに合わせる（足りない分・多い分は flex の部分で調整。無ければ一番長い部分）
  const sum = p.reduce((a, x) => a + x.out, 0);
  const diff = sc.dur - sum;
  if (Math.abs(diff) > 0.001) {
    const target = p.find((x) => x.flex) ?? p.reduce((a, x) => (x.out > a.out ? x : a), p[0]);
    target.out = r2(target.out + diff);
    if (target.out < 0.8) throw new Error(`${id}：「${target.note}」が短くなりすぎました（${target.out}秒）。切り出しを見直してください`);
  }
  return p;
}

/** 早送りの部分（続いたものは1つにまとめる）。a・b は場面の中の秒数、real は録画の実際の秒数の合計 */
function ffGroups(plan) {
  const groups = [];
  let t = 0;
  let cur = null;
  for (const c of plan) {
    const isFF = (c.to - c.from) / c.out > FF_MIN;
    if (isFF) {
      if (cur) {
        cur.b = r2(t + c.out);
        cur.real += c.real;
      } else {
        cur = { a: r2(t), b: r2(t + c.out), real: c.real };
        groups.push(cur);
      }
    } else cur = null;
    t += c.out;
  }
  return groups;
}

const ENC = ["-an", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS)];

/** 1つの場面を mp4（映像だけ）にする。字幕と「早送り」の札もここで重ねる */
function buildScreenScene(sc) {
  const plan = screenPlan(sc.id);
  const inputs = [];
  const filters = [];
  const overlays = []; // { file, a, b }
  let tIn = 0;
  plan.forEach((c, i) => {
    let speed = (c.to - c.from) / c.out;
    if (speed < 1) speed = 1;
    c.speed = r2(speed);
    c.at = r2(tIn);
    inputs.push("-ss", c.from.toFixed(3), "-to", c.to.toFixed(3), "-i", RAW);
    const crop = c.crop ? `crop=${c.crop.w}:${c.crop.h}:${c.crop.x}:${c.crop.y},` : "";
    filters.push(
      `[${i}:v]${crop}scale=${W}:${H}:flags=lanczos,setsar=1,setpts=(PTS-STARTPTS)/${speed.toFixed(4)},fps=${FPS},` +
        `tpad=stop_mode=clone:stop_duration=${c.out + 1},trim=duration=${c.out},setpts=PTS-STARTPTS[p${i}]`,
    );
    tIn += c.out;
  });
  for (const g of ffGroups(plan)) overlays.push({ file: ffLabelFile(ffText(g.real)), a: g.a, b: g.b, ff: true, real: g.real });
  filters.push(`${plan.map((_, i) => `[p${i}]`).join("")}concat=n=${plan.length}:v=1:a=0[base]`);
  sc.captions.forEach((cap, i) => overlays.push({ file: captionFile(sc.id, i), a: cap.at, b: cap.to, fade: true }));
  let last = "base";
  let n = plan.length;
  for (const o of overlays) {
    inputs.push("-loop", "1", "-t", String(sc.dur), "-i", o.file);
    const d = o.fade ? 0.4 : 0.3;
    filters.push(`[${n}:v]format=rgba,fade=t=in:st=${o.a}:d=${d}:alpha=1,fade=t=out:st=${Math.max(o.a, o.b - d)}:d=${d}:alpha=1[o${n}]`);
    filters.push(`[${last}][o${n}]overlay=0:0:enable='between(t,${o.a},${o.b})'[v${n}]`);
    last = `v${n}`;
    n += 1;
  }
  // 文字の画面のあとの場面は、黒からふわっと始める
  filters.push(`[${last}]fade=t=in:st=0:d=0.4[vf]`);
  last = "vf";
  const out = path.join(WORK, `${sc.id}.mp4`);
  ff([...inputs, "-filter_complex", filters.join(";"), "-map", `[${last}]`, "-t", String(sc.dur), ...ENC, out]);
  return { out, plan, overlays };
}

/** 文字の画面の場面（フェードは 0.5 秒まで。s02→s03 はつなぎ目でフェードしない） */
function buildCardScene(sc) {
  const inputs = [];
  const filters = [];
  let names;
  if (sc.card === "converge") {
    // 左右の画面のまま 1 秒 → 2.5 秒かけて中央に寄る → 中央の文のまま止める
    names = ["converge"];
    inputs.push("-framerate", String(FPS), "-i", CONVERGE_PATTERN);
    filters.push(
      `[0:v]scale=${W}:${H},setsar=1,format=yuv420p,tpad=start_mode=clone:start_duration=1:stop_mode=clone:stop_duration=${sc.dur},` +
        `trim=duration=${sc.dur},setpts=PTS-STARTPTS,fade=t=out:st=${sc.dur - 0.4}:d=0.4[base]`,
    );
  } else {
    names = Array.isArray(sc.card) ? sc.card : [sc.card];
    const parts = names.length === 2 ? [sc.cardSplit, sc.dur - sc.cardSplit] : [sc.dur];
    names.forEach((name, i) => {
      const d = parts[i];
      inputs.push("-loop", "1", "-t", String(d), "-i", cardFile(name));
      const fin = sc.fadeIn === false && i === 0 ? null : sc.id === "s11" ? 0.3 : 0.5;
      const fout = sc.fadeOut === false && i === names.length - 1 ? null : 0.4;
      const fades = `${fin ? `,fade=t=in:st=0:d=${fin}` : ""}${fout ? `,fade=t=out:st=${d - fout}:d=${fout}` : ""}`;
      filters.push(`[${i}:v]scale=${W}:${H},setsar=1,fps=${FPS},format=yuv420p${fades}[c${i}]`);
    });
    filters.push(`${names.map((_, i) => `[c${i}]`).join("")}concat=n=${names.length}:v=1:a=0[base]`);
  }
  let last = "base";
  let n = names.length;
  for (const [i, cap] of sc.captions.entries()) {
    inputs.push("-loop", "1", "-t", String(sc.dur), "-i", captionFile(sc.id, i));
    filters.push(`[${n}:v]format=rgba,fade=t=in:st=${cap.at + 0.3}:d=0.4:alpha=1,fade=t=out:st=${cap.to - 0.5}:d=0.4:alpha=1[o${n}]`);
    filters.push(`[${last}][o${n}]overlay=0:0[v${n}]`);
    last = `v${n}`;
    n += 1;
  }
  const out = path.join(WORK, `${sc.id}.mp4`);
  ff([...inputs, "-filter_complex", filters.join(";"), "-map", `[${last}]`, "-t", String(sc.dur), ...ENC, out]);
  return { out, plan: [], overlays: [] };
}

// 「早送り」の札は、場面の切り出しを決めてから必要な文言だけ作る
for (const sc of SCENES.filter((s) => s.kind === "screen")) {
  for (const g of ffGroups(screenPlan(sc.id))) ffLabelFile(ffText(g.real));
}
await renderFastForward(ffLabels);

const built = [];
for (const sc of SCENES) {
  const t0 = Date.now();
  const b = sc.kind === "screen" ? buildScreenScene(sc) : buildCardScene(sc);
  built.push({ sc, ...b });
  for (const o of b.overlays.filter((x) => x.ff)) console.log(`   札「${ffText(o.real)}」 場面の ${o.a}〜${o.b}秒`);
  console.log(`場面 ${sc.id}（${sc.dur}秒）を作りました（${Math.round((Date.now() - t0) / 1000)}秒）`);
  for (const c of b.plan) {
    console.log(`   ${c.note}: 録画 ${r2(c.real)}秒 → ${c.out}秒（${c.speed}倍）${c.speed > FF_MIN ? " ［早送り］" : ""}`);
  }
}

// ---- つなぐ・左下の表示・音声 ----
const list = path.join(WORK, "concat.txt");
fs.writeFileSync(list, built.map((b) => `file '${b.out.replace(/\\/g, "/")}'`).join("\n"), "utf8");
const joined = path.join(WORK, "joined.mp4");
ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);

const TTS = path.join(OUT, "tts");
const tts = JSON.parse(fs.readFileSync(path.join(TTS, "tts.json"), "utf8").replace(/^﻿/, ""));
const ttsList = Array.isArray(tts) ? tts : [tts];

function finalEncode(outFile, withNarration) {
  const inputs = ["-i", joined, "-loop", "1", "-t", String(TOTAL), "-i", DISCLAIMER_FILE];
  const filters = [`[0:v][1:v]overlay=0:0,format=yuv420p[v]`];
  let amap;
  if (withNarration) {
    ttsList.forEach((t, i) => {
      inputs.push("-i", path.join(TTS, t.file));
      const sc = SCENES.find((s) => s.id === t.id);
      const at = Math.round((sc.start + NARRATION_LEAD) * 1000);
      filters.push(`[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${at}|${at}[a${i}]`);
    });
    filters.push(`${ttsList.map((_, i) => `[a${i}]`).join("")}amix=inputs=${ttsList.length}:normalize=0:dropout_transition=0,apad,atrim=0:${TOTAL}[aout]`);
    amap = "[aout]";
  } else {
    inputs.push("-f", "lavfi", "-t", String(TOTAL), "-i", "anullsrc=r=48000:cl=stereo");
    amap = "2:a";
  }
  ff([
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", amap,
    "-t", String(TOTAL),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    outFile,
  ]);
}
const FINAL = path.join(OUT, "tsugu-ai-demo-v2.mp4");
const FINAL_NN = path.join(OUT, "tsugu-ai-demo-v2-nonarration.mp4");
finalEncode(FINAL, true);
finalEncode(FINAL_NN, false);

// ---- 字幕ファイル（大きな字幕とナレーションを、読みやすい長さに区切る） ----
function chunks(text, max = 26) {
  const out = [];
  for (const sentence of text.split(/(?<=。)/).filter(Boolean)) {
    if (sentence.length <= max) {
      out.push(sentence);
      continue;
    }
    let cur = "";
    for (const p of sentence.split(/(?<=、)/)) {
      if ((cur + p).length > max && cur) {
        out.push(cur);
        cur = p;
      } else cur += p;
    }
    if (cur) out.push(cur);
  }
  return out;
}
const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const cues = [];
for (const sc of SCENES) {
  for (const cap of sc.captions) cues.push({ a: sc.start + cap.at + 0.3, b: sc.start + cap.to - 0.1, text: `【字幕】${cap.text}` });
  if (sc.cardText) {
    const a = sc.card === "converge" ? sc.start + 2.5 : sc.start + 0.5;
    const b = sc.cardSplit ? sc.start + sc.cardSplit - 0.3 : sc.start + sc.dur - 0.3;
    cues.push({ a, b, text: `【字幕】${sc.cardText}` });
  }
  if (!sc.narration) continue;
  const t = ttsList.find((x) => x.id === sc.id);
  const start = sc.start + NARRATION_LEAD;
  const dur = t ? t.seconds : sc.dur - 1;
  const cs = chunks(sc.narration.text);
  const total = cs.reduce((a, c) => a + c.length, 0);
  let at = start;
  for (const c of cs) {
    const d = (dur * c.length) / total;
    cues.push({ a: at, b: Math.min(at + d, sc.start + sc.dur - 0.05), text: c });
    at += d;
  }
}
cues.sort((x, y) => x.a - y.a);
const srt = cues.map((c, i) => `${i + 1}\r\n${srtTime(c.a)} --> ${srtTime(c.b)}\r\n${c.text}\r\n`).join("\r\n");
fs.writeFileSync(path.join(HERE, "subtitles.srt"), srt, "utf8");

// ---- 確認（尺・解像度・コーデック・音声）と静止画 ----
function probe(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const e = r.stderr;
  return {
    file,
    duration: (e.match(/Duration: ([\d:.]+)/) ?? [])[1],
    video: (e.match(/Stream #\S+.*Video: (.+)/) ?? [])[1],
    audio: (e.match(/Stream #\S+.*Audio: (.+)/) ?? [])[1] ?? "なし",
  };
}
const report = { offset: r2(OFFSET), probes: [probe(FINAL), probe(FINAL_NN)], scenes: [] };
for (const b of built) {
  report.scenes.push({
    id: b.sc.id,
    start: b.sc.start,
    dur: b.sc.dur,
    parts: b.plan.map((c) => ({ note: c.note, realSec: r2(c.real), outSec: c.out, speed: c.speed, fastForwardPart: c.speed > FF_MIN })),
    fastForwardLabels: b.overlays.filter((o) => o.ff).map((o) => ({ text: ffText(o.real), from: r2(b.sc.start + o.a), to: r2(b.sc.start + o.b), realSec: r2(o.real) })),
  });
}
const at = (id, notePrefix, frac = 0.6) => {
  const b = built.find((x) => x.sc.id === id);
  const c = b.plan.find((x) => x.note === notePrefix) ?? b.plan.find((x) => x.note.startsWith(notePrefix));
  if (!c) return null;
  return r2(b.sc.start + c.at + c.out * frac);
};
const stills = [
  ["01-misunderstanding", 6],
  ["02-split", 22],
  ["03-converge", 41],
  ["04-pred-policy-summary", at("s04", "先代：要約カード")],
  ["05-succ-policy-summary", at("s04", "後継者：要約カード")],
  ["06-diagnosis-fastforward", at("s05", "診断を待つ", 0.5)],
  ["07-gap-cashflow-high", at("s05", "資金繰り（重要度 高）")],
  ["08-directions-keep", at("s05", "これからの選択肢")],
  ["09-directions-trynew", at("s05", "新しく試したいこと")],
  ["10-learning-compare", at("s06", "学習プラン：前と今")],
  ["11-plan-small-try", at("s06", "「小さく試す」行動", 0.6) ?? at("s06", "行動の一覧")],
  ["12-circle", 106],
  ["13-advisor-sources", at("s08", "出典") ?? at("s08", "AI参謀の答え（続き）")],
  ["14-bank-questions", at("s08", "質問リスト")],
  ["15-advisor-points", at("s09", "整理した論点") ?? at("s09", "AI参謀の答え（続き）")],
  ["16-history", at("s09", "会話履歴：資金繰り")],
  ["17-logo", 166],
].filter(([, t]) => t !== null);
for (const [name, t] of stills) {
  ff(["-ss", String(t), "-i", FINAL, "-frames:v", "1", path.join(CHECK, `${name}.png`)]);
}
report.stills = stills.map(([n, t]) => ({ file: path.join(CHECK, `${n}.png`), t }));
fs.writeFileSync(path.join(OUT, "edit-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report.probes, null, 2));
console.log(`静止画: ${CHECK}`);
