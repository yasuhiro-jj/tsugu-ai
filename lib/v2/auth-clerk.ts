import "server-only";

// Clerk でログインした人を、権限確認（lib/v2/access.ts）が使う形にする。
// 検証用の動かし方（lib/v2/mode.ts の verify）のときだけ使う。
//
// いまの決まり
// - 経営者本人ひとりが、ひとつの会社として扱われる（会社の ID ＝ 本人の ID）。
//   同じ会社に複数の人が所属する形は、まだ作っていない
// - 役割は「経営者本人」だけ。運営担当者の役割は、まだ Clerk とつないでいない
// - 多要素認証を通ったかどうかは、まだ確かめていない（実データを扱う前に加える）
//
// 本人の確認は Clerk に任せる。ここでは、Clerk が「ログイン済み」と確かめた人の ID だけを受け取る。
// 画面から送られてきた ID は使わない。

import { auth } from "@clerk/nextjs/server";
import type { AuthProvider } from "./auth";

/** 保存先が受け付ける ID の形（lib/v2/store-libsql.ts と同じ）。合わない ID は、ログインしていないものとして扱う */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function createClerkAuth(): AuthProvider {
  return {
    async resolve() {
      const { userId } = await auth();
      if (!userId || !ID_PATTERN.test(userId)) return null;
      return { userId, tenantId: userId, role: "owner" };
    },
  };
}
