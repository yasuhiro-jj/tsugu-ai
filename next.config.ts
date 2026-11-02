import path from "node:path";
import type { NextConfig } from "next";

// ブラウザに送る基本的な安全設定（security 指摘 SEC-005）
const securityHeaders = [
  // 他サイトへの埋め込み（クリックジャッキング）を防ぐ
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 親フォルダの package-lock.json をルートと誤認しないよう、このフォルダをルートに固定する
  turbopack: { root: path.resolve(".") },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
