"use client";

import Link from "next/link";
import { Type, Zap, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";

// Catálogo de herramientas de Stampa Maker. Al sumar una herramienta nueva,
// alcanza con agregarla acá: cada card ya resuelve layout y estilo.
const MAKER_TOOLS = [
  {
    href: "/stampa-maker/carteles",
    icon: Type,
    title: "Creador de Carteles",
    description: "Carteles corpóreos, tapas, difusores y cuerpos paramétricos.",
  },
  {
    href: "/stampa-maker/neon",
    icon: Zap,
    title: "Neon LED",
    description: "Generá canales imprimibles para Neon Flex a partir de texto o recorridos SVG.",
  },
] as const;

export default function StampaMakerPage() {
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle eyebrow="Stampa" title="Stampa Maker" />
      <p className="max-w-xl text-sm text-gray-400">
        Herramientas para generar geometría 3D imprimible a partir de parámetros simples. Elegí una herramienta para empezar.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MAKER_TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link key={tool.href} href={tool.href}>
              <Card className="stampa-card-interactive group flex h-full cursor-pointer flex-col gap-3 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stampa-orange/10 text-stampa-orange">
                  <Icon size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{tool.title}</h3>
                  <p className="mt-1 text-xs text-gray-400">{tool.description}</p>
                </div>
                <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-stampa-orange">
                  Abrir <ArrowRight size={13} />
                </span>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
