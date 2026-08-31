"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { normalizeCourseKind } from "@/lib/academy/course-kind";
import { createClient } from "@/utils/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  revalidatePath("/admin/cursos");
  revalidatePath("/cursos");
  revalidatePath("/talleres");
  revalidatePath("/academia");
  revalidatePath("/");

  return {
    success: true as const,
    courseId: deletedCourse.id,
    courseKind: normalizeCourseKind(course.course_kind),
  };
}
