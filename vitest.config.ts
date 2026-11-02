import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// テストは本番 Turso・本物の Claude を使わない（tests/helpers.ts でメモリ DB と偽の AI に差し替える）。
const root = fileURLToPath(new URL("./", import.meta.url)).replace(/\\/g, "/");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: root },
      // server-only はテスト環境では空のモジュールに置き換える
      { find: /^server-only$/, replacement: root + "tests/stubs/server-only.ts" },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      // 万一のため、テスト中は本物の接続情報を空にする
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
