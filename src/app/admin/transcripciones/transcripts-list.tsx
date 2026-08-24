"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { Edit2, FileText, Search, ChevronRight, BookOpen } from "lucide-react";

export function TranscriptsList({ lessons }: { lessons: any[] }) {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Clean data structure
  const processedLessons = useMemo(() => {
    return lessons.map(lesson => {
      const modulesArray = Array.isArray(lesson.course_modules) ? lesson.course_modules : [lesson.course_modules];
      const module = modulesArray[0] as any;
      const course = module?.courses ? (Array.isArray(module.courses) ? module.courses[0] : module.courses) : null;
      
      const transcriptsArray = Array.isArray(lesson.lesson_transcripts) ? lesson.lesson_transcripts : (lesson.lesson_transcripts ? [lesson.lesson_transcripts] : []);
      const transcript = transcriptsArray[0] as any;

      return {
        ...lesson,
        moduleId: module?.id,
        moduleTitle: module?.title,
        moduleSortOrder: module?.sort_order || 0,
        courseId: course?.id,
        courseTitle: course?.title,
        courseKind: course?.course_kind,
        transcript
      };
    });
  }, [lessons]);

  // Extract unique courses
  const courses = useMemo(() => {
    const courseMap = new Map();
    for (const lesson of processedLessons) {
      if (!lesson.courseId) continue;
      if (!courseMap.has(lesson.courseId)) {
        courseMap.set(lesson.courseId, {
          id: lesson.courseId,
          title: lesson.courseTitle,
          kind: lesson.courseKind,
          totalLessons: 0,
          transcriptsReady: 0,
        });
      }
      const courseObj = courseMap.get(lesson.courseId);
      courseObj.totalLessons++;
      if (lesson.transcript?.status === "ready") {
        courseObj.transcriptsReady++;
      }
    }
    return Array.from(courseMap.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [processedLessons]);

  const filteredLessons = useMemo(() => {
    if (!selectedCourseId) return [];
    
    let result = processedLessons.filter(l => l.courseId === selectedCourseId);
    
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(l => l.title.toLowerCase().includes(q) || l.moduleTitle?.toLowerCase().includes(q));
    }
    
    return result;
  }, [processedLessons, selectedCourseId, searchTerm]);

  // Group by module for rendering
  const modulesGrouped = useMemo(() => {
    const groups: { [key: string]: { id: string, title: string, order: number, lessons: any[] } } = {};
    
    for (const lesson of filteredLessons) {
      const modId = lesson.moduleId || "unknown";
      if (!groups[modId]) {
        groups[modId] = {
          id: modId,
          title: lesson.moduleTitle || "Sin módulo",
          order: lesson.moduleSortOrder,
          lessons: []
        };
      }
      groups[modId].lessons.push(lesson);
    }
    
    // Sort modules
    const sortedGroups = Object.values(groups).sort((a, b) => a.order - b.order);
    
    // Sort lessons within modules
    sortedGroups.forEach(g => {
      g.lessons.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    });
    
    return sortedGroups;
  }, [filteredLessons]);

  const getStatusBadge = (transcript: any) => {
    if (!transcript) return <span className="bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Sin transcripción</span>;
    if (transcript.status === "ready") return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Ready</span>;
    if (transcript.status === "draft") return <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Draft</span>;
    if (transcript.status === "error") return <span className="bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Error</span>;
    if (transcript.status === "processing") return <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">Processing</span>;
    return <span className="bg-gray-500/10 text-gray-400 border border-gray-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">{transcript.status}</span>;
  };

  const selectedCourse = courses.find(c => c.id === selectedCourseId);

  return (
    <div className="space-y-6">
      {/* Selector de Cursos si no hay uno seleccionado, o Breadcrumb/Select si lo hay */}
      {!selectedCourseId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map(course => (
            <button
              key={course.id}
              onClick={() => setSelectedCourseId(course.id)}
              className="text-left bg-stampa-surface border border-stampa-border p-5 rounded-2xl hover:border-stampa-orange/50 hover:bg-white/[0.02] transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-white/5 border border-stampa-border rounded-xl text-gray-400 group-hover:text-stampa-orange transition-colors">
                    <BookOpen size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white group-hover:text-stampa-orange transition-colors">{course.title}</h3>
                    <p className="text-xs text-gray-500 mt-1 capitalize">{course.kind || 'Curso'}</p>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-stampa-border flex items-center justify-between">
                <div className="text-xs text-gray-400">
                  <span className="text-emerald-400 font-bold">{course.transcriptsReady}</span> de {course.totalLessons} listas
                </div>
                <ChevronRight size={16} className="text-gray-500 group-hover:text-stampa-orange transition-colors" />
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-stampa-surface border border-stampa-border p-4 rounded-2xl">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setSelectedCourseId(null)}
                className="text-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                Cursos
              </button>
              <ChevronRight size={14} className="text-gray-600" />
              <select
                value={selectedCourseId}
                onChange={e => setSelectedCourseId(e.target.value)}
                className="bg-transparent text-white font-bold text-base focus:outline-none focus:ring-0 max-w-[250px] sm:max-w-md truncate"
              >
                {courses.map(c => (
                  <option key={c.id} value={c.id} className="bg-[#1a1a1a] text-sm font-normal">
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative w-full sm:w-auto">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={14} className="text-gray-500" />
              </div>
              <input
                type="text"
                placeholder="Buscar clase..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full sm:w-64 bg-black/20 border border-stampa-border rounded-xl pl-9 pr-4 py-2 text-sm text-gray-300 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>

          <div className="space-y-6">
            {modulesGrouped.length === 0 ? (
              <div className="text-center p-8 bg-stampa-surface border border-stampa-border rounded-2xl text-gray-500">
                No se encontraron clases para esta búsqueda.
              </div>
            ) : (
              modulesGrouped.map(mod => (
                <div key={mod.id} className="bg-stampa-surface border border-stampa-border rounded-2xl overflow-hidden">
                  <div className="bg-black/20 border-b border-stampa-border px-4 py-3">
                    <h3 className="text-sm font-bold text-gray-300">{mod.title}</h3>
                  </div>
                  <div className="divide-y divide-stampa-border">
                    {mod.lessons.map(lesson => (
                      <div key={lesson.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 hover:bg-white/[0.02] transition-colors gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <FileText size={16} className="text-gray-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-gray-200 text-sm truncate" title={lesson.title}>{lesson.title}</p>
                            <div className="flex items-center gap-3 mt-1.5">
                              {getStatusBadge(lesson.transcript)}
                              {lesson.transcript && (
                                <span className="text-[11px] text-gray-500 flex items-center gap-1">
                                  {lesson.transcript.segments_count || 0} segmentos
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="shrink-0">
                          <Link
                            href={`/admin/transcripciones/${lesson.id}`}
                            className="inline-flex items-center justify-center h-8 px-3 rounded-lg bg-white/5 border border-stampa-border text-xs font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                          >
                            {lesson.transcript ? (
                              <>
                                <Edit2 size={14} className="mr-2" /> Editar
                              </>
                            ) : (
                              <>
                                <FileText size={14} className="mr-2" /> Crear
                              </>
                            )}
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
