import Link from "next/link";
import { Type, Zap, Coffee, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/ui/section-title";
import { getCurrentUserAccess } from "@/lib/auth/user-access";
import { visibleMakerTools } from "@/lib/maker/availability";
import { createClient } from "@/utils/supabase/server";

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
  {
    href: "/stampa-maker/jarros",
    icon: Coffee,
    title: "JARROS 3D",
    description: "Creá jarros únicos y listos para imprimir con cuerpos, asas y estilos paramétricos.",
  },
] as const;

export default async function StampaMakerPage() {
  const supabase = await createClient();
  const { access } = await getCurrentUserAccess(supabase);
  const tools = visibleMakerTools(MAKER_TOOLS, access.capabilities.accessAdmin);
  return (
    <div className="flex flex-col gap-5">
      <SectionTitle eyebrow="Stampa" title="Stampa Maker" />
      <p className="max-w-xl text-sm text-gray-400">
        Herramientas para generar geometría 3D imprimible a partir de parámetros simples. Elegí una herramienta para empezar.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Link key={tool.href} href={tool.href}>
              <Card className="stampa-card-interactive group flex h-full cursor-pointer flex-col gap-3 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stampa-orange/10 text-stampa-orange">
                  <Icon size={20} />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    {tool.title}
                    {tool.beta && <span className="rounded-full bg-stampa-orange/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stampa-orange">Beta</span>}
                  </h3>
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
