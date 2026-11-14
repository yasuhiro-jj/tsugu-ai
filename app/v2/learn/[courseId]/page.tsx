import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CourseClient from "@/components/v2/CourseClient";
import { courseDef, isCourseId } from "@/lib/v2/courses";

type Props = { params: Promise<{ courseId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { courseId } = await params;
  const title = isCourseId(courseId) ? courseDef(courseId).title : "講座";
  return { title: `${title}｜TSUGU AI 2.0（試作）` };
}

export default async function Page({ params }: Props) {
  const { courseId } = await params;
  if (!isCourseId(courseId)) notFound();
  return <CourseClient courseId={courseId} />;
}
