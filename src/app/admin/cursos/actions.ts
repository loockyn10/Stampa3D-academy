"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { normalizeCourseKind } from "@/lib/academy/course-kind";
import {
  COURSE_VISIBILITY_META,
  isCourseVisibility,
  normalizeCourseVisibility,
  type CourseVisibility,
} from "@/lib/academy/visibility";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Rutas y layouts que muestran cursos: el cambio de visibilidad se refleja sin un deploy nuevo. */
function revalidateAcademySurfaces() {
  revalidatePath("/admin/cursos");
  revalidatePath("/cursos", "layout");
  revalidatePath("/talleres");
  revalidatePath("/academia");
  revalidatePath("/");
}

/**
 * Cliente con service role SOLO para contar alumnos afectados (el RLS de `lesson_progress` es por dueño y un
 * administrador no necesariamente ve el progreso ajeno). Se usa después de verificar que quien llama es admin y
 * únicamente para lectura. Sin la variable de entorno se cae al cliente del usuario (conteo posiblemente parcial).
 */
function createLearnerCountClient(fallback: Awaited<ReturnType<typeof createClient>>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return { client: fallback, complete: false };
  return {
    client: createServiceClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
    complete: true,
  };
}

const LEARNER_SCAN_LIMIT = 5000;

async function countCourseLearners(supabase: Awaited<ReturnType<typeof createClient>>, courseId: string) {
  const { client, complete } = createLearnerCountClient(supabase);
  const { data, error } = await client
    .from("lesson_progress")
    .select("user_id, lessons!inner ( course_modules!inner ( course_id ) )")
    .eq("lessons.course_modules.course_id", courseId)
    .limit(LEARNER_SCAN_LIMIT);
  if (error) return { learnerCount: 0, approximate: true, error: error.message };
  const rows = data ?? [];
  const learners = new Set(rows.map((row) => String((row as { user_id: unknown }).user_id)));
  return {
    learnerCount: learners.size,
    approximate: !complete || rows.length >= LEARNER_SCAN_LIMIT,
    error: null as string | null,
  };
}

/** Cuántos alumnos tienen progreso en el curso: alimenta la advertencia antes de bloquearlo. Solo administradores. */
export async function getCourseVisibilityImpactAction(courseId: string) {
  if (!UUID_PATTERN.test(courseId)) {
    return { success: false as const, error: "El curso seleccionado no es válido." };
  }
  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.userId || !access.capabilities.accessAdmin) {
    return { success: false as const, error: "No tenés permiso para administrar la visibilidad de los cursos." };
  }
  const result = await countCourseLearners(supabase, courseId);
  if (result.error) return { success: false as const, error: result.error };
  return { success: true as const, learnerCount: result.learnerCount, approximate: result.approximate };
}

/**
 * Cambia la visibilidad de un curso o taller (`published` / `coming_soon` / `hidden`). La autorización se resuelve
 * en el servidor (`profiles.role`), nunca desde datos del cliente. No toca clases, módulos, inscripciones ni
 * progreso: solo la columna `status`.
 */
export async function updateCourseVisibilityAction(courseId: string, visibility: string) {
  if (!UUID_PATTERN.test(courseId)) {
    return { success: false as const, error: "El curso o taller seleccionado no es válido." };
  }
  if (!isCourseVisibility(visibility)) {
    return { success: false as const, error: "La visibilidad seleccionada no es válida." };
  }

  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.userId || !access.capabilities.accessAdmin) {
    return { success: false as const, error: "No tenés permiso para cambiar la visibilidad de los cursos." };
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, status, course_kind")
    .eq("id", courseId)
    .maybeSingle();
  if (courseError) return { success: false as const, error: courseError.message };
  if (!course) return { success: false as const, error: "No se encontró el curso o taller." };

  const previous = normalizeCourseVisibility(course.status);
  const nextVisibility: CourseVisibility = visibility;

  let learnerCount = 0;
  if (nextVisibility !== "published" && previous === "published") {
    learnerCount = (await countCourseLearners(supabase, courseId)).learnerCount;
  }

  // Un valor histórico (draft/archived) equivalente al pedido no se reescribe salvo que cambie el significado.
  if (course.status !== nextVisibility) {
    const { data: updated, error: updateError } = await supabase
      .from("courses")
      .update({ status: nextVisibility })
      .eq("id", courseId)
      .select("id, status")
      .maybeSingle();
    if (updateError) {
      const migrationHint = /check constraint|invalid input value for enum|violates/i.test(updateError.message)
        ? " Verificá que la migration de visibilidad de cursos esté aplicada."
        : "";
      return {
        success: false as const,
        error: `No se pudo guardar la visibilidad: ${updateError.message}.${migrationHint}`,
      };
    }
    if (!updated) {
      return { success: false as const, error: "No se pudo guardar la visibilidad (sin permisos sobre el curso)." };
    }
  }

  revalidateAcademySurfaces();

  return {
    success: true as const,
    courseId,
    visibility: nextVisibility,
    previousVisibility: previous,
    label: COURSE_VISIBILITY_META[nextVisibility].label,
    courseKind: normalizeCourseKind(course.course_kind),
    learnerCount,
  };
}

export async function deleteCourseAction(courseId: string) {
  if (!UUID_PATTERN.test(courseId)) {
    return { success: false as const, error: "El curso o taller seleccionado no es válido." };
  }

  const supabase = await createClient();
  const { access, error: accessError } = await getCurrentUserAccess(supabase);
  if (accessError || !access.userId || !access.capabilities.accessAdmin) {
    return { success: false as const, error: "No tenés permiso para eliminar cursos o talleres." };
  }

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, course_kind")
    .eq("id", courseId)
    .maybeSingle();

  if (courseError) return { success: false as const, error: courseError.message };
  if (!course) {
    return { success: false as const, error: "No se encontró el curso o taller." };
  }

  // One database statement keeps FK cascades atomic. If any remote relation is
  // restrictive, PostgreSQL rejects the whole delete instead of leaving a
  // partially cleaned course.
  const { data: deletedCourse, error: deleteError } = await supabase
    .from("courses")
    .delete()
    .eq("id", courseId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    return {
      success: false as const,
      error: `La base de datos no pudo eliminar el contenido de forma segura: ${deleteError.message}`,
    };
  }
  if (!deletedCourse) {
    return { success: false as const, error: "El curso o taller no pudo eliminarse." };
  }

  revalidateAcademySurfaces();

  return {
    success: true as const,
    courseId: deletedCourse.id,
    courseKind: normalizeCourseKind(course.course_kind),
  };
}
