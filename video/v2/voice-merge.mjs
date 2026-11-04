// v2：オーナーの声（場面ごとの録音 video/v2/voice/s01〜s10.*）を、字幕だけの版に重ねて MP4 を作る。
// v1 の video/voice-merge.mjs をコピーして直したもの（v1 は変更しない）。
// 実行：node video/v2/voice-merge.mjs
// - 各ファイルの前後の無音を切り、音量をそろえ（loudnorm）、場面の上限に収まらなければ最大 1.15 倍まで速める
// - 1.15 倍でも収まらない場面は作らずに止め、撮り直す場面を表示する
// - 出力：video/v2/out/tsugu-ai-demo-v2-voice.mp4（字幕だけの版 tsugu-ai-demo-v2-nonarration.mp4 が必要）
// - 場面の上限は narration.txt の「上限○秒」と同じ（scenes.mjs の limitOf）
// 録音ファイルは個人の声なので Git の対象外（.gitignore の video/v2/voice/）

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SCENES, TOTAL, NARRATION_LEAD, limitOf } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VOICE_DIR = path.join(HERE, "voice");
const OUT_DIR = path.join(HERE, "out");
const WORK = path.join(OUT_DIR, "voice-work");
const BASE = path.join(OUT_DIR, "tsugu-ai-demo-v2-nonarration.mp4");
const OUTPUT = path.join(OUT_DIR, "tsugu-ai-demo-v2-voice.mp4");
const FFMPEG = createRequire(import.meta.url)("ffmpeg-static");
const MAX_TEMPO = 1.15;
const EXTS = [".m4a", ".mp3", ".wav", ".aac", ".ogg", ".webm", ".mp4"];

function ff(args) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg に失敗しました:\n${args.join(" ")}\n${r.stderr}`);
  return r.stderr;
}

/** ffmpeg の出力から長さ（秒）を読む */
function durationOf(file) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  if (!m) throw new Error(`長さを読めませんでした: ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function findVoice(id) {
  for (const ext of EXTS) {
    const f = path.join(VOICE_DIR, id + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

if (!fs.existsSync(BASE)) throw new Error(`字幕だけの版がありません: ${BASE}`);
fs.mkdirSync(WORK, { recursive: true });

const spoken = SCENES.filter((s) => s.narration && s.narration.text && !s.narration.text.startsWith("（"));
const missing = spoken.filter((s) => !findVoice(s.id)).map((s) => s.id);
if (missing.length) {
  console.log(`まだ録音が無い場面: ${missing.join("、")}（video/v2/voice/ に ${missing[0]}.m4a などの名前で置いてください）`);
  process.exit(2);
}

const placed = [];
const retake = [];
for (const s of spoken) {
  const src = findVoice(s.id);
  const limit = limitOf(s); // 場面の終わりに少し余白を残す
  // 1) 前後の無音を切って、音量をそろえる（48kHz・ステレオ）
  const clean = path.join(WORK, `${s.id}-clean.wav`);
  ff([
    "-i", src,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15," +
      "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse," +
      "loudnorm=I=-18:TP=-2:LRA=11",
    "-ar", "48000", "-ac", "2", clean,
  ]);
  const len = durationOf(clean);
  // 2) 上限に収まらなければ速める（最大 1.15 倍）
  let tempo = 1;
  if (len > limit) tempo = len / limit;
  if (tempo > MAX_TEMPO) {
    retake.push(`${s.id}：${len.toFixed(1)} 秒（上限 ${limit.toFixed(1)} 秒。もう少し速めに読んで撮り直してください）`);
    continue;
  }
  const fitted = path.join(WORK, `${s.id}-fit.wav`);
  ff(["-i", clean, "-af", tempo > 1 ? `atempo=${tempo.toFixed(4)}` : "anull", fitted]);
  placed.push({ id: s.id, file: fitted, at: s.start + NARRATION_LEAD, len: len / tempo, tempo });
}

if (retake.length) {
  console.log("上限に収まらない場面があるため、動画は作っていません：");
  for (const r of retake) console.log("  " + r);
  process.exit(1);
}

// 3) 各場面の声を開始時刻に置いて重ね、字幕だけの版の映像と合わせる
const inputs = ["-i", BASE];
const filters = [];
placed.forEach((p, i) => {
  inputs.push("-i", p.file);
  const ms = Math.round(p.at * 1000);
  filters.push(`[${i + 1}:a]adelay=${ms}|${ms}[v${i}]`);
});
filters.push(
  `${placed.map((_, i) => `[v${i}]`).join("")}amix=inputs=${placed.length}:normalize=0:dropout_transition=0,` +
    `apad,atrim=0:${TOTAL}[aout]`,
);
ff([
  ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", "0:v", "-map", "[aout]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-t", String(TOTAL), "-movflags", "+faststart",
  OUTPUT,
]);

console.log(`できました: ${OUTPUT}（${durationOf(OUTPUT).toFixed(2)} 秒）`);
for (const p of placed) {
  console.log(`  ${p.id}: ${p.at.toFixed(1)} 秒から ${p.len.toFixed(1)} 秒${p.tempo > 1 ? `（${p.tempo.toFixed(2)} 倍に速めた）` : ""}`);
}
