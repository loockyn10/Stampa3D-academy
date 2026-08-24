import React from "react";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { SectionTitle } from "@/components/ui/section-title";
import { TranscriptsList } from "./transcripts-list";

export const dynamic = "force-dynamic";

export default async function TranscriptsAdminPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    redirect("/sin-acceso");
  }

  // Fetch all lessons with their module, course and transcript (if any)
  const { data: lessons } = await supabase
    .from("lessons")
    .select(`
      id,
      title,
      is_active,
      sort_order,
      created_at,
      course_modules!inner (
        id,
        title,
        sort_order,
        is_active,
        courses!inner (
          id,
          title,
          status,
          course_kind
        )
      ),
      lesson_transcripts (
        id,
        status,
        language,
        source_type,
        segments_count,
        updated_at
      )
    `)
    .eq("is_active", true);

  if (!lessons) {
    return <div>Error al cargar clases.</div>;
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle eyebrow="Gestión" title="Transcripciones" />
          <p className="text-sm text-gray-400 -mt-3 mb-6">
            Gestioná las transcripciones que Stampy usa dentro de las clases.
          </p>
        </div>
      </div>

      <TranscriptsList lessons={lessons} />
    </div>
  );
}
