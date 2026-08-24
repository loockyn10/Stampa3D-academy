"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

export async function upsertLessonTranscript(lessonId: string, payload: {
  status: string;
  source_type: string;
  language: string;
  transcript_text: string;
}) {
  const supabase = await createClient();
  
  // Verify admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  
  if (profile?.role !== "admin") return { error: "No autorizado" };

  // Validaciones
  if (!lessonId) return { error: "ID de clase requerido" };

  try {
    const { data: existing } = await supabase
      .from("lesson_transcripts")
      .select("id")
      .eq("lesson_id", lessonId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("lesson_transcripts")
        .update({
          status: payload.status,
          source_type: payload.source_type,
          language: payload.language,
          transcript_text: payload.transcript_text,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);
      
      if (error) throw error;
      return { success: true, transcriptId: existing.id };
    } else {
      const { data, error } = await supabase
        .from("lesson_transcripts")
        .insert({
          lesson_id: lessonId,
          status: payload.status,
          source_type: payload.source_type,
          language: payload.language,
          transcript_text: payload.transcript_text,
          imported_by: user.id,
          segments_count: 0
        })
        .select("id")
        .single();
        
      if (error) throw error;
      return { success: true, transcriptId: data.id };
    }
  } catch (error: any) {
    console.error("[Transcripts] Error upserting transcript:", error);
    return { error: error.message || "Error al guardar la transcripción" };
  }
}

export async function saveLessonTranscriptSegments(transcriptId: string, lessonId: string, segments: {
  position: number;
  start_seconds: number | null;
  end_seconds: number | null;
  text: string;
}[]) {
  const supabase = await createClient();
  
  // Verify admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  
  if (profile?.role !== "admin") return { error: "No autorizado" };

  if (!transcriptId || !lessonId) return { error: "IDs requeridos" };

  try {
    // 1. Delete existing
    const { error: deleteError } = await supabase
      .from("lesson_transcript_segments")
      .delete()
      .eq("transcript_id", transcriptId);
      
    if (deleteError) throw deleteError;

    // 2. Insert new
    if (segments.length > 0) {
      const { error: insertError } = await supabase
        .from("lesson_transcript_segments")
        .insert(segments.map(s => ({
          transcript_id: transcriptId,
          lesson_id: lessonId,
          position: s.position,
          start_seconds: s.start_seconds,
          end_seconds: s.end_seconds,
          text: s.text
        })));
        
      if (insertError) throw insertError;
    }

    // 3. Update count
    const { error: updateError } = await supabase
      .from("lesson_transcripts")
      .update({ segments_count: segments.length })
      .eq("id", transcriptId);

    if (updateError) throw updateError;

    return { success: true };
  } catch (error: any) {
    console.error("[Transcripts] Error saving segments:", error);
    return { error: error.message || "Error al guardar segmentos" };
  }
}

export async function deleteLessonTranscript(transcriptId: string) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return { error: "No autorizado" };

  try {
    const { error } = await supabase.from("lesson_transcripts").delete().eq("id", transcriptId);
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error("[Transcripts] Error deleting transcript:", error);
    return { error: error.message || "Error al eliminar la transcripción" };
  }
}
