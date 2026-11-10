import Link from "next/link";
import type { ReactNode } from "react";
import "./v2.css";

// 2.0（試作）の共通の枠。
// - ハッカソン版の上部メニューは 2.0 の利用者に関係がないので、2.0 の画面でだけ隠す（v2.css）。
//   既存のファイルは変更していない。
// - どの画面でも「架空の情報だけ」を最初に伝える。
export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <div className="v2">
      <div className="v2-header">
        <Link href="/v2" className="v2-header__brand">
          TSUGU AI 2.0
        </Link>
        <span className="v2-header__tag">試作</span>
        <span className="v2-header__lead">後継者が決まっていない飲食店の、相談の準備</span>
      </div>
      <p className="v2-banner" role="note">
        <strong>TSUGU AI 2.0 の試作です。</strong>
        架空の情報だけを入力してください。実在のお店・人・金額は入力しないでください。
      </p>
      {children}
    </div>
  );
}
