import type { ReactNode } from "react";
import "./v2.css";

// 2.0（試作）の共通の枠。どの画面でも「架空の情報だけ」を最初に伝える。
export default function V2Layout({ children }: { children: ReactNode }) {
  return (
    <div className="v2">
      <p className="v2-banner" role="note">
        <strong>TSUGU AI 2.0 の試作です。</strong>
        架空の情報だけを入力してください。実在のお店・人・金額は入力しないでください。
      </p>
      {children}
    </div>
  );
}
