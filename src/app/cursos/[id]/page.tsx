"use client";

import React, { use } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Lock, CheckCircle2, Circle } from "lucide-react";
import { useAppState } from "@/context/state-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function CursoDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { courses, toggleModuleDone } = useAppState();

  const course = courses.find((c) => c.id === id);

  if (!course) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Curso no encontrado</h2>
        <p className="mt-2 text-sm text-gray-500">El curso que estás buscando no existe.</p>
        <Link href="/cursos" className="mt-4 inline-block text-sm font-semibold text-orange-500 hover:underline">
          Volver a cursos
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/cursos"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft size={14} /> Volver a cursos
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-gray-900 text-6xl text-white">
            <Play size={44} className="opacity-80" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Badge tone={course.badge === "Premium" ? "dark" : "green"}>{course.badge}</Badge>
            <span className="text-xs text-gray-400">
              {course.lessons} lecciones · {course.duration}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">{course.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">{course.desc}</p>
        </div>

        <div>
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-gray-900">Progreso del curso</p>
              <span className="text-xs font-semibold text-orange-600">{course.progress}%</span>
            </div>
            <ProgressBar value={course.progress} className="mb-4" />
            <div className="space-y-1">
              {course.modules.map((m, i) => (
                <button
                  key={i}
                  disabled={m.locked}
                  onClick={() => toggleModuleDone(course.id, m.title)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                    m.locked ? "cursor-not-allowed opacity-50" : "hover:bg-gray-50"
                  }`}
                >
                  {m.locked ? (
                    <Lock size={16} className="text-gray-300" />
                  ) : m.done ? (
                    <CheckCircle2 size={16} className="text-orange-500" />
                  ) : (
                    <Circle size={16} className="text-gray-300" />
                  )}
                  <span className={`flex-1 ${m.done ? "text-gray-400 line-through" : "text-gray-700"}`}>
                    {m.title}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
