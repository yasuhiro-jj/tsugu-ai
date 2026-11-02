import "server-only";

// 閲覧者ごとのデモ用 ID（CLAUDE.md「閲覧者ごとにデモを分ける」）。
// - 初回の役割選択（POST /api/role）でサーバーが発行し、httpOnly クッキーに入れる
// - 値は crypto.randomBytes(32) の base64url（43文字、推測不能）
// - データの保存・取得は必ず「デモ用 ID ＋ 役割」で絞り込む。クライアントから送られた ID は使わない

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getRole, type Role } from "./role";

export const DEMO_COOKIE = "tsugu_demo";

const DEMO_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isDemoId(value: unknown): value is string {
  return typeof value === "string" && DEMO_ID_PATTERN.test(value);
}

export function newDemoId(): string {
  return randomBytes(32).toString("base64url");
}

/** クッキーからデモ用 ID を読む。未設定・形式不正は null。 */
export async function getDemoId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(DEMO_COOKIE)?.value;
  return isDemoId(value) ? value : null;
}

export type Session = { demoId: string; role: Role };

/** デモ用 ID と役割の両方がそろっていれば返す。どちらか無ければ null（API は 401 を返す）。 */
export async function getSession(): Promise<Session | null> {
  const [demoId, role] = await Promise.all([getDemoId(), getRole()]);
  if (!demoId || !role) return null;
  return { demoId, role };
}
