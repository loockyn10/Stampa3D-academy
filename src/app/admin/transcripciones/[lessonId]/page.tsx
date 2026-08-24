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

  const { lessonId: paramLessonId } = await params;
  const lessonId = paramLessonId;
  
  console.log("[Admin Transcriptions] editor params", {
    lessonId,
    type: typeof lessonId,
  });

  // 1. Fetch lesson
  const { data: lesson, error: lessonError } = await supabase
    .from("lessons")
    .select("id,title,module_id,is_active,sort_order,created_at")
    .eq("id", lessonId)
    .maybeSingle();

  if (lessonError) {
    console.error("[Admin Transcriptions] lesson fetch failed", { lessonId, error: lessonError });
    return <div>No pude cargar la clase por un error interno.</div>;
  }

  if (!lesson) {
    return <div>Clase no encontrada</div>;
  }

  // 2. Fetch module
  const { data: module, error: moduleError } = await supabase
    .from("course_modules")
    .select("id,title,course_id,is_active,sort_order")
    .eq("id", lesson.module_id)
    .maybeSingle();

  if (moduleError) {
    console.error("[Admin Transcriptions] module fetch failed", moduleError);
  }

  // 3. Fetch course
  const { data: course, error: courseError } = module?.course_id
    ? await supabase
        .from("courses")
        .select("id,title,status,course_kind")
        .eq("id", module.course_id)
        .maybeSingle()
    : { data: null, error: null };

  if (courseError) {
    console.error("[Admin Transcriptions] course fetch failed", courseError);
  }

  // 4. Fetch transcript
  const { data: transcript, error: transcriptError } = await supabase
    .from("lesson_transcripts")
    .select("*")
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (transcriptError) {
    console.error("[Admin Transcriptions] transcript fetch failed", transcriptError);
  }

  // 5. Fetch segments
  const { data: segments, error: segmentsError } = transcript?.id
    ? await supabase
        .from("lesson_transcript_segments")
        .select("id,transcript_id,lesson_id,position,start_seconds,end_seconds,text,created_at")
        .eq("transcript_id", transcript.id)
        .order("position", { ascending: true })
    : { data: [], error: null };

  if (segmentsError) {
    console.error("[Admin Transcriptions] segments fetch failed", segmentsError);
  }

  return (
    <div className="pb-12">
      <TranscriptEditor
        lessonId={lessonId}
        lessonTitle={lesson.title}
        moduleTitle={module?.title}
        courseTitle={course?.title}
        initialTranscript={transcript}
        initialSegments={segments || []}
      />
    </div>
  );
}
