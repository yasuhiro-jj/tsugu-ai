import type { Metadata } from "next";
import ReportSettingsClient from "@/components/v2/ReportSettingsClient";

export const metadata: Metadata = { title: "資料に載せる項目｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <ReportSettingsClient />;
}
