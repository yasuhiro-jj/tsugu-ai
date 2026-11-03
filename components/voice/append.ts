/**
 * 音声入力の文字を、入力欄の今の文の後ろに足す（上書きしない）。
 * 上限は UTF-16 の長さで数える。これは入力欄の maxLength と同じ数え方で、
 * サーバーの数え方（絵文字なども1文字）より必ず同じか厳しいので、どちらの上限にも収まる。
 * 絵文字などを途中で割らないよう、1文字ずつ足す。
 */

export type AppendOptions = {
  /** 入力欄の上限文字数 */
  max: number;
  /** 今の文と足す文の間に入れる区切り。今の文が空か空白で終わるときは入れない。省略時は半角スペース */
  separator?: string;
  /** 1行入力のとき true。足す文に含まれる改行を半角スペースに置き換える */
  singleLine?: boolean;
};

export type AppendResult = {
  text: string;
  /** 上限に届き、足しきれなかった分があるとき true */
  truncated: boolean;
};

export function appendWithinLimit(current: string, addition: string, options: AppendOptions): AppendResult {
  const { max, separator = " ", singleLine = false } = options;
  const add = singleLine ? addition.replace(/\r\n|\r|\n/g, " ") : addition;
  const sep = current.length === 0 || /\s$/.test(current) ? "" : separator;
  const base = current + sep;
  let text = base;
  for (const ch of Array.from(add)) {
    if (text.length + ch.length > max) {
      // 1文字も入らなかったときは、区切りも足さない
      return { text: text === base ? current : text, truncated: true };
    }
    text += ch;
  }
  return { text, truncated: false };
}

/** 上限に届いて切ったときの案内文 */
export function voiceLimitNotice(max: number): string {
  return `${max} 文字の上限に達したため、残りは入れませんでした。`;
}
