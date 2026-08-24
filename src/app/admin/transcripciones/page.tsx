import React from "react";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SectionTitle } from "@/components/ui/section-title";
import { Edit2, Eye, FileText, ChevronRight } from "lucide-react";

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
        title,
        sort_order,
        is_active,
        courses!inner (
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
    .eq("is_active", true)
    .order("sort_order", { ascending: true }); // We'll sort more precisely in JS

  if (!lessons) {
    return <div>Error al cargar clases.</div>;
  }

  // Sort by Course, then Module, then Lesson
  const sortedLessons = [...lessons].sort((a, b) => {
    const courseA = Array.isArray(a.course_modules) ? (a.course_modules[0] as any)?.courses?.title || (a.course_modules[0] as any)?.courses?.[0]?.title : (a.course_modules as any)?.courses?.title || (a.course_modules as any)?.courses?.[0]?.title;
    const courseB = Array.isArray(b.course_modules) ? (b.course_modules[0] as any)?.courses?.title || (b.course_modules[0] as any)?.courses?.[0]?.title : (b.course_modules as any)?.courses?.title || (b.course_modules as any)?.courses?.[0]?.title;
    if (courseA !== courseB) return (courseA || "").localeCompare(courseB || "");
    
    const moduleOrderA = Array.isArray(a.course_modules) ? a.course_modules[0]?.sort_order : (a.course_modules as any)?.sort_order;
    const moduleOrderB = Array.isArray(b.course_modules) ? b.course_modules[0]?.sort_order : (b.course_modules as any)?.sort_order;
    if (moduleOrderA !== moduleOrderB) return (moduleOrderA || 0) - (moduleOrderB || 0);

    return (a.sort_order || 0) - (b.sort_order || 0);
  });

  const getStatusBadge = (transcript: any) => {
    if (!transcript) return <span className="bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full text-xs font-medium">Sin transcripción</span>;
    if (transcript.status === "ready") return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full text-xs font-medium">Ready</span>;
    if (transcript.status === "draft") return <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full text-xs font-medium">Draft</span>;
    if (transcript.status === "error") return <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full text-xs font-medium">Error</span>;
    if (transcript.status === "processing") return <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full text-xs font-medium">Processing</span>;
    return <span className="bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full text-xs font-medium">{transcript.status}</span>;
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <SectionTitle eyebrow="Gestión" title="Transcripciones de Clases" />
          <p className="text-sm text-gray-400 -mt-3 mb-6">
            Gestioná el texto y segmentos de video para Stampy Lesson Chat.
          </p>
        </div>
      </div>

      <div className="bg-stampa-surface border border-stampa-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-black/20 border-b border-stampa-border">
              <tr>
                <th className="px-4 py-3 font-medium">Curso / Módulo</th>
                <th className="px-4 py-3 font-medium">Clase</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-center">Segmentos</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stampa-border">
              {sortedLessons.map((lesson) => {
                const modulesArray = Array.isArray(lesson.course_modules) ? lesson.course_modules : [lesson.course_modules];
                const module = modulesArray[0] as any;
                const course = module?.courses;
                
                const transcriptsArray = Array.isArray(lesson.lesson_transcripts) ? lesson.lesson_transcripts : (lesson.lesson_transcripts ? [lesson.lesson_transcripts] : []);
                const transcript = transcriptsArray[0] as any;

                return (
                  <tr key={lesson.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium text-white truncate max-w-[200px]" title={(course as any)?.title || (course as any)?.[0]?.title}>{(course as any)?.title || (course as any)?.[0]?.title}</span>
                        <span className="text-xs text-gray-500 truncate max-w-[200px]" title={(module as any)?.title}>{(module as any)?.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-gray-500 flex-shrink-0" />
                        <span className="font-medium text-gray-200">{lesson.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(transcript)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {transcript ? (
                        <span className="text-gray-400">{transcript.segments_count || 0}</span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/transcripciones/${lesson.id}`}
                        className="inline-flex items-center justify-center h-8 px-3 rounded-lg bg-white/5 border border-stampa-border text-xs font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                      >
                        {transcript ? (
                          <>
                            <Edit2 size={14} className="mr-2" /> Editar
                          </>
                        ) : (
                          <>
                            <FileText size={14} className="mr-2" /> Crear
                          </>
                        )}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sortedLessons.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No hay clases activas para mostrar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
