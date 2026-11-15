"use client";

// 検証用の動かし方のときだけ表示する、ログインの状態（Clerk の部品）。
// ログイン済みなら本人のメニュー、まだなら「ログイン」へのリンクを出す。

import { useAuth, UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function AccountMenu() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  return isSignedIn ? <UserButton /> : <Link href="/v2/sign-in">ログイン</Link>;
}
