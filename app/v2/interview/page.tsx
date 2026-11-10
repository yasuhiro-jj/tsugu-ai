import type { Metadata } from "next";
import InterviewClient from "@/components/v2/InterviewClient";

export const metadata: Metadata = { title: "面談｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <InterviewClient />;
}
