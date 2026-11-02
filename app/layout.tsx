import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "TSUGU AI",
  description: "先代と後継者の認識差を見える化する、事業承継の対話支援サービス（デモ）",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <a className="skip-link" href="#main">
          本文へ移動
        </a>
        <Header />
        <main id="main" className="container main">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
