import {
  BookOpen,
  Bot,
  Boxes,
  Download,
  MessageCircle,
  Wrench,
} from "lucide-react";
import { LandingV2SectionHeading } from "./LandingV2SectionHeading";

const ECOSYSTEM_ITEMS = [
  {
    title: "Academia",
    result: "Sabé qué aprender y en qué orden.",
    detail: "Cursos, talleres y rutas recomendadas.",
    icon: BookOpen,
    tone: "text-orange-300 bg-orange-400/10",
  },
  {
    title: "Stampy",
    result: "Destrabate sin salir de la plataforma.",
    detail: "Asistencia para impresión 3D y para usar Stampa.",
    icon: Bot,
    tone: "text-cyan-300 bg-cyan-400/10",
  },
  {
    title: "Herramientas",
    result: "Dejá de adivinar cuánto cobrar.",
    detail: "Calculadoras y presupuestos rápidos o profesionales.",
    icon: Wrench,
    tone: "text-blue-300 bg-blue-400/10",
  },
  {
    title: "Taller",
    result: "Sabé qué tenés y qué usaste.",
    detail: "Filamentos, productos, inventario y movimientos.",
    icon: Boxes,
    tone: "text-emerald-300 bg-emerald-400/10",
  },
  {
    title: "Comunidad",
    result: "Compartí dudas y avances con otros makers.",
    detail: "Canales de WhatsApp y Telegram, contenido y novedades.",
    icon: MessageCircle,
    tone: "text-violet-300 bg-violet-400/10",
  },
  {
    title: "Recursos",
    result: "Encontrá material listo para seguir creando.",
    detail: "Librería STL, sorteos y recursos para miembros.",
    icon: Download,
    tone: "text-amber-300 bg-amber-400/10",
  },
];

export function LandingV2Ecosystem() {
  return (
    <section id="ecosistema" className="scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32 lg:px-10 lg:py-36">
      <div className="mx-auto max-w-7xl">
        <LandingV2SectionHeading
          eyebrow="Ecosistema Stampa"
          title="Todo tu mundo 3D, en un solo lugar."
          description="Cada parte tiene valor por sí misma. Juntas reducen el tiempo que perdés pasando de una herramienta a otra."
        />

        {/* Aislado para una futura Accordion Gallery. */}
        <div className="mt-14 divide-y divide-white/[0.08] border-y border-white/[0.08]">
          {ECOSYSTEM_ITEMS.map(({ title, result, detail, icon: Icon, tone }, index) => (
            <div key={title} className="grid gap-4 py-6 sm:grid-cols-[3rem_9rem_1fr] sm:items-center sm:gap-6 lg:grid-cols-[3rem_11rem_1.15fr_0.85fr] lg:py-7">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}>
                <Icon size={18} />
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[10px] text-zinc-600">0{index + 1}</span>
                <h3 className="text-base font-bold text-white">{title}</h3>
              </div>
              <p className="text-lg font-medium tracking-[-0.015em] text-zinc-200 sm:col-start-2 lg:col-start-auto">{result}</p>
              <p className="text-sm leading-6 text-zinc-500 sm:col-start-2 lg:col-start-auto">{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
