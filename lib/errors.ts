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

/** 楽観ロック（rev）が合わなかったときの共通メッセージ */
export const MSG_CONFLICT = "ほかの操作と重なりました。画面を読み込み直してください";
