import type { Metadata } from "next";
import ReportPreviewClient from "@/components/v2/ReportPreviewClient";

export const metadata: Metadata = { title: "資料の下書き｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <ReportPreviewClient />;
}
