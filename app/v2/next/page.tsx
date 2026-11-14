import type { Metadata } from "next";
import NextStepsClient from "@/components/v2/NextStepsClient";

export const metadata: Metadata = { title: "次の一歩｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <NextStepsClient />;
}
