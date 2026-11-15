import { SignUp } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { getMode } from "@/lib/v2/mode";

export const metadata: Metadata = { title: "はじめての方｜TSUGU AI 2.0（試作）" };
export const dynamic = "force-dynamic";

// 利用の登録の画面。検証用の動かし方のときだけ、Clerk の登録の部品を出す。
export default function Page() {
  if (getMode() !== "verify") {
    return (
      <div className="card">
        <p>この環境では、登録は使いません。そのまま始められます。</p>
        <Link className="button" href="/v2">
          最初の画面へ
        </Link>
      </div>
    );
  }
  return (
    <>
      <h1 className="page-title">はじめての方</h1>
      <p className="lead">検証用の環境です。実在の方の情報は登録しないでください。</p>
      <SignUp fallbackRedirectUrl="/v2" signInUrl="/v2/sign-in" />
    </>
  );
}
