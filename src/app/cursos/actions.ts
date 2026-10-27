"use server";

import { loadLessonGate } from "@/lib/academy/access";
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
