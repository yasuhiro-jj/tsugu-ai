// デモ用の面談相手の設定（すべて架空。Notion「デモ会社設定：食事処 つぐみ」より）。
// 実在の個人・会社・財務データは入れないこと。
// 面談中の AI には決算の具体的な数字を渡さない（company_context は概要だけ）。

import type { Role } from "./role";

export type DemoProfile = {
  roleLabel: string; // 先代 / 後継者
  name: string;
  route: string; // 身内 / 第三者
  level: string; // Lv1〜Lv4
  partnerLabel: string;
};

export const COMPANY_CONTEXT =
  "和食の食事処、創業1968年、年商約5,400万円、正社員2名・パート7名。先代は2代目の料理長";

export const DEMO_PROFILES: Record<Role, DemoProfile> = {
  predecessor: {
    roleLabel: "先代",
    name: "森川 修",
    route: "身内",
    level: "Lv2",
    partnerLabel: "後継者",
  },
  successor: {
    roleLabel: "後継者",
    name: "森川 拓也",
    route: "身内",
    level: "Lv1",
    partnerLabel: "先代",
  },
};
