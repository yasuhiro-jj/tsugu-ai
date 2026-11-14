import type { Metadata } from "next";
import LearnListClient from "@/components/v2/LearnListClient";

export const metadata: Metadata = { title: "講座｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <LearnListClient />;
}
