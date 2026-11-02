import "server-only";

// サーバー専用（Server Component / Route Handler / Server Action からのみ import すること）。
// クライアントコンポーネントから import しない。
//
// 注意：これはデモ用の「先代として入る／後継者として入る」切り替えであり、認証ではない。
// 将来、非公開回答の絞り込みはサーバー側でこの getRole()（または本番の認証主体）を基準に行う。
// クライアントから送られた role / 回答者 ID をそのまま信用して絞り込まないこと。

import { cookies } from "next/headers";

export type Role = "predecessor" | "successor";

export const ROLE_COOKIE = "tsugu_role";

export const ROLES: readonly Role[] = ["predecessor", "successor"] as const;

export function isRole(value: unknown): value is Role {
  return value === "predecessor" || value === "successor";
}

/** クッキーから現在の役割を読む。未設定・不正値は null。 */
export async function getRole(): Promise<Role | null> {
  const store = await cookies();
  const value = store.get(ROLE_COOKIE)?.value;
  return isRole(value) ? value : null;
}
