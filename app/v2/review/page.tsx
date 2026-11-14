import type { Metadata } from "next";
import ReviewClient from "@/components/v2/ReviewClient";

export const metadata: Metadata = { title: "内容の確認｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <ReviewClient />;
}
