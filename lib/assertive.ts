// AI の出力の「言い切り」を軽く確かめる（SEC-A02・SEC-302）。画面からも import してよい（server-only は付けない）。
//
// - 断定しないことは指示文で縛っている。これは出力側の念のための確認で、すべての言い切りを見つけるものではない
// - 見つかっても返事は消さない・書き換えない。固定の注記（ASSERTIVE_CAUTION）を足し、ログには種類だけを出す（本文は出さない）
// - 「〜か？」で終わる質問（例：「融資を受けられますか」）や「保証するものではありません」は対象にしない

export const ASSERTIVE_CAUTION = "AI の言い切りに見える表現があります。判断は専門家と本人で行ってください";

/** 言い切りの種類（ログに出すのはこの名前だけ） */
export type AssertiveKind = "certain_outcome" | "loan_outcome" | "certainly" | "guarantee" | "succession_verdict";

const PATTERNS: { kind: AssertiveKind; re: RegExp }[] = [
  // 「必ず〜できます」「必ず黒字になります」など（「必ず専門家に確認してください」は対象外）
  {
    kind: "certain_outcome",
    re: /(?:必ず|絶対に?|間違いなく)[^。！？!?\n]{0,20}?(?:できます|できる|なります|成功します|うまくいきます|儲かります|改善します|回復します|上がります|増えます|減ります|下がります)(?!か)/u,
  },
  // 「融資が通ります」「融資を受けられます」（「通るかは銀行が判断します」「受けられますか」は対象外）
  {
    kind: "loan_outcome",
    re: /(?:融資|借入|借り入れ|審査)[^。！？!?\n]{0,12}?(?:通ります|通る(?![かとの])|受けられます|下ります|借りられます|承認されます)(?!か)/u,
  },
  // 「確実に」「確実です」（「不確実」は対象外）
  { kind: "certainly", re: /(?<!不)確実(?:に|です|だ)/u },
  // 「保証します」「保証できます」（「保証するものではありません」は対象外）
  { kind: "guarantee", re: /保証(?:します|いたします|できます)(?!か)/u },
  // 継ぐ・継がないの結論（「継ぐべきです」「継がないほうがいい」）
  {
    kind: "succession_verdict",
    re: /(?:継ぐ|継がない|継いだ|継がず|承継する|承継しない|事業承継する|引き継ぐ|引き継がない|廃業する|手放す|売却する)(?:べき|(?:ほう|方)が(?:いい|よい|良い))/u,
  },
];

/** 言い切りに見える表現の種類を返す（重複なし・見つからなければ空）。本文の一部は返さない */
export function findAssertiveClaims(text: string): AssertiveKind[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.kind);
}

/**
 * 複数の文をまとめて確かめる。見つかったら種類だけをログに出し、固定の注記を返す（無ければ undefined）。
 * where はログの出どころ（例："advisor.message"）。本文・デモ用 ID はログに出さない。
 */
export function cautionFor(where: string, texts: readonly string[]): string | undefined {
  const kinds = new Set<AssertiveKind>();
  for (const t of texts) for (const k of findAssertiveClaims(t)) kinds.add(k);
  if (kinds.size === 0) return undefined;
  console.warn(JSON.stringify({ level: "warn", where, event: "assertive_output", kinds: [...kinds] }));
  return ASSERTIVE_CAUTION;
}
