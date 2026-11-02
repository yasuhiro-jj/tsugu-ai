// アプリ全体の設定値。モデル名はここ以外に直書きしない。

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

/** 環境変数 CLAUDE_MODEL があればそれを、無ければ既定値を返す。 */
export function getClaudeModel(): string {
  const fromEnv = process.env.CLAUDE_MODEL?.trim();
  return fromEnv ? fromEnv : DEFAULT_CLAUDE_MODEL;
}
