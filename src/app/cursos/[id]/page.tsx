import { notFound, redirect } from "next/navigation";
import { loadCourseGate } from "@/lib/academy/access";
import { FEATURE_UNAVAILABLE_ROUTE } from "@/lib/features/registry";
import { CourseComingSoonScreen } from "@/components/academy/coming-soon";
import { createClient } from "@/utils/supabase/server";
import { CourseDetailClient } from "./course-detail-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

// La decisión depende de la sesión y del estado actual del curso: nunca se cachea ni se prerenderiza.
export const dynamic = "force-dynamic";

/**
 * Barrera de servidor de `/cursos/[id]`. El cliente solo se monta si el curso está publicado (o si es un
 * administrador); un curso en preparación muestra una pantalla sin datos de clases y uno oculto responde 404.
 */
export default async function CursoDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const gate = await loadCourseGate(supabase, id);

  switch (gate.kind) {
    case "unauthenticated":
      redirect("/login");
    case "feature_unavailable":
      redirect(`${FEATURE_UNAVAILABLE_ROUTE}?herramienta=academia`);
    case "no_membership":
      redirect("/sin-acceso");
    case "not_found":
      notFound();
    case "coming_soon":
      return <CourseComingSoonScreen course={gate.course} />;
    case "open":
      return (
        <CourseDetailClient
          courseId={gate.course.id}
          routeId={id}
          previewVisibility={gate.decision.adminPreview ? gate.decision.visibility : null}
        />
      );
  }
}
