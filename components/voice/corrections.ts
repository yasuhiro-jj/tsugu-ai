/**
 * 音声入力の聞き間違いを直す置き換え表。音声から文字にした結果にだけ当てる（キーボードで打った文字には当てない）。
 * 誤爆（正しい言葉まで変えてしまうこと）の多いものは入れない。迷う語は足さない。
 * 上から順に当てる（「仙台さん」→「先代さん」→「先代」のように、前の置き換えの結果に後ろが当たる）。
 */
export const TRANSCRIPT_CORRECTIONS: ReadonlyArray<readonly [from: string, to: string]> = [
  // オーナーが報告した聞き間違い（2026-11-03）
  ["仙台", "先代"],
  ["洗剤", "先代"],
  ["せんだい", "先代"],
  // オーナー指定：「先代さん」も「先代」にそろえる
  ["先代さん", "先代"],
  // ひらがなのまま出たとき（ほかの言葉と取り違えにくいものだけ）
  ["こうけいしゃ", "後継者"],
];

/** 音声から文字にした文の聞き間違いを、置き換え表で直す */
export function correctTranscript(text: string): string {
  let out = text;
  for (const [from, to] of TRANSCRIPT_CORRECTIONS) {
    out = out.split(from).join(to);
  }
  return out;
}
