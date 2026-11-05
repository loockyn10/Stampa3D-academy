"use server";

import { loadLessonGate } from "@/lib/academy/access";
import { signBunnyEmbedUrl } from "@/lib/academy/bunny-token";
import { resolveLessonVideo } from "@/lib/academy/video";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { createClient } from "@/utils/supabase/server";

const LOCKED_MESSAGE = "Este curso todavía no está disponible.";

/**
 * Marca o desmarca una clase como completada para el usuario autenticado. El `user_id` sale de la sesión (nunca
 * del cliente) y la clase debe pertenecer a un curso publicado (o ser administrador) con Academia habilitada.
 *
 * Desmarcar es una operación sobre el progreso propio del alumno: no se ofrece sobre cursos bloqueados para no
 * alterar el historial mientras el curso está en preparación u oculto.
 */
export async function setLessonProgressAction(lessonId: string, completed: boolean) {
  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.authenticated || !access.userId) {
    return { success: false as const, error: "Iniciá sesión para guardar tu progreso." };
  }

  const gate = await loadLessonGate(supabase, lessonId, access);
  if (!gate.allowed) {
    return {
      success: false as const,
      error: gate.reason === "course_locked" || gate.reason === "feature_unavailable" ? LOCKED_MESSAGE : "No se encontró la clase.",
    };
  }

  if (completed) {
    const { error } = await supabase
      .from("lesson_progress")
      .upsert(
        { user_id: access.userId, lesson_id: lessonId, completed_at: new Date().toISOString() },
        { onConflict: "user_id,lesson_id" },
      );
    if (error) return { success: false as const, error: "No se pudo guardar tu progreso." };
    return { success: true as const, completed: true };
  }

  const { error } = await supabase
    .from("lesson_progress")
    .delete()
    .eq("user_id", access.userId)
    .eq("lesson_id", lessonId);
  if (error) return { success: false as const, error: "No se pudo actualizar tu progreso." };
  return { success: true as const, completed: false };
}

export type LessonPlaybackResult =
  | { ok: true; provider: "bunny" | "vimeo" | "youtube" | "file"; src: string }
  | { ok: true; provider: "none" }
  | { ok: false; error: string };

/**
 * Playback URL of a lesson, decided on the server with the same gate as the progress (session, Academia, Premium,
 * published course, active lesson). Bunny embeds are signed with a short-lived token when
 * `BUNNY_STREAM_TOKEN_KEY` is configured (Bunny "Embed view token authentication").
 */
export async function getLessonPlaybackAction(lessonId: string): Promise<LessonPlaybackResult> {
  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.authenticated) return { ok: false, error: "Iniciá sesión para ver la clase." };

  const gate = await loadLessonGate(supabase, lessonId, access);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason === "course_locked" || gate.reason === "feature_unavailable" ? LOCKED_MESSAGE : "No se encontró la clase." };
  }

  const { data, error } = await supabase.from("lessons").select("video_url").eq("id", lessonId).maybeSingle();
  if (error || !data) return { ok: false, error: "No pudimos cargar el video. Probá de nuevo." };

  const video = resolveLessonVideo(data.video_url as string | null);
  if (video.provider === "none") return { ok: true, provider: "none" };
  if (video.provider === "invalid") return { ok: false, error: "El video de esta clase no está disponible por ahora." };

  const tokenKey = process.env.BUNNY_STREAM_TOKEN_KEY;
  if (video.provider === "bunny" && tokenKey) {
    return { ok: true, provider: "bunny", src: signBunnyEmbedUrl({ embedUrl: video.embedUrl, videoId: video.videoId, tokenKey, now: new Date() }) };
  }
  return { ok: true, provider: video.provider, src: video.embedUrl };
}
