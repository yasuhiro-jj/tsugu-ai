import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { getMode } from "@/lib/v2/mode";

export const metadata: Metadata = { title: "ログイン｜TSUGU AI 2.0（試作）" };
export const dynamic = "force-dynamic";

// ログインの画面。検証用の動かし方のときだけ、Clerk のログインの部品を出す。
export default function Page() {
  if (getMode() !== "verify") {
    return (
      <div className="card">
        <p>この環境では、ログインは使いません。そのまま始められます。</p>
        <Link className="button" href="/v2">
          最初の画面へ
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="page-title">ログイン</h1>
      <p className="lead">検証用の環境です。架空の名前とメールアドレスでお試しください。</p>
      <SignIn fallbackRedirectUrl="/v2" signUpUrl="/v2/sign-up" />
    </>
  );
}
