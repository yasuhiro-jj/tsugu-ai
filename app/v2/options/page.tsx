import type { Metadata } from "next";
import OptionsClient from "@/components/v2/OptionsClient";

export const metadata: Metadata = { title: "選択肢｜TSUGU AI 2.0（試作）" };

export default function Page() {
  return <OptionsClient />;
}
