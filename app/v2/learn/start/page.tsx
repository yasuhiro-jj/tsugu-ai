import type { Metadata } from "next";
import LearnGuideClient from "@/components/v2/LearnGuideClient";

export const metadata: Metadata = { title: "自分に合う学びを選ぶ｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <LearnGuideClient />;
}
