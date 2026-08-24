import React from "react";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { TranscriptEditor } from "./transcript-editor";

export const dynamic = "force-dynamic";

export default async function EditTranscriptPage({ params }: { params: { lessonId: string } }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/sin-acceso");

  const { lessonId } = params;

  // Fetch lesson data
  const { data: lesson, error } = await supabase
    .from("lessons")
    .select(`
      id,
      title,
      is_active,
      sort_order,
      module_id,
      course_modules:module_id (
        id,
        title,
        sort_order,
        is_active,
        course_id,
        courses:course_id (
          id,
          title,
          status,
          course_kind
        )
      )
    `)
    .eq("id", lessonId)
    .maybeSingle();

  if (error) {
    console.error("[Admin Transcriptions] lesson fetch failed", error);
    return <div>No pude cargar la clase por un error interno.</div>;
  }

  if (!lesson) {
    return <div>Clase no encontrada</div>;
  }

  // Fetch transcript data
  const { data: transcript } = await supabase
    .from("lesson_transcripts")
    .select("*")
    .eq("lesson_id", lessonId)
    .maybeSingle();

  // Fetch segments if transcript exists
  let segments = [];
  if (transcript) {
    const { data: segs } = await supabase
      .from("lesson_transcript_segments")
      .select("*")
      .eq("transcript_id", transcript.id)
      .order("position", { ascending: true });
    if (segs) segments = segs;
  }

  const moduleInfo = Array.isArray(lesson.course_modules) ? lesson.course_modules[0] : lesson.course_modules;
  const courseInfo = moduleInfo ? (Array.isArray((moduleInfo as any).courses) ? (moduleInfo as any).courses[0] : (moduleInfo as any).courses) : null;

  return (
    <div className="pb-12">
      <TranscriptEditor
        lessonId={lessonId}
        lessonTitle={lesson.title}
        moduleTitle={(moduleInfo as any)?.title}
        courseTitle={courseInfo?.title}
        initialTranscript={transcript}
        initialSegments={segments}
      />
    </div>
  );
}
