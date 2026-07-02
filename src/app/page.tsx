"use client";

import React from "react";
import Link from "next/link";
import { BookOpen, Download, FileText, Play, Calculator, ChevronRight, CalendarDays, Gift } from "lucide-react";
import { useAppState } from "@/context/state-context";
import { Card } from "@/components/ui/card";
import { PrimaryButton, GhostButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SectionTitle } from "@/components/ui/section-title";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { STL_FILES } from "@/data/mock-data";

export default function InicioPage() {
  const { courses, budgets } = useAppState();

  const continuing = courses.find((c) => c.progress > 0 && c.progress < 100);

  const stats = [
    {
      label: "Cursos iniciados",
      value: courses.filter((c) => c.progress > 0).length,
      icon: BookOpen,
    },
    {
      label: "STL descargados",
      value: 27,
      icon: Download,
    },
    {
      label: "Presupuestos creados",
      value: budgets.length,
      icon: FileText,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Card */}
      <Card className="overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800 p-6 text-white sm:p-8">
        <p className="text-sm font-medium text-orange-400">Hola, Marcos 👋</p>
        <h2 className="mt-1 text-2xl font-bold sm:text-3xl">Sigamos imprimiendo ideas.</h2>
        <p className="mt-2 max-w-lg text-sm text-gray-300">
          Retomá tu curso, revisá el sorteo del mes o calculá el costo de tu próxima pieza.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {continuing ? (
            <PrimaryButton href={`/cursos/${continuing.id}`}>
              <Play size={15} /> Continuar curso
            </PrimaryButton>
          ) : (
            <PrimaryButton href="/cursos">
              <Play size={15} /> Explorar cursos
            </PrimaryButton>
          )}
          <GhostButton href="/calculadora" className="bg-white/10 border-white/10 text-white hover:bg-white/20">
            <Calculator size={15} /> Ir a la calculadora
          </GhostButton>
        </div>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label} className="flex items-center gap-4 p-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500">
              <s.icon size={20} />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* Continuing Course */}
          <SectionTitle
            eyebrow="Seguí aprendiendo"
            title="Continuar curso"
            action={
              <Link href="/cursos" className="text-xs font-semibold text-orange-600 hover:underline">
                Ver todos
              </Link>
            }
          />
          {continuing ? (
            <Link href={`/cursos/${continuing.id}`}>
              <Card className="flex items-center gap-4 p-4 hover:-translate-y-0.5 hover:shadow-md cursor-pointer">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-3xl">
                  {continuing.img}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{continuing.title}</p>
                  <p className="text-xs text-gray-500">
                    {continuing.lessons} lecciones · {continuing.duration}
                  </p>
                  <ProgressBar value={continuing.progress} className="mt-2" />
                </div>
                <ChevronRight size={18} className="text-gray-300 shrink-0" />
              </Card>
            </Link>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No tenés cursos en progreso"
              hint="Explorá el catálogo para empezar."
            />
          )}

          {/* Recently Added STLs */}
          <div className="mt-8">
            <SectionTitle
              eyebrow="Recién agregados"
              title="Últimos STL"
              action={
                <Link href="/libreria-stl" className="text-xs font-semibold text-orange-600 hover:underline">
                  Ver librería
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STL_FILES.slice(0, 4).map((f) => (
                <Card key={f.id} className="p-3">
                  <div className="flex h-16 items-center justify-center rounded-lg bg-gray-50 text-2xl">
                    {f.img}
                  </div>
                  <p className="mt-2 truncate text-xs font-semibold text-gray-900">{f.name}</p>
                  <div className="mt-1">
                    <Badge tone={f.badge === "Premium" ? "dark" : "green"}>{f.badge}</Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar Sorteo Card */}
        <div>
          <SectionTitle eyebrow="Este mes" title="Próximo sorteo" />
          <Card className="p-5">
            <div className="mb-3 flex h-28 items-center justify-center rounded-xl bg-orange-50 text-5xl">
              🎁
            </div>
            <p className="text-sm font-bold text-gray-900">Impresora Creality K2 Plus</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
              <CalendarDays size={13} /> Sorteo: 31 de julio
            </p>
            <PrimaryButton href="/sorteos" className="mt-4 w-full">
              Ver bases y participar
            </PrimaryButton>
          </Card>
        </div>
      </div>
    </div>
  );
}
