import type { Metadata } from "next";
import PrepClient from "@/components/v2/PrepClient";

export const metadata: Metadata = { title: "準備リスト｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <PrepClient />;
}
