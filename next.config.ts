import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 親フォルダの package-lock.json をルートと誤認しないよう、このフォルダをルートに固定する
  turbopack: { root: path.resolve(".") },
};

export default nextConfig;
