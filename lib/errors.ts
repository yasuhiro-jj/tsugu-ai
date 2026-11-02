// 利用者に見せてよい日本語メッセージを持つエラー（Next.js に依存しない。テストからも使う）。

/** status は HTTP ステータス。userMessage はそのまま画面に出してよい日本語だけを入れる。 */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly userMessage: string,
  ) {
    super(userMessage);
    this.name = "ServiceError";
  }
}
